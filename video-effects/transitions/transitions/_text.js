/**
 * Text helpers for the text-based transitions: shared controls, a cached glyph layout,
 * the "thickest point" of a letter (where Zoom through text dives in) and mask drawing.
 * Masks are white text on a transparent canvas; shaders read their alpha.
 */
import { fontOptions, weightOptions, fontString, ensureFont } from '/assets/js/lib/fonts.js';
import { scratch } from '/assets/js/lib/canvas.js';

/** Text controls. `letter` adds the "zoom into letter" picker. */
export function textParams({ text = 'CHAPTER 2', size = 300, color = '#ffffff', font = 'Inter', weight = '900', spacing = 0, letter = false, multiline = true } = {}) {
  return [
    { id: 'text', type: multiline ? 'textarea' : 'text', label: 'Text', value: text, rows: 2 },
    { id: 'font', type: 'select', label: 'Font', value: font, options: fontOptions },
    { id: 'weight', type: 'segmented', label: 'Weight', value: weight, options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 60, max: 700, step: 2, value: size, unit: 'px' },
    { id: 'spacing', type: 'range', label: 'Letter spacing', min: -40, max: 120, step: 1, value: spacing, unit: 'px' },
    { id: 'textColor', type: 'color', label: 'Text color', value: color },
    letter && { id: 'letter', type: 'range', label: 'Zoom into letter', min: 0, max: 24, step: 1, value: 0,
      format: (v) => (v ? `#${v}` : 'Auto'), hint: 'Counts letters, skipping spaces. Auto picks the middle one.' },
  ].filter(Boolean);
}

/* ---------- Layout ---------- */
const layouts = new Map();
const measurer = document.createElement('canvas').getContext('2d');

/** Glyph positions for the text centred in a W×H frame. Sizes are authored for a 1080px short side. */
export function layoutText(P, W, H, refresh) {
  ensureFont(P.font, P.weight, () => { layouts.clear(); focusCache.clear(); refresh?.(); });
  const k = Math.min(W, H) / 1080;
  const key = [P.text, P.font, P.weight, P.size, P.spacing, W, H].join('|');
  if (layouts.has(key)) return layouts.get(key);
  const size = P.size * k;
  const spacing = P.spacing * k;
  const font = fontString(P.font, P.weight, size);
  measurer.font = font;
  const lines = String(P.text || ' ').split('\n').slice(0, 3);
  const lineH = size * 1.05;
  const glyphs = [];
  let maxW = 0;
  const widths = lines.map((line) => {
    let w = 0;
    for (const ch of line) w += measurer.measureText(ch).width + spacing;
    w -= spacing;
    maxW = Math.max(maxW, w);
    return Math.max(0, w);
  });
  const m = measurer.measureText('H');
  const capH = m.actualBoundingBoxAscent || size * 0.72;
  const blockH = lineH * (lines.length - 1) + capH;
  let y = H / 2 - blockH / 2 + capH;
  lines.forEach((line, li) => {
    let x = W / 2 - widths[li] / 2;
    for (const ch of line) {
      const w = measurer.measureText(ch).width;
      if (ch.trim()) glyphs.push({ ch, x, y, w });
      x += w + spacing;
    }
    y += lineH;
  });
  const layout = { glyphs, font, size, capH, width: maxW, height: blockH, cx: W / 2, cy: H / 2, W, H };
  if (layouts.size > 40) layouts.clear();
  layouts.set(key, layout);
  return layout;
}

export function drawGlyphs(ctx, L, { stroke = 0 } = {}) {
  ctx.font = L.font;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  if (stroke > 0) { ctx.lineWidth = stroke; ctx.lineJoin = 'round'; ctx.strokeStyle = ctx.fillStyle; }
  for (const g of L.glyphs) {
    ctx.fillText(g.ch, g.x, g.y);
    if (stroke > 0) ctx.strokeText(g.ch, g.x, g.y);
  }
}

/* ---------- Letter focus ---------- */
const focusCache = new Map();
const REF = 200; // reference font size for the distance transform

/** Inside-most point of a glyph, relative to its pen position at size 1, plus its stroke radius. */
function glyphCore(ch, family, weight) {
  const key = `${ch}|${family}|${weight}`;
  if (focusCache.has(key)) return focusCache.get(key);
  const c = document.createElement('canvas');
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.font = fontString(family, weight, REF);
  const w = Math.ceil(cx.measureText(ch).width) + 40, h = Math.ceil(REF * 1.4);
  c.width = w; c.height = h;
  cx.font = fontString(family, weight, REF);
  cx.fillStyle = '#fff';
  cx.fillText(ch, 20, REF * 1.05);
  const { data } = cx.getImageData(0, 0, w, h);
  // Two-pass chamfer distance transform (distance to the nearest outside pixel).
  const d = new Float32Array(w * h);
  const BIG = 1e6;
  for (let i = 0; i < w * h; i++) d[i] = data[i * 4 + 3] > 127 ? BIG : 0;
  const at = (x, y) => (x < 0 || y < 0 || x >= w || y >= h ? 0 : d[y * w + x]);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x, y - 1) + 1, at(x - 1, y - 1) + 1.414, at(x + 1, y - 1) + 1.414);
  }
  let best = 0, bx = w / 2, by = h / 2;
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x; if (!d[i]) continue;
    d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x, y + 1) + 1, at(x + 1, y + 1) + 1.414, at(x - 1, y + 1) + 1.414);
    if (d[i] > best) { best = d[i]; bx = x; by = y; }
  }
  const core = { x: (bx - 20) / REF, y: (by - REF * 1.05) / REF, r: Math.max(1, best) / REF };
  if (best > 0) focusCache.set(key, core);
  return core;
}

/** Point (px) inside letter #n (1-based, 0 = middle letter) to zoom into, with its stroke radius. */
export function letterFocus(L, n, P) {
  if (!L.glyphs.length) return { x: L.cx, y: L.cy, r: 20 };
  const i = n > 0 ? Math.min(n, L.glyphs.length) - 1 : Math.floor((L.glyphs.length - 1) / 2);
  const g = L.glyphs[i];
  const core = glyphCore(g.ch, P.font, P.weight);
  return { x: g.x + core.x * L.size, y: g.y + core.y * L.size, r: core.r * L.size };
}

/** Zoom factor at which a circle of radius r around (x,y) covers the whole W×H frame. */
export function coverScale(f, W, H) {
  const far = Math.max(Math.hypot(f.x, f.y), Math.hypot(W - f.x, f.y), Math.hypot(f.x, H - f.y), Math.hypot(W - f.x, H - f.y));
  return (far / f.r) * 1.08;
}

/** A cleared W×H mask canvas, unique per use and size. */
export function maskCanvas(name, W, H) {
  const c = scratch(`tr-mask-${name}-${W}x${H}`, W, H);
  const ctx = c.getContext('2d');
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  return { c, ctx };
}
