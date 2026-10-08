/* Text Behind Person — segment the person and draw text/image layers between the background and the person. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { drawAnimatedText, layoutText, ANIMATIONS, DEFAULT_EASING, EXIT_ANIMATIONS, EXIT_EASING } from '/assets/js/lib/text-anim.js';
import { fontOptions, weightOptions, ensureFont } from '/assets/js/lib/fonts.js';
import { easingOptions, ease, clamp } from '/assets/js/lib/easing.js';
import { outputSize, scratch, supportsCanvasFilter } from '/assets/js/lib/canvas.js';
import { h, icon, toast } from '/assets/js/lib/dom.js';
import { loadMedia, MediaError } from '/assets/js/lib/media.js';
import { SEGMENT_MODELS as MODELS, loadSegmenter, segmentImage } from '/assets/js/lib/vision.js';
import { createPersonMask, drawPersonCutout } from '/assets/js/lib/person-mask.js';
import { createStillMask } from './still-mask.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const handles = document.getElementById('handles');
const hctx = handles.getContext('2d');
const overlay = document.getElementById('overlay');
const transportEl = document.getElementById('transport');
let media = null;
let segmenter = null;     // loaded ImageSegmenter (VIDEO mode) for the current model
let modelError = null;
let stillSeg = null;      // IMAGE-mode high-quality segmenter for photos
let animating = false;    // photos: play the layer animations (export, "Play animation") instead of the still
let previewing = false;   // "Play animation" is running
let exporting = false;

/* ---------- Layers ----------
 * Drawn bottom to top in array order. Layers with `front` go over the person, the rest behind.
 * The panel edits the selected layer: its values are copied into the panel on select and written back on change. */
const TEXT_DEFAULTS = {
  type: 'text', text: 'HELLO', family: 'Anton', weight: '400', size: 380, color: '#ffffff', opacity: 1, uppercase: true,
  letterSpacing: 4, lineHeight: 0.95, posX: 50, posY: 34, align: 'center', rotation: 0, front: false,
  anim: 'rise', easing: 'easeOutQuint', duration: 1.2, delay: 0.3,
  exitAnim: 'stay', exitEasing: 'linear', exitDuration: 0.8, exitEnd: 4,
};
const IMAGE_DEFAULTS = {
  type: 'image', imgWidth: 40, opacity: 1, posX: 50, posY: 40, rotation: 0, front: false,
  imgAnim: 'none', easing: 'easeOutQuint', duration: 1, delay: 0.3,
  imgExit: 'stay', exitEasing: 'easeIn', exitDuration: 0.8, exitEnd: 4,
};
const LAYER_KEYS = new Set([...Object.keys(TEXT_DEFAULTS), ...Object.keys(IMAGE_DEFAULTS)].filter((k) => k !== 'type'));
const IMAGE_ANIMS = [['none', 'None'], ['fade', 'Fade in'], ['slide-up', 'Slide up'], ['slide-left', 'Slide from left'], ['pop', 'Pop'], ['bounce', 'Bounce drop'], ['rise', 'Rise (masked reveal)']];
const IMAGE_EXITS = [['stay', 'None (stay on screen)'], ['cut', 'Cut'], ['fade', 'Fade out'], ['slide-up', 'Slide up'], ['slide-left', 'Slide to right'], ['pop', 'Shrink'], ['bounce', 'Fall away'], ['rise', 'Sink (masked)']];

let nextId = 1;
const newLayer = (defaults, patch = {}) => ({ ...defaults, id: nextId++, endFollows: true, ...patch });
const layers = [newLayer(TEXT_DEFAULTS)];
let selected = layers[0];

function isText() { return selected?.type === 'text'; }
function isImageLayer() { return selected?.type === 'image'; }
function entranceOf(L) { return L.type === 'text' ? L.anim : L.imgAnim; }
function exitOf(L) { return L.type === 'text' ? L.exitAnim : L.imgExit; }
function selectedExit() { return selected ? exitOf(selected) : 'stay'; }
function isVideo() { return media?.kind === 'video'; }
function isPhoto() { return media?.kind === 'image'; }
function hasAnimation() { return layers.some((L) => entranceOf(L) !== 'none' || exitOf(L) !== 'stay'); }

/* ---------- Controls ---------- */
const layersEl = h('div', { class: 'tbp-layers' });
const brushEl = h('div', { class: 'btn-row tbp-brush-actions' });

