/*
 * Mockup Generator: screenshots in generic device frames, several side by side, with tilt, shadow
 * and a solid/gradient/image/transparent background.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Model: devices[] = { id, type, color, theme, url, landscape, size, fit, media }. compose(W, H)
 * lays them out in a row (sizes relative to each other via TYPES[].units), scales the row into the
 * canvas, then each device is drawn into its own canvas and placed flat or through the WebGL
 * perspective quad. compose() is the only drawing path; the preview and exports both call it.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, toast, store } from '/assets/js/lib/dom.js';
import { createImageDrop, createImageExport, onPasteImages, loadImage, pickFile, safeName } from '/assets/js/lib/image-io.js';
import { fit, linearGradient, scratch, drawBlurred } from '/assets/js/lib/canvas.js';
import { createPerspective, projectRect } from '/assets/js/lib/perspective.js';
import { GRADIENTS } from '/assets/js/lib/showcase-frame.js';
import { TYPES, COLORS, screenSize, geometry, drawDevice, drawFakeUI } from './devices.js';

const $ = (id) => document.getElementById(id);
const canvas = $('preview');
const persp = createPerspective();
let nextId = 1;
let bgMedia = null;
let hitboxes = []; // [{ id, x, y, w, h }] in preview canvas px, for click-to-select

const newDevice = (type, extra = {}) => ({ id: nextId++, type, color: 'black', theme: 'light', url: 'yourproduct.app', landscape: false, size: 100, fit: 'top', media: null, ...extra });
const devices = [newDevice('laptop'), newDevice('phone', { color: 'silver' })];
let selected = devices[0];

/* ---------- Scene panel ---------- */
const saved = store.get('opts:mockup', {});
const keep = (id, v) => saved[id] ?? v;
const ASPECTS = [['auto', 'Auto'], ['16:9', '16:9'], ['4:3', '4:3'], ['1:1', '1:1'], ['4:5', '4:5'], ['9:16', '9:16'], ['1200:630', 'Social 1200×630']];
const panel = createControls($('controls'), [
  { title: 'Layout', controls: [
    { id: 'aspect', type: 'select', label: 'Canvas', value: keep('aspect', '16:9'), options: ASPECTS },
    { id: 'padding', type: 'range', label: 'Padding', min: 0, max: 30, value: keep('padding', 10), unit: '%' },
    { id: 'gap', type: 'range', label: 'Spacing', min: -40, max: 30, value: keep('gap', -6), unit: '%', hint: 'Negative values overlap devices; later ones in the list sit in front.' },
    { id: 'align', type: 'segmented', label: 'Align', value: keep('align', 'bottom'), options: [['bottom', 'Bottom'], ['center', 'Center']] },
  ] },
  { title: 'Perspective & shadow', controls: [
    { id: 'ry', type: 'range', label: 'Turn', min: -35, max: 35, value: keep('ry', 0), unit: '°' },
    { id: 'rx', type: 'range', label: 'Tilt', min: -30, max: 30, value: keep('rx', 0), unit: '°' },
    { id: 'rz', type: 'range', label: 'Rotate', min: -20, max: 20, value: keep('rz', 0), unit: '°' },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 100, value: keep('shadow', 45), unit: '%' },
  ] },
  { title: 'Background', controls: [
    { id: 'bg', type: 'segmented', label: 'Type', value: keep('bg', 'gradient'), options: [['gradient', 'Gradient'], ['solid', 'Solid'], ['image', 'Image'], ['none', 'None']] },
    { id: 'gradient', type: 'swatches', label: 'Gradient', value: keep('gradient', 'ocean'), showIf: (st) => st.bg === 'gradient',
      options: GRADIENTS.map((g) => ({ label: g.label, value: g.value, preview: `linear-gradient(135deg,${g.colors.join(',')})` })) },
    { id: 'gAngle', type: 'range', label: 'Angle', min: 0, max: 360, value: keep('gAngle', 135), unit: '°', showIf: (st) => st.bg === 'gradient' },
    { id: 'bgColor', type: 'color', label: 'Color', value: keep('bgColor', '#eef0f5'), showIf: (st) => st.bg === 'solid' },
    { id: 'bgImage', type: 'custom', el: h('div', { id: 'bg-upload' }), showIf: (st) => st.bg === 'image' },
    { id: 'bgBlur', type: 'range', label: 'Blur', min: 0, max: 60, value: keep('bgBlur', 0), unit: 'px', showIf: (st) => st.bg === 'image' },
    { id: 'bgDim', type: 'range', label: 'Darken', min: 0, max: 80, value: keep('bgDim', 0), unit: '%', showIf: (st) => st.bg === 'image' },
  ] },
], { onChange: (st) => { store.set('opts:mockup', st); draw(); } });
const s = panel.state;
createImageDrop($('bg-upload'), { label: 'Drop a background image', paste: false, onLoad: (m) => { bgMedia = m; draw(); }, onClear: () => { bgMedia = null; draw(); } });

