/*
 * Pop Out: the video or photo plays inside a social media post, and the subject breaks out of the post's
 * media rectangle over the UI around it.
 *
 * Presets do the masking on upload: "Holding out an item" (hold.js: hand landmarks → SAM prompts on the hand and
 * the item past the fingertips, per frame), "Person" (person segmentation) or "Custom" (clicks). Then autoPlace()
 * zooms/pans the media so the subject's top crosses the media's top edge by "Pop-out amount".
 *
 * Per frame (back to front): app background → post UI (post.js) → the media, clipped to its rectangle →
 * views badge → the subject cut out by its mask (lib/object-mask.js through lib/mask-panel.js) and drawn
 * WITHOUT the clip, limited to the allowed edges (soft fade at the limit), over its own drop shadow (outside the
 * media only). The pop (grow + lift by p(t)) moves the media and the cut-out together (popRect), so the subject
 * never shows twice.
 *
 * Geometry: the post is laid out in units (1080 per post width); u = px per unit fits it to the canvas, times
 * "Frame size". The source is drawn to cover the media rectangle, then zoomed and panned (mediaX/Y in media
 * widths/heights), so more of the subject can spill out. Masks are computed once (masking pass) and drawn
 * from cache, so preview, GIF and video match.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { fit } from '/assets/js/lib/canvas.js';
import { h, icon, store, toast } from '/assets/js/lib/dom.js';
import { progressModal } from '/assets/js/lib/exporter.js';
import { ease, easingOptions, clamp } from '/assets/js/lib/easing.js';
import { createMaskTrack } from '/assets/js/lib/object-mask.js';
import { createMaskPanel } from '/assets/js/lib/mask-panel.js';
import { layoutPost, drawPost, drawViews, drawPopped, popRect, mediaRect, POST_DEFAULTS, THEMES, FONT } from './post.js';
import { findHands, holdPrompts } from './hold.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const marks = document.getElementById('marks');
const overlay = document.getElementById('overlay');
const transportEl = document.getElementById('transport');

const SIZES = { '9:16': [1080, 1920], '4:5': [1080, 1350], '1:1': [1080, 1080], '16:9': [1920, 1080] };
const D = POST_DEFAULTS;
const DEFAULT_COMMENTS = [
  { user: 'maya.draws', text: 'Wait, it actually came out of the screen 😳' },
  { user: 'leo_frames', text: 'How did you do this?? Tutorial please' },
];

let media = null;
let avatar = null;
let commentList = store.get('pop-out:comments', DEFAULT_COMMENTS);
let exportKind = null;
let lastGeo = null;
let autoPlaced = false; // media zoom/pan set by autoPlace(); a manual change turns it off
let presetRun = 0;      // bumps on every preset run, so a stale run stops
let presetMsg = '';     // result of the last preset run, shown under the preset
let noHand = false;

const isVideo = () => media?.kind === 'video';
const isPhoto = () => media?.kind === 'image';

const track = createMaskTrack('pop');
const mp = createMaskPanel({
  track, canvas, marks,
  sourceRect: () => { const g = lastGeo || geo(); return g.shown || g.src; }, // follows the pop transform
  getTime: () => (isVideo() ? media.el.currentTime : 0),
  getRange: () => [0, isVideo() ? media.duration : 0],
  seek: (t) => stage.seek(t),
  pause: () => stage.pause(),
  moveLabel: 'Move',
  mode: 'object',
  showMode: (st) => st.preset === 'custom',
  showPoints: () => s.preset === 'custom' || !!panel.section('finetune')?.open,
  autoRun: false,
  hidden: () => !!exportKind,
  onChange: () => { stage.invalidate(); syncNote(); exportBar?.refresh(); },
});

const avatarZone = h('div');
const commentsEl = h('div', { class: 'po2-comments' });
const presetNote = h('div', { class: 'po2-preset-note', role: 'status' });

const PRESETS = [['hold', 'Item in hand'], ['person', 'Person'], ['custom', 'Custom']];
const PRESET_HINTS = {
  hold: 'Holding out an item: for someone holding something toward the camera (a sign, a product, a phone). Finds the hand, cuts out the hand and what it holds, and moves the media so it pops over the header.',
  person: 'Person pops out: the whole person breaks out of the top of the post.',
  custom: 'Click what should pop out on the preview (Keep / Remove in Fine-tune), then press Track subject.',
};
const MASK_MODE = { hold: 'object', person: 'person', custom: 'both' };
const PAN = 1.5; // media pan range in media widths/heights (at 300% zoom the source reaches ±1.3)

/* ---------- Panel ---------- */
const panel = createControls(document.getElementById('controls'), [
  {
    title: 'Preset',
    controls: [
      { id: 'preset', type: 'segmented', label: 'What pops out', value: 'hold', options: PRESETS },
      ...Object.entries(PRESET_HINTS).map(([id, text]) => ({ type: 'custom', el: h('div', { class: 'ctrl-hint' }, text), showIf: (st) => st.preset === id })),
      { id: 'forearm', type: 'toggle', label: 'Include the forearm', value: false, showIf: (st) => st.preset === 'hold', hint: 'Off: just the hand and what it holds.' },
      { id: 'popAmount', type: 'range', label: 'Pop-out amount', min: 0, max: 40, value: 12, unit: '%', showIf: (st) => st.preset !== 'custom', hint: 'How far the top of the subject reaches past the top of the media (% of its height). Moves and zooms the media.' },
      { type: 'custom', el: presetNote },
    ],
  },
  {
    id: 'finetune',
    title: 'Fine-tune',
    collapsed: true,
    controls: [
      { type: 'subhead', label: 'Subject' },
      ...mp.sections[0].controls,
      { type: 'subhead', label: 'Breaking out' },
      { id: 'edgeTop', type: 'toggle', label: 'Break through the top', value: true },
      { id: 'edgeBottom', type: 'toggle', label: 'Break through the bottom', value: false, hint: 'Leave off when the body continues past the bottom of the shot.' },
      { id: 'edgeSides', type: 'toggle', label: 'Break through the sides', value: false },
      { id: 'popLimit', type: 'range', label: 'How far', min: 0, max: 900, value: 420, unit: 'px', hint: 'How far past the media edge the subject may reach.' },
      { id: 'popFade', type: 'range', label: 'Fade at the limit', min: 0, max: 1, step: 0.05, value: 0.35, format: (v) => `${Math.round(v * 100)}%` },
      { id: 'shadow', type: 'toggle', label: 'Drop shadow', value: true, hint: 'Under the popped-out part, so it looks raised off the screen.' },
      { id: 'shadowBlur', type: 'range', label: 'Shadow blur', min: 0, max: 80, value: 28, unit: 'px', showIf: (st) => st.shadow },
      { id: 'shadowOffset', type: 'range', label: 'Shadow offset', min: 0, max: 80, value: 18, unit: 'px', showIf: (st) => st.shadow },
      { id: 'shadowOpacity', type: 'range', label: 'Shadow strength', min: 0, max: 1, step: 0.05, value: 0.5, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => st.shadow },
      { type: 'subhead', label: 'Mask edges' },
      ...mp.sections[1].controls,
    ],
  },
  {
    title: 'Pop out',
    controls: [
      { id: 'popMode', type: 'segmented', label: 'When', value: 'animate', options: [['always', 'Always'], ['animate', 'Animate in'], ['times', 'At times']] },
      { id: 'popStart', type: 'range', label: 'Starts at', min: 0, max: 20, step: 0.1, value: 0.5, unit: 's', decimals: 1, showIf: (st) => st.popMode === 'animate' },
      { id: 'popTimes', type: 'text', label: 'Pop at (seconds)', value: '0.5, 3', placeholder: '0.5, 3, 6.2', showIf: (st) => st.popMode === 'times', hint: 'Each time pops the subject out, holds, then lets it sink back in.' },
      { id: 'popHold', type: 'range', label: 'Hold', min: 0.2, max: 10, step: 0.1, value: 1.5, unit: 's', decimals: 1, showIf: (st) => st.popMode === 'times' },
      { id: 'popDur', type: 'range', label: 'Pop duration', min: 0.1, max: 3, step: 0.05, value: 0.6, unit: 's', decimals: 2, showIf: (st) => st.popMode !== 'always' },
      { id: 'popEasing', type: 'select', label: 'Easing', value: 'easeOutBack', options: easingOptions, showIf: (st) => st.popMode !== 'always' },
      { id: 'popScale', type: 'range', label: 'Grow while popped', min: 100, max: 160, value: 110, unit: '%', hint: 'Zooms the media toward the viewer as the subject comes out.' },
      { id: 'popLift', type: 'range', label: 'Lift', min: -200, max: 300, value: 40, unit: 'px', hint: 'Moves the media and subject up as it pops (negative moves them down).' },
    ],
  },
  {
    title: 'Media in the post',
    controls: [
      { id: 'aspect', type: 'segmented', label: 'Media shape', value: D.aspect, options: [['4:5', '4:5'], ['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9']] },
      { id: 'mediaZoom', type: 'range', label: 'Zoom', min: 1, max: 3, step: 0.01, value: 1.15, format: (v) => `${Math.round(v * 100)}%`, hint: 'Zooming in pushes more of the subject past the frame. Drag the media on the preview (Move) to place it.' },
      { id: 'mediaX', type: 'range', label: 'Horizontal', min: -PAN, max: PAN, step: 0.01, value: 0, format: (v) => `${Math.round(v * 100)}%` },
      { id: 'mediaY', type: 'range', label: 'Vertical', min: -PAN, max: PAN, step: 0.01, value: 0, format: (v) => `${Math.round(v * 100)}%` },
      { id: 'follow', type: 'toggle', label: 'Follow the subject', value: true, showIf: () => isVideo(), hint: 'Pans the media with the subject (smoothed), so its top keeps crossing the frame the same amount.' },
      { id: 'clip', type: 'range', label: 'Clip length (photos)', min: 1, max: 20, step: 0.5, value: 4, unit: 's', decimals: 1, showIf: () => isPhoto() },
    ],
  },
  {
    title: 'Post',
    controls: [
      { id: 'theme', type: 'segmented', label: 'Theme', value: D.theme, options: [['dark', 'Dark'], ['light', 'Light']] },
      { id: 'postType', type: 'segmented', label: 'Post type', value: D.postType, options: [['regular', 'Regular'], ['boosted', 'Boosted'], ['sponsored', 'Sponsored']] },
      { id: 'ctaText', type: 'text', label: 'Button text', value: D.ctaText, showIf: (st) => st.postType === 'sponsored' },
      { id: 'showAppBar', type: 'toggle', label: 'Top bar (back arrow + title)', value: D.showAppBar },
      { id: 'pageTitle', type: 'text', label: 'Page title', value: D.pageTitle, showIf: (st) => st.showAppBar },
      { id: 'showHeader', type: 'toggle', label: 'Header', value: D.showHeader },
      { id: 'username', type: 'text', label: 'Username', value: D.username, showIf: (st) => st.showHeader },
      { id: 'audio', type: 'text', label: 'Audio line', value: D.audio, showIf: (st) => st.showHeader && st.postType !== 'sponsored', hint: 'Leave empty to hide it.' },
      { id: 'showDots', type: 'toggle', label: 'More-options dots', value: D.showDots, showIf: (st) => st.showHeader },
      { type: 'custom', label: 'Profile picture', el: avatarZone, showIf: (st) => st.showHeader },
      { id: 'caption', type: 'textarea', label: 'Caption', value: D.caption, rows: 3 },
      { id: 'captionPos', type: 'segmented', label: 'Caption', value: D.captionPos, options: [['above', 'Above'], ['below', 'Below'], ['off', 'Hidden']] },
      { id: 'captionLines', type: 'segmented', label: 'Lines before "more"', value: String(D.captionLines), options: [['1', '1'], ['2', '2'], ['3', '3'], ['0', 'All']], showIf: (st) => st.captionPos !== 'off' },
      { id: 'showDate', type: 'toggle', label: 'Date line', value: D.showDate },
      { id: 'dateText', type: 'text', label: 'Date', value: D.dateText, showIf: (st) => st.showDate },
    ],
  },
  {
    title: 'Counts',
    controls: [
      { id: 'showCounts', type: 'toggle', label: 'Show counts', value: D.showCounts },
      { id: 'likes', type: 'number', label: 'Likes', min: 0, max: 1e10, value: D.likes, showIf: (st) => st.showCounts },
      { id: 'comments', type: 'number', label: 'Comments', min: 0, max: 1e10, value: D.comments, showIf: (st) => st.showCounts || st.showComments },
      { id: 'reposts', type: 'number', label: 'Reposts', min: 0, max: 1e10, value: D.reposts, showIf: (st) => st.showCounts },
      { id: 'shares', type: 'number', label: 'Shares', min: 0, max: 1e10, value: D.shares, showIf: (st) => st.showCounts },
      { id: 'showViews', type: 'toggle', label: 'Views on the media', value: D.showViews },
      { id: 'views', type: 'number', label: 'Views', min: 0, max: 1e12, value: D.views, showIf: (st) => st.showViews },
      { id: 'animCounts', type: 'toggle', label: 'Counts go up during the video', value: false },
      { id: 'countFrom', type: 'range', label: 'Start from', min: 0, max: 99, value: 70, unit: '%', showIf: (st) => st.animCounts },
    ],
  },
  {
    title: 'Comments',
    controls: [
      { id: 'showComments', type: 'toggle', label: 'Comment preview', value: D.showComments },
      { type: 'custom', el: commentsEl, showIf: (st) => st.showComments },
    ],
  },
  {
    title: 'Canvas',
    controls: [
      { id: 'size', type: 'segmented', label: 'Output', value: '9:16', options: Object.keys(SIZES).map((k) => [k, k]) },
      { id: 'frameSize', type: 'range', label: 'Frame size', min: 40, max: 150, value: 100, unit: '%', hint: '100% fits the post to the canvas. Drag the post on the preview (Move) to place it.' },
      { id: 'frameX', type: 'range', label: 'Frame horizontal', min: -50, max: 50, value: 0, unit: '%' },
      { id: 'frameY', type: 'range', label: 'Frame vertical', min: -50, max: 50, value: 0, unit: '%' },
    ],
  },
], {
  onChange: (st, id) => {
    mp.handle(st, id);
    if (id === 'size') applySize();
    if (['mediaZoom', 'mediaX', 'mediaY'].includes(id)) autoPlaced = false;
    if (id === 'preset' || (id === 'forearm' && st.preset === 'hold')) runPreset();
    if (id === 'popAmount' || (autoPlaced && ['aspect', 'size', 'frameSize', 'popScale', 'popLift', 'showAppBar', 'showHeader', 'caption', 'captionPos'].includes(id))) autoPlace();
    stage.invalidate();
    exportBar.refresh();
    syncNote();
  },
});
const s = panel.state;
mp.attach(panel);
panel.section('finetune').addEventListener('toggle', () => mp.drawMarks());

