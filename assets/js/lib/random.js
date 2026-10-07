/** Deterministic randomness, so effects look identical in preview and export. */

/** Mulberry32 PRNG: returns a function producing floats in [0,1). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Hash a few integers into a float in [0,1). */
export function hash(...n) {
  let h = 2166136261;
  for (const v of n) { h ^= v | 0; h = Math.imul(h, 16777619); h ^= h >>> 13; }
  return rng(h)();
}

/** 1D smooth value noise in [-1,1]. */
export function noise1(x, seed = 0) {
  const i = Math.floor(x), f = x - i;
  const u = f * f * (3 - 2 * f);
  const a = hash(i, seed) * 2 - 1, b = hash(i + 1, seed) * 2 - 1;
  return a + (b - a) * u;
}

/** Fractal (multi-octave) 1D noise in roughly [-1,1]. */
export function fbm1(x, seed = 0, octaves = 4) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * noise1(x * freq, seed + o * 101); norm += amp; amp *= 0.5; freq *= 2; }
  return sum / norm;
}
