/*
 * Image category I/O: load images (drop, file picker, paste), encode canvases, copy to the
 * clipboard, download, ZIP. Every Image tool takes a pasted image and copies its result.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   const dz = createImageDrop(root, { label, onLoad, onClear });   // createDropzone + paste + Paste button
 *   onPasteImages((files) => …, { multiple: true });                // page-wide Ctrl/⌘+V (ignored while typing)
 *   createImageExport(root, { id, getCanvas: (scale) => canvas, filename, formats, scales, svg, actions });
 *   await copyCanvas(canvas);  await canEncode('image/webp');  await downloadZip(files, 'name.zip');
 */
import { h, icon, toast, downloadBlob, formatBytes, store } from './dom.js';
import { createDropzone } from './upload.js';
import { loadMedia } from './media.js';
import { loadLib } from './cdn.js';

/* ---------- Paste ---------- */

const isTyping = (el) => el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)) && el.type !== 'range' && el.type !== 'file';

/** Image files from a paste event (screenshots arrive as image/png items). */
export function imagesFromClipboard(data) {
  if (!data) return [];
  const files = [...(data.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) return files;
  return [...(data.items || [])].filter((i) => i.kind === 'file' && i.type.startsWith('image/')).map((i) => i.getAsFile()).filter(Boolean);
}

/** Name pasted files so downloads get a sensible name ("pasted-image.png"). */
const named = (file, i = 0) => (file.name && file.name !== 'image.png' ? file
  : new File([file], `pasted-image${i ? `-${i + 1}` : ''}.${(file.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace('svg+xml', 'svg')}`, { type: file.type }));

/**
 * Listen for Ctrl/⌘+V anywhere on the page. Pastes into text fields are left alone unless they carry an image.
 * Returns an unsubscribe function.
 */
export function onPasteImages(cb, { multiple = false } = {}) {
  const handler = (e) => {
    const files = imagesFromClipboard(e.clipboardData);
    if (!files.length) return;
    if (isTyping(e.target) && e.clipboardData.types.includes('text/plain')) return;
    e.preventDefault();
    cb((multiple ? files : files.slice(0, 1)).map(named));
  };
  document.addEventListener('paste', handler);
  return () => document.removeEventListener('paste', handler);
}

/** Read images through the async Clipboard API (needs a click; Firefox may refuse). */
export async function readClipboardImages() {
  if (!navigator.clipboard?.read) throw new Error('Your browser can’t read the clipboard from a button. Press Ctrl+V (⌘V on Mac) instead.');
  let items;
  try { items = await navigator.clipboard.read(); } catch {
    throw new Error('Clipboard access was blocked. Press Ctrl+V (⌘V on Mac) instead.');
  }
  const files = [];
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith('image/'));
    if (type) files.push(named(new File([await item.getType(type)], '', { type }), files.length));
  }
  if (!files.length) throw new Error('No image on the clipboard. Copy an image or take a screenshot first.');
  return files;
}

/** A small "Paste" button that reads images from the clipboard. */
export function pasteButton(onFiles, { label = 'Paste image', multiple = false } = {}) {
  const b = h('button', { type: 'button', class: 'btn btn-sm btn-ghost', title: 'Paste an image from the clipboard (Ctrl/⌘+V works too)', html: `${icon('paste')} ${label}` });
  b.addEventListener('click', async () => {
    try {
      const files = await readClipboardImages();
      onFiles(multiple ? files : files.slice(0, 1));
    } catch (err) { toast(err.message, 'warning'); }
  });
  return b;
}

/**
 * createDropzone for one image, plus page-wide paste and a Paste button under it.
 * `paste: false` skips the page-wide listener (tools that route pastes themselves).
 */
export function createImageDrop(root, { label = 'Drop an image', limits, onLoad, onClear, paste = true } = {}) {
  const zoneRoot = h('div');
  root.append(zoneRoot, h('div', { class: 'img-paste-row' },
    h('span', { class: 'ctrl-hint' }, 'or paste a screenshot with Ctrl/⌘+V'),
    pasteButton((files) => dz.load(files[0]))));
  const dz = createDropzone(zoneRoot, { accept: ['image'], label, limits, onLoad, onClear });
  if (paste) onPasteImages((files) => dz.load(files[0]));
  return dz;
}

/** Load an image File (validated through loadMedia). Resolves the same shape as loadMedia. */
export const loadImage = (file, limits) => loadMedia(file, { accept: ['image'], limits });

/** Decode a Blob or data URL into an <img>. */
export function blobToImage(src) {
  return new Promise((resolve, reject) => {
    const url = typeof src === 'string' ? src : URL.createObjectURL(src);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { if (typeof src !== 'string') URL.revokeObjectURL(url); reject(new Error('Couldn’t decode that image.')); };
    img.src = url;
  });
}

