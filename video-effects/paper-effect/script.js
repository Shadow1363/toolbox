/* Paper Effect — torn/cut paper edges, paper textures and stop-motion jitter, for one photo/video or a collage. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone, createFilePicker } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, TRANSPARENT_HINT } from '/assets/js/lib/exporter.js';
import { fit, outputSize, scratch, drawBlurred } from '/assets/js/lib/canvas.js';
import { hash } from '/assets/js/lib/random.js';
import { ease, clamp, easingOptions } from '/assets/js/lib/easing.js';
import { createPerspective } from '/assets/js/lib/perspective.js';
import { loadMedia, seekVideo } from '/assets/js/lib/media.js';
import { ensureFont, fontString } from '/assets/js/lib/fonts.js';
import { h, icon, toast } from '/assets/js/lib/dom.js';
import { overlayTexture, backgroundTexture, edgePath, tracePath } from './textures.js';
import { ENTRANCES, EXITS, transformCard } from './transitions.js';
import { LAYOUTS, COLLAGE_ANIMS, layoutItems, collageTimeline, placements, entrance, drawTape, drawClip } from './collage.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const handles = document.getElementById('handles');
const hctx = handles.getContext('2d');
const persp = createPerspective(); // WebGL for fold/crumple; falls back to flat 2D if unavailable
let media = null;

// Collage: items[0] is the bottom layer.
// { id, media, edge: 'default' | 'torn' | 'cutout' | 'rounded' | 'straight', tape: null | bool, border: null | bool,
//   caption, seed, manual: null | { x, y (0..1 of the frame), rot (°), scale } }
let items = [];
let nextItemId = 1;
let selected = null;
let bgImage = null;
let collageReady = false; // stop-motion defaults applied on the first switch to Collage
const MAX_ITEMS = 16;

// Sensible defaults when a transition is picked: [easing, duration]
const TRANSITION_DEFAULTS = {
  unfold: ['easeInOut', 1], 'unfold-letter': ['easeInOut', 1.6], uncrumple: ['easeOut', 1.4],
  fold: ['easeInOut', 1], 'fold-letter': ['easeInOut', 1.6], crumple: ['easeIn', 1.4],
};

const ASPECTS = { media: null, '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };

/* ---------- Controls ---------- */
const presets = [
  { label: 'Torn photo', value: 'torn', patch: { edge: 'torn', rim: 14, rough: 10, texture: 'fiber', intensity: 0.4, bg: 'kraft', bgColor: '#c49a6c', rotation: -3, scale: 78, stopMotion: false } },
  { label: 'Scrapbook', value: 'scrap', patch: { edge: 'cutout', rim: 18, rough: 6, texture: 'grain', intensity: 0.35, bg: 'grid', bgColor: '#f4f1ea', rotation: 2, scale: 76, stopMotion: false } },
  { label: 'Crumpled', value: 'crumpled', patch: { edge: 'torn', rim: 6, rough: 14, texture: 'crumpled', intensity: 0.6, bg: 'cardboard', bgColor: '#b08a5f', rotation: -1.5, scale: 80, stopMotion: false } },
  { label: 'Stop-motion', value: 'stop', patch: { edge: 'cutout', rim: 12, rough: 8, texture: 'fiber', intensity: 0.45, bg: 'cork', bgColor: '#a57744', rotation: 1, scale: 76, stopMotion: true, fps: 8, jitter: 6, boil: true, choppy: true } },
  { label: 'Clean print', value: 'print', patch: { edge: 'straight', rim: 26, rough: 0, texture: 'grain', intensity: 0.2, bg: 'solid', bgColor: '#1d1f24', rotation: 0, scale: 80, stopMotion: false } },
];

const uploadEl = h('div', { id: 'upload' });
const collageEl = h('div', { class: 'pe-collage' });
const bgImageEl = h('div');
const single = (st) => st.mode !== 'collage';
const collage = (st) => st.mode === 'collage';

