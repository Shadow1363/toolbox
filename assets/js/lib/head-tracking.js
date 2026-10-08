/**
 * Head tracking for tools that follow a person: one offline tracking pass over the clip,
 * then smoothing and lookup by time. Preview and export read the same stored track,
 * so playback stays smooth and exports match the preview exactly.
 *
 *   const track = await trackHead(media, { fps: 30, mode: 'auto', onProgress, signal });
 *   const smooth = smoothTrack(track, { strength: 0.6 });     // cheap: rerun when sliders change
 *   const head = sampleTrack(smooth, t);  // { x, y, size, roll, alpha, via } or null
 *
 * Units: x, y are 0..1 of the frame (y is the TOP of the head); size is the head width as a
 * fraction of frame height; roll is radians (0 = upright, positive = clockwise on screen).
 * Detection: Face Landmarker first; Pose Landmarker (ears/shoulders) when the face is turned
 * away or too small. Lost heads hold their last position, then fade out; found heads fade in.
 */
import { loadFaceLandmarker, loadPoseLandmarker, detectFace, detectPose } from './vision.js';
import { seekVideo } from './media.js';

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
/** Angle of the line a→b folded into (-π/2, π/2], so a head seen from behind isn't upside down. */
const lineAngle = (a, b) => {
  let r = Math.atan2(b.y - a.y, b.x - a.x);
  if (r > Math.PI / 2) r -= Math.PI;
  if (r <= -Math.PI / 2) r += Math.PI;
  return r;
};
const px = (p, w, h) => ({ x: p.x * w, y: p.y * h });

/** Head estimate from 478 face-mesh landmarks (frame w×h px). */
export function headFromFace(lm, w, h) {
  const top = px(lm[10], w, h), chin = px(lm[152], w, h);
  const faceH = dist(top, chin);
  const faceW = dist(px(lm[234], w, h), px(lm[454], w, h));
  const up = { x: (top.x - chin.x) / faceH, y: (top.y - chin.y) / faceH };
  // Landmark 10 is the top of the forehead; the crown (with hair) sits ~30% of a face higher.
  const crown = { x: top.x + up.x * faceH * 0.3, y: top.y + up.y * faceH * 0.3 };
  // Width shrinks when the head turns, height when it nods: the larger estimate is the steadier one.
  const size = Math.max(faceH * 0.83, faceW * 1.1);
  return { x: crown.x / w, y: crown.y / h, size: size / h, roll: lineAngle(px(lm[33], w, h), px(lm[263], w, h)), via: 'face' };
}

/** Head estimate from 33 pose landmarks: ears when visible, else shoulders. Null when unusable. */
export function headFromPose(lm, w, h) {
  const vis = (i) => (lm[i].visibility ?? 1) > 0.4;
  let centre, size, roll;
  if (vis(7) && vis(8)) {
    const a = px(lm[8], w, h), b = px(lm[7], w, h);
    centre = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    size = dist(a, b) / 0.9;
    roll = lineAngle(a, b);
  } else if (vis(11) && vis(12)) {
    const a = px(lm[12], w, h), b = px(lm[11], w, h);
    size = dist(a, b) * 0.42;
    roll = 0;
    const nose = vis(0) ? px(lm[0], w, h) : null;
    centre = nose || { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - size * 1.4 };
  } else return null;
  if (!(size > 2)) return null;
  // Ears sit about halfway down the head; the crown is ~0.8 head widths above them.
  const up = { x: Math.sin(roll), y: -Math.cos(roll) };
  return { x: (centre.x + up.x * size * 0.8) / w, y: (centre.y + up.y * size * 0.8) / h, size: size / h, roll, via: 'pose' };
}

/**
 * Detect the head on every sampled frame. media: a loadMedia() result (video or image).
 * mode: 'auto' (face, then body) | 'face' | 'body'. Returns { fps, w, h, samples } or null if aborted.
 * Each sample: { found, x, y, size, roll, via }.
 */
export async function trackHead(media, { fps = 30, mode = 'auto', onProgress, signal } = {}) {
  const { el, kind } = media;
  const w = media.width, h = media.height;
  const useFace = mode !== 'body', usePose = mode !== 'face';
  const face = useFace ? await loadFaceLandmarker() : null;
  let pose = mode === 'body' ? await loadPoseLandmarker() : null; // 'auto' loads it on first need

  const n = kind === 'video' ? Math.max(1, Math.round(media.duration * fps)) : 1;
  const samples = [];
  if (kind === 'video') el.pause();
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) return null;
    if (kind === 'video') await seekVideo(el, Math.min(media.duration - 0.001, i / fps));
    let head = null;
    if (face) {
      const lm = detectFace(face, el);
      if (lm) head = headFromFace(lm, w, h);
    }
    // A tiny face gives jittery landmarks; the body is often steadier at that distance.
    if (usePose && (!head || head.size < 0.035)) {
      pose ||= await loadPoseLandmarker();
      const lm = detectPose(pose, el);
      const body = lm && headFromPose(lm, w, h);
      if (body) head = body;
    }
    samples.push(head ? { found: true, ...head } : { found: false });
    onProgress?.((i + 1) / n);
    if (i % 3 === 2) await new Promise((r) => setTimeout(r)); // let the progress bar paint
  }
  return { fps, w, h, samples };
}

