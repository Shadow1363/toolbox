/**
 * Multi-person head tracking: one detection pass over the clip, then identity matching
 * (cheap, rerun when the people count changes), then the same smoothing as head-tracking.js.
 *
 *   const det = await detectHeads(media, { fps: 30, mode: 'auto', maxPeople: 10, maxSide: 1280, onProgress, signal });
 *   const res = assignTracks(det, { count: 'auto' });       // or count: 3 (keep the 3 largest heads)
 *   res.tracks → [{ id: 1, samples: [{ found, x, y, size, roll, via }, …] }, …]   // one sample per frame
 *   const smooth = smoothTrack({ fps: res.fps, w: res.w, h: res.h, samples: res.tracks[0].samples });
 *   sampleTrack(smooth, t);                                   // as for one person
 *   applyEdits(res, [{ op: 'swap', a: 1, b: 2, from: 120 }, { op: 'merge', a: 1, b: 3, from: 300 }]);
 *   const thumbs = await trackThumbnails(media, res);        // Map id → data URL of the face
 *
 * Units match head-tracking.js: x, y are 0..1 of the frame (y = top of the head), size = head
 * width / frame height. Detection: Face Landmarker (numFaces = maxPeople) on every frame; Pose
 * Landmarker (numPoses) adds heads turned away, when fewer faces than people are in view.
 *
 * Matching (MediaPipe keeps no identities between frames): each track predicts where its head is
 * now from its velocity, the cost is the distance to a detection in head widths plus a size
 * change term, and the Hungarian algorithm picks the cheapest one-to-one assignment. Lost tracks
 * keep predicting for a short while (people crossing paths), and with a fixed number of tracks a
 * detection that matches nothing reconnects to the nearest lost track (people leaving and coming back).
 */
import { loadFaceLandmarker, loadPoseLandmarker, detectFaces, detectPoses } from './vision.js';
import { headFromFace, headFromPose } from './head-tracking.js';
import { seekVideo } from './media.js';

export const MAX_PEOPLE = 10;
const TINY_FACE = 0.035; // smaller faces give jittery landmarks; a body there is steadier

/** Distance between two heads in frame-height units (ar = width / height). */
const headDist = (a, b, ar) => Math.hypot((a.x - b.x) * ar, a.y - b.y);

/**
 * Detect every head on every sampled frame. mode: 'auto' (face, then body) | 'face' | 'body'.
 * maxSide caps the long side of the frame handed to the models (0 = full size): faster, less precise.
 * onProgress(p, { people }) — people = most heads seen in one frame so far.
 * Returns { fps, w, h, maxPeople, frames: [[{ x, y, size, roll, via }]] } or null if aborted.
 */
export async function detectHeads(media, { fps = 30, mode = 'auto', maxPeople = MAX_PEOPLE, maxSide = 0, onProgress, signal } = {}) {
  const { el, kind } = media;
  const w = media.width, h = media.height, ar = w / h;
  const face = mode !== 'body' ? await loadFaceLandmarker({ numFaces: maxPeople }) : null;
  let pose = mode === 'body' ? await loadPoseLandmarker({ numPoses: maxPeople }) : null; // 'auto' loads it on first need

  const sc = maxSide && Math.max(w, h) > maxSide ? maxSide / Math.max(w, h) : 1;
  let frame = null, fctx = null;
  if (sc < 1) {
    frame = document.createElement('canvas');
    frame.width = Math.round(w * sc); frame.height = Math.round(h * sc);
    fctx = frame.getContext('2d');
  }

  const n = kind === 'video' ? Math.max(1, Math.round(media.duration * fps)) : 1;
  const frames = [];
  let people = 0;
  if (kind === 'video') el.pause();
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) return null;
    if (kind === 'video') await seekVideo(el, Math.min(media.duration - 0.001, i / fps));
    let src = el;
    if (frame) { fctx.drawImage(el, 0, 0, frame.width, frame.height); src = frame; }

    let heads = face ? detectFaces(face, src).map((lm) => headFromFace(lm, w, h)) : [];
    // Bodies fill in heads turned away; checked when faces are missing or tiny, and every 10th frame for newcomers.
    const wantPose = mode === 'body' || (mode === 'auto' && (heads.length < Math.max(1, people) || heads.some((x) => x.size < TINY_FACE) || i % 10 === 0));
    if (wantPose) {
      pose ||= await loadPoseLandmarker({ numPoses: maxPeople });
      const bodies = detectPoses(pose, src).map((lm) => headFromPose(lm, w, h)).filter(Boolean);
      heads = mergeBodies(heads, bodies, ar);
    }
    heads = dedupe(heads, ar).slice(0, maxPeople);
    people = Math.max(people, heads.length);
    frames.push(heads.map((x) => ({ x: +x.x.toFixed(5), y: +x.y.toFixed(5), size: +x.size.toFixed(5), roll: +x.roll.toFixed(4), via: x.via })));
    onProgress?.((i + 1) / n, { people });
    if (i % 3 === 2) await new Promise((r) => setTimeout(r)); // let the progress bar paint
  }
  return { fps, w, h, maxPeople, frames };
}

