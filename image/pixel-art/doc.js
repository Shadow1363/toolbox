/*
 * Pixel Art Editor document: layers × frames of RGBA pixels, compositing, and exports
 * (scaled PNG, sprite sheet, animated GIF, project JSON).

 *
 * doc = { w, h, palette: ['#rrggbb'], layers: [{ id, name, visible, opacity }],
 *         frames: [{ id, duration (ms), cells: { [layerId]: Uint8ClampedArray(w·h·4) } }] }
 * Layer order: layers[0] is the bottom.
 */
import { loadGifenc } from "/assets/js/lib/gif.js";

let uid = 0;
export const newId = (p) =>
  `${p}${Date.now().toString(36)}${(uid++).toString(36)}`;
export const blank = (w, h) => new Uint8ClampedArray(w * h * 4);

export function newDoc(w = 32, h = 32, palette = []) {
  const layer = { id: newId("l"), name: "Layer 1", visible: true, opacity: 1 };
  return {
    w,
    h,
    palette,
    layers: [layer],
    frames: [
      { id: newId("f"), duration: 120, cells: { [layer.id]: blank(w, h) } },
    ],
  };
}
export const cell = (doc, frame, layerId) =>
  (frame.cells[layerId] ||= blank(doc.w, doc.h));

/* ---------- Compositing ---------- */
const scratch = new Map();
function canvasFor(name, w, h) {
  let c = scratch.get(name);
  if (!c) {
    c = document.createElement("canvas");
    c.getContext("2d", { willReadFrequently: true });
    scratch.set(name, c);
  }
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  return c;
}

/**
 * Composite a frame into a w×h canvas (returned; reused between calls with the same `key`).
 * `extra` = { layerId, data, x, y, w, h } draws a floating selection on top of that layer.
 */
export function composite(
  doc,
  frame,
  { key = "comp", extra = null, preview = null } = {},
) {
  const out = canvasFor(key, doc.w, doc.h);
  const ctx = out.getContext("2d");
  ctx.clearRect(0, 0, doc.w, doc.h);
  const tmp = canvasFor(`${key}-layer`, doc.w, doc.h);
  const tctx = tmp.getContext("2d");
  for (const L of doc.layers) {
    if (!L.visible) continue;
    const data = preview?.layerId === L.id ? preview.data : frame.cells[L.id];
    if (!data && !(extra?.layerId === L.id)) continue;
    tctx.clearRect(0, 0, doc.w, doc.h);
    if (data) tctx.putImageData(new ImageData(data, doc.w, doc.h), 0, 0);
    if (extra?.layerId === L.id) {
      const f = canvasFor(`${key}-float`, extra.w, extra.h);
      f.getContext("2d").putImageData(
        new ImageData(extra.data, extra.w, extra.h),
        0,
        0,
      );
      tctx.drawImage(f, extra.x, extra.y);
    }
    ctx.globalAlpha = L.opacity;
    ctx.drawImage(tmp, 0, 0);
    ctx.globalAlpha = 1;
  }
  return out;
}

/** The composited frame scaled up by an integer factor, with no smoothing. */
export function scaledFrame(doc, frame, scale) {
  const src = composite(doc, frame, { key: "export" });
  const c = document.createElement("canvas");
  c.width = doc.w * scale;
  c.height = doc.h * scale;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  x.drawImage(src, 0, 0, c.width, c.height);
  return c;
}

/** All frames on one sheet: `cols` per row (0 = one row). Returns { canvas, meta }. */
export function spriteSheet(doc, scale, cols = 0, gap = 0) {
  const n = doc.frames.length;
  const c0 = cols > 0 ? Math.min(cols, n) : n;
  const rows = Math.ceil(n / c0);
  const fw = doc.w * scale,
    fh = doc.h * scale;
  const c = document.createElement("canvas");
  c.width = c0 * fw + (c0 - 1) * gap;
  c.height = rows * fh + (rows - 1) * gap;
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = false;
  const frames = doc.frames.map((f, i) => {
    const fx = (i % c0) * (fw + gap),
      fy = Math.floor(i / c0) * (fh + gap);
    x.drawImage(composite(doc, f, { key: "sheet" }), fx, fy, fw, fh);
    return { frame: i, x: fx, y: fy, w: fw, h: fh, duration: f.duration };
  });
  return {
    canvas: c,
    meta: {
      image: "",
      size: { w: c.width, h: c.height },
      frameSize: { w: fw, h: fh },
      frames,
    },
  };
}

/**
 * Animated GIF at an integer scale. Uses the exact colours when the art has ≤ 255 of them (always
 * true for palette-based pixel art), so nothing is dithered; otherwise gifenc quantizes per frame.
 * Pixels under 50% alpha become transparent (GIF has 1-bit alpha).
 */