/* ---------- Encoding ---------- */

export const FORMATS = {
  png: { mime: 'image/png', ext: 'png', label: 'PNG' },
  jpg: { mime: 'image/jpeg', ext: 'jpg', label: 'JPG', lossy: true },
  webp: { mime: 'image/webp', ext: 'webp', label: 'WebP', lossy: true },
  avif: { mime: 'image/avif', ext: 'avif', label: 'AVIF', lossy: true },
};

export function canvasToBlob(canvas, mime = 'image/png', quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(`Your browser couldn’t encode ${mime.split('/')[1].toUpperCase()}.`))), mime, quality);
  });
}

const encodable = new Map();
/** Can this browser's canvas encode `mime`? (Safari has no WebP encoder; AVIF is rare.) toBlob silently falls back to PNG, so check the result type. */
export function canEncode(mime) {
  if (!encodable.has(mime)) {
    const c = document.createElement('canvas');
    c.width = c.height = 2;
    encodable.set(mime, new Promise((resolve) => {
      try { c.toBlob((b) => resolve(!!b && b.type === mime), mime, 0.8); } catch { resolve(false); }
    }));
  }
  return encodable.get(mime);
}

/** Copy of `canvas` flattened onto a solid colour (for JPG, which has no alpha). */
export function flatten(canvas, color = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(canvas, 0, 0);
  return c;
}

/** Encode a canvas in one of FORMATS ('png' | 'jpg' | 'webp' | 'avif'). */
export function encodeCanvas(canvas, format = 'png', quality = 0.9, matte = '#ffffff') {
  const f = FORMATS[format] || FORMATS.png;
  return canvasToBlob(format === 'jpg' ? flatten(canvas, matte) : canvas, f.mime, f.lossy ? quality : undefined);
}

/* ---------- Clipboard out ---------- */

/** Copy an image Blob (or a Promise of one) to the clipboard. Browsers only take PNG. */
export async function copyBlob(blobOrPromise) {
  try {
    if (!navigator.clipboard?.write || !window.ClipboardItem) throw new Error('unsupported');
    // Passing the Promise keeps Safari's user-gesture requirement satisfied.
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': Promise.resolve(blobOrPromise) })]);
    toast('Image copied to the clipboard', 'success', 1800);
    return true;
  } catch (err) {
    console.warn(err);
    toast(err.message === 'unsupported' ? 'Your browser can’t copy images. Download it instead.' : 'Copy failed: the browser blocked clipboard access.', 'error');
    return false;
  }
}

export const copyCanvas = (canvas) => copyBlob(canvasToBlob(canvas, 'image/png'));

/** Copy an SVG string: as text, which design tools and editors accept. */
export async function copySvgText(svg) {
  try { await navigator.clipboard.writeText(svg); toast('SVG markup copied', 'success', 1800); }
  catch { toast('Copy failed: the browser blocked clipboard access.', 'error'); }
}

/* ---------- Files ---------- */

export const svgBlob = (svg) => new Blob([svg], { type: 'image/svg+xml' });
export const safeName = (s, fallback = 'image') => (String(s || '').replace(/\.[a-z0-9]+$/i, '').replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || fallback);

/** Zip `files` ([{ name, blob } | { name, text }]) and download it. */
export async function downloadZip(files, zipName) {
  const JSZip = await loadLib('jszip');
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.blob ?? f.text);
  const blob = await zip.generateAsync({ type: 'blob' });
  downloadBlob(blob, zipName);
  return blob;
}

/** Ask for a file with the native picker (for "Open JSON" style buttons). */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept });
    input.addEventListener('change', () => resolve(input.files[0] || null), { once: true });
    input.click();
  });
}

/* ---------- Export bar ---------- */

/**
 * The standard image export bar: Format (PNG/JPG/WebP[/SVG]), Scale, Quality, then Download and Copy.
 * Choices persist per tool (`id`). Formats the browser can't encode are disabled.
 *
 *   createImageExport(root, {
 *     id: 'mockup',                         // localStorage key
 *     getCanvas: (scale) => canvas,          // may be async; the image at that scale
 *     filename: () => 'mockup',              // without extension
 *     formats: ['png', 'jpg', 'webp'],       // order shown; add 'svg' with `svg`
 *     svg: async () => '<svg…>',             // SVG markup (vector export), optional
 *     scales: [1, 2, 4],                     // omit for no scale picker
 *     matte: () => '#fff',                   // JPG background
 *     enabled: () => bool,
 *     actions: [{ label, icon, onClick }],   // extra buttons
 *   });
 */