/**
 * Is head b part of head a? True when b's top lies inside a's head box (a little wider than the head,
 * from above the crown to the chin). Body-based estimates of the same person land anywhere in there.
 */
const sameHead = (a, b, ar) => Math.abs(a.x - b.x) * ar < 0.75 * a.size && b.y > a.y - 0.6 * a.size && b.y < a.y + 1.4 * a.size;

/** Add body heads that aren't already a face; a body replaces a tiny face at the same spot. */
function mergeBodies(faces, bodies, ar) {
  const out = faces.slice();
  for (const b of bodies) {
    const i = out.findIndex((f) => sameHead(f, b, ar) || sameHead(b, f, ar));
    if (i < 0) out.push(b);
    else if (out[i].via === 'face' && out[i].size < TINY_FACE) out[i] = b;
  }
  return out;
}

/** Largest first; drop a head that sits inside a larger one (faces win over body estimates). */
function dedupe(heads, ar) {
  const sorted = heads.slice().sort((a, b) => (a.via === b.via ? 0 : a.via === 'face' ? -1 : 1) || b.size - a.size);
  const keep = [];
  for (const x of sorted) if (!keep.some((k) => sameHead(k, x, ar) || sameHead(x, k, ar))) keep.push(x);
  return keep.sort((a, b) => b.size - a.size);
}

/**
 * Hungarian algorithm (minimum-cost assignment) for a rows × cols cost matrix.
 * Returns match[row] = col, or -1 for rows left over when rows > cols.
 */
