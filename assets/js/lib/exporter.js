/**
 * Export helpers. Every tool gets the same three exports from one bar:
 *   Export video: records the stage canvas in real time (MediaRecorder + captureStream), with audio.
 *   Export GIF:   renders the stage frame by frame (seeking any video) and encodes it with gifenc.
 *   Export PNG:   saves the current frame.
 *
 *   createExportBar(root, {
 *     stage,                              // from createStage()
 *     filename: () => 'my-clip',          // without extension
 *     getVideo: () => videoOrNull,        // source video: its audio for WebM, seeked per GIF frame
 *     getAudio: () => trackOrNull,        // or: a ready audio track (called inside the click)
 *     video / gif / png: true,            // enable each export (bool or () => bool); disabled buttons stay visible
 *     onGif: async (btn) => {},           // replace the built-in GIF export (tools with their own frame timing)
 *     primary: 'video',                   // which button is primary: 'video' | 'gif' | 'png'
 *     hint: 'Text…',                      // small note next to the buttons
 *     hasAudio: () => bool,               // show the Audio toggle (default: getVideo() returns a video)
 *     actions: [{ label, icon, onClick }],  // extra buttons placed after the standard three (e.g. ZIP)
 *     beforeExport, afterExport,          // optional hooks, run around video and built-in GIF exports (async ok)
 *   });
 */
import { h, icon, toast, downloadBlob, formatTime, formatBytes, store } from './dom.js';
import { createControls } from './controls.js';
import { loadGifenc, quantizeFrame, frameOptions, gifDelays } from './gif.js';
import { scratch } from './canvas.js';
import { audioGraph, seekVideo } from './media.js';
import { fixWebmDuration } from './webm-duration.js';

/** Shown by tools when the output has a transparent background. */
export const TRANSPARENT_HINT = 'Transparent WebM keeps alpha in Chrome/Edge; other browsers may show black. PNG keeps it fully; GIF keeps hard-edged transparency.';

export const canRecord = () =>
  typeof window.MediaRecorder !== 'undefined' && typeof HTMLCanvasElement.prototype.captureStream === 'function';

const VIDEO_TYPES = [
  'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4;codecs=avc1', 'video/mp4',
];
const AV_TYPES = [
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4',
];

export function pickMimeType(withAudio) {
  return (withAudio ? AV_TYPES : VIDEO_TYPES).find((t) => MediaRecorder.isTypeSupported(t)) || '';
}

export const extensionFor = (mime) => (mime.includes('mp4') ? 'mp4' : 'webm');

/** Save the canvas as a PNG. */
export function exportPNG(canvas, filename) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) return reject(new Error('Could not encode PNG.'));
      downloadBlob(blob, `${filename}.png`);
      resolve(blob);
    }, 'image/png');
  });
}

/**
 * Record the stage from t=0 to the end in real time.
 * Must be called from a user gesture (click) so audio can start.
 */
export async function recordStage({ stage, getVideo, getAudio, includeAudio = true, fps = 30, onProgress, signal }) {
  if (!canRecord()) throw new Error('Your browser does not support video recording (MediaRecorder). Try Chrome, Edge or Firefox.');
  const canvas = stage.canvas;
  const video = getVideo?.() || null;

  // Audio graph must be created/resumed synchronously inside the click.
  let audioTrack = null;
  if (getAudio && includeAudio) {
    try { audioTrack = getAudio(); } catch (err) { console.warn('Audio capture unavailable', err); }
  } else if (video && includeAudio) {
    try {
      const g = audioGraph(video);
      if (g) { g.ctx.resume(); audioTrack = g.track; }
    } catch (err) { console.warn('Audio capture unavailable', err); }
  }

  const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...(audioTrack ? [audioTrack] : [])]);
  const mimeType = pickMimeType(!!audioTrack);
  const pixels = canvas.width * canvas.height;
  const videoBitsPerSecond = Math.round(Math.min(20e6, Math.max(4e6, pixels * fps * 0.12)));
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType, videoBitsPerSecond } : { videoBitsPerSecond });
  const chunks = [];
  recorder.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((resolve, reject) => {
    recorder.onstop = resolve;
    recorder.onerror = (e) => reject(e.error || new Error('Recording failed.'));
  });

  stage.pause();
  stage.seek(0);
  if (video) await seekVideo(video, 0);

  const onTick = (e) => onProgress?.(e.detail.t / stage.duration);
  stage.events.addEventListener('tick', onTick);
  const ended = new Promise((resolve) => stage.events.addEventListener('ended', resolve, { once: true }));
  const aborted = new Promise((resolve) => signal?.addEventListener('abort', resolve, { once: true }));

  let startedAt = 0;
  try {
    recorder.start(250);
    startedAt = performance.now();
    await stage.play({ loop: false });
    await Promise.race([ended, aborted]);
    await new Promise((r) => setTimeout(r, 120)); // let the last frame land
  } finally {
    stage.events.removeEventListener('tick', onTick);
    stage.pause();
    if (recorder.state !== 'inactive') recorder.stop();
    stream.getVideoTracks().forEach((t) => t.stop());
  }
  const recordedMs = performance.now() - startedAt;
  await stopped;
  if (signal?.aborted) return null;
  const type = recorder.mimeType || mimeType || 'video/webm';
  const blob = await fixWebmDuration(new Blob(chunks, { type }), recordedMs);
  return { blob, ext: extensionFor(type) };
}