const panel = createControls(document.getElementById('controls'), [
  { title: 'Layers', controls: [{ type: 'custom', el: layersEl }] },
  { title: 'Text', showIf: () => isText(), controls: [
    { id: 'text', type: 'textarea', label: 'Text', value: 'HELLO', rows: 2 },
    { id: 'family', type: 'select', label: 'Font', value: 'Anton', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Weight', value: '400', options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 40, max: 900, value: 380, unit: 'px', hint: 'Relative to a 1080px frame.' },
    { id: 'color', type: 'color', label: 'Color', value: '#ffffff' },
    { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: true },
    { id: 'letterSpacing', type: 'range', label: 'Letter spacing', min: -20, max: 60, value: 4, unit: 'px' },
    { id: 'lineHeight', type: 'range', label: 'Line height', min: 0.7, max: 1.6, step: 0.05, value: 0.95, decimals: 2 },
  ]},
  { title: 'Image', showIf: () => isImageLayer(), controls: [
    { id: 'imgWidth', type: 'range', label: 'Size', min: 2, max: 200, step: 0.5, value: 40, unit: '%', hint: 'Width as a share of the frame width.' },
    { type: 'button', text: 'Replace image…', onClick: () => pickLayerImage(selected) },
  ]},
  { title: 'Position', showIf: () => !!selected, controls: [
    { id: 'posX', type: 'range', label: 'Horizontal', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'posY', type: 'range', label: 'Vertical', min: 0, max: 100, value: 34, unit: '%' },
    { id: 'rotation', type: 'range', label: 'Rotation', min: -180, max: 180, value: 0, unit: '°', hint: 'Drag the layer, its corners or the round handle on the preview.' },
    { id: 'align', type: 'segmented', label: 'Align', value: 'center', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']], showIf: () => isText() },
    { id: 'opacity', type: 'range', label: 'Opacity', min: 0.1, max: 1, step: 0.01, value: 1, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'front', type: 'toggle', label: 'In front of the person', value: false },
  ]},
  { title: 'Entrance', showIf: () => !!selected, controls: [
    { id: 'anim', type: 'select', label: 'Animation', value: 'rise', options: ANIMATIONS, showIf: () => isText() },
    { id: 'imgAnim', type: 'select', label: 'Animation', value: 'none', options: IMAGE_ANIMS, showIf: () => isImageLayer() },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeOutQuint', options: easingOptions },
    { id: 'duration', type: 'range', label: 'Duration', min: 0.1, max: 4, step: 0.1, value: 1.2, unit: 's', decimals: 1 },
    { id: 'delay', type: 'range', label: 'Start at', min: 0, max: 10, step: 0.1, value: 0.3, unit: 's', decimals: 1 },
  ]},
  { title: 'Exit', showIf: () => !!selected, controls: [
    { id: 'exitAnim', type: 'select', label: 'Animation', value: 'stay', options: EXIT_ANIMATIONS, showIf: () => isText() },
    { id: 'imgExit', type: 'select', label: 'Animation', value: 'stay', options: IMAGE_EXITS, showIf: () => isImageLayer() },
    { id: 'exitEasing', type: 'select', label: 'Easing', value: 'linear', options: easingOptions, showIf: () => !['stay', 'cut'].includes(selectedExit()) },
    { id: 'exitDuration', type: 'range', label: 'Duration', min: 0.1, max: 4, step: 0.1, value: 0.8, unit: 's', decimals: 1, showIf: () => !['stay', 'cut'].includes(selectedExit()) },
    { id: 'exitEnd', type: 'range', label: 'End at', min: 0.1, max: 10, step: 0.01, value: 4, unit: 's', decimals: 1, showIf: () => selectedExit() !== 'stay',
      hint: 'When the layer is fully gone. Defaults to the end of the clip.' },
  ]},
  { title: 'Cutout', controls: [
    { id: 'behind', type: 'toggle', label: 'Person in front of layers', value: true },
    { id: 'model', type: 'select', label: 'Segmentation model', value: 'general', options: Object.entries(MODELS).map(([k, m]) => [k, m.label]), showIf: () => !isPhoto(),
      hint: 'Photos always use the high-quality model.' },
    { id: 'threshold', type: 'range', label: 'Edge threshold', min: 0.1, max: 0.9, step: 0.01, value: 0.5, decimals: 2, hint: 'Higher keeps less of the person; lower keeps more.' },
    { id: 'softness', type: 'range', label: 'Edge softness', min: 0.01, max: 0.6, step: 0.01, value: 0.2, decimals: 2 },
    { id: 'edgeSnap', type: 'toggle', label: 'Snap edges to the photo', value: true, showIf: () => isPhoto(), hint: 'Follows hair and outlines in the photo instead of the blurry model edge.' },
    { id: 'feather', type: 'range', label: 'Feather', min: 0, max: 20, value: 3, unit: 'px', hint: supportsCanvasFilter ? '' : 'Feather needs canvas filters (not available in this browser).' },
    { id: 'smoothing', type: 'range', label: 'Temporal smoothing', min: 0, max: 0.9, step: 0.05, value: 0.4, decimals: 2, hint: 'Blends masks over frames to reduce flicker.', showIf: () => !isPhoto() },
    { id: 'polarity', type: 'segmented', label: 'Mask', value: 'auto', options: [['auto', 'Auto'], ['normal', 'Normal'], ['invert', 'Inverted']] },
    { id: 'showMask', type: 'toggle', label: 'Show mask (debug)', value: false },
  ]},
  { title: 'Refine mask', showIf: () => isPhoto(), controls: [
    { id: 'brush', type: 'segmented', label: 'Brush', value: 'off', options: [['off', 'Off'], ['add', 'Add'], ['erase', 'Erase']],
      hint: 'Paint on the preview to fix hair and edges. Ctrl/⌘+Z undoes, Shift+Ctrl/⌘+Z redoes.' },
    { id: 'brushSize', type: 'range', label: 'Brush size', min: 4, max: 300, value: 60, unit: 'px', showIf: (st) => st.brush !== 'off' },
    { id: 'brushSoft', type: 'range', label: 'Brush softness', min: 0, max: 1, step: 0.05, value: 0.5, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => st.brush !== 'off' },
    { type: 'custom', el: brushEl },
  ]},
  { title: 'Animation', showIf: () => !isVideo(), controls: [
    { id: 'clip', type: 'range', label: 'Clip length', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1, hint: 'Length of the GIF or video made from a photo.' },
    { type: 'button', text: 'Play animation', onClick: () => playAnimation() },
  ]},
], { onChange: (st, id) => {
  if (LAYER_KEYS.has(id) && selected) selected[id] = st[id];
  if (id === 'anim' || id === 'imgAnim') setLayer({ easing: DEFAULT_EASING[st[id]] || 'easeOutQuint' });
  if (id === 'exitAnim' || id === 'imgExit') setLayer({ exitEasing: EXIT_EASING[st[id]] || 'easeIn' });
  if (id === 'exitEnd' && selected) selected.endFollows = st.exitEnd >= clipLength() - 0.01;
  if (id === 'clip') syncTimeRanges();
  if (id === 'text' || id === 'front') renderLayers();
  if (id === 'family' || id === 'weight') ensureFont(st.family, st.weight, () => stage.invalidate());
  if (id === 'model') { segmenter = null; mask.reset(); initModel(); }
  if (id === 'polarity') mask.polarity = null;
  if (id === 'smoothing') mask.prev = null;
  if (['threshold', 'softness', 'polarity', 'edgeSnap'].includes(id)) updateStill();
  if (id === 'brush') { canvas.classList.toggle('tbp-brushing', st.brush !== 'off'); drawHandles(); }
  exportBar.refresh();
  stage.invalidate();
} });

const s = panel.state;

/** Write values to the selected layer and the panel without emitting. */
function setLayer(patch) {
  if (!selected) return;
  Object.assign(selected, patch);
  panel.set(patch, { silent: true });
}

function select(L) {
  selected = L;
  if (L) {
    const patch = {};
    for (const k of LAYER_KEYS) if (k in L) patch[k] = L[k];
    panel.set(patch, { silent: true });
    if (L.type === 'text') ensureFont(L.family, L.weight, () => stage.invalidate());
  } else panel.refresh();
  renderLayers();
  stage.invalidate();
}

/* ---------- Layer list ---------- */
function layerLabel(L) {
  if (L.type === 'image') return L.name || 'Image';
  const line = L.text.split('\n').find((x) => x.trim()) || 'Empty text';
  return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

function renderLayers() {
  const iconBtn = (name, label, onClick, disabled = false) => h('button', {
    type: 'button', class: 'tool-btn tbp-mini', 'aria-label': label, title: label, html: icon(name), disabled,
    onclick: (e) => { e.stopPropagation(); onClick(); },
  });
  const rows = layers.slice().reverse().map((L) => {
    const i = layers.indexOf(L);
    return h('div', {
      class: `tbp-layer${L === selected ? ' is-selected' : ''}`, role: 'button', tabindex: '0', 'aria-pressed': String(L === selected),
      onclick: () => select(L), onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(L); } },
    },
    L.type === 'image' && L.img
      ? h('img', { class: 'tbp-thumb', src: L.img.src, alt: '' })
      : h('span', { class: 'tbp-thumb tbp-thumb-text' }, 'T'),
    h('span', { class: 'tbp-layer-name' }, layerLabel(L), L.front ? h('small', {}, ' · in front') : null),
    iconBtn('up', 'Bring forward', () => moveLayer(L, 1), i === layers.length - 1),
    iconBtn('down', 'Send backward', () => moveLayer(L, -1), i === 0),
    iconBtn('trash', 'Delete layer', () => removeLayer(L)));
  });
  layersEl.replaceChildren(
    rows.length ? h('div', { class: 'tbp-layer-list' }, rows) : h('p', { class: 'ctrl-hint' }, 'No layers. Add text or an image.'),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('plus')} Add text`, onclick: addTextLayer }),
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('image')} Add image`, onclick: () => pickLayerImage(null) })),
    h('p', { class: 'ctrl-hint' }, 'The top of the list is drawn on top. Images can be PNGs with transparency.'));
}

