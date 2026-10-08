/*
 * Pixel Art Editor: pencil, eraser, fill, line, rectangle, ellipse, eyedropper and select/move,
 * mirror drawing, palettes (presets, custom, from an image), layers, animation frames with onion
 * skinning, and exports (scaled PNG, sprite sheet, animated GIF, project JSON).

 *
 * Edits go to the current frame × layer cell (doc.js). A stroke records the cell before and after for
 * undo; structural changes (frames, layers, resize) record whole-document snapshots. The view draws the
 * composite scaled with smoothing off, plus onion skins, grid, mirror axes and the selection.
 */
import { h, icon, toast, downloadBlob, store } from "/assets/js/lib/dom.js";
import {
  createImageExport,
  pickFile,
  loadImage,
  imagesFromClipboard,
} from "/assets/js/lib/image-io.js";
import { kvGet, autosaver } from "/assets/js/lib/kv.js";
import {
  samplePixels,
  kmeans,
  hex as toHex,
  parseHex,
} from "/assets/js/lib/palette.js";
import {
  newDoc,
  newId,
  blank,
  cell,
  composite,
  scaledFrame,
  spriteSheet,
  encodeGif,
  serialize,
  deserialize,
  cloneDoc,
  resizeDoc,
} from "./doc.js";
import { PRESETS } from "./palettes.js";

const $ = (id) => document.getElementById(id);
const view = $("view"),
  viewport = $("viewport");
const vctx = view.getContext("2d");

/* ---------- State ---------- */
let doc = newDoc(32, 32, [...PRESETS.fantasy16.colors]);
let fi = 0,
  li = 0; // current frame / layer index
let tool = "pencil";
let primary = "#29adff",
  secondary = "#00000000";
let brush = 1;
let mirrorX = false,
  mirrorY = false;
let onion = store.get("pixel-art:onion", true),
  onionAlpha = 0.3;
let grid = true;
let zoom = 12,
  panX = 0,
  panY = 0; // screen px per art px, and offset of the art's top-left (css px)
let fitted = false;
let sel = null; // { x, y, w, h } selection rectangle
let float = null; // { data, x, y, w, h } lifted pixels
let preview = null; // { layerId, data } shape preview
let playing = false;
let paletteName = store.get("pixel-art:palette", "fantasy16");

const frame = () => doc.frames[fi];
const layer = () => doc.layers[li];
const cur = () => cell(doc, frame(), layer().id);

/* ---------- History ---------- */
const undoStack = [],
  redoStack = [];
const save = autosaver("pixel-art:project", () => ({ doc, fi, li }), 900);
function pushHistory(entry) {
  undoStack.push(entry);
  if (undoStack.length > 120) undoStack.shift();
  redoStack.length = 0;
  save();
  syncButtons();
}
/** Record a whole-document change: call before mutating. */
function snapshot() {
  pushHistory({ kind: "doc", before: cloneDoc(doc), fi, li });
}
function applyEntry(e, dir) {
  if (e.kind === "cell") {
    const f = doc.frames.find((x) => x.id === e.frameId);
    if (f) f.cells[e.layerId] = (dir === "undo" ? e.before : e.after).slice();
  } else {
    const now = cloneDoc(doc);
    doc = dir === "undo" ? e.before : e.after;
    if (dir === "undo") e.after = now;
    else e.before = now;
    fi = Math.min(e.fi, doc.frames.length - 1);
    li = Math.min(e.li, doc.layers.length - 1);
  }
}
function undo() {
  dropFloat();
  const e = undoStack.pop();
  if (!e) return;
  applyEntry(e, "undo");
  redoStack.push(e);
  refreshAll();
  save();
}
function redo() {
  const e = redoStack.pop();
  if (!e) return;
  applyEntry(e, "redo");
  undoStack.push(e);
  refreshAll();
  save();
}

/* ---------- Colors ---------- */
const rgbaOf = (c) => {
  if (c.length === 9) {
    const p = parseHex(c.slice(0, 7));
    return [...p, parseInt(c.slice(7), 16)];
  }
  return [...(parseHex(c) || [0, 0, 0]), 255];
};

/* ---------- Pixel ops ---------- */
function setPx(buf, x, y, [r, g, b, a]) {
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
  if (
    sel &&
    !float &&
    (x < sel.x || y < sel.y || x >= sel.x + sel.w || y >= sel.y + sel.h)
  )
    return; // paint inside the selection only
  const i = (y * doc.w + x) * 4;
  buf[i] = r;
  buf[i + 1] = g;
  buf[i + 2] = b;
  buf[i + 3] = a;
}
/** Plot with the brush size and the mirror axes. */
function plot(buf, x, y, rgba) {
  const pts = [[x, y]];
  if (mirrorX) pts.push([doc.w - 1 - x, y]);
  if (mirrorY) pts.push([x, doc.h - 1 - y]);
  if (mirrorX && mirrorY) pts.push([doc.w - 1 - x, doc.h - 1 - y]);
  const o = Math.floor((brush - 1) / 2);
  for (const [px, py] of pts)
    for (let dy = 0; dy < brush; dy++)
      for (let dx = 0; dx < brush; dx++)
        setPx(buf, px - o + dx, py - o + dy, rgba);
}
function line(buf, x0, y0, x1, y1, rgba) {
  const dx = Math.abs(x1 - x0),
    dy = -Math.abs(y1 - y0),
    sx = x0 < x1 ? 1 : -1,
    sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    plot(buf, x0, y0, rgba);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}