/* ---------- Device list ---------- */
const typeIcon = { phone: '<rect x="7" y="2" width="10" height="20" rx="2"/><path d="M11 18h2"/>', tablet: '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M11 18h2"/>', laptop: '<rect x="4" y="4" width="16" height="11" rx="1"/><path d="M2 19h20"/>', monitor: '<rect x="2" y="3" width="20" height="13" rx="1"/><path d="M9 21h6M12 16v5"/>', browser: '<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 9h20M6 6.5h.01M9 6.5h.01"/>' };
const svgIcon = (p) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;

$('add').append(...Object.entries(TYPES).map(([type, T]) => h('button', { type: 'button', class: 'chip', title: `Add a ${T.name.toLowerCase()}`, html: `${icon('plus')} ${T.name}`, onclick: () => {
  if (devices.length >= 6) return toast('Up to 6 devices.');
  const d = newDevice(type, { color: type === 'phone' ? 'silver' : 'black' });
  devices.push(d); select(d);
} })));

function renderList() {
  $('devices').replaceChildren(...devices.map((d, i) => {
    const li = h('li', { class: `mk-dev${d === selected ? ' is-active' : ''}`, onclick: () => select(d), title: 'Select · drop a screenshot here' },
      h('div', { class: 'mk-thumb', style: d.media ? `background-image:url("${d.media.url}")` : '', html: d.media ? '' : svgIcon(typeIcon[d.type]) }),
      h('div', { class: 'meta' }, h('strong', {}, TYPES[d.type].name), h('span', {}, d.media ? d.media.name : 'Sample screen')),
      h('div', { class: 'acts' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Move earlier (further left)', 'aria-label': 'Move earlier', disabled: i === 0, html: icon('up'), onclick: (e) => { e.stopPropagation(); move(d, -1); } }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Move later (further right, in front)', 'aria-label': 'Move later', disabled: i === devices.length - 1, html: icon('down'), onclick: (e) => { e.stopPropagation(); move(d, 1); } }),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', title: 'Remove', 'aria-label': 'Remove', disabled: devices.length === 1, html: icon('trash'), onclick: (e) => { e.stopPropagation(); remove(d); } })));
    li.addEventListener('dragover', (e) => { e.preventDefault(); li.classList.add('is-over'); });
    li.addEventListener('dragleave', () => li.classList.remove('is-over'));
    li.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); li.classList.remove('is-over'); const f = e.dataTransfer.files[0]; if (f) setShot(d, f); });
    return li;
  }));
}
function move(d, dir) {
  const i = devices.indexOf(d), j = i + dir;
  if (j < 0 || j >= devices.length) return;
  [devices[i], devices[j]] = [devices[j], devices[i]];
  renderList(); draw();
}
function remove(d) {
  if (devices.length === 1) return;
  d.media?.dispose();
  devices.splice(devices.indexOf(d), 1);
  if (selected === d) selected = devices[0];
  renderList(); renderEditor(); draw();
}
function select(d) { selected = d; renderList(); renderEditor(); draw(); }

async function setShot(d, file) {
  try {
    const m = await loadImage(file);
    d.media?.dispose();
    d.media = m;
    if (d === selected) renderEditor();
    renderList(); draw();
  } catch (err) { toast(err.message || 'Couldn’t open that image.', 'error'); }
}

