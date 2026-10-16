/*
 * Pop Out's "Holding out an item" preset: find the hand held toward the camera and place SAM prompts on it, so the
 * hand + the item it holds (+ the forearm) become the subject with no clicks.
 *
 *   const frames = await findHands(media, times, { onProgress, signal });  // [{ t, hand, pose }] per sampled time
 *   const keys = holdPrompts(frames, media, { forearm: true });           // [{ t, points }] for track.setKeyframes
 *
 * Hand Landmarker (2 hands), Face Landmarker (the face; pose's face points are unreliable on close-ups) and Pose
 * Landmarker (torso, elbows) on every sampled frame. The hands are linked
 * into tracks (nearest palm, within 1.5 hand sizes of the track's last one) and the track with the most hand over
 * the clip (Σ size) is the one held out, so the choice never flips to the other hand mid-clip.
 * Prompts per frame, all in one SAM group so they make one object: the palm centre, a point just past the fingertips
 * along the wrist → knuckle direction (the held item; `opt`, so object-mask drops it on frames where it grabs the
 * background, i.e. nothing is held), and the forearm (keep, or remove when the toggle is off).
 * Remove prompts go on the face and forehead (each unless it's under the hand itself) and the torso (unless it's
 * near the hand). The item prompt is dropped when it lands on the face; the pose elbow is only trusted when it's
 * behind the hand.
 */
import { loadHandLandmarker, detectHands, loadPoseLandmarker, detectPose, loadFaceLandmarker, detectFace } from '/assets/js/lib/vision.js';
import { seekVideo } from '/assets/js/lib/media.js';

const GROUP = 'hold';
const PALM = [0, 5, 9, 13, 17];
const TIPS = [4, 8, 12, 16, 20];

/** Hand and pose landmarks at each time (source seconds; photos: one entry at 0). */
export async function findHands(media, times, { onProgress, signal } = {}) {
  const [hands, pose, face] = await Promise.all([loadHandLandmarker({ numHands: 2 }), loadPoseLandmarker(), loadFaceLandmarker()]);
  const el = media.el;
  const isVideo = media.kind === 'video';
  const resume = isVideo ? el.currentTime : 0;
  if (isVideo) el.pause();
  const out = [];
  try {
    for (let i = 0; i < times.length; i++) {
      if (signal?.aborted) return null;
      const t = times[i];
      if (isVideo) await seekVideo(el, Math.min(media.duration - 0.001, t));
      out.push({ t, hands: detectHands(hands, el).map((x) => x.points), pose: detectPose(pose, el), face: detectFace(face, el) });
      onProgress?.((i + 1) / times.length);
      if (i % 4 === 3) await new Promise((r) => setTimeout(r));
    }
  } finally {
    if (isVideo) await seekVideo(el, resume);
  }
  return pickTrack(out, media);
}

/** Hand size in px (wrist → middle knuckle), aspect-corrected. */
const handSize = (pts, W, H) => Math.hypot((pts[9].x - pts[0].x) * W, (pts[9].y - pts[0].y) * H);
const palmOf = (pts) => avg(PALM.map((i) => pts[i]));

/** Link the hands into tracks and keep the one with the most hand over the clip: sets `hand` on every frame. */
function pickTrack(frames, { width: W, height: H }) {
  const tracks = []; // { last: points, lastI, frames: Map(i → points), score }
  frames.forEach((f, i) => {
    const taken = new Set();
    for (const pts of f.hands.slice().sort((a, b) => handSize(b, W, H) - handSize(a, W, H))) {
      const p = palmOf(pts), size = handSize(pts, W, H);
      let best = null, bd = Infinity;
      for (const tr of tracks) {
        if (taken.has(tr) || i - tr.lastI > 8) continue;
        const q = palmOf(tr.last), d = Math.hypot((p.x - q.x) * W, (p.y - q.y) * H);
        if (d < Math.max(size, handSize(tr.last, W, H)) * 1.5 && d < bd) { bd = d; best = tr; }
      }
      if (!best) { best = { frames: new Map(), score: 0 }; tracks.push(best); }
      taken.add(best);
      best.last = pts; best.lastI = i; best.frames.set(i, pts); best.score += size;
    }
  });
  const main = tracks.sort((a, b) => b.score - a.score)[0];
  return frames.map((f, i) => ({ t: f.t, hand: main?.frames.get(i) || null, pose: f.pose, face: f.face }));
}

/**
 * SAM prompts per frame with a hand: [{ t, points: [{ x, y, keep, group }] }] (0..1 of the source).
 * Frames without a hand get no keyframe; the masking pass carries the previous frame's prompts there.
 */
