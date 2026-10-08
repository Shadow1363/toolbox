/* Nametag Tracker: blocky player nametags that float above people's heads and follow them, one per person. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, progressModal, TRANSPARENT_HINT } from '/assets/js/lib/exporter.js';
import { outputSize, supportsCanvasFilter } from '/assets/js/lib/canvas.js';
import { h, icon, toast, formatTime } from '/assets/js/lib/dom.js';
import { SEGMENT_MODELS, loadSegmenter } from '/assets/js/lib/vision.js';
import { createPersonMask, drawPersonCutout } from '/assets/js/lib/person-mask.js';
import { smoothTrack, sampleTrack } from '/assets/js/lib/head-tracking.js';
import { detectHeads, assignTracks, applyEdits, trackThumbnails, MAX_PEOPLE } from '/assets/js/lib/multi-track.js';
import { layoutLine, drawLine, ROWS } from './pixel-font.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const debug = document.getElementById('debug');
const dctx = debug.getContext('2d');
const overlay = document.getElementById('overlay');

let media = null;
let det = null;           // detection pass: every head on every frame (detectHeads)
let base = null;          // assignTracks(det): tracks with ids
let edits = [];           // manual swap/merge fixes, applied to `base`
let result = null;        // applyEdits(base, edits): what preview and export draw from
let tracking = false;     // a tracking pass is running
let trackNote = '';       // status shown under the People section
let segmenter = null;     // loaded only when "Hide behind person" is on
let segmenterKey = null;
let lastTags = [];        // geometry of the tags drawn last, for clicking and dragging
let selectedId = 1;
const people = new Map(); // track id → { id, name, enabled, custom, textColor, bgOpacity, size, offsetX, offsetY, smooth, medianSize, coverage, thumb }
const mask = createPersonMask('nt');
const isVideo = () => media?.kind === 'video';
const ID_COLORS = ['#ff5d5d', '#50dc8c', '#5db4ff', '#ffb340', '#c77dff', '#ffe066', '#ff7ac8', '#4de6e6', '#a3e05a', '#ff9466'];

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
const editingEl = h('div', { class: 'nt-editing' });
const listEl = h('div', { class: 'nt-people' });
const fixEl = h('div', { class: 'nt-fix' });
/** Per-person style control ids → the person field (and matching global control) they override. */
const OWN = { pColor: 'textColor', pBg: 'bgOpacity', pSize: 'size', pOffsetX: 'offsetX', pOffsetY: 'offsetY' };

function hasPeople() { return !!result?.tracks.length; }
function selectedPerson() { return people.get(selectedId) || null; }

