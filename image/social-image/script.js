/*
 * Social Image Maker: a small layered editor (text, images, shapes, background) on platform-sized
 * templates, with safe-area guides, snapping, undo/redo, autosave and saved designs.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * #doc is drawn by model.renderDoc at template pixels (CSS-scaled to fit); #overlay sits on top
 * (40 px larger on each side) for selection, handles, guides and snap lines, so none of it is exported.
 * Edits: checkpoint() before a change (undo snapshot), changed() after (redraw, autosave).
 */
import { h, icon, toast, downloadBlob, store } from '/assets/js/lib/dom.js';
import { createImageExport, onPasteImages, pickFile, loadImage, safeName, blobToImage } from '/assets/js/lib/image-io.js';
import { FONTS, ensureFont } from '/assets/js/lib/fonts.js';
import { kvGet, kvSet, autosaver } from '/assets/js/lib/kv.js';
import { TEMPLATES, template, starter, newId, renderDoc, textHeight, toLocal, toWorld, hit, center } from './model.js';

const $ = (id) => document.getElementById(id);
const docCanvas = $('doc'), overlay = $('overlay'), board = $('board'), viewport = $('viewport');
const M = 40; // overlay margin (css px)

let doc = starter('yt-thumb');
let assets = {};              // id → dataURL
const images = new Map();     // id → <img>
let selId = null;
let z = 1;                    // css px per doc px
let showGuides = store.get('social-image:guides', true);
let snapLines = [];
const undo = [], redo = [];

const sel = () => doc.layers.find((l) => l.id === selId) || null;

/* ---------- History & persistence ---------- */
const snapshot = () => JSON.stringify(doc);
function checkpoint() {
  undo.push(snapshot());
  if (undo.length > 100) undo.shift();
  redo.length = 0;
  syncToolbar();
}
function restore(json) {
  doc = JSON.parse(json);
  if (!sel()) selId = null;
  structureChanged();
}
function doUndo() { if (!undo.length) return; redo.push(snapshot()); restore(undo.pop()); }
function doRedo() { if (!redo.length) return; undo.push(snapshot()); restore(redo.pop()); }

const autosave = autosaver('social-image:current', () => ({ doc, assets: usedAssets() }), 800);
function usedAssets() {
  const ids = new Set(doc.layers.map((l) => l.asset).filter(Boolean));
  if (doc.bg.asset) ids.add(doc.bg.asset);
  return Object.fromEntries([...ids].filter((id) => assets[id]).map((id) => [id, assets[id]]));
}

/** After any edit: reflow text, redraw, save. */
function changed() {
  for (const L of doc.layers) if (L.type === 'text') L.h = textHeight(L);
  draw();
  autosave();
  syncPropValues();
  syncToolbar();
}
/** After adding/removing/reordering layers or replacing the doc. */
function structureChanged() {
  fitView();
  renderTemplatePanel();
  renderProps();
  renderLayers();
  changed();
}

/* ---------- Assets ---------- */
async function ensureImage(id) {
  if (images.has(id) || !assets[id]) return;
  try { images.set(id, await blobToImage(assets[id])); draw(); } catch { /* broken asset */ }
}
const loadAllImages = () => Promise.all(Object.keys(assets).map(ensureImage));

