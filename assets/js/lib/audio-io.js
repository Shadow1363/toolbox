/*
 * Audio loading for the Audio tools: validate, probe and decode audio files and the audio track of video files.

 *
 *   const info = await probeMedia(file);   // { container, duration, hasVideo, tracks: [{ index, codec, sampleRate, channels, language, name, isDefault }] } | null
 *   const { buffer, method } = await loadAudio(file, { track: 0, fallback: true, onStatus, signal });
 *   // method: 'browser' (decodeAudioData) | 'webcodecs' (mediabunny, any audio track) | 'ffmpeg' (ffmpeg.wasm)
 *   createAudioDrop(root, { label, onFile })  // drop zone + picker for one audio/video file
 *
 * Decoding order: the browser's own decodeAudioData (first audio track only), then mediabunny + WebCodecs (any
 * track of MP4/MOV/WebM/MKV/OGG/MP3/WAV/FLAC), then ffmpeg.wasm when `fallback` is on (MKV/AVI codecs the browser
 * lacks). Every decoder resamples to the shared AudioContext's rate (usually 48 kHz).
 */
import { loadLib } from "./cdn.js";
import { ffmpegRun, ffmpegProbe } from "./ffmpeg.js";
import { h, icon, toast, formatBytes } from "./dom.js";

// Stop the browser from opening a file dropped outside a drop zone (as upload.js does).
["dragover", "drop"].forEach((ev) =>
  window.addEventListener(ev, (e) => e.preventDefault()),
);

export const AUDIO_LIMIT = 2 * 1024 ** 3; // 2 GB: decoded PCM is ~11 MB per stereo minute, so the file isn't the bottleneck

const AUDIO_EXT =
  /\.(mp3|wav|wave|ogg|oga|opus|m4a|m4b|m4r|aac|flac|weba|aif|aiff|aifc|caf|wma|amr|mka|ac3)$/i;
const VIDEO_EXT =
  /\.(mp4|m4v|webm|mov|qt|mkv|avi|ogv|3gp|3g2|wmv|flv|mpg|mpeg|ts|mts|m2ts|vob)$/i;
export const AUDIO_ACCEPT =
  "audio/*,video/*,.mkv,.avi,.mka,.flac,.opus,.m4a,.wma,.flv,.ts,.mts";
export const AUDIO_HINT = "MP3, WAV, OGG, M4A, FLAC or any video";

export class AudioError extends Error {}

/** 'audio' | 'video' | null, by MIME type or extension. */
export function mediaKind(file) {
  if (file.type.startsWith("audio/") || AUDIO_EXT.test(file.name))
    return "audio";
  if (file.type.startsWith("video/") || VIDEO_EXT.test(file.name))
    return "video";
  return null;
}

let ctx = null;
/** The shared AudioContext (created on first use; resume it inside a click before playing). */
export function audioContext() {
  if (!ctx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) throw new AudioError("This browser has no Web Audio support.");
    ctx = new Ctx();
  }
  return ctx;
}

/** decodeAudioData on a copy-free ArrayBuffer (it is detached afterwards). */
export function decodeBytes(arrayBuffer) {
  return new Promise((resolve, reject) => {
    const p = audioContext().decodeAudioData(arrayBuffer, resolve, (e) =>
      reject(e || new Error("decode failed")),
    );
    p?.catch?.(() => {}); // the callbacks above report; avoid an unhandled rejection
  });
}

/* ---------- Probe (mediabunny) ---------- */

const MB_CODEC = {
  aac: "AAC",
  opus: "Opus",
  mp3: "MP3",
  vorbis: "Vorbis",
  flac: "FLAC",
  ac3: "AC-3",
  eac3: "E-AC-3",
  dts: "DTS",
  ulaw: "µ-law",
  alaw: "A-law",
};
/** Human name for a codec id from mediabunny or ffmpeg ('pcm-s16' → 'PCM 16-bit'). */
export function codecName(codec) {
  if (!codec) return "Unknown";
  const c = String(codec).toLowerCase();
  if (MB_CODEC[c]) return MB_CODEC[c];
  const pcm = c.match(/^pcm[-_]([suf])(\d+)/);
  if (pcm) return `PCM ${pcm[2]}-bit${pcm[1] === "f" ? " float" : ""}`;
  return c.toUpperCase();
}

async function openInput(file) {
  const mb = await loadLib("mediabunny");
  const input = new mb.Input({
    source: new mb.BlobSource(file),
    formats: mb.ALL_FORMATS,
  });
  if (!(await input.canRead())) {
    input.dispose?.();
    return null;
  }
  return { mb, input };
}