function rect(buf, x0, y0, x1, y1, rgba, filled) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)],
    [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++)
      if (filled || y === ay || y === by || x === ax || x === bx)
        plot(buf, x, y, rgba);
}
/** Ellipse inscribed in the box (inclusive), drawn by testing each pixel's distance to the outline. */
function ellipse(buf, x0, y0, x1, y1, rgba, filled) {
  const [ax, bx] = [Math.min(x0, x1), Math.max(x0, x1)],
    [ay, by] = [Math.min(y0, y1), Math.max(y0, y1)];
  const cx = (ax + bx) / 2,
    cy = (ay + by) / 2,
    rx = (bx - ax) / 2 + 0.5,
    ry = (by - ay) / 2 + 0.5;
  const inside = (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  for (let y = ay; y <= by; y++)
    for (let x = ax; x <= bx; x++) {
      if (!inside(x, y)) continue;
      if (
        filled ||
        !inside(x - 1, y) ||
        !inside(x + 1, y) ||
        !inside(x, y - 1) ||
        !inside(x, y + 1)
      )
        plot(buf, x, y, rgba);
    }
}
function fill(buf, x, y, rgba, global) {
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
  const W = doc.w,
    i0 = (y * W + x) * 4;
  const target = [buf[i0], buf[i0 + 1], buf[i0 + 2], buf[i0 + 3]];
  const same = (i) =>
    target[3] === 0
      ? buf[i + 3] === 0
      : buf[i] === target[0] &&
        buf[i + 1] === target[1] &&
        buf[i + 2] === target[2] &&
        buf[i + 3] === target[3];
  if (rgba.every((v, k) => v === target[k])) return;
  if (global) {
    for (let p = 0; p < W * doc.h; p++)
      if (same(p * 4)) setPx(buf, p % W, Math.floor(p / W), rgba);
    return;
  }
  const seen = new Uint8Array(W * doc.h);
  const stack = [x, y];
  while (stack.length) {
    const py = stack.pop(),
      px = stack.pop();
    if (px < 0 || py < 0 || px >= W || py >= doc.h) continue;
    const p = py * W + px;
    if (seen[p] || !same(p * 4)) continue;
    if (
      sel &&
      (px < sel.x || py < sel.y || px >= sel.x + sel.w || py >= sel.y + sel.h)
    )
      continue;
    seen[p] = 1;
    setPx(buf, px, py, rgba);
    stack.push(px + 1, py, px - 1, py, px, py + 1, px, py - 1);
  }
}

/* ---------- Selection ---------- */
function liftFloat() {
  if (float || !sel) return;
  const before = cur().slice();
  const buf = cur();
  const data = new Uint8ClampedArray(sel.w * sel.h * 4);
  for (let y = 0; y < sel.h; y++)
    for (let x = 0; x < sel.w; x++) {
      const s = ((sel.y + y) * doc.w + sel.x + x) * 4,
        d = (y * sel.w + x) * 4;
      for (let k = 0; k < 4; k++) {
        data[d + k] = buf[s + k];
        buf[s + k] = 0;
      }
    }
  float = {
    data,
    x: sel.x,
    y: sel.y,
    w: sel.w,
    h: sel.h,
    before,
    frameId: frame().id,
    layerId: layer().id,
  };
}
/** Stamp the floating pixels back into their cell. */
function dropFloat() {
  if (!float) return;
  const f = doc.frames.find((x) => x.id === float.frameId) || frame();
  const buf = cell(doc, f, float.layerId);
  for (let y = 0; y < float.h; y++)
    for (let x = 0; x < float.w; x++) {
      const tx = float.x + x,
        ty = float.y + y;
      if (tx < 0 || ty < 0 || tx >= doc.w || ty >= doc.h) continue;
      const s = (y * float.w + x) * 4;
      if (float.data[s + 3] === 0) continue;
      const d = (ty * doc.w + tx) * 4;
      for (let k = 0; k < 4; k++) buf[d + k] = float.data[s + k];
    }
  if (float.before)
    pushHistory({
      kind: "cell",
      frameId: f.id,
      layerId: float.layerId,
      before: float.before,
      after: buf.slice(),
    });
  sel = {
    x: Math.max(0, float.x),
    y: Math.max(0, float.y),
    w: float.w,
    h: float.h,
  };
  float = null;
  render();
  renderFrames();
}
function deselect() {
  dropFloat();
  sel = null;
  render();
}
let clip = null;
function copySel(cut) {
  if (!sel) return;
  const src = float ? float.data : null;
  const data = new Uint8ClampedArray(sel.w * sel.h * 4);
  const buf = cur();
  for (let y = 0; y < sel.h; y++)
    for (let x = 0; x < sel.w; x++) {
      const d = (y * sel.w + x) * 4;
      const s = src ? d : ((sel.y + y) * doc.w + sel.x + x) * 4;
      for (let k = 0; k < 4; k++) data[d + k] = (src || buf)[s + k];
    }
  clip = { data, w: sel.w, h: sel.h };
  if (cut) clearSel();
}
function clearSel() {
  if (!sel) return;
  if (float) {
    float.data.fill(0);
    dropFloat();
    return;
  }
  const before = cur().slice();
  for (let y = sel.y; y < sel.y + sel.h; y++)
    for (let x = sel.x; x < sel.x + sel.w; x++)
      cur().fill(0, (y * doc.w + x) * 4, (y * doc.w + x) * 4 + 4);
  pushHistory({
    kind: "cell",
    frameId: frame().id,
    layerId: layer().id,
    before,
    after: cur().slice(),
  });
  render();
  renderFrames();
}
function pasteFloat(data, w, hh) {
  dropFloat();
  setTool("select");
  const x = Math.max(0, Math.floor((doc.w - w) / 2)),
    y = Math.max(0, Math.floor((doc.h - hh) / 2));
  float = {
    data,
    x,
    y,
    w,
    h: hh,
    before: cur().slice(),
    frameId: frame().id,
    layerId: layer().id,
  };
  sel = { x, y, w, h: hh };
  render();
}
/** A pasted/dropped image becomes a floating selection, scaled to fit the canvas (no smoothing). */
async function pasteImage(file) {
  try {
    const m = await loadImage(file);
    const k = Math.min(1, doc.w / m.width, doc.h / m.height);
    const w = Math.max(1, Math.round(m.width * k)),
      hh = Math.max(1, Math.round(m.height * k));
    const c = document.createElement("canvas");
    c.width = w;
    c.height = hh;
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = k < 1;
    x.imageSmoothingQuality = "high";
    x.drawImage(m.el, 0, 0, w, hh);
    m.dispose();
    pasteFloat(x.getImageData(0, 0, w, hh).data, w, hh);
    if (k < 1) toast(`Scaled to ${w}×${hh} to fit. Move it, then press Enter.`);
  } catch (err) {
    toast(err.message || "Couldn’t paste that image.", "error");
  }
}

/* ---------- View ---------- */
let dpr = 1;
function resizeView() {
  dpr = window.devicePixelRatio || 1;
  view.width = Math.round(viewport.clientWidth * dpr);
  view.height = Math.round(viewport.clientHeight * dpr);
  if (!fitted) fit();
  render();
}
new ResizeObserver(resizeView).observe(viewport);
function fit() {
  const W = viewport.clientWidth,
    H = viewport.clientHeight;
  if (!W) return;
  zoom = Math.max(1, Math.floor(Math.min((W - 40) / doc.w, (H - 40) / doc.h)));
  panX = Math.round((W - doc.w * zoom) / 2);
  panY = Math.round((H - doc.h * zoom) / 2);
  fitted = true;
}
function zoomAt(sx, sy, z) {
  z = Math.max(1, Math.min(80, Math.round(z)));
  const ax = (sx - panX) / zoom,
    ay = (sy - panY) / zoom;
  zoom = z;
  panX = Math.round(sx - ax * z);
  panY = Math.round(sy - ay * z);
  render();
}
let checker = null;
function checkerPattern() {
  if (checker) return checker;
  const c = document.createElement("canvas");
  c.width = c.height = 16;
  const x = c.getContext("2d");
  x.fillStyle = "#e8e8ed";
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = "#ffffff";
  x.fillRect(0, 0, 8, 8);
  x.fillRect(8, 8, 8, 8);
  return (checker = vctx.createPattern(c, "repeat"));
}

let raf = 0;
function render() {
  if (!raf) raf = requestAnimationFrame(draw);
}
function draw() {
  raf = 0;
  const W = view.width / dpr,
    H = view.height / dpr;
  vctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  vctx.clearRect(0, 0, W, H);
  const aw = doc.w * zoom,
    ah = doc.h * zoom;
  vctx.fillStyle = checkerPattern();
  vctx.fillRect(panX, panY, aw, ah);
  vctx.imageSmoothingEnabled = false;
  if (onion && !playing && doc.frames.length > 1) {
    for (const [off, tint] of [
      [-1, "rgba(255,60,90,1)"],
      [1, "rgba(40,140,255,1)"],
    ]) {
      const j = fi + off;
      if (j < 0 || j >= doc.frames.length) continue;
      const c = composite(doc, doc.frames[j], { key: `onion${off}` });
      // Tint the ghost so it can't be mistaken for real pixels.
      const t = c.getContext("2d");
      t.globalCompositeOperation = "source-atop";
      t.globalAlpha = 0.45;
      t.fillStyle = tint;
      t.fillRect(0, 0, doc.w, doc.h);
      t.globalCompositeOperation = "source-over";
      t.globalAlpha = 1;
      vctx.globalAlpha = onionAlpha;
      vctx.drawImage(c, panX, panY, aw, ah);
      vctx.globalAlpha = 1;
    }
  }
  const extra =
    float && float.frameId === frame().id
      ? {
          layerId: float.layerId,
          data: float.data,
          x: float.x,
          y: float.y,
          w: float.w,
          h: float.h,
        }
      : null;
  vctx.drawImage(
    composite(doc, frame(), { key: "view", extra, preview }),
    panX,
    panY,
    aw,
    ah,
  );

  if (grid && zoom >= 6) {
    vctx.strokeStyle = "rgba(128,128,128,0.22)";
    vctx.lineWidth = 1;
    vctx.beginPath();
    for (let x = 1; x < doc.w; x++) {
      const X = panX + x * zoom + 0.5;
      vctx.moveTo(X, panY);
      vctx.lineTo(X, panY + ah);
    }
    for (let y = 1; y < doc.h; y++) {
      const Y = panY + y * zoom + 0.5;
      vctx.moveTo(panX, Y);
      vctx.lineTo(panX + aw, Y);
    }
    vctx.stroke();
  }
  vctx.strokeStyle = "rgba(128,128,128,0.6)";
  vctx.strokeRect(panX - 0.5, panY - 0.5, aw + 1, ah + 1);
  if (mirrorX || mirrorY) {
    vctx.strokeStyle = "rgba(255,45,149,0.8)";
    vctx.setLineDash([6, 4]);
    vctx.beginPath();
    if (mirrorX) {
      vctx.moveTo(panX + aw / 2, panY - 8);
      vctx.lineTo(panX + aw / 2, panY + ah + 8);
    }
    if (mirrorY) {
      vctx.moveTo(panX - 8, panY + ah / 2);
      vctx.lineTo(panX + aw + 8, panY + ah / 2);
    }
    vctx.stroke();
    vctx.setLineDash([]);
  }
  const box = float || sel;
  if (box) {
    const t = (performance.now() / 60) % 8;
    vctx.lineWidth = 1;
    vctx.strokeStyle = "#000";
    vctx.setLineDash([4, 4]);
    vctx.lineDashOffset = -t;
    vctx.strokeRect(
      panX + box.x * zoom + 0.5,
      panY + box.y * zoom + 0.5,
      box.w * zoom - 1,
      box.h * zoom - 1,
    );
    vctx.strokeStyle = "#fff";
    vctx.lineDashOffset = 4 - t;
    vctx.strokeRect(
      panX + box.x * zoom + 0.5,
      panY + box.y * zoom + 0.5,
      box.w * zoom - 1,
      box.h * zoom - 1,
    );
    vctx.setLineDash([]);
    render(); // marching ants
  }
  if (
    hoverPx &&
    !drag &&
    ["pencil", "eraser", "fill", "line", "rect", "ellipse"].includes(tool)
  ) {
    const o = Math.floor((brush - 1) / 2);
    vctx.strokeStyle = "rgba(128,128,128,0.9)";
    const n = tool === "fill" ? 1 : brush;
    vctx.strokeRect(
      panX + (hoverPx[0] - (tool === "fill" ? 0 : o)) * zoom + 0.5,
      panY + (hoverPx[1] - (tool === "fill" ? 0 : o)) * zoom + 0.5,
      n * zoom - 1,
      n * zoom - 1,
    );
  }
}

/* ---------- Toolbar ---------- */
const svgI = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const TOOLS = [
  [
    "pencil",
    "Pencil (B)",
    "B",
    '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m13 7 4 4"/>',
  ],
  [
    "eraser",
    "Eraser (E)",
    "E",
    '<path d="m7 21-4-4 11-11 7 7-8 8z"/><path d="M7 21h13"/>',
  ],
  [
    "fill",
    "Fill bucket (G, Shift: replace color everywhere)",
    "G",
    '<path d="m19 11-8-8-8 8 8 8z"/><path d="M5 11h14M20 15s2 2.5 2 4a2 2 0 0 1-4 0c0-1.5 2-4 2-4z"/>',
  ],
  ["line", "Line (L)", "L", '<path d="M5 19 19 5"/>'],
  [
    "rect",
    "Rectangle (R, Shift: filled)",
    "R",
    '<rect x="4" y="5" width="16" height="14" rx="1"/>',
  ],
  [
    "ellipse",
    "Ellipse (C, Shift: filled)",
    "C",
    '<ellipse cx="12" cy="12" rx="9" ry="7"/>',
  ],
  [
    "picker",
    "Eyedropper (I, or Alt+click)",
    "I",
    '<path d="m14 7 3 3M5 19l1-4 9-9a2.1 2.1 0 0 1 3 3l-9 9z"/>',
  ],
  [
    "select",
    "Select and move (M)",
    "M",
    '<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4" />',
  ],
  [
    "hand",
    "Pan (H, or hold Space)",
    "H",
    '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
  ],
];
const btns = {};
const tb = $("toolbar");
for (const [id, title, key, p] of TOOLS) {
  const b = h("button", {
    type: "button",
    class: "tool-btn",
    title,
    "aria-label": title,
    html: `${svgI(p)}<kbd>${key}</kbd>`,
  });
  b.addEventListener("click", () => setTool(id));
  btns[id] = b;
  tb.append(b);
}
const sizeSel = h(
  "select",
  {
    "aria-label": "Brush size",
    title: "Brush size ([ and ])",
    style: "width:auto",
  },
  [1, 2, 3, 4, 6, 8].map((n) => h("option", { value: n }, `${n}px`)),
);
sizeSel.addEventListener("change", () => {
  brush = +sizeSel.value;
});
const mx = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Mirror horizontally",
  "aria-label": "Mirror horizontally",
  html: svgI(
    '<path d="M12 3v18" stroke-dasharray="2 2"/><path d="M9 7 4 12l5 5zM15 7l5 5-5 5z"/>',
  ),
});
const my = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Mirror vertically",
  "aria-label": "Mirror vertically",
  html: svgI(
    '<path d="M3 12h18" stroke-dasharray="2 2"/><path d="M7 9l5-5 5 5zM7 15l5 5 5-5z"/>',
  ),
});
mx.addEventListener("click", () => {
  mirrorX = !mirrorX;
  syncButtons();
  render();
});
my.addEventListener("click", () => {
  mirrorY = !mirrorY;
  syncButtons();
  render();
});
const gridBtn = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Pixel grid",
  "aria-label": "Pixel grid",
  html: svgI('<path d="M3 3h18v18H3zM9 3v18M15 3v18M3 9h18M3 15h18"/>'),
});
gridBtn.addEventListener("click", () => {
  grid = !grid;
  syncButtons();
  render();
});
const undoBtn = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Undo (Ctrl/⌘+Z)",
  "aria-label": "Undo",
  html: svgI('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
});
const redoBtn = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Redo (Ctrl/⌘+Shift+Z)",
  "aria-label": "Redo",
  html: svgI('<path d="m15 14 5-5-5-5"/><path d="M20 9H9a5 5 0 0 0 0 10h3"/>'),
});
undoBtn.addEventListener("click", undo);
redoBtn.addEventListener("click", redo);
const fitBtn = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Fit to view",
  "aria-label": "Fit to view",
  html: svgI('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
});
fitBtn.addEventListener("click", () => {
  fit();
  render();
});
tb.append(
  h("span", { class: "sep" }),
  sizeSel,
  mx,
  my,
  gridBtn,
  h("span", { class: "sep" }),
  undoBtn,
  redoBtn,
  fitBtn,
);