/* ---------- Controls ---------- */
const panel = createControls(document.getElementById('controls'), [
  { title: 'Username', controls: [
    { type: 'custom', el: editingEl },
    { id: 'name', type: 'text', label: 'Name', value: 'Steve_123', placeholder: 'Steve_123' },
    { id: 'anyText', type: 'toggle', label: 'Allow any text', value: false,
      hint: 'Off: up to 16 letters, digits and _, like real usernames.' },
  ]},
  { title: 'People', showIf: () => !!media, controls: [
    { id: 'peopleMode', type: 'segmented', label: 'How many people', value: 'auto', options: [['auto', 'Everyone'], ['manual', 'Set a number']],
      hint: 'Set a number to keep only the largest faces and ignore people far in the background.' },
    { id: 'peopleCount', type: 'range', label: 'People', min: 1, max: MAX_PEOPLE, value: 2, showIf: (st) => st.peopleMode === 'manual' },
    { type: 'custom', el: statusEl },
    { type: 'custom', el: listEl },
    { type: 'custom', el: fixEl },
    { id: 'separate', type: 'toggle', label: 'Keep tags apart', value: true, hint: 'Nudges overlapping tags apart vertically.' },
  ]},
  { title: 'This person', showIf: () => hasPeople() && !!selectedPerson(), controls: [
    { id: 'pCustom', type: 'toggle', label: 'Own style', value: false, hint: 'Off: this tag uses the shared look, size and position below.' },
    { id: 'pColor', type: 'color', label: 'Text color', value: '#ffffff', showIf: (st) => st.pCustom },
    { id: 'pBg', type: 'range', label: 'Background opacity', min: 0, max: 100, value: 25, format: pct, showIf: (st) => st.pCustom },
    { id: 'pSize', type: 'range', label: 'Size', min: 0.25, max: 4, step: 0.05, value: 1, format: (v) => `${v.toFixed(2)}×`, showIf: (st) => st.pCustom },
    { id: 'pOffsetY', type: 'range', label: 'Height above head', min: -12, max: 40, step: 0.5, value: 3, format: (v) => `${v} px`, showIf: (st) => st.pCustom },
    { id: 'pOffsetX', type: 'range', label: 'Sideways', min: -80, max: 80, step: 0.5, value: 0, format: (v) => `${v} px`, showIf: (st) => st.pCustom },
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
      hint: 'In tag pixels. Drag a tag on the preview to fine-tune.' },
    { id: 'offsetX', type: 'range', label: 'Sideways', min: -80, max: 80, step: 0.5, value: 0, format: (v) => `${v} px` },
    { id: 'tilt', type: 'toggle', label: 'Tilt with head', value: false, hint: 'Off keeps the tag upright, like in the game.' },
    { id: 'inFrame', type: 'toggle', label: 'Keep inside frame', value: true, hint: 'Slides the tag into view when the head is near an edge.' },
  ]},
  { title: 'Tracking', showIf: () => !!media, controls: [
    { id: 'detector', type: 'segmented', label: 'Find heads by', value: 'auto', options: [['auto', 'Face, then body'], ['face', 'Face'], ['body', 'Body']] },
    { id: 'trackFps', type: 'segmented', label: 'Tracking rate', value: '30', options: [['15', '15 / s'], ['30', '30 / s']], showIf: () => isVideo() },
    { id: 'trackRes', type: 'segmented', label: 'Tracking resolution', value: 'full', options: [['full', 'Full'], ['1280', '720p'], ['854', '480p']], showIf: () => isVideo(),
      hint: 'Lower is faster on long or busy videos, but finds small faces less often.' },
    { id: 'smoothing', type: 'range', label: 'Smoothing', min: 0, max: 1, step: 0.05, value: 0.6, format: pct100 },
    { id: 'hold', type: 'range', label: 'Hold when lost', min: 0, max: 2, step: 0.1, value: 0.4, unit: 's', decimals: 1, showIf: () => isVideo() },
    { id: 'fade', type: 'range', label: 'Fade', min: 0.05, max: 1, step: 0.05, value: 0.3, unit: 's', decimals: 2, showIf: () => isVideo() },
    { id: 'debugView', type: 'toggle', label: 'Show tracking overlay', value: false, hint: 'Preview only; never exported.' },
    { type: 'button', text: 'Track again', onClick: () => runTracking() },
  ]},
  { title: 'Depth', showIf: () => !!media, controls: [
    { id: 'behind', type: 'toggle', label: 'Hide behind person', value: false,
      hint: 'Anyone passing in front of a tag (or a hand in front of the head) covers it.' },
    { id: 'model', type: 'select', label: 'Segmentation model', value: 'general', options: Object.entries(SEGMENT_MODELS).map(([k, m]) => [k, m.label]), showIf: (s) => s.behind },
    { id: 'threshold', type: 'range', label: 'Edge threshold', min: 0.1, max: 0.9, step: 0.01, value: 0.5, decimals: 2, showIf: (s) => s.behind },
    { id: 'feather', type: 'range', label: 'Feather', min: 0, max: 20, value: 3, unit: 'px', showIf: (s) => s.behind,
      hint: supportsCanvasFilter ? '' : 'Feather needs canvas filters (not available in this browser).' },
  ]},
  { title: 'Output', controls: [
    { id: 'output', type: 'segmented', label: 'Contents', value: 'video', options: [['video', 'Video + tag'], ['tag', 'Tag only']],
      hint: 'Tag only exports the nametags on a transparent background, ready to overlay in an editor.' },
    { id: 'clip', type: 'range', label: 'Clip length', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1, showIf: () => !isVideo() },
  ]},
], { onChange: (st, id) => {
  if (id === 'name' || id === 'anyText') sanitizeName();
  if (id === 'name') { const p = selectedPerson(); if (p && hasPeople()) { p.name = st.name; renderPeople(); } }
  if (['textColor', 'textOpacity', 'shadow', 'bgOpacity'].includes(id)) panel.set({ preset: '' }, { silent: true });
  if (id === 'pCustom') setOwnStyle(st.pCustom);
  if (OWN[id]) { const p = selectedPerson(); if (p) p[OWN[id]] = st[id]; }
  if (id === 'detector' || id === 'trackFps' || id === 'trackRes') runTracking();
  if (id === 'peopleMode' || id === 'peopleCount') recount();
  if (['smoothing', 'hold', 'fade'].includes(id)) resmooth();
  if (id === 'behind' || id === 'model') { mask.reset(); if (st.behind) initSegmenter(); }
  if (id === 'output') canvas.classList.toggle('checker', st.output === 'tag');
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

/* ---------- People ---------- */
function ensurePeople() {
  for (const tr of result?.tracks || []) {
    if (people.has(tr.id)) continue;
    people.set(tr.id, {
      id: tr.id, name: tr.id === 1 ? s.name : `Player_${tr.id}`, enabled: true, custom: false,
      textColor: s.textColor, bgOpacity: s.bgOpacity, size: s.size, offsetX: s.offsetX, offsetY: s.offsetY,
    });
  }
  if (result?.tracks.length && !result.tracks.some((tr) => tr.id === selectedId)) selectedId = result.tracks[0].id;
}

/** The style a person's tag uses: their own when "Own style" is on, else the shared one. */
function styleOf(p) {
  const own = p?.custom;
  return {
    name: p ? p.name : s.name,
    textColor: own ? p.textColor : s.textColor, bgOpacity: own ? p.bgOpacity : s.bgOpacity,
    size: own ? p.size : s.size, offsetX: own ? p.offsetX : s.offsetX, offsetY: own ? p.offsetY : s.offsetY,
  };
}

function setOwnStyle(on) {
  const p = selectedPerson();
  if (!p) return;
  if (on && !p.custom) Object.assign(p, { textColor: s.textColor, bgOpacity: s.bgOpacity, size: s.size, offsetX: s.offsetX, offsetY: s.offsetY });
  p.custom = on;
  syncPersonPanel();
  renderPeople();
}

function syncPersonPanel() {
  const p = selectedPerson();
  if (!p || !hasPeople()) { renderEditing(); return; }
  panel.set({ name: p.name, pCustom: p.custom, pColor: p.textColor, pBg: p.bgOpacity, pSize: p.size, pOffsetX: p.offsetX, pOffsetY: p.offsetY }, { silent: true });
  renderEditing();
}

function selectPerson(id, { focus = false } = {}) {
  if (!people.has(id)) return;
  selectedId = id;
  syncPersonPanel();
  renderPeople();
  stage.invalidate();
  if (focus) {
    // After the click's own focus handling, which would otherwise move focus back to the page.
    setTimeout(() => { const input = document.getElementById('c-name'); input.focus(); input.select(); });
  }
}

function renderEditing() {
  const p = selectedPerson();
  if (!hasPeople() || !p) { editingEl.replaceChildren(); editingEl.parentElement.hidden = true; return; }
  editingEl.parentElement.hidden = false;
  editingEl.replaceChildren(
    p.thumb ? h('img', { class: 'nt-thumb', src: p.thumb, alt: '' }) : h('span', { class: 'nt-thumb' }),
    h('span', {}, 'Editing ', h('strong', {}, `person ${p.id}`), result.tracks.length > 1 ? '. Click a person on the preview to switch.' : ''));
}

function renderPeople() {
  if (!hasPeople()) { listEl.replaceChildren(); fixEl.replaceChildren(); renderEditing(); return; }
  listEl.replaceChildren(...result.tracks.map((tr) => {
    const p = people.get(tr.id);
    const toggle = h('input', { type: 'checkbox', role: 'switch', 'aria-label': `Show tag for person ${p.id}`, title: 'Show this tag' });
    toggle.checked = p.enabled;
    toggle.addEventListener('click', (e) => e.stopPropagation());
    toggle.addEventListener('change', () => { p.enabled = toggle.checked; stage.invalidate(); renderPeople(); });
    return h('div', {
      class: `nt-person${p.id === selectedId ? ' is-selected' : ''}${p.enabled ? '' : ' is-off'}`, role: 'button', tabindex: '0', 'aria-pressed': String(p.id === selectedId),
      onclick: () => selectPerson(p.id, { focus: true }),
      onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectPerson(p.id, { focus: true }); } },
    },
    p.thumb ? h('img', { class: 'nt-thumb', src: p.thumb, alt: '' }) : h('span', { class: 'nt-thumb' }),
    h('span', { class: 'nt-id', style: `--id:${ID_COLORS[(p.id - 1) % ID_COLORS.length]}` }, p.id),
    h('span', { class: 'nt-person-name' }, h('strong', {}, p.name || '(no name)'), h('small', {}, `${Math.round((p.coverage || 0) * 100)}% of frames${p.custom ? ' · own style' : ''}`)),
    h('label', { class: 'toggle nt-person-toggle', onclick: (e) => e.stopPropagation() }, toggle));
  }));
  renderFix();
  renderEditing();
}

