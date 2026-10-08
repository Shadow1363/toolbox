/*
 * Shape Crop · custom shapes from an SVG (file or pasted code) or a PNG with transparency.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * A custom shape is a plain object, saved as-is in localStorage ("My shapes"):
 *   { id: 'custom:…', name, kind: 'svg' | 'png', data, w, h, lum?, path?: { d, rule, vb } }
 *   data: sanitized SVG markup, or a PNG data URL (downscaled to 1024 px).
 *   path: set when the SVG is a single plain <path>, so it can be drawn as a crisp Path2D.
 *   lum:  the PNG had no transparency, so its brightness is used as the mask (white keeps).
 * Everything else is drawn as an image and its alpha becomes the mask (rasterMask).
 */
import { store } from '/assets/js/lib/dom.js';

const STORE_KEY = 'shape-crop:my-shapes';
const MAX_PNG_SIDE = 1024;

// Never rendered as live DOM (shapes load through <img>, which doesn't run scripts), but strip
// anything active anyway so saved and exported markup is inert.
const BLOCKED = new Set(['script', 'foreignobject', 'iframe', 'object', 'embed', 'audio', 'video', 'canvas',
  'animate', 'set', 'animatemotion', 'animatetransform', 'discard', 'handler', 'listener']);
const DRAWABLE = 'path,circle,ellipse,rect,polygon,polyline,line,text,image,use';
const EXTERNAL_URL = /url\(\s*(?!['"]?#)/i;

/** Parse, sanitize and normalize SVG markup. Throws an Error with a friendly message. */
export function sanitizeSvg(text) {
  const doc = new DOMParser().parseFromString(String(text).trim(), 'image/svg+xml');
  const svg = doc.documentElement;
  if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error("That doesn't look like valid SVG code.");

  for (const el of [svg, ...svg.querySelectorAll('*')]) {
    if (BLOCKED.has(el.localName.toLowerCase())) { el.remove(); continue; }
    if (el.localName === 'style' && (/@import/i.test(el.textContent) || EXTERNAL_URL.test(el.textContent))) { el.remove(); continue; }
    for (const { name, value } of [...el.attributes]) {
      const k = name.toLowerCase(), v = value.trim().toLowerCase();
      if (k.startsWith('on')
        || /(?:java|vb)script:/.test(v.replace(/\s/g, ''))
        || ((k === 'href' || k === 'xlink:href' || k === 'src') && !(v.startsWith('#') || v.startsWith('data:image/')))
        || (k === 'style' && EXTERNAL_URL.test(v))) el.removeAttribute(name);
    }
  }
  if (!svg.querySelector(DRAWABLE)) throw new Error('That SVG has no shapes to use (paths, circles, polygons, text…).');

  const vb = viewBoxOf(svg);
  svg.setAttribute('viewBox', vb.join(' '));
  svg.setAttribute('width', vb[2]);
  svg.setAttribute('height', vb[3]);
  svg.setAttribute('preserveAspectRatio', 'none'); // the shape stretches to fill its box
  if (!svg.getAttribute('xmlns')) svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

  return { markup: new XMLSerializer().serializeToString(svg), vb, path: singlePath(svg, vb) };
}

function viewBoxOf(svg) {
  const vb = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  if (vb.length === 4 && vb.every(Number.isFinite) && vb[2] > 0 && vb[3] > 0) return vb;
  const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
  if (w > 0 && h > 0) return [0, 0, w, h];
  // No size at all: measure the drawing. The markup is already sanitized and inert.
  const host = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  host.setAttribute('style', 'position:absolute;left:-9999px;width:0;height:0;overflow:hidden');
  host.append(document.importNode(svg, true));
  document.body.append(host);
  try {
    const b = host.firstChild.getBBox();
    if (b.width > 0 && b.height > 0) return [b.x, b.y, b.width, b.height];
  } catch { /* fall through */ } finally { host.remove(); }
  return [0, 0, 100, 100];
}

/** The path data when the SVG is one filled <path> with no transforms, else null. */
function singlePath(svg, vb) {
  const all = svg.querySelectorAll(DRAWABLE);
  if (all.length !== 1 || all[0].localName !== 'path') return null;
  const el = all[0], d = el.getAttribute('d');
  if (!d) return null;
  for (let e = el; e && e !== svg; e = e.parentElement) if (e.hasAttribute('transform') || e.localName === 'mask' || e.localName === 'clipPath') return null;
  const fill = (el.getAttribute('fill') || '').toLowerCase();
  if (fill === 'none' || /fill\s*:\s*none/i.test(el.getAttribute('style') || '')) return null; // stroke-only: let the raster path handle it
  try { new Path2D(d); } catch { return null; }
  const rule = /evenodd/i.test(`${el.getAttribute('fill-rule')} ${el.getAttribute('style')}`) ? 'evenodd' : 'nonzero';
  return { d, rule, vb };
}

const newId = () => `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** A custom shape from SVG markup. */
export function shapeFromSvg(text, name = 'Pasted shape') {
  const { markup, vb, path } = sanitizeSvg(text);
  return { id: newId(), name, kind: 'svg', data: markup, w: vb[2], h: vb[3], ...(path && { path }) };
}

/** A custom shape from an uploaded file (.svg, or a PNG/WebP whose transparency is the mask). */
export async function shapeFromFile(file) {
  const name = file.name.replace(/\.[^.]+$/, '') || 'Shape';
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name)) return shapeFromSvg(await file.text(), name);
  if (!/^image\/(png|webp)$/.test(file.type) && !/\.(png|webp)$/i.test(file.name)) throw new Error('Use an .svg file, or a PNG with transparency.');

  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const s = Math.min(1, MAX_PNG_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.naturalWidth * s));
    c.height = Math.max(1, Math.round(img.naturalHeight * s));
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.drawImage(img, 0, 0, c.width, c.height);
    const { data } = cx.getImageData(0, 0, c.width, c.height);
    let opaque = true;
    for (let i = 3; i < data.length; i += 4) if (data[i] < 250) { opaque = false; break; }
    return { id: newId(), name, kind: 'png', data: c.toDataURL('image/png'), w: c.width, h: c.height, ...(opaque && { lum: true }) };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = src;
  });
}

/* ---------- Images and raster masks ---------- */

const urls = new Map();   // shape id → URL to show/load it
const images = new Map(); // shape id → { img, ready }

/** A URL for the shape's image (blob URL for SVG markup, the data URL for PNG). */
export function shapeUrl(shape) {
  if (!urls.has(shape.id)) {
    urls.set(shape.id, shape.kind === 'svg' ? URL.createObjectURL(new Blob([shape.data], { type: 'image/svg+xml' })) : shape.data);
  }
  return urls.get(shape.id);
}

/** The loaded <img> for a shape, or null while it loads (onReady fires once it's ready). */
export function shapeImage(shape, onReady) {
  let entry = images.get(shape.id);
  if (!entry) {
    const img = new Image();
    entry = { img, ready: false };
    images.set(shape.id, entry);
    img.onload = () => { entry.ready = true; onReady?.(); };
    img.onerror = () => console.warn('Custom shape failed to load', shape.name);
    img.src = shapeUrl(shape);
  }
  return entry.ready ? entry.img : null;
}

const rasters = new Map();

/**
 * The shape as an alpha mask canvas of about w×h px (sizes are bucketed so animated or
 * keyframed sizes reuse the same raster). Null while the image loads.
 */
export function rasterMask(shape, w, h, onReady) {
  const img = shapeImage(shape, onReady);
  if (!img) return null;
  const bw = Math.min(4096, Math.max(16, Math.ceil(w / 64) * 64));
  const bh = Math.min(4096, Math.max(16, Math.ceil(h / 64) * 64));
  const key = `${shape.id}|${bw}|${bh}`;
  if (rasters.has(key)) return rasters.get(key);
  if (rasters.size > 8) rasters.clear();
  const c = document.createElement('canvas');
  c.width = bw; c.height = bh;
  const cx = c.getContext('2d', { willReadFrequently: !!shape.lum });
  cx.drawImage(img, 0, 0, bw, bh);
  if (shape.lum) { // opaque PNG: brightness becomes alpha
    const id = cx.getImageData(0, 0, bw, bh), d = id.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i + 3] = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) * (d[i + 3] / 255);
      d[i] = d[i + 1] = d[i + 2] = 255;
    }
    cx.putImageData(id, 0, 0);
  } else { // white + alpha, like the path masks (SVG export uses it as a luminance mask)
    cx.globalCompositeOperation = 'source-in';
    cx.fillStyle = '#fff';
    cx.fillRect(0, 0, bw, bh);
  }
  rasters.set(key, c);
  return c;
}

/* ---------- My shapes (localStorage) ---------- */

export const loadMyShapes = () => store.get(STORE_KEY, []).filter((s) => s && s.id && s.data);

/** Save the list; returns false when the browser refused (storage full or blocked). */
export function saveMyShapes(list) {
  store.set(STORE_KEY, list);
  return store.get(STORE_KEY, []).length === list.length;
}

export function forgetShape(shape) {
  const url = urls.get(shape.id);
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url);
  urls.delete(shape.id);
  images.delete(shape.id);
}