/** One Euro filter (Casiez et al.): smooth when still, responsive when moving fast. */
export class OneEuro {
  constructor(minCutoff = 1, beta = 0.01, dCutoff = 1) {
    Object.assign(this, { minCutoff, beta, dCutoff, x: null, dx: 0 });
  }
  static alpha(cutoff, dt) { return 1 / (1 + 1 / (2 * Math.PI * cutoff * dt)); }
  filter(x, dt) {
    if (this.x == null) { this.x = x; return x; }
    const dx = (x - this.x) / dt;
    this.dx += OneEuro.alpha(this.dCutoff, dt) * (dx - this.dx);
    this.x += OneEuro.alpha(this.minCutoff + this.beta * Math.abs(this.dx), dt) * (x - this.x);
    return this.x;
  }
}

/** Forward then backward One Euro pass: smoothing with no lag (the whole track is known). */
function filtfilt(values, dt, minCutoff, beta) {
  const out = values.slice();
  let f = new OneEuro(minCutoff, beta);
  for (let i = 0; i < out.length; i++) out[i] = f.filter(out[i], dt);
  f = new OneEuro(minCutoff, beta);
  for (let i = out.length - 1; i >= 0; i--) out[i] = f.filter(out[i], dt);
  return out;
}

/**
 * Fill gaps, fade lost heads and smooth. strength 0..1 (0 = raw). hold/fadeOut/fadeIn in seconds.
 * Returns { fps, frames: [{ x, y, size, roll, alpha, seg, via, found }], found, total }.
 */
export function smoothTrack(track, { strength = 0.5, hold = 0.4, fadeOut = 0.3, fadeIn = 0.2 } = {}) {
  const { fps, w, h, samples } = track;
  const dt = 1 / fps;
  const first = samples.findIndex((s) => s.found);
  const found = samples.filter((s) => s.found).length;
  if (first < 0) return { fps, frames: [], found: 0, total: samples.length };

  // 1. Hold the last position through gaps (back-fill before the first detection) and fade.
  const frames = [];
  let last = samples[first], missing = 0, alpha = samples[0].found ? 1 : 0, seg = 0, prevAlpha = alpha;
  samples.forEach((s, i) => {
    if (s.found) { last = s; missing = 0; } else missing++;
    const target = s.found || (i > first && missing * dt <= hold) ? 1 : 0;
    if (i > 0 || !s.found) alpha = Math.max(0, Math.min(1, alpha + Math.max(-dt / fadeOut, Math.min(dt / fadeIn, target - alpha))));
    if (alpha > 0 && prevAlpha === 0) seg++; // fully hidden before: start a new segment (no gliding across)
    prevAlpha = alpha;
    frames.push({ x: last.x, y: last.y, size: last.size, roll: last.roll, alpha, seg: alpha > 0 ? seg : -1, via: s.found ? s.via : null, found: s.found });
  });

  // 2. Smooth each visible segment. Work in 1080p-scaled pixels so beta means the same for every clip.
  if (strength > 0 && frames.length > 2) {
    const k = 1080 / Math.min(w, h);
    const minCutoff = 0.08 + 3 * (1 - strength) ** 2; // Hz
    const beta = 0.012 * (1 - 0.8 * strength);
    let i = 0;
    while (i < frames.length) {
      if (frames[i].seg < 0) { i++; continue; }
      let j = i;
      while (j + 1 < frames.length && frames[j + 1].seg === frames[i].seg) j++;
      const part = frames.slice(i, j + 1);
      const run = (get, scale, mc, b) => filtfilt(part.map((f) => get(f) * scale), dt, mc, b).map((v) => v / scale);
      const xs = run((f) => f.x, w * k, minCutoff, beta);
      const ys = run((f) => f.y, h * k, minCutoff, beta);
      const ss = run((f) => f.size, h * k, minCutoff * 0.5, beta * 0.5); // size jitter is the most visible
      const rs = run((f) => f.roll, 180 / Math.PI, minCutoff * 0.7, beta);
      part.forEach((f, n) => Object.assign(f, { x: xs[n], y: ys[n], size: ss[n], roll: rs[n] }));
      i = j + 1;
    }
  }
  return { fps, frames, found, total: samples.length };
}

/** Interpolated head at time t (s), or null when nothing was tracked. */
export function sampleTrack(smooth, t) {
  const fr = smooth?.frames;
  if (!fr?.length) return null;
  const f = Math.max(0, Math.min(fr.length - 1, t * smooth.fps));
  const i0 = Math.floor(f), i1 = Math.min(fr.length - 1, i0 + 1), u = f - i0;
  const a = fr[i0], b = fr[i1];
  if (a.seg !== b.seg || u === 0) return u < 0.5 ? a : b;
  const lerp = (p, q) => p + (q - p) * u;
  return { x: lerp(a.x, b.x), y: lerp(a.y, b.y), size: lerp(a.size, b.size), roll: lerp(a.roll, b.roll), alpha: lerp(a.alpha, b.alpha), via: a.via || b.via, found: a.found || b.found, seg: a.seg };
}