function setTool(t) {
  if (t !== "select" && float) dropFloat();
  tool = t;
  for (const [id, b] of Object.entries(btns))
    b.setAttribute("aria-pressed", String(id === t));
  viewport.style.cursor =
    t === "hand"
      ? "grab"
      : t === "select"
        ? "crosshair"
        : t === "picker"
          ? "copy"
          : "crosshair";
  render();
}
function syncButtons() {
  mx.setAttribute("aria-pressed", String(mirrorX));
  my.setAttribute("aria-pressed", String(mirrorY));
  gridBtn.setAttribute("aria-pressed", String(grid));
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
}

/* ---------- Pointer ---------- */
let drag = null,
  hoverPx = null,
  spaceDown = false;
function artPoint(e) {
  const r = view.getBoundingClientRect();
  return [
    Math.floor((e.clientX - r.left - panX) / zoom),
    Math.floor((e.clientY - r.top - panY) / zoom),
  ];
}
view.addEventListener("contextmenu", (e) => e.preventDefault());
view.addEventListener("pointerdown", (e) => {
  viewport.focus({ preventScroll: true });
  view.setPointerCapture(e.pointerId);
  if (e.button === 1 || spaceDown || tool === "hand") {
    drag = { mode: "pan", sx: e.clientX, sy: e.clientY, px: panX, py: panY };
    return;
  }
  if (playing) togglePlay();
  const [x, y] = artPoint(e);
  const color = rgbaOf(e.button === 2 ? secondary : primary);
  if (tool === "picker" || e.altKey) {
    pick(x, y, e.button === 2);
    return;
  }
  if (!layer().visible) {
    toast("This layer is hidden. Show it to draw on it.", "warning");
    return;
  }

  if (tool === "select") {
    const inside = (b) =>
      b && x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h;
    if (inside(float) || inside(sel)) {
      liftFloat();
      drag = { mode: "movesel", start: [x, y], fx: float.x, fy: float.y };
    } else {
      dropFloat();
      sel = null;
      drag = { mode: "select", start: [x, y] };
    }
    render();
    return;
  }
  dropFloat();
  const before = cur().slice();
  drag = {
    mode: tool,
    start: [x, y],
    last: [x, y],
    color: tool === "eraser" ? [0, 0, 0, 0] : color,
    before,
    shift: e.shiftKey,
  };
  if (tool === "pencil" || tool === "eraser") {
    plot(cur(), x, y, drag.color);
  } else if (tool === "fill") {
    fill(cur(), x, y, color, e.shiftKey);
    finishStroke();
  } else updateShapePreview(x, y, e.shiftKey);
  render();
});
view.addEventListener("pointermove", (e) => {
  const [x, y] = artPoint(e);
  hoverPx = x >= 0 && y >= 0 && x < doc.w && y < doc.h ? [x, y] : null;
  $("pos").textContent = hoverPx ? `${x}, ${y}` : "";
  if (!drag) {
    render();
    return;
  }
  switch (drag.mode) {
    case "pan":
      panX = drag.px + e.clientX - drag.sx;
      panY = drag.py + e.clientY - drag.sy;
      break;
    case "pencil":
    case "eraser":
      line(cur(), drag.last[0], drag.last[1], x, y, drag.color);
      drag.last = [x, y];
      break;
    case "line":
    case "rect":
    case "ellipse":
      updateShapePreview(x, y, e.shiftKey);
      break;
    case "select": {
      const [sx, sy] = drag.start;
      if (x !== sx || y !== sy) drag.moved = true;
      const x0 = Math.max(0, Math.min(sx, x)),
        y0 = Math.max(0, Math.min(sy, y));
      const x1 = Math.min(doc.w - 1, Math.max(sx, x)),
        y1 = Math.min(doc.h - 1, Math.max(sy, y));
      sel =
        x1 >= x0 && y1 >= y0
          ? { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
          : null;
      break;
    }
    case "movesel":
      float.x = drag.fx + x - drag.start[0];
      float.y = drag.fy + y - drag.start[1];
      sel = { x: float.x, y: float.y, w: float.w, h: float.h };
      break;
  }
  render();
});
function endPointer() {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.mode === "line" || d.mode === "rect" || d.mode === "ellipse") {
    if (preview) cur().set(preview.data);
    preview = null;
    finishStroke(d);
  } else if (d.mode === "pencil" || d.mode === "eraser") finishStroke(d);
  else if (d.mode === "select" && !d.moved) sel = null; // a click outside the selection just deselects
  render();
}
view.addEventListener("pointerup", endPointer);
view.addEventListener("pointercancel", endPointer);
view.addEventListener("pointerleave", () => {
  hoverPx = null;
  $("pos").textContent = "";
  render();
});

