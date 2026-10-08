/*
 * Image Compressor: batch resize + re-encode (JPG, WebP, AVIF, PNG) with a before/after slider,
 * per-image and total savings, single downloads and a ZIP.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Images decode through <img> (EXIF orientation applied), draw onto a canvas at the target size and
 * re-encode with canvas.toBlob, which drops all metadata. PNG with fewer colors goes through UPNG
 * (lossy palette PNG, loaded on demand). "Keep EXIF" copies a JPEG's Exif block into a JPEG output,
 * with the orientation reset because the pixels are already upright.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { h, icon, toast, downloadBlob, formatBytes, store } from '/assets/js/lib/dom.js';
import { onPasteImages, pasteButton, blobToImage, canEncode, canvasToBlob, copyBlob, downloadZip, FORMATS, safeName } from '/assets/js/lib/image-io.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { debounce } from '/assets/js/lib/text-tool.js';

const $ = (id) => document.getElementById(id);
const MAX_BYTES = 100 * 1024 * 1024;
const items = []; // { id, file, url, img, w, h, status, out: { blob, url, w, h, format }, error, useOriginal }
let active = null;
let nextId = 1;
let runToken = 0;

/* ---------- Settings ---------- */
const saved = store.get('opts:compressor', {});
const panel = createControls($('controls'), [
  { title: 'Format', controls: [
    { id: 'format', type: 'select', label: 'Convert to', value: saved.format ?? 'webp', options: [['same', 'Same as original'], ['jpg', 'JPG'], ['webp', 'WebP'], ['avif', 'AVIF'], ['png', 'PNG']] },
    { id: 'quality', type: 'range', label: 'Quality', min: 10, max: 100, value: saved.quality ?? 80, showIf: (s) => s.format !== 'png' },
    { id: 'pngColors', type: 'select', label: 'PNG colors', value: saved.pngColors ?? '0', showIf: (s) => s.format === 'png' || s.format === 'same',
      options: [['0', 'All (lossless)'], ['256', '256 (smaller, lossy)'], ['128', '128'], ['64', '64'], ['32', '32']],
      hint: 'Fewer colors makes PNGs much smaller; good for screenshots and graphics.' },
    { id: 'matte', type: 'color', label: 'JPG background', value: saved.matte ?? '#ffffff', showIf: (s) => s.format === 'jpg' || s.format === 'same', hint: 'JPG has no transparency; clear pixels get this color.' },
  ] },
  { title: 'Resize', controls: [
    { id: 'resize', type: 'segmented', label: 'Mode', value: saved.resize ?? 'none', options: [['none', 'Original'], ['max', 'Max size'], ['pct', 'Percent']] },
    { id: 'maxW', type: 'number', label: 'Max width (px)', min: 1, max: 20000, value: saved.maxW ?? 1920, showIf: (s) => s.resize === 'max' },
    { id: 'maxH', type: 'number', label: 'Max height (px)', min: 1, max: 20000, value: saved.maxH ?? 1920, showIf: (s) => s.resize === 'max', hint: 'Images keep their aspect ratio and are never enlarged.' },
    { id: 'pct', type: 'range', label: 'Scale', min: 5, max: 100, value: saved.pct ?? 50, unit: '%', showIf: (s) => s.resize === 'pct' },
  ] },
  { title: 'Options', controls: [
    { id: 'strip', type: 'toggle', label: 'Strip metadata', value: saved.strip ?? true, hint: 'Removes EXIF (camera, GPS location, date). Turning this off keeps EXIF only for JPG → JPG.' },
    { id: 'keepSmaller', type: 'toggle', label: 'Keep the original if it’s smaller', value: saved.keepSmaller ?? true },
  ] },
], { onChange: (s) => { store.set('opts:compressor', s); scheduleAll(); } });
const s = panel.state;

// AVIF/WebP encoders vary by browser: say so up front.
(async () => {
  const notes = [];
  if (!(await canEncode('image/avif'))) notes.push('AVIF');
  if (!(await canEncode('image/webp'))) notes.push('WebP');
  if (notes.length) {
    const sel = document.getElementById('c-format');
    notes.forEach((n) => { const o = sel.querySelector(`option[value="${n.toLowerCase()}"]`); if (o) { o.disabled = true; o.textContent += ' (not supported here)'; } });
    if (notes.map((n) => n.toLowerCase()).includes(s.format)) panel.set({ format: 'jpg' });
  }
})();

