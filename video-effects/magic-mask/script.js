/*
 * Magic Mask Transition: the subject stays on top while the scene changes behind them.
 *
 * Three layers, back to front:
 *   bottom  clip B (the new shot), revealed as the wipe moves
 *   middle  clip A (the old shot), wiped away by a moving edge (wipe.js: straight edge, circle or a Shape Crop shape)
 *   top     the subject cut out of the mask clip (A by default; B makes the new subject appear first, in front
 *           of the old scene), through lib/object-mask.js + lib/mask-panel.js
 * So the wipe passes behind the subject. With the mask from A, the subject then leaves: cut, fade, or hold until
 * A's footage ends (they walk out on their own).
 *
 * Timeline (output seconds): A plays from 0 to lenA; B starts at T0 = lenA − overlap and plays to the end; the wipe
 * runs from T0 for `wipeDur`. The stage runs on the wall clock; syncVideos() plays, parks and drift-corrects both
 * videos (GIF export seeks them exactly in prepareFrame). The masking pass covers only the overlap of the mask clip.
 *
 * Guided flow (no clicks besides uploading): drop both clips at once (or one, then the other; upload order = A, B,
 * Swap flips them) → autoSetup(): transition at the end of A, person masks over the overlap only (no person: the
 * most prominent object, salientPoint() → a SAM click; that failing: ask for a click), a diagonal wipe that follows
 * the subject → the transition plays on a loop. Everything else sits in the collapsed Adjust sections.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { fit, outputSize, scratch, roundRectPath } from '/assets/js/lib/canvas.js';
import { seekVideo, mixTrack, loadMedia, MediaError } from '/assets/js/lib/media.js';
import { h, icon, toast, formatTime } from '/assets/js/lib/dom.js';
import { ease, easingOptions, clamp } from '/assets/js/lib/easing.js';
import { createPerspective, projectRect } from '/assets/js/lib/perspective.js';
import { createMaskTrack } from '/assets/js/lib/object-mask.js';
import { createMaskPanel } from '/assets/js/lib/mask-panel.js';
import { SHAPES, getShape } from '/video-effects/shape-crop/shapes/index.js';
import { WIPE_KINDS, wipeGeometry, drawRemain, drawEdgeGlow, sidePoints } from './wipe.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const marks = document.getElementById('marks');
const overlay = document.getElementById('overlay');
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

const clips = { A: null, B: null };
let syncHeld = false; // the masking pass is seeking the mask clip
let setupRun = 0;     // bumps on every auto setup, so a stale one stops
let setup = { state: 'idle', text: '', action: null }; // auto setup status: idle | busy | ready | needs-click | error
let exported = false;
let persp = null;
const shapePaths = new Map();

const track = createMaskTrack('mm');
const maskClip = () => clips[s?.maskFrom || 'A'];
const mp = createMaskPanel({
  track, canvas, marks,
  sourceRect: () => coverRect(maskClip()),
  getTime: () => srcTime(s.maskFrom, stage.time),
  getRange: () => maskRange(),
  seek: (srcT) => stage.seek(s.maskFrom === 'A' ? srcT - inOf('A') : srcT - inOf('B') + T0()),
  pause: () => stage.pause(),
  onBusy: (b) => { syncHeld = b; },
  mode: 'person',
  autoRun: false,
  showPoints: () => !!panel?.section('adjust')?.open || setup.state === 'needs-click',
  hidden: () => exporting || s.view !== 'combined',
  onChange: () => { stage.invalidate(); clickedReady(); syncNote(); exportBar?.refresh(); },
});
let exporting = false;

/** After "click the subject": offer Track subject right in the status, then call it done once the overlap is masked. */
function clickedReady() {
  if (setup.state !== 'needs-click' || !track.hasPoints) return;
  if (track.staleCount()) {
    if (!setup.action) setStatus('needs-click', 'Selected. Add more clicks if needed, then track it through the transition.', { label: 'Track subject', run: () => mp.run() });
    return;
  }
  if (!subjectFound()) return;
  setStatus('ready', `Ready: your selection stays on top while the wipe reveals clip B at ${formatTime(T0())}.`);
  playLoop();
}