export function holdPrompts(frames, { width: W, height: H }, { forearm = false } = {}) {
  const keys = [];
  for (const f of frames) {
    if (!f.hand) continue;
    const P = (i) => ({ x: f.hand[i].x * W, y: f.hand[i].y * H });
    const wrist = P(0);
    const L = Math.max(4, handSize(f.hand, W, H));
    const d = norm(sub(P(9), wrist));
    const palm = avg(PALM.map(P));
    const reach = Math.max(...TIPS.map((i) => dot(sub(P(i), wrist), d)));
    const item = add(wrist, mul(d, reach + 0.6 * L)); // optional: dropped per frame when it grabs the background
    const keep = [palm, item];
    const drop = [];
    let armDrop = null;
    // Forearm: toward the pose elbow on the same side (nearest pose wrist), else straight back from the hand.
    const elbow = poseElbow(f.pose, wrist, d, L, W, H);
    const arm = elbow ? lerp(wrist, elbow, 0.5) : sub(wrist, mul(d, 1.2 * L));
    if (forearm) { keep.push(lerp(wrist, arm, 0.6)); if (elbow) keep.push(arm); } else armDrop = arm;
    const handPts = [...Array(21).keys()].map(P);
    const away = (q, r) => Math.min(...[...handPts, ...keep].map((k) => Math.hypot(k.x - q.x, k.y - q.y))) > r * L;
    const vis = (i) => f.pose && (f.pose[i].visibility ?? 1) > 0.5;
    const pp = (i) => ({ x: f.pose[i].x * W, y: f.pose[i].y * H });
    // The face and hair stay out even when the hand is right next to them (a raised hand over the forehead): remove
    // prompts on the nose, eyes, mouth and forehead, each unless it's under the hand itself. The item prompt is
    // dropped when it lands on the face. The torso point is skipped near the hand (the arm crosses it).
    if (f.face) {
      const F = (i) => ({ x: f.face[i].x * W, y: f.face[i].y * H });
      // Forehead (10), nose tip (1), eyes (159, 386), mouth (13), cheeks (205, 425).
      for (const q of [10, 1, 159, 386, 13, 205, 425].map(F)) if (away(q, 0.45)) drop.push(q);
      const fc = F(1), fr = Math.hypot(F(10).x - F(152).x, F(10).y - F(152).y) * 0.75; // ~ face radius
      if (Math.hypot(item.x - fc.x, item.y - fc.y) < fr) keep.splice(keep.indexOf(item), 1);
    } else if (vis(0) && away(pp(0), 0.45)) drop.push(pp(0));
    if (vis(11) && vis(12)) {
      const sh = lerp(pp(11), pp(12), 0.5);
      const down = vis(23) && vis(24) ? sub(lerp(pp(23), pp(24), 0.5), sh) : { x: 0, y: Math.hypot(pp(11).x - pp(12).x, pp(11).y - pp(12).y) };
      const torso = add(sh, mul(down, 0.4));
      if (away(torso, 1.3)) drop.push(torso);
    }
    const inFrame = (q) => q.x >= 0 && q.y >= 0 && q.x <= W && q.y <= H;
    const points = [
      ...keep.filter(inFrame).map((q) => ({ x: q.x / W, y: q.y / H, keep: true, group: GROUP, opt: q === item || undefined })),
      ...[...drop, armDrop].filter((q) => q && inFrame(q)).map((q) => ({ x: q.x / W, y: q.y / H, keep: false })),
    ];
    if (points.some((p) => p.keep)) keys.push({ t: f.t, points });
  }
  return keys;
}

/** The pose elbow of this arm (nearest pose wrist), only when it's plausible: behind the hand, 1.2–5 hand sizes away. */
function poseElbow(pose, wrist, d, L, W, H) {
  if (!pose) return null;
  const side = [[15, 13], [16, 14]]
    .filter(([, e]) => (pose[e].visibility ?? 1) > 0.5)
    .map(([w, e]) => ({ e, d: Math.hypot(pose[w].x * W - wrist.x, pose[w].y * H - wrist.y) }))
    .sort((a, b) => a.d - b.d)[0];
  if (!side) return null;
  const elbow = { x: pose[side.e].x * W, y: pose[side.e].y * H };
  const v = sub(elbow, wrist), len = Math.hypot(v.x, v.y);
  return len > 1.2 * L && len < 5 * L && dot(norm(v), d) < -0.4 ? elbow : null;
}

const add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y });
const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const mul = (a, k) => ({ x: a.x * k, y: a.y * k });
const dot = (a, b) => a.x * b.x + a.y * b.y;
const lerp = (a, b, u) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u });
const norm = (a) => { const l = Math.hypot(a.x, a.y) || 1; return { x: a.x / l, y: a.y / l }; };
const avg = (ps) => ({ x: ps.reduce((s, p) => s + p.x, 0) / ps.length, y: ps.reduce((s, p) => s + p.y, 0) / ps.length });
