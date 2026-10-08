/*
 * ffmpeg.wasm (single-threaded core, no special server headers) as a fallback for media the browser can't read.

 *
 *   const { data, log } = await ffmpegRun(file, (input) => ['-i', input, '-map', '0:a:0', '-c:a', 'copy'], 'out.m4a',
 *     { onStatus, onProgress, signal });
 *   const info = await ffmpegProbe(file);       // { duration, tracks: [{ index, codec, sampleRate, channels, language, isDefault }] }
 *
 * The ~32 MB engine downloads on first use only, then the browser caches it. The input is mounted with WORKERFS
 * (read in place, not copied into wasm memory) when possible. Convert & Encode's file converter keeps its own copy.
 */
import { loadLib, LIBS, workerUrl } from "./cdn.js";

export const FFMPEG_BYTES = 32e6;

let engine = null;

/** The loaded FFmpeg instance (shared, created once). */
export async function getFFmpeg({ onStatus } = {}) {
  if (!engine) {
    onStatus?.("Downloading the ffmpeg engine (~32 MB, only once)…");
    engine = (async () => {
      const { FFmpeg } = await loadLib("ffmpeg");
      const ff = new FFmpeg();
      await ff.load({
        classWorkerURL: workerUrl(LIBS.ffmpegWorker.url),
        coreURL: LIBS.ffmpegCore.url,
        wasmURL: LIBS.ffmpegWasm.url,
      });
      return ff;
    })();
    engine.catch(() => {
      engine = null;
    });
  }
  try {
    return await engine;
  } catch (err) {
    console.error(err);
    throw new Error(
      "Couldn’t start ffmpeg. Check your connection or content blocker, then try again.",
    );
  }
}

let runs = 0;

/** Make `file` readable inside ffmpeg. Returns { path, cleanup }. */
async function stage(ff, file) {
  const dir = `/in${++runs}`;
  const name = `input${(file.name.match(/\.[a-z0-9]{1,5}$/i) || [""])[0].toLowerCase()}`;
  try {
    await ff.createDir(dir);
    await ff.mount(
      "WORKERFS",
      { files: [new File([file], name, { type: file.type })] },
      dir,
    );
    return {
      path: `${dir}/${name}`,
      cleanup: async () => {
        await ff.unmount(dir).catch(() => {});
        await ff.deleteDir(dir).catch(() => {});
      },
    };
  } catch {
    const path = `in${runs}-${name}`;
    await ff.writeFile(path, new Uint8Array(await file.arrayBuffer()));
    return { path, cleanup: () => ff.deleteFile(path).catch(() => {}) };
  }
}

/**
 * Run ffmpeg on `file`. `args(inputPath)` returns the arguments before the output name.
 * Resolves { data: Uint8Array, log: string[] }. Cancelling terminates the engine (the next run reloads it).
 */
export async function ffmpegRun(
  file,
  args,
  outName,
  { onStatus, onProgress, onLog, signal } = {},
) {
  const ff = await getFFmpeg({ onStatus });
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  const log = [];
  const onL = ({ message }) => {
    log.push(message);
    if (log.length > 400) log.shift();
    onLog?.(message);
  };
  const onP = ({ progress }) => {
    if (progress >= 0 && progress <= 1) onProgress?.(progress);
  };
  const abort = () => {
    ff.terminate();
    engine = null;
  };
  ff.on("log", onL);
  ff.on("progress", onP);
  signal?.addEventListener("abort", abort, { once: true });
  const input = await stage(ff, file);
  try {
    onStatus?.("Running ffmpeg…");
    const code = await ff.exec([
      "-hide_banner",
      ...args(input.path),
      "-y",
      outName,
    ]);
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (code !== 0) {
      const why = [...log]
        .reverse()
        .find((l) =>
          /error|invalid|does not contain|no such|not supported|unknown|matches no streams/i.test(
            l,
          ),
        );
      throw new Error(
        why && /matches no streams|does not contain any stream/i.test(why)
          ? `${file.name} has no audio track.`
          : `ffmpeg couldn’t read ${file.name}${why ? `: ${why.trim()}` : " (unsupported codec or corrupt file)"}.`,
      );
    }
    const data = await ff.readFile(outName);
    return { data, log };
  } catch (err) {
    if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
    if (/memory|OOM|Aborted\(\)/i.test(String(err?.message))) {
      engine = null;
      throw new Error(
        `${file.name} is too large for ffmpeg in the browser (ran out of memory). Try a shorter file.`,
      );
    }
    throw err;
  } finally {
    signal?.removeEventListener("abort", abort);
    if (engine) {
      ff.off("log", onL);
      ff.off("progress", onP);
      await input.cleanup();
      await ff.deleteFile(outName).catch(() => {});
    }
  }
}

