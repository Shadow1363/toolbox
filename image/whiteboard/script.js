/*
 * Whiteboard: an infinite canvas with shapes, connected arrows, text, sticky notes, pen and eraser,
 * in a hand-drawn (Rough.js) or clean style. Undo/redo, autosave (IndexedDB), JSON, PNG and SVG.

 *
 * World coordinates; the view is { x, y, zoom } with screen = (world − view) × zoom. render() draws the
 * board, then selection chrome in screen space (never exported). Every finished operation calls
 * commit(), which snapshots `elements` for undo and triggers the autosave. Images live in `files`
 * (fileId → data URL) so snapshots stay small.
 */
import { h, icon, toast, downloadBlob, store } from "/assets/js/lib/dom.js";
import {
  createImageExport,
  pickFile,
  loadImage,
  blobToImage,
  imagesFromClipboard,
} from "/assets/js/lib/image-io.js";
import { loadLib } from "/assets/js/lib/cdn.js";
import { kvGet, autosaver } from "/assets/js/lib/kv.js";
import { rng } from "/assets/js/lib/random.js";
import {
  FONTS,
  isLinear,
  syncBox,
  unionBounds,
  hitTest,
  updateBindings,
  bindTarget,
  measureText,
  drawElement,
  elementSvg,
  forgetRough,
  centerOf,
} from "./scene.js";

const $ = (id) => document.getElementById(id);
const canvas = $("board"),
  viewport = $("viewport"),
  editor = $("editor");
const ctx = canvas.getContext("2d");

/* ---------- State ---------- */
let elements = [];
let files = {}; // fileId → data URL
const images = new Map(); // fileId → <img>
const view = { x: -80, y: -60, zoom: 1 };
const board = { bg: "#ffffff", grid: true };
let selected = new Set();
let tool = "select";
let editingId = null;
let rough = null,
  gen = null,
  roughLib = null;
const seedRand = rng(Date.now() % 1e9);
const newSeed = () => Math.floor(seedRand() * 2 ** 31);
let uid = 0;
const newId = () => `e${Date.now().toString(36)}${(uid++).toString(36)}`;

const DEFAULT_STYLE = {
  stroke: "#1e1e1e",
  fill: "none",
  fillStyle: "hachure",
  strokeWidth: 2,
  strokeStyle: "solid",
  opacity: 100,
  sketch: true,
  font: "hand",
  fontSize: 20,
  align: "left",
  startHead: "none",
  endHead: "arrow",
};
let style = { ...DEFAULT_STYLE, ...store.get("whiteboard:style", {}) };
const saveStyle = () => store.set("whiteboard:style", style);

const byId = () => new Map(elements.map((e) => [e.id, e]));
const selectedEls = () => elements.filter((e) => selected.has(e.id));
const zoomTol = () => 6 / view.zoom;

/* ---------- History ---------- */
const undoStack = [],
  redoStack = [];
