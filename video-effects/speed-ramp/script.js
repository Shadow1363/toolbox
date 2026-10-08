/*
 * Speed Ramp: draw a speed curve over the clip (0.25×–4×) with smooth easing between points.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * The stage runs on output time τ (wall clock, getVideo null). curve.js maps τ → source time.
 * While playing, syncVideo() drives the <video> with playbackRate = speed (preservesPitch per the
 * audio mode) and corrects drift; when paused or exporting a GIF it seeks to the exact source frame.
 * Audio goes through audioGraph(video).level, so muting/dropping applies to preview and export alike.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { outputSize } from '/assets/js/lib/canvas.js';
import { audioGraph, seekVideo, setPreviewMuted } from '/assets/js/lib/media.js';
import { h, icon, toast, formatTime, store } from '/assets/js/lib/dom.js';
import { clamp } from '/assets/js/lib/easing.js';
import { MIN_V, MAX_V, speedAt, logSpeedAt, buildMap, PRESETS, presetPoints, formatSpeed } from './curve.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const editor = document.getElementById('curve');
const ectx = editor.getContext('2d');
const infoEl = document.getElementById('curve-info');
const selEl = document.getElementById('curve-selected');
const warnEl = document.createElement('p');
warnEl.className = 'notice sr-warn';
warnEl.hidden = true;

let media = null;
let points = [];
let map = null;
let selected = -1;
let srcFps = 30;     // estimated from requestVideoFrameCallback
let exporting = null;

const panel = createControls(document.getElementById('controls'), [
  { title: 'Speed curve', controls: [
    { id: 'preset', type: 'presets', label: 'Presets', value: '', options: PRESETS.map((p) => ({ label: p.label, value: p.value, patch: {} })) },
    { id: 'smooth', type: 'segmented', label: 'Between points', value: 'smooth', options: [['smooth', 'Smooth'], ['linear', 'Linear']] },
    { type: 'custom', el: warnEl },
  ]},
  { title: 'Audio', controls: [
    { id: 'audio', type: 'select', label: 'Audio', value: 'pitch', options: [
      ['pitch', 'Keep, pitch-corrected'], ['natural', 'Keep, pitch follows speed'], ['drop', 'Drop during extreme speeds'], ['mute', 'Mute'],
    ] },
    { id: 'dropBelow', type: 'range', label: 'Drop below', min: 0.25, max: 1, step: 0.05, value: 0.5, format: (v) => `${v.toFixed(2)}×`, showIf: (s) => s.audio === 'drop' },
    { id: 'dropAbove', type: 'range', label: 'Drop above', min: 1, max: 4, step: 0.1, value: 2, format: (v) => `${v.toFixed(1)}×`, showIf: (s) => s.audio === 'drop' },
    { id: 'listen', type: 'toggle', label: 'Play sound in the preview', value: true, hint: 'Preview only; the Audio switch next to Export decides what’s recorded.' },
  ]},
], { onChange: (s, id) => {
  if (id === 'preset') applyPreset(s.preset);
  if (id === 'smooth') rebuild();
  if (id === 'listen' && media && graph?.el === media.el) setPreviewMuted(media.el, !s.listen);
  stage.invalidate();
} });
const s = panel.state;
const smooth = () => s.smooth === 'smooth';

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video'],
  label: 'Drop a video',
  onLoad: (m) => {
    media = m;
    m.el.preservesPitch = true;
    const { w, h: hh } = outputSize(m.width, m.height, 1920);
    canvas.width = w; canvas.height = hh;
    const saved = store.get(storeKey());
    points = saved?.points?.length ? saved.points : presetPoints(PRESETS.find((p) => p.value === 'reset'), m.duration);
    selected = -1;
    srcFps = 30;
    estimateFps();
    m.el.addEventListener('seeked', () => stage.invalidate());
    rebuild();
    stage.reset();
    exportBar.refresh();
    overlay.hidden = true;
  },
  onClear: () => { media?.el.pause(); media = null; points = []; map = null; rebuild(); stage.reset(); exportBar.refresh(); showIntro(); },
});
const storeKey = () => `speed-ramp:${media.name}:${media.size}`;

/* ---------- Curve model ---------- */
function applyPreset(value) {
  if (!media) { toast('Drop a video first.'); return; }
  points = presetPoints(PRESETS.find((p) => p.value === value), media.duration);
  selected = -1;
  rebuild();
  stage.seek(0);
}

function rebuild() {
  points.sort((a, b) => a.x - b.x);
  map = media ? buildMap(points, media.duration, smooth()) : null;
  if (media) store.set(storeKey(), { v: 1, points });
  updateInfo();
  drawCurve();
  stage?.invalidate();
  exportBar?.refresh();
}

