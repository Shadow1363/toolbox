/**
 * Animated GIF helpers around gifenc (loaded lazily from jsDelivr).
 *
 *   const lib = await loadGifenc();
 *   const gif = lib.GIFEncoder();
 *   const { index, palette } = quantizeFrame(lib, ctx, w, h);   // after drawing the frame
 *   gif.writeFrame(index, w, h, { palette, delay: gifDelay(ms), repeat: 0 });
 *   gif.finish(); new Blob([gif.bytes()], { type: 'image/gif' });
 */
export const GIFENC_URL = 'https://cdn.jsdelivr.net/npm/gifenc@1.0.3/dist/gifenc.esm.js';

let gifenc;
export const loadGifenc = () =>
  (gifenc ||= import(GIFENC_URL).catch(() => {
    gifenc = null;
    throw new Error('Could not load the GIF encoder. Check your connection.');
  }));

// A 4×4 ordered-dither matrix. GIFs only get 256 colours per frame, so smooth
// gradients (vignettes, blur falloff, fades) would band into rings without it.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => (v / 16 - 0.5) * 10);

/** Dither + quantize what's currently on `ctx` (w×h) into a GIF frame. */
export function quantizeFrame(lib, ctx, w, h) {
  const { data } = ctx.getImageData(0, 0, w, h);
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i += 4) {
      const d = BAYER[((y & 3) << 2) | (x & 3)];
      data[i] += d; data[i + 1] += d; data[i + 2] += d; // Uint8ClampedArray clamps for us
    }
  }
  const palette = lib.quantize(data, 256);
  return { index: lib.applyPalette(data, palette), palette };
}

/** GIF delays are stored in 1/100 s, and browsers slow anything under 20 ms down to 100 ms. */
export const gifDelay = (ms) => Math.max(20, Math.round(ms / 10) * 10);