let last = "[]";
const save = autosaver(
  "whiteboard:scene",
  () => ({ elements, files: usedFiles(), view, board }),
  700,
);
function commit() {
  const now = JSON.stringify(elements);
  if (now === last) return;
  undoStack.push(last);
  if (undoStack.length > 200) undoStack.shift();
  redoStack.length = 0;
  last = now;
  save();
  syncChrome();
}
function restoreSnapshot(json) {
  elements = JSON.parse(json);
  last = json;
  selected = new Set(
    [...selected].filter((id) => elements.some((e) => e.id === id)),
  );
  save();
  renderProps();
  invalidate();
  syncChrome();
}
function undo() {
  if (editingId) finishEdit();
  if (!undoStack.length) return;
  redoStack.push(last);
  restoreSnapshot(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  undoStack.push(last);
  restoreSnapshot(redoStack.pop());
}
function usedFiles() {
  const ids = new Set(elements.map((e) => e.fileId).filter(Boolean));
  return Object.fromEntries(
    [...ids].filter((id) => files[id]).map((id) => [id, files[id]]),
  );
}

/* ---------- View ---------- */
let dpr = 1;
function resize() {
  dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(viewport.clientWidth * dpr);
  canvas.height = Math.round(viewport.clientHeight * dpr);
  invalidate();
}
new ResizeObserver(resize).observe(viewport);
const toWorld = (sx, sy) => [sx / view.zoom + view.x, sy / view.zoom + view.y];
const toScreen = (wx, wy) => [
  (wx - view.x) * view.zoom,
  (wy - view.y) * view.zoom,
];
function eventPoint(e) {
  const r = canvas.getBoundingClientRect();
  return toWorld(e.clientX - r.left, e.clientY - r.top);
}
function zoomAt(sx, sy, z) {
  z = Math.max(0.1, Math.min(8, z));
  const [wx, wy] = toWorld(sx, sy);
  view.zoom = z;
  view.x = wx - sx / z;
  view.y = wy - sy / z;
  invalidate();
  syncZoom();
  save();
}
function zoomToFit(els = elements) {
  const b = unionBounds(els);
  const W = viewport.clientWidth,
    H = viewport.clientHeight;
  if (!b) {
    view.zoom = 1;
    view.x = -W / 2;
    view.y = -H / 2;
    invalidate();
    syncZoom();
    return;
  }
  const z = Math.max(
    0.1,
    Math.min(2, Math.min((W - 80) / (b.w || 1), (H - 80) / (b.h || 1))),
  );
  view.zoom = z;
  view.x = b.x + b.w / 2 - W / 2 / z;
  view.y = b.y + b.h / 2 - H / 2 / z;
  invalidate();
  syncZoom();
  save();
}

/* ---------- Rendering ---------- */
let frame = 0;
function invalidate() {
  if (!frame) frame = requestAnimationFrame(render);
}
function render() {
  frame = 0;
  const W = canvas.width / dpr,
    H = canvas.height / dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = board.bg;
  ctx.fillRect(0, 0, W, H);
  if (board.grid && view.zoom * 20 >= 8) {
    const step = 20 * view.zoom;
    const ox = -((view.x * view.zoom) % step),
      oy = -((view.y * view.zoom) % step);
    ctx.fillStyle = isDark(board.bg)
      ? "rgba(255,255,255,0.12)"
      : "rgba(0,0,0,0.14)";
    const r = Math.max(0.6, Math.min(1.2, view.zoom));
    for (let x = ox; x < W; x += step)
      for (let y = oy; y < H; y += step)
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
  }
  ctx.setTransform(
    dpr * view.zoom,
    0,
    0,
    dpr * view.zoom,
    -view.x * dpr * view.zoom,
    -view.y * dpr * view.zoom,
  );
  const [vx0, vy0] = toWorld(0, 0),
    [vx1, vy1] = toWorld(W, H);
  const env = { rough, gen, images, editingId };
  for (const el of elements) {
    if (el.x > vx1 || el.y > vy1 || el.x + el.w < vx0 || el.y + el.h < vy0)
      continue;
    drawElement(ctx, el, env);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  drawChrome();
}
function isDark(hex) {
  const n = parseInt(hex.slice(1), 16);
  return (
    ((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114 <
    128
  );
}

const ACCENT = "#2f80ff";
const HS = 8; // handle size, screen px
function selectionHandles() {
  const els = selectedEls();
  if (!els.length) return null;
  if (els.length === 1 && (els[0].type === "line" || els[0].type === "arrow")) {
    const p = els[0].points;
    return {
      kind: "points",
      pts: [p[0], p[p.length - 1]].map((q) => toScreen(...q)),
    };
  }
  const b = unionBounds(els);
  const [x0, y0] = toScreen(b.x, b.y),
    [x1, y1] = toScreen(b.x + b.w, b.y + b.h);
  const pad = 6;
  const box = {
    x: x0 - pad,
    y: y0 - pad,
    w: x1 - x0 + 2 * pad,
    h: y1 - y0 + 2 * pad,
  };
  const handles = [];
  for (const [hx, hy] of [
    [0, 0],
    [0.5, 0],
    [1, 0],
    [1, 0.5],
    [1, 1],
    [0.5, 1],
    [0, 1],
    [0, 0.5],
  ]) {
    if ((hx === 0.5 || hy === 0.5) && (box.w < 40 || box.h < 40)) continue;
    handles.push({ hx, hy, p: [box.x + hx * box.w, box.y + hy * box.h] });
  }
  return { kind: "box", box, handles, bounds: b };
}
function drawChrome() {
  ctx.lineWidth = 1;
  // Bind highlight while dragging an arrow end over a shape.
  if (drag?.bindHover) {
    const t = drag.bindHover;
    const [x0, y0] = toScreen(t.x - 4, t.y - 4),
      [x1, y1] = toScreen(t.x + t.w + 4, t.y + t.h + 4);
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
    ctx.lineWidth = 1;
  }
  if (drag?.mode === "marquee") {
    const [x0, y0] = toScreen(...drag.start),
      [x1, y1] = toScreen(...drag.now);
    ctx.fillStyle = "rgba(47,128,255,0.08)";
    ctx.fillRect(
      Math.min(x0, x1),
      Math.min(y0, y1),
      Math.abs(x1 - x0),
      Math.abs(y1 - y0),
    );
    ctx.strokeStyle = ACCENT;
    ctx.strokeRect(
      Math.min(x0, x1) + 0.5,
      Math.min(y0, y1) + 0.5,
      Math.abs(x1 - x0),
      Math.abs(y1 - y0),
    );
  }
  if (drag?.mode === "create" || drag?.mode === "draw" || editingId) return;
  const sel = selectionHandles();
  if (!sel) return;
  ctx.strokeStyle = ACCENT;
  ctx.fillStyle = "#fff";
  if (sel.kind === "points") {
    for (const [x, y] of sel.pts) {
      ctx.beginPath();
      ctx.arc(x, y, HS / 2 + 1, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    return;
  }
  const { box } = sel;
  ctx.setLineDash(selected.size > 1 ? [4, 3] : []);
  ctx.strokeRect(box.x + 0.5, box.y + 0.5, box.w, box.h);
  ctx.setLineDash([]);
  if (selected.size > 1)
    for (const el of selectedEls()) {
      const [x0, y0] = toScreen(el.x, el.y),
        [x1, y1] = toScreen(el.x + el.w, el.y + el.h);
      ctx.strokeStyle = "rgba(47,128,255,0.5)";
      ctx.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    }
  ctx.strokeStyle = ACCENT;
  for (const { p } of sel.handles) {
    ctx.beginPath();
    ctx.rect(p[0] - HS / 2, p[1] - HS / 2, HS, HS);
    ctx.fill();
    ctx.stroke();
  }
}

/* ---------- Tools & toolbar ---------- */
const svgI = (p) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p}</svg>`;
const TOOLS = [
  [
    "hand",
    "Hand (H, or hold Space)",
    "H",
    '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11V4.5a1.5 1.5 0 0 1 3 0V11M14 10.5V6a1.5 1.5 0 0 1 3 0v8a6 6 0 0 1-6 6h-1a6 6 0 0 1-5-2.7L3 14.5a1.5 1.5 0 0 1 2.5-1.6L8 15"/>',
  ],
  ["select", "Select (V)", "V", '<path d="m5 3 14 7-6 2-2 6z"/>'],
  [
    "rect",
    "Rectangle (R)",
    "R",
    '<rect x="4" y="5" width="16" height="14" rx="2"/>',
  ],
  ["diamond", "Diamond (D)", "D", '<path d="M12 3 21 12 12 21 3 12z"/>'],
  ["ellipse", "Ellipse (O)", "O", '<ellipse cx="12" cy="12" rx="9" ry="7"/>'],
  ["arrow", "Arrow (A)", "A", '<path d="M5 19 19 5M10 5h9v9"/>'],
  ["line", "Line (L)", "L", '<path d="M5 19 19 5"/>'],
  [
    "draw",
    "Pen (P)",
    "P",
    '<path d="M3 21c3-1 4-4 7-7l8-8a2 2 0 0 0-3-3l-8 8c-3 3-6 4-7 7z"/>',
  ],
  ["text", "Text (T)", "T", '<path d="M5 6V4h14v2M12 4v16M9 20h6"/>'],
  [
    "sticky",
    "Sticky note (S)",
    "S",
    '<path d="M4 4h16v10l-6 6H4z"/><path d="M14 20v-6h6"/>',
  ],
  [
    "eraser",
    "Eraser (E)",
    "E",
    '<path d="m7 21-4-4 11-11 7 7-8 8z"/><path d="M7 21h13M9 11l7 7"/>',
  ],
];
const toolBtns = {};
const tb = $("toolbar");
for (const [id, title, key, path] of TOOLS) {
  const b = h("button", {
    type: "button",
    class: "tool-btn",
    title,
    "aria-label": title,
    html: `${svgI(path)}<kbd>${key}</kbd>`,
  });
  b.addEventListener("click", () => setTool(id));
  toolBtns[id] = b;
  tb.append(b);
}
tb.append(h("span", { class: "sep" }));
const imgBtn = h("button", {
  type: "button",
  class: "tool-btn",
  title: "Insert image",
  "aria-label": "Insert image",
  html: icon("image"),
});
imgBtn.addEventListener("click", async () => {
  const f = await pickFile("image/*");
  if (f) insertImage(f);
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
tb.append(imgBtn, undoBtn, redoBtn);

function setTool(t) {
  if (editingId) finishEdit();
  tool = t;
  if (t !== "select") {
    selected.clear();
    renderProps();
  }
  for (const [id, b] of Object.entries(toolBtns))
    b.setAttribute("aria-pressed", String(id === t));
  viewport.style.cursor =
    t === "hand"
      ? "grab"
      : t === "select"
        ? "default"
        : t === "text"
          ? "text"
          : "crosshair";
  $("hint").textContent =
    {
      arrow: "Drag from one shape to another to connect them",
      line: "Drag to draw a line; ends snap to shapes",
      draw: "Draw freely; stays on the pen",
      eraser: "Drag over elements to erase them",
      text: "Click to type",
      sticky: "Click to place a note",
      hand: "Drag to pan",
    }[t] || "";
  invalidate();
}
function syncChrome() {
  undoBtn.disabled = !undoStack.length;
  redoBtn.disabled = !redoStack.length;
}

// Zoom widget
const zoomPct = h(
  "button",
  { type: "button", class: "pct", title: "Reset zoom (Ctrl/⌘+0)" },
  "100%",
);
$("zoom").append(
  h(
    "button",
    {
      type: "button",
      title: "Zoom out (Ctrl/⌘+−)",
      "aria-label": "Zoom out",
      onclick: () =>
        zoomAt(
          viewport.clientWidth / 2,
          viewport.clientHeight / 2,
          view.zoom / 1.2,
        ),
    },
    "−",
  ),
  zoomPct,
  h(
    "button",
    {
      type: "button",
      title: "Zoom in (Ctrl/⌘+=)",
      "aria-label": "Zoom in",
      onclick: () =>
        zoomAt(
          viewport.clientWidth / 2,
          viewport.clientHeight / 2,
          view.zoom * 1.2,
        ),
    },
    "+",
  ),
  h("button", {
    type: "button",
    title: "Zoom to fit (Shift+1)",
    "aria-label": "Zoom to fit",
    html: svgI('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
    onclick: () => zoomToFit(),
  }),
);
zoomPct.addEventListener("click", () =>
  zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1),
);
function syncZoom() {
  zoomPct.textContent = `${Math.round(view.zoom * 100)}%`;
}

/* ---------- Creating elements ---------- */
function makeEl(type, x, y, extra = {}) {
  const s = style;
  const el = {
    id: newId(),
    type,
    x,
    y,
    w: 0,
    h: 0,
    stroke: s.stroke,
    fill: s.fill,
    fillStyle: s.fillStyle,
    strokeWidth: s.strokeWidth,
    strokeStyle: s.strokeStyle,
    opacity: s.opacity,
    sketch: s.sketch,
    seed: newSeed(),
    ...extra,
  };
  if (
    type === "text" ||
    type === "sticky" ||
    type === "rect" ||
    type === "ellipse" ||
    type === "diamond"
  )
    Object.assign(el, {
      font: s.font,
      fontSize: s.fontSize,
      align: type === "text" || type === "sticky" ? s.align : "center",
      text: el.text ?? "",
    });
  if (type === "arrow" || type === "line")
    Object.assign(el, {
      startHead: type === "arrow" ? s.startHead : "none",
      endHead: type === "arrow" ? s.endHead : "none",
    });
  if (type === "sticky") {
    el.fill = STICKY_COLORS.includes(s.fill) ? s.fill : STICKY_COLORS[0];
    el.stroke = "#2b2b2b";
  }
  return el;
}
const STICKY_COLORS = [
  "#fff3a3",
  "#ffd6e0",
  "#c9f2d0",
  "#cfe6ff",
  "#ffe0b8",
  "#e5dbff",
];

async function insertImage(file, at) {
  try {
    const m = await loadImage(file);
    const max = 2000;
    const k = Math.min(1, max / Math.max(m.width, m.height));
    const c = document.createElement("canvas");
    c.width = Math.round(m.width * k);
    c.height = Math.round(m.height * k);
    c.getContext("2d").drawImage(m.el, 0, 0, c.width, c.height);
    const url = c.toDataURL(
      file.type === "image/jpeg" ? "image/jpeg" : "image/png",
      0.9,
    );
    m.dispose();
    const fileId = `f${Date.now().toString(36)}`;
    files[fileId] = url;
    images.set(fileId, await blobToImage(url));
    const vw = viewport.clientWidth / view.zoom,
      vh = viewport.clientHeight / view.zoom;
    const s = Math.min(1, (vw * 0.5) / c.width, (vh * 0.5) / c.height);
    const w = c.width * s,
      hh = c.height * s;
    const [cx, cy] = at || [view.x + vw / 2, view.y + vh / 2];
    const el = {
      ...makeEl("image", cx - w / 2, cy - hh / 2),
      w,
      h: hh,
      fileId,
      fill: "none",
    };
    elements.push(el);
    selected = new Set([el.id]);
    setTool("select");
    selected = new Set([el.id]);
    commit();
    renderProps();
    invalidate();
  } catch (err) {
    toast(err.message || "Couldn’t insert that image.", "error");
  }
}

/* ---------- Pointer interaction ---------- */
let drag = null;
let spaceDown = false;
const pointers = new Map();
let pinch = null;

canvas.addEventListener("pointerdown", (e) => {
  viewport.focus({ preventScroll: true });
  if (editingId) finishEdit();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    startPinch();
    drag = null;
    return;
  }
  const [wx, wy] = eventPoint(e);
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left,
    sy = e.clientY - r.top;

  if (e.button === 1 || spaceDown || tool === "hand") {
    drag = { mode: "pan", sx, sy, vx: view.x, vy: view.y };
    viewport.style.cursor = "grabbing";
    return;
  }
  if (e.button !== 0) return;

  if (tool === "select") {
    const sel = selectionHandles();
    if (sel?.kind === "points") {
      const i = sel.pts.findIndex(
        ([x, y]) => Math.hypot(x - sx, y - sy) <= HS + 3,
      );
      if (i >= 0) {
        const el = selectedEls()[0];
        drag = { mode: "endpoint", el, end: i === 0 ? "start" : "end" };
        return;
      }
    } else if (sel?.kind === "box") {
      const hd = sel.handles.find(
        ({ p }) => Math.abs(p[0] - sx) <= HS && Math.abs(p[1] - sy) <= HS,
      );
      if (hd) {
        const els = selectedEls();
        drag = {
          mode: "resize",
          hx: hd.hx,
          hy: hd.hy,
          b: sel.bounds,
          orig: els.map((el) => JSON.parse(JSON.stringify(el))),
        };
        return;
      }
    }
    const target = topAt(wx, wy);
    if (target) {
      const group = target.groupId
        ? elements.filter((x) => x.groupId === target.groupId).map((x) => x.id)
        : [target.id];
      if (e.shiftKey) {
        if (selected.has(target.id)) group.forEach((id) => selected.delete(id));
        else group.forEach((id) => selected.add(id));
      } else if (!selected.has(target.id)) selected = new Set(group);
      renderProps();
      drag = {
        mode: "move",
        start: [wx, wy],
        orig: selectedEls().map((el) => ({
          el,
          x: el.x,
          y: el.y,
          points: el.points?.map((p) => [...p]),
        })),
        moved: false,
        dup: e.altKey,
      };
    } else {
      if (!e.shiftKey) {
        selected.clear();
        renderProps();
      }
      drag = {
        mode: "marquee",
        start: [wx, wy],
        now: [wx, wy],
        base: new Set(selected),
      };
    }
    invalidate();
    return;
  }

  if (tool === "eraser") {
    drag = { mode: "erase", hits: new Set() };
    eraseAt(wx, wy);
    return;
  }

  if (tool === "text") {
    const t = topAt(wx, wy);
    if (
      t &&
      (t.type === "text" ||
        t.type === "sticky" ||
        ["rect", "ellipse", "diamond"].includes(t.type))
    ) {
      startEdit(t);
      return;
    }
    const el = makeEl("text", wx, wy - style.fontSize * 0.625);
    measureText(el);
    elements.push(el);
    startEdit(el, true);
    return;
  }

  if (tool === "draw") {
    const el = makeEl("draw", wx, wy, { points: [[wx, wy]], fill: "none" });
    elements.push(el);
    drag = { mode: "draw", el };
    return;
  }

  if (tool === "line" || tool === "arrow") {
    const el = makeEl(tool, wx, wy, {
      points: [
        [wx, wy],
        [wx, wy],
      ],
      fill: "none",
    });
    const t = bindTarget(elements, wx, wy, new Set());
    if (t) el.start = { id: t.id };
    elements.push(el);
    drag = { mode: "create", el, start: [wx, wy] };
    return;
  }

  // rect, ellipse, diamond, sticky
  const el = makeEl(tool, wx, wy);
  elements.push(el);
  drag = { mode: "create", el, start: [wx, wy] };
});

canvas.addEventListener("pointermove", (e) => {
  if (pointers.has(e.pointerId))
    pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pinch && pointers.size === 2) return movePinch();
  const [wx, wy] = eventPoint(e);
  if (!drag) return hover(wx, wy, e);
  const r = canvas.getBoundingClientRect();
  switch (drag.mode) {
    case "pan":
      view.x = drag.vx - (e.clientX - r.left - drag.sx) / view.zoom;
      view.y = drag.vy - (e.clientY - r.top - drag.sy) / view.zoom;
      break;
    case "move": {
      let dx = wx - drag.start[0],
        dy = wy - drag.start[1];
      if (e.shiftKey) {
        if (Math.abs(dx) > Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (!drag.moved && Math.hypot(dx, dy) * view.zoom < 2) return;
      if (!drag.moved) {
        drag.moved = true;
        if (drag.dup) duplicateInPlace();
        // Arrows dragged without their shapes come unstuck from them.
        for (const { el } of drag.orig) {
          if (el.start && !selected.has(el.start.id)) delete el.start;
          if (el.end && !selected.has(el.end.id)) delete el.end;
        }
      }
      for (const o of drag.orig) {
        o.el.x = o.x + dx;
        o.el.y = o.y + dy;
        if (o.points) o.el.points = o.points.map(([x, y]) => [x + dx, y + dy]);
      }
      updateBindings(elements, byId());
      break;
    }
    case "marquee": {
      drag.now = [wx, wy];
      const x0 = Math.min(drag.start[0], wx),
        y0 = Math.min(drag.start[1], wy),
        x1 = Math.max(drag.start[0], wx),
        y1 = Math.max(drag.start[1], wy);
      selected = new Set(drag.base);
      for (const el of elements)
        if (el.x >= x0 && el.y >= y0 && el.x + el.w <= x1 && el.y + el.h <= y1)
          selected.add(el.id);
      expandGroups();
      break;
    }
    case "resize":
      resizeSelection(wx, wy, e.shiftKey);
      break;
    case "endpoint": {
      const { el, end } = drag;
      const skip = new Set([el.id]);
      const t = bindTarget(elements, wx, wy, skip);
      drag.bindHover = t;
      const i = end === "start" ? 0 : el.points.length - 1;
      el.points[i] = snapAngle(
        el.points[end === "start" ? 1 : i - 1] || el.points[i],
        [wx, wy],
        e.shiftKey,
      );
      delete el[end];
      syncBox(el);
      break;
    }
    case "create": {
      const { el, start } = drag;
      if (el.type === "line" || el.type === "arrow") {
        const t = bindTarget(elements, wx, wy, new Set([el.id, el.start?.id]));
        drag.bindHover = t;
        el.points[1] = snapAngle(el.points[0], [wx, wy], e.shiftKey);
        delete el.end;
        if (el.start) updateBindings([el], byId());
        syncBox(el);
      } else {
        let w = wx - start[0],
          hh = wy - start[1];
        if (e.shiftKey) {
          const m = Math.max(Math.abs(w), Math.abs(hh));
          w = Math.sign(w || 1) * m;
          hh = Math.sign(hh || 1) * m;
        }
        el.x = Math.min(start[0], start[0] + w);
        el.y = Math.min(start[1], start[1] + hh);
        el.w = Math.abs(w);
        el.h = Math.abs(hh);
      }
      break;
    }
    case "draw": {
      const pts = drag.el.points,
        lp = pts[pts.length - 1];
      if (Math.hypot(wx - lp[0], wy - lp[1]) * view.zoom >= 1.5) {
        pts.push([wx, wy]);
        syncBox(drag.el);
      }
      break;
    }
    case "erase":
      eraseAt(wx, wy);
      break;
  }
  invalidate();
});

function endPointer(e) {
  pointers.delete(e.pointerId);
  if (pinch) {
    if (pointers.size < 2) {
      pinch = null;
      save();
    }
    return;
  }
  if (!drag) return;
  const d = drag;
  drag = null;
  if (tool === "hand" || spaceDown) viewport.style.cursor = "grab";
  else if (tool === "select") viewport.style.cursor = "default";
  switch (d.mode) {
    case "pan":
      save();
      break;
    case "move":
      if (d.moved) commit();
      break;
    case "marquee":
      renderProps();
      break;
    case "resize":
      commit();
      break;
    case "endpoint":
      if (d.bindHover) {
        d.el[d.end] = { id: d.bindHover.id };
        updateBindings([d.el], byId());
      }
      commit();
      break;
    case "draw": {
      if (d.el.points.length === 1)
        d.el.points.push([d.el.points[0][0] + 0.1, d.el.points[0][1]]);
      d.el.points = simplify(d.el.points, 0.6 / view.zoom);
      syncBox(d.el);
      commit();
      break;
    }
    case "erase":
      if (d.hits.size) {
        elements = elements.filter((el) => !d.hits.has(el.id));
        d.hits.forEach(forgetRough);
        commit();
      }
      break;
    case "create": {
      const el = d.el;
      if (el.type === "line" || el.type === "arrow") {
        const [a, b] = el.points;
        if (Math.hypot(b[0] - a[0], b[1] - a[1]) * view.zoom < 4) {
          elements = elements.filter((x) => x !== el);
          invalidate();
          break;
        }
        if (d.bindHover) {
          el.end = { id: d.bindHover.id };
          updateBindings([el], byId());
        }
      } else if (el.w * view.zoom < 4 && el.h * view.zoom < 4) {
        // A click without a drag places a default-sized shape.
        const [w, hh] = el.type === "sticky" ? [200, 200] : [160, 100];
        el.w = w;
        el.h = hh;
        el.x -= w / 2;
        el.y -= hh / 2;
      }
      selected = new Set([el.id]);
      commit();
      setTool("select");
      selected = new Set([el.id]);
      renderProps();
      if (el.type === "sticky") startEdit(el, false);
      break;
    }
  }
  invalidate();
}
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);

canvas.addEventListener("dblclick", (e) => {
  const [wx, wy] = eventPoint(e);
  const t = topAt(wx, wy);
  if (
    t &&
    (t.type === "text" ||
      t.type === "sticky" ||
      ["rect", "ellipse", "diamond"].includes(t.type))
  )
    return startEdit(t);
  if (!t && tool === "select") {
    const el = makeEl("text", wx, wy - style.fontSize * 0.625);
    measureText(el);
    elements.push(el);
    startEdit(el, true);
  }
});

function hover(wx, wy, e) {
  if (tool !== "select" || spaceDown) return;
  const sel = selectionHandles();
  const r = canvas.getBoundingClientRect();
  const sx = e.clientX - r.left,
    sy = e.clientY - r.top;
  let cursor = "default";
  if (sel?.kind === "box") {
    const hd = sel.handles.find(
      ({ p }) => Math.abs(p[0] - sx) <= HS && Math.abs(p[1] - sy) <= HS,
    );
    if (hd)
      cursor =
        hd.hx === 0.5
          ? "ns-resize"
          : hd.hy === 0.5
            ? "ew-resize"
            : hd.hx === hd.hy
              ? "nwse-resize"
              : "nesw-resize";
  } else if (
    sel?.kind === "points" &&
    sel.pts.some(([x, y]) => Math.hypot(x - sx, y - sy) <= HS + 3)
  )
    cursor = "move";
  if (cursor === "default" && topAt(wx, wy)) cursor = "move";
  viewport.style.cursor = cursor;
}

function topAt(x, y) {
  for (let i = elements.length - 1; i >= 0; i--)
    if (hitTest(elements[i], x, y, zoomTol())) return elements[i];
  return null;
}
function expandGroups() {
  const groups = new Set(
    selectedEls()
      .map((e) => e.groupId)
      .filter(Boolean),
  );
  for (const el of elements)
    if (el.groupId && groups.has(el.groupId)) selected.add(el.id);
}
function eraseAt(x, y) {
  for (const el of elements)
    if (!drag.hits.has(el.id) && hitTest(el, x, y, zoomTol())) {
      drag.hits.add(el.id);
      el._fade = true;
    }
}
/** Shift: snap a line to 15° steps. */
function snapAngle(from, to, on) {
  if (!on) return to;
  const dx = to[0] - from[0],
    dy = to[1] - from[1];
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 12)) * (Math.PI / 12),
    len = Math.hypot(dx, dy);
  return [from[0] + Math.cos(a) * len, from[1] + Math.sin(a) * len];
}
/** Ramer–Douglas–Peucker, so pen strokes don't keep thousands of points. */
function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0,
      idx = -1;
    const [ax, ay] = pts[a],
      [bx, by] = pts[b];
    const len = Math.hypot(bx - ax, by - ay) || 1;
    for (let i = a + 1; i < b; i++) {
      const d =
        Math.abs(
          (by - ay) * pts[i][0] - (bx - ax) * pts[i][1] + bx * ay - by * ax,
        ) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > eps) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

function resizeSelection(wx, wy, shift) {
  const { b, hx, hy, orig } = drag;
  const ax = b.x + (1 - hx) * b.w,
    ay = b.y + (1 - hy) * b.h; // fixed corner/edge
  let sx = hx === 0.5 ? 1 : (wx - ax) / ((hx - (1 - hx)) * b.w || 1);
  let sy = hy === 0.5 ? 1 : (wy - ay) / ((hy - (1 - hy)) * b.h || 1);
  const corner = hx !== 0.5 && hy !== 0.5;
  const keepAspect =
    corner &&
    (orig.length > 1 ||
      orig.some((o) => o.type === "image" || o.type === "text")) !== shift;
  if (keepAspect) {
    const s = Math.max(Math.abs(sx), Math.abs(sy));
    sx = Math.sign(sx || 1) * s;
    sy = Math.sign(sy || 1) * s;
  }
  if (b.w * Math.abs(sx) < 2) sx = (Math.sign(sx || 1) * 2) / (b.w || 1);
  if (b.h * Math.abs(sy) < 2) sy = (Math.sign(sy || 1) * 2) / (b.h || 1);
  const map = elements.reduce((m, e) => m.set(e.id, e), new Map());
  for (const o of orig) {
    const el = map.get(o.id);
    if (o.points) {
      el.points = o.points.map(([x, y]) => [
        ax + (x - ax) * sx,
        ay + (y - ay) * sy,
      ]);
      syncBox(el);
      continue;
    }
    const x0 = ax + (o.x - ax) * sx,
      x1 = ax + (o.x + o.w - ax) * sx;
    const y0 = ay + (o.y - ay) * sy,
      y1 = ay + (o.y + o.h - ay) * sy;
    el.x = Math.min(x0, x1);
    el.y = Math.min(y0, y1);
    el.w = Math.abs(x1 - x0);
    el.h = Math.abs(y1 - y0);
    if (el.type === "text") {
      el.fontSize = Math.max(4, o.fontSize * Math.abs(corner ? sy : 1));
      measureText(el);
    }
  }
  updateBindings(elements, byId());
}

/* ---------- Pinch (touch) ---------- */
function startPinch() {
  const [a, b] = [...pointers.values()];
  pinch = {
    d: Math.hypot(a[0] - b[0], a[1] - b[1]),
    mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2],
    zoom: view.zoom,
    vx: view.x,
    vy: view.y,
  };
  if (drag?.mode === "create" || drag?.mode === "draw")
    elements = elements.filter((x) => x !== drag.el);
  drag = null;
}
function movePinch() {
  const [a, b] = [...pointers.values()];
  const d = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  const r = canvas.getBoundingClientRect();
  const z = Math.max(0.1, Math.min(8, pinch.zoom * (d / pinch.d)));
  const wx = (pinch.mid[0] - r.left) / pinch.zoom + pinch.vx,
    wy = (pinch.mid[1] - r.top) / pinch.zoom + pinch.vy;
  view.zoom = z;
  view.x = wx - (mid[0] - r.left) / z;
  view.y = wy - (mid[1] - r.top) / z;
  invalidate();
  syncZoom();
}

/* ---------- Wheel: pan, Ctrl/⌘ + wheel or pinch: zoom ---------- */
viewport.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey)
      zoomAt(
        e.clientX - r.left,
        e.clientY - r.top,
        view.zoom * Math.exp(-e.deltaY * (e.deltaMode ? 0.05 : 0.01)),
      );
    else {
      const k = e.deltaMode ? 20 : 1;
      view.x +=
        ((e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX) * k) / view.zoom;
      view.y += ((e.shiftKey && !e.deltaX ? 0 : e.deltaY) * k) / view.zoom;
      invalidate();
      save();
    }
  },
  { passive: false },
);

/* ---------- Text editing ---------- */
let editingNew = false;
function startEdit(el, isNew = false) {
  if (editingId) finishEdit();
  editingId = el.id;
  editingNew = isNew;
  selected = new Set([el.id]);
  editor.hidden = false;
  editor.value = el.text || "";
  placeEditor();
  renderProps();
  invalidate();
  setTimeout(() => {
    editor.focus();
    editor.setSelectionRange(editor.value.length, editor.value.length);
  });
}
function placeEditor() {
  const el = elements.find((x) => x.id === editingId);
  if (!el) return;
  const z = view.zoom;
  const st = editor.style;
  st.font = `${el.fontSize * z}px ${FONTS[el.font] || FONTS.hand}`;
  st.lineHeight = "1.25";
  st.color = el.type === "sticky" ? "#2b2b2b" : el.stroke;
  if (el.type === "text") {
    measureText(el);
    const [x, y] = toScreen(el.x, el.y);
    Object.assign(st, {
      left: `${x}px`,
      top: `${y}px`,
      width: `${Math.max(20, el.w * z + 20)}px`,
      height: `${el.h * z + 4}px`,
      textAlign: el.align || "left",
      whiteSpace: "pre",
      padding: "0",
    });
  } else {
    const pad = (el.type === "sticky" ? 16 : Math.max(8, el.w * 0.08)) * z;
    const [x, y] = toScreen(el.x, el.y);
    const lines = Math.max(1, editor.value.split("\n").length);
    const textH = Math.min(
      el.h * z - 2 * pad,
      Math.max(el.fontSize * 1.25 * z * lines, editor.scrollHeight),
    );
    Object.assign(st, {
      left: `${x + pad}px`,
      width: `${Math.max(20, el.w * z - 2 * pad)}px`,
      whiteSpace: "pre-wrap",
      padding: "0",
      top:
        el.type === "sticky"
          ? `${y + pad}px`
          : `${y + (el.h * z - textH) / 2}px`,
      height: `${el.type === "sticky" ? el.h * z - 2 * pad : textH}px`,
      textAlign: el.type === "sticky" ? el.align || "left" : "center",
    });
  }
}
editor.addEventListener("input", () => {
  const el = elements.find((x) => x.id === editingId);
  if (!el) return;
  el.text = editor.value;
  if (el.type === "text") {
    measureText(el);
    updateBindings(elements, byId());
  }
  placeEditor();
  invalidate();
});
editor.addEventListener("keydown", (e) => {
  if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
    e.preventDefault();
    finishEdit();
    viewport.focus();
  }
  e.stopPropagation();
});
editor.addEventListener("blur", () => finishEdit());
function finishEdit() {
  if (!editingId) return;
  const el = elements.find((x) => x.id === editingId);
  editingId = null;
  editor.hidden = true;
  if (el && el.type === "text" && !el.text.trim()) {
    elements = elements.filter((x) => x !== el);
    selected.delete(el.id);
  } else if (el && el.type === "text") measureText(el);
  updateBindings(elements, byId());
  commit();
  if (editingNew && tool === "text") setTool("select");
  renderProps();
  invalidate();
}

/* ---------- Commands ---------- */
function deleteSelected() {
  if (!selected.size) return;
  elements = elements.filter((e) => !selected.has(e.id));
  selected.forEach(forgetRough);
  selected.clear();
  updateBindings(elements, byId());
  commit();
  renderProps();
  invalidate();
}
function cloneEls(els, offset) {
  const ids = new Map(els.map((e) => [e.id, newId()]));
  const groups = new Map();
  return els.map((e) => {
    const c = JSON.parse(JSON.stringify(e));
    c.id = ids.get(e.id);
    c.seed = newSeed();
    c.x += offset;
    c.y += offset;
    if (c.points) c.points = c.points.map(([x, y]) => [x + offset, y + offset]);
    if (c.start)
      c.start = ids.has(c.start.id) ? { id: ids.get(c.start.id) } : undefined;
    if (c.end)
      c.end = ids.has(c.end.id) ? { id: ids.get(c.end.id) } : undefined;
    if (!c.start) delete c.start;
    if (!c.end) delete c.end;
    if (c.groupId) {
      if (!groups.has(c.groupId)) groups.set(c.groupId, newId());
      c.groupId = groups.get(c.groupId);
    }
    delete c._fade;
    return c;
  });
}
function duplicate() {
  const copies = cloneEls(selectedEls(), 16);
  if (!copies.length) return;
  elements.push(...copies);
  selected = new Set(copies.map((c) => c.id));
  updateBindings(elements, byId());
  commit();
  renderProps();
  invalidate();
}
/** Alt-drag: leave copies behind and keep dragging the originals. */
function duplicateInPlace() {
  const copies = cloneEls(selectedEls(), 0);
  const first = Math.min(...selectedEls().map((e) => elements.indexOf(e)));
  elements.splice(first, 0, ...copies);
}
function reorder(where) {
  if (!selected.size) return;
  const sel = elements.filter((e) => selected.has(e.id)),
    rest = elements.filter((e) => !selected.has(e.id));
  if (where === "front") elements = [...rest, ...sel];
  else if (where === "back") elements = [...sel, ...rest];
  else {
    const arr = [...elements];
    const idxs = arr
      .map((e, i) => (selected.has(e.id) ? i : -1))
      .filter((i) => i >= 0);
    if (where === "forward")
      for (let k = idxs.length - 1; k >= 0; k--) {
        const i = idxs[k];
        if (i < arr.length - 1 && !selected.has(arr[i + 1].id))
          [arr[i], arr[i + 1]] = [arr[i + 1], arr[i]];
      }
    else
      for (const i of idxs)
        if (i > 0 && !selected.has(arr[i - 1].id))
          [arr[i], arr[i - 1]] = [arr[i - 1], arr[i]];
    elements = arr;
  }
  commit();
  invalidate();
}
function group() {
  if (selected.size < 2) return;
  const g = newId();
  selectedEls().forEach((e) => {
    e.groupId = g;
  });
  commit();
  renderProps();
  toast("Grouped", "success", 1200);
}
function ungroup() {
  let n = 0;
  selectedEls().forEach((e) => {
    if (e.groupId) {
      delete e.groupId;
      n++;
    }
  });
  if (n) {
    commit();
    renderProps();
    toast("Ungrouped", "success", 1200);
  }
}
function alignSel(how) {
  const els = selectedEls();
  if (els.length < 2) return;
  const b = unionBounds(els.map((e) => ({ ...e, strokeWidth: 0 })));
  // Groups move as one unit.
  const units = new Map();
  for (const e of els) {
    const k = e.groupId || e.id;
    if (!units.has(k)) units.set(k, []);
    units.get(k).push(e);
  }
  for (const list of units.values()) {
    const u = unionBounds(list.map((e) => ({ ...e, strokeWidth: 0 })));
    const dx =
      how === "left"
        ? b.x - u.x
        : how === "right"
          ? b.x + b.w - u.x - u.w
          : how === "hcenter"
            ? b.x + b.w / 2 - u.x - u.w / 2
            : 0;
    const dy =
      how === "top"
        ? b.y - u.y
        : how === "bottom"
          ? b.y + b.h - u.y - u.h
          : how === "vcenter"
            ? b.y + b.h / 2 - u.y - u.h / 2
            : 0;
    for (const e of list) {
      e.x += dx;
      e.y += dy;
      if (e.points) e.points = e.points.map(([x, y]) => [x + dx, y + dy]);
    }
  }
  updateBindings(elements, byId());
  commit();
  invalidate();
}

/* ---------- Keyboard ---------- */
const KEYS = {
  h: "hand",
  v: "select",
  r: "rect",
  d: "diamond",
  o: "ellipse",
  a: "arrow",
  l: "line",
  p: "draw",
  t: "text",
  s: "sticky",
  e: "eraser",
  1: "select",
  2: "rect",
  3: "diamond",
  4: "ellipse",
  5: "arrow",
  6: "line",
  7: "draw",
  8: "text",
  9: "sticky",
  0: "eraser",
};
document.addEventListener("keydown", (e) => {
  if (e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const focus = document.activeElement;
  if (focus !== document.body && !focus?.closest?.(".wb-layout")) return; // shortcuts only while working on the board
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
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
  if (mod && k === "d") {
    e.preventDefault();
    duplicate();
    return;
  }
  if (mod && k === "a") {
    e.preventDefault();
    setTool("select");
    selected = new Set(elements.map((x) => x.id));
    renderProps();
    invalidate();
    return;
  }
  if (mod && k === "g") {
    e.preventDefault();
    e.shiftKey ? ungroup() : group();
    return;
  }
  if (mod && (k === "=" || k === "+")) {
    e.preventDefault();
    zoomAt(
      viewport.clientWidth / 2,
      viewport.clientHeight / 2,
      view.zoom * 1.2,
    );
    return;
  }
  if (mod && k === "-") {
    e.preventDefault();
    zoomAt(
      viewport.clientWidth / 2,
      viewport.clientHeight / 2,
      view.zoom / 1.2,
    );
    return;
  }
  if (mod && k === "0") {
    e.preventDefault();
    zoomAt(viewport.clientWidth / 2, viewport.clientHeight / 2, 1);
    return;
  }
  if (mod) return;
  if (e.shiftKey && (k === "!" || e.code === "Digit1")) {
    zoomToFit();
    return;
  }
  if (k === "delete" || k === "backspace") {
    e.preventDefault();
    deleteSelected();
    return;
  }
  if (k === "escape") {
    selected.clear();
    setTool("select");
    renderProps();
    return;
  }
  if (k === "enter" && selected.size === 1) {
    const el = selectedEls()[0];
    if (["text", "sticky", "rect", "ellipse", "diamond"].includes(el.type)) {
      e.preventDefault();
      startEdit(el);
    }
    return;
  }
  if (k === "]" || k === "}") {
    reorder(e.shiftKey ? "front" : "forward");
    return;
  }
  if (k === "[" || k === "{") {
    reorder(e.shiftKey ? "back" : "backward");
    return;
  }
  if (k.startsWith("arrow") && selected.size) {
    e.preventDefault();
    const step = e.shiftKey ? 10 : 1;
    const dx = k === "arrowleft" ? -step : k === "arrowright" ? step : 0,
      dy = k === "arrowup" ? -step : k === "arrowdown" ? step : 0;
    for (const el of selectedEls()) {
      el.x += dx;
      el.y += dy;
      if (el.points) el.points = el.points.map(([x, y]) => [x + dx, y + dy]);
    }
    updateBindings(elements, byId());
    invalidate();
    commit();
    return;
  }
  if (KEYS[k] && !e.altKey) setTool(KEYS[k]);
});
document.addEventListener("keyup", (e) => {
  if (e.key === " ") {
    spaceDown = false;
    setTool(tool);
  }
});

/* ---------- Clipboard ---------- */
const CLIP = "toolbox-whiteboard/elements";
document.addEventListener("copy", (e) => {
  if (e.target.closest?.("input, textarea") || !selected.size) return;
  const els = selectedEls();
  const used = Object.fromEntries(
    els.filter((x) => x.fileId).map((x) => [x.fileId, files[x.fileId]]),
  );
  e.clipboardData.setData(
    "text/plain",
    JSON.stringify({ type: CLIP, elements: els, files: used }),
  );
  e.preventDefault();
});
document.addEventListener("cut", (e) => {
  if (e.target.closest?.("input, textarea") || !selected.size) return;
  const els = selectedEls();
  e.clipboardData.setData(
    "text/plain",
    JSON.stringify({
      type: CLIP,
      elements: els,
      files: Object.fromEntries(
        els.filter((x) => x.fileId).map((x) => [x.fileId, files[x.fileId]]),
      ),
    }),
  );
  e.preventDefault();
  deleteSelected();
});
document.addEventListener("paste", (e) => {
  if (e.target.closest?.("input, textarea")) return;
  const imgs = imagesFromClipboard(e.clipboardData);
  if (imgs.length) {
    e.preventDefault();
    insertImage(imgs[0]);
    return;
  }
  const text = e.clipboardData.getData("text/plain");
  if (!text) return;
  e.preventDefault();
  try {
    const data = JSON.parse(text);
    if (data.type === CLIP && Array.isArray(data.elements)) {
      Object.assign(files, data.files || {});
      Object.keys(data.files || {}).forEach(async (id) => {
        images.set(id, await blobToImage(files[id]));
        invalidate();
      });
      const copies = cloneEls(data.elements, 20);
      elements.push(...copies);
      selected = new Set(copies.map((c) => c.id));
      setTool("select");
      selected = new Set(copies.map((c) => c.id));
      updateBindings(elements, byId());
      commit();
      renderProps();
      invalidate();
      return;
    }
  } catch {
    /* plain text */
  }
  const [cx, cy] = toWorld(viewport.clientWidth / 2, viewport.clientHeight / 2);
  const el = makeEl("text", cx, cy, { text: text.slice(0, 5000) });
  measureText(el);
  el.x -= el.w / 2;
  el.y -= el.h / 2;
  elements.push(el);
  selected = new Set([el.id]);
  setTool("select");
  selected = new Set([el.id]);
  commit();
  renderProps();
  invalidate();
});
viewport.addEventListener("dragover", (e) => e.preventDefault());
viewport.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = [...e.dataTransfer.files][0];
  if (!f) return;
  if (/\.json$/i.test(f.name) || f.type === "application/json")
    return openFile(f);
  if (f.type.startsWith("image/")) insertImage(f, eventPoint(e));
});

/* ---------- Properties panel ---------- */
const STROKES = [
  "#1e1e1e",
  "#e03131",
  "#2f9e44",
  "#1971c2",
  "#f08c00",
  "#9c36b5",
  "#868e96",
  "#ffffff",
];
const FILLS = [
  "none",
  "#ffc9c9",
  "#b2f2bb",
  "#a5d8ff",
  "#ffec99",
  "#eebefa",
  "#e9ecef",
  "#1e1e1e",
];
const BOARD_BGS = [
  "#ffffff",
  "#f8f9fa",
  "#fdf6e3",
  "#f1f7ff",
  "#1e1e1e",
  "#0f172a",
];

/** Apply a style change to the selection (and remember it for new elements). */
function setStyle(patch) {
  Object.assign(style, patch);
  saveStyle();
  const els = selectedEls();
  for (const el of els) {
    for (const [k, v] of Object.entries(patch)) {
      if (k === "fill" && el.type === "sticky") {
        if (v !== "none") el.fill = v;
        continue;
      }
      if (
        (k === "startHead" || k === "endHead") &&
        !(el.type === "arrow" || el.type === "line")
      )
        continue;
      if (
        (k === "font" || k === "fontSize" || k === "align") &&
        !("fontSize" in el)
      )
        continue;
      if (k === "stroke" && el.type === "sticky") continue;
      el[k] = v;
    }
    if (el.type === "text") measureText(el);
  }
  if (els.length) {
    updateBindings(elements, byId());
    commit();
  }
  if (editingId) placeEditor();
  renderProps();
  invalidate();
}

function swatches(list, value, key, { picker = true } = {}) {
  const wrap = h("div", { class: "wb-swatches" });
  for (const c of list) {
    wrap.append(
      h("button", {
        type: "button",
        class: `wb-swatch${c === "none" ? " none" : ""}`,
        title: c === "none" ? "None" : c,
        "aria-label": c === "none" ? "No fill" : c,
        "aria-pressed": String(value === c),
        style: c === "none" ? "" : `background:${c}`,
        onclick: () => setStyle({ [key]: c }),
      }),
    );
  }
  if (picker) {
    const p = h("input", {
      type: "color",
      value: value && value !== "none" ? value : "#000000",
      title: "Custom color",
      "aria-label": "Custom color",
    });
    p.addEventListener("change", () => setStyle({ [key]: p.value }));
    wrap.append(p);
  }
  return wrap;
}
function seg(options, value, key) {
  return h(
    "div",
    { class: "segmented" },
    options.map(([v, label, title]) =>
      h(
        "button",
        {
          type: "button",
          title: title || null,
          "aria-pressed": String(String(value) === String(v)),
          onclick: () =>
            setStyle({
              [key]:
                typeof value === "number"
                  ? +v
                  : v === "true"
                    ? true
                    : v === "false"
                      ? false
                      : v,
            }),
        },
        label,
      ),
    ),
  );
}
const row = (label, el) =>
  h(
    "div",
    { class: "ctrl" },
    h("div", { class: "ctrl-label" }, h("span", {}, label)),
    el,
  );
const ib = (title, path, fn, disabled) =>
  h("button", {
    type: "button",
    class: "tool-btn",
    title,
    "aria-label": title,
    disabled,
    html: svgI(path),
    onclick: fn,
  });

function renderProps() {
  const els = selectedEls();
  const s = els[0] ? { ...style, ...els[0] } : style;
  const types = new Set(els.map((e) => e.type));
  const creating = els.length ? null : tool;
  const has = (...t) => t.some((x) => types.has(x) || creating === x);
  const out = [];
  const sec = (title, ...kids) =>
    out.push(
      h(
        "section",
        { class: "ctrl-section" },
        h("h3", {}, title),
        ...kids.filter(Boolean),
      ),
    );

  if (!els.length && (tool === "select" || tool === "hand")) {
    sec(
      "Board",
      row(
        "Background",
        h(
          "div",
          { class: "wb-swatches" },
          BOARD_BGS.map((c) =>
            h("button", {
              type: "button",
              class: "wb-swatch",
              title: c,
              "aria-label": `Board ${c}`,
              "aria-pressed": String(board.bg === c),
              style: `background:${c}`,
              onclick: () => {
                board.bg = c;
                save();
                renderProps();
                invalidate();
              },
            }),
          ),
        ),
      ),
      h(
        "div",
        { class: "ctrl" },
        h(
          "label",
          { class: "toggle" },
          h("span", {}, "Dot grid"),
          (() => {
            const i = h("input", { type: "checkbox", role: "switch" });
            i.checked = board.grid;
            i.addEventListener("change", () => {
              board.grid = i.checked;
              save();
              invalidate();
            });
            return i;
          })(),
        ),
      ),
    );
  }
  const title = els.length
    ? els.length === 1
      ? {
          rect: "Rectangle",
          ellipse: "Ellipse",
          diamond: "Diamond",
          arrow: "Arrow",
          line: "Line",
          draw: "Pen stroke",
          text: "Text",
          sticky: "Sticky note",
          image: "Image",
        }[els[0].type]
      : `${els.length} selected`
    : "Style for new elements";
  const onlyImages = els.length && [...types].every((t) => t === "image");
  if (!onlyImages) {
    sec(
      title,
      !has("sticky") || els.length !== 1
        ? row("Stroke", swatches(STROKES, s.stroke, "stroke"))
        : null,
      has("rect", "ellipse", "diamond", "select") ||
        (!els.length && tool === "select")
        ? row("Background", swatches(FILLS, s.fill, "fill"))
        : null,
      has("sticky")
        ? row(
            "Note color",
            swatches(STICKY_COLORS, s.fill, "fill", { picker: false }),
          )
        : null,
      (has("rect", "ellipse", "diamond") ||
        (!els.length && tool === "select")) &&
        s.fill !== "none" &&
        s.sketch
        ? row(
            "Fill",
            seg(
              [
                ["hachure", "Hatch"],
                ["cross", "Cross"],
                ["solid", "Solid"],
              ],
              s.fillStyle,
              "fillStyle",
            ),
          )
        : null,
      !has("text", "sticky") ||
        has("rect", "ellipse", "diamond", "line", "arrow", "draw")
        ? row(
            "Stroke width",
            seg(
              [
                [1, "Thin"],
                [2, "Bold"],
                [4, "Extra"],
              ],
              s.strokeWidth,
              "strokeWidth",
            ),
          )
        : null,
      !has("text", "sticky", "draw") ||
        has("rect", "ellipse", "diamond", "line", "arrow")
        ? row(
            "Stroke style",
            seg(
              [
                ["solid", "Solid"],
                ["dashed", "Dashed"],
                ["dotted", "Dotted"],
              ],
              s.strokeStyle,
              "strokeStyle",
            ),
          )
        : null,
      row(
        "Style",
        seg(
          [
            ["true", "Hand-drawn"],
            ["false", "Clean"],
          ],
          String(s.sketch),
          "sketch",
        ),
      ),
      has("arrow", "line")
        ? row(
            "Start",
            seg(
              [
                ["none", "None"],
                ["arrow", "→"],
                ["triangle", "▶"],
                ["dot", "●"],
              ],
              s.startHead,
              "startHead",
            ),
          )
        : null,
      has("arrow", "line")
        ? row(
            "End",
            seg(
              [
                ["none", "None"],
                ["arrow", "→"],
                ["triangle", "▶"],
                ["dot", "●"],
              ],
              s.endHead,
              "endHead",
            ),
          )
        : null,
    );
  }
  if (
    has("text", "sticky", "rect", "ellipse", "diamond") ||
    (!els.length && tool === "select")
  ) {
    sec(
      "Text",
      row(
        "Font",
        seg(
          [
            ["hand", "Hand"],
            ["sans", "Sans"],
            ["mono", "Code"],
          ],
          s.font,
          "font",
        ),
      ),
      row(
        "Size",
        seg(
          [
            [16, "S"],
            [20, "M"],
            [28, "L"],
            [40, "XL"],
          ],
          s.fontSize,
          "fontSize",
        ),
      ),
      has("text", "sticky")
        ? row(
            "Align",
            seg(
              [
                ["left", "Left"],
                ["center", "Center"],
                ["right", "Right"],
              ],
              s.align,
              "align",
            ),
          )
        : null,
    );
  }
  const op = h("input", {
    type: "range",
    min: 10,
    max: 100,
    step: 5,
    value: s.opacity,
    style: `--pct:${((s.opacity - 10) / 90) * 100}%`,
  });
  const opVal = h("span", { class: "ctrl-value" }, `${s.opacity}%`);
  op.addEventListener("input", () => {
    opVal.textContent = `${op.value}%`;
    op.style.setProperty("--pct", `${((op.value - 10) / 90) * 100}%`);
    style.opacity = +op.value;
    saveStyle();
    selectedEls().forEach((e) => {
      e.opacity = +op.value;
    });
    invalidate();
  });
  op.addEventListener("change", () => commit());
  out.push(
    h(
      "section",
      { class: "ctrl-section" },
      h(
        "div",
        { class: "ctrl" },
        h("label", { class: "ctrl-label" }, h("span", {}, "Opacity"), opVal),
        op,
      ),
    ),
  );

  if (els.length) {
    const multi = els.length > 1;
    sec(
      "Arrange",
      h(
        "div",
        { class: "toolbar" },
        ib(
          "Send to back (Shift+[)",
          '<rect x="4" y="4" width="12" height="12" rx="1"/><rect x="10" y="10" width="10" height="10" rx="1" fill="currentColor" fill-opacity=".25" stroke="none"/>',
          () => reorder("back"),
        ),
        ib("Send backward ([)", '<path d="m6 10 6 6 6-6"/>', () =>
          reorder("backward"),
        ),
        ib("Bring forward (])", '<path d="m6 14 6-6 6 6"/>', () =>
          reorder("forward"),
        ),
        ib(
          "Bring to front (Shift+])",
          '<rect x="8" y="8" width="12" height="12" rx="1" fill="currentColor" fill-opacity=".25"/><path d="M4 16V5a1 1 0 0 1 1-1h11"/>',
          () => reorder("front"),
        ),
        h("span", { class: "sep" }),
        ib(
          "Duplicate (Ctrl/⌘+D)",
          '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/>',
          duplicate,
        ),
        ib(
          "Delete (Del)",
          '<path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>',
          deleteSelected,
        ),
        ib(
          "Group (Ctrl/⌘+G)",
          '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M3 15v6h6M21 9V3h-6"/>',
          group,
          !multi,
        ),
        ib(
          "Ungroup (Ctrl/⌘+Shift+G)",
          '<rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/>',
          ungroup,
          !els.some((e) => e.groupId),
        ),
      ),
      multi
        ? h(
            "div",
            { class: "toolbar", style: "margin-top:6px" },
            ib("Align left", '<path d="M4 3v18M8 7h10M8 12h6M8 17h12"/>', () =>
              alignSel("left"),
            ),
            ib(
              "Align centers horizontally",
              '<path d="M12 3v18M6 7h12M8 12h8M5 17h14"/>',
              () => alignSel("hcenter"),
            ),
            ib(
              "Align right",
              '<path d="M20 3v18M6 7h10M10 12h6M4 17h12"/>',
              () => alignSel("right"),
            ),
            ib("Align top", '<path d="M3 4h18M7 8v10M12 8v6M17 8v12"/>', () =>
              alignSel("top"),
            ),
            ib(
              "Align centers vertically",
              '<path d="M3 12h18M7 6v12M12 8v8M17 5v14"/>',
              () => alignSel("vcenter"),
            ),
            ib(
              "Align bottom",
              '<path d="M3 20h18M7 6v10M12 10v6M17 4v12"/>',
              () => alignSel("bottom"),
            ),
          )
        : null,
    );
  }
  $("props").replaceChildren(...out);
}

/* ---------- File ---------- */
const FILE_TYPE = "toolbox-whiteboard";
function exportJson() {
  return JSON.stringify({
    type: FILE_TYPE,
    version: 1,
    elements: elements.map(({ _fade, ...e }) => e),
    files: usedFiles(),
    board,
  });
}
async function openFile(f) {
  try {
    const data = JSON.parse(await f.text());
    if (data.type !== FILE_TYPE || !Array.isArray(data.elements))
      throw new Error("bad");
    await loadScene(data);
    commit();
    zoomToFit();
    toast(`Opened ${f.name}`, "success");
  } catch {
    toast("That file isn’t a Whiteboard JSON file.", "error");
  }
}
async function loadScene(data) {
  elements = data.elements || [];
  files = { ...files, ...(data.files || {}) };
  Object.assign(board, data.board || {});
  selected.clear();
  await Promise.all(
    Object.entries(files).map(async ([id, url]) => {
      try {
        images.set(id, await blobToImage(url));
      } catch {
        /* skip */
      }
    }),
  );
  renderProps();
  invalidate();
}
$("file").append(
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("upload")} Open`,
    onclick: async () => {
      const f = await pickFile(".json,application/json");
      if (f) openFile(f);
    },
  }),
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("download")} Save JSON`,
    onclick: () =>
      downloadBlob(
        new Blob([exportJson()], { type: "application/json" }),
        "whiteboard.json",
      ),
  }),
  h("button", {
    type: "button",
    class: "btn btn-sm btn-ghost",
    html: `${icon("trash")} Clear`,
    onclick: () => {
      if (
        !elements.length ||
        !confirm("Clear the whole board? You can undo this.")
      )
        return;
      elements = [];
      selected.clear();
      commit();
      renderProps();
      invalidate();
    },
  }),
);
$("help").innerHTML = [
  ["V H", "select, hand"],
  ["R D O", "rectangle, diamond, ellipse"],
  ["A L P", "arrow, line, pen"],
  ["T S E", "text, sticky, eraser"],
  ["Space+drag", "pan · wheel scrolls"],
  ["Ctrl/⌘+wheel", "zoom · Shift+1 fit"],
  ["Dbl-click", "edit text or add a label"],
  ["Shift", "square shapes, 15° lines, add to selection"],
  ["Alt+drag", "duplicate"],
  ["Ctrl/⌘+G", "group (+Shift ungroup)"],
  ["Ctrl/⌘+D", "duplicate"],
  ["[ ]", "backward/forward (+Shift: back/front)"],
  ["Ctrl/⌘+Z", "undo (+Shift redo)"],
  ["Ctrl/⌘+C / V", "copy, paste (images too)"],
]
  .map(
    ([k, d]) =>
      `<div>${k
        .split(" ")
        .map((x) => `<kbd>${x}</kbd>`)
        .join(" ")} ${d}</div>`,
  )
  .join("");

/* ---------- Export ---------- */
const exportOpts = {
  bg: store.get("whiteboard:export-bg", true),
  onlySel: false,
};
const bgToggle = h("input", { type: "checkbox", role: "switch" });
bgToggle.checked = exportOpts.bg;
bgToggle.addEventListener("change", () => {
  exportOpts.bg = bgToggle.checked;
  store.set("whiteboard:export-bg", exportOpts.bg);
});
const selToggle = h("input", { type: "checkbox", role: "switch" });
selToggle.addEventListener("change", () => {
  exportOpts.onlySel = selToggle.checked;
});
$("export-opts").append(
  h("label", { class: "toggle" }, h("span", {}, "Background"), bgToggle),
  h("label", { class: "toggle" }, h("span", {}, "Only selected"), selToggle),
);

const PAD = 32;
function exportEls() {
  const els = exportOpts.onlySel && selected.size ? selectedEls() : elements;
  if (!els.length) throw new Error("The board is empty.");
  return els;
}
function exportCanvas(scale) {
  const els = exportEls();
  const b = unionBounds(els);
  const W = b.w + PAD * 2,
    H = b.h + PAD * 2;
  scale = Math.min(scale, 8192 / Math.max(W, H));
  const c = document.createElement("canvas");
  c.width = Math.ceil(W * scale);
  c.height = Math.ceil(H * scale);
  const x = c.getContext("2d");
  x.scale(scale, scale);
  if (exportOpts.bg) {
    x.fillStyle = board.bg;
    x.fillRect(0, 0, W, H);
  }
  x.translate(PAD - b.x, PAD - b.y);
  const env = {
    rough: roughLib ? roughLib.canvas(c) : null,
    gen,
    images,
    editingId: null,
  };
  for (const el of els) drawElement(x, { ...el, _fade: false }, env);
  return c;
}
function exportSvg() {
  const els = exportEls();
  const b = unionBounds(els);
  const W = b.w + PAD * 2,
    H = b.h + PAD * 2;
  const env = { gen, files };
  const body = els.map((el) => elementSvg(el, env)).join("\n");
  const usesHand = els.some((e) => e.text && (e.font || "hand") === "hand");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Math.ceil(W)}" height="${Math.ceil(H)}" viewBox="${b.x - PAD} ${b.y - PAD} ${W} ${H}">
<defs>${usesHand ? "<style>@import url('https://fonts.googleapis.com/css2?family=Kalam&amp;display=swap');</style>" : ""}<filter id="wb-sticky" x="-10%" y="-10%" width="130%" height="130%"><feDropShadow dx="0" dy="4" stdDeviation="6" flood-opacity="0.18"/></filter></defs>
${exportOpts.bg ? `<rect x="${b.x - PAD}" y="${b.y - PAD}" width="${W}" height="${H}" fill="${board.bg}"/>` : ""}
${body}
</svg>`;
}
createImageExport($("export"), {
  id: "whiteboard",
  getCanvas: exportCanvas,
  svg: async () => exportSvg(),
  formats: ["png", "svg", "jpg", "webp"],
  scales: [1, 2, 3],
  filename: () => "whiteboard",
  matte: () => board.bg,
});

/* ---------- Start ---------- */
function loadHandFont() {
  document.head.append(
    h("link", {
      rel: "stylesheet",
      href: "https://fonts.googleapis.com/css2?family=Kalam:wght@400;700&display=swap",
    }),
  );
  document.fonts
    ?.load('20px "Kalam"')
    .then(() => {
      elements.filter((e) => e.type === "text").forEach(measureText);
      invalidate();
    })
    .catch(() => {});
}

(async () => {
  loadHandFont();
  try {
    roughLib = (await loadLib("rough")).default;
    rough = roughLib.canvas(canvas);
    gen = roughLib.generator();
  } catch (err) {
    toast(
      "The hand-drawn style couldn’t load (offline?). Shapes are drawn in the clean style.",
      "warning",
    );
  }
  const saved = await kvGet("whiteboard:scene").catch(() => null);
  if (saved?.elements) {
    await loadScene(saved);
    if (saved.view) Object.assign(view, saved.view);
  } else {
    seedDemo();
  }
  last = JSON.stringify(elements);
  setTool("select");
  syncZoom();
  syncChrome();
  renderProps();
  resize();
})();

function seedDemo() {
  const a = {
    ...makeEl("rect", 40, 40),
    w: 200,
    h: 90,
    text: "Idea",
    fill: "#a5d8ff",
    fillStyle: "hachure",
  };
  const b = {
    ...makeEl("diamond", 340, 20),
    w: 180,
    h: 130,
    text: "Worth it?",
    fill: "#ffec99",
  };
  const c = {
    ...makeEl("ellipse", 620, 40),
    w: 180,
    h: 90,
    text: "Ship it",
    fill: "#b2f2bb",
  };
  const s = {
    ...makeEl("sticky", 360, 210),
    w: 200,
    h: 160,
    text: "Drag shapes around: the arrows stay attached.",
  };
  const ar1 = {
    ...makeEl("arrow", 0, 0, {
      points: [
        [0, 0],
        [1, 1],
      ],
      fill: "none",
    }),
    start: { id: a.id },
    end: { id: b.id },
  };
  const ar2 = {
    ...makeEl("arrow", 0, 0, {
      points: [
        [0, 0],
        [1, 1],
      ],
      fill: "none",
    }),
    start: { id: b.id },
    end: { id: c.id },
  };
  [a, b, c].forEach((e) => {
    e.font = "hand";
    e.fontSize = 22;
    e.align = "center";
  });
  elements = [a, b, c, s, ar1, ar2];
  updateBindings(elements, byId());
  view.x = -60;
  view.y = -80;
}
