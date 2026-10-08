/* Nametag Tracker: a blocky player nametag that floats above a person's head and follows it. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, progressModal, TRANSPARENT_HINT } from '/assets/js/lib/exporter.js';
import { outputSize, scratch, supportsCanvasFilter } from '/assets/js/lib/canvas.js';
import { h, toast } from '/assets/js/lib/dom.js';
import { SEGMENT_MODELS, loadSegmenter } from '/assets/js/lib/vision.js';
import { createPersonMask, drawPersonCutout } from '/assets/js/lib/person-mask.js';
import { trackHead, smoothTrack, sampleTrack } from '/assets/js/lib/head-tracking.js';
import { layoutLine, drawLine, ROWS } from './pixel-font.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const debug = document.getElementById('debug');
const dctx = debug.getContext('2d');
const overlay = document.getElementById('overlay');

let media = null;
let track = null;         // raw tracking pass: { fps, w, h, samples }
let smooth = null;        // smoothTrack(track, …): what preview and export draw from
let tracking = false;     // a tracking pass is running
let trackNote = '';       // status shown under the Tracking section
let segmenter = null;     // loaded only when "Hide behind person" is on
let segmenterKey = null;
let lastTag = null;       // geometry of the tag drawn last, for dragging
const mask = createPersonMask('nt');
const isVideo = () => media?.kind === 'video';

/* Tag colours: the classic 16-colour text palette values. Shadows are the colour at 25%. */
const PRESETS = [
  { label: 'Classic', value: 'classic', patch: { textColor: '#ffffff', textOpacity: 100, shadow: false, bgOpacity: 25 } },
  { label: 'Sneaking', value: 'sneak', patch: { textColor: '#ffffff', textOpacity: 32, shadow: false, bgOpacity: 25 } },
  { label: 'Shadowed', value: 'shadow', patch: { textColor: '#ffffff', textOpacity: 100, shadow: true, bgOpacity: 25 } },
  { label: 'Gold', value: 'gold', patch: { textColor: '#ffaa00', textOpacity: 100, shadow: true, bgOpacity: 25 } },
  { label: 'Red team', value: 'red', patch: { textColor: '#ff5555', textOpacity: 100, shadow: true, bgOpacity: 25 } },
  { label: 'Aqua', value: 'aqua', patch: { textColor: '#55ffff', textOpacity: 100, shadow: true, bgOpacity: 40 } },
];
const pct = (v) => `${Math.round(v)}%`;
const statusEl = h('div', { class: 'nt-status' });