/** Swap / merge tools for fixing identity mistakes from the current frame on. */
function renderFix() {
  const others = result.tracks.filter((tr) => tr.id !== selectedId);
  if (!others.length || !isVideo()) { fixEl.replaceChildren(); return; }
  const pick = h('select', { 'aria-label': 'Other person' }, others.map((tr) => h('option', { value: tr.id }, `Person ${tr.id} · ${people.get(tr.id).name}`)));
  const from = () => Math.min(det.frames.length - 1, Math.round(stage.time * det.fps));
  const act = (op) => {
    edits.push({ op, a: selectedId, b: +pick.value, from: from() });
    rebuild({ thumbs: true });
    toast(op === 'swap' ? `Swapped persons ${selectedId} and ${pick.value} from ${formatTime(stage.time)} on.` : `Merged person ${pick.value} into ${selectedId} from ${formatTime(stage.time)} on.`, 'success');
  };
  fixEl.replaceChildren(
    h('div', { class: 'ctrl-label' }, h('span', {}, 'Fix a mix-up from the current frame on')),
    h('div', { class: 'nt-fix-row' },
      h('span', {}, `Person ${selectedId} and`), pick),
    h('div', { class: 'btn-row' },
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('swap')} Swap`, title: 'They traded tags: swap them from here on', onclick: () => act('swap') }),
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('merge')} Merge`, title: 'They are the same person: move the other track into this one from here on', onclick: () => act('merge') }),
      edits.length ? h('button', { type: 'button', class: 'btn btn-sm btn-ghost', html: `${icon('restart')} Undo fix`, onclick: () => { edits.pop(); rebuild({ thumbs: true }); } }) : null),
    h('div', { class: 'ctrl-hint' }, 'Swap when two people traded tags (e.g. after crossing paths). Merge when one person got two numbers.'));
}

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a video of people',
  onLoad: (m) => {
    media = m;
    const { w, h: hh } = outputSize(m.width, m.height, 1920);
    canvas.width = debug.width = w; canvas.height = debug.height = hh;
    det = base = result = null; edits = [];
    people.clear(); selectedId = 1;
    mask.reset();
    panel.refresh();
    renderPeople();
    stage.reset();
    exportBar.refresh();
    placeDebug();
    runTracking();
  },
  onClear: () => {
    media = null; det = base = result = null; edits = []; people.clear(); selectedId = 1; mask.reset();
    canvas.width = debug.width = 1280; canvas.height = debug.height = 720;
    trackNote = '';
    panel.refresh(); renderPeople(); showTrackStatus(); stage.reset(); exportBar.refresh(); placeDebug(); showIntro();
  },
});

