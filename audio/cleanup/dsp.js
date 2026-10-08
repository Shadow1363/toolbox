/*
 * Noise Reduction + Volume Normalizer: sample-level processing (loudness, gate, limiter, RNNoise).

 *
 *   measureLoudness(buffer)                            → { lufs, peakDb }  integrated loudness (BS.1770-4 gating) + sample peak
 *   await gateMix(dry, wet, mix, gate, { signal })     → AudioBuffer      wet/dry mix, then an optional noise gate
 *   await normalizeLimit(buffer, gainDb, ceilingDb)    → AudioBuffer      gain + 5 ms lookahead peak limiter
 *   await rnnoise(buffer, { onProgress, signal })      → AudioBuffer      RNNoise (WASM) at 48 kHz, delay-compensated
 *
 * Everything streams over the samples with small state (no per-sample side arrays), so long files only cost
 * the output buffer. Long loops yield to the event loop every ~1M samples.
 */
import { loadLib, LIBS } from "/assets/js/lib/cdn.js";
import { resample } from "/assets/js/lib/audio-io.js";
import { makeBuffer } from "/assets/js/lib/audio-export.js";

const YIELD = 1 << 20;
const tick = () => new Promise((r) => setTimeout(r));
export const dbToLin = (db) => 10 ** (db / 20);
export const linToDb = (v) => (v > 0 ? 20 * Math.log10(v) : -Infinity);
const cancelled = (signal) => {
  if (signal?.aborted) throw new DOMException("Cancelled", "AbortError");
};

/* ---------- Loudness (ITU-R BS.1770-4 / EBU R128) ---------- */

/** K-weighting biquads for sample rate `fs` (pre-filter high shelf + RLB high-pass), as in libebur128. */
function kWeights(fs) {
  let f0 = 1681.974450955533,
    Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / fs);
  const Vh = 10 ** (3.999843853973347 / 20),
    Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf = [
    (Vh + (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - Vh)) / a0,
    (Vh - (Vb * K) / Q + K * K) / a0,
    (2 * (K * K - 1)) / a0,
    (1 - K / Q + K * K) / a0,
  ];
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / fs);
  a0 = 1 + K / Q + K * K;
  const hp = [1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0];
  return [shelf, hp];
}

/** Channel weights: 1 for L/R/C, 1.41 for surrounds (5.1 order L R C LFE Ls Rs; LFE ignored). */
const channelWeight = (c, n) => (n === 6 ? [1, 1, 1, 0, 1.41, 1.41][c] : 1);

/** Integrated loudness (LUFS, −Infinity for silence) with the −70 LUFS and −10 LU gates, plus the sample peak (dBFS). */
export function measureLoudness(buffer) {
  const fs = buffer.sampleRate,
    chs = buffer.numberOfChannels;
  const step = Math.round(fs * 0.1); // 100 ms; a block is 4 steps (400 ms, 75% overlap)
  const steps = Math.floor(buffer.length / step);
  const energy = new Float64Array(steps);
  const [[a, b, c, d, e], [p, q, r, u, v]] = kWeights(fs);
  let peak = 0;
  for (let ch = 0; ch < chs; ch++) {
    const w = channelWeight(ch, chs);
    if (!w) continue;
    const data = buffer.getChannelData(ch);
    let x1 = 0,
      x2 = 0,
      y1 = 0,
      y2 = 0,
      z1 = 0,
      z2 = 0;
    for (let s = 0; s < steps; s++) {
      let sum = 0;
      for (let i = s * step, end = i + step; i < end; i++) {
        const x = data[i];
        const ax = x < 0 ? -x : x;
        if (ax > peak) peak = ax;
        const y = a * x + b * x1 + c * x2 - d * y1 - e * y2; // high shelf
        const z = p * y + q * y1 + r * y2 - u * z1 - v * z2; // high-pass (input = shelf output)
        x2 = x1;
        x1 = x;
        y2 = y1;
        y1 = y;
        z2 = z1;
        z1 = z;
        sum += z * z;
      }
      energy[s] += sum * w;
    }
  }
  const blocks = [];
  const norm = 1 / (step * 4);
  for (let s = 0; s + 4 <= steps; s++)
    blocks.push(
      (energy[s] + energy[s + 1] + energy[s + 2] + energy[s + 3]) * norm,
    );
  const lk = (z) => -0.691 + 10 * Math.log10(z);
  const abs = blocks.filter((z) => z > 0 && lk(z) > -70);
  let lufs = -Infinity;
  if (abs.length) {
    const rel = lk(abs.reduce((x, y) => x + y, 0) / abs.length) - 10;
    const gated = abs.filter((z) => lk(z) > rel);
    if (gated.length)
      lufs = lk(gated.reduce((x, y) => x + y, 0) / gated.length);
  }
  return { lufs, peakDb: linToDb(peak) };
}