const panel = createControls(document.getElementById('controls'), [
  { title: 'Mode', controls: [
    { id: 'mode', type: 'segmented', label: 'Layout', value: 'single', options: [['single', 'Single'], ['collage', 'Collage']],
      hint: 'Single: one photo or video. Collage: several, stacked as paper cutouts like a scrapbook.' },
  ]},
  { title: 'Media', showIf: single, controls: [{ type: 'custom', el: uploadEl }] },
  { title: 'Collage items', showIf: collage, controls: [{ type: 'custom', el: collageEl }] },
  { title: 'Collage layout', showIf: collage, controls: [
    { id: 'layout', type: 'select', label: 'Preset', value: 'pile', options: LAYOUTS },
    { id: 'cSize', type: 'range', label: 'Item size', min: 40, max: 180, step: 5, value: 100, unit: '%' },
    { id: 'cSpread', type: 'range', label: 'Spread', min: 0, max: 200, step: 5, value: 100, unit: '%', hint: 'How far items stray from their spot.' },
    { id: 'cTilt', type: 'range', label: 'Tilt', min: 0, max: 200, step: 5, value: 100, unit: '%' },
    { id: 'captions', type: 'toggle', label: 'Captions under the photos', value: true, showIf: (st) => st.layout === 'polaroid', hint: 'Type each caption in the item list.' },
    { id: 'cSeed', type: 'range', label: 'Layout variation', min: 1, max: 99, value: 1 },
    { type: 'button', text: 'Re-randomize layout', onClick: () => rerollAll() },
  ]},
  { title: 'Collage animation', showIf: collage, controls: [
    { id: 'cAnim', type: 'segmented', label: 'Items arrive', value: 'drop', options: COLLAGE_ANIMS },
    { id: 'cOrder', type: 'select', label: 'Order', value: 'bottom', options: [['bottom', 'Bottom layer first'], ['top', 'Top layer first'], ['random', 'Random']] },
    { id: 'cDelay', type: 'range', label: 'Delay between items', min: 0.1, max: 2, step: 0.05, value: 0.45, unit: 's', decimals: 2 },
    { id: 'cDur', type: 'range', label: 'Arrival duration', min: 0.1, max: 1.5, step: 0.05, value: 0.45, unit: 's', decimals: 2, showIf: (st) => st.cAnim !== 'none' },
    { id: 'cMode', type: 'segmented', label: 'Build', value: 'hold', options: [['hold', 'Build up, then hold'], ['loop', 'Keep adding']] },
    { id: 'cHold', type: 'range', label: 'Hold at the end', min: 0, max: 8, step: 0.5, value: 2, unit: 's', decimals: 1, showIf: (st) => st.cMode === 'hold' },
    { id: 'cRounds', type: 'range', label: 'Rounds', min: 1, max: 6, value: 2, showIf: (st) => st.cMode === 'loop', hint: 'Each round adds every item again, on top, in a new spot.' },
    { id: 'cVideos', type: 'segmented', label: 'Videos play', value: 'all', options: [['all', 'All at once'], ['top', 'Only the top one']], showIf: () => hasCollageVideo() },
  ]},
  { title: 'Look', controls: [
    { id: 'preset', type: 'presets', label: 'Presets', value: 'torn', options: presets },
  ]},
  { title: 'Paper', controls: [
    { id: 'texture', type: 'segmented', label: 'Texture', value: 'fiber', options: [['none', 'None'], ['grain', 'Grain'], ['fiber', 'Fiber'], ['crumpled', 'Crumpled']] },
    { id: 'intensity', type: 'range', label: 'Intensity', min: 0, max: 1, step: 0.01, value: 0.4, format: (v) => `${Math.round(v * 100)}%`, showIf: (s) => s.texture !== 'none' },
    { id: 'paperColor', type: 'color', label: 'Paper color', value: '#fbf8f1' },
  ]},
  { title: 'Edges', controls: [
    { id: 'edge', type: 'segmented', label: 'Edge style', value: 'torn', options: [['straight', 'Straight'], ['torn', 'Torn'], ['cutout', 'Cut out']] },
    { id: 'rough', type: 'range', label: 'Roughness', min: 0, max: 30, value: 10, unit: 'px', showIf: (s) => s.edge !== 'straight' },
    { id: 'rim', type: 'range', label: 'Paper border', min: 0, max: 60, value: 14, unit: 'px' },
    { id: 'seed', type: 'range', label: 'Tear variation', min: 1, max: 50, value: 7, showIf: (s) => s.edge !== 'straight' },
  ]},
  { title: 'Placement', controls: [
    { id: 'scale', type: 'range', label: 'Size', min: 30, max: 100, value: 78, unit: '%', showIf: single },
    { id: 'rotation', type: 'range', label: 'Rotation', min: -15, max: 15, step: 0.5, value: -3, unit: '°', decimals: 1, showIf: single },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 80, value: 30, unit: 'px' },
    { id: 'shadowOpacity', type: 'range', label: 'Shadow strength', min: 0, max: 1, step: 0.01, value: 0.45, format: (v) => `${Math.round(v * 100)}%`, showIf: (s) => s.shadow > 0 },
  ]},
  { title: 'Entrance', showIf: single, controls: [
    { id: 'enter', type: 'select', label: 'Animation', value: 'none', options: ENTRANCES },
    { id: 'enterEasing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions, showIf: (s) => s.enter !== 'none' },
    { id: 'enterDuration', type: 'range', label: 'Duration', min: 0.2, max: 4, step: 0.1, value: 1, unit: 's', decimals: 1, showIf: (s) => s.enter !== 'none' },
    { id: 'enterStart', type: 'range', label: 'Start at', min: 0, max: 10, step: 0.1, value: 0, unit: 's', decimals: 1, showIf: (s) => s.enter !== 'none' },
  ]},
  { title: 'Exit', showIf: single, controls: [
    { id: 'exit', type: 'select', label: 'Animation', value: 'stay', options: EXITS },
    { id: 'exitEasing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions, showIf: (s) => s.exit !== 'stay' },
    { id: 'exitDuration', type: 'range', label: 'Duration', min: 0.2, max: 4, step: 0.1, value: 1, unit: 's', decimals: 1, showIf: (s) => s.exit !== 'stay' },
    { id: 'exitEnd', type: 'range', label: 'End at', min: 0.1, max: 10, step: 0.01, value: 4, unit: 's', decimals: 1, showIf: (s) => s.exit !== 'stay',
      hint: 'When the paper is fully gone. Defaults to the end of the clip.' },
  ]},
  { title: 'Background', controls: [
    { id: 'bg', type: 'select', label: 'Surface', value: 'kraft', options: [['transparent', 'None (transparent)'], ['solid', 'Solid color'], ['kraft', 'Kraft paper'], ['cardboard', 'Cardboard'], ['grid', 'Grid paper'], ['cork', 'Cork board'], ['wood', 'Wooden desk'], ['blur', 'Blurred media'], ['image', 'Your image']] },
    { id: 'bgColor', type: 'color', label: 'Color', value: '#c49a6c', showIf: (s) => s.bg !== 'blur' && s.bg !== 'transparent' && s.bg !== 'image' },
    { type: 'custom', el: bgImageEl, showIf: (s) => s.bg === 'image' },
    { id: 'aspect', type: 'segmented', label: 'Aspect ratio', value: 'media', options: [['media', 'Media'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5']] },
  ]},
  { title: 'Stop-motion', controls: [
    { id: 'stopMotion', type: 'toggle', label: 'Handmade jitter', value: false, hint: 'Nudges the paper a little on every step, like stop-motion.' },
    { id: 'fps', type: 'range', label: 'Steps per second', min: 2, max: 15, value: 8, showIf: (s) => s.stopMotion },
    { id: 'jitter', type: 'range', label: 'Jitter amount', min: 0, max: 20, value: 6, unit: 'px', showIf: (s) => s.stopMotion },
    { id: 'boil', type: 'toggle', label: 'Boiling edges', value: true, hint: 'Redraw the tear on every step.', showIf: (s) => s.stopMotion },
    { id: 'choppy', type: 'toggle', label: 'Choppy video frames', value: true, hint: 'Hold each video frame for a whole step.', showIf: (s) => s.stopMotion && (collage(s) ? hasCollageVideo() : media?.kind === 'video') },
    { id: 'clip', type: 'range', label: 'Clip length (images)', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1, showIf: (s) => single(s) && media?.kind !== 'video' },
  ]},
], { onChange: (s, id) => {
  if (id === 'enter' && TRANSITION_DEFAULTS[s.enter]) {
    const [easing, duration] = TRANSITION_DEFAULTS[s.enter];
    panel.set({ enterEasing: easing, enterDuration: duration }, { silent: true });
  }
  if (id === 'exit' && TRANSITION_DEFAULTS[s.exit]) {
    const [easing, duration] = TRANSITION_DEFAULTS[s.exit];
    panel.set({ exitEasing: easing, exitDuration: duration }, { silent: true });
  }
  if (id === 'exitEnd') endFollowsClip = s.exitEnd >= singleLength() - 0.01;
  if (id === 'clip') syncTimeRanges();
  if (id === 'mode') onModeChange();
  if (id === 'layout' || id === 'captions') renderItemList();
  resize();
  exportBar.refresh();
  stage.invalidate();
} });

const s = panel.state;

function hasCollageVideo() {
  return items.some((it) => it.media.kind === 'video');
}

/* ---------- Demo artwork shown before anything is uploaded ---------- */
function demoArt() {
  const c = document.createElement('canvas');
  c.width = 1600; c.height = 1000;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 1000);
  sky.addColorStop(0, '#ffb36b'); sky.addColorStop(0.55, '#f2706a'); sky.addColorStop(1, '#6b3f74');
  g.fillStyle = sky; g.fillRect(0, 0, 1600, 1000);
  g.fillStyle = '#fff1c1'; g.beginPath(); g.arc(1100, 380, 120, 0, Math.PI * 2); g.fill();
  const hill = (col, y, amp, f) => {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, 1000);
    for (let x = 0; x <= 1600; x += 20) g.lineTo(x, y + Math.sin(x * f) * amp + Math.sin(x * f * 2.7) * amp * 0.3);
    g.lineTo(1600, 1000); g.fill();
  };
  hill('#8a4d76', 640, 50, 0.004); hill('#5b3468', 740, 40, 0.006); hill('#2f2044', 840, 30, 0.009);
  return { kind: 'image', el: c, width: 1600, height: 1000, duration: 0 };
}
const demo = demoArt();
const src = () => media || demo;

/** Demo collage: a few made-up snapshots in different shapes. */
function demoCollage() {
  const scenes = [
    [1200, 900, ['#9ad0ec', '#e9f5fb'], '#f7d774', '#4f8f5b'],
    [900, 1200, ['#f6b38e', '#ffe2c6'], '#ffffff', '#c8553d'],
    [1000, 1000, ['#2d3a6b', '#6d7fc4'], '#f2efe6', '#1c2240'],
    [1300, 860, ['#b9e3c6', '#effaf2'], '#ff9f68', '#2e6f57'],
    [900, 1150, ['#f3c5d9', '#fff0f6'], '#7d5ba6', '#5a3d85'],
  ];
  return scenes.map(([w, hh, sky, sun, ground], i) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = hh;
    const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, hh);
    grad.addColorStop(0, sky[0]); grad.addColorStop(1, sky[1]);
    g.fillStyle = grad; g.fillRect(0, 0, w, hh);
    g.fillStyle = sun; g.beginPath(); g.arc(w * (0.3 + 0.1 * i), hh * 0.32, Math.min(w, hh) * 0.12, 0, Math.PI * 2); g.fill();
    g.fillStyle = ground; g.beginPath(); g.moveTo(0, hh);
    for (let x = 0; x <= w; x += 20) g.lineTo(x, hh * 0.68 + Math.sin(x * 0.006 + i) * hh * 0.06);
    g.lineTo(w, hh); g.fill();
    return { id: -1 - i, media: { kind: 'image', el: c, width: w, height: hh, duration: 0, name: `Demo ${i + 1}` }, edge: 'default', tape: null, border: null, caption: ['Summer', 'Road trip', 'Night out', 'Picnic', 'Best day'][i], seed: 11 + i * 17, manual: null };
  });
}
const demoItems = demoCollage();
const collageItems = () => (items.length ? items : demoItems);