/* ---------- Input ---------- */
createFilePicker($('upload'), { multiple: true, accept: 'image/*', label: 'Drop images', hint: 'as many as you like', onFiles: add });
$('upload').append(h('div', { class: 'img-paste-row' }, h('span', { class: 'ctrl-hint' }, 'or paste with Ctrl/⌘+V'), pasteButton(add, { multiple: true })));
onPasteImages(add, { multiple: true });

async function add(files) {
  const imgs = files.filter((f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|avif|gif|bmp|svg)$/i.test(f.name));
  if (imgs.length < files.length) toast(`Skipped ${files.length - imgs.length} file(s) that aren't images.`, 'warning');
  for (const file of imgs) {
    if (file.size > MAX_BYTES) { toast(`“${file.name}” is over ${formatBytes(MAX_BYTES)}.`, 'error'); continue; }
    const it = { id: nextId++, file, url: URL.createObjectURL(file), status: 'pending' };
    items.push(it);
    try {
      it.img = await blobToImage(file);
      it.w = it.img.naturalWidth; it.h = it.img.naturalHeight;
      if (!it.w) throw new Error('no size');
    } catch {
      it.status = 'error'; it.error = 'Couldn’t decode this image here.';
    }
    if (!active) select(it);
    renderList();
    queue(it);
  }
}

/* ---------- Processing ---------- */
const pending = [];
let working = false;
function queue(it) { if (it.status !== 'error' || it.img) { it.status = 'pending'; if (!pending.includes(it)) pending.push(it); } pump(); }
const scheduleAll = debounce(() => { runToken++; items.forEach((it) => it.img && queue(it)); renderList(); }, 250);

async function pump() {
  if (working) return;
  working = true;
  try {
    while (pending.length) {
      const it = pending.shift();
      if (!items.includes(it)) continue;
      it.status = 'working'; renderItem(it);
      const token = runToken;
      try {
        const out = await compress(it);
        if (token !== runToken && pending.includes(it)) continue; // settings changed mid-way; a fresh run is queued
        if (it.out?.url) URL.revokeObjectURL(it.out.url);
        it.out = { ...out, url: URL.createObjectURL(out.blob) };
        it.status = 'done'; it.error = null;
      } catch (err) {
        console.error(err);
        it.status = 'error'; it.error = err.message || 'Compression failed.';
      }
      renderItem(it);
      if (it === active) showCompare();
      renderSummary();
      await new Promise((r) => setTimeout(r));
    }
  } finally { working = false; }
}

function targetFormat(file) {
  if (s.format !== 'same') return s.format;
  const t = file.type;
  if (t === 'image/jpeg') return 'jpg';
  if (t === 'image/webp') return 'webp';
  if (t === 'image/avif') return 'avif';
  return 'png'; // png, gif, bmp, svg
}

function targetSize(w, hh) {
  if (s.resize === 'pct') return [Math.max(1, Math.round(w * s.pct / 100)), Math.max(1, Math.round(hh * s.pct / 100))];
  if (s.resize === 'max') {
    const k = Math.min(1, (s.maxW || w) / w, (s.maxH || hh) / hh);
    return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(hh * k))];
  }
  return [w, hh];
}

async function compress(it) {
  let format = targetFormat(it.file);
  if (FORMATS[format].lossy && !(await canEncode(FORMATS[format].mime))) format = format === 'avif' && (await canEncode('image/webp')) ? 'webp' : 'jpg';
  const [w, hh] = targetSize(it.w, it.h);
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d', { willReadFrequently: format === 'png' });
  if (format === 'jpg') { x.fillStyle = s.matte; x.fillRect(0, 0, w, hh); }
  x.imageSmoothingQuality = 'high';
  drawDownscaled(x, it.img, w, hh);

  let blob;
  if (format === 'png' && +s.pngColors > 0) blob = await palettePng(x, w, hh, +s.pngColors);
  else blob = await canvasToBlob(c, FORMATS[format].mime, FORMATS[format].lossy ? s.quality / 100 : undefined);
  if (format === 'jpg' && !s.strip && it.file.type === 'image/jpeg') blob = await withExif(it.file, blob);

  const useOriginal = s.keepSmaller && blob.size >= it.file.size && w === it.w && hh === it.h;
  return { blob: useOriginal ? it.file : blob, w, h: hh, format: useOriginal ? extOf(it.file) : format, useOriginal };
}

const extOf = (file) => ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/bmp': 'bmp' })[file.type] || (file.name.split('.').pop() || 'img').toLowerCase();