/* ---------- Tracking pass ---------- */
/** Faces asked of the detector: everyone in auto mode, else a couple more than wanted so extras can be dropped. */
const wantedFaces = () => (s.peopleMode === 'auto' ? MAX_PEOPLE : Math.min(MAX_PEOPLE, +s.peopleCount + 2));

let trackRun = 0;
async function runTracking() {
  if (!media) return;
  const run = ++trackRun;
  const ctrl = new AbortController();
  const fps = +s.trackFps;
  const frames = isVideo() ? Math.max(1, Math.round(media.duration * fps)) : 1;
  const long = isVideo() && media.duration > 60;
  const baseMsg = `Downloads the face model (~4 MB) on first use, then checks ${frames.toLocaleString()} frame${frames === 1 ? '' : 's'}. Keep this tab visible.`;
  const modal = progressModal('Tracking people…', () => ctrl.abort(),
    long ? `${baseMsg} This is a long video: a 15 / s rate or a lower tracking resolution is much faster.` : baseMsg);
  tracking = true;
  stage.pause();
  stage.setTransportDisabled(true);
  exportBar.setDisabled(true);
  overlay.hidden = true;
  let warned = false;
  try {
    const out = await detectHeads(media, {
      fps, mode: s.detector, maxPeople: wantedFaces(), maxSide: s.trackRes === 'full' ? 0 : +s.trackRes, signal: ctrl.signal,
      onProgress: (p, { people: n }) => {
        modal.set(p);
        if (!warned && n >= 4) { warned = true; modal.message(`${n} people in view: tracking many faces takes longer. Keep this tab visible.`); }
      },
    });
    if (run !== trackRun) return;
    if (!out) { trackNote = 'cancelled'; return; }
    det = out;
    trackNote = '';
    edits = [];
    base = assignTracks(det, { count: s.peopleMode === 'auto' ? 'auto' : +s.peopleCount });
    modal.phase('Finding faces for the list…', '');
    await rebuild({ thumbs: true });
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
      if (hasPeople()) stage.play().catch(() => {});
    } else modal.close();
  }
}

