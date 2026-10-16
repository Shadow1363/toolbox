/*
 * The Audio Cleanup chain as one call (Audio Cleanup and the Auto Editor):
 *   source ─ RNNoise (fully wet) ─ wet/dry mix + gate (gateMix)
 *          ─ OfflineAudioContext: high-pass → EQ biquads → compressor (+ makeup)
 *          ─ measure LUFS → gain to the target (±30 dB) + 5 ms lookahead limiter (normalizeLimit)
 * Each stage only runs when it does something; with everything off the source comes back unchanged.
 *
 *   const { buffer, wet, appliedGain } = await cleanAudio(source, opts, { wet, stale, onProgress, signal });
 *
 * opts (Audio Cleanup's panel ids): nr 'off'|'gate'|'rnnoise', nrMix 0..1, gateDb, gateDepth, gateToo,
 * hpf, hpfFreq, eq (EQ key), comp (COMP key or 'off'), target (TARGETS key, 'custom' or 'off'), custom (LUFS), ceiling (dBFS).
 * wet: RNNoise output for this source. Pass it to reuse a cached run; null skips RNNoise; leave it undefined to compute it.
 * stale(): return true to abandon a run (resolves null).
 */
import { renderOffline } from "./audio-export.js";
import { measureLoudness, gateMix, normalizeLimit, rnnoise } from "./audio-dsp.js";

/** Loudness targets in LUFS. */
export const TARGETS = { podcast: -16, youtube: -14, broadcast: -23, voice: -19 };
export const COMP = {
  light: { threshold: -18, ratio: 2, attack: 0.01, release: 0.25, knee: 8, makeup: 2 },
  medium: { threshold: -24, ratio: 3.5, attack: 0.006, release: 0.18, knee: 6, makeup: 5 },
  heavy: { threshold: -30, ratio: 6, attack: 0.003, release: 0.12, knee: 4, makeup: 9 },
};
/** EQ presets as biquad specs: [type, frequency, gain dB, Q]. */
export const EQ = {
  flat: [],
  voice: [
    ["peaking", 250, -3, 1],
    ["peaking", 3200, 3, 0.9],
    ["highshelf", 10000, 2, 0.7],
  ],
  bass: [["lowshelf", 110, 6, 0.7]],
  treble: [["highshelf", 6000, 5, 0.7]],
  warm: [
    ["lowshelf", 200, 3, 0.7],
    ["highshelf", 8000, -2.5, 0.7],
  ],
  deess: [["peaking", 6500, -4, 2]],
  phone: [
    ["highpass", 350, 0, 0.7],
    ["lowpass", 3400, 0, 0.7],
    ["peaking", 1500, 4, 1],
  ],
};

/** Audio Cleanup's defaults. */
export const CLEAN_DEFAULTS = {
  nr: "rnnoise", nrMix: 0.85, gateDb: -45, gateDepth: 24, gateToo: false,
  hpf: true, hpfFreq: 80, eq: "voice", comp: "light", target: "podcast", custom: -16, ceiling: -1,
};

export async function cleanAudio(source, o, { wet, stale = () => false, onProgress, signal } = {}) {
  o = { ...CLEAN_DEFAULTS, ...o };
  let buf = source;
  // 1. Noise reduction (RNNoise mix and/or gate)
  const gate =
    o.nr === "gate" || (o.nr === "rnnoise" && o.gateToo)
      ? { thresholdDb: o.gateDb, depthDb: o.gateDepth }
      : null;
  let w = null;
  if (o.nr === "rnnoise") {
    w = wet === undefined ? await rnnoise(source, { onProgress, signal }) : wet;
    if (stale()) return null;
  }
  if (w || gate) buf = await gateMix(source, w, o.nrMix, gate, { signal });
  if (stale()) return null;

  // 2. Filters and compressor (offline Web Audio)
  const eq = EQ[o.eq] || [];
  const comp = COMP[o.comp];
  if (o.hpf || eq.length || comp) {
    buf = await renderOffline(buf, (ctx, src) => {
      let node = src;
      const chain = (n) => {
        node.connect(n);
        node = n;
      };
      if (o.hpf)
        chain(new BiquadFilterNode(ctx, { type: "highpass", frequency: o.hpfFreq, Q: 0.707 }));
      for (const [type, frequency, gain, Q] of eq)
        chain(new BiquadFilterNode(ctx, { type, frequency, gain, Q }));
      if (comp) {
        chain(
          new DynamicsCompressorNode(ctx, {
            threshold: comp.threshold,
            ratio: comp.ratio,
            attack: comp.attack,
            release: comp.release,
            knee: comp.knee,
          }),
        );
        chain(new GainNode(ctx, { gain: 10 ** (comp.makeup / 20) }));
      }
      return node;
    });
    if (stale()) return null;
  }

  // 3. Loudness: gain to the target, then the limiter.
  const target = o.target === "custom" ? o.custom : TARGETS[o.target];
  let appliedGain = 0;
  if (target != null) {
    const mid = measureLoudness(buf);
    appliedGain = isFinite(mid.lufs) ? Math.max(-30, Math.min(30, target - mid.lufs)) : 0;
    // Reuse the intermediate buffer as the output when it's ours (saves one copy of the audio).
    buf = await normalizeLimit(buf, appliedGain, o.ceiling, {
      signal,
      target: buf !== source && buf !== w ? buf : null,
    });
    if (stale()) return null;
  }
  return { buffer: buf, wet: w, appliedGain };
}
