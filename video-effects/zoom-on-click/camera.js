/*
 * Zoom on Click: the virtual camera. Turns zoom points into keyframes and samples the camera at any time.

 *
 *   point  = { id, t, x, y, zoom, dur, hold, easing, source }   // x, y in 0..1 of the source frame
 *   camera = { cx, cy, z }                                      // view centre (0..1) and zoom (1 = whole frame)
 *
 * A zoom move is centred on the click: it starts dur/2 before t and arrives dur/2 after.
 * Points whose move starts before the previous zoom would have finished zooming out (+ `follow`
 * seconds) join the same session: the camera pans from point to point instead of zooming out and in.
 */
import { ease } from "/assets/js/lib/easing.js";

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

/* ---------- Auto suggestions ---------- */

/**
 * Scan the video for moments where a small part of the frame changes (a menu opens, a button
 * reacts, text appears) and suggest a zoom there. Full-frame changes (scrolls, page loads) are skipped.
 * Seeks the video every 1/fps s at 160 px wide. Returns [{ t, x, y, score }].
 */
export async function suggestZooms(
  video,
  { fps = 4, minGap = 2, onProgress, signal, seek } = {},
) {
  const W = 160,
    H = Math.max(2, Math.round((160 * video.videoHeight) / video.videoWidth));
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const cx = c.getContext("2d", { willReadFrequently: true });
  const n = Math.max(2, Math.floor(video.duration * fps));
  let prev = null;
  const events = [];
  for (let i = 0; i < n; i++) {
    if (signal?.aborted) return null;
    const t = Math.min(video.duration - 0.05, i / fps);
    await seek(video, t);
    cx.drawImage(video, 0, 0, W, H);
    const d = cx.getImageData(0, 0, W, H).data;
    const luma = new Uint8Array(W * H);
    for (let p = 0, q = 0; p < luma.length; p++, q += 4)
      luma[p] = (d[q] * 77 + d[q + 1] * 150 + d[q + 2] * 29) >> 8;
    if (prev) {
      let changed = 0,
        sx = 0,
        sy = 0,
        minX = W,
        minY = H,
        maxX = 0,
        maxY = 0;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          const p = y * W + x;
          if (Math.abs(luma[p] - prev[p]) > 22) {
            changed++;
            sx += x;
            sy += y;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      const f = changed / (W * H);
      const spread = ((maxX - minX) * (maxY - minY)) / (W * H);
      if (f > 0.0015 && f < 0.2 && spread < 0.45) {
        events.push({
          t: Math.max(0, t - 0.5 / fps),
          x: sx / changed / W,
          y: sy / changed / H,
          score: f,
        });
      }
    }
    prev = luma;
    onProgress?.((i + 1) / n);
    if (i % 4 === 3) await new Promise((r) => setTimeout(r));
  }
  // Keep the strongest event in each window of minGap seconds.
  events.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const e of events)
    if (!picked.some((p) => Math.abs(p.t - e.t) < minGap)) picked.push(e);
  return picked.sort((a, b) => a.t - b.t);
}

/* ---------- Click logs ---------- */

/**
 * Parse a click log. Accepts { clicks: [...] } or a bare array; each click { t | time (s) | ms, x, y }.
 * x/y are pixels of the recording (scaled by the log's width/height when given) or 0..1 fractions.
 */
export function parseClickLog(json, videoW, videoH) {
  const data = typeof json === "string" ? JSON.parse(json) : json;
  const list = Array.isArray(data)
    ? data
    : data?.clicks ||
      data?.events?.filter((e) => /click|down/i.test(e.type || "click"));
  if (!Array.isArray(list))
    throw new Error('No "clicks" array found in that file.');
  const lw = data.width || videoW,
    lh = data.height || videoH;
  const normalized = list.every((c) => c.x <= 1 && c.y <= 1);
  return list
    .map((c) => {
      const t = c.t ?? c.time ?? (c.ms != null ? c.ms / 1000 : null);
      if (t == null || c.x == null || c.y == null) return null;
      return {
        t: +t,
        x: normalized ? +c.x : c.x / lw,
        y: normalized ? +c.y : c.y / lh,
      };
    })
    .filter(
      (c) => c && isFinite(c.t) && c.x >= 0 && c.x <= 1 && c.y >= 0 && c.y <= 1,
    );
}
