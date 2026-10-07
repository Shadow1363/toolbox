/* Screen Showcase — put screen recordings/screenshots on a styled stage with frames and motion. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, TRANSPARENT_HINT } from '/assets/js/lib/exporter.js';
import { fit, roundRectPath, linearGradient, scratch, drawBlurred } from '/assets/js/lib/canvas.js';
import { ease, clamp } from '/assets/js/lib/easing.js';
import { createPerspective, projectPoint } from '/assets/js/lib/perspective.js';
import { fontString } from '/assets/js/lib/fonts.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const persp = createPerspective();
let media = null;

const SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };

const GRADIENTS = [
  { label: 'Aurora', value: 'aurora', colors: ['#ff7eb3', '#7c6cff', '#22d3ee'] },
  { label: 'Sunset', value: 'sunset', colors: ['#ff9a5a', '#ff5e7e', '#a43cf0'] },
  { label: 'Ocean', value: 'ocean', colors: ['#1fa2ff', '#12d8fa', '#a6ffcb'] },
  { label: 'Midnight', value: 'midnight', colors: ['#0f0c29', '#302b63', '#24243e'] },
  { label: 'Peach', value: 'peach', colors: ['#ffecd2', '#fcb69f'] },
  { label: 'Forest', value: 'forest', colors: ['#134e5e', '#71b280'] },
  { label: 'Mono', value: 'mono', colors: ['#e9ecf2', '#c3c9d6'] },
];

/* ---------- Controls ---------- */
const panel = createControls(document.getElementById('controls'), [
  { title: 'Canvas', controls: [
    { id: 'size', type: 'segmented', label: 'Aspect ratio', value: '16:9', options: Object.keys(SIZES).map((k) => [k, k]) },
    { id: 'clip', type: 'range', label: 'Clip length (images)', min: 2, max: 30, step: 0.5, value: 6, unit: 's', decimals: 1, showIf: () => !isVideo() },
  ]},
  { title: 'Background', controls: [
    { id: 'bg', type: 'segmented', label: 'Type', value: 'gradient', options: [['transparent', 'None'], ['solid', 'Solid'], ['gradient', 'Gradient'], ['blur', 'Blurred']] },
    { id: 'bgColor', type: 'color', label: 'Color', value: '#111318', showIf: (s) => s.bg === 'solid' },
    { id: 'gradient', type: 'swatches', label: 'Gradient', value: 'aurora', showIf: (s) => s.bg === 'gradient',
      options: GRADIENTS.map((g) => ({ label: g.label, value: g.value, preview: `linear-gradient(135deg,${g.colors.join(',')})` })) },
    { id: 'gAngle', type: 'range', label: 'Angle', min: 0, max: 360, value: 135, unit: '°', showIf: (s) => s.bg === 'gradient' },
    { id: 'blurAmount', type: 'range', label: 'Blur', min: 10, max: 120, value: 60, unit: 'px', showIf: (s) => s.bg === 'blur' },
  ]},
  { title: 'Frame', controls: [
    { id: 'frame', type: 'select', label: 'Frame', value: 'browser-light', options: [['none', 'None'], ['browser-light', 'Browser (light)'], ['browser-dark', 'Browser (dark)'], ['phone', 'Phone']] },
    { id: 'url', type: 'text', label: 'Address bar', value: 'yourproduct.com', showIf: (s) => s.frame.startsWith('browser') },
    { id: 'padding', type: 'range', label: 'Padding', min: 0, max: 30, value: 10, unit: '%' },
    { id: 'radius', type: 'range', label: 'Corner radius', min: 0, max: 60, value: 14, unit: 'px' },
    { id: 'border', type: 'range', label: 'Border', min: 0, max: 20, value: 0, unit: 'px' },
    { id: 'borderColor', type: 'color', label: 'Border color', value: '#ffffff', showIf: (s) => s.border > 0 },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 150, value: 60, unit: 'px' },
    { id: 'shadowOpacity', type: 'range', label: 'Shadow strength', min: 0, max: 1, step: 0.01, value: 0.4, format: (v) => `${Math.round(v * 100)}%`, showIf: (s) => s.shadow > 0 },
  ]},
  { title: 'Motion', controls: [
    { id: 'motionPreset', type: 'presets', label: 'Presets', value: 'hero', options: [
      { label: 'Hero', value: 'hero', patch: { zoomIn: true, fadeIn: 0.5, fadeOut: 0.5, pan: 'zoom', panAmount: 6, tilt: 'tilt-in', rx: 18, ry: -14 } },
      { label: 'Subtle', value: 'subtle', patch: { zoomIn: true, fadeIn: 0.4, fadeOut: 0.4, pan: 'zoom', panAmount: 3, tilt: 'none' } },
      { label: '3D float', value: 'float', patch: { zoomIn: false, fadeIn: 0.4, fadeOut: 0.4, pan: 'none', tilt: 'float', rx: 10, ry: -16 } },
      { label: 'Static', value: 'static', patch: { zoomIn: false, fadeIn: 0, fadeOut: 0, pan: 'none', tilt: 'none' } },
    ]},
    { id: 'zoomIn', type: 'toggle', label: 'Zoom in at start', value: true },
    { id: 'zoomFrom', type: 'range', label: 'Start scale', min: 0.5, max: 0.98, step: 0.01, value: 0.82, decimals: 2, showIf: (s) => s.zoomIn },
    { id: 'intro', type: 'range', label: 'Intro duration', min: 0.2, max: 4, step: 0.1, value: 1.4, unit: 's', decimals: 1 },
    { id: 'fadeIn', type: 'range', label: 'Fade in', min: 0, max: 3, step: 0.1, value: 0.5, unit: 's', decimals: 1 },
    { id: 'fadeOut', type: 'range', label: 'Fade out', min: 0, max: 3, step: 0.1, value: 0.5, unit: 's', decimals: 1 },
    { id: 'pan', type: 'select', label: 'Slow pan', value: 'zoom', options: [['none', 'None'], ['zoom', 'Slow zoom in'], ['left', 'Drift left'], ['right', 'Drift right'], ['up', 'Drift up']] },
    { id: 'panAmount', type: 'range', label: 'Pan amount', min: 1, max: 20, value: 6, unit: '%', showIf: (s) => s.pan !== 'none' },
    { id: 'tilt', type: 'select', label: '3D tilt', value: 'tilt-in', options: [['none', 'None'], ['static', 'Static tilt'], ['tilt-in', 'Tilt in (flatten)'], ['float', 'Float']] },
    { id: 'rx', type: 'range', label: 'Tilt X', min: -40, max: 40, value: 18, unit: '°', showIf: (s) => s.tilt !== 'none' },
    { id: 'ry', type: 'range', label: 'Tilt Y', min: -40, max: 40, value: -14, unit: '°', showIf: (s) => s.tilt !== 'none' },
  ]},
], { onChange: () => { resize(); exportBar.refresh(); stage.invalidate(); } });

