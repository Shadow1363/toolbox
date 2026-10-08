/*
 * Speed Ramp: the speed curve and the time maps built from it.

 *
 *   points = [{ x, v }]   x = source time (s), v = log2(speed): -2 = 0.25×, 0 = 1×, 2 = 4×
 *   speedAt(points, x, smooth)  → speed (×) at source time x
 *   const map = buildMap(points, duration, smooth)
 *   map.duration                → output length (s)
 *   map.srcAt(tau)              → source time shown at output time tau
 *   map.outAt(x)                → output time at which source time x is shown
 *
 * Between points the speed eases in log space (smoothstep), so 0.5× → 2× feels symmetric.
 * Output time is the integral of 1 / speed over source time, sampled finely and inverted by search.
 */
import { smoothstep } from "/assets/js/lib/easing.js";

export const MIN_V = -2,
  MAX_V = 2; // 0.25× … 4×

export function logSpeedAt(points, x, smooth = true) {
  if (!points.length) return 0;
  if (x <= points[0].x) return points[0].v;
  const last = points[points.length - 1];
  if (x >= last.x) return last.v;
  let i = 0;
  while (i < points.length - 2 && points[i + 1].x <= x) i++;
  const a = points[i],
    b = points[i + 1];
  const u = (x - a.x) / Math.max(1e-9, b.x - a.x);
  return a.v + (b.v - a.v) * (smooth ? smoothstep(0, 1, u) : u);
}

export const speedAt = (points, x, smooth) =>
  2 ** logSpeedAt(points, x, smooth);

export function buildMap(points, duration, smooth = true) {
  const n = Math.max(200, Math.min(20000, Math.ceil(duration * 240)));
  const xs = new Float64Array(n + 1);
  const ts = new Float64Array(n + 1);
  const dx = duration / n;
  let t = 0;
  for (let i = 0; i <= n; i++) {
    const x = i * dx;
    xs[i] = x;
    ts[i] = t;
    // midpoint rule for ∫ dx / speed
    t += dx / speedAt(points, x + dx / 2, smooth);
  }
  const total = ts[n];
  const search = (arr, val) => {
    let lo = 0,
      hi = n;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= val) lo = mid;
      else hi = mid;
    }
    return lo;
  };
  return {
    duration: total,
    srcAt(tau) {
      if (tau <= 0) return 0;
      if (tau >= total) return duration;
      const i = search(ts, tau);
      const f = (tau - ts[i]) / Math.max(1e-12, ts[i + 1] - ts[i]);
      return xs[i] + f * dx;
    },
    outAt(x) {
      if (x <= 0) return 0;
      if (x >= duration) return total;
      const i = Math.min(n - 1, Math.floor(x / dx));
      return ts[i] + ((x - xs[i]) / dx) * (ts[i + 1] - ts[i]);
    },
  };
}

/** Presets as fractions of the clip: [[x fraction, speed ×], ...]. */
export const PRESETS = [
  {
    label: "Slow-mo hit",
    value: "hit",
    points: [
      [0, 1],
      [0.36, 1],
      [0.45, 0.25],
      [0.55, 0.25],
      [0.64, 1],
      [1, 1],
    ],
  },
  {
    label: "Fast-forward middle",
    value: "ff",
    points: [
      [0, 1],
      [0.22, 1],
      [0.32, 4],
      [0.68, 4],
      [0.78, 1],
      [1, 1],
    ],
  },
  {
    label: "Speed up, then slow down",
    value: "upDown",
    points: [
      [0, 1],
      [0.45, 3],
      [0.8, 0.4],
      [1, 0.4],
    ],
  },
  {
    label: "Ease into slow-mo",
    value: "easeSlow",
    points: [
      [0, 1],
      [0.6, 0.3],
      [1, 0.3],
    ],
  },
  {
    label: "Reset (1×)",
    value: "reset",
    points: [
      [0, 1],
      [1, 1],
    ],
  },
];

export const presetPoints = (preset, duration) =>
  preset.points.map(([f, sp]) => ({ x: f * duration, v: Math.log2(sp) }));

export const formatSpeed = (sp) => `${+sp.toFixed(2)}×`;
