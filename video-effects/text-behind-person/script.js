/* Text Behind Person — segment the person on every frame and draw text between background and person. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { drawAnimatedText, ANIMATIONS, DEFAULT_EASING, EXIT_ANIMATIONS, EXIT_EASING } from '/assets/js/lib/text-anim.js';
import { fontOptions, weightOptions, ensureFont } from '/assets/js/lib/fonts.js';
import { easingOptions } from '/assets/js/lib/easing.js';
import { outputSize, scratch, supportsCanvasFilter } from '/assets/js/lib/canvas.js';
import { toast } from '/assets/js/lib/dom.js';
import { SEGMENT_MODELS as MODELS, loadSegmenter } from '/assets/js/lib/vision.js';
import { createPersonMask, drawPersonCutout } from '/assets/js/lib/person-mask.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
let media = null;
let segmenter = null;     // loaded ImageSegmenter for the current model
let modelError = null;

/* ---------- Controls ---------- */
const panel = createControls(document.getElementById('controls'), [
  { title: 'Text', controls: [
    { id: 'text', type: 'textarea', label: 'Text', value: 'HELLO', rows: 2 },
    { id: 'family', type: 'select', label: 'Font', value: 'Anton', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Weight', value: '400', options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 40, max: 900, value: 380, unit: 'px', hint: 'Relative to a 1080px frame.' },
    { id: 'color', type: 'color', label: 'Color', value: '#ffffff' },
    { id: 'opacity', type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.01, value: 1, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: true },
    { id: 'letterSpacing', type: 'range', label: 'Letter spacing', min: -20, max: 60, value: 4, unit: 'px' },
    { id: 'lineHeight', type: 'range', label: 'Line height', min: 0.7, max: 1.6, step: 0.05, value: 0.95, decimals: 2 },
  ]},
  { title: 'Position', controls: [
    { id: 'posX', type: 'range', label: 'Horizontal', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'posY', type: 'range', label: 'Vertical', min: 0, max: 100, value: 34, unit: '%' },
    { id: 'align', type: 'segmented', label: 'Align', value: 'center', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
  ]},
  { title: 'Entrance', controls: [
    { id: 'anim', type: 'select', label: 'Animation', value: 'rise', options: ANIMATIONS },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeOutQuint', options: easingOptions },
    { id: 'duration', type: 'range', label: 'Duration', min: 0.1, max: 4, step: 0.1, value: 1.2, unit: 's', decimals: 1 },
    { id: 'delay', type: 'range', label: 'Start at', min: 0, max: 10, step: 0.1, value: 0.3, unit: 's', decimals: 1 },
  ]},
  { title: 'Exit', controls: [
    { id: 'exitAnim', type: 'select', label: 'Animation', value: 'stay', options: EXIT_ANIMATIONS },
    { id: 'exitEasing', type: 'select', label: 'Easing', value: 'linear', options: easingOptions, showIf: (s) => !['stay', 'cut'].includes(s.exitAnim) },
    { id: 'exitDuration', type: 'range', label: 'Duration', min: 0.1, max: 4, step: 0.1, value: 0.8, unit: 's', decimals: 1, showIf: (s) => !['stay', 'cut'].includes(s.exitAnim) },
    { id: 'exitEnd', type: 'range', label: 'End at', min: 0.1, max: 10, step: 0.01, value: 4, unit: 's', decimals: 1, showIf: (s) => s.exitAnim !== 'stay',
      hint: 'When the text is fully gone. Defaults to the end of the clip.' },
  ]},
  { title: 'Cutout', controls: [
    { id: 'behind', type: 'toggle', label: 'Person in front of text', value: true },
    { id: 'model', type: 'select', label: 'Segmentation model', value: 'general', options: Object.entries(MODELS).map(([k, m]) => [k, m.label]) },
    { id: 'threshold', type: 'range', label: 'Edge threshold', min: 0.1, max: 0.9, step: 0.01, value: 0.5, decimals: 2, hint: 'Higher keeps less of the person; lower keeps more.' },
    { id: 'softness', type: 'range', label: 'Edge softness', min: 0.01, max: 0.6, step: 0.01, value: 0.2, decimals: 2 },
    { id: 'feather', type: 'range', label: 'Feather', min: 0, max: 20, value: 3, unit: 'px', hint: supportsCanvasFilter ? '' : 'Feather needs canvas filters (not available in this browser).' },
    { id: 'smoothing', type: 'range', label: 'Temporal smoothing', min: 0, max: 0.9, step: 0.05, value: 0.4, decimals: 2, hint: 'Blends masks over frames to reduce flicker.' },
    { id: 'polarity', type: 'segmented', label: 'Mask', value: 'auto', options: [['auto', 'Auto'], ['normal', 'Normal'], ['invert', 'Inverted']] },
    { id: 'showMask', type: 'toggle', label: 'Show mask (debug)', value: false },
  ]},
  { title: 'Clip', showIf: () => media?.kind === 'image', controls: [
    { id: 'clip', type: 'range', label: 'Clip length', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1 },
  ]},
], { onChange: (s, id) => {
  if (id === 'anim') panel.set({ easing: DEFAULT_EASING[s.anim] }, { silent: true });
  if (id === 'exitAnim') panel.set({ exitEasing: EXIT_EASING[s.exitAnim] }, { silent: true });
  if (id === 'exitEnd') endFollowsClip = s.exitEnd >= clipLength() - 0.01;
  if (id === 'clip') syncTimeRanges();
  if (id === 'family' || id === 'weight') ensureFont(s.family, s.weight, () => stage.invalidate());
  if (id === 'model') { segmenter = null; mask.reset(); initModel(); }
  if (id === 'polarity') mask.polarity = null;
  if (id === 'smoothing') mask.prev = null;
  exportBar.refresh();
  stage.invalidate();
} });

const s = panel.state;

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a video of a person',
  onLoad: (m) => {
    media = m;
    const { w, h } = outputSize(m.width, m.height, 1920);
    canvas.width = w; canvas.height = h;
    mask.reset();
    syncTimeRanges();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    overlay.hidden = true;
    if (segmenter) stage.play().catch(() => {});
    else initModel();
  },
  onClear: () => { media = null; mask.reset(); syncTimeRanges(); panel.refresh(); stage.reset(); exportBar.refresh(); showIntro(); },
});