/* ---------- Panel ---------- */
const isVid = (k) => clips[k]?.kind === 'video';
const panel = createControls(document.getElementById('controls'), [
  {
    title: 'Preview',
    controls: [
      { id: 'loop', type: 'toggle', label: 'Loop the transition', value: true, hint: 'Plays the moment around the wipe over and over. Exports always use the whole sequence.' },
    ],
  },
  {
    id: 'adjust',
    title: 'Adjust',
    collapsed: true,
    controls: [
      { type: 'subhead', label: 'Wipe' },
      { id: 'wipe', type: 'segmented', label: 'Style', value: 'line', options: WIPE_KINDS },
      { id: 'shape', type: 'select', label: 'Shape', value: 'star', options: SHAPES.map((x) => [x.id, x.name]), showIf: (st) => st.wipe === 'shape' },
      { id: 'angle', type: 'range', label: 'Direction', min: 0, max: 359, value: 35, unit: '°', showIf: (st) => st.wipe === 'line', hint: '0° moves right, 90° moves down.' },
      { id: 'wipeDur', type: 'range', label: 'Duration', min: 0.2, max: 6, step: 0.05, value: 1.2, unit: 's', decimals: 2, hint: 'Starts with the overlap; never longer than it.' },
      { id: 'easing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions },
      { id: 'follow', type: 'range', label: 'Follow subject', min: 0, max: 1, step: 0.05, value: 0.6, format: (v) => `${Math.round(v * 100)}%`, hint: 'The edge travels with the subject, as if they push the new scene in.' },
      { id: 'feather', type: 'range', label: 'Edge feather', min: 0, max: 200, value: 30, unit: 'px' },
      { id: 'glow', type: 'toggle', label: 'Glowing edge line', value: false },
      { id: 'glowColor', type: 'color', label: 'Glow color', value: '#ffffff', showIf: (st) => st.glow },
      { id: 'glowWidth', type: 'range', label: 'Glow width', min: 1, max: 30, value: 6, unit: 'px', showIf: (st) => st.glow },
      { type: 'subhead', label: 'Subject' },
      { id: 'maskFrom', type: 'segmented', label: 'Mask source', value: 'A', options: [['A', 'Clip A'], ['B', 'Clip B']], hint: 'A: the subject stays from the old shot (classic). B: the new subject appears first, in front of the old scene.' },
      { id: 'exit', type: 'segmented', label: 'Subject exit', value: 'fade', options: [['cut', 'Cut'], ['fade', 'Fade'], ['hold', 'Hold']], showIf: (st) => st.maskFrom === 'A', hint: 'Hold keeps them until clip A ends, so they can walk out of frame.' },
      { id: 'enter', type: 'segmented', label: 'Subject appears', value: 'cut', options: [['cut', 'Cut'], ['fade', 'Fade in']], showIf: (st) => st.maskFrom === 'B' },
      { id: 'fadeDur', type: 'range', label: 'Fade length', min: 0.1, max: 2, step: 0.05, value: 0.4, unit: 's', decimals: 2, showIf: (st) => (st.maskFrom === 'A' ? st.exit === 'fade' : st.enter === 'fade') },
      ...mp.sections[0].controls,
    ],
  },
  {
    title: 'Timing',
    collapsed: true,
    controls: [
      { id: 'aIn', type: 'range', label: 'A starts at', min: 0, max: 60, step: 0.05, value: 0, unit: 's', decimals: 2, showIf: () => isVid('A') },
      { id: 'aOut', type: 'range', label: 'A ends at', min: 0, max: 60, step: 0.05, value: 4, unit: 's', decimals: 2, showIf: () => isVid('A') },
      { id: 'aLen', type: 'range', label: 'A length (photo)', min: 0.5, max: 15, step: 0.1, value: 3, unit: 's', decimals: 1, showIf: () => clips.A?.kind === 'image' },
      { id: 'bIn', type: 'range', label: 'B starts at', min: 0, max: 60, step: 0.05, value: 0, unit: 's', decimals: 2, showIf: () => isVid('B') },
      { id: 'bOut', type: 'range', label: 'B ends at', min: 0, max: 60, step: 0.05, value: 4, unit: 's', decimals: 2, showIf: () => isVid('B') },
      { id: 'bLen', type: 'range', label: 'B length (photo)', min: 0.5, max: 15, step: 0.1, value: 3, unit: 's', decimals: 1, showIf: () => clips.B?.kind === 'image' },
      { id: 'overlap', type: 'range', label: 'Overlap', min: 0.2, max: 6, step: 0.05, value: 1.6, unit: 's', decimals: 2, hint: 'How long both clips play together at the end of A; the transition happens here.' },
    ],
  },
  { ...mp.sections[1], collapsed: true },
  {
    title: 'View',
    collapsed: true,
    controls: [
      { id: 'view', type: 'segmented', label: 'Show', value: 'combined', options: [['combined', 'Result'], ['top', 'Top'], ['middle', 'Middle'], ['bottom', 'Bottom'], ['exploded', '3D layers']], hint: 'Check each layer on its own. 3D layers shows them apart, for tutorials. Exports use this view.' },
      { id: 'labels', type: 'toggle', label: 'Layer labels and arrows', value: false },
      { id: 'labelTop', type: 'text', label: 'Top label', value: 'Magic mask', showIf: (st) => st.labels },
      { id: 'labelMid', type: 'text', label: 'Middle label', value: 'Wipe layer (clip A)', showIf: (st) => st.labels },
      { id: 'labelBottom', type: 'text', label: 'Bottom label', value: 'Base layer (clip B)', showIf: (st) => st.labels },
    ],
  },
], {
  persist: { key: 'magic-mask', skip: ['aIn', 'aOut', 'bIn', 'bOut'] },
  onChange: (st, id) => {
    mp.handle(st, id);
    if (id === 'maskFrom') { mp.mediaChanged(maskClip()); autoSetup({ keepTiming: true }); }
    if (['aIn', 'aOut', 'bIn', 'bOut', 'overlap', 'aLen', 'bLen'].includes(id)) { clampTiming(id); mp.rangeChanged(); }
    if (id === 'loop' && st.loop) playLoop();
    syncNote();
    stage.invalidate();
    exportBar.refresh();
  },
});
const s = panel.state;
mp.attach(panel);
panel.section('adjust').addEventListener('toggle', () => { mp.drawMarks(); renderSteps(); });

/* ---------- Timing ---------- */
const inOf = (k) => (isVid(k) ? s[`${k.toLowerCase()}In`] : 0);
const lenOf = (k) => (!clips[k] ? 3 : isVid(k) ? Math.max(0.2, s[`${k.toLowerCase()}Out`] - s[`${k.toLowerCase()}In`]) : s[`${k.toLowerCase()}Len`]);
const overlapLen = () => Math.min(s.overlap, lenOf('A') * 0.95, lenOf('B') * 0.95);
const T0 = () => lenOf('A') - overlapLen();
const duration = () => T0() + lenOf('B');
const wipeLen = () => Math.min(s.wipeDur, overlapLen());
/** Source time of clip k at output time t (clamped to its trim). */
function srcTime(k, t) {
  if (!isVid(k)) return 0;
  const local = k === 'A' ? t : t - T0();
  return clamp(inOf(k) + local, inOf(k), inOf(k) + lenOf(k) - 0.001);
}
/** The mask clip's source range the masking pass covers: the overlap (A: until A ends, for Hold). */
function maskRange() {
  const k = s.maskFrom;
  if (!isVid(k)) return [0, 0];
  return k === 'A' ? [srcTime('A', T0()), srcTime('A', lenOf('A'))] : [srcTime('B', T0()), srcTime('B', T0() + overlapLen())];
}

function clampTiming(id) {
  const fix = {};
  for (const k of ['a', 'b']) {
    const m = clips[k.toUpperCase()];
    if (m?.kind !== 'video') continue;
    if (s[`${k}Out`] - s[`${k}In`] < 0.3) {
      if (id === `${k}In`) fix[`${k}Out`] = Math.min(m.duration, s[`${k}In`] + 0.3);
      else fix[`${k}In`] = Math.max(0, s[`${k}Out`] - 0.3);
    }
  }
  if (Object.keys(fix).length) panel.set(fix, { silent: true });
}

/** Video sliders follow the clip: max = its duration; a new clip is used whole. */
function fitTrim(k) {
  const m = clips[k], kk = k.toLowerCase();
  const inEl = document.getElementById(`c-${kk}In`), outEl = document.getElementById(`c-${kk}Out`);
  if (m?.kind !== 'video' || !inEl) return;
  const d = Math.floor(m.duration * 100) / 100;
  inEl.max = outEl.max = d;
  panel.set({ [`${kk}In`]: 0, [`${kk}Out`]: d }, { silent: true });
}

/* ---------- Uploads: both clips at once, or one after the other ---------- */
const clipsEl = document.getElementById('clips');
const statusEl = h('div', { class: 'mm-status', role: 'status', 'aria-live': 'polite' });
const slotsEl = h('div', { class: 'mm-slots' });
const picker = createFilePicker(clipsEl, {
  multiple: true, accept: 'video/*,image/*',
  label: 'Drop both clips here', hint: 'the first is A (before), the second B (after)',
  onFiles: addFiles,
});
clipsEl.append(slotsEl, statusEl);

async function addFiles(files) {
  const loaded = [];
  for (const file of files.slice(0, 2)) {
    try { loaded.push(await loadMedia(file)); } catch (err) {
      if (!(err instanceof MediaError)) console.error(err);
      toast(err.message || `Could not open ${file.name}.`, 'error', 7000);
    }
  }
  if (files.length > 2) toast('Magic Mask uses two clips: the first two were added.');
  if (!loaded.length) return;
  // Fill the empty slots in order; with both full, two new files replace both, one replaces B.
  const order = loaded.length === 2 ? ['A', 'B'] : [!clips.A ? 'A' : 'B'];
  loaded.forEach((m, i) => setClip(order[i], m));
  clipsChanged({ fresh: true });
}

function setClip(k, m) {
  const old = clips[k];
  if (old) { old.el.pause?.(); old.dispose?.(); }
  clips[k] = m;
  if (m?.kind === 'video') m.el.addEventListener('seeked', () => stage.invalidate());
}

function swapClips() {
  [clips.A, clips.B] = [clips.B, clips.A];
  clipsChanged({ fresh: true });
}

/** After clips are added, removed or swapped: trims, canvas size, masks, then the automatic setup. */
function clipsChanged({ fresh = false } = {}) {
  for (const k of ['A', 'B']) fitTrim(k);
  const base = clips.A || clips.B;
  if (base) { const { w, h: hh } = outputSize(base.width, base.height, 1920); canvas.width = w; canvas.height = hh; }
  mp.mediaChanged(maskClip());
  panel.refresh();
  stage.reset();
  exportBar.refresh();
  renderSlots();
  if (fresh) autoSetup();
  else syncNote();
}

function renderSlots() {
  const card = (k) => {
    const m = clips[k];
    return h('div', { class: `mm-slot${m ? '' : ' is-empty'}` },
      h('span', { class: 'mm-slot-key' }, k),
      h('div', { class: 'mm-slot-info' },
        h('strong', {}, m ? m.name : k === 'A' ? 'Clip A: before' : 'Clip B: after'),
        h('span', {}, m ? `${m.kind === 'video' ? formatTime(m.duration) : 'photo'} · ${m.width}×${m.height}` : 'Drop or pick a file')),
      m ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm mm-icon', 'aria-label': `Remove clip ${k}`, title: 'Remove', html: icon('x'), onclick: () => { setClip(k, null); clipsChanged(); } })
        : h('button', { type: 'button', class: 'btn btn-sm', onclick: () => picker.open() }, 'Choose'));
  };
  slotsEl.replaceChildren(card('A'),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm mm-swap', disabled: !(clips.A && clips.B), html: `${icon('swap')} Swap A and B`, onclick: swapClips }),
    card('B'));
  const full = !!(clips.A && clips.B);
  picker.el.classList.toggle('mm-compact', full);
  picker.el.querySelector('strong').textContent = full ? 'Drop new clips to replace them' : clips.A ? 'Drop clip B here' : 'Drop both clips here';
}

/* ---------- Automatic setup ---------- */
function setStatus(state, text, action = null) {
  setup = { state, text, action };
  statusEl.className = `mm-status is-${state}`;
  statusEl.replaceChildren(...[
    state === 'busy' && h('span', { class: 'spinner', 'aria-hidden': 'true' }),
    h('span', {}, text),
    action && h('button', { type: 'button', class: 'btn btn-sm', onclick: action.run }, action.label),
  ].filter(Boolean));
  statusEl.hidden = !text;
  renderSteps();
  syncNote();
}

/**
 * Both clips in: transition at the end of A (whole clips, default overlap), person masks over the overlap only,
 * the default diagonal wipe following the subject, then the transition plays on a loop. No person → the most
 * prominent object; that failing → ask for a click.
 */
async function autoSetup({ keepTiming = false } = {}) {
  if (!clips.A || !clips.B) {
    setStatus('idle', clips.A || clips.B ? 'Add the second clip.' : '');
    return;
  }
  const run = ++setupRun;
  const stale = () => run !== setupRun;
  if (!keepTiming) panel.set({ overlap: 1.6 }, { silent: true });
  clampTiming('overlap');
  mp.rangeChanged();
  const m = maskClip();
  setStatus('busy', `Transition at ${formatTime(T0())} (end of clip A). Finding the subject…`);
  playLoop();
  try {
    if (s.mkMode !== 'person') { panel.set({ mkMode: 'person' }, { silent: true }); mp.handle(s, 'mkMode'); }
    track.clearPoints();
    if (!(await mp.run()) || stale()) { if (!stale()) needClick('Masking stopped.'); return; }
    if (subjectFound()) return ready('person');
    // No person: the most prominent object, through one automatic SAM click.
    setStatus('busy', 'No person found. Selecting the most prominent object instead…');
    const [a, b] = maskRange();
    const t = isVid(s.maskFrom) ? (a + b) / 2 : 0;
    const pt = await salientPoint(m, t);
    if (stale()) return;
    panel.set({ mkMode: 'object' }, { silent: true });
    mp.handle(s, 'mkMode');
    track.setKeyframes([{ t, points: [{ ...pt, keep: true }] }]);
    if (!(await mp.run()) || stale()) { if (!stale()) needClick('No person found.'); return; }
    if (subjectFound()) return ready('object');
    needClick('No person or clear object found.');
  } catch (err) {
    console.error(err);
    if (!stale()) needClick(`Setup failed (${err.message || err}).`);
  }
  function ready(kind) {
    setStatus('ready', `Ready: ${kind === 'person' ? 'the person' : 'the most prominent object'} stays on top while the wipe reveals clip B at ${formatTime(T0())}.${kind === 'object' ? ' Not the right thing? Open Adjust and click the subject.' : ''}`);
    playLoop();
  }
}

/** Ask for a click on the subject: object mode, Keep tool, Adjust open, playhead in the overlap. */
function needClick(why) {
  panel.set({ mkMode: 'object', mkTool: 'keep' }, { silent: true });
  mp.handle(s, 'mkMode');
  panel.section('adjust').open = true;
  stage.pause();
  stage.seek(T0() + Math.min(0.3, wipeLen() / 2));
  setStatus('needs-click', `${why} Click the subject on the preview to select it, then press Track subject.`);
}

/** Is there a subject in most masked frames? */
function subjectFound() {
  if (!isVid(s.maskFrom)) return (track.box(0)?.area || 0) > 0.003;
  const tl = track.timeline();
  return tl.filter((f) => (track.box(f.t)?.area || 0) > 0.003).length >= tl.length * 0.4;
}

/**
 * The most prominent thing in the mask clip's frame at source time t, in 0..1: colour distance from the frame's
 * border (the background), weighted toward the centre, smoothed, then the strongest point.
 */
async function salientPoint(m, t) {
  if (m.kind === 'video') { syncHeld = true; await seekVideo(m.el, t); }
  try {
    const W = 64, H = Math.max(8, Math.round((64 * m.height) / m.width));
    const c = scratch('mm-salient', W, H), x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(m.el, 0, 0, W, H);
    const d = x.getImageData(0, 0, W, H).data;
    let br = 0, bg = 0, bb = 0, n = 0;
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      if (y > 1 && y < H - 2 && i > 1 && i < W - 2) continue;
      const j = (y * W + i) * 4; br += d[j]; bg += d[j + 1]; bb += d[j + 2]; n++;
    }
    br /= n; bg /= n; bb /= n;
    const score = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let i = 0; i < W; i++) {
      const j = (y * W + i) * 4;
      const dist = Math.hypot(d[j] - br, d[j + 1] - bg, d[j + 2] - bb);
      const cx = i / W - 0.5, cy = y / H - 0.5;
      score[y * W + i] = dist * Math.exp(-(cx * cx + cy * cy) / 0.08);
    }
    let best = -1, bi = 0;
    for (let y = 2; y < H - 2; y++) for (let i = 2; i < W - 2; i++) {
      let sum = 0;
      for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) sum += score[(y + v) * W + i + u];
      if (sum > best) { best = sum; bi = y * W + i; }
    }
    return { x: ((bi % W) + 0.5) / W, y: (Math.floor(bi / W) + 0.5) / H };
  } finally { if (m.kind === 'video') syncHeld = false; }
}