const s = panel.state;
function isVideo() { return media?.kind === 'video'; }

/* ---------- Demo screenshot ---------- */
function demoShot() {
  const W = 1600, H = 1000;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#f7f8fb'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, 260, H);
  g.fillStyle = '#eceef3'; g.fillRect(260, 0, 1, H);
  g.fillStyle = '#7c6cff'; g.beginPath(); roundRectPath(g, 32, 34, 36, 36, 9); g.fill();
  g.fillStyle = '#141821'; g.font = fontString('Inter', 700, 22); g.fillText('Acme', 82, 60);
  ['Dashboard', 'Projects', 'Reports', 'Team', 'Settings'].forEach((t, i) => {
    if (i === 0) { g.fillStyle = '#efedff'; g.beginPath(); roundRectPath(g, 20, 108, 220, 44, 10); g.fill(); }
    g.fillStyle = i === 0 ? '#5b4cf0' : '#5b6477'; g.font = fontString('Inter', 600, 17); g.fillText(t, 44, 136 + i * 56);
  });
  g.fillStyle = '#141821'; g.font = fontString('Inter', 800, 34); g.fillText('Good morning, Sam', 310, 86);
  g.fillStyle = '#8a93a6'; g.font = fontString('Inter', 400, 18); g.fillText('Here is what happened this week.', 310, 120);
  const stats = [['Revenue', '$48.2k', '#22c55e'], ['Active users', '12,480', '#7c6cff'], ['Conversion', '4.6%', '#f59e0b']];
  stats.forEach(([label, val, col], i) => {
    const x = 310 + i * 410;
    g.fillStyle = '#fff'; g.beginPath(); roundRectPath(g, x, 160, 380, 150, 16); g.fill();
    g.fillStyle = '#8a93a6'; g.font = fontString('Inter', 500, 17); g.fillText(label, x + 28, 204);
    g.fillStyle = '#141821'; g.font = fontString('Inter', 800, 42); g.fillText(val, x + 28, 262);
    g.fillStyle = col; g.beginPath(); roundRectPath(g, x + 290, 190, 64, 26, 13); g.fill();
  });
  g.fillStyle = '#fff'; g.beginPath(); roundRectPath(g, 310, 340, 1230, 600, 16); g.fill();
  g.fillStyle = '#141821'; g.font = fontString('Inter', 700, 22); g.fillText('Weekly activity', 342, 390);
  const bars = [0.45, 0.62, 0.38, 0.8, 0.66, 0.92, 0.7, 0.55, 0.84, 0.6, 0.74, 0.98];
  bars.forEach((b, i) => {
    const bh = b * 420, x = 350 + i * 98;
    const gr = g.createLinearGradient(0, 900 - bh, 0, 900);
    gr.addColorStop(0, '#7c6cff'); gr.addColorStop(1, '#22d3ee');
    g.fillStyle = gr; g.beginPath(); roundRectPath(g, x, 900 - bh, 56, bh, [10, 10, 0, 0]); g.fill();
  });
  return { kind: 'image', el: c, width: W, height: H, duration: 0 };
}
const demo = demoShot();
const src = () => media || demo;

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a screen recording or screenshot',
  onLoad: (m) => { media = m; onMediaChange(); },
  onClear: () => { media = null; onMediaChange(); },
});