/** Halve in steps before the final draw: one big drawImage downscale aliases badly in some browsers. */
function drawDownscaled(x, img, w, hh) {
  let src = img, sw = img.naturalWidth, sh = img.naturalHeight;
  while (sw / 2 >= w * 1.5 && sh / 2 >= hh * 1.5) {
    const c = document.createElement('canvas');
    c.width = Math.round(sw / 2); c.height = Math.round(sh / 2);
    const cx = c.getContext('2d');
    cx.imageSmoothingQuality = 'high';
    cx.drawImage(src, 0, 0, c.width, c.height);
    src = c; sw = c.width; sh = c.height;
  }
  x.drawImage(src, 0, 0, w, hh);
}

async function palettePng(x, w, hh, colors) {
  await loadLib('pako');
  const UPNG = await loadLib('upng');
  const { data } = x.getImageData(0, 0, w, hh);
  return new Blob([UPNG.encode([data.buffer], w, hh, colors)], { type: 'image/png' });
}

/* ---------- EXIF (JPEG → JPEG) ---------- */
/** Copy the APP1 Exif segment of `src` into `out` (both JPEG), with Orientation set to 1. */
async function withExif(src, out) {
  const a = new Uint8Array(await src.slice(0, 256 * 1024).arrayBuffer());
  let exif = null;
  for (let i = 2; i + 4 < a.length && a[i] === 0xff;) {
    const marker = a[i + 1], len = (a[i + 2] << 8) | a[i + 3];
    if (marker === 0xe1 && a[i + 4] === 0x45 && a[i + 5] === 0x78 && a[i + 6] === 0x69 && a[i + 7] === 0x66) { exif = a.slice(i, i + 2 + len); break; }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  if (!exif) return out;
  resetOrientation(exif);
  const b = new Uint8Array(await out.arrayBuffer());
  // Insert right after SOI (and after JFIF APP0 if present).
  let at = 2;
  if (b[2] === 0xff && b[3] === 0xe0) at = 4 + ((b[4] << 8) | b[5]);
  return new Blob([b.subarray(0, at), exif, b.subarray(at)], { type: 'image/jpeg' });
}

function resetOrientation(seg) {
  const t = 10; // TIFF header starts after FFE1 len(2) "Exif\0\0"
  const le = seg[t] === 0x49;
  const u16 = (o) => (le ? seg[o] | (seg[o + 1] << 8) : (seg[o] << 8) | seg[o + 1]);
  const u32 = (o) => (le ? (seg[o] | (seg[o + 1] << 8) | (seg[o + 2] << 16) | (seg[o + 3] << 24)) >>> 0 : ((seg[o] << 24) | (seg[o + 1] << 16) | (seg[o + 2] << 8) | seg[o + 3]) >>> 0);
  const ifd = t + u32(t + 4);
  if (ifd + 2 > seg.length) return;
  const n = u16(ifd);
  for (let i = 0; i < n; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > seg.length) return;
    if (u16(e) === 0x0112) { const v = e + 8; if (le) { seg[v] = 1; seg[v + 1] = 0; } else { seg[v] = 0; seg[v + 1] = 1; } return; }
  }
}

/* ---------- List ---------- */
const nameFor = (it) => `${safeName(it.file.name)}.${it.out?.format === 'jpg' ? 'jpg' : it.out?.format || 'img'}`;
const delta = (it) => (it.out ? 1 - it.out.blob.size / it.file.size : 0);

function renderList() {
  $('list').replaceChildren(...items.map((it) => (it.li = buildItem(it))));
  renderSummary();
  const empty = !items.length;
  $('empty').hidden = !empty;
  $('viewer').classList.toggle('is-empty', empty);
}

function buildItem(it) {
  const li = h('li', { class: `cmp-item${it === active ? ' is-active' : ''}`, onclick: () => select(it) });
  fillItem(it, li);
  return li;
}
function renderItem(it) { if (it.li) fillItem(it, it.li); }
function fillItem(it, li) {
  const status = it.status === 'error' ? h('span', { class: 'delta err' }, it.error)
    : it.status !== 'done' ? h('span', {}, it.status === 'working' ? 'Compressing…' : 'Waiting…')
      : h('span', {},
        `${formatBytes(it.file.size)} → ${formatBytes(it.out.blob.size)} · ${it.out.w}×${it.out.h} ${it.out.format.toUpperCase()} · `,
        it.out.useOriginal ? h('span', { class: 'delta bad', title: 'Re-encoding made it bigger, so the original is kept' }, 'kept original')
          : h('span', { class: `delta ${delta(it) >= 0 ? 'good' : 'bad'}` }, delta(it) >= 0 ? `−${Math.round(delta(it) * 100)}%` : `+${Math.round(-delta(it) * 100)}%`));
  const btn = (ic, title, fn, disabled) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title, 'aria-label': title, disabled, html: icon(ic), onclick: (e) => { e.stopPropagation(); fn(); } });
  li.replaceChildren(
    h('img', { src: it.url, alt: '', loading: 'lazy' }),
    h('div', { class: 'meta' }, h('strong', { title: it.file.name }, it.file.name), status),
    h('div', { class: 'acts' },
      btn('download', 'Download', () => downloadBlob(it.out.blob, nameFor(it)), it.status !== 'done'),
      btn('copy', 'Copy image', () => copyResult(it), it.status !== 'done'),
      btn('trash', 'Remove', () => remove(it))));
}

