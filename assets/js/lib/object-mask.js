/**
 * Subject masks for video and photos, chosen by clicking, tracked across frames and refined by hand.
 *
 *   const track = createMaskTrack('pop');
 *   track.setMedia(media);                       // a loadMedia() video or image (resets points, strokes, masks)
 *   track.setGrid(start, end, fps);              // video: which frames the masking pass samples
 *   track.mode = 'person' | 'object' | 'both';   // MediaPipe person segmentation, SAM 2.1 clicks, or their union
 *   track.addPoint(t, { x, y, keep });           // x, y in 0..1 of the source; a correction keyframe at t
 *   track.setKeyframes([{ t, points }]);         // replace every click at once (automatic prompts, e.g. from hand landmarks)
 *   await track.ensure({ onDownload });          // load the models the mode needs (show objectPlan() first)
 *   await track.refreshFrame(t);                 // instant result for the frame on screen after a click
 *   await track.run({ onProgress, signal });     // the masking pass: every stale frame of the grid
 *   const a = track.alpha(t, w, h, { threshold, softness, grow, feather, smooth });  // w×h alpha canvas or null
 *   track.box(t);                                // the subject's box/centre in 0..1, or null
 *
 * Masks are stored per sampled frame at STORE px (long side), separately for the person and the object part,
 * so switching the mode doesn't rerun anything that's already done.
 *
 * Object tracking (video): each correction keyframe holds the clicks for its frame. From there the pass walks
 * forward to the next keyframe (and backward before the first one): every click is carried to the next frame by
 * block matching on a small grey frame; "keep" clicks that drift off the subject are pulled back inside the
 * previous mask (moved by the subject's median motion), and the deepest point of that mask is added as an extra
 * keep prompt. SAM 2.1 then segments the frame from those points (one group per keep click, merged), and a frame
 * whose mask jumps (area ×3, box overlap < 20%) is flagged and holds the previous mask instead.
 *
 * Refinement happens at draw time and is cheap: zero-lag temporal smoothing (a centred window over the cached
 * frames), threshold/softness, grow/shrink (box blur + shifted threshold), add/erase brush strokes, then the
 * upscale with a feather. Strokes on video follow the subject (moved with its centre) from their frame until the
 * next keyframe, or apply to one frame. Photos use lib/still-mask.js (edge snapping, brush with undo).
 */
import { loadSegmenter, segmentFrame, segmentImage } from './vision.js';
import { subjectPlan, loadSubjectModel, embedPhoto, pickMask } from './subject.js';
import { createStillMask, bilinear, boxMean, guidedFilter } from './still-mask.js';
import { seekVideo } from './media.js';
import { smoothstep, clamp } from './easing.js';
import { scratch, supportsCanvasFilter } from './canvas.js';

const STORE = 512;   // long side of the stored masks (video frames)
const STORE_PHOTO = 1024; // photos: one mask, so keep SAM's full resolution
const GRAY = 256;    // long side of the grey frames used to carry clicks between frames
const PERSON = 'quality'; // multiclass MediaPipe model: 1 − background covers hair, body and clothes

export const MASK_MODES = [['person', 'Person'], ['object', 'Object'], ['both', 'Person + object']];

/** Download needed for the object model: { device, bytes, cached }. */
export const objectPlan = () => subjectPlan('pick');