/* ---------- Controls ---------- */
const panel = createControls(document.getElementById('controls'), [
  { title: 'Username', controls: [
    { id: 'name', type: 'text', label: 'Name', value: 'Steve_123', placeholder: 'Steve_123' },
    { id: 'anyText', type: 'toggle', label: 'Allow any text', value: false,
      hint: 'Off: up to 16 letters, digits and _, like real usernames.' },
  ]},
  { title: 'Look', controls: [
    { id: 'preset', type: 'presets', label: 'Presets', value: 'classic', options: PRESETS },
    { id: 'textColor', type: 'color', label: 'Text color', value: '#ffffff' },
    { id: 'textOpacity', type: 'range', label: 'Text opacity', min: 5, max: 100, value: 100, format: pct },
    { id: 'shadow', type: 'toggle', label: 'Text shadow', value: false },
    { id: 'bgOpacity', type: 'range', label: 'Background opacity', min: 0, max: 100, value: 25, format: pct },
  ]},
  { title: 'Size and position', controls: [
    { id: 'dynamic', type: 'toggle', label: 'Scale with head', value: true, hint: 'The tag grows as the person comes closer. Off keeps one size (their average).' },
    { id: 'size', type: 'range', label: 'Size', min: 0.25, max: 4, step: 0.05, value: 1, format: (v) => `${v.toFixed(2)}×` },
    { id: 'offsetY', type: 'range', label: 'Height above head', min: -12, max: 40, step: 0.5, value: 3, format: (v) => `${v} px`,
      hint: 'In tag pixels. Drag the tag on the preview to fine-tune.' },
    { id: 'offsetX', type: 'range', label: 'Sideways', min: -80, max: 80, step: 0.5, value: 0, format: (v) => `${v} px` },
    { id: 'tilt', type: 'toggle', label: 'Tilt with head', value: false, hint: 'Off keeps the tag upright, like in the game.' },
    { id: 'inFrame', type: 'toggle', label: 'Keep inside frame', value: true, hint: 'Slides the tag into view when the head is near an edge.' },
  ]},
  { title: 'Tracking', showIf: () => !!media, controls: [
    { id: 'detector', type: 'segmented', label: 'Find the head by', value: 'auto', options: [['auto', 'Face, then body'], ['face', 'Face'], ['body', 'Body']] },
    { id: 'trackFps', type: 'segmented', label: 'Tracking rate', value: '30', options: [['15', '15 / s'], ['30', '30 / s']], showIf: () => isVideo() },
    { id: 'smoothing', type: 'range', label: 'Smoothing', min: 0, max: 1, step: 0.05, value: 0.6, format: pct100 },
    { id: 'hold', type: 'range', label: 'Hold when lost', min: 0, max: 2, step: 0.1, value: 0.4, unit: 's', decimals: 1, showIf: () => isVideo() },
    { id: 'fade', type: 'range', label: 'Fade', min: 0.05, max: 1, step: 0.05, value: 0.3, unit: 's', decimals: 2, showIf: () => isVideo() },
    { id: 'debugView', type: 'toggle', label: 'Show tracking overlay', value: false, hint: 'Preview only; never exported.' },
    { type: 'custom', el: statusEl },
    { type: 'button', text: 'Track again', onClick: () => runTracking() },
  ]},
  { title: 'Depth', showIf: () => !!media, controls: [
    { id: 'behind', type: 'toggle', label: 'Hide behind person', value: false,
      hint: 'Hands or objects passing in front of the head cover the tag.' },
    { id: 'model', type: 'select', label: 'Segmentation model', value: 'general', options: Object.entries(SEGMENT_MODELS).map(([k, m]) => [k, m.label]), showIf: (s) => s.behind },
    { id: 'threshold', type: 'range', label: 'Edge threshold', min: 0.1, max: 0.9, step: 0.01, value: 0.5, decimals: 2, showIf: (s) => s.behind },
    { id: 'feather', type: 'range', label: 'Feather', min: 0, max: 20, value: 3, unit: 'px', showIf: (s) => s.behind,
      hint: supportsCanvasFilter ? '' : 'Feather needs canvas filters (not available in this browser).' },
  ]},
  { title: 'Output', controls: [
    { id: 'output', type: 'segmented', label: 'Contents', value: 'video', options: [['video', 'Video + tag'], ['tag', 'Tag only']],
      hint: 'Tag only exports the nametag on a transparent background, ready to overlay in an editor.' },
    { id: 'clip', type: 'range', label: 'Clip length', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1, showIf: () => !isVideo() },
  ]},
], { onChange: (st, id) => {
  if (id === 'name' || id === 'anyText') sanitizeName();
  if (['textColor', 'textOpacity', 'shadow', 'bgOpacity'].includes(id)) panel.set({ preset: '' }, { silent: true });
  if (id === 'detector' || id === 'trackFps') runTracking();
  if (['smoothing', 'hold', 'fade'].includes(id)) resmooth();
  if (id === 'behind' || id === 'model') { mask.reset(); if (st.behind) initSegmenter(); }
  if (id === 'output') canvas.classList.toggle('checker', st.output === 'tag');
  if (id === 'debugView') debug.hidden = !st.debugView;
  exportBar.refresh();
  stage.invalidate();
} });
const s = panel.state;

function pct100(v) { return `${Math.round(v * 100)}%`; }

