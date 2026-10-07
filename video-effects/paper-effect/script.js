/* Paper Effect — torn/cut paper edges, paper textures and stop-motion jitter. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, TRANSPARENT_HINT } from '/assets/js/lib/exporter.js';
import { fit, outputSize, scratch, drawBlurred } from '/assets/js/lib/canvas.js';
import { hash } from '/assets/js/lib/random.js';
import { ease, clamp, easingOptions } from '/assets/js/lib/easing.js';
import { createPerspective } from '/assets/js/lib/perspective.js';
import { overlayTexture, backgroundTexture, edgePath, tracePath } from './textures.js';
import { ENTRANCES, EXITS, transformCard } from './transitions.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const persp = createPerspective(); // WebGL for fold/crumple; falls back to flat 2D if unavailable
let media = null;

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

const panel = createControls(document.getElementById('controls'), [
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
    { id: 'scale', type: 'range', label: 'Size', min: 30, max: 100, value: 78, unit: '%' },
    { id: 'rotation', type: 'range', label: 'Rotation', min: -15, max: 15, step: 0.5, value: -3, unit: '°', decimals: 1 },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 80, value: 30, unit: 'px' },
    { id: 'shadowOpacity', type: 'range', label: 'Shadow strength', min: 0, max: 1, step: 0.01, value: 0.45, format: (v) => `${Math.round(v * 100)}%`, showIf: (s) => s.shadow > 0 },
  ]},
  { title: 'Entrance', controls: [
    { id: 'enter', type: 'select', label: 'Animation', value: 'none', options: ENTRANCES },
    { id: 'enterEasing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions, showIf: (s) => s.enter !== 'none' },
    { id: 'enterDuration', type: 'range', label: 'Duration', min: 0.2, max: 4, step: 0.1, value: 1, unit: 's', decimals: 1, showIf: (s) => s.enter !== 'none' },
    { id: 'enterStart', type: 'range', label: 'Start at', min: 0, max: 10, step: 0.1, value: 0, unit: 's', decimals: 1, showIf: (s) => s.enter !== 'none' },
  ]},
  { title: 'Exit', controls: [
    { id: 'exit', type: 'select', label: 'Animation', value: 'stay', options: EXITS },
    { id: 'exitEasing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions, showIf: (s) => s.exit !== 'stay' },
    { id: 'exitDuration', type: 'range', label: 'Duration', min: 0.2, max: 4, step: 0.1, value: 1, unit: 's', decimals: 1, showIf: (s) => s.exit !== 'stay' },
    { id: 'exitEnd', type: 'range', label: 'End at', min: 0.1, max: 10, step: 0.01, value: 4, unit: 's', decimals: 1, showIf: (s) => s.exit !== 'stay',
      hint: 'When the paper is fully gone. Defaults to the end of the clip.' },
  ]},
  { title: 'Background', controls: [
    { id: 'bg', type: 'select', label: 'Surface', value: 'kraft', options: [['transparent', 'None (transparent)'], ['solid', 'Solid color'], ['kraft', 'Kraft paper'], ['cardboard', 'Cardboard'], ['grid', 'Grid paper'], ['cork', 'Cork board'], ['blur', 'Blurred media']] },
    { id: 'bgColor', type: 'color', label: 'Color', value: '#c49a6c', showIf: (s) => s.bg !== 'blur' && s.bg !== 'transparent' },
    { id: 'aspect', type: 'segmented', label: 'Aspect ratio', value: 'media', options: [['media', 'Media'], ['16:9', '16:9'], ['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5']] },
  ]},
  { title: 'Stop-motion', controls: [
    { id: 'stopMotion', type: 'toggle', label: 'Handmade jitter', value: false, hint: 'Nudges the paper a little on every step, like stop-motion.' },
    { id: 'fps', type: 'range', label: 'Steps per second', min: 2, max: 15, value: 8, showIf: (s) => s.stopMotion },
    { id: 'jitter', type: 'range', label: 'Jitter amount', min: 0, max: 20, value: 6, unit: 'px', showIf: (s) => s.stopMotion },
    { id: 'boil', type: 'toggle', label: 'Boiling edges', value: true, hint: 'Redraw the tear on every step.', showIf: (s) => s.stopMotion },
    { id: 'choppy', type: 'toggle', label: 'Choppy video frames', value: true, hint: 'Hold each video frame for a whole step.', showIf: (s) => s.stopMotion && media?.kind === 'video' },
    { id: 'clip', type: 'range', label: 'Clip length (images)', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1, showIf: () => media?.kind !== 'video' },
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
  if (id === 'exitEnd') endFollowsClip = s.exitEnd >= clipLength() - 0.01;
  if (id === 'clip') syncTimeRanges();
  resize();
  exportBar.refresh();
  stage.invalidate();
} });

const s = panel.state;

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

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
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
  overlay.hidden = !!media;
  if (media?.kind === 'video') stage.play().catch(() => {});
}

/* ---------- Timing ---------- */
const isVideo = () => media?.kind === 'video';
const clipLength = () => (isVideo() ? media.duration : s.clip);
const isAnimated = () => s.enter !== 'none' || s.exit !== 'stay';

// "End at" tracks the end of the clip until the user moves it somewhere else.
let endFollowsClip = true;
function syncTimeRanges() {
  const len = clipLength();
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
  if (!a) ({ w, h } = outputSize(m.width, m.height, 1920));
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

function buildCard(frame, mw, mh, k, step) {
  const rim = s.rim * k;
  const rough = s.edge === 'straight' ? 0 : s.rough * k;
  const pad = rough * 1.6 + 4;
  const ow = mw + rim * 2, oh = mh + rim * 2;
  const cw = Math.ceil(ow + pad * 2), ch = Math.ceil(oh + pad * 2);
  const card = scratch('paper-card', cw, ch);
  const c = card.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cw, ch);
  c.translate(cw / 2, ch / 2);

  const seed = s.seed + (s.stopMotion && s.boil ? (step % 4) * 13 : 0);
  const outer = edgePath(ow, oh, s.edge, rough, seed);

  // Paper backing.
  tracePath(c, outer);
  c.fillStyle = s.paperColor;
  c.fill();

  // Media, clipped by the paper and (when torn) by its own rougher tear.
  c.save();
  tracePath(c, outer);
  c.clip();
  if (s.edge === 'torn' && rim > 0) { tracePath(c, edgePath(mw, mh, 'torn', rough * 0.45, seed + 101)); c.clip(); }
  c.drawImage(frame, -mw / 2, -mh / 2, mw, mh);
  c.restore();

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
  return card;
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080;
  const m = src();
  const step = s.stopMotion ? Math.floor(t * s.fps) : 0;
  const frame = currentFrame(step);

  // Background
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
  } else {
    ctx.drawImage(backgroundTexture(s.bg, W, H, s.bgColor), 0, 0);
  }

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

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: clipLength,
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `paper-${(media?.name || 'demo').replace(/\.[^.]+$/, '')}`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => isVideo() || s.stopMotion || isAnimated(),
  hint: () => [
    !isVideo() && !s.stopMotion && !isAnimated() ? 'Add an entrance/exit or turn on stop-motion to export an animated clip of an image.' : '',
    s.bg === 'transparent' ? TRANSPARENT_HINT : '',
  ].filter(Boolean).join(' '),
});
overlay.hidden = false;
overlay.classList.add('is-note');
overlay.innerHTML = '<div><strong>Showing a demo image.</strong> Drop an image or video on the left to use your own.</div>';

syncTimeRanges();
resize();
