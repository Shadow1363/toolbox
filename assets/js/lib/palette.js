/*
 * Colour quantization and colour math, shared by Palette Extractor and Pixel Art (import a palette).
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   const px = samplePixels(img, 200);                 // opaque pixels, downscaled
 *   const colors = kmeans(px, 6, { seed: 1 });         // [{ rgb: [r,g,b], count, share }] biggest first
 *   const colors = medianCut(px, 6);
 *   hex([r,g,b]) · parseHex('#abc') · rgbToHsl · contrastRatio(a, b) · wcag(ratio)
 */
import { rng } from './random.js';

/** Opaque pixels of `source` (anything drawable) as a flat Uint8Array [r,g,b,…], downscaled so the long side ≤ maxSide. */
export function samplePixels(source, maxSide = 200) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const s = Math.min(1, maxSide / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * s)), hh = Math.max(1, Math.round(sh * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(source, 0, 0, w, hh);
  const { data } = x.getImageData(0, 0, w, hh);
  const out = new Uint8Array(w * hh * 3);
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] < 128) continue;
    out[n++] = data[i]; out[n++] = data[i + 1]; out[n++] = data[i + 2];
  }
  return out.subarray(0, n);
}

/* ---------- Lab (perceptual distances for k-means) ---------- */
const lin = (c) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const LIN = Float32Array.from({ length: 256 }, (_, i) => lin(i));
const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
export function rgbToLab(r, g, b) {
  const R = LIN[r], G = LIN[g], B = LIN[b];
  const X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  const Y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  const Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const fy = f(Y);
  return [116 * fy - 16, 500 * (f(X) - fy), 200 * (fy - f(Z))];
}

/**
 * k-means in Lab space with k-means++ seeding (seeded, so the same image gives the same palette).
 * Returns clusters sorted by size, each with the average sRGB colour of its members.
 */
export function kmeans(px, k, { seed = 1, iterations = 12 } = {}) {
  const n = px.length / 3;
  if (!n) return [];
  k = Math.max(1, Math.min(k, n));
  const lab = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) lab.set(rgbToLab(px[i * 3], px[i * 3 + 1], px[i * 3 + 2]), i * 3);
  const rand = rng(seed);
  const d2 = (i, c, cs) => { const a = lab[i * 3] - cs[c * 3], b = lab[i * 3 + 1] - cs[c * 3 + 1], d = lab[i * 3 + 2] - cs[c * 3 + 2]; return a * a + b * b + d * d; };

  // k-means++: each new centre is picked with probability ∝ squared distance to the nearest one.
  const cs = new Float32Array(k * 3);
  const first = Math.floor(rand() * n);
  cs.set(lab.subarray(first * 3, first * 3 + 3), 0);
  const near = new Float32Array(n).fill(Infinity);
  for (let c = 1; c < k; c++) {
    let sum = 0;
    for (let i = 0; i < n; i++) { near[i] = Math.min(near[i], d2(i, c - 1, cs)); sum += near[i]; }
    let r = rand() * sum, pick = n - 1;
    for (let i = 0; i < n; i++) { r -= near[i]; if (r <= 0) { pick = i; break; } }
    cs.set(lab.subarray(pick * 3, pick * 3 + 3), c * 3);
  }

  const assign = new Uint16Array(n);
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      let best = 0, bd = Infinity;
      for (let c = 0; c < k; c++) { const d = d2(i, c, cs); if (d < bd) { bd = d; best = c; } }
      if (assign[i] !== best || it === 0) { moved++; assign[i] = best; }
    }
    const sums = new Float64Array(k * 3), counts = new Uint32Array(k);
    for (let i = 0; i < n; i++) { const c = assign[i]; counts[c]++; sums[c * 3] += lab[i * 3]; sums[c * 3 + 1] += lab[i * 3 + 1]; sums[c * 3 + 2] += lab[i * 3 + 2]; }
    for (let c = 0; c < k; c++) if (counts[c]) for (let j = 0; j < 3; j++) cs[c * 3 + j] = sums[c * 3 + j] / counts[c];
    if (it > 0 && moved < n * 0.002) break;
  }
  return summarize(px, assign, k);
}

/** Median cut: split the box with the widest channel range at its median until there are k boxes. */
export function medianCut(px, k) {
  const n = px.length / 3;
  if (!n) return [];
  let boxes = [Uint32Array.from({ length: n }, (_, i) => i)];
  const range = (idx) => {
    const lo = [255, 255, 255], hi = [0, 0, 0];
    for (const i of idx) for (let j = 0; j < 3; j++) { const v = px[i * 3 + j]; if (v < lo[j]) lo[j] = v; if (v > hi[j]) hi[j] = v; }
    const r = hi.map((v, j) => v - lo[j]);
    const ch = r.indexOf(Math.max(...r));
    return { ch, span: r[ch] };
  };
  while (boxes.length < k) {
    // Split the box with the largest (span × population), so big, varied regions split first.
    let best = -1, bestScore = 0, info;
    boxes.forEach((b, i) => { if (b.length < 2) return; const r = range(b); const s = r.span * b.length; if (s > bestScore) { bestScore = s; best = i; info = r; } });
    if (best < 0) break;
    const b = boxes[best];
    const sorted = Uint32Array.from(b).sort((x, y) => px[x * 3 + info.ch] - px[y * 3 + info.ch]);
    const mid = sorted.length >> 1;
    boxes.splice(best, 1, sorted.subarray(0, mid), sorted.subarray(mid));
  }
  const assign = new Uint16Array(n);
  boxes.forEach((b, c) => { for (const i of b) assign[i] = c; });
  return summarize(px, assign, boxes.length);
}

function summarize(px, assign, k) {
  const n = px.length / 3;
  const sums = new Float64Array(k * 3), counts = new Uint32Array(k);
  for (let i = 0; i < n; i++) { const c = assign[i]; counts[c]++; for (let j = 0; j < 3; j++) sums[c * 3 + j] += px[i * 3 + j]; }
  const out = [];
  for (let c = 0; c < k; c++) {
    if (!counts[c]) continue;
    out.push({ rgb: [0, 1, 2].map((j) => Math.round(sums[c * 3 + j] / counts[c])), count: counts[c], share: counts[c] / n });
  }
  return out.sort((a, b) => b.count - a.count);
}

/* ---------- Colour math ---------- */
export const hex = ([r, g, b]) => `#${[r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

export function parseHex(s) {
  let v = String(s).trim().replace(/^#/, '');
  if (/^[0-9a-f]{3,4}$/i.test(v)) v = v.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return null;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

export function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [Math.round(hue * 60), Math.round(s * 100), Math.round(l * 100)];
}

/** WCAG 2 relative luminance. */
export const luminance = ([r, g, b]) => 0.2126 * LIN[r] + 0.7152 * LIN[g] + 0.0722 * LIN[b];
export function contrastRatio(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}
/** WCAG level for a ratio: 'AAA' (7), 'AA' (4.5), 'AA large' (3) or 'Fail'. */
export const wcag = (ratio) => (ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail');

/** Black or white, whichever reads better on `rgb`. */
export const readableOn = (rgb) => (contrastRatio(rgb, [0, 0, 0]) >= contrastRatio(rgb, [255, 255, 255]) ? '#000000' : '#ffffff');