/* ---------- Upload ---------- */
createDropzone(uploadEl, {
  accept: ['video', 'image'],
  onLoad: (m) => { media = m; onMediaChange(); },
  onClear: () => { media = null; onMediaChange(); },
});

function onMediaChange() {
  lastStep = -1;
  syncTimeRanges();
  panel.refresh();
  resize();
  stage.reset();
  exportBar.refresh();
  updateOverlay();
  if (media?.kind === 'video') stage.play().catch(() => {});
}

createDropzone(bgImageEl, {
  accept: ['image'],
  label: 'Drop a background image',
  onLoad: (m) => { bgImage = m.el; stage.invalidate(); },
  onClear: () => { bgImage = null; stage.invalidate(); },
});

function onModeChange() {
  if (collage(s) && !collageReady) {
    collageReady = true;
    // collages look best with stop-motion on
    panel.set({ stopMotion: true, fps: 8, jitter: 3 }, { silent: true });
  }
  if (!collage(s)) pauseCollageVideos();
  selected = null;
  lastStep = -1;
  panel.refresh();
  resize();
  stage.reset();
  updateOverlay();
  stage.play().catch(() => {});
}

function updateOverlay() {
  const showing = collage(s) ? !items.length : !media;
  overlay.hidden = !showing;
  overlay.innerHTML = collage(s)
    ? '<div><strong>Showing demo photos.</strong> Drop photos and videos on the left to build your collage.</div>'
    : '<div><strong>Showing a demo image.</strong> Drop an image or video on the left to use your own.</div>';
}

/* ---------- Timing ---------- */
const isVideo = () => media?.kind === 'video';
const singleLength = () => (isVideo() ? media.duration : s.clip);
const clipLength = () => (collage(s) ? collageTiming().total : singleLength());
const isAnimated = () => s.enter !== 'none' || s.exit !== 'stay';

// "End at" tracks the end of the clip until the user moves it somewhere else.
let endFollowsClip = true;
function syncTimeRanges() {
  const len = singleLength();
  for (const id of ['enterStart', 'exitEnd']) document.getElementById(`c-${id}`).max = len;
  const patch = { enterStart: Math.min(s.enterStart, len) };
  if (endFollowsClip || s.exitEnd > len) patch.exitEnd = len;
  panel.set(patch, { silent: true });
}