export function hungarian(cost) {
  const n = cost.length, m = n ? cost[0].length : 0;
  if (!n || !m) return new Array(n).fill(-1);
  const N = Math.max(n, m);
  const a = (i, j) => (i < n && j < m ? cost[i][j] : 0);
  const u = new Float64Array(N + 1), v = new Float64Array(N + 1);
  const p = new Int32Array(N + 1), way = new Int32Array(N + 1);
  for (let i = 1; i <= N; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Float64Array(N + 1).fill(Infinity);
    const used = new Uint8Array(N + 1);
    do {
      used[j0] = 1;
      const i0 = p[j0];
      let delta = Infinity, j1 = 0;
      for (let j = 1; j <= N; j++) {
        if (used[j]) continue;
        const cur = a(i0 - 1, j - 1) - u[i0] - v[j];
        if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
        if (minv[j] < delta) { delta = minv[j]; j1 = j; }
      }
      for (let j = 0; j <= N; j++) {
        if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta;
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
  }
  const match = new Array(n).fill(-1);
  for (let j = 1; j <= N; j++) if (p[j] && p[j] - 1 < n && j - 1 < m) match[p[j] - 1] = j - 1;
  return match;
}

/**
 * How many people to track in 'auto' mode: the most heads seen together in at least ~0.3 s of
 * frames, so a one-frame false detection doesn't create a person.
 */
export function autoCount(det) {
  const counts = det.frames.map((f) => f.length);
  const need = Math.min(counts.length, counts.length === 1 ? 1 : Math.max(3, Math.round(0.3 * det.fps)));
  let k = 0;
  for (let c = 1; c <= det.maxPeople; c++) if (counts.filter((x) => x >= c).length >= need) k = c;
  return k;
}

/**
 * Turn per-frame detections into tracks with stable ids. count: 'auto' | number (1–10).
 * With a number, only that many of the largest heads per frame are kept (people far in the background drop out).
 * Returns { fps, w, h, count, tracks: [{ id, samples }] }; ids are 1..count in order of first appearance.
 */
export function assignTracks(det, { count = 'auto' } = {}) {
  const { fps, w, h, frames } = det;
  const ar = w / h, n = frames.length;
  const K = count === 'auto' ? autoCount(det) : Math.max(1, Math.min(MAX_PEOPLE, Math.round(count)));
  const maxPredict = Math.round(fps * 0.7); // keep predicting a hidden head along its path for this long
  const tracks = [];
  const BIG = 1e6;

  for (let i = 0; i < n; i++) {
    const dets = frames[i].slice().sort((a, b) => b.size - a.size).slice(0, K);
    const taken = new Array(dets.length).fill(false);
    const matched = new Set();

    // Where each track should be now, and how far it may be from there (grows while it's hidden).
    const pred = tracks.map((tr) => {
      const gap = i - tr.last, k = Math.min(gap, maxPredict);
      return { x: tr.x + tr.vx * k, y: tr.y + tr.vy * k, size: tr.size, gate: 1.2 + 0.8 * Math.min(gap / fps, 3) };
    });
    const costOf = (p, d) => Math.hypot(d.x * ar - p.x, d.y - p.y) / Math.max(p.size, d.size) + 1.5 * Math.abs(Math.log(d.size / p.size));

    // 1. Gated matching against every track's prediction.
    if (tracks.length && dets.length) {
      const cost = pred.map((p) => dets.map((d) => { const c = costOf(p, d); return c <= p.gate ? c : BIG; }));
      hungarian(cost).forEach((j, t) => {
        if (j < 0 || cost[t][j] >= BIG) return;
        update(tracks[t], dets[j], i);
        taken[j] = true; matched.add(t);
      });
    }

    // 2. Leftover heads: a new track while there's room, else reconnect to the nearest lost track (anywhere).
    let rest = dets.map((d, j) => j).filter((j) => !taken[j]);
    while (rest.length && tracks.length < K) {
      const d = dets[rest.shift()];
      tracks.push({ x: d.x * ar, y: d.y, size: d.size, vx: 0, vy: 0, last: i, first: i, firstX: d.x, samples: new Array(n).fill(null) });
      tracks[tracks.length - 1].samples[i] = { found: true, ...d };
      matched.add(tracks.length - 1);
    }
    const lost = tracks.map((tr, t) => t).filter((t) => !matched.has(t));
    if (rest.length && lost.length) {
      const cost = lost.map((t) => rest.map((j) => {
        const tr = tracks[t], d = dets[j];
        return headDist({ x: tr.x / ar, y: tr.y }, d, ar) / Math.max(tr.size, d.size) + 0.5 * Math.abs(Math.log(d.size / tr.size));
      }));
      hungarian(cost).forEach((c, r) => {
        if (c < 0) return;
        const tr = tracks[lost[r]];
        tr.vx = tr.vy = 0; // a reconnect isn't motion
        update(tr, dets[rest[c]], i, true);
      });
    }
  }

  function update(tr, d, i, reconnect = false) {
    const gap = Math.max(1, i - tr.last);
    if (!reconnect && gap <= maxPredict) {
      const a = gap === 1 ? 0.4 : 0.25; // EMA: velocity follows motion without flipping on one noisy frame
      tr.vx += a * ((d.x * ar - tr.x) / gap - tr.vx);
      tr.vy += a * ((d.y - tr.y) / gap - tr.vy);
    } else if (!reconnect) { tr.vx = tr.vy = 0; }
    tr.x = d.x * ar; tr.y = d.y; tr.size = d.size; tr.last = i;
    tr.samples[i] = { found: true, ...d };
  }

  const out = tracks
    .sort((a, b) => a.first - b.first || a.firstX - b.firstX)
    .map((tr, k) => ({ id: k + 1, samples: tr.samples.map((x) => x || { found: false }) }));
  return { fps, w, h, count: K, tracks: out };
}

/**
 * Apply manual fixes, in order, to a copy of an assignTracks result. Frames are sample indices.
 *   { op: 'swap', a, b, from }  — a and b trade identities from `from` on (they swapped tags).
 *   { op: 'merge', a, b, from } — b's detections from `from` on move into a, where a has none (one person split in two).
 */
export function applyEdits(res, edits = []) {
  const tracks = res.tracks.map((tr) => ({ id: tr.id, samples: tr.samples.slice() }));
  const byId = (id) => tracks.find((tr) => tr.id === id);
  for (const e of edits) {
    const A = byId(e.a), B = byId(e.b);
    if (!A || !B || A === B) continue;
    for (let i = Math.max(0, e.from); i < A.samples.length; i++) {
      if (e.op === 'swap') [A.samples[i], B.samples[i]] = [B.samples[i], A.samples[i]];
      else if (e.op === 'merge') {
        if (!A.samples[i].found && B.samples[i].found) A.samples[i] = B.samples[i];
        B.samples[i] = { found: false };
      }
    }
  }
  return { ...res, tracks };
}

/**
 * A square face thumbnail per track (data URL), from the frame where the face is largest.
 * Videos are seeked on a second element, so the preview's playhead never moves.
 */
export async function trackThumbnails(media, res, { size = 72 } = {}) {
  const { kind } = media;
  let el = media.el;
  if (kind === 'video') {
    el = document.createElement('video');
    el.muted = true; el.playsInline = true; el.preload = 'auto';
    await new Promise((resolve, reject) => { el.onloadeddata = resolve; el.onerror = () => reject(new Error('Could not reopen the video.')); el.src = media.url; });
  }
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const cx = c.getContext('2d');
  const thumbs = new Map();
  for (const tr of res.tracks) {
    let best = -1, score = -1;
    tr.samples.forEach((x, i) => {
      if (!x.found) return;
      const sc = x.size * (x.via === 'face' ? 2 : 1);
      if (sc > score) { score = sc; best = i; }
    });
    if (best < 0) continue;
    if (kind === 'video') await seekVideo(el, Math.min(media.duration - 0.001, best / res.fps));
    const x = tr.samples[best];
    const W = media.width, H = media.height, hw = x.size * H;
    const side = hw * 1.5, cxp = x.x * W, cyp = x.y * H + hw * 0.6;
    cx.fillStyle = '#222';
    cx.fillRect(0, 0, size, size);
    cx.drawImage(el, cxp - side / 2, cyp - side / 2, side, side, 0, 0, size, size);
    thumbs.set(tr.id, c.toDataURL('image/jpeg', 0.85));
  }
  if (kind === 'video') el.removeAttribute('src');
  return thumbs;
}
