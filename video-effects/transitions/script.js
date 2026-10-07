/* Cinematic Transitions: join clips with WebGL transitions, preview each one live, export WebM / GIF / PNG. */
import { createControls } from '/assets/js/lib/controls.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, progressModal, canRecord } from '/assets/js/lib/exporter.js';
import { loadMedia, seekVideo, audioGraph, mixTrack, setPreviewMuted, LIMITS, MediaError } from '/assets/js/lib/media.js';
import { loadGifenc, quantizeFrame, gifDelay } from '/assets/js/lib/gif.js';
import { scratch, fit } from '/assets/js/lib/canvas.js';
import { ease, cubicBezier } from '/assets/js/lib/easing.js';
import { loadFontStylesheet } from '/assets/js/lib/fonts.js';
import { h, icon, toast, downloadBlob, formatBytes, formatTime } from '/assets/js/lib/dom.js';
import { createEngine } from './engine.js';
import { buildTimeline, slotWindow, frameAt, activeClips, drawClip, clipLength, slotDuration } from './sequence.js';
import { sampleFrame } from './samples.js';
import { openGallery } from './gallery.js';
import { getTransition } from './transitions/index.js';
import { defaultsOf } from './transitions/_common.js';

const SIZES = { '16:9': [1920, 1080], '9:16': [1080, 1920], '1:1': [1080, 1080], '4:5': [1080, 1350] };
const EASINGS = [['linear', 'Linear'], ['easeInOut', 'Ease in-out'], ['easeInOutExpo', 'Expo'], ['easeInOutBack', 'Back'], ['custom', 'Custom bezier']];
// New cuts cycle through a few showcase transitions so a fresh sequence isn't all the same.
const SHOWCASE = ['zoom-through', 'whip-pan', 'zoom-through-text', 'iris', 'glitch', 'light-leak', 'shrink-to-card', 'spin'];
const NOT_RANDOM = new Set(['text', 'font', 'weight', 'size', 'spacing', 'textColor', 'letter', 'cx', 'cy', 'color', 'bg', 'ringColor', 'bandColor']);
const GIF_WARN_FRAMES = 180;

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const engine = createEngine();

/* ---------- Model ---------- */
let nextId = 1;
let clips = [];      // { id, kind, name, media, trimIn, trimOut, duration, kenBurns, fit, volume, thumb, demo }
let cuts = [];       // slot between clips[i] and clips[i + 1]
let intro = newSlot('cut');
let outro = newSlot('cut');
let selected = { kind: 'slot', slot: 0 };
let previewMode = 'selection';
let tl = buildTimeline([], [], intro, outro);
let previewMuted = false;
let audioReady = false;

function newSlot(type) {
  const tr = getTransition(type);
  return {
    type,
    duration: tr?.duration ?? 0.8,
    easing: tr?.easing ?? 'easeInOut',
    bezier: '0.7, 0, 0.3, 1',
    params: tr ? defaultsOf(tr.params) : {},
    slotColor: '#000000',
  };
}

function setSlotType(slot, type) {
  const fresh = newSlot(type);
  Object.assign(slot, { type, duration: fresh.duration, easing: fresh.easing, params: fresh.params });
}

const slotObj = (key) => (key === 'intro' ? intro : key === 'outro' ? outro : cuts[key]);
const isVideo = (c) => c.kind === 'video';
const realClips = () => clips.filter((c) => !c.demo);
function fitOf(c) { return c.fit === 'default' ? s.fit : c.fit; }

function makeClip(media, extra = {}) {
  const c = {
    id: nextId++, kind: media.kind, name: media.name, media,
    trimIn: 0, trimOut: media.kind === 'video' ? media.duration : 0,
    duration: s.imageDuration, kenBurns: 'off', fit: 'default', volume: 1, ...extra,
  };
  c.thumb = h('canvas', { width: 160, height: 90 });
  const r = fit(media.width, media.height, 160, 90, 'cover');
  c.thumb.getContext('2d').drawImage(media.el, r.x, r.y, r.w, r.h);
  if (isVideo(c)) media.el.addEventListener('seeked', () => stage.invalidate());
  return c;
}

function loadDemo() {
  clips = ['A', 'B'].map((w, i) => {
    const el = sampleFrame(w, 1920, 1080);
    return makeClip({ kind: 'image', el, width: 1920, height: 1080, name: `Sample ${w}`, dispose() {} },
      { demo: true, duration: 2.6, kenBurns: i ? 'out' : 'in' });
  });
  cuts = [newSlot('zoom-through-text')];
  selected = { kind: 'slot', slot: 0 };
}