/**
 * Where the paper is in its entrance/exit at time t.
 * Returns { anim, p } with p = 1 for the flat card and 0 for gone (anim null = no transition).
 */
function transitionAt(t) {
  if (s.stopMotion) t = Math.floor(t * s.fps) / s.fps; // move in steps, like the jitter
  let anim = null, p = 1;
  if (s.enter !== 'none') {
    const x = (t - s.enterStart) / s.enterDuration;
    if (x < 1) { anim = s.enter; p = ease(s.enterEasing, clamp(x)); }
  }
  if (s.exit !== 'stay') {
    const start = s.exitEnd - s.exitDuration;
    if (t >= start) {
      const q = 1 - ease(s.exitEasing, clamp((t - start) / s.exitDuration));
      if (q < p) { anim = s.exit; p = q; }
    }
  }
  return { anim, p };
}

/* ---------- Rendering ---------- */
function resize() {
  const m = src();
  let w, h;
  const a = ASPECTS[s.aspect];
  if (!a && collage(s)) ({ w, h } = { w: 1920, h: 1080 }); // a collage has no single media shape
  else if (!a) ({ w, h } = outputSize(m.width, m.height, 1920));
  else ({ w, h } = a[0] >= a[1] ? { w: Math.round((1080 * a[0]) / a[1] / 2) * 2, h: 1080 } : { w: 1080, h: Math.round((1080 * a[1]) / a[0] / 2) * 2 });
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.classList.toggle('checker', s.bg === 'transparent');
}

// Choppy video: hold one frame per stop-motion step.
let lastStep = -1;
function currentFrame(step) {
  const m = src();
  if (m.kind !== 'video' || !s.stopMotion || !s.choppy) return m.el;
  const { w, h } = outputSize(m.width, m.height, 1920);
  const hold = scratch('paper-hold', w, h);
  if (step !== lastStep) {
    hold.getContext('2d').drawImage(m.el, 0, 0, w, h);
    lastStep = step;
  }
  return hold;
}

const patterns = new Map();
function patternFor(c, kind) {
  if (!patterns.has(kind)) patterns.set(kind, c.createPattern(overlayTexture(kind), 'repeat'));
  return patterns.get(kind);
}

/**
 * The paper card: paper backing, media clipped by the edge, texture over everything.
 * opts (collage items): { name, edge, rim (px), rimBottom (px), seed, paperColor, cover, caption, k }.
 * Without opts it uses the panel settings (Single mode).
 */
function buildCard(frame, mw, mh, k, step, o = {}) {
  const edge = o.edge ?? s.edge;
  const rim = o.rim ?? s.rim * k;
  const rimBottom = o.rimBottom ?? rim;
  const rough = edge === 'straight' ? 0 : s.rough * k;
  const pad = rough * 1.6 + 4;
  const ow = mw + rim * 2, oh = mh + rim + rimBottom;
  const cw = Math.ceil(ow + pad * 2), ch = Math.ceil(oh + pad * 2);
  const card = scratch(o.name || 'paper-card', cw, ch);
  const c = card.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cw, ch);
  c.translate(cw / 2, ch / 2);
  const my = (rim - rimBottom) / 2; // media centre (above the middle when the bottom border is wider)

  const seed = (o.seed ?? s.seed) + (s.stopMotion && s.boil ? (step % 4) * 13 : 0);
  const outer = edgePath(ow, oh, edge, rough, seed);

  // Paper backing.
  tracePath(c, outer);
  c.fillStyle = o.paperColor ?? s.paperColor;
  c.fill();

  // Media, clipped by the paper and (when torn) by its own rougher tear.
  c.save();
  tracePath(c, outer);
  c.clip();
  if (edge === 'torn' && rim > 0) {
    c.translate(0, my);
    tracePath(c, edgePath(mw, mh, 'torn', rough * 0.45, seed + 101));
    c.clip();
    c.translate(0, -my);
  }
  if (o.cover) {
    // crop the media to the window's shape (polaroids are square)
    const fw = frame.videoWidth || frame.width, fh = frame.videoHeight || frame.height;
    const sc = Math.max(mw / fw, mh / fh);
    const sw = mw / sc, sh = mh / sc;
    c.drawImage(frame, (fw - sw) / 2, (fh - sh) / 2, sw, sh, -mw / 2, my - mh / 2, mw, mh);
  } else c.drawImage(frame, -mw / 2, my - mh / 2, mw, mh);
  c.restore();

  if (o.caption) {
    c.save();
    c.fillStyle = 'rgba(30,30,34,.85)';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    let size = rimBottom * 0.36;
    c.font = fontString('Permanent Marker', 400, size);
    const maxW = mw * 0.92;
    const w = c.measureText(o.caption).width;
    if (w > maxW) { size *= maxW / w; c.font = fontString('Permanent Marker', 400, size); }
    c.translate(0, oh / 2 - rimBottom / 2);
    c.rotate((hash(o.seed ?? 1, 9) - 0.5) * 0.06);
    c.fillText(o.caption, 0, 0);
    c.restore();
  }

  // Paper texture over everything.
  if (s.texture !== 'none' && s.intensity > 0) {
    c.save();
    tracePath(c, outer);
    c.clip();
    c.globalCompositeOperation = 'overlay';
    c.globalAlpha = s.intensity;
    if (s.texture === 'crumpled') {
      // One sheet, stretched over the whole card (tiling would show seams).
      c.drawImage(overlayTexture('crumpled'), -cw / 2, -ch / 2, cw, ch);
    } else {
      const pat = patternFor(c, s.texture);
      // shift the texture each step so grain "boils" in stop-motion
      const ox = s.stopMotion ? hash(step, 21) * 512 : 0, oy = s.stopMotion ? hash(step, 22) * 512 : 0;
      const scale = s.texture === 'grain' ? Math.max(1, k) : Math.max(0.6, k);
      pat.setTransform?.(new DOMMatrix().translate(ox, oy).scale(scale));
      c.fillStyle = pat;
      c.fillRect(-cw / 2, -ch / 2, cw, ch);
    }
    c.restore();
  }

  // Subtle edge darkening so the paper reads as a separate layer.
  c.lineWidth = Math.max(1, k);
  c.strokeStyle = 'rgba(0,0,0,.12)';
  tracePath(c, outer);
  c.stroke();
  card.ow = ow;
  card.oh = oh;
  return card;
}