function updateShapePreview(x, y, shift) {
  const data = drag.before.slice();
  const [sx, sy] = drag.start;
  if (drag.mode === "line") {
    let [ex, ey] = [x, y];
    if (shift) {
      const dx = x - sx,
        dy = y - sy;
      if (Math.abs(dx) > 2 * Math.abs(dy)) ey = sy;
      else if (Math.abs(dy) > 2 * Math.abs(dx)) ex = sx;
      else {
        const m = Math.max(Math.abs(dx), Math.abs(dy));
        ex = sx + Math.sign(dx) * m;
        ey = sy + Math.sign(dy) * m;
      }
    }
    line(data, sx, sy, ex, ey, drag.color);
  } else if (drag.mode === "rect") rect(data, sx, sy, x, y, drag.color, shift);
  else ellipse(data, sx, sy, x, y, drag.color, shift);
  preview = { layerId: layer().id, data };
}
function finishStroke(d = drag) {
  const after = cur().slice();
  const before = d?.before;
  if (before && before.some((v, i) => v !== after[i]))
    pushHistory({
      kind: "cell",
      frameId: frame().id,
      layerId: layer().id,
      before,
      after,
    });
  renderFrames();
}
function pick(x, y, toSecondary) {
  if (x < 0 || y < 0 || x >= doc.w || y >= doc.h) return;
  const c = composite(doc, frame(), { key: "pick" })
    .getContext("2d")
    .getImageData(x, y, 1, 1).data;
  const value = c[3] < 128 ? "#00000000" : toHex([c[0], c[1], c[2]]);
  if (toSecondary) secondary = value;
  else primary = value;
  renderColors();
}

