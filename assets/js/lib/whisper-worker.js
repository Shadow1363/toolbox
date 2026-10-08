/*
 * Whisper speech recognition worker (transformers.js). Started by lib/whisper.js; never import it directly.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Messages in:  { type: 'load', repo, device, dtype, sessionOptions? }
 *               { type: 'run', id, audio: Float32Array (16 kHz mono), language: string|null }
 * Messages out: { type: 'progress', file, loaded, total }   while downloading
 *               { type: 'ready', device }
 *               { type: 'result', id, words: [{ text, start, end }] }   times relative to the audio
 *               { type: 'error', id?, message }
 */
import { LIBS } from './cdn.js';

let asr = null;
let loadedKey = '';

async function load({ repo, device, dtype, sessionOptions }) {
  const key = `${repo}|${device}|${JSON.stringify(dtype)}`;
  if (asr && loadedKey === key) return post({ type: 'ready', device });
  const { pipeline, env } = await import(LIBS.transformers.url);
  env.allowLocalModels = false;
  env.useBrowserCache = true;
  await asr?.dispose?.();
  asr = null;
  asr = await pipeline('automatic-speech-recognition', repo, {
    device,
    dtype,
    ...(sessionOptions ? { session_options: sessionOptions } : {}),
    progress_callback: (p) => {
      if (p.status === 'progress' || p.status === 'done') {
        post({ type: 'progress', file: p.file, loaded: p.loaded ?? p.total ?? 0, total: p.total ?? 0, done: p.status === 'done' });
      }
    },
  });
  loadedKey = key;
  post({ type: 'ready', device });
}

async function run({ id, audio, language }) {
  if (!asr) throw new Error('The speech model is not loaded.');
  const out = await asr(audio, {
    return_timestamps: 'word',
    language: language || null,
    task: 'transcribe',
  });
  const dur = audio.length / 16000;
  const words = (out.chunks || [])
    .map((c) => ({ text: c.text.trim(), start: c.timestamp?.[0] ?? 0, end: c.timestamp?.[1] ?? null }))
    .filter((w) => w.text);
  words.forEach((w, i) => {
    w.start = Math.min(Math.max(0, w.start), dur);
    if (w.end == null || !isFinite(w.end)) w.end = words[i + 1]?.start ?? dur;
    w.end = Math.min(Math.max(w.start + 0.04, w.end), dur);
  });
  post({ type: 'result', id, words });
}

function post(msg) { self.postMessage(msg); }

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'load') await load(data);
    else if (data.type === 'run') await run(data);
  } catch (err) {
    console.error(err);
    post({ type: 'error', id: data.id, message: err?.message || String(err) });
  }
};