/** People count changed: re-match the stored detections (no new pass unless more faces are needed). */
function recount() {
  if (!det || tracking) return;
  if (wantedFaces() > det.maxPeople) { runTracking(); return; }
  edits = [];
  base = assignTracks(det, { count: s.peopleMode === 'auto' ? 'auto' : +s.peopleCount });
  rebuild({ thumbs: true });
}

/** base + edits → result, then smoothing, people entries, thumbnails and the panel. */
async function rebuild({ thumbs = false } = {}) {
  result = applyEdits(base, edits);
  ensurePeople();
  resmooth();
  if (thumbs && media) {
    try {
      const map = await trackThumbnails(media, result);
      for (const [id, url] of map) { const p = people.get(id); if (p) p.thumb = url; }
    } catch (err) { console.warn('Thumbnails failed', err); }
  }
  syncPersonPanel();
  renderPeople();
  panel.refresh();
  showTrackStatus();
  exportBar.refresh();
  stage.invalidate();
}

/** Re-smooth every track (cheap: no detection) after a smoothing / hold / fade change. */
function resmooth() {
  if (!result) return;
  for (const tr of result.tracks) {
    const p = people.get(tr.id);
    if (!p) continue;
    p.smooth = smoothTrack({ fps: result.fps, w: result.w, h: result.h, samples: tr.samples },
      { strength: s.smoothing, hold: s.hold, fadeOut: s.fade, fadeIn: Math.min(s.fade, 0.25) });
    const sizes = tr.samples.filter((x) => x.found).map((x) => x.size).sort((a, b) => a - b);
    p.medianSize = sizes.length ? sizes[sizes.length >> 1] : 0.2;
    p.coverage = tr.samples.length ? sizes.length / tr.samples.length : 0;
  }
  showTrackStatus();
}

function showTrackStatus() {
  statusEl.classList.remove('is-warn');
  if (trackNote === 'cancelled') { statusEl.classList.add('is-warn'); statusEl.textContent = 'Tracking was cancelled. Press Track again to place the tags.'; return; }
  if (trackNote === 'error') { statusEl.classList.add('is-warn'); statusEl.textContent = 'The tracking model failed to load.'; return; }
  if (!result) { statusEl.textContent = ''; return; }
  const n = result.tracks.length;
  if (!n) {
    statusEl.classList.add('is-warn');
    statusEl.textContent = 'No one found. Try "Body" tracking, full tracking resolution, or a clip where people are larger and well lit.';
    return;
  }
  const via = { face: 0, pose: 0 };
  let found = 0, total = 0;
  for (const tr of result.tracks) for (const x of tr.samples) { total++; if (x.found) { found++; via[x.via]++; } }
  const share = total ? found / total : 0;
  const seen = det ? Math.max(0, ...det.frames.map((f) => f.length)) : n;
  statusEl.replaceChildren(
    h('strong', {}, `Found ${n} ${n === 1 ? 'person' : 'people'}`),
    h('br'),
    `Heads tracked in ${Math.round(share * 100)}% of frames (${via.face} by face, ${via.pose} by body).`,
    s.peopleMode === 'manual' && seen > n ? ` ${seen - n} smaller ${seen - n === 1 ? 'face' : 'faces'} ignored.` : '',
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
    toast('Could not load the segmentation model, so the tags stay in front.', 'error', 7000);
  }
}

