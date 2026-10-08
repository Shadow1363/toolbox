/** Loading and validating user media (video / image) + audio routing for export. */
import { loadLib } from './cdn.js';

export const LIMITS = {
  video: 1024 * 1024 * 1024, // 1 GB
  image: 50 * 1024 * 1024,   // 50 MB
};

const IMAGE_EXT = /\.(png|jpe?g|webp|gif|avif|bmp|svg|heic|heif)$/i;
const HEIC_EXT = /\.(heic|heif)$/i;

/** iPhone photos. Safari decodes them natively; elsewhere loadMedia converts them with heic-to. */
export const isHeic = (file) => /^image\/hei[cf]/.test(file.type) || HEIC_EXT.test(file.name);
const VIDEO_EXT = /\.(mp4|m4v|webm|mov|ogv|mkv)$/i;

export class MediaError extends Error {}

/** Work out whether a File is a video or an image (some OSes leave file.type empty). */
export function kindOf(file) {
  if (file.type.startsWith('video/') || (!file.type && VIDEO_EXT.test(file.name))) return 'video';
  if (file.type.startsWith('image/') || (!file.type && IMAGE_EXT.test(file.name))) return 'image';
  return null;
}

/**
 * Validate and load a File.
 * @param {File} file
 * @param {{accept?: ('video'|'image')[], limits?: {video?: number, image?: number}}} opts
 * @returns {Promise<{kind, el, width, height, duration, name, size, url, dispose}>}
 */
export async function loadMedia(file, { accept = ['video', 'image'], limits = {} } = {}) {
  const kind = kindOf(file);
  const acceptLabel = accept.join(' or ');
  if (!kind) throw new MediaError(`“${file.name}” isn't a supported file. Please choose a ${acceptLabel}.`);
  if (!accept.includes(kind)) throw new MediaError(`This tool takes a ${acceptLabel}, not an ${kind}.`);

  const max = limits[kind] ?? LIMITS[kind];
  if (file.size > max) {
    throw new MediaError(`That ${kind} is ${(file.size / 1024 ** 2).toFixed(0)} MB. The limit is ${(max / 1024 ** 2).toFixed(0)} MB.`);
  }

  let url = URL.createObjectURL(file);
  const dispose = () => URL.revokeObjectURL(url);
  try {
    let media;
    if (kind === 'video') media = await loadVideo(url, file);
    else {
      try { media = await loadImage(url, file); } catch (err) {
        if (!isHeic(file)) throw err;
        dispose();
        url = URL.createObjectURL(await heicToJpeg(file));
        media = await loadImage(url, file);
      }
    }
    return { ...media, kind, name: file.name, size: file.size, url, dispose };
  } catch (err) {
    dispose();
    throw err;
  }
}

async function heicToJpeg(file) {
  const { heicTo } = await loadLib('heic');
  try { return await heicTo({ blob: file, type: 'image/jpeg', quality: 0.95 }); } catch (err) {
    console.error(err);
    throw new MediaError(`Couldn't decode the HEIC photo “${file.name}”.`);
  }
}

function loadImage(url, file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      if (!img.naturalWidth) return reject(new MediaError(`Couldn't read “${file.name}”.`));
      resolve({ el: img, width: img.naturalWidth, height: img.naturalHeight, duration: 0 });
    };
    img.onerror = () => reject(new MediaError(`Couldn't decode “${file.name}”. Try a PNG, JPG or WebP.`));
    img.src = url;
  });
}

function loadVideo(url, file) {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    if (file.type && !v.canPlayType(file.type) && !/quicktime/.test(file.type)) {
      return reject(new MediaError(`Your browser can't play ${file.type} files. Try MP4 (H.264) or WebM.`));
    }
    v.muted = true;
    v.playsInline = true;
    v.preload = 'auto';
    v.crossOrigin = 'anonymous';
    const timer = setTimeout(() => fail(`Timed out reading “${file.name}”.`), 20_000);
    const fail = (msg) => { clearTimeout(timer); v.removeAttribute('src'); reject(new MediaError(msg)); };
    v.onerror = () => fail(`Couldn't decode “${file.name}”. The codec may be unsupported here (e.g. HEVC .mov in Chrome/Firefox). Try MP4 (H.264) or WebM.`);
    v.onloadeddata = () => {
      clearTimeout(timer);
      if (!v.videoWidth) return fail(`“${file.name}” has no video track.`);
      // Some WebM files report Infinity until fully scanned; force the browser to find the end.
      if (!isFinite(v.duration)) {
        v.currentTime = 1e9;
        v.addEventListener('seeked', () => { v.currentTime = 0; done(); }, { once: true });
      } else done();
    };
    const done = () => resolve({ el: v, width: v.videoWidth, height: v.videoHeight, duration: v.duration });
    v.src = url;
  });
}

/** Seek a video and wait until the frame is ready. */
export function seekVideo(v, t) {
  return new Promise((resolve) => {
    if (Math.abs(v.currentTime - t) < 0.001 && v.readyState >= 2) return resolve();
    const on = () => { v.removeEventListener('seeked', on); resolve(); };
    v.addEventListener('seeked', on);
    v.currentTime = t;
  });
}

/* ---------- Audio routing ----------
 * To record a video's audio we route it through Web Audio:
 *   <video> → MediaElementSource → level gain ─┬→ monitor gain → speakers (preview)
 *                                              └→ MediaStreamDestination (recorder)
 * createMediaElementSource can only be called once per element, so we cache it.
 * `level` is the clip's own volume (e.g. fades); `monitor` is the preview mute.
 */
let audioCtx;
const graphs = new WeakMap();

export function audioGraph(video) {
  if (graphs.has(video)) return graphs.get(video);
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  audioCtx ||= new Ctx();
  const source = audioCtx.createMediaElementSource(video);
  const level = audioCtx.createGain();
  const monitor = audioCtx.createGain();
  const dest = audioCtx.createMediaStreamDestination();
  source.connect(level);
  level.connect(monitor).connect(audioCtx.destination);
  level.connect(dest);
  monitor.gain.value = video.muted ? 0 : 1;
  video.muted = false; // the graph now controls loudness; the element must output sound to feed it
  const g = { ctx: audioCtx, level, monitor, track: dest.stream.getAudioTracks()[0] };
  graphs.set(video, g);
  return g;
}

/**
 * One audio track mixing several videos (for multi-clip tools). Call inside a click,
 * like audioGraph. Returns null when Web Audio is unavailable or there are no videos.
 */
let mixDest;
const mixed = new WeakSet();
export function mixTrack(videos) {
  const list = videos.map(audioGraph).filter(Boolean);
  if (!list.length) return null;
  mixDest ||= audioCtx.createMediaStreamDestination();
  for (const g of list) if (!mixed.has(g)) { g.level.connect(mixDest); mixed.add(g); }
  audioCtx.resume();
  return mixDest.stream.getAudioTracks()[0];
}

/** Mute/unmute preview audio, whether or not the audio graph exists yet. */
export function setPreviewMuted(video, muted) {
  const g = graphs.get(video);
  if (g) g.monitor.gain.value = muted ? 0 : 1;
  else video.muted = muted;
}

export function isPreviewMuted(video) {
  const g = graphs.get(video);
  return g ? g.monitor.gain.value === 0 : video.muted;
}