/* ---------- Timing ---------- */
const clipLength = () => (media?.kind === 'video' ? media.duration : s.clip);

// "End at" tracks the end of the clip until the user moves it somewhere else.
let endFollowsClip = true;
function syncTimeRanges() {
  const len = clipLength();
  for (const id of ['delay', 'exitEnd']) document.getElementById(`c-${id}`).max = len;
  const patch = { delay: Math.min(s.delay, len) };
  if (endFollowsClip || s.exitEnd > len) patch.exitEnd = len;
  panel.set(patch, { silent: true }); // also repaints the sliders against the new max
}

/* ---------- Model loading ---------- */
let loadingKey = null;
async function initModel() {
  const key = s.model;
  if (segmenter || loadingKey === key) return;
  loadingKey = key;
  modelError = null;
  showStatus(`<div class="spinner"></div>Loading segmentation model…<br><small>First load downloads ~${key === 'quality' ? '25' : '10'} MB, then it's cached.</small>`);
  try {
    const seg = await loadSegmenter(key);
    if (s.model !== key) return; // user switched models meanwhile
    segmenter = seg;
    overlay.hidden = true;
    stage.invalidate();
    if (media) stage.play().catch(() => {});
  } catch (err) {
    console.error(err);
    modelError = err;
    showStatus('<strong>Could not load the segmentation model.</strong><br>Check your connection or content blockers, then pick the model again. The preview shows the text without the cutout.');
    toast('Segmentation model failed to load.', 'error', 7000);
  } finally {
    if (loadingKey === key) loadingKey = null;
  }
}

function showStatus(html) {
  overlay.classList.remove('is-note');
  overlay.hidden = false;
  overlay.innerHTML = `<div>${html}</div>`;
}
function showIntro() {
  showStatus('<strong>Drop a video of a person on the left.</strong><br>The person is detected in your browser and the text is placed behind them.');
}

/* ---------- Mask pipeline (shared: lib/person-mask.js) ---------- */
const mask = createPersonMask('tbp');

/* ---------- Rendering ---------- */
function textOptions(W, H, k) {
  return {
    text: s.text, family: s.family, weight: s.weight, size: s.size * k, color: s.color,
    align: s.align, uppercase: s.uppercase, letterSpacing: s.letterSpacing * k, lineHeight: s.lineHeight,
    x: (s.posX / 100) * W, y: (s.posY / 100) * H,
    anim: s.anim, duration: s.duration, delay: s.delay, easing: s.easing,
    exit: { anim: s.exitAnim, easing: s.exitEasing, duration: s.exitDuration, end: s.exitEnd },
  };
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!media) { ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, W, H); return; }
  const k = Math.min(W, H) / 1080;
  const src = media.el;

  // 1. background (the original frame)
  ctx.drawImage(src, 0, 0, W, H);

  // 2. text
  ctx.save();
  ctx.globalAlpha = s.opacity;
  drawAnimatedText(ctx, textOptions(W, H, k), t);
  ctx.restore();

  // 3. person on top, cut out with the mask
  const haveMask = s.behind && mask.update(segmenter, src, t, { model: s.model, smoothing: s.smoothing, still: media.kind !== 'video' });
  if (!haveMask) return;
  const full = mask.full(W, H, { threshold: s.threshold, softness: s.softness, polarity: s.polarity, feather: s.feather * k });

  if (s.showMask) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'source-over';
    const tint = scratch('tbp-tint', W, H);
    const tctx = tint.getContext('2d');
    tctx.globalCompositeOperation = 'source-over';
    tctx.clearRect(0, 0, W, H);
    tctx.drawImage(full, 0, 0);
    tctx.globalCompositeOperation = 'source-in';
    tctx.fillStyle = 'rgba(124,108,255,.85)';
    tctx.fillRect(0, 0, W, H);
    ctx.drawImage(tint, 0, 0);
    ctx.restore();
    return;
  }

  drawPersonCutout(ctx, src, full, 'tbp-person');
}

const isVideo = () => media?.kind === 'video';

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: () => (isVideo() ? media.duration : media ? s.clip : 1),
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `text-behind-${(media?.name || 'clip').replace(/\.[^.]+$/, '')}`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  beforeExport: () => {
    if (!segmenter && !modelError) throw new Error('The segmentation model is still loading. Try again in a moment.');
    mask.prev = null;
  },
  hint: () => (media ? 'Export runs in real time; segmentation happens on every frame.' : ''),
});

canvas.width = 1280; canvas.height = 720;
showIntro();
syncTimeRanges();
ensureFont(s.family, s.weight, () => stage.invalidate());
// Start fetching the model early so it's ready by the time a video is chosen.
loadSegmenter(s.model).then((seg) => { if (s.model === 'general' && !segmenter) segmenter = seg; }).catch(() => {});
