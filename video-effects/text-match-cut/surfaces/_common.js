/**
 * Shared helpers for logo surfaces: procedural textures, the logo layer, and the effects
 * that make a logo look applied instead of pasted on (rough edges, texture show-through,
 * bevels, outlines, displacement along a height map).
 *
 * A layer is { c, x, y, w, h }: an offscreen canvas holding the logo (plus a margin)
 * and where it sits in frame pixels. Effects edit it in place; put(ctx, L) draws it.
 * Everything takes its randomness from the frame's rng, so preview and export match.
 */
import { drawBlurred } from '/assets/js/lib/canvas.js';
import { rng } from '/assets/js/lib/random.js';
import { grainTexture, fiberTexture, crumpledTexture } from '/assets/js/lib/paper-textures.js';
import { glDisplace } from './gl.js';

export { grainTexture, fiberTexture, crumpledTexture };

/* ---------- Random + colour ---------- */
export const pick = (r, list) => list[Math.floor(r() * list.length)];
export const between = (r, a, b) => a + r() * (b - a);
export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));

export function hexToRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [n >> 16, (n >> 8) & 255, n & 255];
}
export const rgb = (r, g, b) => `rgb(${clamp(r, 0, 255) | 0},${clamp(g, 0, 255) | 0},${clamp(b, 0, 255) | 0})`;
/** Shift a hex colour's brightness by `amt` (−255..255), returning rgb(). */
export function shade(hex, amt) {
  const [r, g, b] = hexToRgb(hex);
  return rgb(r + amt, g + amt, b + amt);
}
export const luma = (hex) => {
  const [r, g, b] = hexToRgb(hex);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255;
};
/** Vary a hex colour a little (± amt per channel, plus a shared brightness shift). */
export function vary(r, hex, amt = 14) {
  const [R, G, B] = hexToRgb(hex);
  const d = (r() - 0.5) * amt * 2;
  return rgb(R + d + (r() - 0.5) * amt, G + d + (r() - 0.5) * amt, B + d + (r() - 0.5) * amt);
}

/* ---------- Offscreen canvases ---------- */
const pool = new Map();
/** A cleared offscreen canvas, reused by name + size. read = true for canvases read with getImageData. */
export function canvasNamed(name, w, h, read = false) {
  w = Math.max(1, Math.round(w));
  h = Math.max(1, Math.round(h));
  const key = `${name}|${w}x${h}`;
  let c = pool.get(key);
  if (!c) {
    if (pool.size > 80) pool.clear();
    c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.ctx = c.getContext('2d', { willReadFrequently: read });
    pool.set(key, c);
  }
  const x = c.ctx;
  x.setTransform(1, 0, 0, 1, 0, 0);
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';
  x.filter = 'none';
  x.clearRect(0, 0, w, h);
  return c;
}

/* ---------- Procedural textures (generated once, cached) ---------- */
const texCache = new Map();

/**
 * Tileable fractal value noise, grey, stretched to the full 0–255 range.
 * cx/cy = noise cells across the tile at the first octave (cy ≫ cx gives streaks).
 * The canvas carries `.gray` (Uint8Array) for per-pixel sampling.
 */