/** Container, duration and audio tracks without decoding. Null when the container is unknown here (e.g. AVI). */
export async function probeMedia(file) {
  try {
    const opened = await openInput(file);
    if (!opened) return null;
    const { input } = opened;
    const [format, audio, video, duration] = await Promise.all([
      input.getFormat(),
      input.getAudioTracks(),
      input.getVideoTracks(),
      input.computeDuration().catch(() => null),
    ]);
    const tracks = audio.map((t, i) => ({
      index: i,
      codec: t.codec,
      sampleRate: t.sampleRate,
      channels: t.numberOfChannels,
      language:
        t.languageCode && t.languageCode !== "und" ? t.languageCode : "",
      name: t.name || "",
      isDefault: !!t.disposition?.default,
    }));
    input.dispose?.();
    return {
      container: format.name,
      duration,
      hasVideo: video.length > 0,
      tracks,
      via: "mediabunny",
    };
  } catch (err) {
    console.warn("Probe failed", err);
    return null;
  }
}

/** Decode one audio track with mediabunny + WebCodecs into a single AudioBuffer at the context rate. */
async function decodeWithWebCodecs(file, track, { onProgress, signal } = {}) {
  const opened = await openInput(file);
  if (!opened) throw new AudioError("Unknown container.");
  const { mb, input } = opened;
  try {
    const tracks = await input.getAudioTracks();
    const t = tracks[track];
    if (!t) throw new AudioError("That audio track does not exist.");
    if (!(await t.canDecode()))
      throw new AudioError(
        `This browser can’t decode ${codecName(t.codec)} audio.`,
      );
    const start = await t.getFirstTimestamp().catch(() => 0);
    const duration = await t.computeDuration();
    const sr = t.sampleRate,
      chs = t.numberOfChannels;
    const length = Math.max(1, Math.ceil((duration - start) * sr));
    const out = Array.from({ length: chs }, () => new Float32Array(length));
    const sink = new mb.AudioBufferSink(t);
    for await (const { buffer, timestamp } of sink.buffers()) {
      if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
      const at = Math.round((timestamp - start) * sr);
      for (let c = 0; c < chs; c++) {
        const src = buffer.getChannelData(
          Math.min(c, buffer.numberOfChannels - 1),
        );
        const from = Math.max(0, -at);
        const n = Math.min(src.length - from, length - at - from);
        if (n > 0) out[c].set(src.subarray(from, from + n), at + from);
      }
      onProgress?.(
        Math.min(1, (timestamp - start) / Math.max(0.01, duration - start)),
      );
    }
    const raw = new AudioBuffer({
      length,
      numberOfChannels: chs,
      sampleRate: sr,
    });
    out.forEach((d, c) => raw.copyToChannel(d, c));
    return await resample(raw, audioContext().sampleRate);
  } finally {
    input.dispose?.();
  }
}

/** Resample (and optionally remix) an AudioBuffer through an OfflineAudioContext. */
export async function resample(
  buffer,
  sampleRate,
  channels = buffer.numberOfChannels,
) {
  if (buffer.sampleRate === sampleRate && buffer.numberOfChannels === channels)
    return buffer;
  const off = new OfflineAudioContext(
    channels,
    Math.max(1, Math.ceil(buffer.duration * sampleRate)),
    sampleRate,
  );
  const src = off.createBufferSource();
  src.buffer = buffer;
  src.connect(off.destination);
  src.start();
  return off.startRendering();
}

/**
 * Decode a file's audio. `track` is the index among its audio tracks. Resolves { buffer, method, probe }.
 * `fallback: true` allows the ffmpeg.wasm download (~32 MB) when nothing else can decode it.
 */
export async function loadAudio(
  file,
  {
    track = 0,
    fallback = false,
    onStatus,
    onProgress,
    signal,
    limit = AUDIO_LIMIT,
  } = {},
) {
  if (!mediaKind(file))
    throw new AudioError(`“${file.name}” isn’t an audio or video file.`);
  if (file.size > limit)
    throw new AudioError(
      `“${file.name}” is ${formatBytes(file.size)}. The limit is ${formatBytes(limit)}.`,
    );
  const errors = [];
  if (track === 0) {
    try {
      onStatus?.("Decoding in the browser…");
      const buffer = await decodeBytes(await file.arrayBuffer());
      return { buffer, method: "browser" };
    } catch (err) {
      errors.push(err);
    }
  }
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
  try {
    onStatus?.("Decoding with WebCodecs…");
    const buffer = await decodeWithWebCodecs(file, track, {
      onProgress,
      signal,
    });
    return { buffer, method: "webcodecs" };
  } catch (err) {
    if (err.name === "AbortError") throw err;
    errors.push(err);
  }
  if (!fallback) {
    console.warn("Audio decode failed", errors);
    throw new AudioError(
      `Your browser can’t decode the audio in “${file.name}”. Try MP3, WAV, M4A, OGG or FLAC, or open it in the Audio Extractor (it can use ffmpeg).`,
    );
  }
  const { data, log } = await ffmpegRun(
    file,
    (input) => [
      "-i",
      input,
      "-map",
      `0:a:${track}`,
      "-vn",
      "-c:a",
      "pcm_s16le",
    ],
    "audio.wav",
    { onStatus, onProgress, signal },
  );
  try {
    const buffer = await decodeBytes(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    );
    return { buffer, method: "ffmpeg", log };
  } catch {
    throw new AudioError(
      `ffmpeg extracted the audio of “${file.name}” but it couldn’t be decoded.`,
    );
  }
}