export async function encodeGif(doc, scale, { loop = true } = {}) {
  const lib = await loadGifenc();
  const { w, h } = doc;
  const datas = doc.frames.map((f) =>
    composite(doc, f, { key: "gif" })
      .getContext("2d")
      .getImageData(0, 0, w, h)
      .data.slice(),
  );
  const colors = new Map();
  let transparent = false;
  for (const d of datas)
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) {
        transparent = true;
        continue;
      }
      const k = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (!colors.has(k) && colors.size < 300) colors.set(k, colors.size);
    }
  const exact = colors.size <= (transparent ? 255 : 256);
  let palette = null,
    lookup = null;
  if (exact) {
    palette = transparent ? [[0, 0, 0]] : [];
    lookup = new Map();
    for (const k of colors.keys()) {
      lookup.set(k, palette.length);
      palette.push([(k >> 16) & 255, (k >> 8) & 255, k & 255]);
    }
    while (palette.length < 2) palette.push([0, 0, 0]);
  }
  const W = w * scale,
    H = h * scale;
  const gif = lib.GIFEncoder();
  datas.forEach((d, fi) => {
    let index,
      pal = palette,
      tIndex = transparent ? 0 : -1;
    if (exact) {
      index = new Uint8Array(w * h);
      for (let p = 0, i = 0; p < w * h; p++, i += 4)
        index[p] =
          d[i + 3] < 128
            ? 0
            : lookup.get((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
    } else {
      const rgba = new Uint8ClampedArray(d);
      for (let i = 0; i < rgba.length; i += 4) {
        if (rgba[i + 3] < 128)
          rgba[i] = rgba[i + 1] = rgba[i + 2] = rgba[i + 3] = 0;
        else rgba[i + 3] = 255;
      }
      pal = lib.quantize(
        rgba,
        256,
        transparent ? { format: "rgba4444", oneBitAlpha: true } : undefined,
      );
      index = lib.applyPalette(rgba, pal, transparent ? "rgba4444" : undefined);
      tIndex = transparent ? pal.findIndex((c) => c[3] === 0) : -1;
    }
    // Nearest-neighbour upscale of the index bitmap.
    let big = index;
    if (scale > 1) {
      big = new Uint8Array(W * H);
      for (let y = 0; y < H; y++) {
        const sy = Math.floor(y / scale) * w;
        const row = y * W;
        for (let x = 0; x < W; x++)
          big[row + x] = index[sy + Math.floor(x / scale)];
      }
    }
    const opts = {
      palette: pal,
      delay: Math.max(20, Math.round(doc.frames[fi].duration / 10) * 10),
    };
    if (fi === 0) opts.repeat = loop ? 0 : -1;
    if (tIndex >= 0)
      Object.assign(opts, {
        transparent: true,
        transparentIndex: tIndex,
        dispose: 2,
      });
    gif.writeFrame(big, W, H, opts);
  });
  gif.finish();
  return new Blob([gif.bytes()], { type: "image/gif" });
}

/* ---------- Project JSON ---------- */
const toB64 = (u8) => {
  let s = "";
  for (let i = 0; i < u8.length; i += 0x8000)
    s += String.fromCharCode(...u8.subarray(i, i + 0x8000));
  return btoa(s);
};
const fromB64 = (s) => Uint8ClampedArray.from(atob(s), (c) => c.charCodeAt(0));
export const FILE_TYPE = "toolbox-pixel-art";

export function serialize(doc) {
  return JSON.stringify({
    type: FILE_TYPE,
    version: 1,
    w: doc.w,
    h: doc.h,
    palette: doc.palette,
    layers: doc.layers,
    frames: doc.frames.map((f) => ({
      id: f.id,
      duration: f.duration,
      cells: Object.fromEntries(
        Object.entries(f.cells).map(([k, v]) => [
          k,
          toB64(new Uint8Array(v.buffer)),
        ]),
      ),
    })),
  });
}
export function deserialize(text) {
  const d = JSON.parse(text);
  if (
    d.type !== FILE_TYPE ||
    !d.w ||
    !d.h ||
    !Array.isArray(d.frames) ||
    !Array.isArray(d.layers)
  )
    throw new Error("Not a Pixel Art Editor project.");
  if (d.w > 512 || d.h > 512)
    throw new Error("Canvas is too large (max 512×512).");
  const n = d.w * d.h * 4;
  return {
    w: d.w,
    h: d.h,
    palette: d.palette || [],
    layers: d.layers.map((l) => ({
      id: l.id,
      name: l.name || "Layer",
      visible: l.visible !== false,
      opacity: l.opacity ?? 1,
    })),
    frames: d.frames.map((f) => ({
      id: f.id || newId("f"),
      duration: f.duration || 120,
      cells: Object.fromEntries(
        Object.entries(f.cells || {}).map(([k, v]) => {
          const a = fromB64(v);
          return [k, a.length === n ? a : blank(d.w, d.h)];
        }),
      ),
    })),
  };
}

/** Deep copy (structured clone keeps the typed arrays). */
export const cloneDoc = (doc) => structuredClone(doc);

/** Resize the canvas keeping pixels, anchored at `anchor` ('tl' | 'c'). */
export function resizeDoc(doc, W, H, anchor = "c") {
  const ox = anchor === "c" ? Math.floor((W - doc.w) / 2) : 0,
    oy = anchor === "c" ? Math.floor((H - doc.h) / 2) : 0;
  for (const f of doc.frames) {
    for (const [id, src] of Object.entries(f.cells)) {
      const dst = blank(W, H);
      for (let y = 0; y < doc.h; y++) {
        const ty = y + oy;
        if (ty < 0 || ty >= H) continue;
        for (let x = 0; x < doc.w; x++) {
          const tx = x + ox;
          if (tx < 0 || tx >= W) continue;
          const s = (y * doc.w + x) * 4,
            t = (ty * W + tx) * 4;
          dst[t] = src[s];
          dst[t + 1] = src[s + 1];
          dst[t + 2] = src[s + 2];
          dst[t + 3] = src[s + 3];
        }
      }
      f.cells[id] = dst;
    }
  }
  doc.w = W;
  doc.h = H;
}