export function noiseTex(seed, { size = 256, cx = 4, cy = cx, octaves = 5, gain = 0.5 } = {}) {
  const key = `n|${seed}|${size}|${cx}|${cy}|${octaves}|${gain}`;
  let c = texCache.get(key);
  if (c) return c;
  const r = rng(seed * 7919 + 13);
  const acc = new Float32Array(size * size);
  let amp = 1;
  for (let o = 0; o < octaves; o++) {
    const px = Math.min(size, cx << o), py = Math.min(size, cy << o);
    const lat = new Float32Array(px * py);
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    for (let y = 0; y < size; y++) {
      const fy = (y / size) * py, iy = Math.floor(fy), ty = fy - iy, sy = ty * ty * (3 - 2 * ty);
      const y0 = (iy % py) * px, y1 = ((iy + 1) % py) * px;
      for (let x = 0; x < size; x++) {
        const fx = (x / size) * px, ix = Math.floor(fx), tx = fx - ix, sx = tx * tx * (3 - 2 * tx);
        const x0 = ix % px, x1 = (ix + 1) % px;
        const a = lat[y0 + x0] + (lat[y0 + x1] - lat[y0 + x0]) * sx;
        const b = lat[y1 + x0] + (lat[y1 + x1] - lat[y1 + x0]) * sx;
        acc[y * size + x] += (a + (b - a) * sy) * amp;
      }
    }
    amp *= gain;
  }
  let lo = Infinity, hi = -Infinity;
  for (const v of acc) { if (v < lo) lo = v; if (v > hi) hi = v; }
  c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const gray = new Uint8Array(size * size);
  for (let i = 0; i < acc.length; i++) {
    const v = ((acc[i] - lo) / (hi - lo || 1)) * 255;
    gray[i] = v;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  c.gray = gray;
  texCache.set(key, c);
  return c;
}

/**
 * A texture turned into an alpha mask: alpha rises from 0 at grey `lo` to 1 at `hi`
 * (colour `color`). Used with destination-out to eat paint where the surface is pitted.
 */
export function alphaTex(tex, lo = 0.4, hi = 0.8, color = '#000') {
  const key = `a|${texKey(tex)}|${lo}|${hi}|${color}`;
  let c = texCache.get(key);
  if (c) return c;
  const s = tex.width;
  const src = tex.gray || grayOf(tex);
  c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(s, s);
  const [R, G, B] = hexToRgb(color);
  for (let i = 0; i < s * s; i++) {
    const v = src[i] / 255;
    img.data[i * 4] = R;
    img.data[i * 4 + 1] = G;
    img.data[i * 4 + 2] = B;
    img.data[i * 4 + 3] = clamp((v - lo) / (hi - lo)) * 255;
  }
  ctx.putImageData(img, 0, 0);
  texCache.set(key, c);
  return c;
}

const texIds = new WeakMap();
let texCount = 0;
function texKey(tex) {
  if (!texIds.has(tex)) texIds.set(tex, ++texCount);
  return texIds.get(tex);
}
function grayOf(tex) {
  if (tex.gray) return tex.gray;
  const d = tex.getContext('2d').getImageData(0, 0, tex.width, tex.height).data;
  const g = new Uint8Array(tex.width * tex.height);
  for (let i = 0; i < g.length; i++) g[i] = d[i * 4];
  tex.gray = g;
  return g;
}

/** A small repeating tile drawn once by `draw(ctx, size)` and cached by key. */
export function tile(key, size, draw) {
  const k = `t|${key}|${size}`;
  let c = texCache.get(k);
  if (c) return c;
  c = document.createElement('canvas');
  c.width = c.height = Math.max(2, Math.round(size));
  draw(c.getContext('2d'), c.width);
  texCache.set(k, c);
  return c;
}

/** A repeating pattern of `tex`, scaled (sx, sy), rotated (deg) and offset. */
export function pattern(ctx, tex, { scale = 1, sx = scale, sy = scale, rot = 0, x = 0, y = 0 } = {}) {
  const p = ctx.createPattern(tex, 'repeat');
  p.setTransform?.(new DOMMatrix().translate(x, y).rotate(rot).scale(sx, sy));
  return p;
}

/** Fill a rect with a texture at a random offset, blended with `op` at `alpha`. */
export function texFill(ctx, tex, r, { x = 0, y = 0, w, h, op = 'source-over', alpha = 1, ...opts } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  ctx.fillStyle = pattern(ctx, tex, { x: r() * 4096, y: r() * 4096, ...opts });
  ctx.fillRect(x, y, w, h);
  ctx.restore();
}

/** Soft light falling across the frame from a random side (and a darker far side). */
export function lighting(ctx, W, H, r, amount = 0.35) {
  const a = r() * Math.PI * 2;
  const R = Math.hypot(W, H);
  const lx = W / 2 + Math.cos(a) * R * 0.45, ly = H / 2 + Math.sin(a) * R * 0.45;
  const g = ctx.createRadialGradient(lx, ly, 0, lx, ly, R * 1.1);
  g.addColorStop(0, `rgba(255,255,255,${amount})`);
  g.addColorStop(0.5, 'rgba(128,128,128,0)');
  g.addColorStop(1, `rgba(0,0,0,${amount})`);
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

/** Darker, warmer blotches (water stains, grime). */
export function stains(ctx, W, H, r, n, color = '40,30,20', strength = 0.18) {
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0; i < n; i++) {
    const x = r() * W, y = r() * H, rad = between(r, 0.08, 0.35) * Math.max(W, H);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, `rgba(${color},${strength * between(r, 0.4, 1)})`);
    g.addColorStop(1, `rgba(${color},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }
  ctx.restore();
}

/* ---------- The logo layer ---------- */

/**
 * The logo at its fixed box, on a canvas with a margin of pad × its long side.
 * color = a CSS colour to recolour it (one-colour silhouette), or null for its own colours.
 */
export function logoLayer(env, color, { pad = 0.3, name = 'logo' } = {}) {
  const { box, logo } = env;
  const p = Math.ceil(Math.max(box.w, box.h) * pad);
  const ox = Math.floor(box.x) - p, oy = Math.floor(box.y) - p;
  const w = Math.ceil(box.x + box.w) + p - ox, h = Math.ceil(box.y + box.h) + p - oy;
  const c = canvasNamed(name, w, h);
  c.ctx.imageSmoothingQuality = 'high';
  c.ctx.drawImage(logo, box.x - ox, box.y - oy, box.w, box.h);
  const L = { c, x: ox, y: oy, w, h };
  if (color) fillColor(L, color);
  return L;
}

/** An empty layer with the same size and position as L. */
export function blankLike(L, name, read = false) {
  return { c: canvasNamed(name, L.w, L.h, read), x: L.x, y: L.y, w: L.w, h: L.h };
}
/** A copy of L. */
export function copyOf(L, name) {
  const out = blankLike(L, name);
  out.c.ctx.drawImage(L.c, 0, 0);
  return out;
}

/** Recolour everything in the layer to one colour (keeps alpha). */
export function fillColor(L, color) {
  const x = L.c.ctx;
  x.save();
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, L.w, L.h);
  x.restore();
  return L;
}

/** Draw a layer onto ctx (frame coordinates). */
export function put(ctx, L, { op = 'source-over', alpha = 1, dx = 0, dy = 0, blur = 0 } = {}) {
  ctx.save();
  ctx.globalCompositeOperation = op;
  ctx.globalAlpha = alpha;
  if (blur > 0.5) drawBlurred(ctx, L.c, L.x + dx, L.y + dy, L.w, L.h, blur);
  else ctx.drawImage(L.c, L.x + dx, L.y + dy);
  ctx.restore();
}

/** Draw `fill` (colour, gradient or pattern; frame coordinates) only where the layer has pixels, blended with op. */
export function paintInside(L, fill, { op = 'source-atop', alpha = 1, name = 'inside' } = {}) {
  const t = blankLike(L, name);
  const x = t.c.ctx;
  x.drawImage(L.c, 0, 0);
  x.globalCompositeOperation = 'source-in';
  x.translate(-L.x, -L.y);
  x.fillStyle = fill;
  x.fillRect(L.x, L.y, L.w, L.h);
  const lx = L.c.ctx;
  lx.save();
  lx.globalCompositeOperation = op;
  lx.globalAlpha = alpha;
  lx.drawImage(t.c, 0, 0);
  lx.restore();
}

/** Eat into the layer's alpha with a texture (paint missing the pits of the surface). */
export function eat(L, tex, r, { amount = 0.5, lo = 0.45, hi = 0.85, ...opts } = {}) {
  const x = L.c.ctx;
  x.save();
  x.globalCompositeOperation = 'destination-out';
  x.globalAlpha = amount;
  x.fillStyle = pattern(x, alphaTex(tex, lo, hi), { x: r() * 4096, y: r() * 4096, ...opts });
  x.fillRect(0, 0, L.w, L.h);
  x.restore();
}

/**
 * Rough, broken edges: blur the alpha, then re-threshold it against noise.
 * blur = edge softness in px, amount = how far noise pushes the edge (0–1), scale = noise px.
 */
export function roughen(L, r, { blur = 3, amount = 0.6, scale = 1, tex = noiseTex(31, { cx: 32, octaves: 3 }) } = {}) {
  const { w, h } = L;
  const soft = blankLike(L, 'rough-soft', true);
  drawBlurred(soft.c.ctx, L.c, 0, 0, w, h, blur);
  const src = L.c.ctx.getImageData(0, 0, w, h);
  const b = soft.c.ctx.getImageData(0, 0, w, h).data;
  const d = src.data;
  const g = grayOf(tex), ts = tex.width;
  const ox = Math.floor(r() * ts), oy = Math.floor(r() * ts);
  const inv = 1 / scale;
  for (let y = 0; y < h; y++) {
    const row = (((Math.floor(y * inv) + oy) % ts) + ts) % ts * ts;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const a = b[i + 3] / 255;
      if (a <= 0.001) { d[i + 3] = 0; continue; }
      const n = g[row + ((Math.floor(x * inv) + ox) % ts)] / 255 - 0.5;
      const v = clamp((a - 0.5 + n * amount) * 6 + 0.5);
      if (d[i + 3] === 0) { d[i] = b[i]; d[i + 1] = b[i + 1]; d[i + 2] = b[i + 2]; }
      d[i + 3] = v * 255;
    }
  }
  L.c.ctx.putImageData(src, 0, 0);
  return L;
}

/** Copies of L drawn at offsets on a circle of radius rad: dilate (union) or erode (intersection). */
function spread(L, rad, name, erode) {
  const out = copyOf(L, name);
  if (rad < 0.5) return out;
  const x = out.c.ctx;
  x.globalCompositeOperation = erode ? 'destination-in' : 'source-over';
  const steps = rad > 6 ? 16 : 10;
  for (const f of rad > 4 ? [0.5, 1] : [1]) {
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      x.drawImage(L.c, Math.cos(a) * rad * f, Math.sin(a) * rad * f);
    }
  }
  return out;
}
export const dilate = (L, rad, name = 'dilate') => spread(L, rad, name, false);
export const erode = (L, rad, name = 'erode') => spread(L, rad, name, true);

/** A band of width `width` centred on the logo's edge (neon tubes, stitched borders). */
export function outline(L, width, name = 'outline') {
  const out = dilate(L, width / 2, name);
  const inner = erode(L, width / 2, `${name}-in`);
  const x = out.c.ctx;
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(inner.c, 0, 0);
  x.globalCompositeOperation = 'source-over';
  return out;
}

/** The part of L that a copy shifted by (dx, dy) doesn't cover: a band along one side of every edge. */
function edgeBand(L, dx, dy, color, name) {
  const t = copyOf(L, name);
  const x = t.c.ctx;
  x.globalCompositeOperation = 'destination-out';
  x.drawImage(L.c, dx, dy);
  x.globalCompositeOperation = 'source-in';
  x.fillStyle = color;
  x.fillRect(0, 0, L.w, L.h);
  return t;
}

/**
 * Light the edges of a shape drawn at L: raised (embossed, patch) or sunk (engraved, carved).
 * depth in px; light = angle the light comes from (radians, default top-left).
 */
export function bevel(ctx, L, { depth = 3, raised = true, light = -2.36, hi = 0.6, lo = 0.6, blur = 1 } = {}) {
  const lx = Math.cos(light) * depth, ly = Math.sin(light) * depth;
  // raised: the edges facing the light catch it; sunk: the far walls do
  const s = raised ? 1 : -1;
  const lit = edgeBand(L, -lx * s, -ly * s, '#ffffff', 'bevel-hi');
  const dark = edgeBand(L, lx * s, ly * s, '#000000', 'bevel-lo');
  put(ctx, dark, { op: 'multiply', alpha: lo, blur });
  put(ctx, lit, { op: 'screen', alpha: hi, blur });
}

/** A soft drop shadow of the layer's shape. */
export function dropShadow(ctx, L, { dx = 0, dy = 4, blur = 8, alpha = 0.45, color = '#000' } = {}) {
  const t = copyOf(L, 'shadow');
  fillColor(t, color);
  put(ctx, t, { op: 'source-over', alpha, dx, dy, blur });
}

/** Specks of paint around the logo (spray-can overspray). */
export function overspray(ctx, L, r, color, { count = 900, size = 1.6, reach = 18, alpha = 0.8 } = {}) {
  const dots = blankLike(L, 'spray-dots');
  const x = dots.c.ctx;
  x.fillStyle = color;
  for (let i = 0; i < count; i++) {
    const rad = size * (0.4 + r() * r() * 1.6);
    x.beginPath();
    x.arc(r() * L.w, r() * L.h, rad, 0, Math.PI * 2);
    x.fill();
  }
  // keep only the specks near the logo
  const near = blankLike(L, 'spray-near');
  drawBlurred(near.c.ctx, L.c, 0, 0, L.w, L.h, reach);
  drawBlurred(near.c.ctx, L.c, 0, 0, L.w, L.h, reach * 0.5);
  x.globalCompositeOperation = 'destination-in';
  x.drawImage(near.c, 0, 0);
  put(ctx, dots, { alpha });
}

/**
 * Bend the layer along a height map and light it from the same map.
 * drawHeight(ctx) draws grey heights in frame coordinates (it is translated to the layer).
 * WebGL when available, otherwise the same maths per pixel.
 */
export function displace(L, drawHeight, { strength = 20, shade = 0.5, light = [-0.6, -0.8], blur = 2 } = {}) {
  const hRaw = blankLike(L, 'height-raw');
  const hx = hRaw.c.ctx;
  hx.fillStyle = '#808080';
  hx.fillRect(0, 0, L.w, L.h);
  hx.translate(-L.x, -L.y);
  drawHeight(hx);
  const hgt = blankLike(L, 'height', true);
  drawBlurred(hgt.c.ctx, hRaw.c, 0, 0, L.w, L.h, blur);
  const out = glDisplace(L.c, hgt.c, { strength, shade, light });
  if (out) {
    const x = L.c.ctx;
    x.clearRect(0, 0, L.w, L.h);
    x.drawImage(out, 0, 0);
  } else displaceCpu(L, hgt, { strength, shade, light });
  return L;
}

function displaceCpu(L, hgt, { strength, shade, light }) {
  const { w, h } = L;
  const src = L.c.ctx.getImageData(0, 0, w, h);
  const s = src.data;
  const hd = hgt.c.ctx.getImageData(0, 0, w, h).data;
  const out = new ImageData(w, h);
  const o = out.data;
  const H = (x, y) => hd[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4] / 255;
  const ll = Math.hypot(light[0], light[1], 0.8);
  const L3 = [light[0] / ll, light[1] / ll, 0.8 / ll];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx = (H(x + 3, y) - H(x - 3, y)) / 6, gy = (H(x, y + 3) - H(x, y - 3)) / 6;
      const sx = Math.round(x - gx * strength), sy = Math.round(y - gy * strength);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) continue;
      const j = (sy * w + sx) * 4, i = (y * w + x) * 4;
      let nx = -gx * 60, ny = -gy * 60;
      const nl = Math.hypot(nx, ny, 1);
      const lit = ((nx / nl) * L3[0] + (ny / nl) * L3[1] + L3[2] / nl) / L3[2];
      const f = 1 + (lit - 1) * shade;
      o[i] = s[j] * f;
      o[i + 1] = s[j + 1] * f;
      o[i + 2] = s[j + 2] * f;
      o[i + 3] = s[j + 3];
    }
  }
  L.c.ctx.putImageData(out, 0, 0);
}