/* ---------- Progress modal ---------- */
export function progressModal(title, onCancel, message = 'Recording in real time. Keep this tab visible until it finishes.') {
  const bar = h('div');
  const pct = h('span', {}, '0%');
  const eta = h('span', {}, '');
  const modal = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'modal' },
      h('h2', {}, title),
      h('p', {}, message),
      h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': 0, 'aria-valuemax': 100 }, bar),
      h('div', { class: 'progress-label' }, pct, eta),
      h('div', { class: 'modal-actions' }, h('button', { class: 'btn', type: 'button', onclick: onCancel }, 'Cancel'))));
  document.body.append(modal);
  const start = performance.now();
  return {
    set(p) {
      p = Math.max(0, Math.min(1, p || 0));
      bar.style.width = `${p * 100}%`;
      bar.parentElement.setAttribute('aria-valuenow', Math.round(p * 100));
      pct.textContent = `${Math.round(p * 100)}%`;
      const elapsed = (performance.now() - start) / 1000;
      eta.textContent = p > 0.02 ? `${formatTime(Math.max(0, elapsed / p - elapsed))} left` : '';
    },
    close: () => modal.remove(),
  };
}

/* ---------- GIF ---------- */
export const GIF_WARN_FRAMES = 180;
const GIF_FPS = [['10', '10'], ['12', '12'], ['15', '15'], ['20', '20'], ['24', '24']];
const GIF_WIDTHS = [['320', '320'], ['480', '480'], ['640', '640'], ['800', '800'], ['full', 'Full']];

/** Output size for a GIF of the canvas at a width setting ('full' or px). */
export function gifSize(canvas, width) {
  const w = width === 'full' ? canvas.width : Math.min(canvas.width, +width);
  const sc = w / canvas.width;
  return [Math.max(2, Math.round(canvas.width * sc)), Math.max(2, Math.round(canvas.height * sc))];
}

/**
 * Settings dialog shown before the built-in GIF export. Resolves { fps, width, start, end } or null.
 * Shows a start/end range (clips over 0.5 s), the frame count and a size estimate from the
 * current frame; remembers fps and width.
 */