/* ---------- Wet/dry mix + noise gate ---------- */

/**
 * `dry` mixed with `wet` (same length/rate; wet may be null) at `mix` 0..1, then an optional gate:
 * gate = { thresholdDb, depthDb } — below the threshold the level drops by depthDb (2 ms attack, 40 ms hold, 120 ms release).
 */
export async function gateMix(dry, wet, mix, gate, { signal } = {}) {
  const n = dry.length,
    chs = dry.numberOfChannels,
    fs = dry.sampleRate;
  const out = makeBuffer(chs, n, fs);
  const ins = Array.from({ length: chs }, (_, c) => dry.getChannelData(c));
  const wets = wet
    ? Array.from({ length: chs }, (_, c) =>
        wet.getChannelData(Math.min(c, wet.numberOfChannels - 1)),
      )
    : null;
  const outs = Array.from({ length: chs }, (_, c) => out.getChannelData(c));
  const m = wets ? Math.max(0, Math.min(1, mix)) : 0;
  const thr = gate ? dbToLin(gate.thresholdDb) ** 2 : 0;
  const floor = gate ? dbToLin(-Math.abs(gate.depthDb)) : 1;
  const envK = 1 - Math.exp(-1 / (0.01 * fs)); // 10 ms RMS detector
  const att = 1 - Math.exp(-1 / (0.002 * fs));
  const rel = 1 - Math.exp(-1 / (0.12 * fs));
  const hold = Math.round(0.04 * fs);
  let env = 0,
    g = gate ? floor : 1,
    held = 0;
  for (let i = 0; i < n; i++) {
    let pw = 0;
    for (let c = 0; c < chs; c++) {
      const x = wets ? ins[c][i] * (1 - m) + wets[c][i] * m : ins[c][i];
      outs[c][i] = x;
      if (x * x > pw) pw = x * x;
    }
    if (gate) {
      env += (pw - env) * envK;
      if (env > thr) held = hold;
      const target = held > 0 ? 1 : floor;
      if (held > 0) held--;
      g += (target - g) * (target > g ? att : rel);
      for (let c = 0; c < chs; c++) outs[c][i] *= g;
    }
    if ((i & (YIELD - 1)) === 0 && i) {
      cancelled(signal);
      await tick();
    }
  }
  return out;
}

/* ---------- Gain + lookahead limiter ---------- */

/**
 * Apply `gainDb`, then keep every sample under `ceilingDb` with a 5 ms lookahead limiter: the needed gain is
 * min-filtered over the next 5 ms (monotonic deque), averaged over the last 5 ms (smooth attack that still reaches
 * the full reduction at the peak) and released over 80 ms.
 */
export async function normalizeLimit(
  buffer,
  gainDb,
  ceilingDb,
  { signal, target } = {},
) {
  const n = buffer.length,
    chs = buffer.numberOfChannels,
    fs = buffer.sampleRate;
  const out = target || makeBuffer(chs, n, fs);
  const ins = Array.from({ length: chs }, (_, c) => buffer.getChannelData(c));
  const outs = Array.from({ length: chs }, (_, c) => out.getChannelData(c));
  const G = dbToLin(gainDb),
    C = dbToLin(ceilingDb);
  const L = Math.max(1, Math.round(0.005 * fs));
  const rel = 1 - Math.exp(-1 / (0.08 * fs));
  const need = (k) => {
    if (k >= n) return 1;
    let pk = 0;
    for (let c = 0; c < chs; c++) {
      const v = ins[c][k] < 0 ? -ins[c][k] : ins[c][k];
      if (v > pk) pk = v;
    }
    pk *= G;
    return pk > C ? C / pk : 1;
  };
  // Deque of (index, value), increasing values, for the window [j, j + L].
  const cap = L + 2;
  const dqI = new Int32Array(cap),
    dqV = new Float32Array(cap);
  let head = 0,
    len = 0;
  const push = (k) => {
    const val = need(k);
    while (len && dqV[(head + len - 1) % cap] >= val) len--;
    dqI[(head + len) % cap] = k;
    dqV[(head + len) % cap] = val;
    len++;
  };
  for (let k = 0; k < L; k++) push(k);
  const ring = new Float32Array(L).fill(1);
  let sum = L,
    r = 1;
  for (let j = 0; j < n; j++) {
    push(j + L);
    while (dqI[head] < j) {
      head = (head + 1) % cap;
      len--;
    }
    const mval = dqV[head];
    sum += mval - ring[j % L];
    ring[j % L] = mval;
    const avg = Math.min(1, sum / L);
    r = Math.min(avg, r + (1 - r) * rel);
    const gj = G * r;
    for (let c = 0; c < chs; c++) {
      const y = ins[c][j] * gj;
      outs[c][j] = y > C ? C : y < -C ? -C : y;
    }
    if ((j & (YIELD - 1)) === 0 && j) {
      cancelled(signal);
      await tick();
    }
  }
  return out;
}