/* ---------- Tag geometry and drawing ---------- */
const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.round(v * f).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

/** A tag at 1 canvas px per tag pixel: box with 1 px padding, optional shadow, text. Cached per name + style. */
const tagCache = new Map();
function tagBitmap(st) {
  const key = [st.name, st.textColor, s.textOpacity, s.shadow, st.bgOpacity].join('|');
  if (tagCache.has(key)) return tagCache.get(key);
  if (tagCache.size > 40) tagCache.clear();
  const line = layoutLine(st.name);
  const w = line.width + 2, hh = ROWS + 2;
  const c = document.createElement('canvas');
  c.width = w; c.height = hh;
  const x = c.getContext('2d');
  x.fillStyle = `rgba(0,0,0,${st.bgOpacity / 100})`;
  x.fillRect(0, 0, w, hh);
  x.globalAlpha = s.textOpacity / 100;
  // Shadow and text go through a layer so a translucent text doesn't show its own shadow through it.
  const layer = document.createElement('canvas');
  layer.width = w; layer.height = hh;
  const lx = layer.getContext('2d');
  if (s.shadow) { lx.fillStyle = shade(st.textColor, 0.25); drawLine(lx, line, 2, 2); }
  lx.fillStyle = st.textColor;
  drawLine(lx, line, 1, 1);
  x.drawImage(layer, 0, 0);
  tagCache.set(key, c);
  return c;
}

/** Where a tag goes for a head (or the centre of the frame when there's no media). */
function tagGeometry(head, W, H, st, medianSize) {
  const k = Math.min(W, H) / 1080;
  const bmp = tagBitmap(st);
  // Tag pixel size: text (8 rows) about 40% of a head width, like the game's proportions.
  const headPx = head ? (s.dynamic ? head.size : medianSize ?? head.size) * H : 0;
  const u = Math.max(0.5, head ? headPx * 0.05 * st.size : 6 * k * st.size);
  const w = bmp.width * u, hh = bmp.height * u;
  const ax = head ? head.x * W : W / 2;
  const ay = head ? head.y * H : H / 2 + hh / 2;
  const angle = head && s.tilt ? head.roll : 0;
  // Tag frame: origin at the head top, x along the tag, y down. Box bottom sits offsetY tag-px above.
  const left = st.offsetX * u - w / 2, top = -st.offsetY * u - hh;
  const g = { bmp, u, w, h: hh, ax, ay, angle, left, top, alpha: head ? head.alpha : 1 };
  if (head && s.inFrame) keepInFrame(g, W, H);
  return g;
}

/** Axis-aligned bounds of a (possibly rotated) tag. */
function tagBounds(g) {
  const c = Math.cos(g.angle), sn = Math.sin(g.angle);
  const xs = [], ys = [];
  for (const [x, y] of [[g.left, g.top], [g.left + g.w, g.top], [g.left, g.top + g.h], [g.left + g.w, g.top + g.h]]) {
    xs.push(g.ax + x * c - y * sn);
    ys.push(g.ay + x * sn + y * c);
  }
  return { x0: Math.min(...xs), x1: Math.max(...xs), y0: Math.min(...ys), y1: Math.max(...ys) };
}

/** Shift the tag's anchor so its (rotated) box stays at least 2 tag px inside the frame. */
function keepInFrame(g, W, H) {
  const m = 2 * g.u, b = tagBounds(g);
  const shift = (lo, hi, size) => (hi - lo > size - 2 * m ? (size - lo - hi) / 2 : lo < m ? m - lo : hi > size - m ? size - m - hi : 0);
  g.ax += shift(b.x0, b.x1, W);
  g.ay += shift(b.y0, b.y1, H);
}

/**
 * Overlapping tags: the lowest tag stays, tags above it move up until they clear it (plus a 1 tag-px gap),
 * or below it when there's no room above (keepInFrame on). Positions change continuously with the heads,
 * so tags slide apart instead of jumping.
 */
