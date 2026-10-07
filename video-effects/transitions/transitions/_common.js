/**
 * Shared bits for transition files: parameter builders, uniform helpers and
 * Canvas 2D fallback helpers. See ../AGENTS.md ("Add a transition") for the interface.
 */
import { scratch, drawBlurred } from '/assets/js/lib/canvas.js';

/* ---------- Params (createControls specs) ---------- */
export const DIRS = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };

export const direction = (value = 'left', label = 'Direction') => ({
  id: 'direction', type: 'segmented', label, value,
  options: [['left', '←'], ['right', '→'], ['up', '↑'], ['down', '↓']],
});
export const axis = (value = 'horizontal') => ({
  id: 'axis', type: 'segmented', label: 'Axis', value, options: [['horizontal', 'Horizontal'], ['vertical', 'Vertical']],
});
export const range = (id, label, min, max, value, step = 0.01, unit = '') => ({ id, type: 'range', label, min, max, step, value, unit });
export const percent = (id, label, value = 0.5) => ({
  id, type: 'range', label, min: 0, max: 1, step: 0.01, value, format: (v) => `${Math.round(v * 100)}%`,
});
export const seed = () => ({ id: 'seed', type: 'range', label: 'Seed', min: 1, max: 99, step: 1, value: 7 });

/** Defaults object from a params list. */
export const defaultsOf = (params) => Object.fromEntries(params.filter((c) => c.id).map((c) => [c.id, c.value]));

/* ---------- Uniform helpers ---------- */
export const dirVec = (d) => DIRS[d] || DIRS.left;
export function rgb(hex) {
  const n = parseInt(String(hex).replace('#', ''), 16) || 0;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

/* ---------- Canvas 2D fallback helpers ---------- */
/** Draw src (a W×H frame) scaled by s around (cx, cy) in 0–1 units, optionally offset/rotated/blurred. */
export function drawFrame(ctx, src, { s = 1, cx = 0.5, cy = 0.5, dx = 0, dy = 0, rot = 0, alpha = 1, blur = 0 } = {}) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(cx * W + dx * W, cy * H + dy * H);
  ctx.rotate(rot);
  ctx.scale(s, s);
  ctx.translate(-cx * W, -cy * H);
  if (blur > 0.5) drawBlurred(ctx, src, 0, 0, W, H, blur);
  else ctx.drawImage(src, 0, 0, W, H);
  ctx.restore();
}

/** Draw src through a mask canvas (mask alpha) onto ctx. */
export function drawMasked(ctx, src, mask, alpha = 1) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const tmp = scratch(`tr-masked-${W}x${H}`, W, H);
  const t = tmp.getContext('2d');
  t.globalCompositeOperation = 'copy';
  t.drawImage(src, 0, 0, W, H);
  t.globalCompositeOperation = 'destination-in';
  t.drawImage(mask, 0, 0, W, H);
  t.globalCompositeOperation = 'source-over';
  ctx.save(); ctx.globalAlpha = alpha; ctx.drawImage(tmp, 0, 0); ctx.restore();
}

export function fillAll(ctx, color, alpha = 1) {
  ctx.save(); ctx.globalAlpha = alpha; ctx.fillStyle = color;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height); ctx.restore();
}
