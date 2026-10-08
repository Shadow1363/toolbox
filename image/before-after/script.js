/*
 * Before/After Slider: two images, size-matched (cover/contain into the Before frame) and optionally
 * auto-aligned, compared with a draggable divider. Exports a GIF or video of the divider sweeping back
 * and forth (createStage + createExportBar), a PNG, or embeddable HTML/CSS/JS.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * render(t) is the only drawing path. While the stage plays (or an export runs) the divider follows
 * sweep(t); otherwise it sits where the user dragged it.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { h, toast, downloadBlob, store } from '/assets/js/lib/dom.js';
import { createImageDrop, onPasteImages, canvasToBlob, copyCanvas, downloadZip } from '/assets/js/lib/image-io.js';
import { fit, outputSize, roundRectPath } from '/assets/js/lib/canvas.js';
import { ease, easingOptions } from '/assets/js/lib/easing.js';
import { copyText } from '/assets/js/lib/text-tool.js';

const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const ctx = canvas.getContext('2d');
const slots = { a: null, b: null }; // { el, width, height, name }
let demo = true;
let manual = 0.5;
let exporting = false;

/* ---------- Panel ---------- */
const saved = store.get('opts:before-after', {});
const keep = (id, v) => saved[id] ?? v;
const panel = createControls($('controls'), [
  { title: 'Layout', controls: [
    { id: 'dir', type: 'segmented', label: 'Divider', value: keep('dir', 'h'), options: [['h', 'Left / right'], ['v', 'Top / bottom']] },
    { id: 'match', type: 'segmented', label: 'Size match', value: keep('match', 'cover'), options: [['cover', 'Crop to fill'], ['contain', 'Fit inside']],
      hint: 'The After image is scaled into the Before image’s frame.' },
    { id: 'maxSide', type: 'select', label: 'Output size', value: keep('maxSide', '1600'), options: [['960', '960 px'], ['1280', '1280 px'], ['1600', '1600 px'], ['1920', '1920 px'], ['2560', '2560 px']] },
  ] },
  { title: 'Alignment', controls: [
    { id: 'align', type: 'button', text: 'Auto-align', onClick: () => autoAlign() },
    { id: 'dx', type: 'range', label: 'Shift X', min: -20, max: 20, step: 0.1, value: 0, unit: '%' },
    { id: 'dy', type: 'range', label: 'Shift Y', min: -20, max: 20, step: 0.1, value: 0, unit: '%' },
    { id: 'zoom', type: 'range', label: 'Scale', min: 80, max: 125, step: 0.5, value: 100, unit: '%', hint: 'Applied to the After image. Auto-align searches shift and scale.' },
  ] },
  { title: 'Labels', controls: [
    { id: 'labels', type: 'toggle', label: 'Show labels', value: keep('labels', true) },
    { id: 'labelA', type: 'text', label: 'Before label', value: keep('labelA', 'Before'), showIf: (st) => st.labels },
    { id: 'labelB', type: 'text', label: 'After label', value: keep('labelB', 'After'), showIf: (st) => st.labels },
    { id: 'labelPos', type: 'segmented', label: 'Position', value: keep('labelPos', 'top'), options: [['top', 'Top'], ['bottom', 'Bottom']], showIf: (st) => st.labels && st.dir === 'h' },
    { id: 'labelSize', type: 'range', label: 'Size', min: 16, max: 72, value: keep('labelSize', 32), unit: 'px', showIf: (st) => st.labels },
  ] },
  { title: 'Divider', controls: [
    { id: 'lineColor', type: 'color', label: 'Color', value: keep('lineColor', '#ffffff') },
    { id: 'lineWidth', type: 'range', label: 'Width', min: 1, max: 12, value: keep('lineWidth', 4), unit: 'px' },
    { id: 'handle', type: 'segmented', label: 'Handle', value: keep('handle', 'circle'), options: [['circle', 'Circle'], ['none', 'Line only']] },
  ] },
  { title: 'Animation', controls: [
    { id: 'duration', type: 'range', label: 'Length', min: 1.5, max: 10, step: 0.5, value: keep('duration', 4), unit: 's', hint: 'One full sweep there and back. GIF and video loop it.' },
    { id: 'from', type: 'range', label: 'From', min: 0, max: 50, value: keep('from', 10), unit: '%' },
    { id: 'to', type: 'range', label: 'To', min: 50, max: 100, value: keep('to', 90), unit: '%' },
    { id: 'hold', type: 'range', label: 'Pause at ends', min: 0, max: 40, value: keep('hold', 12), unit: '%' },
    { id: 'easing', type: 'select', label: 'Easing', value: keep('easing', 'easeInOut'), options: easingOptions.slice(0, 5) },
  ] },
], { onChange: (st, id) => {
  store.set('opts:before-after', Object.fromEntries(Object.entries(st).filter(([k]) => !['dx', 'dy', 'zoom'].includes(k))));
  if (id === 'maxSide' || id === 'match') resize();
  canvas.classList.toggle('is-vertical', st.dir === 'v');
  stage.invalidate();
} });
const s = panel.state;