function separateTags(tags, H) {
  const placed = [];
  for (const g of tags.slice().sort((a, b) => tagBounds(b).y1 - tagBounds(a).y1)) {
    for (let pass = 0; pass <= tags.length; pass++) {
      const b = tagBounds(g);
      const hit = placed.map(tagBounds).find((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0);
      if (!hit) break;
      const up = b.y1 - hit.y0 + g.u;
      if (s.inFrame && b.y0 - up < 2 * g.u && hit.y1 + g.u + (b.y1 - b.y0) < H) g.ay += hit.y1 - b.y0 + g.u;
      else g.ay -= up;
    }
    placed.push(g);
  }
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
  lastTags = [];

  if (!media) {
    if (!tagOnly) drawDemoBackground(W, H);
    if (s.name) { const g = tagGeometry(null, W, H, styleOf(null)); lastTags = [g]; drawTag(ctx, g); }
    return;
  }
  if (!tagOnly) ctx.drawImage(media.el, 0, 0, W, H);
  if (tracking || !result) return;

  const tags = [];
  for (const tr of result.tracks) {
    const p = people.get(tr.id);
    if (!p?.enabled || !p.name || !p.smooth) continue;
    const head = sampleTrack(p.smooth, t);
    if (!head || head.alpha <= 0.001) continue;
    const g = tagGeometry(head, W, H, styleOf(p), p.medianSize);
    g.id = p.id;
    tags.push(g);
  }
  if (s.separate && tags.length > 1) separateTags(tags, H);
  for (const g of tags) drawTag(ctx, g);
  lastTags = tags;

  // Hide behind person: whatever the mask calls "person" inside a tag's box covers that tag.
  // The mask covers everyone in the frame, so a tag hides behind anyone passing in front of it.
  if (tags.length && s.behind && segmenter && mask.update(segmenter, media.el, t, { model: s.model, smoothing: 0, still: !isVideo() })) {
    const k = Math.min(W, H) / 1080;
    const alpha = mask.full(W, H, { threshold: s.threshold, softness: 0.2, feather: s.feather * k });
    for (const g of tags) {
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

/* ---------- Overlay canvas: selection + tracking debug (never exported) ---------- */
function drawOverlay(t) {
  const W = debug.width, H = debug.height, k = Math.min(W, H) / 1080;
  dctx.clearRect(0, 0, W, H);
  if (!media || !result || tracking) return;
  const q = canvas.width / (canvas.getBoundingClientRect().width || canvas.width);

  // Selected person's tag (only worth showing when there's more than one).
  const sel = result.tracks.length > 1 && lastTags.find((g) => g.id === selectedId);
  if (sel) {
    dctx.save();
    tagPath(dctx, sel, 3 * q);
    dctx.setLineDash([5 * q, 4 * q]);
    dctx.lineWidth = 1.5 * q;
    dctx.strokeStyle = '#ffffff';
    dctx.stroke();
    dctx.restore();
  }
  if (!s.debugView || !det) return;

  const i = Math.min(det.frames.length - 1, Math.round(t * det.fps));
  dctx.lineWidth = 2 * k;
  for (const tr of result.tracks) {
    const p = people.get(tr.id), color = ID_COLORS[(tr.id - 1) % ID_COLORS.length];
    if (!p?.smooth) continue;
    // Smoothed path over the whole clip.
    dctx.strokeStyle = `${color}73`;
    dctx.beginPath();
    let prevSeg = null;
    p.smooth.frames.forEach((f) => {
      if (f.seg < 0) { prevSeg = null; return; }
      if (f.seg !== prevSeg) dctx.moveTo(f.x * W, f.y * H); else dctx.lineTo(f.x * W, f.y * H);
      prevSeg = f.seg;
    });
    dctx.stroke();
    // Raw detection at this frame, labelled with the track id.
    const raw = tr.samples[i];
    if (raw?.found) {
      const size = raw.size * H;
      dctx.strokeStyle = color;
      dctx.setLineDash(raw.via === 'face' ? [] : [6 * k, 4 * k]);
      dctx.strokeRect(raw.x * W - size / 2, raw.y * H, size, size * 1.25);
      dctx.setLineDash([]);
      dctx.font = `700 ${Math.round(22 * k)}px ui-monospace, monospace`;
      dctx.fillStyle = color;
      dctx.fillText(`#${tr.id}`, raw.x * W - size / 2, raw.y * H + size * 1.25 + 24 * k);
    }
    const head = sampleTrack(p.smooth, t);
    if (head) dot(head.x * W, head.y * H, 7 * k, color);
  }
  const inView = det.frames[i]?.length ?? 0;
  const label = `frame ${i + 1}/${det.frames.length} · ${inView} head${inView === 1 ? '' : 's'} detected · dashed = body`;
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

/* ---------- Click to select a person; drag a tag to fine-tune its offset ---------- */
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
const tagAt = (p) => lastTags.slice().reverse().find((g) => hitTag(g, p)) || null;

/** The person whose head is under p (within about one head), or null. */
function personAt(p) {
  if (!result) return null;
  const W = canvas.width, H = canvas.height;
  let best = null, bestD = Infinity;
  for (const tr of result.tracks) {
    const head = sampleTrack(people.get(tr.id)?.smooth, stage.time);
    if (!head || head.alpha <= 0.05) continue;
    const r = head.size * H;
    const d = Math.hypot(p.x - head.x * W, p.y - (head.y * H + r * 0.6)) / r;
    if (d < 1.2 && d < bestD) { best = tr.id; bestD = d; }
  }
  return best;
}

let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (!media) return;
  const p = toCanvas(e);
  const g = tagAt(p);
  if (!g) {
    const id = personAt(p);
    if (id != null) selectPerson(id, { focus: true });
    return;
  }
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  if (g.id != null && g.id !== selectedId) selectPerson(g.id);
  const person = g.id != null ? people.get(g.id) : null;
  const st = styleOf(person);
  drag = { g, start: toTag(g, p), x: st.offsetX, y: st.offsetY, person, moved: false };
  canvas.classList.add('nt-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (!drag) { canvas.classList.toggle('nt-hover', !!media && (!!tagAt(p) || personAt(p) != null)); return; }
  const q = toTag(drag.g, p);
  const snap = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v * 2) / 2));
  const x = snap(drag.x + (q.x - drag.start.x) / drag.g.u, -80, 80), y = snap(drag.y - (q.y - drag.start.y) / drag.g.u, -12, 40);
  if (Math.abs(q.x - drag.start.x) + Math.abs(q.y - drag.start.y) > 3) drag.moved = true;
  // A person with their own style keeps their own offset; everyone else shares the global one.
  if (drag.person?.custom) { Object.assign(drag.person, { offsetX: x, offsetY: y }); panel.set({ pOffsetX: x, pOffsetY: y }, { silent: true }); }
  else panel.set({ offsetX: x, offsetY: y }, { silent: true });
  stage.invalidate();
});
const endDrag = () => {
  if (drag && !drag.moved && drag.person) selectPerson(drag.person.id, { focus: true });
  drag = null;
  canvas.classList.remove('nt-dragging');
};
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
stage.events.addEventListener('tick', (e) => drawOverlay(e.detail.t));

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => {
    const names = (result?.tracks || []).map((tr) => people.get(tr.id)).filter((p) => p?.enabled && p.name).map((p) => p.name);
    const base = !media ? s.name : names.length === 1 ? names[0] : names.length ? 'nametags' : 'nametag';
    return `nametag-${base || 'tag'}${s.output === 'tag' ? '-alpha' : ''}`;
  },
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!result,
  gif: () => !!result,
  png: () => !media || !!result,
  beforeExport: () => {
    if (s.behind && !segmenter) throw new Error('The segmentation model is still loading. Try again in a moment.');
    mask.reset();
  },
  hint: () => [
    media && !result && !tracking ? 'Track the video to place the tags.' : '',
    s.output === 'tag' ? TRANSPARENT_HINT : '',
  ].filter(Boolean).join(' '),
});

function showIntro() {
  overlay.hidden = false;
  overlay.classList.add('is-note');
  overlay.innerHTML = '<div><strong>Style your tag here.</strong> Drop a video on the left and every person in it gets a tag that follows their head.</div>';
}

debug.hidden = false; // selection outline + optional tracking overlay
showIntro();
renderPeople();
placeDebug();
stage.play().catch(() => {});