function moveLayer(L, dir) {
  const i = layers.indexOf(L), j = i + dir;
  if (j < 0 || j >= layers.length) return;
  [layers[i], layers[j]] = [layers[j], layers[i]];
  renderLayers();
  stage.invalidate();
}

function removeLayer(L) {
  const i = layers.indexOf(L);
  if (i < 0) return;
  layers.splice(i, 1);
  L.media?.dispose();
  select(L === selected ? layers[Math.min(i, layers.length - 1)] || null : selected);
  exportBar.refresh();
}

function addTextLayer() {
  const L = newLayer(TEXT_DEFAULTS, { text: 'TEXT', size: 220, posY: Math.min(85, 34 + 14 * (layers.filter((x) => x.type === 'text').length % 4)) });
  layers.push(L);
  syncTimeRanges();
  select(L);
  exportBar.refresh();
}

/** Pick an image file for a new layer (target null) or to replace a layer's image. */
function pickLayerImage(target) {
  const input = h('input', { type: 'file', accept: 'image/*,.heic,.heif' });
  input.addEventListener('change', async () => {
    const file = input.files[0];
    if (!file) return;
    try {
      const m = await loadMedia(file, { accept: ['image'] });
      if (target && layers.includes(target)) {
        target.media?.dispose();
        Object.assign(target, { img: m.el, media: m, name: file.name });
        renderLayers();
      } else {
        const L = newLayer(IMAGE_DEFAULTS, { img: m.el, media: m, name: file.name });
        layers.push(L);
        syncTimeRanges();
        select(L);
      }
      exportBar.refresh();
      stage.invalidate();
    } catch (err) {
      if (!(err instanceof MediaError)) console.error(err);
      toast(err.message || 'Could not open that image.', 'error', 7000);
    }
  });
  input.click();
}

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a video or photo of a person',
  onLoad: (m) => {
    media = m;
    const { w, h: hh } = outputSize(m.width, m.height, m.kind === 'image' ? 4096 : 1920);
    canvas.width = w; canvas.height = hh;
    mask.reset();
    still.reset();
    animating = previewing = false;
    if (s.brush !== 'off') panel.set({ brush: 'off' });
    transportEl.hidden = m.kind === 'image';
    syncTimeRanges();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    renderBrushButtons();
    overlay.hidden = true;
    if (m.kind === 'image') detectStill();
    else if (segmenter) stage.play().catch(() => {});
    else initModel();
  },
  onClear: () => {
    media = null; mask.reset(); still.reset(); animating = previewing = false;
    transportEl.hidden = false;
    canvas.width = 1280; canvas.height = 720;
    syncTimeRanges(); panel.refresh(); stage.reset(); exportBar.refresh(); showIntro();
  },
});