/* ---------- Uploads ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a video or photo',
  onLoad: (m) => {
    media = m;
    mp.mediaChanged(m);
    transportEl.hidden = false;
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    runPreset();
  },
  onClear: () => {
    media = null;
    presetRun++;
    presetMsg = '';
    noHand = false;
    mp.mediaChanged(null);
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    syncNote();
  },
});
createDropzone(avatarZone, {
  accept: ['image'],
  label: 'Drop a profile picture',
  onLoad: (m) => { avatar = m.el; stage.invalidate(); },
  onClear: () => { avatar = null; stage.invalidate(); },
});

/* ---------- Comments editor ---------- */
function saveComments() {
  store.set('pop-out:comments', commentList);
  renderComments();
  stage.invalidate();
}
function renderComments() {
  const btn = (ic, label, onClick, disabled) =>
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm po2-icon', 'aria-label': label, title: label, html: icon(ic), disabled, onclick: onClick });
  const rows = commentList.map((c, i) => {
    const user = h('input', { type: 'text', value: c.user, placeholder: 'username', 'aria-label': 'Username' });
    const text = h('input', { type: 'text', value: c.text, placeholder: 'Comment', 'aria-label': 'Comment' });
    user.addEventListener('input', () => { c.user = user.value; store.set('pop-out:comments', commentList); stage.invalidate(); });
    text.addEventListener('input', () => { c.text = text.value; store.set('pop-out:comments', commentList); stage.invalidate(); });
    const move = (d) => { const j = i + d; [commentList[i], commentList[j]] = [commentList[j], commentList[i]]; saveComments(); };
    return h('div', { class: 'po2-comment' }, user, text,
      btn('up', 'Move up', () => move(-1), i === 0),
      btn('down', 'Move down', () => move(1), i === commentList.length - 1),
      btn('x', 'Remove comment', () => { commentList.splice(i, 1); saveComments(); }));
  });
  commentsEl.replaceChildren(
    ...rows,
    h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('plus')} Add comment`, onclick: () => { commentList.push({ user: 'new.user', text: 'Love this' }); saveComments(); } }),
    h('div', { class: 'ctrl-hint' }, 'The rest of the Comments count shows as "and N others commented".'),
  );
}
renderComments();

/* ---------- Timing ---------- */
const duration = () => (isVideo() ? media.duration : s.clip);
const popTimes = () => String(s.popTimes || '').split(/[,;\s]+/).map(Number).filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);

/** How far the subject is popped out at stage time t, 0..1 (may overshoot slightly with back easings). */
function popAt(t) {
  if (s.popMode === 'always') return 1;
  const d = Math.max(0.05, s.popDur);
  if (s.popMode === 'animate') return t < s.popStart ? 0 : ease(s.popEasing, (t - s.popStart) / d);
  let p = 0;
  for (const at of popTimes()) {
    if (t < at) continue;
    const up = ease(s.popEasing, (t - at) / d);
    const down = 1 - ease('easeInOut', (t - at - d - s.popHold) / d);
    p = Math.max(p, Math.min(up, down));
  }
  return p;
}

function countsAt(t) {
  const c = { views: s.views, likes: s.likes, comments: s.comments, reposts: s.reposts, shares: s.shares };
  if (!s.animCounts) return c;
  const f = ease('easeOutCubic', t / Math.max(0.1, duration() * 0.95));
  const from = s.countFrom / 100;
  for (const k in c) c[k] = c[k] * (from + (1 - from) * f);
  return c;
}

/* ---------- Geometry ---------- */
const layoutCache = new Map();
function layoutAt(u, counts) {
  const key = JSON.stringify([u.toFixed(4), s.showAppBar, s.showHeader, s.caption, s.captionPos, s.captionLines, s.aspect, s.postType, s.username,
    s.showComments, s.showDate, s.dateText, Math.round(counts.comments) > commentList.length, commentList]);
  let L = layoutCache.get(key);
  if (!L) {
    if (layoutCache.size > 40) layoutCache.clear();
    L = layoutPost(ctx, s, u, { comments: commentList, counts });
    layoutCache.set(key, L);
  }
  return L;
}

/** Post position, media rectangle and where the source frame is drawn (all canvas px) at source time srcT. */
function geo(counts = countsAt(0), srcT = null) {
  const W = canvas.width, H = canvas.height;
  const L1 = layoutAt(1, counts);
  const fitU = Math.min((W * 0.96) / 1080, (H * 0.96) / L1.total);
  const u = fitU * (s.frameSize / 100);
  const L = layoutAt(u, counts);
  const fw = 1080 * u, fh = L.total * u;
  const x = (W - fw) / 2 + (s.frameX / 100) * W;
  const y = (H - fh) / 2 + (s.frameY / 100) * H;
  const r = mediaRect(L, x, y, u);
  let src = { ...r };
  if (media) {
    const f = fit(media.width, media.height, r.w, r.h, 'cover');
    const z = s.mediaZoom;
    src = { w: f.w * z, h: f.h * z };
    src.x = r.x + (r.w - src.w) / 2 + s.mediaX * r.w;
    src.y = r.y + (r.h - src.h) / 2 + s.mediaY * r.h;
    const d = srcT != null && s.follow && isVideo() ? followAt(srcT) : null;
    if (d) {
      // Keep the subject's top where it is at the median frame; stay covering the media rect.
      src.x = clamp(src.x - d.dx * src.w, Math.min(r.x, r.x + r.w - src.w), Math.max(r.x, r.x + r.w - src.w));
      src.y = clamp(src.y - d.dy * src.h, Math.min(r.y, r.y + r.h - src.h), Math.max(r.y, r.y + r.h - src.h));
    }
  }
  return { W, H, L, u, x, y, fw, fh, r, src };
}

function applySize() {
  const [w, hh] = SIZES[s.size] || SIZES['9:16'];
  if (canvas.width !== w || canvas.height !== hh) { canvas.width = w; canvas.height = hh; }
  layoutCache.clear();
}

/* ---------- Rendering ---------- */
function drawPlaceholder(c, r, k) {
  const g = c.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  g.addColorStop(0, '#3a2f7a');
  g.addColorStop(1, '#0f5f73');
  c.fillStyle = g;
  c.fillRect(r.x, r.y, r.w, r.h);
  c.fillStyle = 'rgba(255,255,255,.85)';
  c.font = `600 ${44 * k}px ${FONT}`;
  c.textAlign = 'center';
  c.textBaseline = 'middle';
  c.fillText('Your video here', r.x + r.w / 2, r.y + r.h / 2);
  c.textAlign = 'left';
}

/**
 * The subject's typical box over the clip (median of the masked frames), cached per mask version. The pop grows
 * the media around its centre; a per-frame box would make the background wobble as the subject moves.
 */
let anchorCache = { v: -1, box: null };
function subjectBox() {
  if (anchorCache.v === track.version) return anchorCache.box;
  const boxes = isVideo() ? track.timeline().map((f) => track.box(f.t)).filter(Boolean) : [track.box(0)].filter(Boolean);
  const med = (k) => { const v = boxes.map((b) => b[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
  const box = boxes.length ? { cx: med('cx'), cy: med('cy'), y: med('y'), x: med('x'), w: med('w'), h: med('h'), tx: med('tx') } : null;
  anchorCache = { v: track.version, box };
  return box;
}

/**
 * Follow the subject: per sampled frame, how far the top of the subject (box.tx, box.y) is from its median, after a
 * median filter (±0.3 s: a frame where the mask grabbed something else doesn't jerk the picture), smoothed over ±0.5 s
 * and capped at FOLLOW_MAX of the source. Cached per mask version.
 */
const FOLLOW_MAX = 0.4;
let followCache = { v: -1, list: null };
function followCurve() {
  if (followCache.v === track.version) return followCache.list;
  const med = subjectBox();
  const tl = isVideo() && med ? track.timeline() : [];
  const raw = tl.map((f) => { const b = track.box(f.t); return b ? { x: b.tx ?? b.cx, y: b.y } : null; });
  let list = null;
  if (raw.some(Boolean)) {
    for (let i = 0; i < raw.length; i++) raw[i] ||= raw.slice(0, i).reverse().find(Boolean) || raw.slice(i).find(Boolean);
    const fps = track.grid?.fps || 10;
    const M = Math.max(1, Math.round(0.3 * fps)), R = Math.max(1, Math.round(0.5 * fps));
    const median = (k, i) => { const v = raw.slice(Math.max(0, i - M), i + M + 1).map((q) => q[k]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const robust = raw.map((_, i) => ({ x: median('x', i), y: median('y', i) }));
    list = robust.map((_, i) => {
      let sx = 0, sy = 0, sw = 0;
      for (let j = Math.max(0, i - R); j <= Math.min(robust.length - 1, i + R); j++) {
        const w = R + 1 - Math.abs(j - i);
        sx += robust[j].x * w; sy += robust[j].y * w; sw += w;
      }
      return { t: tl[i].t, dx: clamp(sx / sw - (med.tx ?? med.cx), -FOLLOW_MAX, FOLLOW_MAX), dy: clamp(sy / sw - med.y, -FOLLOW_MAX, FOLLOW_MAX) };
    });
  }
  followCache = { v: track.version, list };
  return list;
}
function followAt(t) {
  const list = followCurve();
  if (!list?.length) return null;
  const g = track.grid;
  const u = clamp((t - g.start) * g.fps, 0, list.length - 1);
  const a = list[Math.floor(u)], b = list[Math.min(list.length - 1, Math.floor(u) + 1)], f = u - Math.floor(u);
  return { dx: a.dx + (b.dx - a.dx) * f, dy: a.dy + (b.dy - a.dy) * f };
}

/** The cut-out subject at the pop rect, limited to the allowed edges, on its shadow (post.js). */
function drawSubject(g, srcT, p, k) {
  const { shown } = g;
  const cap = Math.min(1, 2048 / Math.max(shown.w, shown.h));
  const a = mp.alpha(srcT, shown.w * cap, shown.h * cap, k * cap);
  if (!a) return;
  drawPopped(ctx, {
    source: media.el, alpha: a, r: g.r, src: shown, p, k, reach: s.popLimit, fade: s.popFade,
    edges: { top: s.edgeTop, bottom: s.edgeBottom, sides: s.edgeSides },
    shadow: s.shadow ? { blur: s.shadowBlur, offset: s.shadowOffset, opacity: s.shadowOpacity } : null,
  });
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080;
  const counts = countsAt(t);
  const g = geo(counts, isVideo() ? media.el.currentTime : null);
  lastGeo = g;
  const p = media ? popAt(t) : 0;
  // The media and the cut-out share this rect: popping moves both, so the subject never shows twice.
  g.shown = p > 0.001 ? popRect({ r: g.r, src: g.src, box: subjectBox(), p, k, scale: s.popScale / 100, lift: s.popLift }) : g.src;
  const th = THEMES[s.theme] || THEMES.dark;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = th.bg;
  ctx.fillRect(0, 0, W, H);
  drawPost(ctx, g.L, s, g.x, g.y, g.u, { counts, avatar, comments: commentList });
  ctx.save();
  ctx.beginPath(); ctx.rect(g.r.x, g.r.y, g.r.w, g.r.h); ctx.clip();
  if (media) {
    ctx.fillStyle = '#000';
    ctx.fillRect(g.r.x, g.r.y, g.r.w, g.r.h);
    ctx.drawImage(media.el, g.shown.x, g.shown.y, g.shown.w, g.shown.h);
  } else drawPlaceholder(ctx, g.r, k);
  ctx.restore();
  if (s.showViews) drawViews(ctx, g.r, g.u, counts.views);
  if (media && p > 0.001) drawSubject(g, isVideo() ? media.el.currentTime : 0, p, k);
  if (!exportKind) mp.drawMarks();
}

/* ---------- Presets ---------- */
/**
 * Zoom and pan the media so that, fully popped, the top of the subject (median over the clip) reaches
 * "Pop-out amount" above the media's top edge, with that top part centred horizontally (box.tx), while the media
 * still covers its rectangle. At rest the top sits lower (inside or at the edge); the pop carries it out.
 */
function autoPlace() {
  const box = media && subjectBox();
  if (!box) return;
  const k = Math.min(canvas.width, canvas.height) / 1080;
  const { r } = geo();
  const f = fit(media.width, media.height, r.w, r.h, 'cover');
  const a = s.popAmount / 100;
  const top = clamp(box.y, 0, 0.9);
  const z = clamp(Math.max(1, (r.h * (1 + a)) / (1 - top) / f.h) * 1.02, 1, 3);
  const w = f.w * z, hh = f.h * z;
  const x = clamp(r.x + r.w / 2 - (box.tx ?? box.cx) * w, r.x + r.w - w, r.x);
  // Where the top lands depends on the pop's grow/lift (and the extra grow that keeps the media covering), so
  // solve for the rest position by measuring the popped rect a few times.
  const target = r.y - a * r.h;
  let y = clamp(target - top * hh, r.y + r.h - hh, r.y);
  for (let i = 0; i < 4; i++) {
    const shown = popRect({ r, src: { x, y, w, h: hh }, box, p: 1, k, scale: s.popScale / 100, lift: s.popLift });
    y = clamp(y - (shown.y + top * shown.h - target), r.y + r.h - hh, r.y);
  }
  const r3 = (v) => Math.round(v * 1000) / 1000;
  panel.set({
    mediaZoom: Math.round(z * 100) / 100,
    mediaX: clamp(r3((x - r.x - (r.w - w) / 2) / r.w), -PAN, PAN),
    mediaY: clamp(r3((y - r.y - (r.h - hh) / 2) / r.h), -PAN, PAN),
  }, { silent: true });
  autoPlaced = true;
  stage.invalidate();
}

/** Is there a subject in most masked frames (not just a stray blob here and there)? */
function subjectFound() {
  if (!isVideo()) return (track.box(0)?.area || 0) > 0.003;
  const tl = track.timeline();
  return tl.filter((f) => (track.box(f.t)?.area || 0) > 0.003).length >= tl.length * 0.4;
}

/** Run the chosen preset on the current media: masks, then placement. Called on upload and on preset changes. */
async function runPreset() {
  const run = presetRun + 1;
  try {
    await presetSteps();
  } catch (err) {
    console.error(err);
    if (run !== presetRun) return;
    presetMsg = `The preset failed (${err.message || err}). Try another preset, or Custom.`;
    syncNote();
  }
}

async function presetSteps() {
  if (!media) return;
  const run = ++presetRun;
  const stale = () => run !== presetRun || !media;
  stage.pause();
  noHand = false;
  presetMsg = s.preset === 'hold' ? 'Finding the hand…' : s.preset === 'person' ? 'Finding the person…' : '';
  syncNote();
  let found = '';
  const mode = MASK_MODE[s.preset];
  if (s.mkMode !== mode) { panel.set({ mkMode: mode }, { silent: true }); mp.handle(s, 'mkMode'); }
  if (s.preset === 'custom') {
    presetMsg = 'Click the subject on the preview, then press Track subject.';
    panel.section('finetune').open = true;
    syncNote();
    return;
  }
  if (s.preset === 'person') track.clearPoints();
  if (s.preset === 'hold') {
    if (isVideo()) track.setGrid(0, media.duration, +s.mkRate);
    const times = isVideo() ? track.timeline().map((f) => f.t) : [0];
    const ctrl = new AbortController();
    const modal = progressModal('Finding the hand…', () => ctrl.abort(), 'Hand and body landmarks on each sampled frame. The models (13 MB) download once.');
    let frames = null;
    try {
      frames = await findHands(media, times, { onProgress: modal.set, signal: ctrl.signal });
    } catch (err) {
      console.error(err);
      toast(`Hand tracking failed to load: ${err.message || err}. Try the Person preset.`, 'error', 7000);
    } finally { modal.close(); }
    if (stale() || !frames) { syncNote(); return; }
    const keys = holdPrompts(frames, media, { forearm: s.forearm });
    if (!keys.length) {
      noHand = true;
      track.clearPoints();
      presetMsg = '';
      toast('No hand found. Try the Person preset, or Custom to click the subject.', 'error', 7000);
      syncNote();
      return;
    }
    track.setKeyframes(keys);
    found = isVideo() ? `Hand found in ${keys.length} of ${frames.length} frames.` : 'Hand found.';
    presetMsg = found;
  }
  syncNote();
  const ok = await mp.run();
  if (stale()) return;
  if (!ok) {
    presetMsg = 'Masking didn\'t finish. Press Track subject in Fine-tune to finish it.';
    syncNote();
    return;
  }
  if (!subjectFound()) {
    presetMsg = s.preset === 'person' ? 'No person found. Try Custom and click the subject.' : 'Nothing was cut out. Try the Person or Custom preset.';
    syncNote();
    return;
  }
  autoPlace();
  presetMsg = `${found ? `${found} ` : ''}Done: the subject pops out of the top. Fine-tune below to adjust.`;
  syncNote();
  stage.seek(0);
  stage.play().catch(() => {});
}

const stage = createStage({
  canvas,
  transport: transportEl,
  render,
  getDuration: duration,
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `${(media?.name || 'post').replace(/\.[^.]+$/, '')}-pop-out`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  hint: () => (media && isVideo() ? 'Video export plays the clip once in real time with its sound.' : ''),
  beforeExport: () => {
    mp.ensureReady();
    exportKind = true;
    marks.getContext('2d').clearRect(0, 0, marks.width, marks.height);
  },
  afterExport: () => { exportKind = null; stage.invalidate(); },
});

/* ---------- Dragging the media and the post (Move tool) ---------- */
let drag = null;
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
};
const inside = (p, r) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
canvas.addEventListener('pointerdown', (e) => {
  if (mp.tool !== 'move' || e.button !== 0) return;
  const g = lastGeo || geo();
  const p = toCanvas(e);
  const what = inside(p, g.r) && media ? 'media' : inside(p, { x: g.x, y: g.y, w: g.fw, h: g.fh }) ? 'frame' : null;
  if (!what) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drag = { what, p, g, start: { mediaX: s.mediaX, mediaY: s.mediaY, frameX: s.frameX, frameY: s.frameY } };
  canvas.classList.add('po2-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  const p = toCanvas(e);
  if (!drag) {
    const g = lastGeo;
    canvas.classList.toggle('po2-movable', mp.tool === 'move' && !!g && inside(p, { x: g.x, y: g.y, w: g.fw, h: g.fh }));
    return;
  }
  const dx = p.x - drag.p.x, dy = p.y - drag.p.y;
  const r2 = (v) => Math.round(v * 1000) / 1000;
  if (drag.what === 'media') {
    autoPlaced = false;
    panel.set({ mediaX: clamp(r2(drag.start.mediaX + dx / drag.g.r.w), -PAN, PAN), mediaY: clamp(r2(drag.start.mediaY + dy / drag.g.r.h), -PAN, PAN) }, { silent: true });
  } else {
    panel.set({ frameX: clamp(Math.round(drag.start.frameX + (dx / drag.g.W) * 100), -50, 50), frameY: clamp(Math.round(drag.start.frameY + (dy / drag.g.H) * 100), -50, 50) }, { silent: true });
  }
  stage.invalidate();
});
const endDrag = () => { drag = null; canvas.classList.remove('po2-dragging'); };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

/* ---------- Notes on the preview ---------- */
function syncNote() {
  overlay.classList.add('is-note');
  let text = '';
  if (!media) text = 'Drop a video or photo on the left. Best: someone holding something up toward the camera.';
  else if (noHand) text = 'No hand found. Try the Person preset, or Custom to click the subject.';
  else if (s.preset === 'custom' && track.mode === 'object' && !track.hasPoints) text = 'Click the subject on the preview to cut it out.';
  else if (s.preset === 'custom' && isVideo() && track.staleCount()) text = 'Press Track subject (Fine-tune) so the subject can pop out of the frame.';
  overlay.hidden = !text;
  overlay.replaceChildren(h('div', {}, text));
  const pick = (id, label) => h('button', { type: 'button', class: 'btn btn-sm', onclick: () => panel.set({ preset: id }) }, label);
  presetNote.classList.toggle('is-error', noHand);
  presetNote.replaceChildren(...(noHand
    ? [h('div', {}, 'No hand found in this clip.'), h('div', { class: 'po2-preset-actions' }, pick('person', 'Use Person'), pick('custom', 'Use Custom'))]
    : presetMsg ? [h('div', {}, presetMsg)] : []));
  presetNote.hidden = !noHand && !presetMsg;
}

applySize();
syncNote();