/* ---------- Wheel / keyboard ---------- */
viewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = view.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey || !e.deltaX) {
      const step = e.deltaY < 0 ? 1 : -1;
      zoomAt(
        e.clientX - r.left,
        e.clientY - r.top,
        zoom + step * Math.max(1, Math.round(zoom * 0.15)),
      );
    } else {
      panX -= e.deltaX;
      panY -= e.deltaY;
      render();
    }
  },
  { passive: false },
);

const KEYS = {
  b: "pencil",
  p: "pencil",
  e: "eraser",
  g: "fill",
  l: "line",
  r: "rect",
  c: "ellipse",
  u: "ellipse",
  i: "picker",
  m: "select",
  h: "hand",
};
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select")) return;
  const focus = document.activeElement;
  if (focus !== document.body && !focus?.closest?.(".px-layout")) return;
  const mod = e.metaKey || e.ctrlKey,
    k = e.key.toLowerCase();
  if (k === " " && !spaceDown) {
    spaceDown = true;
    viewport.style.cursor = "grab";
    e.preventDefault();
    return;
  }
  if (mod && k === "z") {
    e.preventDefault();
    e.shiftKey ? redo() : undo();
    return;
  }
  if (mod && k === "y") {
    e.preventDefault();
    redo();
    return;
  }
  if (mod && k === "a") {
    e.preventDefault();
    dropFloat();
    setTool("select");
    sel = { x: 0, y: 0, w: doc.w, h: doc.h };
    render();
    return;
  }
  if (mod && k === "d") {
    e.preventDefault();
    deselect();
    return;
  }
  if (mod) return; // copy/cut/paste are handled by clipboard events
  if (k === "escape" || k === "enter") {
    deselect();
    return;
  }
  if ((k === "delete" || k === "backspace") && sel) {
    e.preventDefault();
    clearSel();
    return;
  }
  if (k === "x") {
    [primary, secondary] = [secondary, primary];
    renderColors();
    return;
  }
  if (k === "[" || k === "]") {
    const sizes = [1, 2, 3, 4, 6, 8];
    const i = sizes.indexOf(brush);
    brush =
      sizes[Math.max(0, Math.min(sizes.length - 1, i + (k === "]" ? 1 : -1)))];
    sizeSel.value = brush;
    render();
    return;
  }
  if (k === "," || k === "<") {
    selectFrame((fi - 1 + doc.frames.length) % doc.frames.length);
    return;
  }
  if (k === "." || k === ">") {
    selectFrame((fi + 1) % doc.frames.length);
    return;
  }
  if (sel && k.startsWith("arrow")) {
    e.preventDefault();
    liftFloat();
    float.x += k === "arrowleft" ? -1 : k === "arrowright" ? 1 : 0;
    float.y += k === "arrowup" ? -1 : k === "arrowdown" ? 1 : 0;
    sel = { x: float.x, y: float.y, w: float.w, h: float.h };
    render();
    return;
  }
  if (KEYS[k]) setTool(KEYS[k]);
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceDown = false;
    setTool(tool);
  }
});

document.addEventListener("copy", (e) => {
  if (e.target.closest?.("input, textarea") || !sel) return;
  e.preventDefault();
  copySel(false);
  toast("Copied selection", "success", 1200);
});
document.addEventListener("cut", (e) => {
  if (e.target.closest?.("input, textarea") || !sel) return;
  e.preventDefault();
  copySel(true);
});
document.addEventListener("paste", (e) => {
  if (e.target.closest?.("input, textarea")) return;
  const imgs = imagesFromClipboard(e.clipboardData);
  if (imgs.length) {
    e.preventDefault();
    pasteImage(imgs[0]);
    return;
  }
  if (clip) {
    e.preventDefault();
    pasteFloat(clip.data.slice(), clip.w, clip.h);
  }
});
viewport.addEventListener("dragover", (e) => e.preventDefault());
viewport.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  if (/\.json$/i.test(f.name)) openProject(f);
  else if (f.type.startsWith("image/")) pasteImage(f);
});