/* ---------- Timing ---------- */
function clipLength() { return isVideo() ? media.duration : s.clip; }

// "End at" tracks the end of the clip (per layer) until the user moves it somewhere else.
function syncTimeRanges() {
  const len = clipLength();
  for (const id of ['delay', 'exitEnd']) document.getElementById(`c-${id}`).max = len;
  for (const L of layers) {
    L.delay = Math.min(L.delay, len);
    if (L.endFollows || L.exitEnd > len) L.exitEnd = len;
  }
  if (selected) panel.set({ delay: selected.delay, exitEnd: selected.exitEnd }, { silent: true }); // also repaints the sliders
}

/* ---------- Model loading (video) ---------- */
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
    if (!isPhoto()) overlay.hidden = true;
    stage.invalidate();
    if (isVideo()) stage.play().catch(() => {});
  } catch (err) {
    console.error(err);
    modelError = err;
    showStatus('<strong>Could not load the segmentation model.</strong><br>Check your connection or content blockers, then pick the model again. The preview shows the layers without the cutout.');
    toast('Segmentation model failed to load.', 'error', 7000);
  } finally {
    if (loadingKey === key) loadingKey = null;
  }
}

/* ---------- Photo: segment once with the best model, then refine by hand ---------- */
const still = createStillMask('tbp');