/* ---------- Controls: output + export settings ---------- */
const panel = createControls(document.getElementById('controls'), [
  { title: 'Output', controls: [
    { id: 'size', type: 'segmented', label: 'Aspect ratio', value: '16:9', options: Object.keys(SIZES).map((k) => [k, k]) },
    { id: 'fit', type: 'segmented', label: 'Clips with another shape', value: 'blur',
      options: [['fit', 'Fit'], ['fill', 'Fill'], ['blur', 'Blurred fill']] },
    { id: 'bg', type: 'color', label: 'Letterbox color', value: '#000000', showIf: (st) => st.fit === 'fit' },
    { id: 'imageDuration', type: 'range', label: 'New image length', min: 0.5, max: 10, step: 0.1, value: 2, unit: 's', decimals: 1,
      hint: 'Applies to images you add next. Change one image in its clip settings.' },
  ]},
  { title: 'GIF', controls: [
    { id: 'gifFps', type: 'segmented', label: 'Frame rate', value: '15', options: [['10', '10'], ['12', '12'], ['15', '15'], ['20', '20']] },
    { id: 'gifScale', type: 'range', label: 'Scale', min: 20, max: 100, step: 5, value: 40, unit: '%', hint: 'WebM and PNG are always full size.' },
  ]},
], { onChange: (st, id) => { if (id === 'size') resize(); changed(); } });
const s = panel.state;

/* ---------- Upload (several files at once) ---------- */
const fileInput = h('input', { type: 'file', accept: 'video/*,image/*', multiple: true, 'aria-label': 'Add clips' });
const zone = h('div', { class: 'dropzone tr-drop', tabindex: '-1' },
  h('span', { html: icon('upload'), style: 'display:contents' }),
  h('strong', {}, 'Drop clips here'),
  h('span', {}, `or click to browse · videos up to ${formatBytes(LIMITS.video)}, images up to ${formatBytes(LIMITS.image)}`),
  fileInput);
