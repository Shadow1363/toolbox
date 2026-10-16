/*
 * Zoom on Click: auto suggestions and click-log parsing. The camera itself (keyframes, sampling,
 * drawZoomed) lives in /assets/js/lib/zoom-camera.js and is re-exported here.
 */
export { FULL, clampView, buildKeyframes, cameraAt, viewRect, drawZoomed } from "/assets/js/lib/zoom-camera.js";

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