function drawBackground(W, H, k, m, frame) {
  ctx.clearRect(0, 0, W, H);
  if (s.bg === 'transparent') {
    // leave it clear: only the paper and its shadow are drawn
  } else if (s.bg === 'blur') {
    const f = fit(m.width, m.height, W, H, 'cover');
    drawBlurred(ctx, frame, f.x - 40, f.y - 40, f.w + 80, f.h + 80, 40 * k);
    ctx.fillStyle = 'rgba(0,0,0,.25)';
    ctx.fillRect(0, 0, W, H);
  } else if (s.bg === 'solid') {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, W, H);
  } else if (s.bg === 'image') {
    if (bgImage) {
      const f = fit(bgImage.naturalWidth, bgImage.naturalHeight, W, H, 'cover');
      ctx.drawImage(bgImage, f.x, f.y, f.w, f.h);
    } else {
      ctx.fillStyle = s.bgColor;
      ctx.fillRect(0, 0, W, H);
    }
  } else {
    ctx.drawImage(backgroundTexture(s.bg, W, H, s.bgColor), 0, 0);
  }
}

function render(t) {
  if (collage(s)) {
    renderCollage(t);
    drawHandles();
    return;
  }
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080;
  const m = src();
  const step = s.stopMotion ? Math.floor(t * s.fps) : 0;
  const frame = currentFrame(step);

  drawBackground(W, H, k, m, frame);

  // Card size: media fitted inside the canvas at `scale`, leaving room for the paper border.
  const box = fit(m.width, m.height, W * (s.scale / 100) - s.rim * 2 * k, H * (s.scale / 100) - s.rim * 2 * k);
  const flat = buildCard(frame, box.w, box.h, k, step);
  const { anim, p } = transitionAt(t);
  const card = anim ? transformCard(flat, anim, p, { persp, paperColor: s.paperColor, seed: s.seed }) : flat;
  if (!card) return; // before the entrance / after the exit: background only

  // Stop-motion jitter
  let dx = 0, dy = 0, rot = s.rotation;
  if (s.stopMotion) {
    dx = (hash(step, 1) - 0.5) * 2 * s.jitter * k;
    dy = (hash(step, 2) - 0.5) * 2 * s.jitter * k;
    rot += (hash(step, 3) - 0.5) * s.jitter * 0.15;
  }

  ctx.save();
  ctx.translate(W / 2 + dx, H / 2 + dy);
  ctx.rotate((rot * Math.PI) / 180);
  if (s.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${s.shadowOpacity})`;
    ctx.shadowBlur = s.shadow * k;
    ctx.shadowOffsetY = s.shadow * 0.35 * k;
    ctx.shadowOffsetX = s.shadow * 0.1 * k;
  }
  ctx.drawImage(card, -card.width / 2, -card.height / 2);
  ctx.restore();
}

/* ---------- Collage ---------- */
function collageTiming() {
  return collageTimeline(collageItems().length, { delay: s.cDelay, dur: s.cAnim === 'none' ? 0.01 : s.cDur, mode: s.cMode, hold: s.cHold, rounds: s.cRounds });
}

function collageOpts(W, H) {
  return {
    W, H, layout: s.layout, size: s.cSize / 100, tilt: s.cTilt / 100, spread: s.cSpread / 100, seed: s.cSeed,
    delay: s.cDelay, dur: s.cAnim === 'none' ? 0.01 : s.cDur, mode: s.cMode, order: s.cOrder, rounds: s.cRounds, anim: s.cAnim,
  };
}

/** Card geometry for an item at a placement: media window, borders and outer size (px). */
function itemGeometry(it, place, k) {
  const m = it.media;
  const polaroid = s.layout === 'polaroid';
  const long = place.long;
  const S = Math.min(canvas.width, canvas.height);
  let mw, mh, rim, rimBottom;
  if (polaroid) {
    mw = mh = long * 0.84;
    rim = long * 0.05;
    rimBottom = long * (s.captions ? 0.2 : 0.14);
  } else {
    const a = m.width / m.height;
    [mw, mh] = a >= 1 ? [long, long / a] : [long * a, long];
    const border = it.border ?? s.rim > 0;
    // the border scales with the item, so small cutouts don't get a thick frame
    rim = border ? Math.max(4 * k, (s.rim || 14) * k * clamp(long / (S * 0.6), 0.35, 1.2)) : 0;
    rimBottom = rim;
  }
  const edge = it.edge !== 'default' ? it.edge : polaroid ? 'straight' : s.edge;
  return { mw, mh, rim, rimBottom, edge, polaroid, ow: mw + rim * 2, oh: mh + rim + rimBottom };
}

const tapeOn = (it) => it.tape ?? s.layout === 'scrapbook';

// Held video frames for choppy stop-motion, per item.
const holdSteps = new Map();
function itemFrame(it, step) {
  const m = it.media;
  if (m.kind !== 'video' || !s.stopMotion || !s.choppy) return m.el;
  const { w, h } = outputSize(m.width, m.height, 960);
  const hold = scratch(`paper-hold-${it.id}`, w, h);
  if (holdSteps.get(it.id) !== step) {
    hold.getContext('2d').drawImage(m.el, 0, 0, w, h);
    holdSteps.set(it.id, step);
  }
  return hold;
}

// Cards of still images are rebuilt only when something about them changes.
const cardCache = new Map(); // canvas name → { key, card }
function itemCard(it, g, k, step) {
  const frame = itemFrame(it, step);
  const caption = g.polaroid && s.captions ? it.caption : '';
  const name = `paper-card-${it.id}`;
  const key = [Math.round(g.mw), Math.round(g.mh), Math.round(g.rim), Math.round(g.rimBottom), g.edge, caption, s.rough, s.seed, s.texture, s.intensity, s.paperColor, s.boil,
    s.stopMotion ? step : -1, fontsVersion].join('|');
  const hit = cardCache.get(name);
  if (it.media.kind !== 'video' && hit?.key === key) return hit.card;
  const card = buildCard(frame, g.mw, g.mh, k, step, {
    name, edge: g.edge, rim: g.rim, rimBottom: g.rimBottom, seed: s.seed + (Math.abs(it.seed) % 997),
    paperColor: g.polaroid ? '#f7f6f1' : undefined, cover: g.polaroid, caption,
  });
  cardCache.set(name, { key, card });
  return card;
}

function renderCollage(t) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080;
  const list = collageItems();
  const step = s.stopMotion ? Math.floor(t * s.fps) : 0;
  const tq = s.stopMotion ? step / s.fps : t; // items move in steps, like the jitter
  const first = list[0];
  drawBackground(W, H, k, first.media, itemFrame(first, step));
  for (const pl of placements(list, tq, collageOpts(W, H))) {
    const it = list[pl.i];
    const g = itemGeometry(it, pl, k);
    const card = itemCard(it, g, k, step);
    const e = entrance(s.cAnim, pl.p, pl, W, H, k, Math.abs(it.seed) + pl.cycle);
    let jx = 0, jy = 0, jr = 0;
    if (s.stopMotion) {
      const n = Math.abs(it.id) * 31 + pl.cycle;
      jx = (hash(step, n, 1) - 0.5) * 2 * s.jitter * k;
      jy = (hash(step, n, 2) - 0.5) * 2 * s.jitter * k;
      jr = (hash(step, n, 3) - 0.5) * s.jitter * 0.25;
    }
    ctx.save();
    ctx.globalAlpha = e.alpha;
    ctx.translate(pl.x + e.dx + jx, pl.y + e.dy + jy);
    ctx.rotate(((pl.rot + e.rot + jr) * Math.PI) / 180);
    ctx.scale(e.scale, e.scale);
    if (s.shadow > 0) {
      const lift = 1 + e.lift * 2;
      ctx.shadowColor = `rgba(0,0,0,${s.shadowOpacity / (1 + e.lift)})`;
      ctx.shadowBlur = s.shadow * k * 0.7 * lift;
      ctx.shadowOffsetY = s.shadow * 0.3 * k * lift;
      ctx.shadowOffsetX = s.shadow * 0.08 * k * lift;
    }
    ctx.drawImage(card, -card.width / 2, -card.height / 2);
    ctx.shadowColor = 'transparent';
    if (tapeOn(it)) {
      if (s.layout === 'scrapbook' && hash(Math.abs(it.seed), 77) < 0.35) drawClip(ctx, g.ow, g.oh, k, Math.abs(it.seed));
      else drawTape(ctx, g.ow, g.oh, k, Math.abs(it.seed) + pl.cycle);
    }
    ctx.restore();
  }
}

/* ---------- Collage videos ---------- */
let gifExporting = false;

function activeVideos(t) {
  const list = collageItems();
  const shown = placements(list, s.stopMotion ? Math.floor(t * s.fps) / s.fps : t, collageOpts(canvas.width, canvas.height));
  const vids = shown.filter((pl) => list[pl.i].media.kind === 'video');
  const active = s.cVideos === 'top' ? vids.slice(-1) : vids;
  return new Map(active.map((pl) => [list[pl.i], pl]));
}

/** Each video starts when its item lands and loops inside its cutout. */
function syncVideos(t) {
  if (!collage(s) || gifExporting) return;
  const active = activeVideos(t);
  for (const it of items) {
    if (it.media.kind !== 'video') continue;
    const v = it.media.el;
    const pl = active.get(it);
    if (!pl) {
      // not on screen yet (or covered in "Only the top one"): a still of its first frame
      if (!v.paused) v.pause();
      if (v.currentTime > 0.05 && !v.seeking) v.currentTime = 0;
      continue;
    }
    const want = Math.max(0, t - pl.rank * s.cDelay) % (it.media.duration || 1);
    if (stage.playing) {
      if (v.paused) v.play().catch(() => {});
      if (Math.abs(v.currentTime - want) > 0.3 && !v.seeking) v.currentTime = want;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.04 && !v.seeking) v.currentTime = want;
    }
  }
}

function pauseCollageVideos() {
  for (const it of items) if (it.media.kind === 'video') it.media.el.pause();
}

/** GIF export: seek every collage video to its exact frame. */
async function seekCollageVideos(t) {
  const active = activeVideos(t);
  await Promise.all(items.filter((it) => it.media.kind === 'video').map((it) => {
    const pl = active.get(it);
    const want = pl ? Math.max(0, t - pl.rank * s.cDelay) % (it.media.duration || 1) : 0;
    return seekVideo(it.media.el, want);
  }));
  holdSteps.clear();
}

/* ---------- Collage items: upload + list ---------- */
const itemList = h('ul', { class: 'pe-items' });
createFilePicker(collageEl, {
  multiple: true,
  accept: 'image/*,video/*,.heic,.heif',
  label: 'Drop photos and videos',
  hint: `up to ${MAX_ITEMS} · the last one lands on top`,
  onFiles: addItems,
});
const listHead = h('div', { class: 'pe-items-head' },
  h('span', { class: 'muted' }, 'Top layer first'),
  h('span', { style: 'flex:1' }),
  h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => clearItems() }, 'Remove all'));
collageEl.append(listHead, itemList);

async function addItems(files) {
  for (const file of files) {
    if (items.length >= MAX_ITEMS) { toast(`A collage holds up to ${MAX_ITEMS} items.`, 'warning'); break; }
    try {
      const m = await loadMedia(file, { accept: ['image', 'video'] });
      if (m.kind === 'video') { m.el.loop = false; m.el.muted = true; }
      items.push({ id: nextItemId++, media: m, edge: 'default', tape: null, border: null, caption: m.name.replace(/\.[^.]+$/, '').slice(0, 24), seed: Math.floor(Math.random() * 1e6), manual: null });
    } catch (err) {
      toast(err.message || 'Could not open that file.', 'error', 6000);
    }
  }
  collageChanged();
}

function clearItems() {
  for (const it of items) disposeItem(it);
  items = [];
  selected = null;
  collageChanged();
}

function disposeItem(it) {
  if (it.media.kind === 'video') it.media.el.pause();
  it.media.dispose?.();
  cardCache.delete(`paper-card-${it.id}`);
}

/** Items or their order changed: refresh the list, the timing and the preview. */
function collageChanged() {
  renderItemList();
  panel.refresh();
  updateOverlay();
  stage.reset();
  exportBar.refresh();
  stage.play().catch(() => {});
}

function rerollAll() {
  for (const it of items) { it.seed = Math.floor(Math.random() * 1e6); it.manual = null; }
  panel.set({ cSeed: 1 + Math.floor(Math.random() * 99) });
}

function moveItem(it, dir) {
  const i = items.indexOf(it), j = i + dir;
  if (j < 0 || j >= items.length) return;
  [items[i], items[j]] = [items[j], items[i]];
  renderItemList();
  stage.invalidate();
}

function thumbOf(it) {
  const c = h('canvas', { width: 80, height: 80, class: 'pe-thumb' });
  const g = c.getContext('2d');
  const m = it.media;
  const f = fit(m.width, m.height, 80, 80, 'cover');
  const draw = () => { try { g.drawImage(m.el, f.x, f.y, f.w, f.h); } catch {} };
  draw();
  if (m.kind === 'video' && m.el.readyState < 2) m.el.addEventListener('loadeddata', draw, { once: true });
  return c;
}

function renderItemList() {
  listHead.hidden = !items.length;
  const polaroid = s.layout === 'polaroid' && s.captions;
  itemList.replaceChildren(...[...items].reverse().map((it) => {
    const set = (patch) => { Object.assign(it, patch); renderItemList(); stage.invalidate(); };
    const toggle = (label, on, flip, title) => h('button', {
      type: 'button', class: 'chip pe-chip', 'aria-pressed': String(on), title, onclick: (e) => { e.stopPropagation(); flip(); },
    }, label);
    const edge = h('select', { class: 'pe-edge', 'aria-label': 'Edge style', onclick: (e) => e.stopPropagation() },
      [['default', 'Edge: default'], ['torn', 'Torn'], ['cutout', 'Cut'], ['rounded', 'Rounded'], ['straight', 'Straight']].map(([v, l]) => h('option', { value: v }, l)));
    edge.value = it.edge;
    edge.addEventListener('change', () => set({ edge: edge.value }));
    const caption = polaroid ? h('input', { type: 'text', class: 'pe-caption', value: it.caption, placeholder: 'Caption', 'aria-label': 'Caption', onclick: (e) => e.stopPropagation() }) : null;
    caption?.addEventListener('input', () => { it.caption = caption.value; stage.invalidate(); });
    const mini = (name, title, fn) => h('button', { type: 'button', class: 'pe-mini', title, 'aria-label': title, html: icon(name), onclick: (e) => { e.stopPropagation(); fn(); } });
    return h('li', { class: `pe-item${it === selected ? ' is-selected' : ''}`, onclick: () => select(it) },
      thumbOf(it),
      h('div', { class: 'pe-item-main' },
        h('div', { class: 'pe-item-row' },
          h('span', { class: 'pe-item-name', title: it.media.name }, `${it.media.kind === 'video' ? '▶ ' : ''}${it.media.name}`)),
        h('div', { class: 'pe-item-row' },
          edge,
          toggle('Tape', tapeOn(it), () => set({ tape: !tapeOn(it) }), 'Tape on / off'),
          toggle('Border', it.border ?? s.rim > 0, () => set({ border: !(it.border ?? s.rim > 0) }), 'Paper border on / off')),
        caption),
      h('div', { class: 'pe-item-tools' },
        mini('up', 'Bring forward', () => moveItem(it, 1)),
        mini('down', 'Send back', () => moveItem(it, -1)),
        mini('shuffle', 'Re-randomize this item', () => set({ seed: Math.floor(Math.random() * 1e6), manual: null })),
        mini('x', 'Remove', () => {
          items.splice(items.indexOf(it), 1);
          disposeItem(it);
          if (selected === it) selected = null;
          collageChanged();
        })));
  }));
}

function select(it) {
  selected = it;
  renderItemList();
  stage.pause();
  // show the finished collage so every item can be grabbed
  if (s.cMode === 'hold' && stage.time < collageTiming().build) stage.seek(collageTiming().build);
  stage.invalidate();
}

/* ---------- Collage: drag, rotate and resize on the preview ---------- */
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
};
const pxScale = () => canvas.width / (canvas.getBoundingClientRect().width || canvas.width);

/** Settled box of every real item (cycle 0): centre, outer size, rotation (radians). */
function itemBoxes() {
  const W = canvas.width, H = canvas.height, k = Math.min(W, H) / 1080;
  const lay = layoutItems(items, collageOpts(W, H));
  return items.map((it, i) => {
    const g = itemGeometry(it, lay[i], k);
    return { it, cx: lay[i].x, cy: lay[i].y, w: g.ow, h: g.oh, rot: (lay[i].rot * Math.PI) / 180, place: lay[i] };
  });
}
const toLocal = (b, p) => {
  const dx = p.x - b.cx, dy = p.y - b.cy, c = Math.cos(-b.rot), sn = Math.sin(-b.rot);
  return { x: dx * c - dy * sn, y: dx * sn + dy * c };
};
const knobOf = (b, q) => ({ x: 0, y: -b.h / 2 - 28 * q });

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!collage(s) || !items.length) return;
  if (s.cMode === 'loop') return toast('Switch Build to “Build up, then hold” to arrange items by hand.', 'info', 3500);
  const p = toCanvas(e), q = pxScale();
  const boxes = itemBoxes();
  let mode = null, b = null;
  const sel = boxes.find((x) => x.it === selected);
  if (sel) {
    const l = toLocal(sel, p), kn = knobOf(sel, q);
    if (Math.hypot(l.x - kn.x, l.y - kn.y) < 14 * q) { mode = 'rotate'; b = sel; }
    else if ([[-1, -1], [1, -1], [1, 1], [-1, 1]].some(([sx, sy]) => Math.abs(l.x - (sx * sel.w) / 2) < 12 * q && Math.abs(l.y - (sy * sel.h) / 2) < 12 * q)) { mode = 'scale'; b = sel; }
  }
  if (!mode) {
    b = [...boxes].reverse().find((x) => { const l = toLocal(x, p); return Math.abs(l.x) <= x.w / 2 && Math.abs(l.y) <= x.h / 2; });
    if (b) mode = 'move';
  }
  if (!b) { selected = null; renderItemList(); drawHandles(); return; }
  if (selected !== b.it) select(b.it);
  else { stage.pause(); if (stage.time < collageTiming().build) stage.seek(collageTiming().build); }
  const W = canvas.width, H = canvas.height;
  const it = b.it;
  const base = b.place.long / (it.manual?.scale || 1);
  it.manual = { x: b.cx / W, y: b.cy / H, rot: b.place.rot, scale: it.manual?.scale || 1 };
  drag = { mode, it, p0: p, m0: { ...it.manual }, cx: b.cx, cy: b.cy, base,
    a0: Math.atan2(p.y - b.cy, p.x - b.cx), d0: Math.hypot(p.x - b.cx, p.y - b.cy) || 1 };
  canvas.setPointerCapture(e.pointerId);
  canvas.classList.add('pe-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = toCanvas(e), W = canvas.width, H = canvas.height;
  const m = drag.it.manual;
  if (drag.mode === 'move') {
    m.x = drag.m0.x + (p.x - drag.p0.x) / W;
    m.y = drag.m0.y + (p.y - drag.p0.y) / H;
  } else if (drag.mode === 'rotate') {
    let rot = drag.m0.rot + ((Math.atan2(p.y - drag.cy, p.x - drag.cx) - drag.a0) * 180) / Math.PI;
    if (e.shiftKey) rot = Math.round(rot / 15) * 15;
    m.rot = rot;
  } else {
    m.scale = clamp(drag.m0.scale * (Math.hypot(p.x - drag.cx, p.y - drag.cy) / drag.d0), 0.2, 4);
  }
  stage.invalidate();
});
const endDrag = () => {
  if (!drag) return;
  drag = null;
  canvas.classList.remove('pe-dragging');
  stage.invalidate();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
window.addEventListener('keydown', (e) => {
  if (!collage(s) || !selected || e.target.closest('input, textarea, select')) return;
  if (e.key === 'Delete' || e.key === 'Backspace') {
    const it = selected;
    items.splice(items.indexOf(it), 1);
    disposeItem(it);
    selected = null;
    collageChanged();
  } else if (e.key === ']') moveItem(selected, 1);
  else if (e.key === '[') moveItem(selected, -1);
  else if (e.key === 'Escape') { selected = null; renderItemList(); drawHandles(); }
});

/** Selection box with corner (resize) and round (rotate) handles; a separate canvas, never exported. */
let exporting = false;
function drawHandles() {
  const W = canvas.width, H = canvas.height;
  if (handles.width !== W || handles.height !== H) { handles.width = W; handles.height = H; }
  hctx.clearRect(0, 0, W, H);
  if (!collage(s) || !selected || exporting || !items.includes(selected) || s.cMode === 'loop') return;
  const b = itemBoxes().find((x) => x.it === selected);
  const q = pxScale(), pad = 4 * q;
  const hw = b.w / 2 + pad, hh = b.h / 2 + pad, kn = knobOf(b, q);
  hctx.save();
  hctx.translate(b.cx, b.cy);
  hctx.rotate(b.rot);
  hctx.lineWidth = 1.5 * q;
  hctx.strokeStyle = 'rgba(0,0,0,.35)';
  hctx.strokeRect(-hw - q, -hh - q, hw * 2 + 2 * q, hh * 2 + 2 * q);
  hctx.strokeStyle = '#7c6cff';
  hctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
  hctx.beginPath(); hctx.moveTo(0, -hh); hctx.lineTo(kn.x, kn.y); hctx.stroke();
  hctx.fillStyle = '#ffffff';
  for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    hctx.fillRect(sx * hw - 5 * q, sy * hh - 5 * q, 10 * q, 10 * q);
    hctx.strokeRect(sx * hw - 5 * q, sy * hh - 5 * q, 10 * q, 10 * q);
  }
  hctx.beginPath(); hctx.arc(kn.x, kn.y, 6 * q, 0, Math.PI * 2); hctx.fill(); hctx.stroke();
  hctx.restore();
}

/** Keep the handles canvas exactly on top of the (CSS-scaled) preview canvas. */
function placeHandles() {
  Object.assign(handles.style, {
    left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`,
    width: `${canvas.offsetWidth}px`, height: `${canvas.offsetHeight}px`,
  });
  drawHandles();
}
new ResizeObserver(placeHandles).observe(canvas);
window.addEventListener('resize', placeHandles);

