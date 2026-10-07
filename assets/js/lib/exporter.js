/**
 * Export helpers: record the stage canvas to video (MediaRecorder + captureStream)
 * or save a PNG, with a progress modal.
 *
 *   createExportBar(root, {
 *     stage,                              // from createStage()
 *     filename: () => 'my-clip',          // without extension
 *     getVideo: () => videoOrNull,        // source video, for its audio track
 *     video: true,                        // show "Export video" (bool or () => bool)
 *     png: true,                          // show "Export PNG"   (bool or () => bool)
 *     hint: 'Text…',                      // small note next to the buttons
 *     videoLabel: 'Export WebM',          // optional label for the video button
 *     actions: [{ label, icon, primary, onClick }],  // extra buttons placed first (e.g. GIF, ZIP)
 *     beforeExport, afterExport,          // optional hooks (async ok)
 *   });
 */
import { h, icon, toast, downloadBlob, formatTime } from './dom.js';
import { audioGraph, seekVideo } from './media.js';
import { fixWebmDuration } from './webm-duration.js';

/** Shown by tools when the output has a transparent background. */
export const TRANSPARENT_HINT = 'Transparent WebM keeps alpha in Chrome/Edge; other browsers may show black. PNG always keeps it.';

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
export async function recordStage({ stage, getVideo, includeAudio = true, fps = 30, onProgress, signal }) {
  if (!canRecord()) throw new Error('Your browser does not support video recording (MediaRecorder). Try Chrome, Edge or Firefox.');
  const canvas = stage.canvas;
  const video = getVideo?.() || null;

  // Audio graph must be created/resumed synchronously inside the click.
  let audioTrack = null;
  if (video && includeAudio) {
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

/* ---------- Export bar ---------- */
export function createExportBar(root, opts) {
  const { stage, filename = () => 'export', getVideo = () => null, beforeExport, afterExport } = opts;
  const want = (v) => (typeof v === 'function' ? v() : v);
  const recordable = canRecord();

  const audioToggle = h('input', { type: 'checkbox', checked: true });
  const audioLabel = h('label', { class: 'toggle', style: 'gap:8px' }, h('span', {}, 'Audio'), audioToggle);
  const actions = (opts.actions || []).map((a) => {
    const b = h('button', { class: `btn${a.primary ? ' btn-primary' : ''}`, type: 'button', html: `${icon(a.icon || 'download')} ${a.label}` });
    b.addEventListener('click', () => a.onClick(b));
    return b;
  });
  const videoPrimary = !(opts.actions || []).some((a) => a.primary);
  const videoBtn = h('button', { class: `btn${videoPrimary ? ' btn-primary' : ''}`, type: 'button', html: `${icon(videoPrimary ? 'download' : 'film')} ${opts.videoLabel || 'Export video'}` });
  const pngBtn = h('button', { class: 'btn', type: 'button', html: `${icon('image')} Export PNG` });
  const hint = h('span', { class: 'hint' });
  root.className = 'export-bar';
  root.replaceChildren(...actions, videoBtn, pngBtn, h('span', { class: 'spacer' }), hint, audioLabel);

  let busy = false;

  videoBtn.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    const ctrl = new AbortController();
    const modal = progressModal('Exporting video…', () => ctrl.abort());
    const onHidden = () => document.hidden && toast('Export paused while the tab is hidden. Come back to finish it.', 'warning');
    document.addEventListener('visibilitychange', onHidden);
    stage.setTransportDisabled(true);
    try {
      await beforeExport?.();
      const result = await recordStage({
        stage, getVideo, includeAudio: audioToggle.checked, signal: ctrl.signal, onProgress: modal.set,
      });
      if (result) {
        downloadBlob(result.blob, `${filename()}.${result.ext}`);
        toast(`Saved ${filename()}.${result.ext}`, 'success');
      } else toast('Export cancelled.');
    } catch (err) {
      console.error(err);
      toast(err.message || 'Export failed.', 'error', 7000);
    } finally {
      document.removeEventListener('visibilitychange', onHidden);
      modal.close();
      stage.setTransportDisabled(false);
      await afterExport?.();
      busy = false;
    }
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

  function refresh() {
    const showVideo = want(opts.video ?? true);
    videoBtn.hidden = !showVideo;
    videoBtn.disabled = !recordable;
    pngBtn.hidden = !want(opts.png ?? true);
    audioLabel.hidden = !showVideo || !getVideo() || !recordable;
    const custom = want(opts.hint);
    hint.textContent = !recordable && showVideo
      ? 'Video export needs MediaRecorder support (Chrome, Edge, Firefox, Safari 14.1+).'
      : custom || '';
  }
  refresh();
  return { refresh, setDisabled: (d) => { videoBtn.disabled = d || !recordable; pngBtn.disabled = d; actions.forEach((b) => { b.disabled = d; }); } };
}