/* ---------- Colors & palette ---------- */
function renderColors() {
  const swatchInput = (value, set, label) => {
    const i = h("input", {
      type: "color",
      value: value.slice(0, 7),
      title: label,
      "aria-label": label,
    });
    if (value.length === 9) i.style.opacity = "0.35";
    i.addEventListener("input", () => {
      set(i.value);
      renderPalette();
    });
    return i;
  };
  $("colors").replaceChildren(
    h(
      "div",
      { class: "px-colors" },
      h(
        "div",
        { class: "slot" },
        swatchInput(
          primary,
          (v) => {
            primary = v;
          },
          "Primary color (left click)",
        ),
        "Left",
      ),
      h(
        "div",
        { class: "slot" },
        swatchInput(
          secondary,
          (v) => {
            secondary = v;
          },
          "Secondary color (right click)",
        ),
        secondary.length === 9 ? "Right (clear)" : "Right",
      ),
      h("button", {
        type: "button",
        class: "btn btn-sm btn-ghost",
        title: "Swap (X)",
        html: icon("swap"),
        onclick: () => {
          [primary, secondary] = [secondary, primary];
          renderColors();
        },
      }),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm btn-ghost",
          title: "Make the right button erase",
          onclick: () => {
            secondary = "#00000000";
            renderColors();
          },
        },
        "Clear",
      ),
    ),
  );
  renderPalette();
}
function renderPalette() {
  const opts = [
    ...Object.entries(PRESETS).map(([k, p]) => [
      k,
      `${p.name} (${p.colors.length})`,
    ]),
    ["custom", "Custom"],
  ];
  const select = h(
    "select",
    { "aria-label": "Palette" },
    opts.map(([v, l]) => h("option", { value: v }, l)),
  );
  select.value = paletteName;
  select.addEventListener("change", () => {
    paletteName = select.value;
    store.set("pixel-art:palette", paletteName);
    doc.palette =
      paletteName === "custom"
        ? [...store.get("pixel-art:custom", doc.palette)]
        : [...PRESETS[paletteName].colors];
    save();
    renderPalette();
  });
  const grid = h(
    "div",
    { class: "px-pal" },
    doc.palette.map((c) => {
      const b = h("button", {
        type: "button",
        title: `${c} · click: left color, right-click: right color${paletteName === "custom" ? ", Shift+click: remove" : ""}`,
        style: `background:${c}`,
        "aria-pressed": String(primary === c),
        "aria-label": c,
      });
      b.addEventListener("click", (e) => {
        if (e.shiftKey && paletteName === "custom") {
          doc.palette = doc.palette.filter((x) => x !== c);
          saveCustom();
          return renderPalette();
        }
        primary = c;
        renderColors();
      });
      b.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        secondary = c;
        renderColors();
      });
      return b;
    }),
  );
  const countSel = h(
    "select",
    { "aria-label": "Colors to import", style: "width:auto" },
    [4, 8, 12, 16, 24, 32].map((n) => h("option", { value: n }, `${n} colors`)),
  );
  countSel.value = "16";
  $("palette").replaceChildren(
    select,
    grid,
    h(
      "div",
      { class: "btn-row" },
      h("button", {
        type: "button",
        class: "btn btn-sm",
        title: "Add the left color to a custom palette",
        html: `${icon("plus")} Add color`,
        onclick: () => {
          if (primary.length === 9) return;
          if (paletteName !== "custom") {
            paletteName = "custom";
            store.set("pixel-art:palette", "custom");
          }
          if (!doc.palette.includes(primary)) doc.palette.push(primary);
          saveCustom();
          renderPalette();
        },
      }),
      h("button", {
        type: "button",
        class: "btn btn-sm",
        html: `${icon("image")} From image`,
        title: "Extract a palette from an image",
        onclick: async () => {
          const f = await pickFile("image/*");
          if (!f) return;
          try {
            const m = await loadImage(f);
            const cols = kmeans(samplePixels(m.el, 160), +countSel.value, {
              seed: 7,
            }).map((c) => toHex(c.rgb));
            m.dispose();
            cols.sort((a, b) => lum(a) - lum(b));
            doc.palette = cols;
            paletteName = "custom";
            store.set("pixel-art:palette", "custom");
            saveCustom();
            renderPalette();
            toast(`Imported ${cols.length} colors`, "success");
          } catch (err) {
            toast(err.message || "Couldn’t read that image.", "error");
          }
        },
      }),
      countSel,
    ),
    paletteName === "custom"
      ? h(
          "p",
          { class: "ctrl-hint", style: "margin-top:6px" },
          "Shift+click a swatch to remove it.",
        )
      : "",
  );
}
const lum = (c) => {
  const [r, g, b] = parseHex(c);
  return 0.299 * r + 0.587 * g + 0.114 * b;
};
function saveCustom() {
  store.set("pixel-art:custom", doc.palette);
  save();
}

/* ---------- Layers ---------- */
function renderLayers() {
  const rows = [...doc.layers]
    .map((L, i) => ({ L, i }))
    .reverse()
    .map(({ L, i }) => {
      const name = h(
        "span",
        { class: "name", title: "Double-click to rename" },
        L.name,
      );
      name.addEventListener("dblclick", () => {
        const input = h("input", { type: "text", value: L.name });
        const done = () => {
          snapshot();
          L.name = input.value.trim() || L.name;
          renderLayers();
        };
        input.addEventListener("keydown", (e) => {
          if (e.key === "Enter") input.blur();
          if (e.key === "Escape") {
            input.value = L.name;
            input.blur();
          }
        });
        input.addEventListener("blur", done, { once: true });
        name.replaceWith(input);
        input.focus();
        input.select();
      });
      return h(
        "div",
        {
          class: `px-layer${i === li ? " is-active" : ""}`,
          onclick: () => {
            dropFloat();
            li = i;
            renderLayers();
            render();
          },
        },
        h("button", {
          type: "button",
          class: `btn btn-ghost btn-sm${L.visible ? "" : " is-off"}`,
          title: L.visible ? "Hide" : "Show",
          "aria-label": L.visible ? "Hide layer" : "Show layer",
          html: icon("eye"),
          onclick: (e) => {
            e.stopPropagation();
            snapshot();
            L.visible = !L.visible;
            renderLayers();
            render();
            renderFrames();
          },
        }),
        name,
        h("span", { class: "ctrl-hint" }, `${Math.round(L.opacity * 100)}%`),
      );
    });
  const op = h("input", {
    type: "range",
    min: 0,
    max: 1,
    step: 0.05,
    value: layer().opacity,
    style: `--pct:${layer().opacity * 100}%`,
    "aria-label": "Layer opacity",
  });
  op.addEventListener("pointerdown", () => snapshot(), { once: true });
  op.addEventListener("input", () => {
    layer().opacity = +op.value;
    op.style.setProperty("--pct", `${op.value * 100}%`);
    render();
  });
  op.addEventListener("change", () => {
    renderLayers();
    renderFrames();
    save();
  });
  const b = (label, ic, fn, title) =>
    h("button", {
      type: "button",
      class: "btn btn-sm",
      title: title || label,
      html: `${icon(ic)} ${label}`,
      onclick: fn,
    });
  $("layers").replaceChildren(
    h("div", { class: "px-list" }, rows),
    h(
      "div",
      { class: "px-row" },
      h("span", {}, "Opacity"),
      h("div", { class: "grow" }, op),
    ),
    h(
      "div",
      { class: "btn-row" },
      b("Add", "plus", () => {
        snapshot();
        const L = {
          id: newId("l"),
          name: `Layer ${doc.layers.length + 1}`,
          visible: true,
          opacity: 1,
        };
        doc.layers.splice(li + 1, 0, L);
        li += 1;
        refreshAll();
      }),
      b(
        "Copy",
        "copy",
        () => {
          snapshot();
          const src = layer();
          const L = { ...src, id: newId("l"), name: `${src.name} copy` };
          doc.frames.forEach((f) => {
            if (f.cells[src.id]) f.cells[L.id] = f.cells[src.id].slice();
          });
          doc.layers.splice(li + 1, 0, L);
          li += 1;
          refreshAll();
        },
        "Duplicate layer",
      ),
      b(
        "",
        "up",
        () => {
          if (li >= doc.layers.length - 1) return;
          snapshot();
          [doc.layers[li], doc.layers[li + 1]] = [
            doc.layers[li + 1],
            doc.layers[li],
          ];
          li += 1;
          refreshAll();
        },
        "Move layer up",
      ),
      b(
        "",
        "down",
        () => {
          if (li <= 0) return;
          snapshot();
          [doc.layers[li], doc.layers[li - 1]] = [
            doc.layers[li - 1],
            doc.layers[li],
          ];
          li -= 1;
          refreshAll();
        },
        "Move layer down",
      ),
      b("Merge", "merge", mergeDown, "Merge into the layer below"),
      b(
        "",
        "trash",
        () => {
          if (doc.layers.length === 1)
            return toast("A sprite needs at least one layer.");
          snapshot();
          const id = layer().id;
          doc.layers.splice(li, 1);
          doc.frames.forEach((f) => delete f.cells[id]);
          li = Math.max(0, li - 1);
          refreshAll();
        },
        "Delete layer",
      ),
    ),
  );
}
function mergeDown() {
  if (li === 0) return toast("Nothing below this layer.");
  snapshot();
  const top = layer(),
    below = doc.layers[li - 1];
  for (const f of doc.frames) {
    const tmp = {
      ...doc,
      layers: [
        { ...below, opacity: 1 },
        { ...top, visible: true },
      ],
    };
    // Bake the top layer (with its opacity) over the lower one.
    const c = composite(
      tmp,
      {
        cells: {
          [below.id]: cell(doc, f, below.id),
          [top.id]: cell(doc, f, top.id),
        },
      },
      { key: "merge" },
    );
    f.cells[below.id] = new Uint8ClampedArray(
      c.getContext("2d").getImageData(0, 0, doc.w, doc.h).data,
    );
    delete f.cells[top.id];
  }
  doc.layers.splice(li, 1);
  li -= 1;
  refreshAll();
}

