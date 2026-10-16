/**
 * The shared "Subject" panel for tools built on lib/object-mask.js (Pop Out, Magic Mask): mode, clicks and
 * brush on the preview, the masking pass with a progress bar, a per-frame status strip, and the edge controls.
 *
 *   const mp = createMaskPanel({
 *     track,                         // createMaskTrack(prefix)
 *     canvas, marks,                 // the preview canvas and a canvas stacked on it (never exported)
 *     sourceRect: () => ({ x, y, w, h }),  // where the source frame sits on the preview, in canvas px
 *     getTime: () => seconds,        // source time of the frame on screen
 *     getRange: () => [start, end],  // source seconds the masking pass covers
 *     seek: (t) => {},               // move the playhead to source time t (status strip clicks)
 *     pause: () => {},               // stop playback before a click edits the frame
 *     moveLabel: 'Move',             // optional: first "On preview" option, left to the tool's own dragging
 *     onChange: () => {},            // masks or mask settings changed: redraw
 *     onBusy: (busy) => {},          // optional: the panel is seeking the source (masking pass) — don't move it
 *     showMode: (state) => true,     // optional: hide the "Cut out" mode picker (a tool preset sets mkMode itself)
 *     showPoints: () => true,        // optional: false hides the click marks (e.g. prompts a preset placed, until Fine-tune opens)
 *     autoRun: true,                 // optional: false = photos aren't segmented on upload / mode change (the tool runs mp.run())
 *   });
 *   createControls(root, [...toolSections, ...mp.sections], { onChange: (s, id) => { mp.handle(s, id); … } });
 *   mp.attach(panel);                // once the panel exists
 *   mp.mediaChanged(media);          // after an upload (or null)
 *   const a = mp.alpha(t, w, h, k);  // the refined mask for the source frame at w×h (k = output scale)
 *   mp.ensureReady();                // throws a readable Error when the export range has no masks yet
 *
 * Control ids are prefixed `mk` so they never clash with the tool's own.
 */
import { h, icon, toast, formatBytes, formatTime } from './dom.js';
import { progressModal } from './exporter.js';
import { MASK_MODES, objectPlan } from './object-mask.js';
import { clamp } from './easing.js';
import { scratch } from './canvas.js';

const MODE_HINTS = {
  person: 'Everyone in frame, found automatically. Fast.',
  object: 'Click the subject on the preview (a hand, a sign, a product). Click what to leave out with Remove, or hold Alt/Option.',
  both: 'The person plus what you click (e.g. the sign they hold up). Click the object on the preview.',
};