function updateInfo() {
  if (!media || !map) {
    infoEl.textContent = 'Drop a video to edit its speed.';
    warnEl.hidden = true;
    selEl.replaceChildren();
    return;
  }
  const minV = Math.min(...points.map((p) => p.v)), maxV = Math.max(...points.map((p) => p.v));
  infoEl.innerHTML = `New length <strong>${formatTime(map.duration)}</strong> <span class="muted">(was ${formatTime(media.duration)}) · ${formatSpeed(2 ** minV)} – ${formatSpeed(2 ** maxV)}</span>`;
  const slow = 2 ** minV;
  if (slow < 0.99) {
    const eff = srcFps * slow;
    warnEl.hidden = false;
    warnEl.textContent = `Slowest part: ${formatSpeed(slow)}. This clip is about ${Math.round(srcFps)} fps, so it shows only ~${eff < 10 ? eff.toFixed(1) : Math.round(eff)} new frames per second there${eff < 24 ? ' and will look steppy' : ''}. Footage shot at 60–240 fps slows down smoothly.`;
  } else warnEl.hidden = true;
  renderSelected();
}

function renderSelected() {
  const p = points[selected];
  if (!p) { selEl.replaceChildren(h('span', { class: 'muted' }, 'Click the curve to add a point. Drag points to change speed; double-click one to remove it.')); return; }
  const input = h('input', { type: 'number', min: 0.25, max: 4, step: 0.05, value: +(2 ** p.v).toFixed(2), 'aria-label': 'Speed (×)' });
  input.addEventListener('change', () => { p.v = clamp(Math.log2(clamp(+input.value || 1, 0.25, 4)), MIN_V, MAX_V); rebuild(); });
  selEl.replaceChildren(
    h('span', {}, `Point at ${formatTime(p.x)} · speed`), input, h('span', {}, '×'),
    h('button', { type: 'button', class: 'btn btn-sm btn-ghost', html: `${icon('trash')} Remove`, disabled: points.length <= 1, onclick: () => removePoint(selected) }));
}

function removePoint(i) {
  if (points.length <= 1) return;
  points.splice(i, 1);
  selected = -1;
  rebuild();
}

/* ---------- Curve editor ---------- */
const PAD = { l: 44, r: 12, t: 12, b: 22 };
let dpr = 1;
function sizeEditor() {
  dpr = Math.min(2, window.devicePixelRatio || 1);
  const w = Math.max(200, editor.clientWidth), hh = editor.clientHeight || 170;
  editor.width = Math.round(w * dpr); editor.height = Math.round(hh * dpr);
  drawCurve();
}
new ResizeObserver(sizeEditor).observe(editor);

const plot = () => ({ x: PAD.l, y: PAD.t, w: editor.width / dpr - PAD.l - PAD.r, h: editor.height / dpr - PAD.t - PAD.b });
const toPx = (x, v) => { const P = plot(); return { px: P.x + (x / (media?.duration || 1)) * P.w, py: P.y + ((MAX_V - v) / (MAX_V - MIN_V)) * P.h }; };
const fromPx = (px, py) => { const P = plot(); return { x: clamp((px - P.x) / P.w) * (media?.duration || 1), v: clamp(MAX_V - ((py - P.y) / P.h) * (MAX_V - MIN_V), MIN_V, MAX_V) }; };

function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || '#888'; }

