/*
 * In-browser speech recognition with Whisper (transformers.js in a module worker).
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   const device = await pickDevice('auto');                  // 'webgpu' | 'wasm'
 *   modelBytes('base', device)                                // download size, for the UI
 *   await isCached('base', device)                            // already in the browser cache?
 *   const audio = await decodeAudio(fileOrBlob);              // Float32Array, 16 kHz mono
 *   const res = await transcribe(audio, { model: 'base', device, language: null,  // null = auto-detect
 *     task: 'transcribe',                                     // or 'translate' (into English)
 *     onDownload: (loaded, total) => {}, onProgress: (done01) => {}, onLanguage: (code, p) => {}, signal });
 *   // res = { words: [{ text, start, end }] in seconds, device, language, languageProb }
 *   await detectLanguage(audio, { model, device })            // { code, prob, ranked: [[code, p], …] }
 *   languageName('pt')                                       // 'Portuguese'
 *
 * Models are the onnx-community "_timestamped" Whisper exports (they carry alignment heads, which
 * word timestamps need). transformers.js stores downloads in Cache Storage ("transformers-cache"),
 * so each model downloads once. WebGPU first (fp32/fp16 encoder + q4 decoder), WASM fallback (q8).
 * On WASM, onnxruntime's extended graph optimizations break the q8 merged decoder ("Missing required
 * scale … TransposeDQWeightsForMatMulNBits"), so WASM sessions use graphOptimizationLevel 'basic'.
 * Long audio is cut into ≤30 s windows at the quietest moment, so no word is split and progress is real.
 * Language: transformers.js silently assumes English when no language is given, so `transcribe` detects it
 * first (one decoder step on the first speech window, softmax over Whisper's language tokens).
 */
import { LIBS } from './cdn.js';

export const SAMPLE_RATE = 16000;

/** File sizes in MB (from the Hugging Face repos) per model and dtype. */
const SIZES = {
  tiny: { enc: { fp32: 32.9, fp16: 16.5, q8: 10.1 }, dec: { q4: 86.8, q8: 30.7 } },
  base: { enc: { fp32: 82.5, fp16: 41.3, q8: 23.2 }, dec: { q4: 123.7, q8: 53.7 } },
  small: { enc: { fp32: 352.8, fp16: 176.5, q8: 92.2 }, dec: { q4: 233.4, q8: 156.8 } },
};
const SHARED_MB = 3.4; // tokenizer + configs
const SUFFIX = { fp32: '', fp16: '_fp16', q8: '_quantized', q4: '_q4' };

export const WHISPER_MODELS = [
  ['tiny', 'Tiny (fastest)'],
  ['base', 'Base (balanced)'],
  ['small', 'Small (most accurate)'],
];