/** Usernames: A–Z, 0–9 and _, at most 16. "Allow any text" lifts that (up to 48 characters). */
function sanitizeName() {
  const clean = s.anyText ? s.name.slice(0, 48) : s.name.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16);
  if (clean !== s.name) panel.set({ name: clean }, { silent: true });
}

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a video of a person',
  onLoad: (m) => {
    media = m;
    const { w, h: hh } = outputSize(m.width, m.height, 1920);
    canvas.width = debug.width = w; canvas.height = debug.height = hh;
    track = smooth = null;
    mask.reset();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    placeDebug();
    runTracking();
  },
  onClear: () => {
    media = null; track = smooth = null; mask.reset();
    canvas.width = debug.width = 1280; canvas.height = debug.height = 720;
    panel.refresh(); stage.reset(); exportBar.refresh(); placeDebug(); showIntro();
  },
});

/* ---------- Tracking pass ---------- */
let trackRun = 0;
async function runTracking() {
  if (!media) return;
  const run = ++trackRun;
  const ctrl = new AbortController();
  const modal = progressModal('Tracking the head…', () => ctrl.abort(),
    'Downloads the face model (~4 MB) on first use, then checks every frame. Keep this tab visible.');
  tracking = true;
  stage.pause();
  stage.setTransportDisabled(true);
  exportBar.setDisabled(true);
  overlay.hidden = true;
  try {
    const result = await trackHead(media, { fps: +s.trackFps, mode: s.detector, onProgress: modal.set, signal: ctrl.signal });
    if (run !== trackRun) return;
    if (!result) { trackNote = 'cancelled'; return; }
    track = result;
    resmooth();
    trackNote = '';
  } catch (err) {
    console.error(err);
    trackNote = 'error';
    toast('Could not load the tracking model. Check your connection or content blockers, then press Track again.', 'error', 8000);
  } finally {
    if (run === trackRun) {
      modal.close();
      tracking = false;
      stage.setTransportDisabled(false);
      exportBar.setDisabled(false);
      exportBar.refresh();
      showTrackStatus();
      stage.seek(0);
      if (smooth?.found) stage.play().catch(() => {});
    } else modal.close();
  }
}

/** Re-smooth the stored track (cheap: no detection) after a smoothing / hold / fade change. */
function resmooth() {
  if (!track) return;
  smooth = smoothTrack(track, { strength: s.smoothing, hold: s.hold, fadeOut: s.fade, fadeIn: Math.min(s.fade, 0.25) });
  const sizes = track.samples.filter((x) => x.found).map((x) => x.size).sort((a, b) => a - b);
  smooth.medianSize = sizes.length ? sizes[sizes.length >> 1] : 0.2;
  showTrackStatus();
}

function showTrackStatus() {
  statusEl.classList.remove('is-warn');
  if (trackNote === 'cancelled') { statusEl.classList.add('is-warn'); statusEl.textContent = 'Tracking was cancelled. Press Track again to place the tag.'; return; }
  if (trackNote === 'error') { statusEl.classList.add('is-warn'); statusEl.textContent = 'The tracking model failed to load.'; return; }
  if (!smooth) { statusEl.textContent = ''; return; }
  const share = smooth.total ? smooth.found / smooth.total : 0;
  const via = { face: 0, pose: 0 };
  track.samples.forEach((x) => { if (x.found) via[x.via]++; });
  if (!smooth.found) {
    statusEl.classList.add('is-warn');
    statusEl.textContent = 'No head found. Try "Body" tracking, or a clip where the person is larger and well lit.';
    return;
  }
  statusEl.replaceChildren(
    h('strong', {}, `Head found in ${Math.round(share * 100)}% of ${smooth.total} frame${smooth.total === 1 ? '' : 's'}`),
    h('br'),
    `${via.face} by face, ${via.pose} by body.${share < 0.6 ? ' Gaps hold, then fade out.' : ''}`,
    h('div', { class: 'nt-meter' }, h('div', { style: `width:${share * 100}%` })));
}