/* ---------- Inputs ---------- */
function setSlot(key, m) {
  if (demo && m) { demo = false; slots.a = slots.a?.demo ? null : slots.a; slots.b = slots.b?.demo ? null : slots.b; $('note').hidden = true; }
  slots[key] = m ? { el: m.el, width: m.width, height: m.height, name: m.name } : null;
  if (!slots.a && !slots.b) loadDemo();
  panel.set({ dx: 0, dy: 0, zoom: 100 }, { silent: true });
  resize();
  if (slots.a && slots.b && !demo) autoAlign(true);
  exportBar.refresh();
}
const dzA = createImageDrop($('upload-a'), { label: 'Drop the Before image', paste: false, onLoad: (m) => setSlot('a', m), onClear: () => setSlot('a', null) });
const dzB = createImageDrop($('upload-b'), { label: 'Drop the After image', paste: false, onLoad: (m) => setSlot('b', m), onClear: () => setSlot('b', null) });
onPasteImages((files) => {
  if (files.length > 1) { dzA.load(files[0]); dzB.load(files[1]); return; }
  (!dzA.media ? dzA : dzB).load(files[0]);
}, { multiple: true });

/* ---------- Geometry ---------- */
function resize() {
  const base = slots.a || slots.b;
  if (!base) return;
  const { w, h: hh } = outputSize(base.width, base.height, +s.maxSide);
  canvas.width = w; canvas.height = hh;
  stage?.invalidate();
}

/** Where to draw image `m` into W×H: the Before image fills the frame; After is matched, then shifted/scaled. */
function placement(m, W, H, isAfter) {
  const f = fit(m.width, m.height, W, H, isAfter ? s.match : 'cover');
  if (!isAfter) return f;
  const k = s.zoom / 100;
  const w = f.w * k, hh = f.h * k;
  return { x: f.x - (w - f.w) / 2 + (s.dx / 100) * W, y: f.y - (hh - f.h) / 2 + (s.dy / 100) * H, w, h: hh };
}

/* ---------- Drawing ---------- */
function sweep(t) {
  const D = Math.max(0.1, s.duration);
  const p = (((t % D) + D) % D) / D;
  const hold = s.hold / 100;
  // 0 → 1 → 0 with a pause at each end; each move takes (1 - 2·hold)/2 of the cycle.
  const move = Math.max(0.01, (1 - 2 * hold) / 2);
  let u;
  if (p < move) u = p / move;
  else if (p < move + hold) u = 1;
  else if (p < 2 * move + hold) u = 1 - (p - move - hold) / move;
  else u = 0;
  const e = ease(s.easing, u);
  return (s.from + (s.to - s.from) * e) / 100;
}

function drawImageAt(c, m, W, H, isAfter) {
  if (!m) { c.fillStyle = '#2c2c2e'; c.fillRect(0, 0, W, H); return; }
  const p = placement(m, W, H, isAfter);
  c.imageSmoothingQuality = 'high';
  c.drawImage(m.el, p.x, p.y, p.w, p.h);
}

