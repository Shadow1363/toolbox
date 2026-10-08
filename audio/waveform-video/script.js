/*
 * Waveform Video: audio → shareable video with an animated visualizer, cover art, titles and captions.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Flow: drop audio/video → decode (AudioBuffer, for the analyzer and the clip waveform) + an <audio> element
 * (playback, and the sound recorded into the WebM) → pick a clip on the waveform → createStage drives render(t)
 * with the <audio> element as its clock (getVideoOffset = clip start) → createExportBar (WebM with sound, GIF, PNG).
 * render(t) draws only from t (visualizer levels come from an FFT of the decoded samples at t), so every export
 * matches the preview. Captions reuse lib/whisper.js, lib/transcript.js and lib/captions.js (as Auto Captions does).
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, progressModal } from '/assets/js/lib/exporter.js';
import { linearGradient, drawBlurred, roundRectPath, fit } from '/assets/js/lib/canvas.js';
import { fontOptions, weightOptions, ensureFont, fontString } from '/assets/js/lib/fonts.js';
import { h, icon, toast, formatBytes, formatTime } from '/assets/js/lib/dom.js';
import { loadMedia } from '/assets/js/lib/media.js';
import { pickFile } from '/assets/js/lib/image-io.js';
import { takeFile } from '/assets/js/lib/handoff.js';
import { createAudioDrop, loadAudioWithProgress, resample, clock } from '/assets/js/lib/audio-io.js';
import { createWaveform } from '/assets/js/lib/audio-waveform.js';
import { encodeWav, sliceBuffer } from '/assets/js/lib/audio-export.js';
import { WHISPER_MODELS, pickDevice, gpuSupport, modelBytes, isCached, transcribe, languageName, SAMPLE_RATE } from '/assets/js/lib/whisper.js';
import { newLine, buildLines, lineText, lineStart, lineEnd, retime, timeline, pageAt } from '/assets/js/lib/transcript.js';
import { drawCaption } from '/assets/js/lib/captions.js';
import { createAnalyzer, drawViz, symmetric } from './viz.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');

let file = null, buffer = null, an = null;
let audioEl = null, audioUrl = null;
let clip = null;                       // { start, end } in source seconds, or null = whole file
let lines = [], pages = [];
const images = { cover: null, bg: null }; // { el, dispose }
let busy = false;

const SIZES = { '9:16': [1080, 1920], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const CAPTION_STYLES = {
  karaoke: { family: 'Montserrat', weight: '900', uppercase: false, highlight: 'wipe', reveal: 'page', pop: false, stroke: 5, strokeColor: '#000000', shadow: 10, bg: 'none', maxWords: 6 },
  pop: { family: 'Montserrat', weight: '900', uppercase: false, highlight: 'color', reveal: 'word', pop: true, stroke: 6, strokeColor: '#000000', shadow: 14, bg: 'none', maxWords: 4 },
  classic: { family: 'Inter', weight: '600', uppercase: false, highlight: 'none', reveal: 'page', pop: false, stroke: 0, strokeColor: '#000000', shadow: 0, bg: 'lines', bgColor: '#000000', bgOpacity: 0.65, maxWords: 9 },
  boxed: { family: 'Montserrat', weight: '900', uppercase: true, highlight: 'box', reveal: 'page', pop: true, stroke: 0, strokeColor: '#000000', shadow: 12, bg: 'none', maxWords: 3 },
};
const PALETTES = [
  { label: 'Night', value: 'night', preview: 'linear-gradient(135deg,#1b1446,#0b2a3a)', patch: { bg: 'gradient', bgColor: '#1b1446', bgColor2: '#0b2a3a', color: '#7c6cff', color2: '#22d3ee', gradient: true, textColor: '#ffffff', subColor: '#b9c2d6' } },
  { label: 'Sunset', value: 'sunset', preview: 'linear-gradient(135deg,#ff6a3d,#7b2ff7)', patch: { bg: 'gradient', bgColor: '#ff6a3d', bgColor2: '#7b2ff7', color: '#ffffff', color2: '#ffe29a', gradient: true, textColor: '#ffffff', subColor: '#ffe9dc' } },
  { label: 'Paper', value: 'paper', preview: '#f4efe6', patch: { bg: 'color', bgColor: '#f4efe6', color: '#1d1d1f', color2: '#e4572e', gradient: false, textColor: '#1d1d1f', subColor: '#6e6e73' } },
  { label: 'Mint', value: 'mint', preview: 'linear-gradient(135deg,#0f3d3e,#1b6b5f)', patch: { bg: 'gradient', bgColor: '#0f3d3e', bgColor2: '#1b6b5f', color: '#b8ffd9', color2: '#5cf08f', gradient: true, textColor: '#ffffff', subColor: '#cde9df' } },
  { label: 'Mono', value: 'mono', preview: '#000', patch: { bg: 'color', bgColor: '#000000', color: '#ffffff', color2: '#ffffff', gradient: false, textColor: '#ffffff', subColor: '#a1a1a6' } },
];

/* ---------- Image pickers (cover, background) ---------- */
function imagePicker(slot, label) {
  const thumb = h('img', { class: 'wv-thumb', alt: '', hidden: true });
  const remove = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: true, 'aria-label': `Remove ${label.toLowerCase()}`, html: icon('x') });
  const choose = h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('image')} ${label}` });
  const set = (m) => {
    images[slot]?.dispose?.();
    images[slot] = m;
    thumb.hidden = !m; remove.hidden = !m;
    if (m) thumb.src = m.url;
    else thumb.removeAttribute('src');
    panel.refresh();
    stage.invalidate();
  };
  choose.addEventListener('click', async () => {
    const f = await pickFile('image/*');
    if (!f) return;
    try { set(await loadMedia(f, { accept: ['image'] })); } catch (err) { toast(err.message, 'error'); }
  });
  remove.addEventListener('click', () => set(null));
  return { el: h('div', { class: 'wv-img-row' }, thumb, choose, remove), set };
}
const coverPick = imagePicker('cover', 'Cover image');
const bgPick = imagePicker('bg', 'Background image');

/* ---------- Captions controls ---------- */
const modelInfo = h('div', { class: 'wv-model-info', 'aria-live': 'polite' });
const runBtn = h('button', { type: 'button', class: 'btn btn-primary wv-run', disabled: true, html: `${icon('mic')} Transcribe the clip` });
runBtn.addEventListener('click', () => runTranscription());

const pct = (v) => `${Math.round(v)}%`;
const panel = createControls(document.getElementById('controls'), [
  { title: 'Format', controls: [
    { id: 'aspect', type: 'segmented', label: 'Aspect ratio', value: '9:16', options: [['9:16', '9:16 Story'], ['1:1', '1:1 Square'], ['16:9', '16:9 Wide']] },
    { id: 'layout', type: 'segmented', label: 'Layout', value: 'auto', options: [['auto', 'Auto'], ['stacked', 'Stacked'], ['side', 'Side by side']] },
    { id: 'palette', type: 'swatches', label: 'Theme', value: 'night', options: PALETTES },
  ] },
  { title: 'Visualizer', controls: [
    { id: 'style', type: 'select', label: 'Style', value: 'bars', options: [['bars', 'Bars'], ['mirror', 'Mirrored bars'], ['line', 'Line'], ['wave', 'Waveform (oscilloscope)'], ['circle', 'Circular'], ['dots', 'Dots']] },
    { id: 'count', type: 'range', label: 'Bars', min: 12, max: 128, step: 2, value: 48, showIf: (st) => st.style !== 'wave' },
    { id: 'color', type: 'color', label: 'Color', value: '#7c6cff' },
    { id: 'gradient', type: 'toggle', label: 'Gradient', value: true },
    { id: 'color2', type: 'color', label: 'Second color', value: '#22d3ee', showIf: (st) => st.gradient },
    { id: 'vizSize', type: 'range', label: 'Height', min: 4, max: 50, step: 1, value: 14, format: pct },
    { id: 'vizWidth', type: 'range', label: 'Width', min: 30, max: 100, step: 1, value: 84, format: pct, showIf: (st) => st.style !== 'circle' },
    { id: 'vizY', type: 'range', label: 'Vertical position', min: 5, max: 95, step: 1, value: 74, format: pct, showIf: (st) => st.style !== 'circle' || !images.cover },
    { id: 'gap', type: 'range', label: 'Gap', min: 0, max: 0.8, step: 0.05, value: 0.35, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => !['line', 'wave'].includes(st.style) },
    { id: 'thickness', type: 'range', label: 'Line width', min: 1, max: 16, step: 1, value: 5, unit: 'px', showIf: (st) => ['line', 'wave'].includes(st.style) },
    { id: 'rounded', type: 'toggle', label: 'Rounded', value: true, showIf: (st) => ['bars', 'mirror', 'circle'].includes(st.style) },
    { id: 'glow', type: 'range', label: 'Glow', min: 0, max: 40, step: 1, value: 0, unit: 'px' },
    { id: 'sensitivity', type: 'range', label: 'Sensitivity', min: 0.5, max: 2, step: 0.05, value: 1, format: (v) => `${v.toFixed(2)}×` },
    { id: 'smoothing', type: 'range', label: 'Smoothing', min: 0, max: 1, step: 0.05, value: 0.5, format: (v) => `${Math.round(v * 100)}%` },
  ] },
  { title: 'Background', controls: [
    { id: 'bg', type: 'segmented', label: 'Type', value: 'gradient', options: [['color', 'Color'], ['gradient', 'Gradient'], ['image', 'Image'], ['blur', 'Blurred cover']] },
    { id: 'bgColor', type: 'color', label: 'Color', value: '#1b1446', showIf: (st) => st.bg === 'color' || st.bg === 'gradient' },
    { id: 'bgColor2', type: 'color', label: 'Second color', value: '#0b2a3a', showIf: (st) => st.bg === 'gradient' },
    { id: 'bgAngle', type: 'range', label: 'Angle', min: 0, max: 360, step: 5, value: 135, unit: '°', showIf: (st) => st.bg === 'gradient' },
    { type: 'custom', el: bgPick.el, showIf: (st) => st.bg === 'image' },
    { id: 'blurAmt', type: 'range', label: 'Blur', min: 10, max: 120, step: 2, value: 60, unit: 'px', showIf: (st) => st.bg === 'blur' },
    { id: 'darken', type: 'range', label: 'Darken', min: 0, max: 0.85, step: 0.05, value: 0.35, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => st.bg === 'image' || st.bg === 'blur' },
  ] },
  { title: 'Cover & titles', controls: [
    { type: 'custom', el: coverPick.el },
    { id: 'coverSize', type: 'range', label: 'Cover size', min: 10, max: 80, step: 1, value: 52, format: pct, showIf: () => !!images.cover },
    { id: 'coverShape', type: 'segmented', label: 'Cover shape', value: 'rounded', options: [['rounded', 'Rounded'], ['square', 'Square'], ['circle', 'Circle']], showIf: () => !!images.cover },
    { id: 'title', type: 'text', label: 'Title', value: '', placeholder: 'Episode 12: Building in public' },
    { id: 'subtitle', type: 'text', label: 'Subtitle', value: '', placeholder: 'The Weekend Workshop podcast' },
    { id: 'family', type: 'select', label: 'Font', value: 'Inter', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Title weight', value: '800', options: [...weightOptions, ['800', 'Extra bold']] },
    { id: 'titleSize', type: 'range', label: 'Title size', min: 24, max: 140, step: 1, value: 64, unit: 'px' },
    { id: 'textColor', type: 'color', label: 'Title color', value: '#ffffff' },
    { id: 'subColor', type: 'color', label: 'Subtitle color', value: '#b9c2d6' },
  ] },
  { title: 'Captions', controls: [
    { id: 'captions', type: 'toggle', label: 'Show captions', value: true },
    { id: 'model', type: 'select', label: 'Speech model', value: 'base', options: WHISPER_MODELS },
    { type: 'custom', el: modelInfo },
    { type: 'custom', el: runBtn },
    { id: 'capStyle', type: 'segmented', label: 'Style', value: 'karaoke', options: [['karaoke', 'Karaoke'], ['pop', 'Pop-in'], ['classic', 'Classic'], ['boxed', 'Boxed']], showIf: (st) => st.captions },
    { id: 'capColor', type: 'color', label: 'Highlight', value: '#ffd23f', showIf: (st) => st.captions && st.capStyle !== 'classic' },
    { id: 'capSize', type: 'range', label: 'Size', min: 24, max: 140, step: 1, value: 64, unit: 'px', showIf: (st) => st.captions },
    { id: 'capY', type: 'range', label: 'Vertical position', min: 5, max: 95, step: 1, value: 88, format: pct, showIf: (st) => st.captions },
  ] },
], { onChange: (st, id) => {
  if (id === 'aspect') resize();
  if (id === 'model') updateModelInfo();
  if (['family', 'weight'].includes(id)) ensureFont(st.family, st.weight, () => stage.invalidate());
  if (id === 'capStyle') { const c = CAPTION_STYLES[st.capStyle]; ensureFont(c.family, c.weight, () => stage.invalidate()); rebuildPages(); }
  stage.invalidate();
} });
const s = panel.state;

/* ---------- Layout ---------- */
function layoutFor(W, H) {
  const k = Math.min(W, H) / 1080;
  const mode = s.layout === 'auto' ? (W > H * 1.2 ? 'side' : 'stacked') : s.layout;
  const cs = images.cover ? (s.coverSize / 100) * Math.min(W, H) : 0;
  const L = { k, mode, cover: null, text: null };
  if (mode === 'side') {
    const cy = H * 0.4;
    if (cs) L.cover = { x: W * 0.07, y: cy - cs / 2, size: cs };
    const tx = cs ? W * 0.07 + cs + 64 * k : W * 0.07;
    L.text = { x: tx, y: cy, align: 'left', maxW: W - tx - W * 0.07, anchor: 'middle' };
  } else {
    const top = H > W ? H * 0.13 : H * 0.08;
    if (cs) L.cover = { x: (W - cs) / 2, y: top, size: cs };
    L.text = { x: W / 2, y: cs ? top + cs + 64 * k : H * 0.3, align: 'center', maxW: W * 0.84, anchor: 'top' };
  }
  return L;
}

/** Wrap text into at most `max` lines that fit maxW. */
function wrap(text, maxW, max = 3) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && ctx.measureText(next).width > maxW) { out.push(line); line = w; } else line = next;
  }
  if (line) out.push(line);
  if (out.length > max) { out.length = max; out[max - 1] = `${out[max - 1].replace(/\s*\S*$/, '')}…`; }
  return out;
}

/* ---------- Rendering ---------- */
function drawBackground(W, H) {
  const cover = images.cover?.el, bg = images.bg?.el;
  if (s.bg === 'image' && bg) {
    const r = fit(bg.naturalWidth, bg.naturalHeight, W, H, 'cover');
    ctx.drawImage(bg, r.x, r.y, r.w, r.h);
  } else if (s.bg === 'blur' && (cover || bg)) {
    const src = cover || bg;
    const r = fit(src.naturalWidth, src.naturalHeight, W, H, 'cover');
    const pad = s.blurAmt * 2; // draw wider than the frame so the blur doesn't fade at the edges
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    drawBlurred(ctx, src, r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2, s.blurAmt * (Math.min(W, H) / 1080));
  } else if (s.bg !== 'color') { // gradient, or image/blur without a picture yet
    ctx.fillStyle = linearGradient(ctx, W, H, s.bgAngle - 90, [s.bgColor, s.bgColor2]);
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, W, H);
  }
  if ((s.bg === 'image' && bg) || (s.bg === 'blur' && (cover || bg))) {
    ctx.fillStyle = `rgba(0,0,0,${s.darken})`;
    ctx.fillRect(0, 0, W, H);
  }
}

function drawCover(L, pulse) {
  const img = images.cover?.el;
  if (!img || !L.cover) return;
  const { x, y, size } = L.cover;
  const grow = 1 + pulse * 0.025;
  const sz = size * grow, ox = x - (sz - size) / 2, oy = y - (sz - size) / 2;
  const r = s.coverShape === 'circle' ? sz / 2 : s.coverShape === 'rounded' ? sz * 0.06 : 0;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.35)';
  ctx.shadowBlur = 40 * L.k;
  ctx.shadowOffsetY = 14 * L.k;
  ctx.beginPath();
  roundRectPath(ctx, ox, oy, sz, sz, r);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip();
  const f = fit(img.naturalWidth, img.naturalHeight, sz, sz, 'cover');
  ctx.drawImage(img, ox + f.x, oy + f.y, f.w, f.h);
  ctx.restore();
}

function drawTitles(L) {
  if (!s.title && !s.subtitle) return;
  const { x, maxW, align } = L.text;
  const ts = s.titleSize * L.k, ss = ts * 0.5;
  ctx.save();
  ctx.textAlign = align;
  ctx.textBaseline = 'top';
  ctx.font = fontString(s.family, s.weight, ts);
  const tl = s.title ? wrap(s.title, maxW, 3) : [];
  ctx.font = fontString(s.family, 500, ss);
  const sl = s.subtitle ? wrap(s.subtitle, maxW, 2) : [];
  const blockH = tl.length * ts * 1.12 + (sl.length ? ss * 0.6 + sl.length * ss * 1.3 : 0);
  let y = L.text.anchor === 'middle' ? L.text.y - blockH / 2 : L.text.y;
  ctx.fillStyle = s.textColor;
  ctx.font = fontString(s.family, s.weight, ts);
  for (const line of tl) { ctx.fillText(line, x, y); y += ts * 1.12; }
  if (sl.length) {
    y += ss * 0.6;
    ctx.fillStyle = s.subColor;
    ctx.font = fontString(s.family, 500, ss);
    for (const line of sl) { ctx.fillText(line, x, y); y += ss * 1.3; }
  }
  ctx.restore();
}

/** Levels for the demo (no audio yet): a deterministic, music-like shape. */
function demoLevels(t, n) {
  return Float32Array.from({ length: n }, (_, i) => {
    const x = i / n;
    const v = 0.55 * Math.exp(-x * 2.2) + 0.25 * (0.5 + 0.5 * Math.sin(t * 6 + i * 0.7)) * (0.5 + 0.5 * Math.sin(t * 2.3 + i * 0.23)) + 0.1;
    return Math.max(0, Math.min(1, v * (0.75 + 0.25 * Math.sin(t * 4.1))));
  });
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const srcT = (clip?.start || 0) + t;
  const L = layoutFor(W, H);
  ctx.clearRect(0, 0, W, H);
  drawBackground(W, H);
  const pulse = an ? Math.min(1, an.level(srcT) * 4) : 0.3 + 0.3 * Math.sin(t * 4);
  drawCover(L, pulse);
  drawTitles(L);

  // Visualizer
  const n = s.style === 'circle' ? Math.max(8, Math.round(s.count / 2)) : s.count;
  let levels;
  if (s.style === 'wave') levels = an ? an.wave(srcT, 512).map((v) => v * 2.5 * s.sensitivity) : Float32Array.from({ length: 512 }, (_, i) => 0.5 * Math.sin(i / 9 + t * 12) * Math.sin(i / 80 + t));
  else levels = an ? an.bands(srcT, n, { smoothing: s.smoothing, sensitivity: s.sensitivity }) : demoLevels(t, n);
  const vh = (s.vizSize / 100) * H, vw = (s.vizWidth / 100) * W;
  const box = { x: (W - vw) / 2, y: (s.vizY / 100) * H - vh / 2, w: vw, h: vh };
  if (s.style === 'circle') {
    levels = symmetric(levels);
    if (L.cover) {
      const c = L.cover;
      // A square cover's corners reach √2 × half its size, so the ring starts outside them.
      Object.assign(box, { cx: c.x + c.size / 2, cy: c.y + c.size / 2, r: (c.size / 2) * (s.coverShape === 'circle' ? 1 : 1.42) + 18 * L.k, h: vh * 0.7 });
    } else Object.assign(box, { cx: W / 2, cy: (s.vizY / 100) * H, r: Math.min(W, H) * 0.16, h: vh * 0.7 });
  }
  drawViz(ctx, s.style, levels, box, { color: s.color, color2: s.color2, gradient: s.gradient, rounded: s.rounded, gap: s.gap, thickness: s.thickness * L.k, glow: s.glow * L.k });

  // Captions
  if (s.captions && pages.length) {
    const st = CAPTION_STYLES[s.capStyle];
    drawCaption(ctx, pageAt(pages, srcT), srcT, { ...st, color: '#ffffff', hlColor: s.capColor, bgColor: st.bgColor || '#000000', bgOpacity: st.bgOpacity ?? 0.7, size: s.capSize, posY: s.capY, width: 86 });
  }
  syncActive(srcT);
  wave.setTime(srcT, { follow: stage?.playing });
}

/* ---------- Stage + export ---------- */
function resize() {
  const [w, hh] = SIZES[s.aspect];
  canvas.width = w; canvas.height = hh; // the panel's onChange invalidates the stage afterwards
}
resize();

const clipLen = () => (buffer ? (clip ? clip.end - clip.start : buffer.duration) : 6);
const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: clipLen,
  getVideo: () => audioEl,
  getVideoOffset: () => clip?.start || 0,
});

const baseName = () => (file?.name || 'waveform').replace(/\.[^.]+$/, '');
const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `${baseName()}-waveform`,
  getVideo: () => audioEl,
  hasAudio: () => !!audioEl,
  video: () => !!buffer,
  hint: () => (buffer ? (clipLen() > 120 ? `Video export records in real time (${formatTime(clipLen())}). Pick a shorter clip for a quicker export.` : '') : 'Drop audio to export a video with sound.'),
  beforeExport: (kind) => { if (kind === 'gif' && clipLen() > 30) toast('Long GIFs get big: pick a start and end in the dialog.', 'info'); },
});

/* ---------- Clip waveform ---------- */
const clipInfo = document.getElementById('clip-info');
const clipAll = document.getElementById('clip-all');
const wave = createWaveform(document.getElementById('wave'), {
  height: 96,
  onSeek: (t) => {
    const a = clip?.start || 0;
    if (t >= a && t <= a + clipLen()) stage.seek(t - a);
  },
  onSelect: (sel, { done }) => { if (done || !sel) setClip(sel); },
});
clipAll.addEventListener('click', () => { wave.selection = null; setClip(null); });

function setClip(sel) {
  clip = sel && sel.end - sel.start >= 0.5 ? sel : null;
  if (!clip) wave.selection = null;
  clipInfo.textContent = buffer ? (clip ? `${clock(clip.start, 1)} – ${clock(clip.end, 1)} · ${formatTime(clip.end - clip.start)}` : `Whole audio · ${formatTime(buffer.duration)}`) : '';
  clipAll.hidden = !clip;
  stage.reset();
  exportBar.refresh();
  runBtn.disabled = !buffer || busy;
}

/* ---------- Load ---------- */
const drop = createAudioDrop(document.getElementById('upload'), {
  label: 'Drop audio or video',
  onFile: (f) => open(f),
  onClear: () => {
    stage.pause();
    file = buffer = an = null;
    disposeAudio();
    setLines([]);
    wave.setBuffer(null);
    setClip(null);
    showHint();
  },
});

function disposeAudio() {
  audioEl?.pause();
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioEl = null; audioUrl = null;
}

/** An <audio> element for playback and recording: the file itself when it plays here, else a WAV of the decoded audio. */
async function makeAudio(f, buf) {
  const tryUrl = (url) => new Promise((resolve, reject) => {
    const el = new Audio();
    el.preload = 'auto';
    const done = () => { clearTimeout(timer); el.oncanplay = el.onerror = null; };
    const timer = setTimeout(() => { done(); reject(new Error('timeout')); }, 15000);
    el.oncanplay = () => { done(); resolve(el); };
    el.onerror = () => { done(); reject(new Error('unplayable')); };
    el.src = url;
  });
  let url = URL.createObjectURL(f);
  try { return { el: await tryUrl(url), url }; } catch {
    URL.revokeObjectURL(url);
    url = URL.createObjectURL(encodeWav(buf));
    return { el: await tryUrl(url), url };
  }
}

async function open(f, meta = {}) {
  try {
    const { buffer: buf } = await loadAudioWithProgress(f);
    stage.pause();
    disposeAudio();
    const a = await makeAudio(f, buf);
    file = f;
    buffer = buf;
    an = createAnalyzer(buf);
    audioEl = a.el; audioUrl = a.url;
    drop.setFile(f, `${formatTime(buf.duration)} · ${(buf.sampleRate / 1000).toFixed(1)} kHz`);
    wave.setBuffer(buf);
    setLines(meta.words?.length ? buildLines(meta.words) : []);
    // Long files: start with the first minute selected (a typical social clip).
    if (buf.duration > 90) { wave.selection = { start: 0, end: 60 }; setClip({ start: 0, end: 60 }); } else setClip(null);
    if (!s.title) panel.set({ title: f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') }, { silent: true });
    showHint();
    stage.invalidate();
    if (meta.words?.length) toast(`Loaded the transcript from ${meta.from || 'another tool'} as captions.`);
  } catch (err) {
    if (err.name === 'AbortError') return;
    console.error(err);
    toast(err.message || 'Couldn’t open that file.', 'error', 8000);
  }
}

function showHint() {
  overlay.hidden = !!buffer;
  if (!buffer) {
    overlay.className = 'preview-overlay is-note';
    overlay.innerHTML = '<div>Preview with demo levels. <strong>Drop audio on the left</strong> to make your video.</div>';
  }
}

/* ---------- Captions: transcription + editor ---------- */
let infoToken = 0;
async function updateModelInfo() {
  const token = ++infoToken;
  const device = await pickDevice('auto');
  const [bytes, cached, gpu] = await Promise.all([modelBytes(s.model, device), isCached(s.model, device), gpuSupport()]);
  if (token !== infoToken) return;
  modelInfo.replaceChildren(
    cached ? h('span', { class: 'is-cached' }, `✓ Downloaded (${formatBytes(bytes)}), ready offline.`) : h('span', {}, `Download: ${formatBytes(bytes)}, once. It’s cached in this browser afterwards.`),
    h('span', {}, device === 'webgpu' ? 'Runs on your GPU (WebGPU).' : `Runs on the CPU${gpu.webgpu ? '' : ' (no WebGPU here)'}: slower.`));
}

async function runTranscription() {
  if (!buffer || busy) return;
  if (lines.length && !confirm('Replace the current captions?')) return;
  busy = true;
  runBtn.disabled = true;
  stage.pause();
  const ctrl = new AbortController();
  const modal = progressModal('Preparing audio…', () => ctrl.abort(), 'Converting the clip for Whisper.');
  const start = clip?.start || 0;
  const collected = [];
  try {
    const part = clip ? sliceBuffer(buffer, clip.start, clip.end) : buffer;
    const audio = (await resample(part, SAMPLE_RATE, 1)).getChannelData(0).slice();
    const device = await pickDevice('auto');
    const cached = await isCached(s.model, device);
    const total = await modelBytes(s.model, device);
    modal.phase(cached ? 'Loading model…' : 'Downloading model…', cached ? 'Loading Whisper from your browser cache.' : `Whisper ${s.model}: ${formatBytes(total)}, once.`);
    let running = false;
    const res = await transcribe(audio, {
      model: s.model, device, signal: ctrl.signal,
      onDownload: (l, tot) => { if (!running) modal.set(l / tot); },
      onLanguage: (code) => { running = true; modal.phase('Transcribing…', `${formatTime(audio.length / SAMPLE_RATE)} of ${languageName(code)}.`); },
      onProgress: (p) => { if (running) modal.set(p); },
      onWords: (w) => { collected.push(...w.map((x) => ({ ...x, start: x.start + start, end: x.end + start }))); setLines(buildLines(collected)); },
    });
    setLines(buildLines(res.words.map((w) => ({ ...w, start: w.start + start, end: w.end + start }))));
    panel.set({ captions: true }, { silent: true });
    updateModelInfo();
    toast(res.words.length ? `Captions ready: ${res.words.length} words (${languageName(res.language)}).` : 'No speech found in this clip.', res.words.length ? 'success' : 'warning');
  } catch (err) {
    if (err.name === 'AbortError') { toast('Transcription stopped.'); setLines(buildLines(collected)); }
    else { console.error(err); toast(err.message || 'Transcription failed.', 'error', 9000); }
  } finally {
    modal.close();
    busy = false;
    runBtn.disabled = !buffer;
    stage.invalidate();
  }
}

const capPanel = document.getElementById('captions-panel');
const linesEl = document.getElementById('lines');
const rows = new Map();
function rebuildPages() { pages = timeline(lines, CAPTION_STYLES[s.capStyle].maxWords); stage?.invalidate(); }
function setLines(next) {
  lines = next;
  rebuildPages();
  capPanel.hidden = !lines.length;
  document.getElementById('caption-meta').textContent = lines.length ? `${lines.reduce((n, l) => n + l.words.length, 0)} words` : '';
  rows.clear();
  linesEl.replaceChildren(...lines.map((line) => {
    const time = h('button', { type: 'button', class: 'wv-time', title: 'Jump here' }, clock(lineStart(line), 1));
    const ta = h('textarea', { rows: 1, 'aria-label': `Caption at ${clock(lineStart(line), 1)}` });
    ta.value = lineText(line);
    let snap = null;
    ta.addEventListener('focus', () => { snap = line.words.slice(); });
    ta.addEventListener('input', () => { line.words = retime(snap || line.words, ta.value); autosize(ta); rebuildPages(); });
    time.addEventListener('click', () => {
      const a = clip?.start || 0;
      const t = lineStart(line) - a;
      if (t >= 0 && t <= clipLen()) stage.seek(t);
      else toast('That line is outside the clip.', 'info');
    });
    const row = h('div', { class: 'wv-line' }, time, ta);
    rows.set(line.id, row);
    requestAnimationFrame(() => autosize(ta));
    return row;
  }));
}
const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
document.getElementById('caption-clear').addEventListener('click', () => { if (confirm('Remove all captions?')) setLines([]); });

let activeId = null;
function syncActive(t) {
  if (!lines.length) return;
  const line = lines.find((l) => t >= lineStart(l) - 0.05 && t < lineEnd(l) + 0.3);
  const id = line?.id ?? null;
  if (id === activeId) return;
  rows.get(activeId)?.classList.remove('is-active');
  activeId = id;
  rows.get(id)?.classList.add('is-active');
}

/* ---------- Start ---------- */
showHint();
updateModelInfo();
ensureFont(s.family, s.weight, () => stage.invalidate());
ensureFont(CAPTION_STYLES[s.capStyle].family, CAPTION_STYLES[s.capStyle].weight, () => stage.invalidate());
setClip(null);
stage.play().catch(() => {});
takeFile('waveform-video').then((item) => { if (item) open(item.file, { ...item.meta }); });