function drawCurve() {
  const W = editor.width / dpr, H = editor.height / dpr;
  ectx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ectx.clearRect(0, 0, W, H);
  const P = plot();
  const text = css('--text-muted'), grid = css('--border'), accent = css('--accent');
  ectx.font = '11px ui-monospace, monospace';
  ectx.textAlign = 'right'; ectx.textBaseline = 'middle';
  for (const v of [-2, -1, 0, 1, 2]) {
    const y = P.y + ((MAX_V - v) / (MAX_V - MIN_V)) * P.h;
    ectx.strokeStyle = grid; ectx.lineWidth = v === 0 ? 1.5 : 1;
    ectx.setLineDash(v === 0 ? [] : [3, 4]);
    ectx.beginPath(); ectx.moveTo(P.x, y); ectx.lineTo(P.x + P.w, y); ectx.stroke();
    ectx.fillStyle = text;
    ectx.fillText(formatSpeed(2 ** v), P.x - 6, y);
  }
  ectx.setLineDash([]);
  if (!media) return;
  // Time ticks
  ectx.textAlign = 'center'; ectx.textBaseline = 'top';
  const D = media.duration, step = D > 120 ? 30 : D > 40 ? 10 : D > 12 ? 5 : 1;
  for (let x = 0; x <= D + 1e-6; x += step) {
    const { px } = toPx(x, 0);
    ectx.textAlign = px > P.x + P.w - 16 ? 'right' : 'center'; // keep the last label inside the canvas
    ectx.fillStyle = text;
    ectx.fillText(formatTime(x).replace(/\.\d$/, ''), px, P.y + P.h + 6);
  }
  // Curve, filled to the 1× line
  ectx.beginPath();
  const N = Math.max(60, Math.round(P.w));
  for (let i = 0; i <= N; i++) {
    const x = (i / N) * D;
    const { px, py } = toPx(x, logSpeedAt(points, x, smooth()));
    i ? ectx.lineTo(px, py) : ectx.moveTo(px, py);
  }
  ectx.strokeStyle = accent; ectx.lineWidth = 2.5; ectx.stroke();
  const one = toPx(0, 0).py;
  ectx.lineTo(P.x + P.w, one); ectx.lineTo(P.x, one); ectx.closePath();
  ectx.globalAlpha = 0.18; ectx.fillStyle = accent; ectx.fill(); ectx.globalAlpha = 1;
  // Playhead (source time)
  if (map) {
    const x = map.srcAt(stage.time);
    const { px } = toPx(x, 0);
    ectx.strokeStyle = css('--text'); ectx.lineWidth = 1.5;
    ectx.beginPath(); ectx.moveTo(px, P.y); ectx.lineTo(px, P.y + P.h); ectx.stroke();
  }
  // Points
  points.forEach((p, i) => {
    const { px, py } = toPx(p.x, p.v);
    ectx.beginPath(); ectx.arc(px, py, i === selected ? 7 : 5.5, 0, Math.PI * 2);
    ectx.fillStyle = i === selected ? accent : css('--surface'); ectx.fill();
    ectx.strokeStyle = accent; ectx.lineWidth = 2.5; ectx.stroke();
  });
  if (drag != null && points[drag]) {
    const p = points[drag];
    const { px, py } = toPx(p.x, p.v);
    ectx.textAlign = 'left'; ectx.textBaseline = 'bottom'; ectx.font = '600 12px system-ui, sans-serif';
    ectx.fillStyle = css('--text');
    ectx.fillText(`${formatSpeed(2 ** p.v)} @ ${formatTime(p.x)}`, Math.min(px + 10, P.x + P.w - 90), py - 8);
  }
}

let drag = null;
const evPos = (e) => { const r = editor.getBoundingClientRect(); return { px: e.clientX - r.left, py: e.clientY - r.top }; };
const hit = (px, py) => points.findIndex((p) => { const q = toPx(p.x, p.v); return Math.hypot(q.px - px, q.py - py) < 10; });
editor.addEventListener('pointerdown', (e) => {
  if (!media) return;
  const { px, py } = evPos(e);
  let i = hit(px, py);
  if (i < 0) {
    const at = fromPx(px, py);
    // New points sit on the current curve, so adding one never changes the speed by itself.
    points.push({ x: at.x, v: logSpeedAt(points, at.x, smooth()) });
    points.sort((a, b) => a.x - b.x);
    i = points.findIndex((p) => p.x === at.x);
  }
  selected = drag = i;
  editor.setPointerCapture(e.pointerId);
  rebuild();
});
editor.addEventListener('pointermove', (e) => {
  const { px, py } = evPos(e);
  if (drag == null) { editor.style.cursor = media && hit(px, py) >= 0 ? 'grab' : media ? 'crosshair' : 'default'; return; }
  const at = fromPx(px, py);
  const p = points[drag];
  // Snap to 1× near the middle line, and keep points in order without crossing neighbours.
  p.v = Math.abs(at.v) < 0.08 ? 0 : at.v;
  const lo = points[drag - 1]?.x ?? 0, hi = points[drag + 1]?.x ?? media.duration;
  p.x = clamp(at.x, lo + 0.01, hi - 0.01);
  rebuild();
});
const endDrag = () => { if (drag != null) { drag = null; drawCurve(); } };
editor.addEventListener('pointerup', endDrag);
editor.addEventListener('pointercancel', endDrag);
editor.addEventListener('dblclick', (e) => { const { px, py } = evPos(e); const i = hit(px, py); if (i >= 0) removePoint(i); });
editor.addEventListener('keydown', (e) => { if ((e.key === 'Delete' || e.key === 'Backspace') && selected >= 0) { e.preventDefault(); removePoint(selected); } });