export function createImageExport(root, opts) {
  const { id, getCanvas, filename = () => 'image', formats = ['png', 'jpg', 'webp'], svg, scales, matte = () => '#ffffff', enabled = () => true } = opts;
  const saved = store.get(`img-export:${id}`, {});
  const st = { format: formats.includes(saved.format) ? saved.format : formats[0], scale: scales?.includes(saved.scale) ? saved.scale : scales?.[0] ?? 1, quality: saved.quality ?? 0.9 };
  const save = () => store.set(`img-export:${id}`, st);

  const fmtBtns = formats.map((f) => h('button', { type: 'button', 'data-v': f }, f === 'svg' ? 'SVG' : FORMATS[f].label));
  const fmtSeg = h('div', { class: 'segmented', role: 'group', 'aria-label': 'Format' }, fmtBtns);
  const scaleBtns = (scales || []).map((s) => h('button', { type: 'button', 'data-v': s }, `${s}×`));
  const scaleSeg = scales && h('div', { class: 'segmented', role: 'group', 'aria-label': 'Scale' }, scaleBtns);
  const qVal = h('span', { class: 'ctrl-value' });
  const qInput = h('input', { type: 'range', min: 0.3, max: 1, step: 0.01, 'aria-label': 'Quality' });
  const qWrap = h('label', { class: 'img-export-quality' }, h('span', {}, 'Quality'), qInput, qVal);
  const dlBtn = h('button', { type: 'button', class: 'btn btn-primary', html: `${icon('download')} Download` });
  const cpBtn = h('button', { type: 'button', class: 'btn', html: `${icon('copy')} Copy` });
  const extra = (opts.actions || []).map((a) => {
    const b = h('button', { type: 'button', class: 'btn', html: `${icon(a.icon || 'download')} ${a.label}` });
    b.addEventListener('click', () => a.onClick(b));
    return b;
  });
  const info = h('span', { class: 'hint' });
  root.classList.add('export-bar', 'img-export');
  root.replaceChildren(fmtSeg, scaleSeg || '', qWrap, h('span', { class: 'spacer' }), info, dlBtn, cpBtn, ...extra);

  function paint() {
    fmtBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === st.format)));
    scaleBtns.forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === st.scale)));
    qInput.value = st.quality;
    qInput.style.setProperty('--pct', `${((st.quality - 0.3) / 0.7) * 100}%`);
    qVal.textContent = `${Math.round(st.quality * 100)}`;
    qWrap.hidden = !FORMATS[st.format]?.lossy;
    if (scaleSeg) scaleSeg.hidden = st.format === 'svg';
    cpBtn.title = st.format === 'svg' ? 'Copy the SVG markup' : 'Copy as PNG';
    const on = enabled();
    dlBtn.disabled = cpBtn.disabled = !on;
    extra.forEach((b) => { b.disabled = !on; });
  }
  fmtBtns.forEach((b) => b.addEventListener('click', () => { if (b.disabled) return; st.format = b.dataset.v; save(); paint(); }));
  scaleBtns.forEach((b) => b.addEventListener('click', () => { st.scale = +b.dataset.v; save(); paint(); }));
  qInput.addEventListener('input', () => { st.quality = +qInput.value; save(); paint(); });

  // Disable formats this browser can't encode.
  formats.filter((f) => FORMATS[f]?.lossy).forEach(async (f) => {
    if (await canEncode(FORMATS[f].mime)) return;
    const b = fmtBtns[formats.indexOf(f)];
    b.disabled = true;
    b.title = `Your browser can’t encode ${FORMATS[f].label}`;
    if (st.format === f) { st.format = 'png'; paint(); }
  });

  dlBtn.addEventListener('click', async () => {
    try {
      dlBtn.disabled = true;
      if (st.format === 'svg') {
        downloadBlob(svgBlob(await svg()), `${filename()}.svg`);
        return;
      }
      const canvas = await getCanvas(st.scale);
      const blob = await encodeCanvas(canvas, st.format, st.quality, matte());
      const name = `${filename()}${scales && st.scale !== 1 ? `@${st.scale}x` : ''}.${FORMATS[st.format].ext}`;
      downloadBlob(blob, name);
      info.textContent = `${canvas.width}×${canvas.height} · ${formatBytes(blob.size)}`;
    } catch (err) {
      console.error(err);
      toast(err.message || 'Export failed.', 'error');
    } finally { paint(); }
  });
  cpBtn.addEventListener('click', async () => {
    if (st.format === 'svg') return copySvgText(await svg());
    // Build the blob promise synchronously inside the click for Safari.
    copyBlob(Promise.resolve(getCanvas(st.scale)).then((c) => canvasToBlob(c, 'image/png')));
  });

  paint();
  return { refresh: paint, state: st, setInfo: (t) => { info.textContent = t; } };
}