export function createMaskPanel(opts) {
  const { track, canvas, marks, sourceRect, getTime, getRange, seek, pause, onChange } = opts;
  const mctx = marks.getContext('2d');
  let s = null;          // panel state (after attach)
  let pointer = null;    // last pointer position on the preview, canvas px
  let painting = false;
  let status = '';
  let confirmed = false; // object model download accepted this session
  let refreshing = false, again = false;

  const actions = h('div', { class: 'mask-actions' });
  const note = h('div', { class: 'ctrl-hint mask-status' });
  const strip = h('canvas', { class: 'mask-strip', height: 22, 'aria-label': 'Masked frames (click to jump)' });
  const isVideo = () => track.media?.kind === 'video';
  const isPhoto = () => track.media?.kind === 'image';
  const tool = () => s?.mkTool || 'keep';
  const clicking = () => ['keep', 'remove'].includes(tool()) && track.mode !== 'person';
  const brushing = () => ['add', 'erase'].includes(tool());
  const showMode = (st) => (opts.showMode ? opts.showMode(st) : true);

  const toolOptions = [
    ...(opts.moveLabel ? [['move', opts.moveLabel]] : []),
    ['keep', 'Keep'], ['remove', 'Remove'], ['add', 'Paint'], ['erase', 'Erase'],
  ];

  const sections = [
    {
      title: 'Subject',
      controls: [
        { id: 'mkMode', type: 'segmented', label: 'Cut out', value: opts.mode || 'person', options: MASK_MODES, showIf: (st) => showMode(st) },
        ...Object.entries(MODE_HINTS).map(([m, text]) => ({ type: 'custom', el: h('div', { class: 'ctrl-hint' }, text), showIf: (st) => st.mkMode === m && showMode(st) })),
        {
          id: 'mkTool', type: 'segmented', label: 'On the preview', value: opts.moveLabel ? 'move' : 'keep', options: toolOptions,
          hint: 'Keep / Remove: click points (object modes). Paint / Erase: brush the mask by hand.',
        },
        { id: 'mkBrush', type: 'range', label: 'Brush size', min: 4, max: 240, value: 50, unit: 'px', showIf: (st) => ['add', 'erase'].includes(st.mkTool) },
        { id: 'mkBrushSoft', type: 'range', label: 'Brush softness', min: 0, max: 1, step: 0.05, value: 0.5, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => ['add', 'erase'].includes(st.mkTool) },
        {
          id: 'mkScope', type: 'segmented', label: 'Brush applies to', value: 'onward', options: [['onward', 'From here on'], ['frame', 'This frame']],
          showIf: (st) => ['add', 'erase'].includes(st.mkTool) && isVideo(),
          hint: 'From here on follows the subject until the next correction.',
        },
        {
          id: 'mkRate', type: 'segmented', label: 'Masking pass', value: '10', options: [['5', '5 / s'], ['10', '10 / s'], ['15', '15 / s'], ['30', '30 / s']],
          showIf: () => isVideo(),
          hint: 'Frames per second the pass segments. More follows fast motion better and takes longer.',
        },
        { type: 'custom', el: actions },
        { type: 'custom', el: note },
        { type: 'custom', el: strip, showIf: () => isVideo() },
      ],
    },
    {
      title: 'Mask edges',
      controls: [
        { id: 'mkThreshold', type: 'range', label: 'Threshold', min: 0.1, max: 0.9, step: 0.01, value: 0.5, decimals: 2, hint: 'Higher keeps less of the subject.' },
        { id: 'mkSoftness', type: 'range', label: 'Edge softness', min: 0.01, max: 0.6, step: 0.01, value: 0.15, decimals: 2 },
        { id: 'mkGrow', type: 'range', label: 'Expand / shrink', min: -30, max: 30, value: 0, unit: 'px' },
        { id: 'mkFeather', type: 'range', label: 'Feather', min: 0, max: 30, value: 2, unit: 'px' },
        { id: 'mkSmooth', type: 'range', label: 'Smooth over time', min: 0, max: 1, step: 0.05, value: 0.35, format: (v) => `${Math.round(v * 100)}%`, showIf: () => isVideo(), hint: 'Averages neighbouring frames (no lag) to stop edge flicker.' },
        { id: 'mkSnap', type: 'toggle', label: 'Snap edges to the photo', value: true, showIf: () => isPhoto() },
        { id: 'mkShow', type: 'toggle', label: 'Show mask overlay', value: false },
      ],
    },
  ];

  /* ---------- Buttons and status ---------- */
  function renderActions() {
    const btn = (label, ic, onClick, enabled, primary) =>
      h('button', { type: 'button', class: `btn btn-sm${primary ? ' btn-primary' : ''}`, html: `${icon(ic)} ${label}`, disabled: !enabled, onclick: onClick });
    const media = track.media;
    const stale = media ? track.staleCount() : 0;
    actions.replaceChildren(
      isVideo() && btn(stale ? 'Track subject' : 'Tracked', stale ? 'target' : 'check', () => runPass(), !!media && stale > 0 && canRun(), true),
      btn('Undo', 'restart', () => { track.undo(); afterEdit(true); }, track.canUndo),
      btn('Clear clicks', 'trash', () => { track.clearPoints(); afterEdit(true); }, track.hasPoints),
      btn('Clear brush', 'trash', () => { track.clearStrokes(); afterEdit(false); }, track.hasStrokes),
    );
    let text = status;
    if (!text && media) {
      if (track.mode === 'object' && !track.hasPoints) text = 'Click the subject on the preview to start.';
      else if (isVideo()) {
        const tl = track.timeline();
        const warn = tl.filter((f) => f.state === 'warn').length;
        const [a, b] = getRange();
        text = stale
          ? `${stale} of ${tl.length} frames to mask (${formatTime(a)}–${formatTime(b)}). Press Track subject.`
          : `${tl.length} frames masked.${warn ? ` ${warn} look unsure (amber): add a Keep or Remove click there to correct from that frame on.` : ''}`;
      } else if (!track.ready(0)) text = 'Finding the subject…';
    }
    note.textContent = text;
    drawStrip();
  }
  const canRun = () => track.mode !== 'object' || track.hasPoints;

  function drawStrip() {
    if (!isVideo()) return;
    const tl = track.timeline();
    const W = Math.max(60, Math.round(strip.clientWidth || 260));
    if (strip.width !== W * 2) { strip.width = W * 2; strip.height = 44; }
    const c = strip.getContext('2d');
    const css = getComputedStyle(strip);
    const col = (v, f) => css.getPropertyValue(v).trim() || f;
    c.clearRect(0, 0, strip.width, strip.height);
    const dur = track.media?.duration || 1;
    const x = (t) => (t / dur) * strip.width;
    c.fillStyle = col('--surface-2', '#ddd');
    c.fillRect(0, 10, strip.width, 24);
    const step = tl.length > 1 ? tl[1].t - tl[0].t : 0.1;
    const colors = { todo: col('--border', '#bbb'), ok: '#2fbf71', warn: '#f5a524', empty: col('--surface-2', '#eee') };
    for (const f of tl) {
      c.fillStyle = colors[f.state];
      c.fillRect(x(f.t - step / 2), 12, Math.max(1, x(f.t + step / 2) - x(f.t - step / 2) - 0.5), 20);
    }
    c.fillStyle = col('--accent', '#7c6cff');
    for (const f of tl) if (f.key) { c.beginPath(); c.moveTo(x(f.t) - 6, 0); c.lineTo(x(f.t) + 6, 0); c.lineTo(x(f.t), 9); c.fill(); }
    c.fillStyle = col('--text-color', '#111');
    c.fillRect(x(getTime()) - 1.5, 6, 3, 32);
  }
  strip.addEventListener('click', (e) => {
    if (!track.media) return;
    const r = strip.getBoundingClientRect();
    seek?.(clamp((e.clientX - r.left) / r.width) * track.media.duration);
  });

  /* ---------- Models ---------- */
  function ask(mb, device) {
    return new Promise((resolve) => {
      const done = (v) => { modal.remove(); resolve(v); };
      const modal = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Download the selection model' },
        h('div', { class: 'modal' },
          h('h2', {}, 'Download the selection model?'),
          h('p', {}, `Object mode clicks run SAM 2.1 (${mb} MB). It downloads once from Hugging Face and stays in your browser. Your video never leaves your device.${device === 'webgpu' ? '' : ' No WebGPU here: it runs on the CPU, so each frame takes a few seconds.'}`),
          h('div', { class: 'modal-actions' },
            h('button', { class: 'btn', type: 'button', onclick: () => done(false) }, 'Cancel'),
            h('button', { class: 'btn btn-primary', type: 'button', onclick: () => done(true) }, `Download ${mb} MB`))));
      document.body.append(modal);
    });
  }

  /** Load what the mode needs, asking before the object model's first download. False when declined. */
  async function ensureModels() {
    if (track.needs().object) {
      const plan = await objectPlan();
      if (!plan.cached && !confirmed) {
        if (!(await ask(Math.round(plan.bytes / 1e6), plan.device))) return false;
        confirmed = true;
      }
      if (!plan.cached) {
        const ctrl = new AbortController();
        const modal = progressModal('Downloading the selection model…', () => ctrl.abort(), `${formatBytes(plan.bytes)}, once. It's cached for next time.`);
        try {
          await track.ensure({ onDownload: (l, t) => modal.set(l / t) });
        } finally { modal.close(); }
        return true;
      }
    }
    setStatus(track.needs().person ? 'Loading the person model…' : 'Loading the selection model…');
    try { await track.ensure(); } finally { setStatus(''); }
    return true;
  }

  function setStatus(text) { status = text; renderActions(); }

  /* ---------- Masking pass ---------- */
  async function runPass() {
    if (!track.media) return false;
    pause?.();
    opts.onBusy?.(true);
    try {
      if (!(await ensureModels())) return false;
      if (isVideo()) track.setGrid(...getRange(), +s.mkRate);
      const ctrl = new AbortController();
      const modal = progressModal(isVideo() ? 'Masking the subject…' : 'Finding the subject…', () => ctrl.abort(),
        isVideo() ? 'Segmenting every sampled frame once. Afterwards playback and exports use the stored masks.' : 'One moment.');
      let ok;
      try {
        ok = await track.run({ onProgress: modal.set, signal: ctrl.signal });
      } finally { modal.close(); }
      if (!ok) toast('Masking stopped. Press Track subject to finish the remaining frames.');
      return ok;
    } catch (err) {
      console.error(err);
      toast(`Masking failed: ${err.message || err}`, 'error', 7000);
      return false;
    } finally {
      opts.onBusy?.(false);
      afterEdit(false);
    }
  }

  /** Re-segment the frame on screen after a click; one request at a time, the latest clicks win. */
  async function refreshNow() {
    if (refreshing) { again = true; return; }
    refreshing = true;
    try {
      if (!(await ensureModels())) return;
      do {
        again = false;
        if (isVideo()) track.setGrid(...getRange(), +s.mkRate);
        setStatus('Updating the mask…');
        await track.refreshFrame(getTime());
      } while (again);
    } catch (err) {
      console.error(err);
      toast(`Selection failed: ${err.message || err}`, 'error', 7000);
    } finally {
      refreshing = false;
      setStatus('');
      onChange?.();
      drawMarks();
    }
  }

  function afterEdit(points) {
    renderActions();
    onChange?.();
    drawMarks();
    if (points && track.media && canRun()) refreshNow();
  }

  /* ---------- Pointer ---------- */
  const toCanvas = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
  };
  const toSource = (p) => {
    const r = sourceRect();
    return { x: (p.x - r.x) / r.w, y: (p.y - r.y) / r.h };
  };
  const pxScale = () => canvas.width / (canvas.getBoundingClientRect().width || canvas.width);

  canvas.addEventListener('pointerdown', (e) => {
    if (!track.media || !s || e.button !== 0) return;
    const p = toCanvas(e);
    const q = toSource(p);
    if (clicking()) {
      if (q.x < 0 || q.y < 0 || q.x > 1 || q.y > 1) return;
      e.preventDefault();
      pause?.();
      if (isVideo()) track.setGrid(...getRange(), +s.mkRate);
      const r = sourceRect();
      const near = (14 * pxScale()) / r.w;
      if (!track.removePointNear(getTime(), q.x, q.y, near)) {
        const keep = tool() === 'keep' && !e.altKey;
        if (!track.addPoint(getTime(), { ...q, keep })) { toast('Move the playhead inside the masked range first.'); return; }
      }
      afterEdit(true);
    } else if (brushing()) {
      if (!track.ready(getTime())) { toast(isVideo() ? 'Track the subject first, then touch up the mask.' : 'Wait for the mask, then touch it up.'); return; }
      e.preventDefault();
      pause?.();
      canvas.setPointerCapture(e.pointerId);
      painting = true;
      const r = sourceRect();
      track.beginStroke(getTime(), tool(), (s.mkBrush * kOf()) / 2 / r.w, s.mkBrushSoft, s.mkScope);
      track.strokeTo(q.x, q.y);
      onChange?.();
    }
  });
  canvas.addEventListener('pointermove', (e) => {
    pointer = toCanvas(e);
    if (painting) {
      const q = toSource(pointer);
      track.strokeTo(q.x, q.y);
      onChange?.();
    }
    if (brushing()) drawMarks();
  });
  const end = () => {
    if (!painting) return;
    painting = false;
    track.endStroke();
    renderActions();
    onChange?.();
  };
  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);
  canvas.addEventListener('pointerleave', () => { pointer = null; drawMarks(); });
  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey && track.canUndo
      && !/input|textarea|select/i.test(document.activeElement?.tagName || '')) {
      e.preventDefault();
      track.undo();
      afterEdit(true);
    }
  });

  const kOf = () => Math.min(canvas.width, canvas.height) / 1080;

  /* ---------- Marks overlay ---------- */
  function placeMarks() {
    Object.assign(marks.style, {
      left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`,
      width: `${canvas.offsetWidth}px`, height: `${canvas.offsetHeight}px`,
    });
    drawMarks();
  }
  new ResizeObserver(placeMarks).observe(canvas);
  window.addEventListener('resize', placeMarks);

  function drawMarks() {
    const W = canvas.width, H = canvas.height;
    if (marks.width !== W || marks.height !== H) { marks.width = W; marks.height = H; }
    mctx.clearRect(0, 0, W, H);
    drawStrip();
    if (!track.media || !s || opts.hidden?.()) return;
    const q = pxScale();
    const r = sourceRect();
    const t = getTime();
    if (s.mkShow || brushing()) {
      const a = alpha(t, r.w, r.h, kOf());
      if (a) {
        const tint = scratch('mask-panel-tint', a.width, a.height);
        const tx = tint.getContext('2d');
        tx.globalCompositeOperation = 'source-over';
        tx.clearRect(0, 0, tint.width, tint.height);
        tx.drawImage(a, 0, 0);
        tx.globalCompositeOperation = 'source-in';
        tx.fillStyle = 'rgb(124,108,255)';
        tx.fillRect(0, 0, tint.width, tint.height);
        mctx.globalAlpha = 0.5;
        mctx.drawImage(tint, r.x, r.y, r.w, r.h);
        mctx.globalAlpha = 1;
      }
    }
    if (track.mode !== 'person' && (opts.showPoints?.() ?? true)) {
      const { points, key } = track.pointsAt(t);
      for (const pt of points) {
        const x = r.x + pt.x * r.w, y = r.y + pt.y * r.h, rad = 8 * q;
        mctx.globalAlpha = key ? 1 : 0.55;
        mctx.fillStyle = pt.keep ? '#2fbf71' : '#e5484d';
        mctx.strokeStyle = '#fff';
        mctx.lineWidth = 2 * q;
        mctx.setLineDash(key ? [] : [3 * q, 3 * q]);
        mctx.beginPath(); mctx.arc(x, y, rad, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
        mctx.setLineDash([]);
        mctx.beginPath();
        mctx.moveTo(x - rad * 0.5, y); mctx.lineTo(x + rad * 0.5, y);
        if (pt.keep) { mctx.moveTo(x, y - rad * 0.5); mctx.lineTo(x, y + rad * 0.5); }
        mctx.stroke();
      }
      mctx.globalAlpha = 1;
    }
    if (brushing() && pointer) {
      const rad = (s.mkBrush * kOf()) / 2;
      mctx.lineWidth = 1.5 * q;
      mctx.strokeStyle = 'rgba(0,0,0,.6)';
      mctx.beginPath(); mctx.arc(pointer.x, pointer.y, rad + q, 0, Math.PI * 2); mctx.stroke();
      mctx.strokeStyle = tool() === 'add' ? '#ffffff' : '#ff6b6b';
      mctx.beginPath(); mctx.arc(pointer.x, pointer.y, rad, 0, Math.PI * 2); mctx.stroke();
    }
  }

  /** The refined mask (w×h over the source frame) for source time t; k scales the px sliders. */
  function alpha(t, w, hh, k = 1) {
    if (!s) return null;
    return track.alpha(t, w, hh, {
      threshold: s.mkThreshold, softness: s.mkSoftness, grow: s.mkGrow * k, feather: s.mkFeather * k,
      smooth: isVideo() ? s.mkSmooth : 0, edgeSnap: s.mkSnap,
    });
  }

  function syncCursor() {
    canvas.classList.toggle('mask-picking', !!track.media && (clicking() || brushing()));
  }

  return {
    sections,
    get state() { return s; },
    get tool() { return tool(); },
    attach(panel) { s = panel.state; track.mode = s.mkMode; renderActions(); syncCursor(); },
    /** Forward the panel's onChange here. */
    handle(st, id) {
      if (id === 'mkMode') {
        track.mode = st.mkMode;
        if (isPhoto() && canRun() && opts.autoRun !== false) runPass();
      }
      if (id === 'mkRate' && isVideo()) track.setGrid(...getRange(), +st.mkRate);
      renderActions();
      syncCursor();
      drawMarks();
    },
    /** After an upload (or clear). Photos in person mode are segmented right away. */
    mediaChanged(media) {
      track.setMedia(media);
      if (media?.kind === 'video' && s) track.setGrid(...getRange(), +s.mkRate);
      status = '';
      renderActions();
      syncCursor();
      drawMarks();
      if (media?.kind === 'image' && canRun() && opts.autoRun !== false) runPass();
    },
    /** The source range changed (trim): resample the grid, keeping what's done where frames line up. */
    rangeChanged() { if (isVideo() && s) { track.setGrid(...getRange(), +s.mkRate); renderActions(); } },
    alpha,
    drawMarks,
    refresh: renderActions,
    run: runPass,
    /** Throw a readable error when exporting would show frames without a mask. */
    ensureReady() {
      if (!track.media) return;
      if (track.mode === 'object' && !track.hasPoints) throw new Error('Click the subject on the preview first.');
      if (isVideo()) {
        track.setGrid(...getRange(), +s.mkRate);
        if (track.staleCount()) throw new Error('Press Track subject first, so every frame has a mask.');
      } else if (!track.ready(0)) throw new Error('Still finding the subject. Try again in a moment.');
    },
  };
}