function label(c, text, x, y, align, k) {
  if (!text.trim()) return;
  const fs = s.labelSize * k * 1.4;
  c.font = `600 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const w = c.measureText(text).width + fs * 1.1, hh = fs * 1.7;
  const bx = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  c.fillStyle = 'rgba(0, 0, 0, 0.55)';
  c.beginPath(); roundRectPath(c, bx, y, w, hh, hh / 2); c.fill();
  c.fillStyle = '#ffffff'; c.textBaseline = 'middle'; c.textAlign = 'center';
  c.fillText(text, bx + w / 2, y + hh / 2 + fs * 0.03);
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const pos = stage?.playing || exporting ? sweep(t) : manual;
  paint(ctx, W, H, pos);
}

function paint(c, W, H, pos) {
  const k = Math.min(W, H) / 1080;
  const vert = s.dir === 'v';
  c.clearRect(0, 0, W, H);
  // Before everywhere, After clipped to the far side of the divider.
  drawImageAt(c, slots.a, W, H, false);
  c.save();
  c.beginPath();
  if (vert) c.rect(0, H * pos, W, H - H * pos); else c.rect(W * pos, 0, W - W * pos, H);
  c.clip();
  if (s.match === 'contain') { c.fillStyle = '#000'; c.fillRect(0, 0, W, H); }
  drawImageAt(c, slots.b, W, H, true);
  c.restore();

  if (s.labels) {
    const m = 28 * k * 1.4;
    const lh = s.labelSize * k * 1.4 * 1.7;
    if (vert) {
      c.save(); c.beginPath(); c.rect(0, 0, W, H * pos); c.clip(); label(c, s.labelA, W / 2, m, 'center', k); c.restore();
      c.save(); c.beginPath(); c.rect(0, H * pos, W, H); c.clip(); label(c, s.labelB, W / 2, H - m - lh, 'center', k); c.restore();
    } else {
      const y = s.labelPos === 'top' ? m : H - m - lh;
      c.save(); c.beginPath(); c.rect(0, 0, W * pos, H); c.clip(); label(c, s.labelA, m, y, 'left', k); c.restore();
      c.save(); c.beginPath(); c.rect(W * pos, 0, W, H); c.clip(); label(c, s.labelB, W - m, y, 'right', k); c.restore();
    }
  }

  // Divider + handle
  const lw = Math.max(1, s.lineWidth * k * 1.4);
  c.fillStyle = s.lineColor;
  c.shadowColor = 'rgba(0,0,0,0.35)'; c.shadowBlur = 8 * k;
  if (vert) c.fillRect(0, H * pos - lw / 2, W, lw); else c.fillRect(W * pos - lw / 2, 0, lw, H);
  if (s.handle === 'circle') {
    const r = 34 * k * 1.4, cx = vert ? W / 2 : W * pos, cy = vert ? H * pos : H / 2;
    c.beginPath(); c.arc(cx, cy, r, 0, Math.PI * 2); c.fill();
    c.shadowColor = 'transparent';
    c.fillStyle = '#1d1d1f';
    const a = r * 0.32, g = r * 0.42;
    c.save(); c.translate(cx, cy); if (vert) c.rotate(Math.PI / 2);
    c.beginPath(); c.moveTo(-g - a * 0.2, 0); c.lineTo(-g + a * 0.8, -a); c.lineTo(-g + a * 0.8, a); c.closePath(); c.fill();
    c.beginPath(); c.moveTo(g + a * 0.2, 0); c.lineTo(g - a * 0.8, -a); c.lineTo(g - a * 0.8, a); c.closePath(); c.fill();
    c.restore();
  }
  c.shadowColor = 'transparent';
}

/* ---------- Stage + export ---------- */
const stage = createStage({
  canvas,
  transport: $('transport'),
  render,
  getDuration: () => s.duration,
});
const ready = () => !!(slots.a && slots.b);
const exportBar = createExportBar($('export'), {
  stage,
  filename: () => 'before-after',
  video: ready, gif: ready, png: ready,
  primary: 'gif',
  beforeExport: () => { exporting = true; },
  afterExport: () => { exporting = false; stage.invalidate(); },
  actions: [
    { label: 'Embed code', icon: 'copy', onClick: () => openEmbed() },
    { label: 'Copy image', icon: 'copy', onClick: () => copyCanvas(canvas) },
  ],
});

/* ---------- Dragging ---------- */
let dragging = false;
function setFromPointer(e) {
  const r = canvas.getBoundingClientRect();
  manual = Math.max(0, Math.min(1, s.dir === 'v' ? (e.clientY - r.top) / r.height : (e.clientX - r.left) / r.width));
  stage.invalidate();
}
canvas.addEventListener('pointerdown', (e) => { if (e.button) return; dragging = true; stage.pause(); canvas.setPointerCapture(e.pointerId); setFromPointer(e); });
canvas.addEventListener('pointermove', (e) => { if (dragging) setFromPointer(e); });
canvas.addEventListener('pointerup', () => { dragging = false; });
canvas.addEventListener('pointercancel', () => { dragging = false; });

/* ---------- Auto-align ---------- */
/** Edge map (gradient magnitude) of `m` drawn as placed, at w×h. Edges survive exposure/colour edits. */
function edges(m, w, hh, isAfter, W, H, opts) {
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#808080'; x.fillRect(0, 0, w, hh);
  const sc = w / W;
  const p = isAfter ? placementWith(m, W, H, opts) : placement(m, W, H, false);
  x.drawImage(m.el, p.x * sc, p.y * sc, p.w * sc, p.h * sc);
  const d = x.getImageData(0, 0, w, hh).data;
  const g = new Float32Array(w * hh);
  const lum = (i) => d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  for (let yy = 1; yy < hh - 1; yy++) for (let xx = 1; xx < w - 1; xx++) {
    const i = yy * w + xx;
    g[i] = Math.abs(lum(i + 1) - lum(i - 1)) + Math.abs(lum(i + w) - lum(i - w));
  }
  return g;
}
function placementWith(m, W, H, { dx, dy, zoom }) {
  const f = fit(m.width, m.height, W, H, s.match);
  const w = f.w * zoom, hh = f.h * zoom;
  return { x: f.x - (w - f.w) / 2 + dx * W, y: f.y - (hh - f.h) / 2 + dy * H, w, h: hh };
}

function autoAlign(quiet = false) {
  if (!ready()) { if (!quiet) toast('Add both images first.'); return; }
  const W = canvas.width, H = canvas.height;
  const w = 160, hh = Math.max(16, Math.round((160 * H) / W));
  const A = edges(slots.a, w, hh, false, W, H);
  const R = 14; // search ±R px at 160 px wide (±~9%)
  let best = { score: Infinity, dx: 0, dy: 0, zoom: 1 };
  for (const zoom of [0.94, 0.97, 1, 1.03, 1.06]) {
    const B = edges(slots.b, w, hh, true, W, H, { dx: 0, dy: 0, zoom });
    for (let oy = -R; oy <= R; oy++) for (let ox = -R; ox <= R; ox++) {
      let sum = 0, n = 0;
      for (let yy = 2 + Math.max(0, oy); yy < hh - 2 + Math.min(0, oy); yy += 2) {
        const ra = yy * w, rb = (yy - oy) * w;
        for (let xx = 2 + Math.max(0, ox); xx < w - 2 + Math.min(0, ox); xx += 2) { sum += Math.abs(A[ra + xx] - B[rb + xx - ox]); n++; }
      }
      const score = n ? sum / n + (Math.abs(ox) + Math.abs(oy)) * 0.02 + Math.abs(zoom - 1) * 4 : Infinity;
      if (score < best.score) best = { score, dx: ox / w, dy: oy / hh, zoom };
    }
  }
  panel.set({ dx: +(best.dx * 100).toFixed(1), dy: +(best.dy * 100).toFixed(1), zoom: +(best.zoom * 100).toFixed(1) });
  if (!quiet) toast(best.dx || best.dy || best.zoom !== 1 ? `Aligned: shifted ${(best.dx * 100).toFixed(1)}%, ${(best.dy * 100).toFixed(1)}%, scale ${Math.round(best.zoom * 100)}%` : 'Already aligned.', 'success');
}

/* ---------- Embed code ---------- */
async function frameData(which, type = 'image/jpeg') {
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  const x = c.getContext('2d');
  if (which === 'b' && s.match === 'contain') { x.fillStyle = '#000'; x.fillRect(0, 0, c.width, c.height); }
  drawImageAt(x, slots[which], c.width, c.height, which === 'b');
  return canvasToBlob(c, type, 0.86);
}
const blobToDataUrl = (b) => new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); });
const escAttr = (t) => t.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function embedHtml(srcA, srcB) {
  const v = s.dir === 'v';
  const lab = s.labels ? `\n  <span class="ba-label ba-label-a">${escAttr(s.labelA)}</span>\n  <span class="ba-label ba-label-b">${escAttr(s.labelB)}</span>` : '';
  const pos = v ? 'left: 50%; transform: translateX(-50%);' : '';
  const lp = v ? '' : s.labelPos === 'top' ? 'top: 12px;' : 'bottom: 12px;';
  return `<!-- Before/After slider · made with tools.tomasmartinez.xyz -->
<div class="ba-slider${v ? ' ba-vertical' : ''}" style="--pos: 50%; aspect-ratio: ${canvas.width} / ${canvas.height};">
  <img class="ba-img" src="${srcA}" alt="${escAttr(s.labelA || 'Before')}">
  <img class="ba-img ba-after" src="${srcB}" alt="${escAttr(s.labelB || 'After')}">${lab}
  <div class="ba-line" aria-hidden="true"></div>
  <input class="ba-range" type="range" min="0" max="100" step="0.1" value="50" aria-label="Move the divider">
</div>
<style>
  .ba-slider { position: relative; width: 100%; max-width: ${canvas.width}px; overflow: hidden; user-select: none; touch-action: ${v ? 'pan-x' : 'pan-y'}; }
  .ba-slider .ba-img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; display: block; pointer-events: none; }
  .ba-slider .ba-after { clip-path: inset(${v ? 'var(--pos) 0 0 0' : '0 0 0 var(--pos)'}); }
  .ba-slider .ba-line { position: absolute; ${v ? 'left: 0; right: 0; top: var(--pos); height' : 'top: 0; bottom: 0; left: var(--pos); width'}: ${s.lineWidth}px; ${v ? 'margin-top' : 'margin-left'}: -${s.lineWidth / 2}px; background: ${s.lineColor}; box-shadow: 0 0 6px rgba(0,0,0,.35); pointer-events: none; }
  ${s.handle === 'circle' ? `.ba-slider .ba-line::after { content: "${v ? '⇕' : '⇔'}"; position: absolute; top: 50%; left: 50%; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; background: ${s.lineColor}; color: #1d1d1f; display: grid; place-items: center; font: 700 20px/1 sans-serif; box-shadow: 0 2px 8px rgba(0,0,0,.35); }` : ''}
  .ba-slider .ba-range { position: absolute; inset: 0; width: 100%; height: 100%; margin: 0; opacity: 0; cursor: ${v ? 'ns-resize' : 'ew-resize'};${v ? ' writing-mode: vertical-lr; direction: ltr;' : ''} }
  .ba-slider .ba-label { position: absolute; ${lp} padding: 4px 12px; border-radius: 999px; background: rgba(0,0,0,.55); color: #fff; font: 600 14px/1.4 system-ui, sans-serif; pointer-events: none; }
  .ba-slider .ba-label-a { ${v ? `top: 12px; ${pos}` : 'left: 12px;'} }
  .ba-slider .ba-label-b { ${v ? `bottom: 12px; ${pos}` : 'right: 12px;'} }
  .ba-slider:has(.ba-range:focus-visible) { outline: 2px solid #2997ff; outline-offset: 2px; }
</style>
<script>
  document.querySelectorAll('.ba-slider').forEach(function (el) {
    var range = el.querySelector('.ba-range');
    function set() { el.style.setProperty('--pos', range.value + '%'); }
    range.addEventListener('input', set);
    set();
  });
</script>
`;
}

async function openEmbed() {
  if (!ready()) return toast('Add both images first.');
  let mode = 'inline';
  const area = h('textarea', { readonly: true, spellcheck: 'false', 'aria-label': 'Embed code' });
  const note = h('p', { class: 'io-note' });
  const [a, b] = await Promise.all([frameData('a'), frameData('b')]);
  const inline = embedHtml(await blobToDataUrl(a), await blobToDataUrl(b));
  const files = embedHtml('before.jpg', 'after.jpg');
  const show = () => {
    area.value = mode === 'inline' ? inline : files;
    note.textContent = mode === 'inline'
      ? `Images are embedded as data URIs (${Math.round(inline.length / 1024)} KB of code). One paste, no other files.`
      : 'References before.jpg and after.jpg next to the page. Download the ZIP for the images.';
    seg.querySelectorAll('button').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.v === mode)));
  };
  const seg = h('div', { class: 'segmented' },
    h('button', { type: 'button', 'data-v': 'inline', onclick: () => { mode = 'inline'; show(); } }, 'Images inline'),
    h('button', { type: 'button', 'data-v': 'files', onclick: () => { mode = 'files'; show(); } }, 'Separate files'));
  const close = () => modal.remove();
  const modal = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Embed code', onclick: (e) => { if (e.target === modal) close(); } },
    h('div', { class: 'modal ba-embed' },
      h('h2', {}, 'Embed code'),
      h('p', {}, 'A dependency-free slider (HTML, CSS and a few lines of JS) with the aligned images. Keyboard accessible.'),
      seg, area, note,
      h('div', { class: 'modal-actions' },
        h('button', { type: 'button', class: 'btn', onclick: close }, 'Close'),
        h('button', { type: 'button', class: 'btn', onclick: () => (mode === 'inline'
          ? downloadBlob(new Blob([`<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Before / After</title>\n${inline}`], { type: 'text/html' }), 'before-after.html')
          : downloadZip([{ name: 'before-after.html', text: `<!doctype html>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>Before / After</title>\n${files}` }, { name: 'before.jpg', blob: a }, { name: 'after.jpg', blob: b }], 'before-after.zip')) }, mode === 'inline' ? 'Download .html' : 'Download .zip'),
        h('button', { type: 'button', class: 'btn btn-primary', onclick: () => copyText(area.value, 'Embed code copied') }, 'Copy code'))));
  // The download button label follows the mode.
  const dl = modal.querySelectorAll('.modal-actions .btn')[1];
  seg.addEventListener('click', () => { dl.textContent = mode === 'inline' ? 'Download .html' : 'Download .zip'; });
  document.body.append(modal);
  show();
  area.focus();
  area.scrollTop = 0;
}

/* ---------- Demo ---------- */
function loadDemo() {
  demo = true;
  $('note').hidden = false;
  const W = 1280, H = 800;
  const scene = document.createElement('canvas');
  scene.width = W; scene.height = H;
  const x = scene.getContext('2d');
  const sky = x.createLinearGradient(0, 0, 0, H * 0.62);
  sky.addColorStop(0, '#2f80ed'); sky.addColorStop(1, '#9ad7ff');
  x.fillStyle = sky; x.fillRect(0, 0, W, H);
  x.fillStyle = '#fff6c9'; x.beginPath(); x.arc(W * 0.78, H * 0.22, 70, 0, 7); x.fill();
  const hills = [['#2e8b57', 0.62, 0.0], ['#3fa66a', 0.7, 1.7], ['#5cc77e', 0.8, 3.1]];
  for (const [col, base, ph] of hills) {
    x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
    for (let i = 0; i <= 64; i++) x.lineTo((i / 64) * W, H * base - Math.sin(i / 8 + ph) * 40 - Math.sin(i / 3 + ph) * 12);
    x.lineTo(W, H); x.fill();
  }
  x.fillStyle = '#7a4b2a'; x.fillRect(W * 0.2, H * 0.52, 18, 90);
  x.fillStyle = '#1f7a45'; x.beginPath(); x.arc(W * 0.2 + 9, H * 0.5, 60, 0, 7); x.fill();
  const before = document.createElement('canvas');
  before.width = W; before.height = H;
  const bx = before.getContext('2d');
  bx.filter = 'grayscale(0.85) contrast(0.75) brightness(0.9) blur(1.5px)';
  bx.drawImage(scene, 0, 0);
  bx.filter = 'none';
  slots.a = { el: before, width: W, height: H, name: 'before', demo: true };
  slots.b = { el: scene, width: W, height: H, name: 'after', demo: true };
}

loadDemo();
resize();
canvas.classList.toggle('is-vertical', s.dir === 'v');
exportBar.refresh();