/* ---------- Frame-rate estimate (for the slow-motion warning) ---------- */
function estimateFps() {
  const v = media?.el;
  if (!v || !('requestVideoFrameCallback' in HTMLVideoElement.prototype)) return;
  let last = null;
  const deltas = [];
  const onFrame = (now, meta) => {
    if (media?.el !== v) return;
    if (last != null && meta.mediaTime > last) {
      const d = (meta.mediaTime - last) / Math.max(1, meta.presentedFrames - lastFrames);
      if (d > 0.002 && d < 0.2) deltas.push(d);
    }
    last = meta.mediaTime; lastFrames = meta.presentedFrames;
    if (deltas.length < 20) v.requestVideoFrameCallback(onFrame);
    else {
      deltas.sort((a, b) => a - b);
      srcFps = clamp(1 / deltas[deltas.length >> 1], 5, 240);
      updateInfo();
    }
  };
  let lastFrames = 0;
  v.requestVideoFrameCallback(onFrame);
}

/* ---------- Audio ---------- */
let graph = null;
/** The audio graph needs a user gesture to start; create it on the first one. */
function ensureAudio() {
  if (!media || graph?.el === media.el) return graph?.g;
  try {
    graph = { el: media.el, g: audioGraph(media.el) };
    graph.g?.ctx.resume();
    setPreviewMuted(media.el, !s.listen); // the stage has no mute button here (it doesn't own the video)
  } catch (err) { console.warn(err); graph = null; }
  return graph?.g;
}
['pointerdown', 'keydown'].forEach((ev) => document.addEventListener(ev, () => { if (media) ensureAudio()?.ctx.resume(); }, { capture: true }));

function audioLevel(speed) {
  if (s.audio === 'mute') return 0;
  if (s.audio === 'drop' && (speed < s.dropBelow - 1e-3 || speed > s.dropAbove + 1e-3)) return 0;
  return 1;
}

/* ---------- Video sync ---------- */
/** Seek target nudged 1 ms forward: remapped times land a hair under frame boundaries and would show the previous frame. */
const frameTime = (x) => Math.min(media.duration, x + 0.001);

function syncVideo(tau) {
  const v = media?.el;
  if (!v || !map) return;
  const target = map.srcAt(tau);
  const speed = speedAt(points, target, smooth());
  const g = graph?.el === v ? graph.g : null;
  if (g) g.level.gain.setTargetAtTime(audioLevel(speed), g.ctx.currentTime, 0.03);
  const live = stage.playing && exporting !== 'gif';
  if (live) {
    v.preservesPitch = s.audio !== 'natural';
    const err = v.currentTime - target;
    if (Math.abs(err) > 0.25 || v.ended) { v.currentTime = target; }
    // Nudge the rate to absorb small drift instead of seeking (seeks stutter).
    const rate = clamp(speed * (1 - clamp(err, -0.1, 0.1) * 2), 0.0625, 16);
    if (Math.abs(v.playbackRate - rate) > 0.002) v.playbackRate = rate;
    if (v.paused && target < media.duration - 0.05) v.play().catch(() => {});
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - target) > 0.5 / srcFps) v.currentTime = frameTime(target);
  }
}

/* ---------- Rendering ---------- */
function render(tau) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!media) { ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, W, H); drawCurve(); return; }
  syncVideo(tau);
  ctx.drawImage(media.el, 0, 0, W, H);
  drawCurve();
}

function showIntro() {
  overlay.hidden = false;
  overlay.className = 'preview-overlay';
  overlay.innerHTML = '<div><strong>Drop a video on the left.</strong><br>Then shape its speed on the curve below the preview.</div>';
}

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: () => (map ? map.duration : 1),
  getVideo: () => null, // output time runs on the wall clock; syncVideo() drives the source video
});
stage.events.addEventListener('ended', () => media?.el.pause());

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `${(media?.name || 'clip').replace(/\.[^.]+$/, '')}-speed-ramp`,
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  hasAudio: () => !!media,
  getAudio: () => { const g = ensureAudio(); g?.ctx.resume(); return g?.track || null; },
  hint: () => (media ? 'Video export plays the ramp once in real time.' : ''),
  beforeExport: (kind) => { exporting = kind; },
  afterExport: () => { exporting = null; media?.el.pause(); stage.invalidate(); },
  // GIF frames: seek to the exact source frame for each output time.
  prepareFrame: async (tau) => { if (media && map) await seekVideo(media.el, frameTime(map.srcAt(tau))); },
});

showIntro();
updateInfo();
sizeEditor();