/** Play the moment around the wipe (looped by the tick handler while Loop is on). */
const loopRange = () => [Math.max(0, T0() - 0.7), Math.min(duration(), T0() + wipeLen() + Math.max(0.7, s.maskFrom === 'A' && s.exit === 'fade' ? s.fadeDur + 0.3 : 0.7))];
function playLoop() {
  if (!clips.A || !clips.B) return;
  stage.seek(s.loop ? loopRange()[0] : 0);
  stage.play().catch(() => {});
}

/* ---------- Steps: Upload → Preview → Adjust → Export ---------- */
const stepsEl = document.getElementById('steps');
const STEPS = [
  ['upload', 'Upload', () => picker.open()],
  ['preview', 'Preview', () => playLoop()],
  ['adjust', 'Adjust', () => { const sec = panel.section('adjust'); sec.open = true; sec.scrollIntoView({ behavior: 'smooth', block: 'start' }); }],
  ['export', 'Export', () => document.getElementById('export').scrollIntoView({ behavior: 'smooth', block: 'center' })],
];
function renderSteps() {
  const both = !!(clips.A && clips.B);
  const done = {
    upload: both,
    preview: both && setup.state === 'ready',
    adjust: both && !!panel.section('adjust')?.open,
    export: exported,
  };
  const current = !both ? 'upload' : exported ? 'export' : panel.section('adjust').open ? 'adjust' : 'preview';
  stepsEl.replaceChildren(...STEPS.map(([id, label, go], i) => h('li', {},
    h('button', {
      type: 'button', class: `mm-step${done[id] ? ' is-done' : ''}${current === id ? ' is-current' : ''}`,
      'aria-current': current === id ? 'step' : null, disabled: id !== 'upload' && !both, onclick: go,
    }, h('span', { class: 'mm-step-n' }, done[id] && current !== id ? '✓' : String(i + 1)), label))));
}