document.getElementById('upload').append(zone);
fileInput.addEventListener('change', () => { addFiles([...fileInput.files]); fileInput.value = ''; });
['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
zone.addEventListener('drop', (e) => addFiles([...e.dataTransfer.files]));

async function addFiles(files) {
  if (!files.length) return;
  zone.setAttribute('aria-busy', 'true');
  let added = 0;
  for (const file of files) {
    try {
      const media = await loadMedia(file);
      if (clips.some((c) => c.demo)) { clips = []; cuts = []; }
      if (clips.length) cuts.push(newSlot(SHOWCASE[cuts.length % SHOWCASE.length]));
      const c = makeClip(media);
      clips.push(c);
      if (audioReady && isVideo(c)) routeAudio(c);
      added++;
    } catch (err) {
      if (!(err instanceof MediaError)) console.error(err);
      toast(err.message || `Could not open ${file.name}.`, 'error', 7000);
    }
  }
  zone.removeAttribute('aria-busy');
  if (!added) return;
  selected = cuts.length ? { kind: 'slot', slot: cuts.length - 1 } : { kind: 'clip', id: clips[clips.length - 1].id };
  if (clips.length === 1) toast('Add another clip to put a transition between them, or use the In / Out slots.');
  changed({ editor: true });
  stage.seek(0);
  stage.play().catch(() => {});
}

function removeClip(id) {
  const i = clips.findIndex((c) => c.id === id);
  if (i < 0) return;
  const [c] = clips.splice(i, 1);
  if (isVideo(c)) c.media.el.pause();
  c.media.dispose();
  if (cuts.length) cuts.splice(Math.min(i, cuts.length - 1), 1);
  if (!clips.length) loadDemo();
  else selected = clips[i] ? { kind: 'clip', id: clips[i].id } : { kind: 'clip', id: clips[clips.length - 1].id };
  changed({ editor: true });
}

function moveClip(from, to) {
  to = Math.max(0, Math.min(clips.length - 1, to));
  if (from === to) return;
  const [c] = clips.splice(from, 1);
  clips.splice(to, 0, c);
  changed({ editor: true });
}

/* ---------- Audio ----------
 * Clips play through Web Audio so the export can record a mix. The graph can only be
 * created after a user gesture, so it's set up on the first click anywhere on the page. */
function routeAudio(c) {
  const g = audioGraph(c.media.el);
  if (g) { g.ctx.resume(); setPreviewMuted(c.media.el, previewMuted); }
}
function ensureAudio() {
  if (audioReady) return;
  audioReady = true;
  clips.filter(isVideo).forEach(routeAudio);
}
document.addEventListener('pointerdown', ensureAudio, { capture: true, once: true });

function setLevel(c, v) {
  if (!audioReady) return;
  const g = audioGraph(c.media.el);
  if (g) g.level.gain.value = Math.max(0, Math.min(1, v));
}

/* ---------- Timing ---------- */
function easeSlot(slot, t) {
  if (slot.easing !== 'custom') return ease(slot.easing, t);
  const n = String(slot.bezier).split(/[\s,]+/).map(Number).filter((v) => !Number.isNaN(v));
  if (n.length !== 4) return ease('easeInOut', t);
  const x = (v) => Math.min(1, Math.max(0, v));
  return cubicBezier(x(n[0]), n[1], x(n[2]), n[3])(t);
}

/** Part of the sequence the preview plays: the selected transition ±1 s, the selected clip, or everything. */
function previewRange() {
  if (previewMode === 'full' || !clips.length) return { start: 0, len: tl.total };
  if (selected.kind === 'clip') {
    const i = clips.findIndex((c) => c.id === selected.id);
    if (i >= 0) return { start: tl.starts[i], len: tl.lens[i] };
    return { start: 0, len: tl.total };
  }
  const w = slotWindow(tl, selected.slot);
  const start = Math.max(0, w.start - 1);
  const end = Math.min(tl.total, w.start + w.d + 1);
  return { start, len: Math.max(0.1, end - start) };
}

/* ---------- Rendering ---------- */
/** Draw the sequence at time t into any 2D context. Preview, PNG, WebM and GIF all use this. */
function renderAt(c2d, t, { sync = false } = {}) {
  const W = c2d.canvas.width, H = c2d.canvas.height;
  if (sync) syncVideos(t);
  const f = frameAt(tl, t);
  if (!f) { c2d.fillStyle = '#000'; c2d.fillRect(0, 0, W, H); return; }
  if (f.kind === 'clip') { drawClip(c2d, clips[f.i], f.local, fitOf(clips[f.i]), s.bg); return; }
  const slot = slotObj(f.slot);
  const tr = getTransition(slot.type);
  const A = sideFrame(f.a, slot, `A-${W}x${H}`, W, H);
  const B = sideFrame(f.b, slot, `B-${W}x${H}`, W, H);
  if (!tr) { c2d.drawImage(f.raw < 0.5 ? A : B, 0, 0); return; }
  engine.render(c2d, tr, A, B, {
    p: easeSlot(slot, f.raw), raw: f.raw, params: slot.params,
    duration: slotWindow(tl, f.slot).d, refresh: () => stage.invalidate(),
  });
}

function sideFrame(side, slot, name, W, H) {
  const c = scratch(`tr-side-${name}`, W, H);
  const x = c.getContext('2d');
  if (side.color) { x.fillStyle = slot.slotColor; x.fillRect(0, 0, W, H); }
  else drawClip(x, clips[side.i], side.local, fitOf(clips[side.i]), s.bg);
  return c;
}

/** Keep every video element at the right time for t: play, pre-roll, pause, and set its volume. */
function syncVideos(t) {
  const playing = stage.playing;
  const live = new Map(activeClips(tl, t).map((a) => [a.i, a.local]));
  const f = frameAt(tl, t);
  clips.forEach((c, i) => {
    if (!isVideo(c)) return;
    const v = c.media.el;
    if (!live.has(i)) {
      if (!v.paused) v.pause();
      setLevel(c, 0);
      // Pre-roll: park the next clip on its first frame so it's ready when it comes in.
      const until = tl.starts[i] - t;
      if (until > 0 && until < 1.5 && !v.seeking && Math.abs(v.currentTime - c.trimIn) > 0.05) v.currentTime = c.trimIn;
      return;
    }
    const target = Math.min(c.trimIn + live.get(i), c.media.duration - 0.03);
    if (playing) {
      if (v.paused) {
        if (Math.abs(v.currentTime - target) > 0.05) v.currentTime = target;
        v.play().catch(() => {});
      } else if (!v.seeking && Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (!v.seeking && Math.abs(v.currentTime - target) > 0.02) v.currentTime = target;
    }
    let level = 1;
    if (f?.kind === 'transition') {
      if (f.a.i === i) level = 1 - f.raw;
      else if (f.b.i === i) level = f.raw;
    }
    setLevel(c, c.volume * level);
  });
}

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render: (t) => renderAt(ctx, previewRange().start + t, { sync: true }),
  getDuration: () => previewRange().len,
});