async function detectStill() {
  const m = media;
  showStatus('<div class="spinner"></div>Detecting person…<br><small>The first photo downloads the high-quality model (~16 MB), then it\'s cached.</small>');
  try {
    stillSeg ||= await loadSegmenter('quality', { mode: 'IMAGE' });
    if (media !== m) return;
    await new Promise((r) => setTimeout(r, 30)); // let the status paint before the (blocking) model run
    const raw = segmentImage(stillSeg, m.el, 'quality');
    if (!raw) throw new Error('The segmenter returned no mask.');
    still.setSource(m.el, raw);
    updateStill();
    overlay.hidden = true;
  } catch (err) {
    console.error(err);
    if (media !== m) return;
    showStatus('<strong>Could not detect the person.</strong><br>Check your connection or content blockers, then drop the photo again. The preview shows the layers without the cutout.');
    toast('Person detection failed.', 'error', 7000);
  }
  renderBrushButtons();
  stage.invalidate();
}

function updateStill() {
  if (!still.ready) return;
  still.update({ threshold: s.threshold, softness: s.softness, polarity: s.polarity, edgeSnap: s.edgeSnap });
  stage.invalidate();
}

function renderBrushButtons() {
  const btn = (label, ic, onClick, enabled) => h('button', { type: 'button', class: 'btn btn-sm', html: `${icon(ic)} ${label}`, disabled: !enabled, onclick: onClick });
  brushEl.replaceChildren(
    btn('Undo', 'restart', () => { still.undo(); afterEdit(); }, still.canUndo),
    btn('Redo', 'arrow', () => { still.redo(); afterEdit(); }, still.canRedo),
    btn('Reset edits', 'trash', () => { still.clearEdits(); afterEdit(); }, still.edited));
}
function afterEdit() { renderBrushButtons(); stage.invalidate(); drawHandles(); }

function playAnimation() {
  if (!isPhoto() || exporting) return;
  previewing = animating = true;
  stage.seek(0);
  stage.play({ loop: false }).catch(() => {});
}

function showStatus(html) {
  overlay.classList.remove('is-note');
  overlay.hidden = false;
  overlay.innerHTML = `<div>${html}</div>`;
}
function showIntro() {
  showStatus('<strong>Drop a video or photo of a person on the left.</strong><br>The person is detected in your browser and your text and images are placed behind them.');
}

/* ---------- Mask pipeline for video (shared: lib/person-mask.js) ---------- */
const mask = createPersonMask('tbp');

/* ---------- Rendering ---------- */
function textOptions(L, W, H, k, animated) {
  return {
    text: L.text, family: L.family, weight: L.weight, size: L.size * k, color: L.color,
    align: L.align, uppercase: L.uppercase, letterSpacing: L.letterSpacing * k, lineHeight: L.lineHeight,
    x: (L.posX / 100) * W, y: (L.posY / 100) * H,
    ...(animated
      ? { anim: L.anim, duration: L.duration, delay: L.delay, easing: L.easing,
        exit: { anim: L.exitAnim, easing: L.exitEasing, duration: L.exitDuration, end: L.exitEnd } }
      : { anim: 'none', delay: 0 }),
  };
}

const imageSize = (L, W) => {
  const w = (L.imgWidth / 100) * W;
  return { w, h: L.img ? w * (L.img.naturalHeight / L.img.naturalWidth) : w };
};