/* ---------- Video sync (wall clock) ---------- */
function syncVideos(t) {
  if (syncHeld) return;
  for (const k of ['A', 'B']) {
    const m = clips[k];
    if (m?.kind !== 'video') continue;
    const v = m.el;
    const target = srcTime(k, t);
    const active = k === 'A' ? t < lenOf('A') : t >= T0();
    if (stage.playing && active) {
      if (v.paused) v.play().catch(() => {});
      if (Math.abs(v.currentTime - target) > 0.25) v.currentTime = target;
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - target) > 0.04 && !v.seeking) v.currentTime = target;
    }
  }
}

/* ---------- Drawing ---------- */
function coverRect(m) {
  const W = canvas.width, H = canvas.height;
  if (!m) return { x: 0, y: 0, w: W, h: H };
  return fit(m.width, m.height, W, H, 'cover');
}
function drawClip(c, k) {
  const m = clips[k];
  const W = c.canvas.width, H = c.canvas.height;
  if (!m) {
    const g = c.createLinearGradient(0, 0, W, H);
    if (k === 'A') { g.addColorStop(0, '#3a2f7a'); g.addColorStop(1, '#0f5f73'); } else { g.addColorStop(0, '#7a2f4a'); g.addColorStop(1, '#c87a2b'); }
    c.fillStyle = g; c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,.8)';
    c.font = `700 ${Math.min(W, H) * 0.06}px ${FONT}`;
    c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(`Clip ${k}`, W / 2, H / 2);
    c.textAlign = 'left';
    return;
  }
  const r = coverRect(m);
  c.drawImage(m.el, r.x, r.y, r.w, r.h);
}