function onMediaChange() {
  panel.refresh();
  stage.reset();
  exportBar.refresh();
  overlay.hidden = !!media;
  stage.play().catch(() => {});
}

/* ---------- Layout & card ---------- */
function resize() {
  const [w, h] = SIZES[s.size];
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.classList.toggle('checker', s.bg === 'transparent');
}

/** Frame chrome (in px) around the media for a given card width. */
function chrome(frame, k) {
  if (frame.startsWith('browser')) return { top: Math.round(46 * k), side: 0, bottom: 0 };
  if (frame === 'phone') return { top: Math.round(16 * k), side: Math.round(16 * k), bottom: Math.round(16 * k) };
  return { top: 0, side: 0, bottom: 0 };
}

/** Render media + frame into an offscreen canvas at final pixel size. */
function buildCard(m, mw, mh, k) {
  const ch = chrome(s.frame, k);
  const W = Math.round(mw + ch.side * 2), H = Math.round(mh + ch.top + ch.bottom);
  const card = scratch('showcase-card', W, H);
  const c = card.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  const r = s.frame === 'phone' ? Math.max(s.radius, 40) * k : s.radius * k;

  c.save();
  c.beginPath(); roundRectPath(c, 0, 0, W, H, r); c.clip();

  if (s.frame.startsWith('browser')) {
    const dark = s.frame === 'browser-dark';
    c.fillStyle = dark ? '#1f2229' : '#eef0f4';
    c.fillRect(0, 0, W, ch.top);
    const dot = 6 * k, cy = ch.top / 2;
    ['#ff5f57', '#febc2e', '#28c840'].forEach((col, i) => {
      c.fillStyle = col; c.beginPath(); c.arc(20 * k + i * 20 * k, cy, dot, 0, Math.PI * 2); c.fill();
    });
    const urlW = Math.min(W * 0.5, 520 * k), urlH = 26 * k;
    c.fillStyle = dark ? '#2c3039' : '#ffffff';
    c.beginPath(); roundRectPath(c, (W - urlW) / 2, cy - urlH / 2, urlW, urlH, urlH / 2); c.fill();
    c.fillStyle = dark ? '#a6adbb' : '#5b6477';
    c.font = fontString('Inter', 500, 13 * k);
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(s.url, W / 2, cy + 0.5);
    c.drawImage(m.el, 0, ch.top, mw, mh);
  } else if (s.frame === 'phone') {
    c.fillStyle = '#0b0c10';
    c.fillRect(0, 0, W, H);
    const ir = Math.max(0, r - ch.side);
    c.save();
    c.beginPath(); roundRectPath(c, ch.side, ch.top, mw, mh, ir); c.clip();
    c.drawImage(m.el, ch.side, ch.top, mw, mh);
    c.restore();
    // camera island (portrait screens only)
    if (mh > mw) {
      const iw = Math.min(mw * 0.3, 120 * k), ih = iw * 0.3;
      c.fillStyle = '#0b0c10';
      c.beginPath(); roundRectPath(c, (W - iw) / 2, ch.top + 12 * k, iw, ih, ih / 2); c.fill();
    }
  } else {
    c.drawImage(m.el, 0, 0, mw, mh);
  }
  c.restore();

  if (s.border > 0) {
    const bw = s.border * k;
    c.lineWidth = bw;
    c.strokeStyle = s.borderColor;
    c.beginPath(); roundRectPath(c, bw / 2, bw / 2, W - bw, H - bw, Math.max(0, r - bw / 2)); c.stroke();
  }
  return { card, r };
}

