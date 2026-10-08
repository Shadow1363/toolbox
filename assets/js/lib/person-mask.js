/**
 * Person mask pipeline on top of `segmentFrame` (vision.js):
 *   raw confidence mask → temporal smoothing → threshold/softness (smoothstep) → polarity
 *   → small alpha canvas → upscaled + feathered full-size alpha canvas.
 *
 *   const mask = createPersonMask('my-tool');
 *   if (mask.update(segmenter, video, t, { model, smoothing, still })) {
 *     const alpha = mask.full(W, H, { threshold, softness, polarity, feather: px });
 *     drawPersonCutout(ctx, video, alpha);   // person on top of whatever ctx holds
 *   }
 *
 * Temporal smoothing depends on frame order; pass smoothing 0 when preview and
 * export must match frame for frame (e.g. GIF frames seeked out of playback order).
 */
import { segmentFrame, looksLikePerson } from './vision.js';
import { smoothstep } from './easing.js';
import { scratch, supportsCanvasFilter } from './canvas.js';

export function createPersonMask(prefix) {
  const m = {
    raw: null,        // latest raw mask from the model
    prev: null,       // smoothed mask (Float32Array)
    time: -1,         // media time of `raw`
    polarity: null,   // auto-detected: true = mask marks the person; null = not sure yet (treated as normal)
    reset() { m.raw = null; m.prev = null; m.time = -1; m.polarity = null; },

    /** Run the model if the frame changed. Returns true when a mask is available. */
    update(segmenter, source, t, { model, smoothing = 0, still = false }) {
      if (!segmenter) return false;
      if (m.raw && (still || Math.abs(t - m.time) < 1e-4)) return true;
      let res;
      try { res = segmentFrame(segmenter, source, model); } catch (err) { console.error(err); return !!m.raw; }
      if (!res) return !!m.raw;
      if (Math.abs(t - m.time) > 0.5) m.prev = null; // jumped: don't smooth across the seek
      m.raw = res;
      m.time = t;
      if (m.polarity == null) m.polarity = looksLikePerson(res); // stays null until a frame clearly shows a person
      if (m.prev && m.prev.length === res.data.length && smoothing > 0) {
        for (let i = 0; i < res.data.length; i++) m.prev[i] = m.prev[i] * smoothing + res.data[i] * (1 - smoothing);
      } else m.prev = res.data.slice();
      return true;
    },

    /** The mask at model resolution as an alpha canvas. polarity: 'auto' | 'normal' | 'invert'. */
    small({ threshold = 0.5, softness = 0.2, polarity = 'auto' } = {}) {
      const { width, height } = m.raw;
      const c = scratch(`${prefix}-mask`, width, height);
      const mctx = c.getContext('2d');
      const img = mctx.createImageData(width, height);
      const invert = polarity === 'invert' || (polarity === 'auto' && m.polarity === false);
      const lo = threshold - softness / 2, hi = threshold + softness / 2;
      const d = m.prev || m.raw.data; // prev is cleared when a tool resets smoothing (e.g. before an export)
      for (let i = 0, j = 0; i < d.length; i++, j += 4) {
        const v = invert ? 1 - d[i] : d[i];
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
        img.data[j + 3] = smoothstep(lo, hi, v) * 255;
      }
      mctx.putImageData(img, 0, 0);
      return c;
    },

    /** The mask upscaled to W×H with an optional feather (px, canvas filter only). */
    full(W, H, { feather = 0, ...edge } = {}) {
      const small = m.small(edge);
      const c = scratch(`${prefix}-mask-full`, W, H);
      const fctx = c.getContext('2d');
      fctx.clearRect(0, 0, W, H);
      fctx.imageSmoothingEnabled = true;
      fctx.imageSmoothingQuality = 'high';
      if (feather > 0 && supportsCanvasFilter) fctx.filter = `blur(${feather}px)`;
      fctx.drawImage(small, 0, 0, W, H);
      fctx.filter = 'none';
      return c;
    },
  };
  return m;
}

/** Draw `source` cut out by `alpha` (a full-size mask canvas) on top of ctx. */
export function drawPersonCutout(ctx, source, alpha, name = 'person-cutout') {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const person = scratch(`${name}-${W}x${H}`, W, H);
  const pctx = person.getContext('2d');
  pctx.globalCompositeOperation = 'source-over';
  pctx.clearRect(0, 0, W, H);
  pctx.drawImage(source, 0, 0, W, H);
  pctx.globalCompositeOperation = 'destination-in';
  pctx.drawImage(alpha, 0, 0);
  pctx.globalCompositeOperation = 'source-over';
  ctx.drawImage(person, 0, 0);
}