/* ---------- Segmentation (only for "Hide behind person") ---------- */
async function initSegmenter() {
  const key = s.model;
  if (segmenterKey === key && segmenter) return;
  segmenter = null; segmenterKey = key;
  try {
    const seg = await loadSegmenter(key);
    if (s.model === key) { segmenter = seg; stage.invalidate(); }
  } catch (err) {
    console.error(err);
    toast('Could not load the segmentation model, so the tag stays in front.', 'error', 7000);
  }
}

/* ---------- Tag geometry and drawing ---------- */
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

/** The tag at 1 canvas px per tag pixel: box with 1 px padding, optional shadow, text. Cached. */
let tagCache = { key: '', canvas: null };
function tagBitmap() {
  const key = [s.name, s.textColor, s.textOpacity, s.shadow, s.bgOpacity].join('|');
  if (tagCache.key === key) return tagCache.canvas;
  const line = layoutLine(s.name);
  const w = line.width + 2, hh = ROWS + 2;
  const c = scratch('nt-tag', w, hh);
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, hh);
  x.fillStyle = `rgba(0,0,0,${s.bgOpacity / 100})`;
  x.fillRect(0, 0, w, hh);
  x.globalAlpha = s.textOpacity / 100;
  // Shadow and text go through a layer so a translucent text doesn't show its own shadow through it.
  const layer = scratch('nt-tag-text', w, hh);
  const lx = layer.getContext('2d');
  lx.clearRect(0, 0, w, hh);
  if (s.shadow) { lx.fillStyle = shade(s.textColor, 0.25); drawLine(lx, line, 2, 2); }
  lx.fillStyle = s.textColor;
  drawLine(lx, line, 1, 1);
  x.drawImage(layer, 0, 0);
  x.globalAlpha = 1;
  tagCache = { key, canvas: c };
  return c;
}

/** Where the tag goes for a head (or the centre of the frame when there's no media). */
function tagGeometry(head, W, H) {
  const k = Math.min(W, H) / 1080;
  const bmp = tagBitmap();
  // Tag pixel size: text (8 rows) about 40% of a head width, like the game's proportions.
  const headPx = head ? (s.dynamic ? head.size : smooth?.medianSize ?? head.size) * H : 0;
  const u = Math.max(0.5, head ? headPx * 0.05 * s.size : 6 * k * s.size);
  const w = bmp.width * u, hh = bmp.height * u;
  const ax = head ? head.x * W : W / 2;
  const ay = head ? head.y * H : H / 2 + hh / 2;
  const angle = head && s.tilt ? head.roll : 0;
  // Tag frame: origin at the head top, x along the tag, y down. Box bottom sits offsetY tag-px above.
  const left = s.offsetX * u - w / 2, top = -s.offsetY * u - hh;
  const g = { bmp, u, w, h: hh, ax, ay, angle, left, top, alpha: head ? head.alpha : 1 };
  if (head && s.inFrame) keepInFrame(g, W, H);
  return g;
}

/** Shift the tag's anchor so its (rotated) box stays at least 2 tag px inside the frame. */
function keepInFrame(g, W, H) {
  const c = Math.cos(g.angle), sn = Math.sin(g.angle), m = 2 * g.u;
  const xs = [], ys = [];
  for (const [x, y] of [[g.left, g.top], [g.left + g.w, g.top], [g.left, g.top + g.h], [g.left + g.w, g.top + g.h]]) {
    xs.push(g.ax + x * c - y * sn);
    ys.push(g.ay + x * sn + y * c);
  }
  const shift = (lo, hi, size) => (hi - lo > size - 2 * m ? (size - lo - hi) / 2 : lo < m ? m - lo : hi > size - m ? size - m - hi : 0);
  g.ax += shift(Math.min(...xs), Math.max(...xs), W);
  g.ay += shift(Math.min(...ys), Math.max(...ys), H);
}

function tagPath(c, g, pad = 0) {
  c.translate(g.ax, g.ay);
  c.rotate(g.angle);
  c.beginPath();
  c.rect(g.left - pad, g.top - pad, g.w + pad * 2, g.h + pad * 2);
}