/* ---------- Motion ---------- */
function motion(t) {
  const D = duration();
  const intro = clamp(t / s.intro);
  const e = ease('easeOutQuint', intro);
  let scale = s.zoomIn ? s.zoomFrom + (1 - s.zoomFrom) * e : 1;
  let x = 0, y = 0;
  const p = clamp(t / D);
  const amt = s.panAmount / 100;
  if (s.pan === 'zoom') scale *= 1 + amt * ease('easeInOut', p);
  if (s.pan === 'left') x = (0.5 - ease('easeInOut', p)) * amt * 2;
  if (s.pan === 'right') x = (ease('easeInOut', p) - 0.5) * amt * 2;
  if (s.pan === 'up') y = (0.5 - ease('easeInOut', p)) * amt * 2;

  let rx = 0, ry = 0;
  if (s.tilt === 'static') { rx = s.rx; ry = s.ry; }
  if (s.tilt === 'tilt-in') { rx = s.rx * (1 - e); ry = s.ry * (1 - e); }
  if (s.tilt === 'float') { rx = s.rx * (0.6 + 0.4 * Math.sin(t * 0.9)); ry = s.ry * Math.cos(t * 0.7); }

  let alpha = 1;
  if (s.fadeIn > 0) alpha *= clamp(t / s.fadeIn);
  if (s.fadeOut > 0) alpha *= clamp((D - t) / s.fadeOut);
  return { scale, x, y, rx, ry, alpha };
}

/* ---------- Rendering ---------- */
function drawBackground(m, W, H, k) {
  if (s.bg === 'transparent') return;
  if (s.bg === 'solid') { ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, W, H); return; }
  if (s.bg === 'gradient') {
    const g = GRADIENTS.find((x) => x.value === s.gradient) || GRADIENTS[0];
    ctx.fillStyle = linearGradient(ctx, W, H, s.gAngle, g.colors);
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const f = fit(m.width, m.height, W, H, 'cover');
  const pad = s.blurAmount * k * 2;
  drawBlurred(ctx, m.el, f.x - pad, f.y - pad, f.w + pad * 2, f.h + pad * 2, s.blurAmount * k);
  ctx.fillStyle = 'rgba(0,0,0,.18)';
  ctx.fillRect(0, 0, W, H);
}

/** Outline of the card (rounded corners), projected, as a polygon for the shadow. */
function shadowPolygon(w, h, r, tf) {
  const pts = [];
  const corners = [[w / 2 - r, -h / 2 + r, -Math.PI / 2], [w / 2 - r, h / 2 - r, 0], [-w / 2 + r, h / 2 - r, Math.PI / 2], [-w / 2 + r, -h / 2 + r, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(projectPoint(cx + Math.cos(a) * r, cy + Math.sin(a) * r, tf));
    }
  }
  return pts;
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080;
  const m = src();
  ctx.clearRect(0, 0, W, H);
  drawBackground(m, W, H, k);

  // Fit the media (plus frame chrome) inside the padded area.
  const pad = (Math.min(W, H) * s.padding) / 100;
  const ch = chrome(s.frame, k);
  const box = fit(m.width, m.height, W - pad * 2 - ch.side * 2, H - pad * 2 - ch.top - ch.bottom);
  const { card, r } = buildCard(m, box.w, box.h, k);

  const mo = motion(t);
  if (mo.alpha <= 0) return;
  const tf = { rx: mo.rx, ry: mo.ry, scale: mo.scale, x: W / 2 + mo.x * W, y: H / 2 + mo.y * H, focal: Math.max(W, H) * 1.6 };
  const tilted = (mo.rx || mo.ry) && persp;

  // Shadow
  if (s.shadow > 0) {
    const poly = shadowPolygon(card.width, card.height, r, tf);
    const OFF = 100000;
    ctx.save();
    ctx.shadowColor = `rgba(0,0,0,${s.shadowOpacity * mo.alpha})`;
    ctx.shadowBlur = s.shadow * k;
    ctx.shadowOffsetX = OFF;
    ctx.shadowOffsetY = s.shadow * 0.4 * k;
    ctx.translate(-OFF, 0);
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = '#000';
    ctx.fill();
    ctx.restore();
  }

  // Card
  if (tilted) {
    const quad = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => projectPoint((sx * card.width) / 2, (sy * card.height) / 2, tf));
    ctx.drawImage(persp.draw(card, quad, W, H, mo.alpha), 0, 0);
  } else {
    ctx.save();
    ctx.globalAlpha = mo.alpha;
    ctx.translate(tf.x, tf.y);
    ctx.scale(mo.scale, mo.scale);
    ctx.drawImage(card, -card.width / 2, -card.height / 2);
    ctx.restore();
  }
}

const duration = () => (isVideo() ? media.duration : s.clip);

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: duration,
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `showcase-${(media?.name || 'demo').replace(/\.[^.]+$/, '')}-${s.size.replace(':', 'x')}`,
  getVideo: () => (isVideo() ? media.el : null),
  hint: () => [
    persp ? '' : 'WebGL is unavailable, so 3D tilt is disabled.',
    s.bg === 'transparent' ? TRANSPARENT_HINT : '',
  ].filter(Boolean).join(' '),
});

overlay.hidden = false;
overlay.classList.add('is-note');
overlay.innerHTML = '<div><strong>Showing a demo screenshot.</strong> Drop your own recording or screenshot on the left.</div>';

resize();
stage.play().catch(() => {});