function gifDialog(stage) {
  const saved = store.get('gif-export', {});
  const body = h('div', { class: 'gif-dialog-controls' });
  const info = h('p', { class: 'gif-dialog-info' });
  const warn = h('p', { class: 'notice gif-dialog-warn', hidden: true });
  let estTimer = 0, perFrame = 0, lastSize = '';

  const dur = stage.duration;
  const ranged = dur >= 0.5;
  const sec = (v) => `${v.toFixed(1)}s`;
  const controls = createControls(body, [{ controls: [
    ranged && { id: 'start', type: 'range', label: 'Start', min: 0, max: dur, step: 0.1, value: 0, format: sec },
    ranged && { id: 'end', type: 'range', label: 'End', min: 0, max: dur, step: 0.1, value: dur, format: sec },
    { id: 'fps', type: 'segmented', label: 'Frame rate (fps)', value: saved.fps || '15', options: GIF_FPS },
    { id: 'width', type: 'segmented', label: 'Width (px)', value: saved.width || '480', options: GIF_WIDTHS },
  ].filter(Boolean) }], { onChange: (st, id) => {
    // Keep at least 0.1 s between start and end, moving the handle the user didn't touch.
    if (id === 'start' && st.end - st.start < 0.1) controls.set({ end: Math.min(dur, st.start + 0.1) }, { silent: true });
    if (id === 'end' && st.end - st.start < 0.1) controls.set({ start: Math.max(0, st.end - 0.1) }, { silent: true });
    update();
  } });
  const s = controls.state;
  const range = () => (ranged ? [s.start, Math.max(s.start + 0.1, s.end)] : [0, dur]);

  function update() {
    const [a, b] = range();
    const n = Math.max(1, Math.round((b - a) * +s.fps));
    const [w, hh] = gifSize(stage.canvas, s.width);
    const size = `${w}×${hh}`;
    if (size !== lastSize) { lastSize = size; perFrame = 0; clearTimeout(estTimer); estTimer = setTimeout(estimate, 200); }
    info.textContent = `${n} frames · ${size} · ${(b - a).toFixed(1)}s${perFrame ? ` · ≈ ${formatBytes(perFrame * n * 0.9)}` : ''}`;
    warn.hidden = n <= GIF_WARN_FRAMES;
    warn.textContent = `Long GIFs get big and slow to encode. Lower the frame rate or width, or use Export video (much smaller).`;
  }

  async function estimate() {
    try {
      const lib = await loadGifenc();
      const [w, hh] = gifSize(stage.canvas, s.width);
      const c = scratch(`gif-est-${w}x${hh}`, w, hh);
      const cx = c.getContext('2d', { willReadFrequently: true });
      cx.clearRect(0, 0, w, hh);
      cx.drawImage(stage.canvas, 0, 0, w, hh);
      const gif = lib.GIFEncoder();
      const q = quantizeFrame(lib, cx, w, hh);
      gif.writeFrame(q.index, w, hh, frameOptions(q));
      gif.finish();
      perFrame = gif.bytes().length;
      update();
    } catch { /* offline: no estimate */ }
  }

  return new Promise((resolve) => {
    const done = (v) => {
      clearTimeout(estTimer);
      document.removeEventListener('keydown', onKey);
      modal.remove();
      if (v) store.set('gif-export', { fps: s.fps, width: s.width });
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') done(null); };
    const go = h('button', { class: 'btn btn-primary', type: 'button', onclick: () => { const [start, end] = range(); done({ fps: +s.fps, width: s.width, start, end }); } }, 'Export GIF');
    const modal = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Export GIF' },
      h('div', { class: 'modal' },
        h('h2', {}, 'Export GIF'),
        body, info, warn,
        h('div', { class: 'modal-actions' },
          h('button', { class: 'btn', type: 'button', onclick: () => done(null) }, 'Cancel'), go)));
    modal.addEventListener('click', (e) => { if (e.target === modal) done(null); });
    document.addEventListener('keydown', onKey);
    document.body.append(modal);
    update();
    go.focus();
  });
}

/**
 * Render the stage from `start` to `end` (default: the whole clip) frame by frame and encode
 * an animated GIF. Any video from getVideo() is seeked to each frame, so no frames drop.
 */
export async function recordStageGif({ stage, getVideo, fps = 15, width = '480', start = 0, end, onProgress, signal }) {
  const lib = await loadGifenc();
  const video = getVideo?.() || null;
  const dur = Math.min(stage.duration, end ?? stage.duration);
  const n = Math.max(1, Math.round((dur - start) * fps));
  const [w, hh] = gifSize(stage.canvas, width);
  const c = scratch(`gif-frame-${w}x${hh}`, w, hh);
  const cx = c.getContext('2d', { willReadFrequently: true });
  cx.imageSmoothingQuality = 'high';
  const delays = gifDelays(n, fps);
  const gif = lib.GIFEncoder();
  const resumeAt = stage.time;
  video?.pause();
  try {
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) return null;
      const t = Math.min(dur - 0.001, start + i / fps);
      if (video) await seekVideo(video, t);
      stage.renderFrame(t);
      cx.clearRect(0, 0, w, hh);
      cx.drawImage(stage.canvas, 0, 0, w, hh);
      const q = quantizeFrame(lib, cx, w, hh);
      gif.writeFrame(q.index, w, hh, { ...frameOptions(q), delay: delays[i], repeat: 0 });
      onProgress?.((i + 1) / n);
      await new Promise((r) => setTimeout(r)); // let the progress bar paint
    }
  } finally {
    stage.release();
    stage.seek(resumeAt);
  }
  gif.finish();
  return new Blob([gif.bytes()], { type: 'image/gif' });
}