/* ---------- Selected device editor ---------- */
function renderEditor() {
  const d = selected;
  const T = TYPES[d.type];
  const field = (label, input) => h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, label)), input);
  const seg = (opts, value, on) => {
    const btns = opts.map(([v, l]) => h('button', { type: 'button', 'aria-pressed': String(String(value) === String(v)), onclick: () => { on(v); renderEditor(); draw(); } }, l));
    return h('div', { class: 'segmented' }, btns);
  };
  const sizeVal = h('span', { class: 'ctrl-value' }, `${d.size}%`);
  const size = h('input', { type: 'range', min: 40, max: 160, value: d.size, style: `--pct:${((d.size - 40) / 120) * 100}%` });
  size.addEventListener('input', () => { d.size = +size.value; sizeVal.textContent = `${d.size}%`; size.style.setProperty('--pct', `${((d.size - 40) / 120) * 100}%`); draw(); });
  const url = h('input', { type: 'text', value: d.url, placeholder: 'yourproduct.app', spellcheck: 'false' });
  url.addEventListener('input', () => { d.url = url.value; draw(); });

  $('device-editor').replaceChildren(...[
    h('h3', {}, `Selected: ${T.name}`),
    h('div', { class: 'ctrl' },
      h('div', { class: 'mk-shot' },
        h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('image')} ${d.media ? 'Replace screenshot' : 'Choose screenshot'}`, onclick: async () => { const f = await pickFile('image/*'); if (f) setShot(d, f); } }),
        d.media && h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => { d.media.dispose(); d.media = null; renderEditor(); renderList(); draw(); } }, 'Use sample'),
      ),
      h('div', { class: 'ctrl-hint' }, 'Or drop it on the device in the list, or paste with Ctrl/⌘+V.')),
    field('Type', seg(Object.entries(TYPES).map(([k, t]) => [k, t.name]), d.type, (v) => { d.type = v; renderList(); })),
    d.type === 'browser'
      ? field('Window', seg([['light', 'Light'], ['dark', 'Dark']], d.theme, (v) => { d.theme = v; }))
      : field('Color', seg(Object.entries(COLORS).map(([k, c]) => [k, c.name]), d.color, (v) => { d.color = v; })),
    d.type === 'browser' && field('Address bar', url),
    T.rotate && field('Orientation', seg([['false', 'Portrait'], ['true', 'Landscape']], d.landscape, (v) => { d.landscape = v === 'true'; })),
    field('Screenshot fit', seg([['top', 'Fill (top)'], ['center', 'Fill (center)'], ['contain', 'Fit']], d.fit, (v) => { d.fit = v; })),
    h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label' }, h('span', {}, 'Size'), sizeVal), size),
  ].filter(Boolean));
}

onPasteImages((files) => setShot(selected, files[0]));
// Drops on the preview go to the device under the pointer (or the selected one).
$('stage').addEventListener('dragover', (e) => e.preventDefault());
$('stage').addEventListener('drop', (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0]; if (!f) return;
  setShot(deviceAt(e) || selected, f);
});
canvas.addEventListener('click', (e) => { const d = deviceAt(e); if (d) select(d); });
function deviceAt(e) {
  const r = canvas.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * canvas.width, y = ((e.clientY - r.top) / r.height) * canvas.height;
  for (let i = hitboxes.length - 1; i >= 0; i--) {
    const b = hitboxes[i];
    if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return devices.find((d) => d.id === b.id);
  }
  return null;
}

/* ---------- Composition ---------- */
const PREVIEW_LONG = 1600;

/** Row layout at 1 unit = 1 px: positions, bodies and the content box. */
function rowLayout() {
  const items = devices.map((d) => {
    const [sw, sh] = screenSize(d, 1);
    return { d, sw, sh, g: geometry(d, sw, sh) };
  });
  const maxH = Math.max(...items.map((it) => it.g.h));
  const gap = (s.gap / 100) * maxH;
  let x = 0;
  for (const it of items) { it.x = x; x += it.g.w + gap; }
  const W0 = Math.max(1, x - gap);
  for (const it of items) it.y = s.align === 'bottom' ? maxH - it.g.h : (maxH - it.g.h) / 2;
  const minX = Math.min(...items.map((it) => it.x)), maxX = Math.max(...items.map((it) => it.x + it.g.w));
  for (const it of items) it.x -= minX;
  return { items, W0: Math.max(W0, maxX - minX), H0: maxH };
}

function canvasSize(L, long = PREVIEW_LONG) {
  if (s.aspect === 'auto') {
    const pp = (s.padding / 100) * Math.min(L.W0, L.H0) * 1.2; // padding is a share of the short side
    const ratio = (L.W0 + 2 * pp) / (L.H0 + 2 * pp);
    return ratio >= 1 ? [long, Math.round(long / ratio)] : [Math.round(long * ratio), long];
  }
  const [a, b] = s.aspect.split(':').map(Number);
  return a >= b ? [long, Math.round((long * b) / a)] : [Math.round((long * a) / b), long];
}

function drawBackground(ctx, W, H) {
  ctx.clearRect(0, 0, W, H);
  if (s.bg === 'gradient') {
    const g = GRADIENTS.find((x) => x.value === s.gradient) || GRADIENTS[0];
    ctx.fillStyle = linearGradient(ctx, W, H, s.gAngle - 90, g.colors); ctx.fillRect(0, 0, W, H);
  } else if (s.bg === 'solid') { ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, W, H); }
  else if (s.bg === 'image' && bgMedia) {
    const f = fit(bgMedia.width, bgMedia.height, W, H, 'cover');
    const k = Math.min(W, H) / 1080;
    if (s.bgBlur > 0) { const m = s.bgBlur * k * 2; drawBlurred(ctx, bgMedia.el, f.x - m, f.y - m, f.w + 2 * m, f.h + 2 * m, s.bgBlur * k); }
    else ctx.drawImage(bgMedia.el, f.x, f.y, f.w, f.h);
    if (s.bgDim > 0) { ctx.fillStyle = `rgba(0,0,0,${s.bgDim / 100})`; ctx.fillRect(0, 0, W, H); }
  } else if (s.bg === 'image') { ctx.fillStyle = '#d9dce3'; ctx.fillRect(0, 0, W, H); }
}

function drawScreenContent(ctx, d, r) {
  if (!d.media) return drawFakeUI(ctx, r, d.id, d.type === 'browser' ? d.theme === 'dark' : d.id % 2 === 0);
  ctx.fillStyle = '#000'; ctx.fillRect(r.x, r.y, r.w, r.h);
  const m = d.media;
  const f = fit(m.width, m.height, r.w, r.h, d.fit === 'contain' ? 'contain' : 'cover');
  const y = d.fit === 'top' ? 0 : f.y;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(m.el, r.x + f.x, r.y + y, f.w, f.h);
}

/** Draw the whole scene into ctx (W×H). Returns device hitboxes in canvas px. */
function compose(ctx, W, H) {
  drawBackground(ctx, W, H);
  const L = rowLayout();
  const pad = (Math.min(W, H) * s.padding) / 100;
  const k = Math.min((W - 2 * pad) / L.W0, (H - 2 * pad) / L.H0);
  const ox = (W - L.W0 * k) / 2, oy = (H - L.H0 * k) / 2;
  const unitK = Math.min(W, H) / 1080;
  const tilted = s.rx || s.ry;
  const boxes = [];
  for (const it of L.items) {
    // Draw the device into its own canvas at final resolution.
    const sw = it.sw * k, sh = it.sh * k;
    const g = geometry(it.d, sw, sh);
    const m = Math.ceil(Math.max(g.w, g.h) * 0.02) + 2; // room for side buttons
    const dc = scratch(`mk-dev-${it.d.id}-${W}`, g.w + 2 * m, g.h + 2 * m);
    const dx = dc.getContext('2d');
    dx.clearRect(0, 0, dc.width, dc.height);
    dx.save(); dx.translate(m, m);
    drawDevice(dx, it.d, g, (c, r) => drawScreenContent(c, it.d, r));
    dx.restore();

    const x = ox + it.x * k - m, y = oy + it.y * k - m;
    const cx = x + dc.width / 2, cy = y + dc.height / 2;
    ctx.save();
    if (s.shadow > 0) {
      const a = s.shadow / 100;
      ctx.shadowColor = `rgba(0,0,0,${0.5 * a})`;
      ctx.shadowBlur = 70 * unitK * a + 4;
      ctx.shadowOffsetY = 30 * unitK * a;
    }
    if (tilted && persp) {
      const quad = projectRect(dc.width, dc.height, { rx: s.rx, ry: s.ry, rz: s.rz, x: cx, y: cy, focal: Math.max(W, H) * 1.6 });
      ctx.drawImage(persp.draw(dc, quad, W, H), 0, 0);
      const xs = quad.map((q) => q[0]), ys = quad.map((q) => q[1]);
      boxes.push({ id: it.d.id, x: Math.min(...xs), y: Math.min(...ys), w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) });
    } else {
      ctx.translate(cx, cy);
      ctx.rotate((s.rz * Math.PI) / 180);
      ctx.drawImage(dc, -dc.width / 2, -dc.height / 2);
      boxes.push({ id: it.d.id, x, y, w: dc.width, h: dc.height });
    }
    ctx.restore();
  }
  return boxes;
}

function draw() {
  const L = rowLayout();
  const [W, H] = canvasSize(L);
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  canvas.classList.toggle('checker', s.bg === 'none');
  hitboxes = compose(canvas.getContext('2d'), W, H);
}

function renderAt(scale) {
  const L = rowLayout();
  const [W, H] = canvasSize(L, Math.round(PREVIEW_LONG * scale));
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  compose(c.getContext('2d'), W, H);
  return c;
}

if (!persp) toast('3D tilt needs WebGL, which is unavailable here; tilt falls back to flat rotation.', 'warning');

createImageExport($('export'), {
  id: 'mockup',
  getCanvas: renderAt,
  formats: ['png', 'jpg', 'webp'],
  scales: [1, 2],
  filename: () => (devices.find((d) => d.media) ? `${safeName(devices.find((d) => d.media).media.name)}-mockup` : 'mockup'),
  matte: () => (s.bg === 'solid' ? s.bgColor : '#ffffff'),
});

renderList();
renderEditor();
draw();