/* ---------- Frames ---------- */
function selectFrame(i) {
  dropFloat();
  fi = i;
  renderFrames();
  renderAnim();
  render();
}
let thumbs = [];
function renderFrames() {
  thumbs = doc.frames.map((f, i) => {
    const c = h("canvas", { width: doc.w, height: doc.h });
    c.getContext("2d").drawImage(composite(doc, f, { key: "thumb" }), 0, 0);
    return h(
      "div",
      {
        class: `px-frame${i === fi ? " is-active" : ""}`,
        title: `Frame ${i + 1} · ${f.duration} ms`,
        onclick: () => selectFrame(i),
      },
      h("div", { class: "checker" }, c),
      `${i + 1} · ${f.duration}ms`,
    );
  });
  $("frames").replaceChildren(...thumbs);
  thumbs[fi]?.scrollIntoView({ block: "nearest", inline: "nearest" });
}
const fb = (label, ic, fn, title) =>
  h("button", {
    type: "button",
    class: "btn btn-sm",
    title: title || label,
    html: `${icon(ic)}${label ? ` ${label}` : ""}`,
    onclick: fn,
  });
let playBtn;
$("frame-actions").append(
  (playBtn = fb("Play", "play", togglePlay, "Play the animation")),
  fb("New frame", "plus", () => {
    snapshot();
    doc.frames.splice(fi + 1, 0, {
      id: newId("f"),
      duration: frame().duration,
      cells: {},
    });
    fi += 1;
    refreshAll();
  }),
  fb("Duplicate", "copy", () => {
    snapshot();
    const src = frame();
    doc.frames.splice(fi + 1, 0, {
      id: newId("f"),
      duration: src.duration,
      cells: Object.fromEntries(
        Object.entries(src.cells).map(([k, v]) => [k, v.slice()]),
      ),
    });
    fi += 1;
    refreshAll();
  }),
  fb(
    "",
    "up",
    () => {
      if (fi === 0) return;
      snapshot();
      [doc.frames[fi], doc.frames[fi - 1]] = [
        doc.frames[fi - 1],
        doc.frames[fi],
      ];
      fi -= 1;
      refreshAll();
    },
    "Move frame earlier",
  ),
  fb(
    "",
    "down",
    () => {
      if (fi >= doc.frames.length - 1) return;
      snapshot();
      [doc.frames[fi], doc.frames[fi + 1]] = [
        doc.frames[fi + 1],
        doc.frames[fi],
      ];
      fi += 1;
      refreshAll();
    },
    "Move frame later",
  ),
  fb(
    "",
    "trash",
    () => {
      if (doc.frames.length === 1)
        return toast("A sprite needs at least one frame.");
      snapshot();
      doc.frames.splice(fi, 1);
      fi = Math.max(0, fi - 1);
      refreshAll();
    },
    "Delete frame",
  ),
);
let playTimer = 0;
function togglePlay() {
  playing = !playing;
  playBtn.innerHTML = `${icon(playing ? "pause" : "play")} ${playing ? "Stop" : "Play"}`;
  clearTimeout(playTimer);
  if (playing) {
    dropFloat();
    step();
  } else {
    renderFrames();
    render();
  }
  function step() {
    if (!playing) return;
    render();
    playTimer = setTimeout(() => {
      fi = (fi + 1) % doc.frames.length;
      renderFrames();
      step();
    }, frame().duration);
  }
}
function renderAnim() {
  const dur = h("input", {
    type: "number",
    min: 20,
    max: 10000,
    step: 10,
    value: frame().duration,
    "aria-label": "Frame duration (ms)",
  });
  dur.addEventListener("change", () => {
    snapshot();
    frame().duration = Math.max(20, Math.min(10000, +dur.value || 100));
    renderFrames();
  });
  const all = h(
    "button",
    {
      type: "button",
      class: "btn btn-sm",
      onclick: () => {
        snapshot();
        doc.frames.forEach((f) => {
          f.duration = frame().duration;
        });
        renderFrames();
        toast("All frames updated", "success", 1200);
      },
    },
    "Apply to all",
  );
  const fps = h(
    "span",
    { class: "ctrl-hint" },
    `≈ ${(1000 / frame().duration).toFixed(1)} fps`,
  );
  const on = h("input", { type: "checkbox", role: "switch" });
  on.checked = onion;
  on.addEventListener("change", () => {
    onion = on.checked;
    store.set("pixel-art:onion", onion);
    render();
  });
  const oa = h("input", {
    type: "range",
    min: 0.1,
    max: 0.7,
    step: 0.05,
    value: onionAlpha,
    style: `--pct:${((onionAlpha - 0.1) / 0.6) * 100}%`,
    "aria-label": "Onion skin opacity",
  });
  oa.addEventListener("input", () => {
    onionAlpha = +oa.value;
    oa.style.setProperty("--pct", `${((onionAlpha - 0.1) / 0.6) * 100}%`);
    render();
  });
  $("anim").replaceChildren(
    h(
      "div",
      { class: "px-row" },
      h("span", {}, `Frame ${fi + 1} of ${doc.frames.length}:`),
      dur,
      h("span", {}, "ms"),
      fps,
    ),
    h(
      "div",
      { class: "px-row" },
      all,
      h("span", { class: "ctrl-hint" }, "Use , and . to step through frames."),
    ),
    h(
      "div",
      { class: "ctrl" },
      h(
        "label",
        { class: "toggle" },
        h("span", {}, "Onion skin (previous red, next blue)"),
        on,
      ),
    ),
    h(
      "div",
      { class: "px-row" },
      h("span", {}, "Ghost"),
      h("div", { class: "grow" }, oa),
    ),
  );
}