/** Whisper's languages (the common ones), [code, name]. '' = auto-detect. */
export const WHISPER_LANGUAGES = [
  ['', 'Auto-detect'], ['en', 'English'], ['es', 'Spanish'], ['pt', 'Portuguese'], ['fr', 'French'], ['de', 'German'],
  ['it', 'Italian'], ['nl', 'Dutch'], ['pl', 'Polish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['tr', 'Turkish'],
  ['ar', 'Arabic'], ['hi', 'Hindi'], ['ja', 'Japanese'], ['ko', 'Korean'], ['zh', 'Chinese'], ['id', 'Indonesian'],
  ['vi', 'Vietnamese'], ['th', 'Thai'], ['sv', 'Swedish'], ['da', 'Danish'], ['no', 'Norwegian'], ['fi', 'Finnish'],
  ['cs', 'Czech'], ['el', 'Greek'], ['he', 'Hebrew'], ['hu', 'Hungarian'], ['ro', 'Romanian'], ['ca', 'Catalan'],
  ['ms', 'Malay'], ['tl', 'Tagalog'], ['fa', 'Persian'], ['bn', 'Bengali'], ['ta', 'Tamil'], ['ur', 'Urdu'],
];

const NAMES = typeof Intl !== 'undefined' && Intl.DisplayNames ? new Intl.DisplayNames(['en'], { type: 'language' }) : null;
/** English name for a Whisper language code ('haw' → 'Hawaiian'). */
export function languageName(code) {
  if (!code) return 'Auto-detect';
  const known = WHISPER_LANGUAGES.find(([c]) => c === code);
  if (known) return known[1];
  try { return NAMES?.of(code === 'jw' ? 'jv' : code) || code; } catch { return code; }
}

const repo = (model) => `onnx-community/whisper-${model}_timestamped`;

let gpuInfo = null;
/** { webgpu: bool, f16: bool } (cached). */
export async function gpuSupport() {
  if (!gpuInfo) {
    gpuInfo = (async () => {
      try {
        const adapter = await navigator.gpu?.requestAdapter();
        return { webgpu: !!adapter, f16: !!adapter?.features?.has('shader-f16') };
      } catch { return { webgpu: false, f16: false }; }
    })();
  }
  return gpuInfo;
}

/** Resolve 'auto' | 'webgpu' | 'wasm' to a device this browser can run. */
export async function pickDevice(pref = 'auto') {
  const { webgpu } = await gpuSupport();
  if (pref === 'wasm' || !webgpu) return 'wasm';
  return 'webgpu';
}

async function dtypeFor(model, device) {
  if (device !== 'webgpu') return { encoder_model: 'q8', decoder_model_merged: 'q8' };
  const { f16 } = await gpuSupport();
  return { encoder_model: model === 'small' && f16 ? 'fp16' : 'fp32', decoder_model_merged: 'q4' };
}

/** Download size in bytes for a model on a device. */
export async function modelBytes(model, device) {
  const d = await dtypeFor(model, device);
  const sz = SIZES[model];
  return (sz.enc[d.encoder_model] + sz.dec[d.decoder_model_merged] + SHARED_MB) * 1e6;
}

/** True when every weight file for this model/device is already in Cache Storage. */
export async function isCached(model, device) {
  try {
    if (!('caches' in window)) return false;
    const cache = await caches.open('transformers-cache');
    const d = await dtypeFor(model, device);
    const base = `https://huggingface.co/${repo(model)}/resolve/main/onnx/`;
    const files = [`encoder_model${SUFFIX[d.encoder_model]}.onnx`, `decoder_model_merged${SUFFIX[d.decoder_model_merged]}.onnx`];
    const hits = await Promise.all(files.map((f) => cache.match(base + f)));
    return hits.every(Boolean);
  } catch { return false; }
}

/** Decode the audio track of a media file into 16 kHz mono samples. */
export async function decodeAudio(blob) {
  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!Offline) throw new Error('This browser cannot decode audio (no Web Audio).');
  const buf = await blob.arrayBuffer();
  let decoded;
  try {
    // Any OfflineAudioContext resamples to its own rate while decoding.
    decoded = await new Offline(1, 1, SAMPLE_RATE).decodeAudioData(buf);
  } catch {
    throw new Error('Could not read an audio track from this file. Make sure the video has sound (AAC, Opus, MP3 or Vorbis).');
  }
  const n = decoded.length;
  const out = new Float32Array(n);
  for (let c = 0; c < decoded.numberOfChannels; c++) {
    const ch = decoded.getChannelData(c);
    for (let i = 0; i < n; i++) out[i] += ch[i] / decoded.numberOfChannels;
  }
  return out;
}

/** Split audio into windows of at most `max` seconds, cutting at the quietest 50 ms in the last third. */
export function splitAudio(audio, max = 29) {
  const hop = SAMPLE_RATE / 20;
  const frames = Math.ceil(audio.length / hop);
  const rms = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    let s = 0;
    const a = f * hop, b = Math.min(audio.length, a + hop);
    for (let i = a; i < b; i++) s += audio[i] * audio[i];
    rms[f] = Math.sqrt(s / Math.max(1, b - a));
  }
  const peak = rms.reduce((m, v) => Math.max(m, v), 0);
  const windows = [];
  let start = 0;
  const maxF = max * 20;
  while (start < frames) {
    let end = Math.min(frames, start + maxF);
    if (end < frames) {
      let best = end, bestV = Infinity;
      for (let f = start + Math.floor(maxF * 0.66); f < end; f++) if (rms[f] < bestV) { bestV = rms[f]; best = f; }
      end = best;
    }
    let loud = 0;
    for (let f = start; f < end; f++) loud = Math.max(loud, rms[f]);
    // Skip near-silent windows: Whisper invents text ("Thank you.") on silence.
    windows.push({ start: start * hop, end: Math.min(audio.length, end * hop), silent: loud < Math.max(0.004, peak * 0.03) });
    start = end;
  }
  return windows;
}

let worker = null;
let workerKey = '';
let seq = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL('./whisper-worker.js', import.meta.url), { type: 'module' });
    workerKey = '';
  }
  return worker;
}

/** Wait for one reply from the worker; rejects on 'error'. `onMsg` sees every message meanwhile. */
function request(msg, accept, onMsg, signal, transfer = []) {
  const w = getWorker();
  return new Promise((resolve, reject) => {
    const off = () => { w.removeEventListener('message', on); w.removeEventListener('error', onErr); signal?.removeEventListener('abort', onAbort); };
    const on = ({ data }) => {
      onMsg?.(data);
      if (data.type === 'error' && (data.id == null || data.id === msg.id)) { off(); reject(new Error(data.message)); }
      else if (accept(data)) { off(); resolve(data); }
    };
    const onErr = (e) => { off(); reject(new Error(e.message || 'The speech worker crashed.')); };
    const onAbort = () => { off(); reject(new DOMException('Cancelled', 'AbortError')); };
    w.addEventListener('message', on);
    w.addEventListener('error', onErr);
    signal?.addEventListener('abort', onAbort, { once: true });
    w.postMessage(msg, transfer);
  });
}

