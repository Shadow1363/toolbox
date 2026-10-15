/*
 * Zoom camera (shared by Zoom on Click and the Auto Editor's zoom effect): turns zoom points into
 * keyframes, samples the camera at any time, and draws a source through it.
 *
 *   point  = { id, t, x, y, zoom, dur, hold, easing, source }   // x, y in 0..1 of the source frame
 *   camera = { cx, cy, z }                                      // view centre (0..1) and zoom (1 = whole frame)
 *
 * A zoom move is centred on the click: it starts dur/2 before t and arrives dur/2 after.
 * Points whose move starts before the previous zoom would have finished zooming out (+ `follow`
 * seconds) join the same session: the camera pans from point to point instead of zooming out and in.
 */
import { ease, easings } from "./easing.js";

export const FULL = { cx: 0.5, cy: 0.5, z: 1 };

/** Keep the view inside the frame. */
export function clampView(v) {
  const z = Math.max(1, v.z);
  const h = 0.5 / z;
  return {
    cx: Math.min(1 - h, Math.max(h, v.cx)),
    cy: Math.min(1 - h, Math.max(h, v.cy)),
    z,
  };
}

const viewOf = (p) => clampView({ cx: p.x, cy: p.y, z: p.zoom });

/** Keyframes [{ t, v, easing }] (easing = the curve used to arrive at this keyframe), plus sessions for the timeline. */
export function buildKeyframes(points, { follow = 1 } = {}) {
  const pts = [...points].sort((a, b) => a.t - b.t);
  const keys = [{ t: -1e9, v: FULL, easing: "linear" }];
  const sessions = [];
  let i = 0;
  while (i < pts.length) {
    // Collect one session.
    const group = [pts[i]];
    while (i + 1 < pts.length) {
      const last = group[group.length - 1],
        next = pts[i + 1];
      const lastOutEnd = last.t + last.hold + last.dur;
      if (next.t - next.dur / 2 <= lastOutEnd + follow) {
        group.push(next);
        i++;
      } else break;
    }
    i++;
    const first = group[0];
    const startIn = Math.max(keys[keys.length - 1].t, first.t - first.dur / 2);
    keys.push({ t: startIn, v: FULL, easing: "linear" });
    keys.push({
      t: Math.max(startIn + 0.01, first.t + first.dur / 2),
      v: viewOf(first),
      easing: first.easing,
    });
    for (let g = 1; g < group.length; g++) {
      const p = group[g],
        prevKey = keys[keys.length - 1];
      const moveStart = p.t - p.dur / 2;
      if (moveStart > prevKey.t + 0.01)
        keys.push({ t: moveStart, v: prevKey.v, easing: "linear" }); // hold, then pan
      // A move always takes at least half its duration, so clicks in quick succession glide instead of jumping.
      keys.push({
        t: Math.max(keys[keys.length - 1].t + p.dur / 2, p.t + p.dur / 2),
        v: viewOf(p),
        easing: p.easing,
      });
    }
    const last = group[group.length - 1];
    const holdEnd = Math.max(keys[keys.length - 1].t, last.t + last.hold);
    if (holdEnd > keys[keys.length - 1].t + 0.01)
      keys.push({ t: holdEnd, v: keys[keys.length - 1].v, easing: "linear" });
    keys.push({ t: holdEnd + last.dur, v: FULL, easing: last.easing });
    sessions.push({
      start: startIn,
      end: holdEnd + last.dur,
      ids: group.map((p) => p.id),
    });
  }
  return { keys, sessions };
}

/** The camera at time t. Zoom is interpolated in log space so zooming in and out feel equally fast. */
export function cameraAt(keys, t) {
  if (keys.length < 2 || t <= keys[1].t) return FULL;
  let i = 1;
  while (i < keys.length - 1 && keys[i + 1].t <= t) i++;
  const a = keys[i],
    b = keys[i + 1];
  if (!b) return a.v;
  const u = ease(b.easing, (t - a.t) / Math.max(1e-6, b.t - a.t));
  const z = Math.exp(Math.log(a.v.z) + (Math.log(b.v.z) - Math.log(a.v.z)) * u);
  return clampView({
    cx: a.v.cx + (b.v.cx - a.v.cx) * u,
    cy: a.v.cy + (b.v.cy - a.v.cy) * u,
    z,
  });
}

/** Source rectangle (in source pixels) shown by a camera. */
export function viewRect(v, w, h) {
  const sw = w / v.z,
    sh = h / v.z;
  return { sx: v.cx * w - sw / 2, sy: v.cy * h - sh / 2, sw, sh };
}

/**
 * Draw `src` ({ el, width, height }) through camera `cam` into `c` (bw × bh), with optional motion blur
 * (cameras re-sampled across a short shutter from `keys`) and click rings for `points` near t.
 * Sizes are authored for a 1080px output and scaled by k.
 *   opts = { motionBlur, mbStrength, ring, ringColor, ringSize, ringTime = 0.7,
 *            crop }   // crop = { x, y, w, h } in source pixels: the camera moves inside that rectangle (default: all of src)
 */
export function drawZoomed(c, src, keys, points, cam, t, bw, bh, k, opts = {}) {
  const { motionBlur = false, mbStrength = 0.5, ring = false, ringColor = "#ff3d71", ringSize = 64, ringTime = 0.7 } = opts;
  const crop = opts.crop || { x: 0, y: 0, w: src.width, h: src.height };
  const draw = (v, alpha) => {
    const r = viewRect(v, crop.w, crop.h);
    c.globalAlpha = alpha;
    c.drawImage(src.el, crop.x + r.sx, crop.y + r.sy, r.sw, r.sh, 0, 0, bw, bh);
  };
  c.clearRect(0, 0, bw, bh);
  c.imageSmoothingQuality = "high";
  const prev = cameraAt(keys, t - 1 / 30);
  const motion =
    (Math.abs(cam.cx - prev.cx) + Math.abs(cam.cy - prev.cy)) * bw * cam.z +
    Math.abs(Math.log(cam.z / prev.z)) * bw;
  if (motionBlur && motion * mbStrength > 1.5) {
    // Average cameras across a shutter of up to 1/30 s (the frame stays the same; only the view moves).
    // Enough samples that neighbours are ≤ ~2 px apart, so the blur is smooth rather than ghosted copies.
    // Capped at ~3.5% of the width so even fast moves stay subtle.
    const smear = Math.min(motion * mbStrength, bw * 0.035);
    const shutter = smear / motion / 30;
    const N = Math.min(24, Math.max(3, Math.ceil(smear / 2)));
    for (let j = 0; j < N; j++)
      draw(cameraAt(keys, t - (shutter * j) / (N - 1)), 1 / (j + 1));
    c.globalAlpha = 1;
  } else draw(cam, 1);

  if (ring) {
    for (const p of points) {
      const q = (t - p.t) / ringTime;
      if (q < 0 || q > 1) continue;
      const x = (p.x - (cam.cx - 0.5 / cam.z)) * cam.z * bw;
      const y = (p.y - (cam.cy - 0.5 / cam.z)) * cam.z * bh;
      const r = ringSize * k * (0.35 + 0.65 * easings.easeOut(q));
      c.save();
      c.globalAlpha = (1 - q) * 0.9;
      c.strokeStyle = ringColor;
      c.lineWidth = Math.max(2, 5 * k);
      c.shadowColor = "rgba(0,0,0,.35)";
      c.shadowBlur = 8 * k;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = (1 - q) * 0.35;
      c.fillStyle = ringColor;
      c.beginPath();
      c.arc(x, y, r * 0.45, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }
}
