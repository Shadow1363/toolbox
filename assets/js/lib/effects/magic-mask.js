/*
 * Magic mask transition: across a cut, the person from the outgoing shot (A) stays on top while a wipe reveals the
 * incoming shot (B) behind them (Magic Mask tool's wipe.js), then they fade out. People only: MediaPipe segmentation
 * of env.A each frame (the Auto Editor has no clicks; object masks stay in the Magic Mask tool).
 * env.A / env.B are output-size canvases (outgoing / incoming frame); env.local = seconds into the transition.
 */
import { wipeGeometry, drawRemain, drawEdgeGlow } from '/video-effects/magic-mask/wipe.js';
import { loadSegmenter } from '../vision.js';
import { createPersonMask, drawPersonCutout } from '../person-mask.js';
import { scratch } from '../canvas.js';
import { ease, easingOptions, clamp } from '../easing.js';

const MODEL = 'landscape';
let segmenter = null;
const mask = createPersonMask('fx-mm');

/** Centre of the person in the raw mask (0..1), or null. */
function centre(raw) {
  if (!raw) return null;
  const { data, width, height } = raw;
  let a = 0, sx = 0, sy = 0;
  for (let y = 0; y < height; y += 2) for (let x = 0; x < width; x += 2) {
    const v = data[y * width + x];
    if (v < 0.5) continue;
    a += v; sx += x * v; sy += y * v;
  }
  return a ? { x: sx / a / width, y: sy / a / height } : null;
}

export default {
  id: 'magic-mask',
  name: 'Magic mask transition',
  description: 'A wipe to the next shot that passes behind the speaker: they stay on top while the new scene appears around them, then fade out.',
  kind: 'transition',
  params: [
    { id: 'duration', type: 'range', label: 'Duration', min: 0.3, max: 2, step: 0.05, value: 0.9, unit: 's' },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions },
    { id: 'wipe', type: 'segmented', label: 'Shape', value: 'line', options: [['line', 'Straight edge'], ['iris', 'Circle']] },
    { id: 'angle', type: 'range', label: 'Direction', min: 0, max: 359, value: 35, unit: '°' },
    { id: 'follow', type: 'range', label: 'Follow the person', min: 0, max: 1, step: 0.05, value: 0.4 },
    { id: 'feather', type: 'range', label: 'Edge feather', min: 0, max: 200, value: 30, unit: 'px' },
    { id: 'glow', type: 'toggle', label: 'Glowing edge', value: false },
    { id: 'exit', type: 'segmented', label: 'Person exit', value: 'fade', options: [['fade', 'Fade'], ['cut', 'Cut']] },
  ],
  ai: {
    params: ['duration', 'wipe', 'angle'],
    hint: 'A stylish cut between two shots of the same person (location or outfit change). Use at most once or twice per video.',
  },
  async prepare() {
    segmenter ||= await loadSegmenter(MODEL);
  },
  render(ctx, frame, t, p, env) {
    const W = ctx.canvas.width, H = ctx.canvas.height, k = Math.min(W, H) / 1080;
    const raw = clamp((env.local ?? 0) / p.duration);
    const pe = ease(p.easing, Math.min(1, raw / 0.8)); // the wipe takes the first 80%, the person leaves in the rest
    const has = segmenter && mask.update(segmenter, env.A, t, { model: MODEL });
    const geo = wipeGeometry({ kind: p.wipe, angle: p.angle, p: pe, W, H, subject: has ? centre(mask.raw) : null, follow: p.follow });
    ctx.drawImage(env.B, 0, 0, W, H);
    const mid = scratch(`fx-mm-mid-${W}x${H}`, W, H), mx = mid.getContext('2d');
    mx.globalCompositeOperation = 'source-over';
    drawRemain(mx, geo, p.feather * k);
    mx.globalCompositeOperation = 'source-in';
    mx.drawImage(env.A, 0, 0, W, H);
    mx.globalCompositeOperation = 'source-over';
    ctx.drawImage(mid, 0, 0);
    if (p.glow && raw < 0.8) drawEdgeGlow(ctx, geo, { k });
    const top = p.exit === 'cut' ? (raw < 0.8 ? 1 : 0) : 1 - clamp((raw - 0.8) / 0.2);
    if (has && top > 0) {
      ctx.save();
      ctx.globalAlpha = top;
      drawPersonCutout(ctx, env.A, mask.full(W, H, { threshold: 0.5, softness: 0.2, polarity: 'auto', feather: 2 * k }), 'fx-mm-cut');
      ctx.restore();
    }
  },
};
