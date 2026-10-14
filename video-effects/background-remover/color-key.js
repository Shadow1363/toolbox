/**
 * Color key: keep everything that isn't close to one color. Made for text, logos, scans and
 * flat studio backgrounds, where a model guesses but a color is exact.
 *
 *   const m = colorKey(source, { color: '#ffffff', tolerance: 20, softness: 10, edgesOnly: false }, 1536);
 *   // { data: Float32Array (1 = keep), width, height }, the same shape as a model mask
 *
 * Distance is RGB distance weighted toward how eyes see it ("redmean"), scaled to 0..1.
 * edgesOnly keys out only the background connected to the frame border (flood fill), so
 * the same color inside the subject (white letters, a white shirt) survives.
 */
import { scratch } from '/assets/js/lib/canvas.js';
import { parseHex } from '/assets/js/lib/palette.js';
import { smoothstep } from '/assets/js/lib/easing.js';

const MAX_DIST = Math.sqrt((2 + 128 / 256) * 255 ** 2 + 4 * 255 ** 2 + (2 + 127 / 256) * 255 ** 2);

export function colorKey(source, { color, tolerance, softness, edgesOnly }, maxSide) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const k = Math.min(1, maxSide / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * k)), height = Math.max(1, Math.round(sh * k));
  const c = scratch(`bgr-key-src-${width}x${height}`, width, height);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.clearRect(0, 0, width, height);
  x.drawImage(source, 0, 0, width, height);
  const px = x.getImageData(0, 0, width, height).data;

  const [kr, kg, kb] = parseHex(color) || [255, 255, 255];
  const t = (tolerance / 100) * 0.6, s = Math.max(0.005, (softness / 100) * 0.3);
  const lo = t - s / 2, hi = t + s / 2;
  const n = width * height;
  const data = new Float32Array(n);
  for (let i = 0, j = 0; i < n; i++, j += 4) {
    if (px[j + 3] < 8) { data[i] = 0; continue; } // already transparent
    const rm = (px[j] + kr) / 2;
    const dr = px[j] - kr, dg = px[j + 1] - kg, db = px[j + 2] - kb;
    const d = Math.sqrt((2 + rm / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rm) / 256) * db * db) / MAX_DIST;
    data[i] = smoothstep(lo, hi, d);
  }
  if (edgesOnly) keepEnclosed(data, width, height);
  return { data, width, height };
}

/** Pixels the border flood fill can't reach (through keyed pixels) are kept fully. */
function keepEnclosed(data, w, h) {
  const reached = new Uint8Array(w * h);
  const stack = new Int32Array(w * h);
  let top = 0;
  const seed = (i) => { if (!reached[i] && data[i] < 0.5) { reached[i] = 1; stack[top++] = i; } };
  for (let x = 0; x < w; x++) { seed(x); seed((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { seed(y * w); seed(y * w + w - 1); }
  while (top) {
    const i = stack[--top], x = i % w;
    if (x > 0) seed(i - 1);
    if (x < w - 1) seed(i + 1);
    if (i >= w) seed(i - w);
    if (i < w * (h - 1)) seed(i + w);
  }
  for (let i = 0; i < data.length; i++) if (!reached[i]) data[i] = 1;
}