function resize() {
  const [W, H] = SIZES[s.size];
  canvas.width = W; canvas.height = H;
}

/** Something changed: rebuild timing, timeline and (optionally) the editor. */
function changed({ editor = false } = {}) {
  tl = buildTimeline(clips, cuts, intro, outro);
  renderTimeline();
  if (editor) buildEditor();
  else refreshEditorNote();
  overlay.hidden = !clips.some((c) => c.demo);
  stage.invalidate();
  exportBar.refresh();
  updateMarker();
  updateToolbar();
  scheduleEstimate();
}

/* ---------- Preview toolbar ---------- */
const modeBtns = [['selection', 'Selection'], ['full', 'Full sequence']].map(([v, label]) => {
  const b = h('button', { type: 'button', 'data-v': v }, label);
  b.addEventListener('click', () => { previewMode = v; stage.seek(0); changed(); stage.play().catch(() => {}); });
  return b;
});
const nowLabel = h('span', { class: 'tr-now' });
const muteBtn = h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': 'Mute preview' });
muteBtn.addEventListener('click', () => {
  previewMuted = !previewMuted;
  clips.filter(isVideo).forEach((c) => setPreviewMuted(c.media.el, previewMuted));
  updateToolbar();
});
document.getElementById('toolbar').append(
  h('div', { class: 'segmented tr-mode', role: 'group', 'aria-label': 'Preview' }, modeBtns), nowLabel, muteBtn);

function updateToolbar() {
  modeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === previewMode)));
  muteBtn.innerHTML = icon(previewMuted ? 'mute' : 'volume');
  muteBtn.hidden = !clips.some(isVideo);
  nowLabel.textContent = previewMode === 'full' ? `${formatTime(tl.total)} total` : selectionLabel();
}

function selectionLabel() {
  if (selected.kind === 'clip') {
    const c = clips.find((x) => x.id === selected.id);
    return c ? `Clip: ${c.name}` : '';
  }
  const slot = slotObj(selected.slot);
  const name = slot.type === 'cut' ? (typeof selected.slot === 'number' ? 'Hard cut' : 'None') : getTransition(slot.type).name;
  return `${slotTitle(selected.slot)}: ${name}`;
}

function slotTitle(key) {
  if (key === 'intro') return 'Intro';
  if (key === 'outro') return 'Outro';
  return `Clip ${key + 1} → ${key + 2}`;
}

/* ---------- Click the preview to set a transition's center ---------- */
const marker = h('div', { class: 'tr-marker', hidden: true });
document.querySelector('.preview-stage').append(marker);

function centerTarget() {
  if (selected.kind !== 'slot') return null;
  const slot = slotObj(selected.slot);
  const tr = getTransition(slot.type);
  return tr?.pickCenter ? slot : null;
}

canvas.addEventListener('click', (e) => {
  const slot = centerTarget();
  if (!slot) return;
  const r = canvas.getBoundingClientRect();
  const cx = +Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)).toFixed(3);
  const cy = +Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)).toFixed(3);
  Object.assign(slot.params, { cx, cy });
  editor?.set({ cx, cy }, { silent: true });
  changed();
});

function updateMarker() {
  const slot = centerTarget();
  canvas.classList.toggle('is-picking', !!slot);
  marker.hidden = !slot;
  if (!slot) return;
  const stageEl = marker.parentElement.getBoundingClientRect();
  const r = canvas.getBoundingClientRect();
  marker.style.left = `${r.left - stageEl.left + slot.params.cx * r.width}px`;
  marker.style.top = `${r.top - stageEl.top + slot.params.cy * r.height}px`;
}
window.addEventListener('resize', updateMarker);

/* ---------- Timeline ---------- */
const strip = document.getElementById('timeline');

function renderTimeline() {
  const items = [slotButton('intro')];
  clips.forEach((c, i) => {
    items.push(clipCard(c, i));
    if (i < clips.length - 1) items.push(slotButton(i));
  });
  items.push(slotButton('outro'));
  const add = h('button', { type: 'button', class: 'tr-add', 'aria-label': 'Add clips', html: `${icon('upload')}<span>Add</span>` });
  add.addEventListener('click', () => fileInput.click());
  items.push(add);
  strip.replaceChildren(...items);
}