/** Probe with mediabunny, else (when allowed) ffmpeg's banner. */
export async function probeAny(file, { fallback = false, onStatus } = {}) {
  const info = await probeMedia(file);
  if (info || !fallback) return info;
  try {
    const ff = await ffmpegProbe(file, { onStatus });
    return ff
      ? {
          container: (file.name.split(".").pop() || "").toUpperCase(),
          ...ff,
          via: "ffmpeg",
        }
      : null;
  } catch (err) {
    console.warn("ffmpeg probe failed", err);
    return null;
  }
}

export const METHOD_LABEL = {
  browser: "Browser decoder (Web Audio)",
  webcodecs: "WebCodecs (mediabunny)",
  ffmpeg: "ffmpeg.wasm",
};

/**
 * Drop zone + picker for one audio or video file (not validated against decodability; the caller decodes).
 * Returns { setFile(file, meta), clear(), el }.
 */
export function createAudioDrop(
  root,
  { label = "Drop an audio or video file", onFile, onClear } = {},
) {
  const input = h("input", {
    type: "file",
    accept: AUDIO_ACCEPT,
    "aria-label": label,
  });
  const zone = h("div", { class: "dropzone", tabindex: "-1" });
  root.append(zone);
  const empty = () => {
    zone.classList.remove("has-file");
    zone.replaceChildren(
      h("span", { html: icon("upload"), style: "display:contents" }),
      h("strong", {}, label),
      h("span", {}, `or click to browse · ${AUDIO_HINT}`),
      input,
    );
  };
  const show = (file, meta = "") => {
    zone.classList.add("has-file");
    zone.replaceChildren(
      h("span", { html: icon("volume"), style: "display:contents" }),
      h(
        "div",
        { class: "file-info" },
        h("strong", { title: file.name }, file.name),
        h("span", {}, meta || formatBytes(file.size)),
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-ghost btn-sm file-clear",
          onclick: (e) => {
            e.stopPropagation();
            empty();
            onClear?.();
          },
        },
        "Change",
      ),
      input,
    );
  };
  const take = (file) => {
    input.value = "";
    if (!file) return;
    if (!mediaKind(file)) {
      toast(`“${file.name}” isn’t an audio or video file.`, "error");
      return;
    }
    onFile?.(file);
  };
  input.addEventListener("change", () => take(input.files[0]));
  ["dragenter", "dragover"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.add("is-over");
    }),
  );
  ["dragleave", "drop"].forEach((ev) =>
    zone.addEventListener(ev, (e) => {
      e.preventDefault();
      zone.classList.remove("is-over");
    }),
  );
  zone.addEventListener("drop", (e) => take(e.dataTransfer.files[0]));
  empty();
  return { el: zone, setFile: show, clear: empty };
}

/**
 * loadAudio with a progress modal that appears only when decoding takes a while (long files, WebCodecs, ffmpeg).
 * Resolves like loadAudio, or rejects with an AbortError when the user cancels.
 */
export async function loadAudioWithProgress(file, opts = {}) {
  const { progressModal } = await import("./exporter.js");
  const ctrl = new AbortController();
  let modal = null,
    status = `Decoding ${file.name}.`,
    progress = 0;
  const open = () => {
    if (modal) return;
    modal = progressModal("Opening audio…", () => ctrl.abort(), status);
    modal.set(progress);
  };
  const timer = setTimeout(open, 500);
  try {
    return await loadAudio(file, {
      fallback: true,
      ...opts,
      signal: ctrl.signal,
      onStatus: (m) => {
        status = m;
        if (/ffmpeg/i.test(m)) open();
        modal?.message(m);
        opts.onStatus?.(m);
      },
      onProgress: (p) => {
        progress = p;
        modal?.set(p);
        opts.onProgress?.(p);
      },
    });
  } finally {
    clearTimeout(timer);
    modal?.close();
  }
}

/** "1:23.456" (or "1:02:03.456" past an hour) with `decimals` digits. */
export function clock(t, decimals = 3) {
  t = Math.max(0, t || 0);
  const scale = 10 ** decimals;
  const total = Math.round(t * scale) / scale;
  const hh = Math.floor(total / 3600),
    mm = Math.floor(total / 60) % 60,
    ss = total - Math.floor(total / 60) * 60;
  const sec = ss.toFixed(decimals).padStart(decimals ? 3 + decimals : 2, "0");
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${sec}` : `${mm}:${sec}`;
}

/** Parse "83.5", "1:23.5" or "1:02:03.5" into seconds (NaN when invalid). */
export function parseTime(text) {
  const parts = String(text).trim().replace(",", ".").split(":");
  if (
    !parts.length ||
    parts.length > 3 ||
    parts.some((p) => !/^\d*\.?\d*$/.test(p) || p === "" || p === ".")
  )
    return NaN;
  return parts.reduce((acc, p) => acc * 60 + parseFloat(p), 0);
}