/** File → asset id. Large images are downscaled to 2400 px so designs stay saveable. */
async function addAsset(file) {
  const m = await loadImage(file);
  try {
    const max = 2400;
    let url;
    if (Math.max(m.width, m.height) > max || file.size > 2.5e6) {
      const k = Math.min(1, max / Math.max(m.width, m.height));
      const c = document.createElement('canvas');
      c.width = Math.round(m.width * k); c.height = Math.round(m.height * k);
      c.getContext('2d').drawImage(m.el, 0, 0, c.width, c.height);
      url = c.toDataURL(file.type === 'image/png' ? 'image/png' : 'image/jpeg', 0.9);
    } else {
      url = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(file); });
    }
    const id = `a${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    assets[id] = url;
    images.set(id, await blobToImage(url));
    return { id, w: m.width, h: m.height };
  } finally { m.dispose(); }
}

/* ---------- Adding layers ---------- */
function addLayer(L) {
  checkpoint();
  doc.layers.push(L);
  selId = L.id;
  structureChanged();
}
const base = () => Math.min(doc.w, doc.h);
function addText() {
  const size = Math.round(base() * 0.09);
  addLayer({ id: newId(), type: 'text', name: 'Text', x: doc.w * 0.15, y: doc.h * 0.4, w: doc.w * 0.7, h: size, rot: 0, opacity: 1,
    text: 'Your text', font: 'Inter', weight: '800', size, color: '#ffffff', align: 'center', lineHeight: 1.15, spacing: 0, shadow: true, strokeW: 0, strokeC: '#000000', bgOn: false, bgColor: '#000000' });
  setTimeout(() => $('p-text')?.select(), 0);
}
function addShape(type) {
  const s = base() * 0.3;
  addLayer({ id: newId(), type, name: { rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }[type], x: (doc.w - s) / 2, y: (doc.h - (type === 'line' ? 12 : s)) / 2,
    w: type === 'line' ? s * 1.5 : s, h: type === 'line' ? 12 : s, rot: 0, opacity: 1, fill: type === 'line' ? 'none' : '#ffd60a', stroke: '#ffffff', strokeWidth: type === 'line' ? 8 : 0, radius: type === 'rect' ? s * 0.08 : 0 });
}
async function addImageFile(file) {
  try {
    const a = await addAsset(file);
    const f = Math.min((doc.w * 0.6) / a.w, (doc.h * 0.6) / a.h);
    const w = a.w * f, hh = a.h * f;
    addLayer({ id: newId(), type: 'image', name: safeName(file.name, 'Image').slice(0, 30), asset: a.id, x: (doc.w - w) / 2, y: (doc.h - hh) / 2, w, h: hh, rot: 0, opacity: 1, fit: 'cover', radius: 0 });
  } catch (err) { toast(err.message || 'Couldn’t add that image.', 'error'); }
}

/* ---------- Layer operations ---------- */
function removeSel() { const L = sel(); if (!L) return; checkpoint(); doc.layers.splice(doc.layers.indexOf(L), 1); selId = null; structureChanged(); }
function duplicateSel() {
  const L = sel(); if (!L) return;
  const c = { ...JSON.parse(JSON.stringify(L)), id: newId(), x: L.x + base() * 0.03, y: L.y + base() * 0.03, name: `${L.name} copy` };
  checkpoint(); doc.layers.splice(doc.layers.indexOf(L) + 1, 0, c); selId = c.id; structureChanged();
}
function reorder(where) {
  const L = sel(); if (!L) return;
  const arr = doc.layers, i = arr.indexOf(L);
  const j = where === 'front' ? arr.length - 1 : where === 'back' ? 0 : where === 'up' ? Math.min(arr.length - 1, i + 1) : Math.max(0, i - 1);
  if (i === j) return;
  checkpoint(); arr.splice(i, 1); arr.splice(j, 0, L); structureChanged();
}
function align(how) {
  const L = sel(); if (!L) return;
  checkpoint();
  if (how === 'left') L.x = 0; if (how === 'hcenter') L.x = (doc.w - L.w) / 2; if (how === 'right') L.x = doc.w - L.w;
  if (how === 'top') L.y = 0; if (how === 'vcenter') L.y = (doc.h - L.h) / 2; if (how === 'bottom') L.y = doc.h - L.h;
  changed();
}

/* ---------- Toolbar ---------- */
const I = {
  text: '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>',
  rect: '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  ellipse: '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  line: '<path d="M5 19 19 5"/>',
  dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
  front: '<rect x="8" y="8" width="12" height="12" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
  back: '<rect x="4" y="4" width="12" height="12" rx="1"/><path d="M20 8v11a1 1 0 0 1-1 1H8" /><rect x="10" y="10" width="10" height="10" rx="1" fill="currentColor" fill-opacity=".25" stroke="none"/>',
  up: '<path d="m6 14 6-6 6 6"/>', down: '<path d="m6 10 6 6 6-6"/>',
  aLeft: '<path d="M4 3v18M8 7h10M8 12h6M8 17h12"/>', aHc: '<path d="M12 3v18M6 7h12M8 12h8M5 17h14"/>', aRight: '<path d="M20 3v18M6 7h10M10 12h6M4 17h12"/>',
  aTop: '<path d="M3 4h18M7 8v10M12 8v6M17 8v12"/>', aVc: '<path d="M3 12h18M7 6v12M12 8v8M17 5v14"/>', aBottom: '<path d="M3 20h18M7 6v10M12 10v6M17 4v12"/>',
  guides: '<rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 3"/><rect x="7" y="7" width="10" height="10"/>',
  undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>', redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>',
};
const svg = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const tb = {};
function tbtn(key, title, html, fn) {
  const b = h('button', { type: 'button', class: 'tool-btn', title, 'aria-label': title, html });
  b.addEventListener('click', fn);
  tb[key] = b;
  return b;
}
$('toolbar').append(
  tbtn('text', 'Add text (T)', svg(I.text), addText),
  tbtn('image', 'Add image', icon('image'), async () => { const f = await pickFile('image/*'); if (f) addImageFile(f); }),
  tbtn('rect', 'Add rectangle (R)', svg(I.rect), () => addShape('rect')),
  tbtn('ellipse', 'Add ellipse (O)', svg(I.ellipse), () => addShape('ellipse')),
  tbtn('line', 'Add line (L)', svg(I.line), () => addShape('line')),
  h('span', { class: 'sep' }),
  tbtn('dup', 'Duplicate (Ctrl/⌘+D)', svg(I.dup), duplicateSel),
  tbtn('del', 'Delete (Del)', icon('trash'), removeSel),
  tbtn('front', 'Bring to front (Shift+])', svg(I.front), () => reorder('front')),
  tbtn('fwd', 'Bring forward (])', svg(I.up), () => reorder('up')),
  tbtn('bwd', 'Send backward ([)', svg(I.down), () => reorder('down')),
  tbtn('back', 'Send to back (Shift+[)', svg(I.back), () => reorder('back')),
  h('span', { class: 'sep' }),
  tbtn('aLeft', 'Align left', svg(I.aLeft), () => align('left')),
  tbtn('aHc', 'Center horizontally', svg(I.aHc), () => align('hcenter')),
  tbtn('aRight', 'Align right', svg(I.aRight), () => align('right')),
  tbtn('aTop', 'Align top', svg(I.aTop), () => align('top')),
  tbtn('aVc', 'Center vertically', svg(I.aVc), () => align('vcenter')),
  tbtn('aBottom', 'Align bottom', svg(I.aBottom), () => align('bottom')),
  h('span', { class: 'sep' }),
  tbtn('guides', 'Safe-area guides (G)', svg(I.guides), () => { showGuides = !showGuides; store.set('social-image:guides', showGuides); syncToolbar(); drawOverlay(); }),
  tbtn('undo', 'Undo (Ctrl/⌘+Z)', svg(I.undo), doUndo),
  tbtn('redo', 'Redo (Ctrl/⌘+Shift+Z)', svg(I.redo), doRedo),
);
function syncToolbar() {
  const has = !!sel();
  ['dup', 'del', 'front', 'fwd', 'bwd', 'back', 'aLeft', 'aHc', 'aRight', 'aTop', 'aVc', 'aBottom'].forEach((k) => { tb[k].disabled = !has; });
  tb.undo.disabled = !undo.length; tb.redo.disabled = !redo.length;
  tb.guides.setAttribute('aria-pressed', String(showGuides));
}

/* ---------- View ---------- */
function fitView() {
  const vw = viewport.clientWidth - 32;
  const vh = Math.min(window.innerHeight * 0.68, 760);
  z = Math.max(0.05, Math.min(vw / doc.w, vh / doc.h, 1.5));
  const cw = Math.round(doc.w * z), ch = Math.round(doc.h * z);
  docCanvas.width = doc.w; docCanvas.height = doc.h;
  docCanvas.style.width = `${cw}px`; docCanvas.style.height = `${ch}px`;
  const dpr = window.devicePixelRatio || 1;
  overlay.width = Math.round((cw + 2 * M) * dpr); overlay.height = Math.round((ch + 2 * M) * dpr);
  draw();
}
new ResizeObserver(() => fitView()).observe(viewport);

function draw() {
  renderDoc(docCanvas.getContext('2d'), doc, images, 1);
  drawOverlay();
  const T = template(doc.template);
  $('status').replaceChildren(h('span', {}, `${T.name} · ${doc.w}×${doc.h}`), sel() && h('span', {}, `${sel().name}: ${Math.round(sel().x)}, ${Math.round(sel().y)} · ${Math.round(sel().w)}×${Math.round(sel().h)}${sel().rot ? ` · ${Math.round(sel().rot)}°` : ''}`) || '');
}

/* ---------- Overlay ---------- */
const HANDLE = 5;
const toScreen = (x, y) => [M + x * z, M + y * z];
function handles(L) {
  const pts = [];
  for (const [hx, hy] of [[0, 0], [0.5, 0], [1, 0], [1, 0.5], [1, 1], [0.5, 1], [0, 1], [0, 0.5]]) {
    if (L.type === 'line' && hy !== 0.5) continue;
    if (L.type === 'text' && hx === 0.5) continue; // text height follows its content
    pts.push({ hx, hy, p: toWorld(L, hx * L.w, hy * L.h) });
  }
  const rotP = toWorld(L, L.w / 2, -24 / z);
  return { pts, rotP };
}
function drawOverlay() {
  const dpr = window.devicePixelRatio || 1;
  const c = overlay.getContext('2d');
  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, overlay.width, overlay.height);
  if (showGuides) {
    for (const g of template(doc.template).guides) {
      const [x, y] = toScreen(g.x * doc.w, g.y * doc.h);
      const w = g.w * doc.w * z, hh = g.h * doc.h * z;
      c.save();
      if (g.kind === 'avoid') { c.fillStyle = 'rgba(255,59,48,0.16)'; c.fillRect(x, y, w, hh); c.strokeStyle = 'rgba(255,59,48,0.9)'; }
      else c.strokeStyle = 'rgba(52,199,89,0.95)';
      c.setLineDash([6, 4]); c.lineWidth = 1.25; c.strokeRect(x + 0.5, y + 0.5, w - 1, hh - 1);
      c.setLineDash([]);
      c.font = '600 11px -apple-system, BlinkMacSystemFont, sans-serif';
      const tw = c.measureText(g.label).width + 10;
      c.fillStyle = g.kind === 'avoid' ? 'rgba(255,59,48,0.9)' : 'rgba(52,199,89,0.95)';
      c.fillRect(x + 4, y + 4, tw, 17);
      c.fillStyle = '#fff'; c.textBaseline = 'middle'; c.fillText(g.label, x + 9, y + 13);
      c.restore();
    }
  }
  c.strokeStyle = '#ff2d95'; c.lineWidth = 1;
  for (const s of snapLines) {
    c.beginPath();
    if (s.x != null) { const [x] = toScreen(s.x, 0); c.moveTo(x + 0.5, M - 20); c.lineTo(x + 0.5, M + doc.h * z + 20); }
    else { const [, y] = toScreen(0, s.y); c.moveTo(M - 20, y + 0.5); c.lineTo(M + doc.w * z + 20, y + 0.5); }
    c.stroke();
  }
  const L = sel();
  if (!L || L.hidden) return;
  const corners = [[0, 0], [L.w, 0], [L.w, L.h], [0, L.h]].map(([x, y]) => toScreen(...toWorld(L, x, y)));
  c.strokeStyle = '#2997ff'; c.lineWidth = 1.5;
  c.beginPath(); corners.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y))); c.closePath(); c.stroke();
  const { pts, rotP } = handles(L);
  const [rx, ry] = toScreen(...rotP);
  const [tx, ty] = toScreen(...toWorld(L, L.w / 2, 0));
  c.beginPath(); c.moveTo(tx, ty); c.lineTo(rx, ry); c.stroke();
  c.fillStyle = '#fff';
  c.beginPath(); c.arc(rx, ry, HANDLE + 0.5, 0, Math.PI * 2); c.fill(); c.stroke();
  for (const { p } of pts) {
    const [x, y] = toScreen(...p);
    c.beginPath(); c.rect(x - HANDLE, y - HANDLE, HANDLE * 2, HANDLE * 2); c.fill(); c.stroke();
  }
}

/* ---------- Pointer editing ---------- */
let drag = null;
function docPoint(e) {
  const r = overlay.getBoundingClientRect();
  return [(e.clientX - r.left - M) / z, (e.clientY - r.top - M) / z];
}
overlay.addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  viewport.focus({ preventScroll: true });
  const [px, py] = docPoint(e);
  const L = sel();
  const near = (p) => Math.hypot((p[0] - px) * z, (p[1] - py) * z) <= HANDLE + 4;
  if (L && !L.hidden) {
    const { pts, rotP } = handles(L);
    if (near(rotP)) { drag = { mode: 'rotate', L }; checkpoint(); return capture(e); }
    const hnd = pts.find((q) => near(q.p));
    if (hnd) {
      const anchor = toWorld(L, (1 - hnd.hx) * L.w, (1 - hnd.hy) * L.h);
      drag = { mode: 'resize', L, hx: hnd.hx, hy: hnd.hy, anchor, w0: L.w, h0: L.h, size0: L.size };
      checkpoint(); return capture(e);
    }
  }
  const target = [...doc.layers].reverse().find((l) => !l.hidden && !l.locked && hit(l, px, py, 4 / z));
  if (target) {
    if (selId !== target.id) { selId = target.id; renderProps(); renderLayers(); }
    drag = { mode: 'move', L: target, start: [px, py], x0: target.x, y0: target.y, moved: false };
    checkpoint(); capture(e);
  } else if (selId) { selId = null; renderProps(); renderLayers(); }
  draw(); syncToolbar();
});
function capture(e) { overlay.setPointerCapture(e.pointerId); }

overlay.addEventListener('pointermove', (e) => {
  const [px, py] = docPoint(e);
  if (!drag) {
    const L = sel();
    let cursor = 'default';
    if (L) {
      const { pts, rotP } = handles(L);
      const near = (p) => Math.hypot((p[0] - px) * z, (p[1] - py) * z) <= HANDLE + 4;
      if (near(rotP)) cursor = 'grab';
      else { const hd = pts.find((q) => near(q.p)); if (hd) cursor = (hd.hx === 0.5 ? 'ns' : hd.hy === 0.5 ? 'ew' : (hd.hx === hd.hy ? 'nwse' : 'nesw')) + '-resize'; }
    }
    if (cursor === 'default' && doc.layers.some((l) => !l.hidden && hit(l, px, py, 4 / z))) cursor = 'move';
    overlay.style.cursor = cursor;
    return;
  }
  const L = drag.L;
  if (drag.mode === 'move') {
    let x = drag.x0 + px - drag.start[0], y = drag.y0 + py - drag.start[1];
    [x, y] = e.altKey ? [x, y] : snap(L, x, y);
    L.x = x; L.y = y; drag.moved = true;
  } else if (drag.mode === 'rotate') {
    const [cx, cy] = center(L);
    let a = (Math.atan2(py - cy, px - cx) * 180) / Math.PI + 90;
    if (e.shiftKey || Math.abs(((a % 90) + 90) % 90) < 4 || Math.abs(((a % 90) + 90) % 90) > 86) a = Math.round(a / (e.shiftKey ? 15 : 90)) * (e.shiftKey ? 15 : 90);
    L.rot = ((a % 360) + 540) % 360 - 180;
  } else if (drag.mode === 'resize') resize(L, px, py, e.shiftKey);
  changed();
});
function endDrag() {
  if (drag?.mode === 'move' && !drag.moved) undo.pop(); // a click, not an edit
  drag = null; snapLines = []; drawOverlay(); syncToolbar();
}
overlay.addEventListener('pointerup', endDrag);
overlay.addEventListener('pointercancel', endDrag);
overlay.addEventListener('dblclick', (e) => {
  const [px, py] = docPoint(e);
  const t = [...doc.layers].reverse().find((l) => !l.hidden && hit(l, px, py));
  if (t?.type === 'text') { selId = t.id; renderProps(); renderLayers(); draw(); $('p-text')?.focus(); $('p-text')?.select(); }
});

function resize(L, px, py, free) {
  const a = ((L.rot || 0) * Math.PI) / 180, cos = Math.cos(a), sin = Math.sin(a);
  const [ax, ay] = drag.anchor;
  const vx = px - ax, vy = py - ay;
  const ux = vx * cos + vy * sin, uy = -vx * sin + vy * cos; // pointer in the layer's frame, from the anchor
  let w = drag.hx === 0.5 ? drag.w0 : Math.max(4, drag.hx === 1 ? ux : -ux);
  let hh = drag.hy === 0.5 ? drag.h0 : Math.max(4, drag.hy === 1 ? uy : -uy);
  const corner = drag.hx !== 0.5 && drag.hy !== 0.5;
  if (L.type === 'text') {
    if (corner) { const k = w / drag.w0; L.size = Math.max(4, Math.round(drag.size0 * k * 10) / 10); }
    L.w = w; L.h = textHeight({ ...L, w });
    hh = L.h;
  } else {
    if (corner && (L.type === 'image') !== free) { const k = Math.max(w / drag.w0, hh / drag.h0); w = drag.w0 * k; hh = drag.h0 * k; }
    L.w = w; L.h = L.type === 'line' ? L.h : hh;
    hh = L.h;
  }
  // Centre relative to the fixed anchor, in the layer's frame. Text dragged from a side keeps its top edge.
  const ox = (2 * drag.hx - 1) * (L.w / 2);
  const oy = drag.hy === 0.5 ? (L.type === 'text' ? (hh - drag.h0) / 2 : 0) : (2 * drag.hy - 1) * (hh / 2);
  const cx = ax + ox * cos - oy * sin, cy = ay + ox * sin + oy * cos;
  L.x = cx - L.w / 2; L.y = cy - hh / 2;
}

/** Snap the layer's (unrotated) edges/centre to the canvas and other layers. */
function snap(L, x, y) {
  const t = 6 / z;
  const xs = [0, doc.w / 2, doc.w], ys = [0, doc.h / 2, doc.h];
  for (const o of doc.layers) if (o !== L && !o.hidden) { xs.push(o.x, o.x + o.w / 2, o.x + o.w); ys.push(o.y, o.y + o.h / 2, o.y + o.h); }
  snapLines = [];
  const pick = (pos, size, cands, axis) => {
    let best = null;
    for (const off of [0, size / 2, size]) for (const c of cands) {
      const d = c - (pos + off);
      if (Math.abs(d) < t && (!best || Math.abs(d) < Math.abs(best.d))) best = { d, line: c };
    }
    if (!best) return pos;
    snapLines.push(axis === 'x' ? { x: best.line } : { y: best.line });
    return pos + best.d;
  };
  return [pick(x, L.w, xs, 'x'), pick(y, L.h, ys, 'y')];
}

/* ---------- Keyboard ---------- */
document.addEventListener('keydown', (e) => {
  const t = e.target;
  if (t.closest?.('input, textarea, select, [contenteditable]')) return;
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (mod && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
  if (mod && k === 'y') { e.preventDefault(); doRedo(); return; }
  if (mod && k === 'd') { e.preventDefault(); duplicateSel(); return; }
  if (mod) return;
  const L = sel();
  if ((k === 'delete' || k === 'backspace') && L) { e.preventDefault(); removeSel(); return; }
  if (k === 'escape') { selId = null; renderProps(); renderLayers(); draw(); return; }
  if (k === ']') { reorder(e.shiftKey ? 'front' : 'up'); return; }
  if (k === '[') { reorder(e.shiftKey ? 'back' : 'down'); return; }
  if (k === 't') { addText(); return; }
  if (k === 'r') { addShape('rect'); return; }
  if (k === 'o') { addShape('ellipse'); return; }
  if (k === 'l') { addShape('line'); return; }
  if (k === 'g') { tb.guides.click(); return; }
  if (L && k.startsWith('arrow')) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    if (!e.repeat) checkpoint();
    if (k === 'arrowleft') L.x -= step; if (k === 'arrowright') L.x += step;
    if (k === 'arrowup') L.y -= step; if (k === 'arrowdown') L.y += step;
    changed();
  }
});

/* ---------- Paste / drop images ---------- */
onPasteImages((files) => addImageFile(files[0]));
viewport.addEventListener('dragover', (e) => e.preventDefault());
viewport.addEventListener('drop', (e) => { e.preventDefault(); const f = [...e.dataTransfer.files].find((x) => x.type.startsWith('image/')); if (f) addImageFile(f); });

/* ---------- Template panel ---------- */
function renderTemplatePanel() {
  const select = h('select', { 'aria-label': 'Template' }, TEMPLATES.map((T) => h('option', { value: T.id }, `${T.name}${T.id === 'custom' ? '' : ` · ${T.w}×${T.h}`}`)));
  select.value = doc.template;
  select.addEventListener('change', () => switchTemplate(select.value));
  const wIn = h('input', { type: 'number', min: 64, max: 4096, value: doc.w, 'aria-label': 'Width' });
  const hIn = h('input', { type: 'number', min: 64, max: 4096, value: doc.h, 'aria-label': 'Height' });
  const applySize = () => switchTemplate('custom', Math.max(64, Math.min(4096, +wIn.value || doc.w)), Math.max(64, Math.min(4096, +hIn.value || doc.h)));
  wIn.addEventListener('change', applySize); hIn.addEventListener('change', applySize);
  $('template').replaceChildren(
    h('div', { class: 'ctrl' }, select),
    doc.template === 'custom' ? h('div', { class: 'si-grid2' }, h('div', { class: 'ctrl' }, h('span', { class: 'ctrl-hint' }, 'Width'), wIn), h('div', { class: 'ctrl' }, h('span', { class: 'ctrl-hint' }, 'Height'), hIn)) : '',
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-sm', title: 'Replace the layers with a starter layout (click again for other colors)', onclick: () => {
        checkpoint();
        const p = (store.get('social-image:palette', 0) + 1) % 4;
        store.set('social-image:palette', p);
        const st = starter(doc.template, p);
        scaleLayers(st.layers, st.w, st.h, doc.w, doc.h);
        doc = { ...st, w: doc.w, h: doc.h };
        selId = null; structureChanged();
      } }, 'Starter layout'),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { checkpoint(); doc.layers = []; selId = null; structureChanged(); } }, 'Clear layers')));
}

/** Change size, keeping layers proportionally placed (scaled by the smaller ratio, centred). */
function switchTemplate(id, cw, ch) {
  const T = template(id);
  const W = cw || T.w, H = ch || T.h;
  if (W === doc.w && H === doc.h && id === doc.template) return;
  checkpoint();
  scaleLayers(doc.layers, doc.w, doc.h, W, H);
  doc.template = id; doc.w = W; doc.h = H;
  structureChanged();
}
function scaleLayers(layers, fw, fh, W, H) {
  const k = Math.min(W / fw, H / fh);
  const dx = (W - fw * k) / 2, dy = (H - fh * k) / 2;
  for (const L of layers) {
    L.x = L.x * k + dx; L.y = L.y * k + dy; L.w *= k; L.h *= k;
    if (L.type === 'text') L.size = Math.round(L.size * k * 10) / 10;
    if (L.strokeWidth) L.strokeWidth *= k;
    if (L.radius) L.radius *= k;
  }
}

/* ---------- Properties ---------- */
let propRefs = {};
let propCheckpointed = false;
const field = (label, input, hint) => h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, label)), input, hint && h('div', { class: 'ctrl-hint' }, hint));
/** Bind an input to obj[key]: one undo checkpoint per focus, live update on input. */
function bind(input, obj, key, { num = false, event = 'input', after } = {}) {
  input.addEventListener('focus', () => { propCheckpointed = false; });
  input.addEventListener(event, () => {
    if (!propCheckpointed) { checkpoint(); propCheckpointed = true; }
    const v = input.type === 'checkbox' ? input.checked : num ? +input.value : input.value;
    if (num && !Number.isFinite(v)) return;
    obj[key] = v;
    after?.(v);
    changed();
  });
  input.addEventListener('blur', () => { propCheckpointed = false; });
  return input;
}
const num = (obj, key, opts = {}) => bind(h('input', { type: 'number', step: opts.step ?? 1, min: opts.min, max: opts.max, value: round(obj[key]) }), obj, key, { num: true, ...opts });
const round = (v) => Math.round((+v || 0) * 10) / 10;
function color(obj, key) {
  const pick = h('input', { type: 'color', value: obj[key] && obj[key] !== 'none' ? obj[key] : '#000000' });
  bind(pick, obj, key);
  return h('div', { class: 'color-input' }, pick, h('span', { class: 'ctrl-hint' }, ''));
}
function segmented(obj, key, opts, after) {
  const btns = opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(String(obj[key]) === String(v)) }, l));
  btns.forEach((b, i) => b.addEventListener('click', () => { checkpoint(); obj[key] = opts[i][0]; btns.forEach((x, j) => x.setAttribute('aria-pressed', String(i === j))); after?.(); changed(); }));
  return h('div', { class: 'segmented' }, btns);
}
function range(obj, key, min, max, step = 1, fmt = (v) => v) {
  const val = h('span', { class: 'ctrl-value' }, fmt(obj[key]));
  const input = h('input', { type: 'range', min, max, step, value: obj[key] });
  const paint = () => { val.textContent = fmt(+input.value); input.style.setProperty('--pct', `${((input.value - min) / (max - min)) * 100}%`); };
  paint();
  bind(input, obj, key, { num: true, after: paint });
  input.addEventListener('pointerdown', () => { propCheckpointed = false; });
  return { input, val };
}
const toggle = (label, obj, key) => {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = !!obj[key];
  bind(input, obj, key, { event: 'change', after: () => renderProps() });
  return h('div', { class: 'ctrl' }, h('label', { class: 'toggle' }, h('span', {}, label), input));
};

function renderProps() {
  propRefs = {};
  const L = sel();
  const root = $('props');
  if (!L) return root.replaceChildren(h('h3', {}, 'Background'), ...bgProps());
  const geo = h('div', { class: 'si-grid2' },
    ...['x', 'y', 'w', 'h'].map((k) => { const i = num(L, k); propRefs[k] = i; if (L.type === 'text' && k === 'h') i.disabled = true; return field(k.toUpperCase(), i); }),
    field('Rotation', (propRefs.rot = num(L, 'rot', { min: -180, max: 180 }))),
    field('Opacity', (() => { const r = range(L, 'opacity', 0, 1, 0.01, (v) => `${Math.round(v * 100)}%`); return h('div', {}, r.input); })()));
  const name = bind(h('input', { type: 'text', value: L.name }), L, 'name', { after: () => renderLayers() });
  const parts = [h('h3', {}, { text: 'Text', image: 'Image', rect: 'Rectangle', ellipse: 'Ellipse', line: 'Line' }[L.type]), field('Name', name)];

  if (L.type === 'text') {
    const ta = bind(h('textarea', { id: 'p-text', rows: 3 }), L, 'text');
    ta.value = L.text;
    const fontSel = h('select', {}, FONTS.map((f) => h('option', { value: f.family }, f.family)));
    fontSel.value = L.font;
    bind(fontSel, L, 'font', { event: 'change', after: () => loadFont(L) });
    const size = range(L, 'size', 8, Math.round(base() * 0.4), 1, (v) => `${Math.round(v)}px`);
    propRefs.size = size;
    parts.push(field('Text', ta),
      field('Font', fontSel),
      field('Weight', segmented(L, 'weight', [['400', 'Regular'], ['600', 'Semi'], ['800', 'Bold'], ['900', 'Black']], () => loadFont(L))),
      h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Size'), size.val), size.input),
      field('Color', color(L, 'color')),
      field('Align', segmented(L, 'align', [['left', 'Left'], ['center', 'Center'], ['right', 'Right']])),
      (() => { const r = range(L, 'lineHeight', 0.8, 2, 0.01, (v) => v.toFixed(2)); return h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Line height'), r.val), r.input); })(),
      (() => { const r = range(L, 'spacing', -10, 30, 0.5, (v) => `${v}px`); return h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Letter spacing'), r.val), r.input); })(),
      toggle('Shadow', L, 'shadow'),
      (() => { const r = range(L, 'strokeW', 0, 20, 0.5, (v) => `${v}px`); return h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Outline'), r.val), r.input); })(),
      L.strokeW > 0 ? field('Outline color', color(L, 'strokeC')) : '',
      toggle('Highlight behind text', L, 'bgOn'),
      L.bgOn ? field('Highlight color', color(L, 'bgColor')) : '');
  } else if (L.type === 'image') {
    parts.push(
      h('div', { class: 'btn-row ctrl' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { const f = await pickFile('image/*'); if (!f) return; try { const a = await addAsset(f); checkpoint(); L.asset = a.id; changed(); } catch (err) { toast(err.message, 'error'); } } }, 'Replace image')),
      field('Fit', segmented(L, 'fit', [['cover', 'Fill'], ['contain', 'Fit']])),
      (() => { const r = range(L, 'radius', 0, Math.round(base() * 0.25), 1, (v) => `${Math.round(v)}px`); return h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Corner radius'), r.val), r.input); })());
  } else {
    if (L.type !== 'line') {
      parts.push(toggle('Fill', { get fill() { return L.fill !== 'none'; }, set fill(v) { L.fill = v ? (L._fill || '#ffd60a') : (L._fill = L.fill, 'none'); } }, 'fill'));
      if (L.fill !== 'none') parts.push(field('Fill color', color(L, 'fill')));
    }
    const sw = range(L, 'strokeWidth', 0, Math.round(base() * 0.05), 0.5, (v) => `${v}px`);
    parts.push(h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, L.type === 'line' ? 'Thickness' : 'Border'), sw.val), sw.input),
      (L.strokeWidth > 0 || L.type === 'line') ? field(L.type === 'line' ? 'Color' : 'Border color', color(L, 'stroke')) : '');
    if (L.type === 'rect') { const r = range(L, 'radius', 0, Math.round(base() * 0.25), 1, (v) => `${Math.round(v)}px`); parts.push(h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Corner radius'), r.val), r.input)); }
  }
  parts.push(h('h3', { style: 'margin-top:14px' }, 'Position'), geo);
  root.replaceChildren(...parts);
}
function syncPropValues() {
  const L = sel(); if (!L) return;
  for (const k of ['x', 'y', 'w', 'h', 'rot']) { const i = propRefs[k]; if (i && document.activeElement !== i) i.value = round(L[k]); }
  if (propRefs.size && document.activeElement !== propRefs.size.input) { propRefs.size.input.value = L.size; propRefs.size.val.textContent = `${Math.round(L.size)}px`; }
}

function bgProps() {
  const B = doc.bg;
  const out = [field('Type', segmented(B, 'type', [['gradient', 'Gradient'], ['solid', 'Solid'], ['image', 'Image'], ['none', 'None']], () => renderProps()))];
  if (B.type === 'solid') out.push(field('Color', color(B, 'color')));
  if (B.type === 'gradient') {
    const c1 = h('input', { type: 'color', value: B.colors[0] }), c2 = h('input', { type: 'color', value: B.colors[1] });
    [c1, c2].forEach((c, i) => { c.addEventListener('focus', () => { propCheckpointed = false; }); c.addEventListener('input', () => { if (!propCheckpointed) { checkpoint(); propCheckpointed = true; } B.colors[i] = c.value; changed(); }); });
    const a = range(B, 'angle', 0, 360, 1, (v) => `${v}°`);
    out.push(field('Colors', h('div', { class: 'color-input' }, c1, c2)), h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Angle'), a.val), a.input));
  }
  if (B.type === 'image') {
    out.push(h('div', { class: 'btn-row ctrl' }, h('button', { type: 'button', class: 'btn btn-sm', onclick: async () => { const f = await pickFile('image/*'); if (!f) return; try { const a = await addAsset(f); checkpoint(); B.asset = a.id; changed(); } catch (err) { toast(err.message, 'error'); } } }, B.asset ? 'Replace image' : 'Choose image')));
    const bl = range(B, 'blur', 0, 60, 1, (v) => `${v}px`), dm = range(B, 'dim', 0, 80, 1, (v) => `${v}%`);
    out.push(h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Blur'), bl.val), bl.input), h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Darken'), dm.val), dm.input));
  }
  out.push(h('p', { class: 'ctrl-hint' }, 'Select a layer to edit it. Double-click text to change it. Paste or drop images onto the canvas.'));
  return out;
}

function loadFont(L) { ensureFont(L.font, L.weight, () => changed()); }

/* ---------- Layers list ---------- */
const typeIcon = { text: I.text, image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>', rect: I.rect, ellipse: I.ellipse, line: I.line };
function renderLayers() {
  $('layers').replaceChildren(...[...doc.layers].reverse().map((L) => h('li', {
    class: `si-layer${L.id === selId ? ' is-active' : ''}${L.hidden ? ' is-hidden' : ''}`,
    onclick: () => { selId = L.id; renderProps(); renderLayers(); draw(); syncToolbar(); },
  },
  h('span', { html: svg(typeIcon[L.type]), style: 'display:contents' }),
  h('span', {}, L.type === 'text' ? (L.text.split('\n')[0] || L.name) : L.name),
  h('div', { class: 'acts' },
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: L.hidden ? 'Show' : 'Hide', 'aria-label': L.hidden ? 'Show' : 'Hide', html: icon('eye'), style: L.hidden ? 'opacity:.35' : '', onclick: (e) => { e.stopPropagation(); checkpoint(); L.hidden = !L.hidden; renderLayers(); changed(); } }),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Delete', 'aria-label': 'Delete', html: icon('trash'), onclick: (e) => { e.stopPropagation(); selId = L.id; removeSel(); } })))));
  if (!doc.layers.length) $('layers').append(h('li', { class: 'ctrl-hint' }, 'No layers. Add text, an image or a shape.'));
}

/* ---------- Designs ---------- */
const DESIGNS = 'social-image:designs';
async function listDesigns() { return (await kvGet(DESIGNS)) || []; }
async function renderDesigns() {
  const list = await listDesigns();
  const nameIn = h('input', { type: 'text', placeholder: 'Design name', value: '' });
  $('designs').replaceChildren(
    h('div', { class: 'btn-row' },
      nameIn,
      h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: async () => {
        const name = nameIn.value.trim() || `${template(doc.template).name} ${new Date().toLocaleDateString()}`;
        const all = await listDesigns();
        const existing = all.find((d) => d.name === name);
        const entry = { id: existing?.id || newId(), name, savedAt: Date.now(), doc: JSON.parse(JSON.stringify(doc)), assets: usedAssets() };
        const next = existing ? all.map((d) => (d === existing ? entry : d)) : [entry, ...all];
        try { await kvSet(DESIGNS, next); toast(`Saved “${name}”`, 'success'); } catch { toast('Couldn’t save: browser storage is full or blocked.', 'error'); }
        renderDesigns();
      } }, 'Save')),
    h('div', { class: 'btn-row', style: 'margin-top:8px' },
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('download')} JSON`, title: 'Download this design as JSON', onclick: () => downloadBlob(new Blob([JSON.stringify({ app: 'toolbox-social-image', doc, assets: usedAssets() })], { type: 'application/json' }), `${safeName(template(doc.template).name)}.json`) }),
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('upload')} Open JSON`, onclick: openJson }),
      h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { checkpoint(); doc = starter(doc.template); selId = null; structureChanged(); } }, 'New')),
    list.length ? h('div', { class: 'si-designs' }, list.map((d) => h('div', { class: 'si-design' },
      h('button', { type: 'button', class: 'name', title: 'Open', onclick: () => openDesign(d) }, d.name),
      h('small', {}, `${template(d.doc.template).name.split(' ')[0]} · ${new Date(d.savedAt).toLocaleDateString()}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Delete', 'aria-label': `Delete ${d.name}`, html: icon('trash'), onclick: async () => { await kvSet(DESIGNS, (await listDesigns()).filter((x) => x.id !== d.id)); renderDesigns(); } })))) : h('p', { class: 'ctrl-hint', style: 'margin-top:8px' }, 'Saved designs stay in this browser. Your current work is autosaved too.'));
}
async function openDesign(d) {
  checkpoint();
  assets = { ...assets, ...d.assets };
  doc = JSON.parse(JSON.stringify(d.doc));
  selId = null;
  await loadAllImages();
  structureChanged();
  doc.layers.filter((l) => l.type === 'text').forEach(loadFont);
}
async function openJson() {
  const f = await pickFile('.json,application/json');
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!data.doc?.layers || !data.doc.w) throw new Error('bad');
    await openDesign({ doc: data.doc, assets: data.assets || {} });
  } catch { toast('That file isn’t a Social Image Maker design.', 'error'); }
}

/* ---------- Export ---------- */
createImageExport($('export'), {
  id: 'social-image',
  getCanvas: (scale) => {
    const c = document.createElement('canvas');
    c.width = Math.round(doc.w * scale); c.height = Math.round(doc.h * scale);
    renderDoc(c.getContext('2d'), doc, images, scale);
    return c;
  },
  formats: ['png', 'jpg', 'webp'],
  scales: [1, 2],
  filename: () => safeName(template(doc.template).id === 'custom' ? `design-${doc.w}x${doc.h}` : template(doc.template).id),
  matte: () => (doc.bg.type === 'solid' ? doc.bg.color : '#ffffff'),
});

/* ---------- Start ---------- */
(async () => {
  const saved = await kvGet('social-image:current').catch(() => null);
  if (saved?.doc?.layers) { doc = saved.doc; assets = saved.assets || {}; await loadAllImages(); }
  structureChanged();
  doc.layers.filter((l) => l.type === 'text').forEach(loadFont);
  renderDesigns();
})();