/* ---------- Canvas size ---------- */
function renderCanvasSize() {
  const preset = h(
    "select",
    { "aria-label": "Size preset", style: "width:auto" },
    [
      [16, "16×16"],
      [24, "24×24"],
      [32, "32×32"],
      [48, "48×48"],
      [64, "64×64"],
      [128, "128×128"],
      ["custom", "Custom"],
    ].map(([v, l]) => h("option", { value: v }, l)),
  );
  preset.value =
    doc.w === doc.h && [16, 24, 32, 48, 64, 128].includes(doc.w)
      ? String(doc.w)
      : "custom";
  const wIn = h("input", {
    type: "number",
    min: 1,
    max: 256,
    value: doc.w,
    "aria-label": "Width",
  });
  const hIn = h("input", {
    type: "number",
    min: 1,
    max: 256,
    value: doc.h,
    "aria-label": "Height",
  });
  preset.addEventListener("change", () => {
    if (preset.value !== "custom") {
      wIn.value = hIn.value = preset.value;
    }
  });
  const size = () => [
    Math.max(1, Math.min(256, Math.round(+wIn.value) || doc.w)),
    Math.max(1, Math.min(256, Math.round(+hIn.value) || doc.h)),
  ];
  $("canvas-size").replaceChildren(
    h("div", { class: "px-row" }, preset, wIn, h("span", {}, "×"), hIn),
    h(
      "div",
      { class: "btn-row" },
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm",
          title: "Change the size and keep the drawing centred",
          onclick: () => {
            const [W, H] = size();
            if (W === doc.w && H === doc.h) return;
            dropFloat();
            sel = null;
            snapshot();
            resizeDoc(doc, W, H, "c");
            fitted = false;
            fit();
            refreshAll();
          },
        },
        "Resize",
      ),
      h(
        "button",
        {
          type: "button",
          class: "btn btn-sm",
          title: "Start a new sprite at this size",
          onclick: () => {
            const [W, H] = size();
            if (!confirm(`Start a new ${W}×${H} sprite? You can undo this.`))
              return;
            dropFloat();
            sel = null;
            snapshot();
            doc = newDoc(W, H, doc.palette);
            fi = li = 0;
            fitted = false;
            fit();
            refreshAll();
          },
        },
        "New sprite",
      ),
    ),
    h("p", { class: "ctrl-hint", style: "margin-top:6px" }, "Up to 256×256."),
  );
}

/* ---------- Project ---------- */
async function openProject(f) {
  try {
    const d = deserialize(await f.text());
    dropFloat();
    sel = null;
    snapshot();
    doc = d;
    fi = 0;
    li = Math.max(0, doc.layers.length - 1);
    fitted = false;
    fit();
    refreshAll();
    toast(`Opened ${f.name}`, "success");
  } catch (err) {
    toast(
      err.message === "Not a Pixel Art Editor project." ||
        err.message.startsWith("Canvas")
        ? err.message
        : "That file isn’t a Pixel Art Editor project.",
      "error",
    );
  }
}
$("project").append(
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("upload")} Open`,
    onclick: async () => {
      const f = await pickFile(".json,application/json");
      if (f) openProject(f);
    },
  }),
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("download")} Save JSON`,
    onclick: () => {
      dropFloat();
      downloadBlob(
        new Blob([serialize(doc)], { type: "application/json" }),
        "sprite.json",
      );
    },
  }),
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("image")} Import image`,
    title: "Paste an image as a floating selection (Ctrl/⌘+V works too)",
    onclick: async () => {
      const f = await pickFile("image/*");
      if (f) pasteImage(f);
    },
  }),
);

/* ---------- Export ---------- */
let exportBar;
const scale = () => exportBar?.state.scale || 8;
exportBar = createImageExport($("export"), {
  id: "pixel-art",
  getCanvas: (s) => {
    dropFloat();
    return scaledFrame(doc, frame(), s);
  },
  formats: ["png"],
  scales: [1, 2, 4, 8, 16, 32],
  filename: () => `sprite${doc.frames.length > 1 ? `-frame${fi + 1}` : ""}`,
  actions: [
    {
      label: "Sprite sheet",
      icon: "grid",
      onClick: async () => {
        dropFloat();
        const cols =
          doc.frames.length > 8 ? Math.ceil(Math.sqrt(doc.frames.length)) : 0;
        const { canvas, meta } = spriteSheet(doc, scale(), cols);
        meta.image = `spritesheet@${scale()}x.png`;
        canvas.toBlob((b) => downloadBlob(b, meta.image), "image/png");
        downloadBlob(
          new Blob([JSON.stringify(meta, null, 2)], {
            type: "application/json",
          }),
          `spritesheet@${scale()}x.json`,
        );
      },
    },
    {
      label: "GIF",
      icon: "film",
      onClick: async (btn) => {
        dropFloat();
        btn.disabled = true;
        try {
          const b = await encodeGif(doc, scale());
          downloadBlob(b, `sprite@${scale()}x.gif`);
        } catch (err) {
          toast(err.message || "GIF export failed.", "error");
        } finally {
          btn.disabled = false;
        }
      },
    },
  ],
});
if (!store.get("img-export:pixel-art")) {
  exportBar.state.scale = 8;
  exportBar.refresh();
}

/* ---------- Start ---------- */
function refreshAll() {
  if (fi >= doc.frames.length) fi = doc.frames.length - 1;
  if (li >= doc.layers.length) li = doc.layers.length - 1;
  renderLayers();
  renderFrames();
  renderAnim();
  renderCanvasSize();
  renderPalette();
  syncButtons();
  render();
  save();
}

(async () => {
  const saved = await kvGet("pixel-art:project").catch(() => null);
  if (saved?.doc?.frames?.length) {
    doc = saved.doc;
    fi = Math.min(saved.fi || 0, doc.frames.length - 1);
    li = Math.min(saved.li || 0, doc.layers.length - 1);
  } else seedDemo();
  sizeSel.value = brush;
  setTool("pencil");
  renderColors();
  fitted = false;
  fit();
  refreshAll();
})();

/** A tiny two-frame heart so the editor doesn't start blank. */
function seedDemo() {
  doc = newDoc(16, 16, [...PRESETS.fantasy16.colors]);
  const rows = [
    "................",
    "................",
    "..XXX....XXX....",
    ".XooXX..XXXXX...",
    ".XoXXXXXXXXXXX..",
    ".XXXXXXXXXXXXX..",
    ".XXXXXXXXXXXXX..",
    "..XXXXXXXXXXX...",
    "...XXXXXXXXX....",
    "....XXXXXXX.....",
    ".....XXXXX......",
    "......XXX.......",
    ".......X........",
    "................",
    "................",
    "................",
  ];
  const red = [255, 0, 77, 255],
    hi = [255, 241, 232, 255];
  const paint = (buf, dx) =>
    rows.forEach((r, y) =>
      [...r].forEach((ch, x) => {
        if (ch !== ".") {
          const i = (y * 16 + x + dx) * 4;
          buf.set(ch === "o" ? hi : red, i);
        }
      }),
    );
  const L = doc.layers[0].id;
  paint(cell(doc, doc.frames[0], L), 1);
  doc.frames.push({
    id: newId("f"),
    duration: 120,
    cells: { [L]: blank(16, 16) },
  });
  paint(doc.frames[1].cells[L], 0);
  doc.frames.forEach((f) => {
    f.duration = 300;
  });
}