/* ---------- RNNoise ---------- */

let rnn = null;
async function loadRnnoise() {
  if (!rnn) {
    rnn = (async () => {
      const mod = await loadLib("rnnoise");
      const create = mod.default || mod.createRNNWasmModule;
      return create({ locateFile: () => LIBS.rnnoiseWasm.url });
    })();
    rnn.catch(() => {
      rnn = null;
    });
  }
  try {
    return await rnn;
  } catch (err) {
    console.error(err);
    throw new Error(
      "Couldn’t load the noise reduction engine (RNNoise). Check your connection or content blocker.",
    );
  }
}

const FRAME = 480; // 10 ms at 48 kHz

/**
 * Denoise every channel with RNNoise (fully wet). The model runs at 48 kHz on int16-scaled floats; the buffer is
 * resampled there and back. RNNoise delays its output by about one frame, so the lag is measured (cross-correlation
 * on the loudest second) and removed, keeping the wet signal aligned for wet/dry mixing.
 */
export async function rnnoise(buffer, { onProgress, signal } = {}) {
  const M = await loadRnnoise();
  const src = await resample(buffer, 48000);
  const chs = src.numberOfChannels,
    n = src.length;
  const out = makeBuffer(chs, n, 48000);
  const inPtr = M._malloc(FRAME * 4),
    outPtr = M._malloc(FRAME * 4);
  const frames = Math.ceil(n / FRAME);
  const total = frames * chs;
  try {
    for (let c = 0; c < chs; c++) {
      const st = M._rnnoise_create(0);
      const x = src.getChannelData(c),
        y = out.getChannelData(c);
      const frame = new Float32Array(FRAME);
      for (let f = 0; f < frames; f++) {
        const at = f * FRAME;
        frame.fill(0);
        for (let i = 0; i < FRAME && at + i < n; i++)
          frame[i] = x[at + i] * 32768;
        M.HEAPF32.set(frame, inPtr >> 2);
        M._rnnoise_process_frame(st, outPtr, inPtr);
        const res = M.HEAPF32.subarray(outPtr >> 2, (outPtr >> 2) + FRAME);
        for (let i = 0; i < FRAME && at + i < n; i++)
          y[at + i] = res[i] / 32768;
        if ((f & 511) === 0) {
          onProgress?.((c * frames + f) / total);
          cancelled(signal);
          await tick();
        }
      }
      M._rnnoise_destroy(st);
    }
  } finally {
    M._free(inPtr);
    M._free(outPtr);
  }
  const lag = measureLag(src, out);
  if (lag > 0) {
    for (let c = 0; c < chs; c++) {
      const y = out.getChannelData(c);
      y.copyWithin(0, lag);
      y.fill(0, n - lag);
    }
  }
  onProgress?.(1);
  return resample(out, buffer.sampleRate);
}

/** Samples by which `b` trails `a` (0..2 frames), from the loudest second of channel 0. */
function measureLag(a, b) {
  const x = a.getChannelData(0),
    y = b.getChannelData(0);
  const sec = 48000;
  let best = 0,
    bestE = -1;
  for (let s = 0; s + sec <= x.length; s += sec) {
    let e = 0;
    for (let i = s; i < s + sec; i += 16) e += x[i] * x[i];
    if (e > bestE) {
      bestE = e;
      best = s;
    }
  }
  const len = Math.min(sec, x.length - best);
  let lag = 0,
    top = -Infinity;
  for (let k = 0; k <= FRAME * 2; k += 1) {
    let dot = 0;
    for (let i = best; i < best + len - k; i += 4) dot += x[i] * y[i + k];
    if (dot > top) {
      top = dot;
      lag = k;
    }
  }
  return lag;
}