/* ---------- Export bar ---------- */
export function createExportBar(root, opts) {
  const { stage, filename = () => 'export', getVideo = () => null, getAudio, beforeExport, afterExport } = opts;
  const want = (v) => (typeof v === 'function' ? v() : v);
  const recordable = canRecord();
  const primary = opts.primary || 'video';

  const audioToggle = h('input', { type: 'checkbox', checked: true });
  const audioLabel = h('label', { class: 'toggle', style: 'gap:8px' }, h('span', {}, 'Audio'), audioToggle);
  const button = (kind, ic, label) =>
    h('button', { class: `btn${primary === kind ? ' btn-primary' : ''}`, type: 'button', html: `${icon(primary === kind ? 'download' : ic)} ${label}` });
  const videoBtn = button('video', 'film', 'Export video');
  const gifBtn = button('gif', 'image', 'Export GIF');
  const pngBtn = button('png', 'image', 'Export PNG');
  const actions = (opts.actions || []).map((a) => {
    const b = h('button', { class: 'btn', type: 'button', html: `${icon(a.icon || 'download')} ${a.label}` });
    b.addEventListener('click', () => a.onClick(b));
    return b;
  });
  const hint = h('span', { class: 'hint' });
  root.className = 'export-bar';
  root.replaceChildren(videoBtn, gifBtn, pngBtn, ...actions, h('span', { class: 'spacer' }), hint, audioLabel);

  let busy = false;
  let lockedOut = false;

  /** Shared wrapper: one export at a time, transport locked, hooks run, errors toasted. */
  async function run(title, message, work) {
    if (busy) return;
    busy = true;
    const ctrl = new AbortController();
    let modal = null;
    stage.setTransportDisabled(true);
    setDisabled(true);
    try {
      await beforeExport?.();
      modal = progressModal(title, () => ctrl.abort(), message);
      const saved = await work(ctrl.signal, modal.set);
      if (saved) toast(`Saved ${saved}`, 'success');
      else if (ctrl.signal.aborted) toast('Export cancelled.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Export failed.', 'error', 7000);
    } finally {
      modal?.close();
      stage.setTransportDisabled(false);
      await afterExport?.();
      busy = false;
      setDisabled(false);
    }
  }

  videoBtn.addEventListener('click', () => {
    // The audio graph must be resumed synchronously inside the click, so recordStage starts here.
    const onHidden = () => document.hidden && toast('Export paused while the tab is hidden. Come back to finish it.', 'warning');
    document.addEventListener('visibilitychange', onHidden);
    run('Exporting video…', undefined, async (signal, onProgress) => {
      try {
        const result = await recordStage({ stage, getVideo, getAudio, includeAudio: audioToggle.checked, signal, onProgress });
        if (!result) return null;
        const name = `${filename()}.${result.ext}`;
        downloadBlob(result.blob, name);
        return name;
      } finally {
        document.removeEventListener('visibilitychange', onHidden);
      }
    });
  });

  gifBtn.addEventListener('click', async () => {
    if (busy) return;
    if (opts.onGif) return opts.onGif(gifBtn);
    stage.pause();
    const choice = await gifDialog(stage);
    if (!choice) return;
    run('Encoding GIF…', 'Rendering and compressing every frame. Longer clips take a while.', async (signal, onProgress) => {
      const blob = await recordStageGif({ stage, getVideo, ...choice, signal, onProgress });
      if (!blob) return null;
      const name = `${filename()}.gif`;
      downloadBlob(blob, name);
      return `${name} (${formatBytes(blob.size)})`;
    });
  });

  pngBtn.addEventListener('click', async () => {
    try {
      stage.invalidate();
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      await exportPNG(stage.canvas, filename());
    } catch (err) {
      toast(err.message || 'PNG export failed.', 'error');
    }
  });

  function setDisabled(d) {
    lockedOut = d;
    videoBtn.disabled = d || !recordable || !want(opts.video ?? true);
    gifBtn.disabled = d || !want(opts.gif ?? true);
    pngBtn.disabled = d || !want(opts.png ?? true);
    actions.forEach((b) => { b.disabled = d; });
  }

  function refresh() {
    setDisabled(lockedOut || busy);
    const showVideo = want(opts.video ?? true);
    audioLabel.hidden = !showVideo || !(opts.hasAudio ? opts.hasAudio() : getVideo()) || !recordable;
    const custom = want(opts.hint);
    hint.textContent = !recordable && showVideo
      ? `Video export needs MediaRecorder support (Chrome, Edge, Firefox, Safari 14.1+). GIF and PNG still work.${custom ? ` ${custom}` : ''}`
      : custom || '';
  }
  refresh();
  return { refresh, setDisabled: (d) => { setDisabled(d); } };
}