/** Load (or reuse) the model in the worker. Falls back to WASM when WebGPU fails. Resolves the device used. */
export async function loadModel(model, device, { onDownload, signal } = {}) {
  const tryLoad = async (dev) => {
    const dtype = await dtypeFor(model, dev);
    const key = `${model}|${dev}`;
    if (workerKey === key) return dev;
    const expected = await modelBytes(model, dev);
    const files = new Map();
    const report = (d) => {
      if (d.type !== 'progress' || !d.total) return;
      files.set(d.file, [d.loaded, d.total]);
      let loaded = 0, total = 0;
      for (const [l, t] of files.values()) { loaded += l; total += t; }
      onDownload?.(loaded, Math.max(total, expected));
    };
    const sessionOptions = dev === 'wasm' ? { graphOptimizationLevel: 'basic' } : null;
    await request({ type: 'load', repo: repo(model), device: dev, dtype, sessionOptions }, (d) => d.type === 'ready', report, signal);
    workerKey = key;
    return dev;
  };
  try {
    return await tryLoad(device);
  } catch (err) {
    if (err.name === 'AbortError') { resetWorker(); throw err; } // stop a half-finished download
    if (device !== 'webgpu') throw err;
    console.warn('WebGPU Whisper failed, falling back to WASM', err);
    resetWorker();
    return tryLoad('wasm');
  }
}

/**
 * Whisper (tiny especially) sometimes loops: "la anteriormente, la anteriormente, …" dozens of times.
 * Keep at most 2 consecutive copies of any repeated 1–8 word phrase.
 */
export function dropLoops(words, keep = 2) {
  const key = (w) => w.text.toLowerCase().replace(/[^\p{L}\p{N}']/gu, '');
  const out = [];
  for (const w of words) {
    out.push(w);
    for (let n = 1; n <= 8; n++) {
      let reps = 1;
      while (out.length >= n * (reps + 1)) {
        const end = out.length - n * reps;
        let same = true;
        for (let i = 0; i < n && same; i++) same = key(out[end - n + i]) === key(out[out.length - n + i]);
        if (!same) break;
        reps++;
      }
      if (reps > keep) { out.length -= n; break; }
    }
  }
  return out;
}

/** The first ~30 s of speech (skipping silent windows), for language detection. */
function speechSample(audio, windows = splitAudio(audio)) {
  const win = windows.find((w) => !w.silent) || windows[0];
  return win ? audio.slice(win.start, Math.min(win.end, win.start + 30 * SAMPLE_RATE)) : audio.slice(0, 30 * SAMPLE_RATE);
}

/** Detect the spoken language. Resolves { code, prob, ranked: [[code, p], …] }. */
export async function detectLanguage(audio, { model = 'base', device = 'wasm', onDownload, signal } = {}) {
  await loadModel(model, device, { onDownload, signal });
  const id = ++seq;
  const chunk = speechSample(audio);
  const res = await request({ type: 'detect', id, audio: chunk }, (d) => d.type === 'language' && d.id === id, null, signal, [chunk.buffer]);
  const [code, prob] = res.ranked[0] || ['en', 0];
  return { code, prob, ranked: res.ranked };
}

/** Transcribe (or translate into English) 16 kHz mono samples. Returns words with absolute times (seconds). */
export async function transcribe(audio, { model = 'base', device = 'wasm', language = null, task = 'transcribe', onDownload, onProgress, onWords, onLanguage, signal } = {}) {
  const used = await loadModel(model, device, { onDownload, signal });
  const windows = splitAudio(audio);
  let languageProb = 1;
  if (!language) {
    try {
      const det = await detectLanguage(audio, { model, device: used, signal });
      language = det.code;
      languageProb = det.prob;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      console.warn('Language detection failed; assuming English', err);
      language = 'en';
      languageProb = 0;
    }
  }
  onLanguage?.(language, languageProb);
  const total = windows.reduce((s, w) => s + (w.end - w.start), 0) || 1;
  let done = 0;
  const words = [];
  onProgress?.(0);
  for (const win of windows) {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (!win.silent) {
      const id = ++seq;
      const chunk = audio.slice(win.start, win.end);
      const res = await request({ type: 'run', id, audio: chunk, language, task }, (d) => d.type === 'result' && d.id === id, null, signal, [chunk.buffer]);
      const offset = win.start / SAMPLE_RATE;
      const got = dropLoops(res.words).map((w) => ({ text: w.text, start: +(w.start + offset).toFixed(3), end: +(w.end + offset).toFixed(3) }));
      words.push(...got);
      onWords?.(got);
    }
    done += win.end - win.start;
    onProgress?.(done / total);
  }
  return { words, device: used, language, languageProb };
}

/** Stop the worker (frees the model's memory). The next call starts a fresh one. */
export function resetWorker() {
  worker?.terminate();
  worker = null;
  workerKey = '';
}