/** An image layer centred on the origin (the caller has translated/rotated), with its entrance/exit. */
function drawImageLayer(c, L, t, W, H, animated) {
  if (!L.img) return;
  const { w, h: ih } = imageSize(L, W);
  let anim = 'none', p = 1, dir = 1, e = 1;
  if (animated) {
    const lt = t - L.delay;
    const ex = L.imgExit;
    if (ex !== 'stay' && t >= L.exitEnd) return;
    const exDur = ex === 'cut' ? 0 : Math.max(0.01, L.exitDuration);
    if (ex !== 'stay' && exDur > 0 && t >= L.exitEnd - exDur) {
      anim = ex; dir = -1;
      p = 1 - clamp((t - (L.exitEnd - exDur)) / exDur);
      e = 1 - ease(L.exitEasing, 1 - p);
    } else {
      anim = L.imgAnim;
      if (lt < 0 && anim !== 'none') return;
      p = clamp(lt / Math.max(0.01, L.duration));
      e = ease(L.easing, p);
    }
  }
  const y0 = (L.posY / 100) * H;
  switch (anim) {
    case 'fade': c.globalAlpha *= clamp(e); break;
    case 'slide-up': c.globalAlpha *= clamp(p * 1.6); c.translate(0, (1 - e) * ih * 0.5 * dir); break;
    case 'slide-left': c.globalAlpha *= clamp(p * 1.6); c.translate(-(1 - e) * (w * 0.6 + 40) * dir, 0); break;
    case 'pop': c.globalAlpha *= clamp(p * 4); c.scale(Math.max(0.001, e), Math.max(0.001, e)); break;
    case 'bounce': c.translate(0, (1 - e) * (dir > 0 ? -(y0 + ih) : H - y0 + ih)); break;
    case 'rise': c.beginPath(); c.rect(-w / 2 - 2, -ih / 2 - 2, w + 4, ih + 4); c.clip(); c.translate(0, (1 - e) * ih * 1.05 * dir); break;
    default: break;
  }
  c.drawImage(L.img, -w / 2, -ih / 2, w, ih);
}

function drawLayer(c, L, t, W, H, k, animated) {
  const x = (L.posX / 100) * W, y = (L.posY / 100) * H;
  c.save();
  c.globalAlpha = L.opacity;
  c.translate(x, y);
  c.rotate((L.rotation * Math.PI) / 180);
  if (L.type === 'text') { c.translate(-x, -y); drawAnimatedText(c, textOptions(L, W, H, k, animated), t); }
  else drawImageLayer(c, L, t, W, H, animated);
  c.restore();
}

/** Full-size person alpha for this frame, or null (no cutout). */
function personAlpha(t, W, H, k) {
  if (!s.behind) return null;
  if (isPhoto()) return still.ready ? still.full(W, H, s.feather * k) : null;
  if (!mask.update(segmenter, media.el, t, { model: s.model, smoothing: s.smoothing })) return null;
  return mask.full(W, H, { threshold: s.threshold, softness: s.softness, polarity: s.polarity, feather: s.feather * k });
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!media) { ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, W, H); return; }
  const k = Math.min(W, H) / 1080;
  const src = media.el;
  const animated = isVideo() || animating;

  // 1. background (the original frame), 2. layers behind the person
  ctx.drawImage(src, 0, 0, W, H);
  for (const L of layers) if (!L.front) drawLayer(ctx, L, t, W, H, k, animated);

  // 3. person on top, cut out with the mask
  const full = personAlpha(t, W, H, k);
  if (full && s.showMask) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, 0, W, H);
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
  if (full) drawPersonCutout(ctx, src, full, 'tbp-person');

  // 4. layers in front of the person
  for (const L of layers) if (L.front) drawLayer(ctx, L, t, W, H, k, animated);
}

/* ---------- On-canvas editing: move, resize, rotate; brush on photos ---------- */
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
};
/** Canvas px per CSS px, so handles keep their on-screen size. */
const pxScale = () => canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
const brushActive = () => isPhoto() && still.ready && s.brush !== 'off';

/** A layer's box in its final (settled) state: centre, size and rotation in canvas px. */
function layerBox(L) {
  const W = canvas.width, H = canvas.height, k = Math.min(W, H) / 1080;
  const cx = (L.posX / 100) * W, cy = (L.posY / 100) * H, rot = (L.rotation * Math.PI) / 180;
  if (L.type === 'image') { const { w, h: ih } = imageSize(L, W); return { cx, cy, w, h: ih, rot }; }
  ctx.save();
  const lay = layoutText(ctx, textOptions(L, W, H, k, false));
  ctx.restore();
  return { cx, cy, w: Math.max(lay.width, L.size * k * 0.3), h: lay.height, rot };
}
const toLocal = (b, p) => {
  const dx = p.x - b.cx, dy = p.y - b.cy, c = Math.cos(-b.rot), sn = Math.sin(-b.rot);
  return { x: dx * c - dy * sn, y: dx * sn + dy * c };
};
const rotKnob = (b, q) => ({ x: 0, y: -b.h / 2 - 8 * q - 26 * q });