function slotButton(key) {
  const slot = slotObj(key);
  const edge = typeof key !== 'number';
  const tr = getTransition(slot.type);
  const isSel = selected.kind === 'slot' && selected.slot === key;
  let label = tr ? tr.name : edge ? (key === 'intro' ? 'In' : 'Out') : 'Cut';
  const lens = tl.lens;
  const d = edge
    ? (key === 'intro' ? tl.introD : tl.outroD)
    : tl.cutD[key];
  const b = h('button', {
    type: 'button',
    class: `tr-slot${isSel ? ' is-selected' : ''}${tr ? '' : ' is-empty'}${edge ? ' is-edge' : ''}`,
    title: `${slotTitle(key)}: ${tr ? tr.name : 'none'}. Click to edit.`,
    'aria-pressed': String(isSel),
  }, h('span', { class: 'tr-slot-name' }, label), tr && h('span', { class: 'tr-slot-dur' }, `${d.toFixed(1)}s`));
  b.addEventListener('click', () => select({ kind: 'slot', slot: key }));
  b.addEventListener('dblclick', () => pickTransition(key));
  if (!lens.length) b.disabled = true;
  return b;
}

let suppressClick = false;
function clipCard(c, i) {
  const isSel = selected.kind === 'clip' && selected.id === c.id;
  const thumb = h('canvas', { width: 160, height: 90, 'aria-hidden': 'true' });
  thumb.getContext('2d').drawImage(c.thumb, 0, 0);
  const remove = h('button', { type: 'button', class: 'tr-clip-remove', 'aria-label': `Remove ${c.name}`, html: icon('x') });
  remove.addEventListener('click', (e) => { e.stopPropagation(); removeClip(c.id); });
  const card = h('div', {
    class: `tr-clip${isSel ? ' is-selected' : ''}`, tabindex: '0', role: 'button', 'aria-pressed': String(isSel),
    title: `${c.name}. Drag to reorder.`,
  },
  h('div', { class: 'tr-clip-thumb' }, thumb, h('span', { class: 'tr-grip', html: icon('grip') }), c.demo ? null : remove),
  h('div', { class: 'tr-clip-meta' },
    h('span', { class: 'tr-clip-name' }, c.demo ? c.name : c.name.replace(/\.[^.]+$/, '')),
    h('span', { class: 'tr-clip-len' }, `${clipLength(c).toFixed(1)}s`)));
  card.addEventListener('click', () => { if (!suppressClick) select({ kind: 'clip', id: c.id }); });
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select({ kind: 'clip', id: c.id }); }
    if (e.altKey && e.key === 'ArrowLeft') moveClip(i, i - 1);
    if (e.altKey && e.key === 'ArrowRight') moveClip(i, i + 1);
  });
  card.addEventListener('pointerdown', (e) => startDrag(e, card, i));
  return card;
}

/* Drag to reorder. Mouse drags from anywhere on the card; touch only from the grip so the strip still scrolls. */
function startDrag(e, card, i) {
  if (e.button !== 0 || e.target.closest('.tr-clip-remove')) return;
  if (e.pointerType !== 'mouse' && !e.target.closest('.tr-grip')) return;
  const startX = e.clientX;
  let dragging = false;
  let target = i;
  card.setPointerCapture(e.pointerId);
  const cards = () => [...strip.querySelectorAll('.tr-clip')];
  const move = (ev) => {
    const dx = ev.clientX - startX;
    if (!dragging && Math.abs(dx) > 6) { dragging = true; card.classList.add('is-dragging'); }
    if (!dragging) return;
    card.style.transform = `translateX(${dx}px)`;
    const others = cards().filter((o) => o !== card);
    target = others.filter((o) => { const r = o.getBoundingClientRect(); return r.left + r.width / 2 < ev.clientX; }).length;
    others.forEach((o, j) => {
      o.classList.toggle('drop-before', j === target);
      o.classList.toggle('drop-after', target === others.length && j === others.length - 1);
    });
  };
  const end = () => {
    card.removeEventListener('pointermove', move);
    card.removeEventListener('pointerup', end);
    card.removeEventListener('pointercancel', end);
    if (!dragging) return;
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    moveClip(i, target);
    renderTimeline();
  };
  card.addEventListener('pointermove', move);
  card.addEventListener('pointerup', end);
  card.addEventListener('pointercancel', end);
}