/** Stream info from ffmpeg's banner (`ffmpeg -i file`). Resolves null when ffmpeg can't read the file. */
export async function ffmpegProbe(file, opts = {}) {
  const ff = await getFFmpeg(opts);
  const log = [];
  const onL = ({ message }) => log.push(message);
  ff.on("log", onL);
  const input = await stage(ff, file);
  try {
    await ff.exec(["-hide_banner", "-i", input.path]); // exits with "At least one output file must be specified"
  } finally {
    ff.off("log", onL);
    await input.cleanup();
  }
  return parseStreams(log);
}

const LAYOUT_CHANNELS = {
  mono: 1,
  stereo: 2,
  2.1: 3,
  "3.0": 3,
  quad: 4,
  "4.0": 4,
  4.1: 5,
  "5.0": 5,
  5.1: 6,
  "6.0": 6,
  6.1: 7,
  "7.0": 7,
  7.1: 8,
};

/** Parse ffmpeg's "Stream #0:1(eng): Audio: aac (LC), 48000 Hz, stereo, fltp" lines. */
export function parseStreams(lines) {
  const text = lines.join("\n");
  const dur = text.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const tracks = [];
  let hasVideo = false;
  for (const l of lines) {
    if (/Stream #\d+:\d+.*: Video:/.test(l) && !/attached pic/.test(l))
      hasVideo = true;
    const m = l.match(
      /Stream #\d+:(\d+)(?:\[[^\]]*\])?(?:\(([a-z]{2,3})\))?: Audio: ([a-z0-9_]+)[^,]*(?:, (\d+) Hz)?(?:, ([^,]+))?/i,
    );
    if (!m) continue;
    const layout = (m[5] || "").trim().replace(/\(.*\)$/, "");
    const ch =
      LAYOUT_CHANNELS[layout] ??
      (+(layout.match(/(\d+) channels/) || [])[1] || null);
    tracks.push({
      index: tracks.length,
      stream: +m[1],
      codec: m[3],
      sampleRate: m[4] ? +m[4] : null,
      channels: ch,
      language: m[2] && m[2] !== "und" ? m[2] : "",
      isDefault: /\(default\)/.test(l),
    });
  }
  if (!dur && !tracks.length) return null;
  return {
    duration: dur ? +dur[1] * 3600 + +dur[2] * 60 + +dur[3] : null,
    tracks,
    hasVideo,
  };
}

/** File extension for copying an audio stream of this codec without re-encoding (ffmpeg codec names). */
export function copyExtension(codec) {
  const c = String(codec || "").toLowerCase();
  if (c === "aac" || c === "alac") return "m4a";
  if (c === "mp3" || c === "mp3float") return "mp3";
  if (c === "opus") return "opus";
  if (c === "vorbis") return "ogg";
  if (c === "flac") return "flac";
  if (c.startsWith("pcm")) return "wav";
  if (c === "ac3") return "ac3";
  if (c === "eac3") return "eac3";
  return "mka"; // Matroska audio holds almost anything
}