function shapePath(id) {
  if (!shapePaths.has(id)) {
    const sh = getShape(id);
    const p = Object.fromEntries((sh.params || []).filter((x) => x.id).map((x) => [x.id, x.value]));
    shapePaths.set(id, new Path2D(sh.path(1000, 1000, p)));
  }
  return shapePaths.get(id);
}

/** Opacity of the top layer at t. */
function topAlpha(t) {
  const t0 = T0(), tEnd = t0 + wipeLen();
  if (t < t0 || t > lenOf('A') + (s.maskFrom === 'B' ? 1e9 : 0)) return 0;
  if (s.maskFrom === 'B') return s.enter === 'fade' ? clamp((t - t0) / s.fadeDur) : 1;
  if (s.exit === 'hold') return 1;
  if (s.exit === 'cut') return t < tEnd ? 1 : 0;
  return 1 - clamp((t - tEnd) / s.fadeDur);
}

/** Build the three layers for time t: { bottom, middle, top, geo, topA, box }. */
function layers(t) {
  const W = canvas.width, H = canvas.height, k = Math.min(W, H) / 1080;
  const bottom = scratch(`mm-bottom-${W}x${H}`, W, H), bx = bottom.getContext('2d');
  bx.clearRect(0, 0, W, H);
  drawClip(bx, 'B');
  const middle = scratch(`mm-middle-${W}x${H}`, W, H), mx = middle.getContext('2d');
  mx.globalCompositeOperation = 'source-over';
  mx.clearRect(0, 0, W, H);
  const p = ease(s.easing, (t - T0()) / Math.max(0.05, wipeLen()));
  const mk = maskClip();
  const srcT = srcTime(s.maskFrom, t);
  const b = mk ? track.box(srcT) : null;
  const r = coverRect(mk);
  const subject = b ? { x: (r.x + b.cx * r.w) / W, y: (r.y + b.cy * r.h) / H } : null;
  const geo = wipeGeometry({ kind: s.wipe, angle: s.angle, p, W, H, subject, follow: s.follow, shape: s.wipe === 'shape' ? shapePath(s.shape) : null });
  drawRemain(mx, geo, s.feather * k);
  mx.globalCompositeOperation = 'source-in';
  drawClip(mx, 'A');
  mx.globalCompositeOperation = 'source-over';
  const top = scratch(`mm-top-${W}x${H}`, W, H), tx = top.getContext('2d');
  tx.globalCompositeOperation = 'source-over';
  tx.clearRect(0, 0, W, H);
  const topA = topAlpha(t);
  const a = mk && topA > 0 ? mp.alpha(srcT, r.w, r.h, k) : null;
  if (a) {
    tx.drawImage(a, r.x, r.y, r.w, r.h);
    tx.globalCompositeOperation = 'source-in';
    drawClip(tx, s.maskFrom);
    tx.globalCompositeOperation = 'source-over';
  }
  return { bottom, middle, top, geo, topA: a ? topA : 0, subject, k };
}