function select(sel) {
  selected = sel;
  if (previewMode === 'selection') stage.seek(0);
  changed({ editor: true });
  if (previewMode === 'selection') stage.play().catch(() => {});
}

/* ---------- Editor (selected clip or transition) ---------- */
const editorRoot = document.getElementById('editor');
let editor = null;
let editorNote = null;

function buildEditor() {
  editorRoot.replaceChildren();
  editor = null;
  editorNote = null;
  if (selected.kind === 'clip') buildClipEditor();
  else buildSlotEditor();
}

function pickTransition(key) {
  const slot = slotObj(key);
  openGallery({
    current: slot.type,
    ease: (name, t) => ease(name, t),
    onPick: (id) => {
      setSlotType(slot, id);
      selected = { kind: 'slot', slot: key };
      if (previewMode === 'selection') stage.seek(0);
      changed({ editor: true });
      stage.play().catch(() => {});
    },
  });
}

function buildSlotEditor() {
  const key = selected.slot;
  const slot = slotObj(key);
  if (!slot) return;
  const tr = getTransition(slot.type);
  const edge = typeof key !== 'number';
  const pick = h('button', { type: 'button', class: 'btn tr-pick' },
    h('span', {}, tr ? tr.name : edge ? 'None' : 'Hard cut'), h('span', { class: 'tr-pick-more' }, 'Change…'));
  pick.addEventListener('click', () => pickTransition(key));
  editorNote = h('div', { class: 'ctrl-hint' });

  const head = [
    { type: 'custom', el: pick },
    tr && { id: '_preset', type: 'select', label: 'Preset', value: '',
      options: [['', 'Choose a preset…'], ...tr.presets.map((p, i) => [String(i), p.label])] },
    tr && { type: 'button', text: 'Randomize', label: 'Randomize', onClick: () => randomize(slot, tr) },
    tr && { id: 'duration', type: 'range', label: 'Duration', min: 0.2, max: tr.maxDuration || 2, step: 0.05, value: slot.duration, unit: 's' },
    tr && { id: 'easing', type: 'select', label: 'Easing', value: slot.easing, options: EASINGS },
    tr && { id: 'bezier', type: 'text', label: 'Bezier (x1, y1, x2, y2)', value: slot.bezier, placeholder: '0.7, 0, 0.3, 1',
      showIf: (st) => st.easing === 'custom' },
    edge && { id: 'slotColor', type: 'color', label: key === 'intro' ? 'Fade in from' : 'Fade out to', value: slot.slotColor },
    { type: 'custom', el: editorNote },
  ].filter(Boolean);

  const sections = [{ title: `${slotTitle(key)}`, controls: head }];
  if (tr && tr.params.length) {
    sections.push({
      title: tr.name,
      controls: [
        ...tr.params.map((c) => ({ ...c, value: slot.params[c.id] ?? c.value })),
        tr.pickCenter && { type: 'custom', el: h('div', { class: 'ctrl-hint' }, 'Tip: click the preview to set the center.') },
      ].filter(Boolean),
    });
  }
  if (edge && !tr) {
    head.splice(1, 0, { type: 'custom', el: h('div', { class: 'ctrl-hint' },
      `Pick a transition to ${key === 'intro' ? 'bring the first clip in from' : 'take the last clip out to'} a solid color.`) });
  }

  editor = createControls(editorRoot, sections, {
    onChange: (st, id) => {
      if (id === '_preset') {
        const p = tr.presets[+st._preset];
        if (!p) return;
        Object.assign(slot.params, p.params);
        if (p.duration) slot.duration = p.duration;
        if (p.easing) slot.easing = p.easing;
        changed({ editor: true });
        return;
      }
      if (['duration', 'easing', 'bezier', 'slotColor'].includes(id)) slot[id] = st[id];
      else if (id) slot.params[id] = st[id];
      changed();
    },
  });
  refreshEditorNote();
}

function randomize(slot, tr) {
  for (const c of tr.params) {
    if (!c.id || NOT_RANDOM.has(c.id)) continue;
    if (c.type === 'range') {
      const steps = Math.round((c.max - c.min) / (c.step || 1));
      slot.params[c.id] = +(c.min + Math.round(Math.random() * steps) * (c.step || 1)).toFixed(4);
    } else if (c.type === 'segmented' || c.type === 'select') {
      slot.params[c.id] = c.options[Math.floor(Math.random() * c.options.length)][0];
    } else if (c.type === 'toggle') slot.params[c.id] = Math.random() < 0.5;
  }
  slot.easing = EASINGS[Math.floor(Math.random() * 4)][0];
  changed({ editor: true });
}