// Captions use a handwriting font; redraw once it has loaded.
let fontsVersion = 0;
ensureFont('Permanent Marker', 400, () => { fontsVersion++; stage.invalidate(); });

/* ---------- Stage + export ---------- */
const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: clipLength,
  getVideo: () => (!collage(s) && isVideo() ? media.el : null),
});
stage.events.addEventListener('tick', (e) => syncVideos(e.detail.t));

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => (collage(s) ? 'paper-collage' : `paper-${(media?.name || 'demo').replace(/\.[^.]+$/, '')}`),
  getVideo: () => (!collage(s) && isVideo() ? media.el : null),
  beforeExport: (kind) => {
    exporting = true;
    drawHandles();
    if (collage(s) && kind === 'gif') { gifExporting = true; pauseCollageVideos(); }
  },
  afterExport: () => { exporting = false; gifExporting = false; drawHandles(); },
  prepareFrame: (t) => (collage(s) ? seekCollageVideos(t) : undefined),
  hint: () => [
    !collage(s) && !isVideo() && !s.stopMotion && !isAnimated() ? 'Video and GIF of a still image hold one frame; add an entrance/exit or handmade jitter to animate it.' : '',
    s.bg === 'transparent' ? TRANSPARENT_HINT : '',
  ].filter(Boolean).join(' '),
});
overlay.classList.add('is-note');
updateOverlay();

syncTimeRanges();
resize();
renderItemList();