function drawTag(c, g) {
  c.save();
  c.globalAlpha = g.alpha;
  c.imageSmoothingEnabled = false; // nearest neighbour keeps every tag pixel a hard-edged block
  if (g.angle) {
    c.translate(g.ax, g.ay);
    c.rotate(g.angle);
    c.drawImage(g.bmp, g.left, g.top, g.w, g.h);
  } else {
    // Upright: snap to whole canvas pixels so the edges never land between pixels.
    const x = Math.round(g.ax + g.left), y = Math.round(g.ay + g.top);
    c.drawImage(g.bmp, x, y, Math.round(g.ax + g.left + g.w) - x, Math.round(g.ay + g.top + g.h) - y);
  }
  c.restore();
}

/* ---------- Rendering ---------- */
function render(t) {
  const W = canvas.width, H = canvas.height;
  const tagOnly = s.output === 'tag';
  ctx.clearRect(0, 0, W, H);
  lastTag = null;

  if (!media) {
    if (!tagOnly) drawDemoBackground(W, H);
    if (s.name) { lastTag = tagGeometry(null, W, H); drawTag(ctx, lastTag); }
    return;
  }
  if (!tagOnly) ctx.drawImage(media.el, 0, 0, W, H);
  if (tracking || !s.name) return;
  const head = sampleTrack(smooth, t);
  if (!head || head.alpha <= 0.001) return;

  const g = tagGeometry(head, W, H);
  lastTag = g;
  drawTag(ctx, g);

  // Hide behind person: whatever the mask calls "person" inside the tag's box covers the tag.
  if (s.behind && segmenter && mask.update(segmenter, media.el, t, { model: s.model, smoothing: 0, still: !isVideo() })) {
    const k = Math.min(W, H) / 1080;
    const alpha = mask.full(W, H, { threshold: s.threshold, softness: 0.2, feather: s.feather * k });
    ctx.save();
    tagPath(ctx, g, 2);
    ctx.setTransform(1, 0, 0, 1, 0, 0); // the clip stays; draw the cut-out unrotated
    ctx.clip();
    if (tagOnly) {
      ctx.globalCompositeOperation = 'destination-out';
      ctx.drawImage(alpha, 0, 0);
    } else drawPersonCutout(ctx, media.el, alpha, 'nt-person');
    ctx.restore();
  }
}

function drawDemoBackground(W, H) {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#5a8fd8');
  g.addColorStop(0.7, '#a8c8f0');
  g.addColorStop(0.7, '#5d9b3a');
  g.addColorStop(1, '#3f6e27');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
}

/* ---------- Tracking overlay (separate canvas: never exported) ---------- */
function drawDebug(t) {
  if (debug.hidden) return;
  const W = debug.width, H = debug.height, k = Math.min(W, H) / 1080;
  dctx.clearRect(0, 0, W, H);
  if (!media || !track || !smooth?.frames.length) return;
  dctx.lineWidth = 2 * k;
  // Smoothed path over the whole clip.
  dctx.strokeStyle = 'rgba(80,220,140,.45)';
  dctx.beginPath();
  let prevSeg = null;
  smooth.frames.forEach((f) => {
    if (f.seg < 0) { prevSeg = null; return; }
    if (f.seg !== prevSeg) dctx.moveTo(f.x * W, f.y * H); else dctx.lineTo(f.x * W, f.y * H);
    prevSeg = f.seg;
  });
  dctx.stroke();
  // Raw detection at this frame.
  const i = Math.min(track.samples.length - 1, Math.round(t * track.fps));
  const raw = track.samples[i];
  if (raw?.found) {
    const size = raw.size * H;
    dctx.strokeStyle = raw.via === 'face' ? '#ff5d5d' : '#ffb340';
    dctx.strokeRect(raw.x * W - size / 2, raw.y * H, size, size * 1.25);
    dot(raw.x * W, raw.y * H, 6 * k, dctx.strokeStyle);
  }
  // Smoothed head top.
  const head = sampleTrack(smooth, t);
  if (head) dot(head.x * W, head.y * H, 7 * k, '#50dc8c');
  const label = `frame ${i + 1}/${track.samples.length} · ${raw?.found ? raw.via : 'lost'} · opacity ${Math.round((head?.alpha ?? 0) * 100)}%`;
  dctx.font = `600 ${Math.round(22 * k)}px ui-monospace, monospace`;
  const tw = dctx.measureText(label).width;
  dctx.fillStyle = 'rgba(0,0,0,.6)';
  dctx.fillRect(12 * k, 12 * k, tw + 20 * k, 36 * k);
  dctx.fillStyle = '#fff';
  dctx.fillText(label, 22 * k, 37 * k);
}
function dot(x, y, r, color) {
  dctx.fillStyle = color;
  dctx.beginPath(); dctx.arc(x, y, r, 0, Math.PI * 2); dctx.fill();
}