/** "Shortened to fit" note when a clip is too short for the chosen duration. */
function refreshEditorNote() {
  if (!editorNote || selected.kind !== 'slot') return;
  const slot = slotObj(selected.slot);
  const d = selected.slot === 'intro' ? tl.introD : selected.slot === 'outro' ? tl.outroD : tl.cutD[selected.slot];
  editorNote.textContent = slot.type !== 'cut' && d + 0.01 < slot.duration
    ? `Plays for ${d.toFixed(2)}s: a transition can use at most 45% of each clip it touches.` : '';
  editorNote.hidden = !editorNote.textContent;
}

function buildClipEditor() {
  const i = clips.findIndex((c) => c.id === selected.id);
  const c = clips[i];
  if (!c) return;
  const v = isVideo(c);
  const info = `${c.media.width}×${c.media.height}${v ? ` · ${c.media.duration.toFixed(1)}s` : ''}${c.media.size ? ` · ${formatBytes(c.media.size)}` : ''}`;
  const moves = h('div', { class: 'tr-move' },
    h('button', { type: 'button', class: 'btn btn-sm', disabled: i === 0, onclick: () => moveClip(i, i - 1) }, '← Move left'),
    h('button', { type: 'button', class: 'btn btn-sm', disabled: i === clips.length - 1, onclick: () => moveClip(i, i + 1) }, 'Move right →'),
    !c.demo && h('button', { type: 'button', class: 'btn btn-sm btn-ghost', onclick: () => removeClip(c.id) }, 'Remove'));
  editor = createControls(editorRoot, [{
    title: `Clip ${i + 1}`,
    controls: [
      { type: 'custom', el: h('div', { class: 'tr-clip-info' }, h('strong', {}, c.name), h('span', {}, info)) },
      v && { id: 'trimIn', type: 'range', label: 'Trim in', min: 0, max: c.media.duration, step: 0.05, value: c.trimIn, unit: 's' },
      v && { id: 'trimOut', type: 'range', label: 'Trim out', min: 0, max: c.media.duration, step: 0.05, value: c.trimOut, unit: 's' },
      v && { id: 'volume', type: 'range', label: 'Volume', min: 0, max: 1, step: 0.05, value: c.volume, format: (x) => `${Math.round(x * 100)}%` },
      !v && { id: 'duration', type: 'range', label: 'Duration', min: 0.5, max: 10, step: 0.1, value: c.duration, unit: 's', decimals: 1 },
      !v && { id: 'kenBurns', type: 'segmented', label: 'Slow zoom (Ken Burns)', value: c.kenBurns,
        options: [['off', 'Off'], ['in', 'In'], ['out', 'Out'], ['left', '←'], ['right', '→']] },
      { id: 'fit', type: 'select', label: 'Framing', value: c.fit,
        options: [['default', 'Same as output'], ['fit', 'Fit'], ['fill', 'Fill'], ['blur', 'Blurred fill']] },
      { type: 'custom', el: moves },
    ].filter(Boolean),
  }], {
    onChange: (st, id) => {
      if (id === 'trimIn' && st.trimIn > c.trimOut - 0.3) editor.set({ trimIn: Math.max(0, c.trimOut - 0.3) }, { silent: true });
      if (id === 'trimOut' && st.trimOut < c.trimIn + 0.3) editor.set({ trimOut: Math.min(c.media.duration, c.trimIn + 0.3) }, { silent: true });
      c[id] = st[id];
      changed();
    },
  });
}

/* ---------- Export ---------- */
let estimateText = '';
let estimateTimer = 0;
const nextTick = () => new Promise((r) => setTimeout(r, 0));
const gifSize = () => {
  const sc = s.gifScale / 100;
  return [Math.max(2, Math.round((canvas.width * sc) / 2) * 2), Math.max(2, Math.round((canvas.height * sc) / 2) * 2)];
};
const gifFrames = () => Math.max(1, Math.round(tl.total * +s.gifFps));

function confirmModal(title, message, ok = 'Continue') {
  return new Promise((resolve) => {
    const done = (v) => { modal.remove(); resolve(v); };
    const modal = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'modal' }, h('h2', {}, title), h('p', {}, message),
        h('div', { class: 'modal-actions' },
          h('button', { type: 'button', class: 'btn', onclick: () => done(false) }, 'Cancel'),
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => done(true) }, ok))));
    document.body.append(modal);
    modal.querySelector('.btn-primary').focus();
  });
}