function label(c, text, x, y, toX, toY, color, k) {
  c.save();
  c.font = `700 ${34 * k}px ${FONT}`;
  const w = c.measureText(text).width + 40 * k, hh = 58 * k;
  c.strokeStyle = color; c.fillStyle = color; c.lineWidth = 4 * k;
  if (toX != null) {
    const sx = x + w / 2, sy = y + hh / 2;
    c.beginPath(); c.moveTo(sx, sy); c.lineTo(toX, toY); c.stroke();
    const a = Math.atan2(toY - sy, toX - sx), L = 18 * k;
    c.beginPath(); c.moveTo(toX, toY); c.lineTo(toX - L * Math.cos(a - 0.45), toY - L * Math.sin(a - 0.45)); c.lineTo(toX - L * Math.cos(a + 0.45), toY - L * Math.sin(a + 0.45)); c.closePath(); c.fill();
    c.beginPath(); c.arc(toX, toY, 7 * k, 0, Math.PI * 2); c.fill();
  }
  c.shadowColor = 'rgba(0,0,0,.35)'; c.shadowBlur = 16 * k;
  c.beginPath(); roundRectPath(c, x, y, w, hh, hh / 2); c.fill();
  c.shadowColor = 'transparent';
  c.fillStyle = '#111';
  c.textBaseline = 'middle';
  c.fillText(text, x + 20 * k, y + hh / 2 + k);
  c.restore();
}
const COLORS = { top: '#ffd166', middle: '#7cc6fe', bottom: '#b8f2a6' };