/** What's under p: a handle of the selected layer, or the top-most layer. */
function hitTest(p) {
  const q = pxScale(), r = 11 * q, pad = 8 * q;
  if (selected) {
    const b = layerBox(selected), l = toLocal(b, p);
    const kn = rotKnob(b, q);
    if (Math.hypot(l.x - kn.x, l.y - kn.y) <= r) return { kind: 'rotate', layer: selected };
    for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      if (Math.hypot(l.x - sx * (b.w / 2 + pad), l.y - sy * (b.h / 2 + pad)) <= r) return { kind: 'scale', layer: selected };
    }
  }
  const order = [...layers.filter((L) => !L.front), ...layers.filter((L) => L.front)].reverse();
  for (const L of order) {
    const b = layerBox(L), l = toLocal(b, p);
    if (Math.abs(l.x) <= b.w / 2 + pad && Math.abs(l.y) <= b.h / 2 + pad) return { kind: 'move', layer: L };
  }
  return null;
}

let drag = null, stroke = null, pointer = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!media || exporting || previewing) return;
  const p = toCanvas(e);
  if (brushActive()) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const f = still.width / canvas.width, k = Math.min(canvas.width, canvas.height) / 1080;
    still.beginStroke(s.brush, (s.brushSize * k * f) / 2, s.brushSoft);
    still.strokeTo(p.x * f, p.y * f);
    stroke = { f };
    stage.invalidate();
    return;
  }
  const hit = hitTest(p);
  if (!hit) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  if (hit.layer !== selected) select(hit.layer);
  const b = layerBox(selected);
  drag = { kind: hit.kind, b, start: p, L: { posX: selected.posX, posY: selected.posY, size: selected.size, imgWidth: selected.imgWidth, rotation: selected.rotation } };
  canvas.classList.add('tbp-dragging');
});

canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  pointer = p;
  if (stroke) { still.strokeTo(p.x * stroke.f, p.y * stroke.f); stage.invalidate(); return; }
  if (brushActive()) { drawHandles(); return; }
  if (!drag) {
    const hit = media && !exporting ? hitTest(p) : null;
    canvas.style.cursor = !hit ? '' : hit.kind === 'move' ? 'move' : hit.kind === 'rotate' ? 'grab' : 'nwse-resize';
    return;
  }
  const { b, start, L } = drag;
  const W = canvas.width, H = canvas.height;
  let patch;
  if (drag.kind === 'move') {
    const snap = (v) => (Math.abs(v - 50) < 0.8 ? 50 : Math.round(v * 10) / 10);
    patch = { posX: snap(clamp(L.posX + ((p.x - start.x) / W) * 100, 0, 100)), posY: snap(clamp(L.posY + ((p.y - start.y) / H) * 100, 0, 100)) };
  } else if (drag.kind === 'scale') {
    const f = Math.hypot(p.x - b.cx, p.y - b.cy) / Math.max(1, Math.hypot(start.x - b.cx, start.y - b.cy));
    patch = selected.type === 'text' ? { size: Math.round(clamp(L.size * f, 40, 900)) } : { imgWidth: Math.round(clamp(L.imgWidth * f, 2, 200) * 2) / 2 };
  } else {
    const a0 = Math.atan2(start.y - b.cy, start.x - b.cx), a1 = Math.atan2(p.y - b.cy, p.x - b.cx);
    let deg = L.rotation + ((a1 - a0) * 180) / Math.PI;
    deg = ((deg + 540) % 360) - 180;
    deg = e.shiftKey ? Math.round(deg / 15) * 15 : Math.abs(deg) < 3 ? 0 : Math.round(deg);
    patch = { rotation: deg };
  }
  setLayer(patch);
  stage.invalidate();
});

const endPointer = () => {
  if (stroke) { still.endStroke(); stroke = null; afterEdit(); }
  if (drag) { drag = null; canvas.classList.remove('tbp-dragging'); }
};
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('pointerleave', () => { pointer = null; if (brushActive()) drawHandles(); });