/** Seek every clip that's on screen at t and wait for the frames. */
async function seekClips(t) {
  await Promise.all(activeClips(tl, t).map(({ i, local }) => {
    const c = clips[i];
    return isVideo(c) ? seekVideo(c.media.el, Math.min(c.trimIn + local, c.media.duration - 0.03)) : null;
  }));
}

async function exportGif(btn) {
  const n = gifFrames();
  if (n > GIF_WARN_FRAMES) {
    const go = await confirmModal('That is a long GIF',
      `${tl.total.toFixed(1)}s at ${s.gifFps} fps is ${n} frames (${estimateText || 'large'}). GIFs this long get big and slow. WebM is much smaller. Lower the frame rate or scale, or continue anyway.`,
      'Export GIF anyway');
    if (!go) return;
  }
  let cancelled = false;
  const modal = progressModal('Encoding GIF…', () => { cancelled = true; }, 'Seeking each frame and compressing it. This can take a while for long sequences.');
  btn.disabled = true;
  stage.pause();
  clips.filter(isVideo).forEach((c) => c.media.el.pause());
  try {
    const lib = await loadGifenc();
    const [gw, gh] = gifSize();
    const gc = scratch(`tr-gif-${gw}x${gh}`, gw, gh);
    const gctx = gc.getContext('2d', { willReadFrequently: true });
    const gif = lib.GIFEncoder();
    let written = 0; // ms; GIF delays are 10 ms steps, so carry the rounding error forward
    for (let i = 0; i < n; i++) {
      if (cancelled) return toast('GIF export cancelled.');
      const t = Math.min(tl.total - 0.001, i / +s.gifFps);
      await seekClips(t);
      renderAt(gctx, t);
      const { index, palette } = quantizeFrame(lib, gctx, gw, gh);
      const delay = gifDelay(((i + 1) * 1000) / +s.gifFps - written);
      written += delay;
      gif.writeFrame(index, gw, gh, { palette, delay, repeat: 0 });
      modal.set((i + 1) / n);
      await nextTick();
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: 'image/gif' });
    downloadBlob(blob, 'transitions.gif');
    toast(`Saved GIF (${formatBytes(blob.size)})`, 'success');
  } catch (err) {
    console.error(err);
    toast(err.message || 'GIF export failed.', 'error', 7000);
  } finally {
    modal.close();
    btn.disabled = false;
    stage.invalidate();
  }
}

let savedMode = null;
const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => 'transitions',
  getAudio: () => (clips.some(isVideo) ? (ensureAudio(), mixTrack(clips.filter(isVideo).map((c) => c.media.el))) : null),
  hasAudio: () => clips.some(isVideo),
  onGif: exportGif,
  hint: () => estimateText,
  beforeExport: () => { savedMode = previewMode; previewMode = 'full'; stage.invalidate(); },
  afterExport: () => { previewMode = savedMode || 'selection'; stage.seek(0); changed(); },
});

/* ---------- Size estimate ---------- */
function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(async () => {
    const parts = [`${tl.total.toFixed(1)}s`];
    if (canRecord()) {
      const bps = Math.min(20e6, Math.max(4e6, canvas.width * canvas.height * 30 * 0.12));
      parts.push(`WebM up to ${formatBytes((bps / 8) * tl.total)}`);
    }
    try {
      const lib = await loadGifenc();
      const [gw, gh] = gifSize();
      const ec = scratch('tr-estimate', gw, gh);
      const ex = ec.getContext('2d', { willReadFrequently: true });
      ex.drawImage(canvas, 0, 0, gw, gh);
      const gif = lib.GIFEncoder();
      const { index, palette } = quantizeFrame(lib, ex, gw, gh);
      gif.writeFrame(index, gw, gh, { palette });
      gif.finish();
      const n = gifFrames();
      parts.push(`GIF ≈ ${formatBytes(gif.bytes().length * n * 0.9)} (${n} frames${n > GIF_WARN_FRAMES ? ', long' : ''})`);
    } catch { /* offline: skip the GIF estimate */ }
    estimateText = parts.join(' · ');
    exportBar.refresh();
  }, 800);
}

/* ---------- Start ---------- */
if (!engine.webgl) toast('WebGL is unavailable, so transitions use a simpler Canvas 2D fallback.', 'warning', 7000);
loadFontStylesheet();
loadDemo();
resize();
changed({ editor: true });
stage.play().catch(() => {});
