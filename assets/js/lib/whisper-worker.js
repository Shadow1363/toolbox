/*
 * Whisper speech recognition worker (transformers.js). Started by lib/whisper.js; never import it directly.

 *
 * Messages in:  { type: 'load', repo, device, dtype, sessionOptions? }
 *               { type: 'run', id, audio: Float32Array (16 kHz mono), language: string|null, task?: 'transcribe'|'translate' }
 *               { type: 'detect', id, audio: Float32Array (≤ 30 s, 16 kHz mono) }
 * Messages out: { type: 'progress', file, loaded, total }   while downloading
 *               { type: 'ready', device }
 *               { type: 'result', id, words: [{ text, start, end }] }   times relative to the audio
 *               { type: 'language', id, ranked: [[code, probability], …] }   most likely first
 *               { type: 'error', id?, message }
 */
import { LIBS } from "./cdn.js";

let asr = null;
let loadedKey = "";

async function load({ repo, device, dtype, sessionOptions }) {
  const key = `${repo}|${device}|${JSON.stringify(dtype)}`;
  if (asr && loadedKey === key) return post({ type: "ready", device });
  const { pipeline, env } = await import(LIBS.transformers.url);
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  await asr?.dispose?.();
  asr = null;
  asr = await pipeline("automatic-speech-recognition", repo, {
    device,
    dtype,
    ...(sessionOptions ? { session_options: sessionOptions } : {}),
    progress_callback: (p) => {
      if (p.status === "progress" || p.status === "done") {
        post({
          type: "progress",
          file: p.file,
          loaded: p.loaded ?? p.total ?? 0,
          total: p.total ?? 0,
          done: p.status === "done",
        });
      }
    },
  });
  loadedKey = key;
  post({ type: "ready", device });
}

async function run({ id, audio, language, task }) {
  if (!asr) throw new Error("The speech model is not loaded.");
  const out = await asr(audio, {
    return_timestamps: "word",
    language: language || null, // transformers.js treats null as English, so callers detect first
    task: task === "translate" ? "translate" : "transcribe",
  });
  const dur = audio.length / 16000;
  const words = (out.chunks || [])
    .map((c) => ({
      text: c.text.trim(),
      start: c.timestamp?.[0] ?? 0,
      end: c.timestamp?.[1] ?? null,
    }))
    .filter((w) => w.text);
  words.forEach((w, i) => {
    w.start = Math.min(Math.max(0, w.start), dur);
    if (w.end == null || !isFinite(w.end)) w.end = words[i + 1]?.start ?? dur;
    w.end = Math.min(Math.max(w.start + 0.04, w.end), dur);
  });
  post({ type: "result", id, words });
}

/**
 * Spoken language: one decoder step after <|startoftranscript|>, then a softmax over the language tokens
 * (what Whisper itself does when no language is forced).
 */
async function detect({ id, audio }) {
  if (!asr) throw new Error("The speech model is not loaded.");
  const { Tensor } = await import(LIBS.transformers.url);
  const cfg = asr.model.generation_config;
  const langs = Object.entries(cfg.lang_to_id || {});
  if (!langs.length) throw new Error("This model cannot detect languages.");
  const { input_features } = await asr.processor(audio);
  const sot = cfg.decoder_start_token_id;
  const out = await asr.model({
    input_features,
    decoder_input_ids: new Tensor(
      "int64",
      BigInt64Array.from([BigInt(sot)]),
      [1, 1],
    ),
  });
  const logits = out.logits.data;
  const vocab = out.logits.dims.at(-1);
  const base = logits.length - vocab; // last position
  const scores = langs.map(([tok, i]) => [
    tok.slice(2, -2),
    Number(logits[base + i]),
  ]);
  const max = Math.max(...scores.map((s) => s[1]));
  const exps = scores.map(([c, v]) => [c, Math.exp(v - max)]);
  const sum = exps.reduce((a, [, v]) => a + v, 0);
  const ranked = exps
    .map(([c, v]) => [c, v / sum])
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  post({ type: "language", id, ranked });
}

function post(msg) {
  self.postMessage(msg);
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === "load") await load(data);
    else if (data.type === "run") await run(data);
    else if (data.type === "detect") await detect(data);
  } catch (err) {
    console.error(err);
    post({ type: "error", id: data.id, message: err?.message || String(err) });
  }
};