function renderSummary() {
  const done = items.filter((it) => it.status === 'done');
  if (!items.length) return $('summary').replaceChildren();
  const before = done.reduce((a, it) => a + it.file.size, 0), after = done.reduce((a, it) => a + it.out.blob.size, 0);
  const busy = items.length - done.length - items.filter((it) => it.status === 'error').length;
  $('summary').replaceChildren(
    h('span', {}, `${done.length} of ${items.length} done${busy ? ` · ${busy} working` : ''}`),
    done.length > 0 && h('span', {}, `${formatBytes(before)} → ${formatBytes(after)}`),
    done.length > 0 && h('span', { class: 'saved' }, before ? `saved ${formatBytes(Math.max(0, before - after))} (${Math.round((1 - after / before) * 100)}%)` : ''),
    h('span', { class: 'spacer' }),
    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', html: `${icon('trash')} Clear all`, onclick: clearAll }),
    h('button', { type: 'button', class: 'btn btn-primary', disabled: !done.length, html: `${icon('archive')} Download all (.zip)`, onclick: zipAll }));
}

function select(it) {
  active = it;
  items.forEach((x) => x.li?.classList.toggle('is-active', x === it));
  showCompare();
}

function remove(it) {
  const i = items.indexOf(it);
  if (i < 0) return;
  items.splice(i, 1);
  URL.revokeObjectURL(it.url);
  if (it.out?.url) URL.revokeObjectURL(it.out.url);
  if (active === it) { active = null; if (items.length) select(items[Math.min(i, items.length - 1)]); else showCompare(); }
  renderList();
}
function clearAll() { [...items].forEach(remove); }

async function zipAll() {
  const used = new Map();
  const files = items.filter((it) => it.status === 'done').map((it) => {
    let n = nameFor(it);
    const c = used.get(n) || 0;
    used.set(n, c + 1);
    if (c) n = n.replace(/(\.\w+)$/, `-${c + 1}$1`);
    return { name: n, blob: it.out.blob };
  });
  try { await downloadZip(files, 'compressed-images.zip'); } catch (err) { toast(err.message, 'error'); }
}

/** Clipboards only accept PNG, so the result is copied as PNG at its new size. */
function copyResult(it) {
  copyBlob((async () => {
    if (it.out.blob.type === 'image/png') return it.out.blob;
    const img = await blobToImage(it.out.blob);
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return canvasToBlob(c, 'image/png');
  })());
}

/* ---------- Compare ---------- */
const stage = $('stage'), wrap = $('wrap');
let zoom = 'fit';
function showCompare() {
  const it = active;
  $('before').src = it ? it.url : '';
  $('after').src = it?.out ? it.out.url : it ? it.url : '';
  $('tag-before').textContent = it ? `Original · ${formatBytes(it.file.size)}` : '';
  $('tag-after').textContent = it?.out ? `${it.out.format.toUpperCase()} · ${formatBytes(it.out.blob.size)}` : '';
  applyZoom();
}
function applyZoom() {
  const it = active;
  stage.classList.toggle('is-zoomed', zoom !== 'fit' && !!it);
  if (it && zoom !== 'fit') {
    wrap.style.setProperty('--zw', `${it.w * +zoom}px`);
    wrap.style.setProperty('--zh', `${it.h * +zoom}px`);
  }
}
$('zoom').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  zoom = b.dataset.v;
  $('zoom').querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  applyZoom();
});
let dragging = false;
const setSplit = (e) => {
  const r = wrap.getBoundingClientRect();
  wrap.style.setProperty('--split', `${Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100))}%`);
};
stage.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; dragging = true; stage.setPointerCapture(e.pointerId); setSplit(e); });
stage.addEventListener('pointermove', (e) => { if (dragging) setSplit(e); });
stage.addEventListener('pointerup', () => { dragging = false; });
stage.addEventListener('pointercancel', () => { dragging = false; });

renderList();