document.addEventListener('keydown', (e) => {
  if (!brushActive() || !(e.ctrlKey || e.metaKey) || e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  const key = e.key.toLowerCase();
  if (key === 'z' && !e.shiftKey) { e.preventDefault(); still.undo(); afterEdit(); }
  else if ((key === 'z' && e.shiftKey) || key === 'y') { e.preventDefault(); still.redo(); afterEdit(); }
});

/** Selection handles, or the brush cursor + mask tint. A separate canvas, so no export includes them. */
function drawHandles() {
  const W = canvas.width, H = canvas.height;
  if (handles.width !== W || handles.height !== H) { handles.width = W; handles.height = H; }
  hctx.clearRect(0, 0, W, H);
  if (!media || exporting || previewing) return;
  const q = pxScale();
  if (brushActive()) {
    const tint = scratch('tbp-brush-tint', still.width, still.height);
    const tx = tint.getContext('2d');
    tx.globalCompositeOperation = 'source-over';
    tx.clearRect(0, 0, tint.width, tint.height);
    tx.drawImage(still.canvas, 0, 0);
    tx.globalCompositeOperation = 'source-in';
    tx.fillStyle = 'rgb(124,108,255)';
    tx.fillRect(0, 0, tint.width, tint.height);
    hctx.globalAlpha = 0.45;
    hctx.drawImage(tint, 0, 0, W, H);
    hctx.globalAlpha = 1;
    if (pointer) {
      const k = Math.min(W, H) / 1080, r = (s.brushSize * k) / 2;
      hctx.lineWidth = 1.5 * q;
      hctx.strokeStyle = 'rgba(0,0,0,.6)';
      hctx.beginPath(); hctx.arc(pointer.x, pointer.y, r + q, 0, Math.PI * 2); hctx.stroke();
      hctx.strokeStyle = s.brush === 'add' ? '#ffffff' : '#ff6b6b';
      hctx.beginPath(); hctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2); hctx.stroke();
    }
    return;
  }
  if (!selected) return;
  const b = layerBox(selected), pad = 8 * q;
  const hw = b.w / 2 + pad, hh = b.h / 2 + pad, kn = rotKnob(b, q);
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

/* ---------- Stage + export ---------- */
const stage = createStage({
  canvas,
  transport: transportEl,
  render,
  getDuration: () => (isVideo() ? media.duration : s.clip),
  getVideo: () => (isVideo() ? media.el : null),
});
stage.events.addEventListener('tick', () => drawHandles());
stage.events.addEventListener('ended', () => {
  if (!previewing) return;
  previewing = animating = false;
  stage.seek(0);
});

let savedSize = null;
const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `text-behind-${(media?.name || 'clip').replace(/\.[^.]+$/, '')}`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media && (isVideo() || hasAnimation()),
  gif: () => !!media && (isVideo() || hasAnimation()),
  png: () => !!media,
  beforeExport: (kind) => {
    if (isVideo() && s.behind && !segmenter && !modelError) throw new Error('The segmentation model is still loading. Try again in a moment.');
    if (isPhoto() && s.behind && !still.ready) throw new Error('Still detecting the person. Try again in a moment.');
    mask.prev = null;
    exporting = true;
    drawHandles();
    if (isPhoto()) {
      previewing = false;
      animating = true;
      // Photos preview at full resolution; video encoders want at most 1920 px.
      if (kind === 'video' && Math.max(canvas.width, canvas.height) > 1920) {
        savedSize = [canvas.width, canvas.height];
        const { w, h: hh } = outputSize(canvas.width, canvas.height, 1920);
        canvas.width = w; canvas.height = hh;
      }
    }
  },
  afterExport: () => {
    exporting = false;
    if (savedSize) { [canvas.width, canvas.height] = savedSize; savedSize = null; }
    if (isPhoto()) { animating = false; stage.pause(); stage.seek(0); }
    stage.invalidate();
  },
  hint: () => {
    if (!media) return '';
    if (isVideo()) return 'Export runs in real time; segmentation happens on every frame.';
    return hasAnimation()
      ? 'PNG saves the full-resolution still. GIF and video play the layer animations over the photo.'
      : 'PNG saves the full-resolution still. Add an entrance or exit animation to export a GIF or video.';
  },
});

canvas.width = 1280; canvas.height = 720;
renderLayers();
renderBrushButtons();
showIntro();
syncTimeRanges();
ensureFont(s.family, s.weight, () => stage.invalidate());
// Start fetching the model early so it's ready by the time a video is chosen.
loadSegmenter(s.model).then((seg) => { if (s.model === 'general' && !segmenter) segmenter = seg; }).catch(() => {});