/** Keep the overlay canvas exactly on top of the (CSS-scaled) preview canvas. */
function placeDebug() {
  Object.assign(debug.style, {
    left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`,
    width: `${canvas.offsetWidth}px`, height: `${canvas.offsetHeight}px`,
  });
}
new ResizeObserver(placeDebug).observe(canvas);
window.addEventListener('resize', placeDebug);

/* ---------- Drag the tag to fine-tune its offset ---------- */
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
};
/** A canvas point in the tag's own frame (unrotated, origin at the head top). */
const toTag = (g, p) => {
  const dx = p.x - g.ax, dy = p.y - g.ay, c = Math.cos(-g.angle), sn = Math.sin(-g.angle);
  return { x: dx * c - dy * sn, y: dx * sn + dy * c };
};
const hitTag = (g, p) => {
  if (!g) return false;
  const q = toTag(g, p), pad = 8 * (canvas.width / canvas.getBoundingClientRect().width);
  return q.x >= g.left - pad && q.x <= g.left + g.w + pad && q.y >= g.top - pad && q.y <= g.top + g.h + pad;
};
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  const p = toCanvas(e);
  if (!media || !hitTag(lastTag, p)) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drag = { g: lastTag, start: toTag(lastTag, p), x: s.offsetX, y: s.offsetY };
  canvas.classList.add('nt-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (!drag) { canvas.classList.toggle('nt-hover', !!media && hitTag(lastTag, p)); return; }
  const q = toTag(drag.g, p);
  const snap = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 2) / 2));
  panel.set({
    offsetX: snap(drag.x + (q.x - drag.start.x) / drag.g.u, -80, 80),
    offsetY: snap(drag.y - (q.y - drag.start.y) / drag.g.u, -12, 40),
  }, { silent: true });
  stage.invalidate();
});
const endDrag = () => { drag = null; canvas.classList.remove('nt-dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* ---------- Stage + export ---------- */
const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: () => (isVideo() ? media.duration : media ? s.clip : 4),
  getVideo: () => (isVideo() ? media.el : null),
});
stage.events.addEventListener('tick', (e) => drawDebug(e.detail.t));

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `nametag-${s.name || 'tag'}${s.output === 'tag' ? '-alpha' : ''}`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!smooth,
  gif: () => !!smooth,
  png: () => !media || !!smooth,
  beforeExport: () => {
    if (s.behind && !segmenter) throw new Error('The segmentation model is still loading. Try again in a moment.');
    mask.reset();
  },
  hint: () => [
    media && !smooth && !tracking ? 'Track the video to place the tag.' : '',
    s.output === 'tag' ? TRANSPARENT_HINT : '',
  ].filter(Boolean).join(' '),
});

function showIntro() {
  overlay.hidden = false;
  overlay.classList.add('is-note');
  overlay.innerHTML = '<div><strong>Style your tag here.</strong> Drop a video of a person on the left and it will follow their head.</div>';
}

showIntro();
placeDebug();
stage.play().catch(() => {});