export function createMaskTrack(prefix) {
  let media = null;
  let mode = 'person';
  let sw = 0, sh = 0;        // store size
  let grid = null;           // { start, end, fps }
  let frames = [];           // per grid sample, see blank()
  let keys = [];             // [{ t, points: [{ x, y, keep }] }] sorted by t
  let strokes = [];          // video brush strokes
  let history = [];          // undo stack: { type: 'point', key, point, created } | { type: 'stroke', stroke }
  let current = null;        // stroke being drawn
  let segVideo = null, segStill = null;
  let embedded = '';         // which frame the SAM worker has encoded
  let version = 0;           // bumps on every change that alters a mask
  let smallKey = '';
  const still = createStillMask(`${prefix}-om`);
  let photo = { per: null, obj: null, score: 1, stillKey: '', growKey: '' };
  let busy = Promise.resolve();

  const blank = (t) => ({ t, obj: null, per: null, objStale: true, perStale: true, pts: null, score: 1, warn: false, stats: {} });
  const isPhoto = () => media?.kind === 'image';
  const n = () => frames.length;
  const bump = () => { version++; };

  /* ---------- Grid and lookup ---------- */
  function idx(t) {
    if (!grid || !n()) return -1;
    const i = Math.round((t - grid.start) * grid.fps);
    if (i < -1 || i > n()) return -1;
    return clamp(i, 0, n() - 1);
  }
  const frameT = (i) => frames[i].t;
  const keyIndex = (k) => idx(k.t);
  const sortedKeys = () => keys.slice().sort((a, b) => a.t - b.t);
  const keepPoints = () => keys.some((k) => k.points.some((p) => p.keep));
  const wantsObject = () => mode !== 'person' && keepPoints();
  const wantsPerson = () => mode !== 'object';

  /** The clicks that apply at frame i: its own keyframe, the carried clicks, or the governing keyframe's. */
  function pointsFor(i) {
    const own = keys.find((k) => keyIndex(k) === i);
    if (own) return { points: own.points, key: own };
    if (frames[i]?.pts) return { points: frames[i].pts, key: null };
    const ks = sortedKeys();
    const gov = ks.filter((k) => keyIndex(k) <= i).pop() || ks[0];
    return { points: gov ? gov.points : [], key: null };
  }

  /** Mark the object frames a keyframe governs as stale. */
  function staleFrom(key) {
    const ks = sortedKeys();
    const at = ks.indexOf(key);
    const a = at <= 0 ? 0 : keyIndex(key);
    const b = at >= 0 && at < ks.length - 1 ? keyIndex(ks[at + 1]) - 1 : n() - 1;
    for (let i = a; i <= b; i++) if (frames[i]) frames[i].objStale = true;
  }

  /* ---------- Pixels ---------- */
  function gray(src, w, h, name) {
    const c = scratch(`${prefix}-om-gray-${name}-${w}x${h}`, w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.drawImage(src, 0, 0, w, h);
    const d = x.getImageData(0, 0, w, h).data;
    const out = new Float32Array(w * h);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = (0.299 * d[j] + 0.587 * d[j + 1] + 0.114 * d[j + 2]) / 255;
    return out;
  }
  const grayDims = () => { const s = GRAY / Math.max(sw, sh); return [Math.max(8, Math.round(sw * s)), Math.max(8, Math.round(sh * s))]; };

  const toU8 = (f) => { const u = new Uint8Array(f.length); for (let i = 0; i < f.length; i++) u[i] = f[i] * 255 + 0.5; return u; };
  const toStore = (raw) => bilinear(raw.data, raw.width, raw.height, sw, sh);

  /** Person probability for the frame on `el`, edge-snapped to the frame, at store size. */
  function personNow(el) {
    const raw = segmentFrame(segVideo, el, PERSON);
    if (!raw) return null;
    const up = toStore(raw);
    const guide = gray(el, sw, sh, 'guide');
    const r = Math.max(2, Math.round((Math.max(sw, sh) / Math.max(raw.width, raw.height)) * 1.5));
    return toU8(guidedFilter(guide, up, sw, sh, r, 2e-3));
  }

  /**
   * SAM mask for the frame on `el` from clicks (+ an extra keep point). Encodes the frame once per time.
   * Each keep click is its own object, except clicks sharing a `group` id, which prompt SAM together (one object
   * spanning all of them, e.g. a hand and the item it holds). Keep clicks marked `opt` are a guess (the item past
   * the fingertips): the mask is computed with and without them, and they're dropped when they add a huge region
   * (over 30% of the frame and 3× the rest), which means they landed on the background.
   */
  async function objectNow(el, points, extra, tag) {
    const keep = points.filter((p) => p.keep), drop = points.filter((p) => !p.keep);
    if (!keep.length) return null;
    if (embedded !== tag) { await embedPhoto(el); embedded = tag; }
    const groupsOf = (ks) => {
      const byGroup = new Map();
      for (const p of [...ks, ...(extra ? [extra] : [])]) {
        const g = p.group ?? Symbol('click');
        if (!byGroup.has(g)) byGroup.set(g, []);
        byGroup.get(g).push({ x: p.x, y: p.y, keep: true });
      }
      return [...byGroup.values()].map((ps) => [...ps, ...drop]);
    };
    let raw = await pickMask(groupsOf(keep));
    const sure = keep.filter((p) => !p.opt);
    if (raw && sure.length && sure.length < keep.length) {
      const base = await pickMask(groupsOf(sure));
      const area = (m) => { let n = 0; for (let i = 0; i < m.data.length; i++) if (m.data[i] >= 0.5) n++; return n / m.data.length; };
      if (base && area(raw) > 0.3 && area(raw) > area(base) * 3) raw = base;
    }
    return raw && { data: mainParts(toU8(toStore(raw)), sw, sh), score: raw.score ?? 1 };
  }

  /**
   * Drop the specks: keep the connected parts (8-neighbour, ≥ 50%) of a mask that are at least 4% of its largest
   * part. SAM sometimes adds a few far-away blobs, which a pop-out or a wipe would show as dirt.
   */
  function mainParts(u8, W, H) {
    const label = new Int32Array(W * H).fill(-1);
    const sizes = [];
    const stack = [];
    for (let i = 0; i < u8.length; i++) {
      if (u8[i] < 128 || label[i] >= 0) continue;
      const id = sizes.length;
      let n = 0;
      label[i] = id; stack.push(i);
      while (stack.length) {
        const j = stack.pop(), x = j % W, y = (j - x) / W;
        n++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const k = yy * W + xx;
          if (label[k] < 0 && u8[k] >= 128) { label[k] = id; stack.push(k); }
        }
      }
      sizes.push(n);
    }
    if (sizes.length < 2) return u8;
    const min = Math.max(...sizes) * 0.04;
    const out = u8.slice();
    for (let i = 0; i < out.length; i++) if (label[i] >= 0 && sizes[label[i]] < min) out[i] = 0;
    return out;
  }

  /**
   * Centre, box and area of a stored mask (0..1), plus tx: the mean x of its top 4% rows (where the top of the
   * subject is, horizontally). The box ignores the outer 0.5% of the mask's area on each side, so a few stray
   * pixels don't stretch it. Cached on the frame per kind.
   */
  function statsOf(u8, W = sw, H = sh) {
    let a = 0, sx = 0, sy = 0;
    const rows = new Uint32Array(H), cols = new Uint32Array(W);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (u8[y * W + x] < 128) continue;
        a++; sx += x; sy += y; rows[y]++; cols[x]++;
      }
    }
    if (!a) return null;
    const cut = a * 0.005;
    const lo = (hist) => { let c = 0; for (let i = 0; i < hist.length; i++) { c += hist[i]; if (c > cut) return i; } return 0; };
    const hi = (hist) => { let c = 0; for (let i = hist.length - 1; i >= 0; i--) { c += hist[i]; if (c > cut) return i; } return hist.length - 1; };
    const x0 = lo(cols), x1 = hi(cols), y0 = lo(rows), y1 = hi(rows);
    let tsx = 0, tn = 0;
    for (let y = y0, ye = y0 + Math.max(1, Math.round((y1 - y0 + 1) * 0.04)); y < ye; y++) {
      for (let x = x0; x <= x1; x++) if (u8[y * W + x] >= 128) { tsx += x; tn++; }
    }
    return {
      cx: (sx / a + 0.5) / W, cy: (sy / a + 0.5) / H, x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H,
      area: a / (W * H), tx: tn ? (tsx / tn + 0.5) / W : (sx / a + 0.5) / W,
    };
  }

  /** The deepest point of a mask (chamfer distance transform), in 0..1, or null. */
  function deepest(u8) {
    const W = sw, H = sh, INF = 1e9;
    const d = new Float32Array(W * H);
    for (let i = 0; i < d.length; i++) d[i] = u8[i] >= 128 ? INF : 0;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x > 0) v = Math.min(v, d[i - 1] + 1); else v = Math.min(v, 1);
      if (y > 0) v = Math.min(v, d[i - W] + 1); else v = Math.min(v, 1);
      if (x > 0 && y > 0) v = Math.min(v, d[i - W - 1] + 1.414);
      if (x < W - 1 && y > 0) v = Math.min(v, d[i - W + 1] + 1.414);
      d[i] = v;
    }
    let best = 0, bi = -1;
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      let v = d[i];
      if (x < W - 1) v = Math.min(v, d[i + 1] + 1); else v = Math.min(v, 1);
      if (y < H - 1) v = Math.min(v, d[i + W] + 1); else v = Math.min(v, 1);
      if (x < W - 1 && y < H - 1) v = Math.min(v, d[i + W + 1] + 1.414);
      if (x > 0 && y < H - 1) v = Math.min(v, d[i + W - 1] + 1.414);
      d[i] = v;
      if (v > best) { best = v; bi = i; }
    }
    return bi < 0 ? null : { x: ((bi % W) + 0.5) / W, y: (Math.floor(bi / W) + 0.5) / H };
  }

  const sample = (u8, x, y) => u8[clamp(Math.round(y * sh - 0.5), 0, sh - 1) * sw + clamp(Math.round(x * sw - 0.5), 0, sw - 1)] / 255;

  /** Copy of a mask moved by (dx, dy) in 0..1. */
  function shifted(u8, dx, dy) {
    const out = new Uint8Array(u8.length);
    const ox = Math.round(dx * sw), oy = Math.round(dy * sh);
    for (let y = 0; y < sh; y++) {
      const sy = y - oy;
      if (sy < 0 || sy >= sh) continue;
      for (let x = 0; x < sw; x++) {
        const sx = x - ox;
        if (sx >= 0 && sx < sw) out[y * sw + x] = u8[sy * sw + sx];
      }
    }
    return out;
  }

  /**
   * Where the patch around (x, y) of grey frame a went in grey frame b: SAD block matching over ±R px,
   * coarse (step 2) then fine, with a small penalty on distance. Null on flat patches (nothing to follow).
   */
  function matchPoint(a, b, gw, gh, x, y) {
    const P = 4, R = Math.round(Math.max(gw, gh) * 0.09);
    const px = Math.round(x * gw), py = Math.round(y * gh);
    let mean = 0, m2 = 0, cnt = 0;
    for (let v = -P; v <= P; v++) for (let u = -P; u <= P; u++) {
      const xx = clamp(px + u, 0, gw - 1), yy = clamp(py + v, 0, gh - 1);
      const g = a[yy * gw + xx];
      mean += g; m2 += g * g; cnt++;
    }
    mean /= cnt;
    if (m2 / cnt - mean * mean < 2e-4) return null;
    const cost = (dx, dy) => {
      let s = 0;
      for (let v = -P; v <= P; v++) {
        const ya = clamp(py + v, 0, gh - 1), yb = clamp(py + v + dy, 0, gh - 1);
        for (let u = -P; u <= P; u++) {
          s += Math.abs(a[ya * gw + clamp(px + u, 0, gw - 1)] - b[yb * gw + clamp(px + u + dx, 0, gw - 1)]);
        }
      }
      return s + 0.002 * (dx * dx + dy * dy);
    };
    let best = Infinity, bx = 0, by = 0;
    for (let dy = -R; dy <= R; dy += 2) for (let dx = -R; dx <= R; dx += 2) {
      const c = cost(dx, dy);
      if (c < best) { best = c; bx = dx; by = dy; }
    }
    const cx = bx, cy = by;
    for (let dy = cy - 1; dy <= cy + 1; dy++) for (let dx = cx - 1; dx <= cx + 1; dx++) {
      const c = cost(dx, dy);
      if (c < best) { best = c; bx = dx; by = dy; }
    }
    return { x: (px + bx) / gw, y: (py + by) / gh, dx: bx / gw, dy: by / gh };
  }

  /** Carry clicks from the previous frame to this one. Returns { points, d: [dx, dy] }. */
  function carry(prevPts, prevMask, ga, gb) {
    const [gw, gh] = grayDims();
    const moved = prevPts.map((p) => ({ p, m: matchPoint(ga, gb, gw, gh, p.x, p.y) }));
    const ds = moved.filter((o) => o.p.keep && o.m).map((o) => [o.m.dx, o.m.dy]);
    const med = (k) => { const v = ds.map((d) => d[k]).sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 0; };
    const d = [med(0), med(1)];
    const deep = prevMask && deepest(prevMask);
    const points = moved.map(({ p, m }) => {
      if (!p.keep) return { ...p, x: clamp(m ? m.x : p.x + d[0]), y: clamp(m ? m.y : p.y + d[1]) };
      // A keep click must stay on the subject: check against the previous mask moved by the median motion.
      let x = m ? m.x : p.x + d[0], y = m ? m.y : p.y + d[1];
      if (prevMask && sample(prevMask, x - d[0], y - d[1]) < 0.5) {
        x = p.x + d[0]; y = p.y + d[1];
        if (sample(prevMask, p.x, p.y) < 0.5 && deep) {
          // March toward the mask's deepest point until inside.
          for (let s = 1; s <= 20; s++) {
            const u = s / 20, qx = p.x + (deep.x - p.x) * u, qy = p.y + (deep.y - p.y) * u;
            if (sample(prevMask, qx, qy) >= 0.5) { x = qx + d[0]; y = qy + d[1]; break; }
          }
        }
      }
      return { ...p, x: clamp(x), y: clamp(y) };
    });
    return { points, d, extra: deep && { x: clamp(deep.x + d[0]), y: clamp(deep.y + d[1]), keep: true } };
  }

  /* ---------- Masking pass ---------- */
  function chains() {
    const ks = sortedKeys().filter((k) => k.points.some((p) => p.keep));
    if (!ks.length) return [];
    const out = [];
    const first = keyIndex(ks[0]);
    ks.forEach((k, j) => {
      const a = keyIndex(k), b = j < ks.length - 1 ? keyIndex(ks[j + 1]) - 1 : n() - 1;
      const list = [];
      for (let i = a; i <= b; i++) list.push(i);
      out.push({ key: k, list });
    });
    if (first > 0) {
      const list = [];
      for (let i = first; i >= 0; i--) list.push(i);
      out.unshift({ key: ks[0], list, back: true }); // the key frame itself, then backwards
    }
    return out;
  }

  async function runVideo({ onProgress, signal }) {
    const el = media.el;
    const resume = el.currentTime;
    el.pause();
    const needPer = wantsPerson();
    const needObj = wantsObject();
    if (!needObj) for (const f of frames) { f.objStale = false; }
    const todo = new Set();
    frames.forEach((f, i) => { if ((needPer && f.perStale) || (needObj && f.objStale)) todo.add(i); });
    const total = Math.max(1, todo.size);
    let done = 0;
    const tick = () => { done++; onProgress?.(Math.min(1, done / total)); };
    const at = async (i) => { await seekVideo(el, Math.min(media.duration - 0.001, frameT(i))); };
    try {
      if (needObj) {
        for (const ch of chains()) {
          const list = ch.list;
          let start = list.findIndex((i) => frames[i].objStale);
          if (start < 0) continue;
          let prevGray = null, prevPts = null, prevMask = null;
          if (start > 0) {
            const p = list[start - 1];
            await at(p);
            prevGray = gray(el, ...grayDims(), 'a');
            prevPts = frames[p].pts || ch.key.points;
            prevMask = frames[p].obj;
          }
          for (let s = start; s < list.length; s++) {
            if (signal?.aborted) return false;
            const i = list[s];
            const f = frames[i];
            await at(i);
            const g = gray(el, ...grayDims(), s % 2 ? 'b' : 'c');
            let pts, extra = null, d = [0, 0];
            if (s === 0 || !prevGray) pts = keyIndex(ch.key) === i ? ch.key.points : (f.pts || ch.key.points);
            else ({ points: pts, extra, d } = carry(prevPts, prevMask, prevGray, g));
            if (keyIndex(ch.key) === i) pts = ch.key.points;
            const res = await objectNow(el, pts, extra, `v${frameT(i)}`);
            let mask = res?.data || null, warn = false;
            const st = mask && statsOf(mask);
            if (prevMask && s > 0) {
              const ps = statsOf(prevMask);
              const lost = !st || (ps && (st.area > ps.area * 3 || st.area < ps.area / 3 || boxIoU(st, { ...ps, x: ps.x + d[0], y: ps.y + d[1] }) < 0.2));
              if (lost && ps) { mask = shifted(prevMask, d[0], d[1]); warn = true; }
            }
            f.obj = mask;
            f.score = res?.score ?? 0;
            f.warn = warn || (res ? res.score < 0.5 : false);
            f.pts = pts.map((p) => ({ x: p.x, y: p.y, keep: p.keep, group: p.group, opt: p.opt }));
            f.objStale = false;
            f.stats = {};
            if (needPer && f.perStale) { f.per = personNow(el); f.perStale = false; }
            todo.delete(i);
            tick();
            prevGray = g; prevPts = f.pts; prevMask = f.obj;
          }
        }
      }
      if (needObj && keys.some((k) => k.auto)) fixOutliers();
      for (const i of [...todo].sort((a, b) => a - b)) {
        if (signal?.aborted) return false;
        const f = frames[i];
        if (needPer && f.perStale) {
          await at(i);
          f.per = personNow(el);
          f.perStale = false;
          f.stats = {};
        }
        if (!needObj) f.objStale = false;
        tick();
        if (done % 3 === 0) await new Promise((r) => setTimeout(r));
      }
      return true;
    } finally {
      bump();
      await seekVideo(el, resume);
    }
  }

  /**
   * Automatic keyframes (one per frame) skip the chain's jump guard, so check each frame against its neighbours
   * instead: an object mask under half or over twice the median size of the frames around it (±5) grabbed something
   * else (or lost the subject). It gets the nearest normal frame's mask, moved by its first keep prompt (e.g. the
   * palm), flagged amber. A local median, not the previous frame, so one bad frame (even the first) can't spread,
   * and a subject that grows steadily (a push-in) isn't an outlier.
   */
  function fixOutliers() {
    const area = frames.map((f) => (f.obj ? statsOf(f.obj)?.area || 0 : 0));
    if (area.filter((a) => a > 0).length < 3) return;
    const local = area.map((_, i) => {
      const v = area.slice(Math.max(0, i - 5), i + 6).filter((a, j) => a > 0 && j !== Math.min(i, 5)).sort((a, b) => a - b);
      return v.length ? v[v.length >> 1] : 0;
    });
    const good = (i) => frames[i].obj && local[i] > 0 && area[i] >= local[i] / 2 && area[i] <= local[i] * 2;
    const orig = frames.map((f) => f.obj);
    frames.forEach((f, i) => {
      if (good(i) || !keys.some((k) => k.auto && keyIndex(k) === i) && f.obj) return;
      let j = -1;
      for (let r = 1; r < frames.length && j < 0; r++) {
        if (i - r >= 0 && good(i - r)) j = i - r;
        else if (i + r < frames.length && good(i + r)) j = i + r;
      }
      if (j < 0) return;
      const a = frames[j].pts?.find((p) => p.keep), b = f.pts?.find((p) => p.keep);
      f.obj = shifted(orig[j], a && b ? b.x - a.x : 0, a && b ? b.y - a.y : 0);
      f.warn = true;
      f.stats = {};
    });
  }

  async function runPhoto() {
    const img = media.el;
    if (wantsPerson() && !photo.per) {
      segStill ||= await loadSegmenter(PERSON, { mode: 'IMAGE' });
      photo.per = segmentImage(segStill, img, PERSON);
    }
    if (wantsObject()) {
      const res = await objectNow(img, keys[0]?.points || [], null, 'photo');
      photo.obj = res && { data: res.data, width: sw, height: sh };
      photo.score = res?.score ?? 1;
    } else photo.obj = null;
    applyPhoto();
  }

  /** Combine the photo's raw masks for the mode and hand them to still-mask (brush edits survive). */
  function applyPhoto() {
    const per = mode !== 'object' ? photo.per : null;
    const obj = mode !== 'person' ? photo.obj : null;
    let raw = null;
    if (per && obj) {
      const p = bilinear(per.data, per.width, per.height, sw, sh);
      const data = new Float32Array(sw * sh);
      for (let i = 0; i < data.length; i++) data[i] = Math.max(p[i], obj.data[i] / 255);
      raw = { data, width: sw, height: sh };
    } else if (obj) raw = { data: Float32Array.from(obj.data, (v) => v / 255), width: sw, height: sh };
    else if (per) raw = per;
    if (!raw) { photo.ready = false; bump(); return; }
    if (still.ready) still.setMask(raw);
    else still.setSource(media.el, raw);
    photo.ready = true;
    photo.stillKey = '';
    bump();
  }

  /* ---------- Drawing ---------- */
  function combined(f) {
    const per = mode !== 'object' ? f.per : null;
    const obj = mode !== 'person' && wantsObject() ? f.obj : null;
    if (per && obj) {
      const out = new Uint8Array(per.length);
      for (let i = 0; i < out.length; i++) out[i] = per[i] > obj[i] ? per[i] : obj[i];
      return out;
    }
    return per || obj;
  }
  const hasMask = (f) => !!((mode !== 'object' && f.per) || (mode !== 'person' && wantsObject() && f.obj));

  function frameStats(i) {
    const f = frames[i];
    if (!(mode in f.stats)) { const m = hasMask(f) && combined(f); f.stats[mode] = m ? statsOf(m) : null; }
    return f.stats[mode];
  }

  /** Strokes that apply to frame i, each with the offset that moves it with the subject. */
  function strokesFor(i) {
    const ks = sortedKeys();
    return strokes.map((st) => {
      const si = idx(st.t);
      if (st.scope === 'frame' ? si !== i : i < si) return null;
      if (st.scope !== 'frame') {
        const next = ks.find((k) => keyIndex(k) > si);
        if (next && i >= keyIndex(next)) return null;
      }
      const a = frameStats(si), b = frameStats(i);
      return { st, dx: a && b ? b.cx - a.cx : 0, dy: a && b ? b.cy - a.cy : 0 };
    }).filter(Boolean);
  }

  function paintStroke(c, st, dx, dy, W, H) {
    const r = st.r * W;
    const step = Math.max(0.5, r / 4);
    c.save();
    c.globalCompositeOperation = st.mode === 'add' ? 'source-over' : 'destination-out';
    const dab = (x, y) => {
      const g = c.createRadialGradient(x, y, r * (1 - st.soft) * 0.999, x, y, r);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
    };
    st.pts.forEach((p, k) => {
      const x = (p.x + dx) * W, y = (p.y + dy) * H;
      if (!k) return dab(x, y);
      const q = st.pts[k - 1], qx = (q.x + dx) * W, qy = (q.y + dy) * H;
      const m = Math.max(1, Math.ceil(Math.hypot(x - qx, y - qy) / step));
      for (let s = 1; s <= m; s++) dab(qx + ((x - qx) * s) / m, qy + ((y - qy) * s) / m);
    });
    c.restore();
  }

  /** Threshold/softness + grow/shrink of a 0..1 float mask into an alpha canvas. */
  function toCanvas(c, f32, W, H, o) {
    let v = f32;
    let th = o.threshold ?? 0.5;
    const g = Math.round(o.grow || 0);
    if (g) {
      v = boxMean(f32, W, H, Math.abs(g));
      th = clamp(th - Math.sign(g) * 0.42, 0.02, 0.98);
    }
    const soft = o.softness ?? 0.2;
    const lo = th - soft / 2, hi = th + soft / 2;
    const x = c.getContext('2d');
    const img = x.createImageData(W, H);
    for (let i = 0, j = 0; i < v.length; i++, j += 4) {
      img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
      img.data[j + 3] = smoothstep(lo, hi, v[i]) * 255;
    }
    x.putImageData(img, 0, 0);
  }

  function smallVideo(i, o) {
    const c = scratch(`${prefix}-om-small`, sw, sh);
    const key = `${i}|${mode}|${o.threshold}|${o.softness}|${o.growStore}|${o.smooth}|${version}`;
    if (key === smallKey) return c;
    const r = Math.round((o.smooth || 0) * 3);
    const acc = new Float32Array(sw * sh);
    let wsum = 0;
    for (let j = i - r; j <= i + r; j++) {
      const f = frames[j];
      if (!f || !hasMask(f)) continue;
      const w = r + 1 - Math.abs(j - i);
      const m = combined(f);
      for (let p = 0; p < acc.length; p++) acc[p] += m[p] * w;
      wsum += w;
    }
    if (!wsum) return null;
    for (let p = 0; p < acc.length; p++) acc[p] /= wsum * 255;
    // Grow is given in output px; the caller converts it to store px through o.growStore.
    toCanvas(c, acc, sw, sh, { ...o, grow: o.growStore });
    const x = c.getContext('2d');
    for (const { st, dx, dy } of strokesFor(i)) paintStroke(x, st, dx, dy, sw, sh);
    smallKey = key;
    return c;
  }

  function smallPhoto(o) {
    const sk = `${o.threshold}|${o.softness}|${o.edgeSnap !== false}`;
    if (sk !== photo.stillKey) {
      still.update({ threshold: o.threshold ?? 0.5, softness: o.softness ?? 0.2, polarity: 'normal', edgeSnap: o.edgeSnap !== false });
      photo.stillKey = sk;
    }
    const g = Math.round(o.growWork || 0);
    if (!g) return still.canvas;
    const c = scratch(`${prefix}-om-photo-grow`, still.width, still.height);
    const gk = `${still.version}|${g}|${o.softness}`;
    if (gk === photo.growKey) return c;
    const src = still.canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, still.width, still.height).data;
    const f = new Float32Array(still.width * still.height);
    for (let i = 0; i < f.length; i++) f[i] = src[i * 4 + 3] / 255;
    toCanvas(c, f, still.width, still.height, { threshold: 0.5, softness: o.softness ?? 0.2, grow: g });
    photo.growKey = gk;
    return c;
  }

  const track = {
    get version() { return version; },
    get media() { return media; },
    get mode() { return mode; },
    set mode(m) { if (m !== mode) { mode = m; smallKey = ''; if (isPhoto() && media) applyPhoto(); bump(); } },
    get grid() { return grid; },
    get keys() { return sortedKeys(); },
    get canUndo() { return isPhoto() ? history.length > 0 || still.canUndo : history.length > 0; },
    get hasPoints() { return keepPoints(); },
    get hasStrokes() { return isPhoto() ? still.edited : strokes.length > 0; },
    get size() { return { width: sw, height: sh }; },

    /** New source: forget masks, clicks and strokes. */
    setMedia(m) {
      media = m;
      frames = []; keys = []; strokes = []; history = []; grid = null; embedded = ''; smallKey = '';
      photo = { per: null, obj: null, score: 1, stillKey: '', growKey: '', ready: false };
      still.reset();
      if (m) {
        const s = (m.kind === 'image' ? STORE_PHOTO : STORE) / Math.max(m.width, m.height);
        sw = Math.max(8, Math.round(m.width * s));
        sh = Math.max(8, Math.round(m.height * s));
        if (m.kind === 'image') { grid = { start: 0, end: 0, fps: 1 }; frames = [blank(0)]; }
      }
      bump();
    },

    /** Video: sample the masking pass from start to end (seconds of the source) at fps. Keeps clicks and strokes. */
    setGrid(start, end, fps) {
      if (!media || isPhoto()) return;
      end = Math.min(end, media.duration - 0.001);
      start = clamp(start, 0, end);
      if (grid && grid.start === start && grid.end === end && grid.fps === fps) return;
      const count = Math.max(1, Math.floor((end - start) * fps + 1e-6) + 1);
      const old = frames;
      frames = Array.from({ length: count }, (_, i) => {
        const t = Math.min(end, start + i / fps);
        const same = old.find((f) => Math.abs(f.t - t) < 1e-3);
        return same || blank(t);
      });
      grid = { start, end, fps };
      smallKey = '';
      bump();
    },

    /** What the mode needs loaded right now: { person, object } (the object model only once there's a keep click). */
    needs() { return { person: wantsPerson(), object: wantsObject() }; },

    /** Load the models the current mode needs. onDownload(loaded, total) reports the object model download. */
    async ensure({ onDownload } = {}) {
      if (wantsPerson()) {
        if (isPhoto()) segStill ||= await loadSegmenter(PERSON, { mode: 'IMAGE' });
        else segVideo ||= await loadSegmenter(PERSON);
      }
      if (wantsObject()) { await loadSubjectModel('pick', { onDownload }); embedded = ''; }
    },

    /** Add a click at time t. Video: a correction keyframe on that frame (it starts with the clicks carried there). */
    addPoint(t, p) {
      const i = isPhoto() ? 0 : idx(t);
      if (i < 0) return false;
      let key = keys.find((k) => keyIndex(k) === i);
      let created = false;
      if (!key) {
        const carried = keys.length ? pointsFor(i).points.map((q) => ({ x: q.x, y: q.y, keep: q.keep, group: q.group, opt: q.opt })) : [];
        key = { t: frameT(i), points: carried };
        keys.push(key);
        created = true;
      }
      const point = { x: clamp(p.x), y: clamp(p.y), keep: !!p.keep };
      key.points.push(point);
      history.push({ type: 'point', key, point, created });
      staleFrom(key);
      if (isPhoto()) photo.obj = null;
      bump();
      return true;
    },

    /** Remove the click nearest (x, y) on the frame at t, within r (0..1). Returns true when one was removed. */
    removePointNear(t, x, y, r = 0.03) {
      const i = isPhoto() ? 0 : idx(t);
      const key = keys.find((k) => keyIndex(k) === i);
      if (!key) return false;
      let best = -1, bd = r;
      key.points.forEach((p, j) => { const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = j; } });
      if (best < 0) return false;
      key.points.splice(best, 1);
      if (!key.points.length) keys = keys.filter((k) => k !== key);
      history = history.filter((h) => h.key !== key || key.points.includes(h.point));
      staleFrom(key);
      bump();
      return true;
    },

    /**
     * Replace every click with these keyframes ([{ t, points: [{ x, y, keep, group? }] }]), e.g. prompts placed
     * automatically on each sampled frame. Video times snap to the grid (one keyframe per frame, the last wins);
     * photos use the first entry. Clears the click undo history; strokes stay. `auto` keyframes keep the pass's jump
     * guard (a sudden mask jump holds the previous frame's mask); clicked ones are trusted as they are.
     */
    setKeyframes(list, { auto = true } = {}) {
      const next = new Map();
      for (const k of list || []) {
        const i = isPhoto() ? 0 : idx(k.t);
        if (i < 0 || !k.points?.length) continue;
        next.set(i, { t: frameT(i), auto, points: k.points.map((p) => ({ x: clamp(p.x), y: clamp(p.y), keep: !!p.keep, group: p.group, opt: p.opt })) });
      }
      keys = [...next.values()];
      history = history.filter((h) => h.type !== 'point');
      for (const f of frames) { f.obj = null; f.pts = null; f.objStale = true; f.warn = false; f.stats = {}; }
      photo.obj = null;
      if (isPhoto()) applyPhoto();
      bump();
    },

    clearPoints() {
      keys = [];
      history = history.filter((h) => h.type !== 'point');
      for (const f of frames) { f.obj = null; f.pts = null; f.objStale = true; f.stats = {}; }
      photo.obj = null;
      if (isPhoto()) applyPhoto();
      bump();
    },

    /** Clicks to show on the frame at t: { points, key } (key false = carried by tracking, drawn faint). */
    pointsAt(t) {
      const i = isPhoto() ? 0 : idx(t);
      if (i < 0) return { points: [], key: false };
      const r = pointsFor(i);
      return { points: r.points, key: !!r.key };
    },

    /** Recompute the frame on screen (after a click): object part only, from the element's current frame. */
    async refreshFrame(t) {
      const job = busy.then(async () => {
        if (!media) return;
        if (isPhoto()) return runPhoto();
        const i = idx(t);
        if (i < 0) return;
        const f = frames[i];
        const { points } = pointsFor(i);
        if (mode !== 'person' && points.some((p) => p.keep)) {
          const res = await objectNow(media.el, points, null, `v${media.el.currentTime.toFixed(3)}`);
          f.obj = res?.data || null;
          f.score = res?.score ?? 0;
          f.warn = !!res && res.score < 0.5;
          f.pts = points.map((p) => ({ ...p }));
          // The keyframe's own frame is done; frames after it still need the pass (they follow from this one).
          if (keys.some((k) => keyIndex(k) === i)) f.objStale = false;
        }
        if (wantsPerson() && f.perStale && segVideo) { f.per = personNow(media.el); f.perStale = false; }
        f.stats = {};
        bump();
      });
      busy = job.catch(() => {});
      return job;
    },

    /** The masking pass. Resolves true when finished, false when cancelled. Load models first (ensure). */
    async run(opts = {}) {
      if (!media) return false;
      const job = busy.then(() => (isPhoto() ? runPhoto().then(() => true) : runVideo(opts)));
      busy = job.catch(() => {});
      return job;
    },

    /** Frames still to compute for the current mode (0 = ready). */
    staleCount() {
      if (!media) return 0;
      if (isPhoto()) return (wantsPerson() && !photo.per) || (wantsObject() && !photo.obj) ? 1 : 0;
      const obj = wantsObject();
      return frames.filter((f) => (wantsPerson() && f.perStale) || (obj && f.objStale)).length;
    },

    /** One entry per sampled frame for a status strip: { t, state: 'todo' | 'ok' | 'warn' | 'empty', key }. */
    timeline() {
      const obj = wantsObject();
      return frames.map((f, i) => ({
        t: f.t,
        key: keys.some((k) => keyIndex(k) === i),
        state: (wantsPerson() && f.perStale) || (obj && f.objStale) ? 'todo' : !hasMask(f) ? 'empty' : f.warn && obj ? 'warn' : 'ok',
      }));
    },

    /** Is a mask available for time t? */
    ready(t) {
      if (!media) return false;
      if (isPhoto()) return !!photo.ready;
      const i = idx(t);
      return i >= 0 && hasMask(frames[i]);
    },

    /** The subject's box at t in 0..1: { cx, cy, x, y, w, h, area, tx (x of its top) }, interpolated between sampled frames. */
    box(t) {
      if (!media) return null;
      if (isPhoto()) {
        if (!photo.ready) return null;
        if (!photo.stillKey) { still.update({ polarity: 'normal' }); photo.stillKey = 'box'; } // not drawn yet (no alpha() call since the pass)
        if (photo.box?.v !== still.version) {
          const c = still.canvas, d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
          const u = new Uint8Array(c.width * c.height);
          for (let i = 0; i < u.length; i++) u[i] = d[i * 4 + 3];
          photo.box = { v: still.version, s: statsOf(u, c.width, c.height) };
        }
        return photo.box.s;
      }
      if (!grid || !n()) return null;
      const u = (t - grid.start) * grid.fps;
      const i0 = clamp(Math.floor(u), 0, n() - 1), i1 = clamp(i0 + 1, 0, n() - 1);
      const a = frameStats(i0), b = frameStats(i1);
      if (!a || !b) return a || b;
      const k = clamp(u - i0);
      const L = (p) => a[p] + (b[p] - a[p]) * k;
      return { cx: L('cx'), cy: L('cy'), x: L('x'), y: L('y'), w: L('w'), h: L('h'), area: L('area'), tx: L('tx') };
    },

    /**
     * Alpha canvas (w×h, covering the source frame) for time t, or null when there's no mask there.
     * o: { threshold, softness, grow (px at w×h, + expands), feather (px), smooth (0..1), compensate (true), edgeSnap (photos) }.
     */
    alpha(t, w, h, o = {}) {
      if (!media) return null;
      w = Math.max(1, Math.round(w)); h = Math.max(1, Math.round(h));
      let small, dx = 0, dy = 0;
      if (isPhoto()) {
        if (!photo.ready) return null;
        small = smallPhoto({ ...o, growWork: ((o.grow || 0) * still.width) / w });
      } else {
        const i = idx(t);
        if (i < 0 || !hasMask(frames[i])) return null;
        small = smallVideo(i, { ...o, growStore: ((o.grow || 0) * sw) / w });
        if (!small) return null;
        if (o.compensate !== false) {
          // Sampled at grid fps: move the nearest mask along the subject's path to the exact time.
          const now = track.box(t), at = frameStats(i);
          if (now && at) { dx = now.cx - at.cx; dy = now.cy - at.cy; }
        }
      }
      const c = scratch(`${prefix}-om-full-${w}x${h}`, w, h);
      const x = c.getContext('2d');
      x.clearRect(0, 0, w, h);
      x.imageSmoothingEnabled = true;
      x.imageSmoothingQuality = 'high';
      if ((o.feather || 0) > 0 && supportsCanvasFilter) x.filter = `blur(${o.feather}px)`;
      x.drawImage(small, dx * w, dy * h, w, h);
      x.filter = 'none';
      return c;
    },

    /* ---------- Brush ---------- */
    /** Start a stroke at time t. r: radius in 0..1 of the source width; soft 0..1; scope 'onward' | 'frame'. */
    beginStroke(t, brushMode, r, soft, scope = 'onward') {
      if (isPhoto()) {
        still.beginStroke(brushMode, r * still.width, soft);
        current = { photo: true };
        return;
      }
      const i = idx(t);
      if (i < 0) return;
      current = { t: frameT(i), mode: brushMode, r, soft, scope, pts: [] };
      strokes.push(current);
    },
    strokeTo(x, y) {
      if (!current) return;
      if (current.photo) { still.strokeTo(x * still.width, y * still.height); bump(); return; }
      current.pts.push({ x, y });
      bump();
    },
    endStroke() {
      if (!current) return;
      if (current.photo) { still.endStroke(); history.push({ type: 'still' }); }
      else if (!current.pts.length) strokes.pop();
      else history.push({ type: 'stroke', stroke: current });
      current = null;
    },
    clearStrokes() {
      if (isPhoto()) still.clearEdits();
      strokes = [];
      history = history.filter((h) => h.type === 'point');
      bump();
    },

    /** Undo the last click or stroke. */
    undo() {
      const last = history.pop();
      if (!last) return false;
      if (last.type === 'still') still.undo();
      else if (last.type === 'stroke') strokes = strokes.filter((s) => s !== last.stroke);
      else {
        const { key, point, created } = last;
        key.points = key.points.filter((p) => p !== point);
        if (created || !key.points.length) {
          // The keyframe brought carried clicks along; dropping the last own click removes the keyframe.
          keys = keys.filter((k) => k !== key);
        }
        staleFrom(key);
        for (const k of keys) staleFrom(k);
        if (isPhoto()) photo.obj = null;
      }
      bump();
      return true;
    },
  };
  return track;
}

function boxIoU(a, b) {
  const x0 = Math.max(a.x, b.x), y0 = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x1 - x0) * Math.max(0, y1 - y0);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}