function drawExploded(L, W, H, k) {
  ctx.fillStyle = '#101216';
  ctx.fillRect(0, 0, W, H);
  persp ??= createPerspective();
  const items = [['bottom', L.bottom, s.labelBottom], ['middle', L.middle, s.labelMid], ['top', L.top, s.labelTop]];
  const sc = 0.55;
  const centres = [];
  items.forEach(([key, cv], i) => {
    const off = i - 1;
    // Bottom layer farthest back (up and right), top layer in front (down and left).
    const tf = { rx: 18, ry: -32, rz: 0, scale: sc, x: W * (0.5 - off * 0.17), y: H * (0.5 + off * 0.1), focal: Math.max(W, H) * 1.8 };
    const quad = projectRect(W, H, tf);
    // A frame outline for each plane, so empty (transparent) parts still read as a layer.
    const framed = scratch(`mm-ex-${key}-${W}x${H}`, W, H), fx = framed.getContext('2d');
    fx.clearRect(0, 0, W, H);
    fx.fillStyle = key === 'bottom' ? 'transparent' : 'rgba(255,255,255,.06)';
    fx.fillRect(0, 0, W, H);
    fx.drawImage(cv, 0, 0);
    fx.strokeStyle = COLORS[key]; fx.lineWidth = 10 * k;
    fx.strokeRect(0, 0, W, H);
    if (persp) ctx.drawImage(persp.draw(framed, quad, W, H), 0, 0);
    else ctx.drawImage(framed, tf.x - (W * sc) / 2, tf.y - (H * sc) / 2, W * sc, H * sc);
    centres.push({ key, x: quad.reduce((a, q) => a + q[0], 0) / 4, y: quad.reduce((a, q) => a + q[1], 0) / 4, right: Math.max(...quad.map((q) => q[0])) });
  });
  if (s.labels) {
    items.forEach(([key, , text], i) => {
      const c = centres[i];
      label(ctx, text, W * 0.04, H * (0.84 - i * 0.11), c.x, c.y, COLORS[key], k);
    });
  }
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  syncVideos(t);
  const L = layers(t);
  const k = L.k;
  ctx.globalCompositeOperation = 'source-over';
  ctx.clearRect(0, 0, W, H);
  const inWindow = t >= T0() && t <= T0() + wipeLen() + 1e-3;
  if (s.view === 'exploded') { drawExploded(L, W, H, k); mp.drawMarks(); return; }
  if (s.view === 'top' || s.view === 'middle' || s.view === 'bottom') {
    ctx.fillStyle = '#101216'; ctx.fillRect(0, 0, W, H);
    ctx.drawImage(L[s.view], 0, 0);
    if (s.labels) label(ctx, { top: s.labelTop, middle: s.labelMid, bottom: s.labelBottom }[s.view], 40 * k, 40 * k, null, null, COLORS[s.view], k);
    mp.drawMarks();
    return;
  }
  if (t < T0()) drawClip(ctx, 'A');
  else {
    ctx.drawImage(L.bottom, 0, 0);
    ctx.drawImage(L.middle, 0, 0);
    if (s.glow && inWindow) drawEdgeGlow(ctx, L.geo, { color: s.glowColor, width: s.glowWidth, k });
    if (L.topA > 0) { ctx.globalAlpha = L.topA; ctx.drawImage(L.top, 0, 0); ctx.globalAlpha = 1; }
  }
  if (s.labels && t >= T0() && inWindow) {
    const side = sidePoints(L.geo);
    if (L.subject && L.topA > 0) label(ctx, s.labelTop, W * 0.05, H * 0.06, L.subject.x * W, L.subject.y * H, COLORS.top, k);
    label(ctx, s.labelMid, W * 0.05, H * 0.06 + 80 * k, side.A.x, side.A.y, COLORS.middle, k);
    label(ctx, s.labelBottom, W * 0.05, H * 0.06 + 160 * k, side.B.x, side.B.y, COLORS.bottom, k);
  }
  mp.drawMarks();
}

