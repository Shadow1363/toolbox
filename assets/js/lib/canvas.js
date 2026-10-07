/** Canvas 2D helpers shared by the tools. */

/** Fit a (sw×sh) box inside (dw×dh). mode: 'contain' | 'cover'. Returns {x,y,w,h}. */
export function fit(sw, sh, dw, dh, mode = 'contain') {
  const s = mode === 'cover' ? Math.max(dw / sw, dh / sh) : Math.min(dw / sw, dh / sh);
  const w = sw * s, h = sh * s;
  return { x: (dw - w) / 2, y: (dh - h) / 2, w, h };
}

/** Add a rounded-rect sub-path. r may be a number or [tl,tr,br,bl]. */
export function roundRectPath(ctx, x, y, w, h, r) {
  const [tl, tr, br, bl] = (Array.isArray(r) ? r : [r, r, r, r]).map((v) => Math.max(0, Math.min(v, w / 2, h / 2)));
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.arcTo(x + w, y, x + w, y + tr, tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.arcTo(x + w, y + h, x + w - br, y + h, br);
  ctx.lineTo(x + bl, y + h);
  ctx.arcTo(x, y + h, x, y + h - bl, bl);
  ctx.lineTo(x, y + tl);
  ctx.arcTo(x, y, x + tl, y, tl);
  ctx.closePath();
}

/** A linear gradient across a w×h area at `angle` degrees (0 = left→right, 90 = top→bottom). */
export function linearGradient(ctx, w, h, angle, stops) {
  const a = (angle * Math.PI) / 180;
  const len = Math.abs(w * Math.cos(a)) + Math.abs(h * Math.sin(a));
  const cx = w / 2, cy = h / 2, dx = (Math.cos(a) * len) / 2, dy = (Math.sin(a) * len) / 2;
  const g = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  stops.forEach((c, i) => g.addColorStop(stops.length === 1 ? 0 : i / (stops.length - 1), c));
  return g;
}

/** Reusable offscreen canvases, keyed by name, resized on demand. */
const pool = new Map();
export function scratch(name, w, h) {
  let c = pool.get(name);
  if (!c) { c = document.createElement('canvas'); pool.set(name, c); }
  w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
  if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  return c;
}

/** Does this browser support ctx.filter (Safari < 18 doesn't)? */
export const supportsCanvasFilter = (() => {
  try {
    const c = document.createElement('canvas').getContext('2d');
    c.filter = 'blur(2px)';
    return c.filter === 'blur(2px)';
  } catch { return false; }
})();

/**
 * Draw `src` blurred into ctx at (x,y,w,h). Uses ctx.filter when available,
 * otherwise a cheap downscale→upscale blur that works everywhere.
 */
export function drawBlurred(ctx, src, x, y, w, h, radius) {
  if (radius <= 0.5) { ctx.drawImage(src, x, y, w, h); return; }
  if (supportsCanvasFilter) {
    ctx.save(); ctx.filter = `blur(${radius}px)`; ctx.drawImage(src, x, y, w, h); ctx.restore();
    return;
  }
  const factor = Math.max(2, radius / 2);
  const small = scratch('blur-small', w / factor, h / factor);
  const sctx = small.getContext('2d');
  sctx.imageSmoothingQuality = 'high';
  sctx.clearRect(0, 0, small.width, small.height);
  sctx.drawImage(src, 0, 0, small.width, small.height);
  ctx.save(); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(small, x, y, w, h); ctx.restore();
}

/** Dimensions of anything drawable. */
export function sourceSize(src) {
  return {
    w: src.videoWidth || src.naturalWidth || src.width || 0,
    h: src.videoHeight || src.naturalHeight || src.height || 0,
  };
}

/** Pick a size for the output canvas: cap the longest side at `maxSide`, keep even numbers (video encoders like that). */
export function outputSize(w, h, maxSide = 1920) {
  const s = Math.min(1, maxSide / Math.max(w, h));
  return { w: Math.round((w * s) / 2) * 2, h: Math.round((h * s) / 2) * 2 };
}