const stage = createStage({ canvas, transport: document.getElementById('transport'), render, getDuration: duration });
stage.events.addEventListener('tick', () => {
  if (!stage.playing) { syncVideos(stage.time); return; }
  // Loop the transition: back to just before the wipe once it's over (never while exporting or masking).
  const [a, b] = loopRange();
  if (s.loop && !exporting && !syncHeld && clips.A && clips.B && stage.time >= b) stage.seek(a);
});

const videos = () => ['A', 'B'].filter(isVid).map((k) => clips[k].el);
const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => 'magic-mask-transition',
  getAudio: () => mixTrack(videos()),
  hasAudio: () => videos().length > 0,
  video: () => !!(clips.A && clips.B),
  gif: () => !!(clips.A && clips.B),
  png: () => !!(clips.A && clips.B),
  hint: () => (clips.A && clips.B ? 'Video export plays the whole sequence once in real time.' : 'Add both clips.'),
  beforeExport: () => {
    if (maskClip()) mp.ensureReady();
    exporting = true;
    exported = true;
    renderSteps();
    stage.seek(0);
  },
  afterExport: () => { exporting = false; for (const v of videos()) v.pause(); stage.invalidate(); },
  // GIF frames are seeked: park both videos on their exact frames first.
  prepareFrame: async (t) => {
    for (const k of ['A', 'B']) if (isVid(k)) await seekVideo(clips[k].el, srcTime(k, t));
  },
});

function syncNote() {
  overlay.classList.add('is-note');
  let text = '';
  if (!clips.A || !clips.B) text = clips.A || clips.B ? 'Add the second clip.' : 'Drop two clips on the left (both at once is fine). Best: shots where someone walks or moves across the frame.';
  else if (setup.state === 'needs-click' && !track.hasPoints) text = 'Click the subject to select it.';
  else if (setup.state !== 'busy' && track.mode === 'object' && !track.hasPoints) text = 'Click the subject to select it (Adjust → Subject).';
  else if (setup.state !== 'busy' && isVid(s.maskFrom) && track.staleCount()) text = 'Press Track subject (Adjust → Subject) to mask the overlap.';
  overlay.hidden = !text;
  overlay.replaceChildren(h('div', {}, text));
}

canvas.width = 1280; canvas.height = 720;
renderSlots();
renderSteps();
syncNote();
