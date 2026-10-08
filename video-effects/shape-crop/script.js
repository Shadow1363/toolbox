/*
 * Shape Crop: crop a video or image to a rectangle, a built-in shape or your own SVG/PNG.

 *
 * Geometry lives in source pixels ("scene" space): the shape box { x, y (centre), w, h, rot (deg) },
 * optional keyframes of that box, and the media offset/zoom. A view maps the scene onto a canvas:
 * { cw, ch, sc, fx, fy } (canvas size, scale, scene point at the canvas's top-left).
 * composite() draws one frame for a view; the result view is the export, the edit view is the
 * whole frame with the outside dimmed plus handles (a separate canvas, never exported).
 */
import { createControls } from "/assets/js/lib/controls.js";
import { createDropzone } from "/assets/js/lib/upload.js";
import { createStage } from "/assets/js/lib/stage.js";
import {
  createExportBar,
  canRecordAlpha,
  TRANSPARENT_HINT,
} from "/assets/js/lib/exporter.js";
import { outputSize, scratch, drawBlurred } from "/assets/js/lib/canvas.js";
import {
  h,
  icon,
  toast,
  downloadBlob,
  formatTime,
  formatBytes,
} from "/assets/js/lib/dom.js";
import { ease, easingOptions, clamp, lerp } from "/assets/js/lib/easing.js";
import { SHAPES, getShape } from "./shapes/index.js";
import {
  shapeFromFile,
  shapeFromSvg,
  shapeUrl,
  rasterMask,
  loadMyShapes,
  saveMyShapes,
  forgetShape,
} from "./custom.js";

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const editor = document.getElementById("editor");
const ectx = editor.getContext("2d");
const overlay = document.getElementById("overlay");

const MIN_SIZE = 8; // smallest box side, source px
const KEY_EPS = 1 / 60; // keyframes closer than this are the same keyframe
const ASPECTS = [
  ["free", "Free"],
  ["1:1", "1:1"],
  ["4:5", "4:5"],
  ["9:16", "9:16"],
  ["16:9", "16:9"],
  ["3:2", "3:2"],
  ["21:9", "21:9"],
];
const ANIMS = [
  ["none", "None"],
  ["scale-in", "Scale in"],
  ["scale-out", "Scale out"],
  ["scale-inout", "Scale in and out"],
  ["reveal", "Reveal (shape grows from 0)"],
  ["rotate", "Rotate (spin)"],
];
// Chromium records VP8/VP9 WebM with the canvas alpha; Firefox drops it and Safari records MP4.
const videoAlpha = canRecordAlpha();

let media = null;
let myShapes = loadMyShapes();
let box = { x: 0, y: 0, w: 1, h: 1, rot: 0 };
let keys = []; // { t (source seconds), x, y, w, h, rot }, sorted by t
const mt = { x: 0, y: 0 }; // media offset in source px (zoom is s.zoom)
let view = "edit"; // 'edit' | 'result'
let exportKind = null; // 'video' | 'gif' while those exports run
let drag = null;
let guides = {};
let lastEditView = null;
let rasterVersion = 0; // bumps when a custom shape image finishes loading
const demo = makeDemo();

function isVideo() {
  return media?.kind === "video";
}
function isImage() {
  return media?.kind === "image";
}
function isTransparent() {
  return s.bg === "transparent";
}
function src() {
  return media || demo;
}
function offset() {
  return isVideo() ? s.trimIn : 0;
}
/** Size unit: sliders are authored for a 1080 px short side of the source. */
function kS() {
  return Math.min(src().width, src().height) / 1080;
}
const rad = (d) => (d * Math.PI) / 180;
const even = (v) => Math.max(2, Math.round(v / 2) * 2);

/* ---------- Panel ---------- */

const shapeGrid = h("div", {
  class: "sc-shapes",
  role: "group",
  "aria-label": "Shapes",
});
const myGrid = h("div", {
  class: "sc-shapes",
  role: "group",
  "aria-label": "My shapes",
});
const pos = {};
const posGrid = h(
  "div",
  { class: "sc-pos" },
  [
    ["x", "X"],
    ["y", "Y"],
    ["w", "Width"],
    ["h", "Height"],
    ["rot", "Rotation °"],
  ].map(([k, label]) => {
    const input = h("input", { type: "number", step: 1, "aria-label": label });
    input.addEventListener("input", () => {
      if (input.value !== "" && isFinite(+input.value))
        numericEdit(k, +input.value);
    });
    pos[k] = input;
    return h("label", { class: "sc-pos-field" }, h("span", {}, label), input);
  }),
);
const fileInput = h("input", {
  type: "file",
  accept: ".svg,image/svg+xml,image/png,image/webp",
  multiple: true,
  hidden: true,
  onchange: onShapeFiles,
});
const pasteArea = h("textarea", {
  rows: 4,
  spellcheck: "false",
  placeholder: '<svg viewBox="0 0 100 100">…</svg>',
  "aria-label": "SVG code",
});
const customUi = h(
  "div",
  { class: "sc-custom" },
  h(
    "div",
    { class: "sc-row" },
    h("button", {
      type: "button",
      class: "btn btn-sm",
      html: `${icon("upload")} Upload SVG or PNG`,
      onclick: () => fileInput.click(),
    }),
    fileInput,
  ),
  h(
    "details",
    { class: "sc-paste" },
    h("summary", {}, "Paste SVG code"),
    pasteArea,
    h(
      "button",
      { type: "button", class: "btn btn-sm", onclick: addPasted },
      "Use this SVG",
    ),
  ),
  h("div", { class: "ctrl-label" }, h("span", {}, "My shapes")),
  myGrid,
  h(
    "div",
    { class: "ctrl-hint" },
    "Saved in this browser. The shape’s opacity is the mask, whatever its color. A PNG without transparency uses brightness instead (white keeps).",
  ),
);
const keyList = h("div", { class: "chips sc-keys" });
const keysUi = h(
  "div",
  { class: "sc-keyframes" },
  h(
    "div",
    { class: "sc-row" },
    h(
      "button",
      { type: "button", class: "btn btn-sm", onclick: addKeyframe },
      "+ Keyframe at playhead",
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-sm btn-ghost",
        onclick: clearKeyframes,
      },
      "Clear all",
    ),
  ),
  keyList,
  h(
    "div",
    { class: "ctrl-hint" },
    "Once there is a keyframe, moving or resizing the shape edits the keyframe at the playhead (adding one if needed). The shape glides between keyframes, so it can follow something that moves.",
  ),
);

const shapeParams = SHAPES.flatMap((shp) =>
  shp.params.flatMap((p) => {
    const id = `${shp.id}.${p.id}`;
    const showIf = (st) => st.shape === shp.id;
    const control = { ...p, id, showIf };
    return p.seed
      ? [
          control,
          {
            type: "button",
            text: "Randomize",
            showIf,
            onClick: () =>
              panel.set({ [id]: 1 + Math.floor(Math.random() * 998) }),
          },
        ]
      : [control];
  }),
);

const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Trim",
      showIf: () => isVideo(),
      controls: [
        {
          id: "trimIn",
          type: "range",
          label: "Start",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0,
          format: formatTime,
        },
        {
          id: "trimOut",
          type: "range",
          label: "End",
          min: 0,
          max: 1,
          step: 0.05,
          value: 1,
          format: formatTime,
          hint: "Only this part is previewed and exported.",
        },
      ],
    },
    {
      title: "Shape",
      controls: [
        { id: "shape", type: "custom", el: shapeGrid, value: "rect" },
        ...shapeParams,
        {
          id: "aspect",
          type: "presets",
          label: "Aspect ratio",
          value: "free",
          options: ASPECTS.map(([value, label]) => ({ value, label })),
        },
        {
          id: "invert",
          type: "toggle",
          label: "Invert (cut the shape out)",
          value: false,
        },
      ],
    },
    { title: "Custom shape", controls: [{ type: "custom", el: customUi }] },
    {
      title: "Position",
      controls: [
        {
          id: "mode",
          type: "segmented",
          label: "Dragging on the preview moves",
          value: "shape",
          options: [
            ["shape", "The shape"],
            ["media", "The media"],
          ],
          hint: "Media mode: drag to pan, scroll to zoom.",
        },
        { type: "custom", el: posGrid },
        {
          id: "lock",
          type: "toggle",
          label: "Lock aspect ratio",
          value: false,
          hint: "Shift flips the lock while resizing, and snaps rotation to 15°.",
        },
        { id: "snap", type: "toggle", label: "Snap to center", value: true },
        {
          id: "zoom",
          type: "range",
          label: "Media zoom",
          min: 10,
          max: 400,
          value: 100,
          unit: "%",
        },
        { type: "button", text: "Center shape", onClick: () => centerShape() },
        {
          type: "button",
          text: "Reset media position",
          onClick: () => resetMedia(),
        },
      ],
    },
    {
      title: "Style",
      controls: [
        {
          id: "outline",
          type: "range",
          label: "Outline",
          min: 0,
          max: 80,
          value: 0,
          unit: "px",
        },
        {
          id: "outlineColor",
          type: "color",
          label: "Outline color",
          value: "#ffffff",
          showIf: (st) => st.outline > 0,
        },
        {
          id: "outlinePos",
          type: "segmented",
          label: "Outline position",
          value: "center",
          options: [
            ["inside", "Inside"],
            ["center", "Center"],
            ["outside", "Outside"],
          ],
          showIf: (st) => st.outline > 0,
        },
        {
          id: "feather",
          type: "range",
          label: "Edge softness",
          min: 0,
          max: 120,
          value: 0,
          unit: "px",
        },
        { id: "shadow", type: "toggle", label: "Drop shadow", value: false },
        {
          id: "shadowColor",
          type: "color",
          label: "Shadow color",
          value: "#000000",
          showIf: (st) => st.shadow,
        },
        {
          id: "shadowOpacity",
          type: "range",
          label: "Shadow opacity",
          min: 0,
          max: 100,
          value: 55,
          unit: "%",
          showIf: (st) => st.shadow,
        },
        {
          id: "shadowBlur",
          type: "range",
          label: "Shadow blur",
          min: 0,
          max: 150,
          value: 40,
          unit: "px",
          showIf: (st) => st.shadow,
        },
        {
          id: "shadowX",
          type: "range",
          label: "Shadow X",
          min: -150,
          max: 150,
          value: 0,
          unit: "px",
          showIf: (st) => st.shadow,
        },
        {
          id: "shadowY",
          type: "range",
          label: "Shadow Y",
          min: -150,
          max: 150,
          value: 18,
          unit: "px",
          showIf: (st) => st.shadow,
        },
      ],
    },
    {
      title: "Background",
      controls: [
        {
          id: "bg",
          type: "segmented",
          label: "Outside the shape",
          value: "transparent",
          options: [
            ["transparent", "Transparent"],
            ["solid", "Color"],
            ["blur", "Blurred"],
          ],
        },
        {
          id: "bgColor",
          type: "color",
          label: "Color",
          value: "#14161c",
          showIf: (st) => st.bg === "solid",
        },
        {
          id: "bgBlur",
          type: "range",
          label: "Blur",
          min: 4,
          max: 120,
          value: 40,
          unit: "px",
          showIf: (st) => st.bg === "blur",
        },
        {
          id: "bgDim",
          type: "range",
          label: "Darken",
          min: 0,
          max: 80,
          value: 20,
          unit: "%",
          showIf: (st) => st.bg === "blur",
        },
        {
          id: "matte",
          type: "color",
          label: "Matte color",
          value: "#ffffff",
          showIf: (st) => st.bg === "transparent",
          hint: videoAlpha
            ? "GIF has no soft transparency, so soft edges are blended onto this color."
            : "GIF has no soft transparency, so soft edges are blended onto this color. This browser can’t record transparent video, so video exports use it as the background.",
        },
      ],
    },
    {
      title: "Output",
      controls: [
        {
          id: "output",
          type: "segmented",
          label: "Size",
          value: "tight",
          options: [
            ["tight", "Fit shape"],
            ["original", "Original frame"],
            ["custom", "Custom"],
          ],
          hint: "Fit shape crops to the shape’s bounding box (it follows keyframes).",
        },
        {
          id: "outW",
          type: "number",
          label: "Width (px)",
          min: 16,
          max: 4096,
          value: 1080,
          showIf: (st) => st.output === "custom",
        },
        {
          id: "outH",
          type: "number",
          label: "Height (px)",
          min: 16,
          max: 4096,
          value: 1080,
          showIf: (st) => st.output === "custom",
        },
        {
          id: "pad",
          type: "range",
          label: "Padding",
          min: 0,
          max: 400,
          value: 60,
          unit: "px",
          showIf: (st) => st.output === "custom",
        },
        {
          id: "clip",
          type: "range",
          label: "Clip length (images)",
          min: 1,
          max: 20,
          value: 4,
          unit: "s",
          showIf: () => !isVideo(),
        },
      ],
    },
    {
      title: "Animation",
      controls: [
        {
          id: "anim",
          type: "select",
          label: "Animate the shape",
          value: "none",
          options: ANIMS,
        },
        {
          id: "animDur",
          type: "range",
          label: "Duration",
          min: 0.2,
          max: 5,
          step: 0.1,
          value: 0.8,
          unit: "s",
          showIf: (st) => st.anim !== "none",
          hint: "For Rotate, the time of one full turn.",
        },
        {
          id: "animEase",
          type: "select",
          label: "Easing",
          value: "easeOut",
          options: easingOptions,
          showIf: (st) => st.anim !== "none",
        },
      ],
    },
    { title: "Keyframes", controls: [{ type: "custom", el: keysUi }] },
  ],
  { onChange },
);
const s = panel.state;

function onChange(st, id) {
  if (id === "aspect") applyAspect(st.aspect);
  if (id === "lock" && !st.lock && st.aspect !== "free")
    panel.set({ aspect: "free" }, { silent: true });
  if (id === "trimIn" || id === "trimOut") syncTrim(id);
  canvas.classList.toggle("checker", isTransparent());
  updateCursor();
  exportBar.refresh();
  stage.invalidate();
}

/* ---------- Shapes: built-in, custom, picker ---------- */

const isCustom = (shp) => shp.id.startsWith("custom:");
function shapeById(id) {
  return getShape(id) || myShapes.find((m) => m.id === id) || null;
}
function currentShape() {
  return shapeById(s.shape) || getShape("rect");
}
function paramsOf(shp) {
  return Object.fromEntries(
    (shp.params || []).map((p) => [p.id, s[`${shp.id}.${p.id}`]]),
  );
}
function shapeKey() {
  const shp = currentShape();
  return `${shp.id}|${JSON.stringify(paramsOf(shp))}|${rasterVersion}`;
}
function shapeRatio(shp) {
  return isCustom(shp) ? shp.w / shp.h : shp.aspect;
}

function paintGrids() {
  shapeGrid.replaceChildren(
    ...SHAPES.map((shp) => {
      const defaults = Object.fromEntries(
        shp.params.map((p) => [p.id, p.value]),
      );
      const d = shp.path(32, 32, defaults);
      return h("button", {
        type: "button",
        class: "sc-shape",
        title: shp.name,
        "aria-label": shp.name,
        "aria-pressed": String(s.shape === shp.id),
        html: `<svg viewBox="-4 -4 40 40" aria-hidden="true"><path d="${d}" fill="currentColor"/></svg>`,
        onclick: () => selectShape(shp.id),
      });
    }),
  );
  myGrid.replaceChildren(
    ...(myShapes.length
      ? myShapes.map((shp) =>
          h(
            "div",
            { class: "sc-shape-wrap" },
            h(
              "button",
              {
                type: "button",
                class: "sc-shape",
                title: shp.name,
                "aria-label": shp.name,
                "aria-pressed": String(s.shape === shp.id),
                onclick: () => selectShape(shp.id),
              },
              h("span", {
                class: `sc-mask-icon${shp.lum ? " is-lum" : ""}`,
                style: `--src:url("${shapeUrl(shp)}")`,
              }),
            ),
            h("button", {
              type: "button",
              class: "sc-del",
              title: `Delete ${shp.name}`,
              "aria-label": `Delete ${shp.name}`,
              html: icon("x"),
              onclick: () => deleteShape(shp),
            }),
          ),
        )
      : [h("div", { class: "sc-empty" }, "Nothing saved yet.")]),
  );
}

function selectShape(id) {
  const shp = shapeById(id);
  if (!shp) return;
  panel.set({ shape: id }, { silent: true });
  const ratio = shapeRatio(shp);
  if (ratio) {
    setRatio(ratio);
    panel.set({ lock: true, aspect: "free" }, { silent: true });
  } else if (s.aspect === "free") panel.set({ lock: false }, { silent: true });
  paintGrids();
  onChange(s, "shape");
}

function addCustom(shp) {
  myShapes = [shp, ...myShapes];
  if (!saveMyShapes(myShapes))
    toast(
      "Couldn’t save it to My shapes (browser storage is full or blocked). You can still use it now.",
      "warning",
      6000,
    );
  if (shp.lum)
    toast(
      "That image has no transparency, so its brightness is the mask: white keeps, black cuts.",
      "info",
      6000,
    );
  selectShape(shp.id);
}

function deleteShape(shp) {
  myShapes = myShapes.filter((m) => m.id !== shp.id);
  saveMyShapes(myShapes);
  forgetShape(shp);
  if (s.shape === shp.id) selectShape("rect");
  else paintGrids();
}

async function onShapeFiles() {
  for (const file of [...fileInput.files]) {
    try {
      addCustom(await shapeFromFile(file));
    } catch (err) {
      toast(err.message || "Couldn’t use that file.", "error");
    }
  }
  fileInput.value = "";
}

function addPasted() {
  if (!pasteArea.value.trim()) return toast("Paste some SVG code first.");
  try {
    addCustom(
      shapeFromSvg(pasteArea.value, `Pasted shape ${myShapes.length + 1}`),
    );
    pasteArea.value = "";
  } catch (err) {
    toast(err.message, "error");
  }
}

function onCustomReady() {
  rasterVersion++;
  stage.invalidate();
}

/** Shape geometry for a w×h box: { path, rule, d, transform? } for vector shapes, { shape } for raster masks. */
let geom = { key: "", g: null };
function geometry(w, hh) {
  const shp = currentShape();
  const key = `${shapeKey()}|${w}|${hh}`;
  if (geom.key === key) return geom.g;
  let g;
  if (isCustom(shp) && shp.path) {
    const [vx, vy, vw, vh] = shp.path.vb;
    const path = new Path2D();
    path.addPath(
      new Path2D(shp.path.d),
      new DOMMatrix().scale(w / vw, hh / vh).translate(-vx, -vy),
    );
    g = {
      path,
      rule: shp.path.rule,
      d: shp.path.d,
      transform: `scale(${w / vw} ${hh / vh}) translate(${-vx} ${-vy})`,
    };
  } else if (isCustom(shp)) {
    g = { shape: shp };
  } else {
    const d = shp.path(w, hh, paramsOf(shp));
    g = { path: new Path2D(d), rule: "nonzero", d };
  }
  geom = { key, g };
  return g;
}

/* ---------- Box, aspect, keyframes ---------- */

function defaultBox() {
  const M = src();
  return {
    x: M.width / 2,
    y: M.height / 2,
    w: M.width * 0.8,
    h: M.height * 0.8,
    rot: 0,
  };
}

/** The shape box at stage time t: interpolated keyframes, or the single box. */
function boxAt(t) {
  if (!keys.length) return box;
  const T = offset() + t;
  if (T <= keys[0].t) return keys[0];
  const last = keys[keys.length - 1];
  if (T >= last.t) return last;
  const i = keys.findIndex((k) => k.t > T) - 1;
  const a = keys[i],
    b = keys[i + 1],
    f = (T - a.t) / (b.t - a.t);
  return {
    x: lerp(a.x, b.x, f),
    y: lerp(a.y, b.y, f),
    w: lerp(a.w, b.w, f),
    h: lerp(a.h, b.h, f),
    rot: lerp(a.rot, b.rot, f),
  };
}
const plain = (b) => ({ x: b.x, y: b.y, w: b.w, h: b.h, rot: b.rot });

/** Apply an edited box: to the keyframe at the playhead when keyframes exist, else to the box. */
function commitBox(nb) {
  nb = {
    ...plain(nb),
    w: Math.max(MIN_SIZE, nb.w),
    h: Math.max(MIN_SIZE, nb.h),
  };
  if (keys.length) {
    const T = offset() + stage.time;
    const k = keys.find((key) => Math.abs(key.t - T) < KEY_EPS);
    if (k) Object.assign(k, nb);
    else {
      keys.push({ ...nb, t: T });
      keys.sort((a, b) => a.t - b.t);
      renderKeys();
    }
  } else box = nb;
  syncInputs();
  stage.invalidate();
}

/** Give the box (and every keyframe) the ratio r, keeping its area but fitting the source. */
function setRatio(r) {
  const M = src();
  for (const b of keys.length ? keys : [box]) {
    let w = Math.sqrt(b.w * b.h * r),
      hh = w / r;
    const f = Math.min(1, M.width / w, M.height / hh);
    w *= f;
    hh *= f;
    b.w = w;
    b.h = hh;
  }
  syncInputs();
  stage.invalidate();
}

function applyAspect(v) {
  if (v === "free") {
    panel.set({ lock: false }, { silent: true });
    return;
  }
  const [a, b] = v.split(":").map(Number);
  setRatio(a / b);
  panel.set({ lock: true }, { silent: true });
}

function numericEdit(k, v) {
  const b = plain(boxAt(stage.time));
  if (k === "x") b.x = v + b.w / 2;
  else if (k === "y") b.y = v + b.h / 2;
  else if (k === "rot") b.rot = v;
  else {
    const r = b.w / b.h;
    if (k === "w") {
      b.w = Math.max(MIN_SIZE, v);
      if (s.lock) b.h = b.w / r;
    } else {
      b.h = Math.max(MIN_SIZE, v);
      if (s.lock) b.w = b.h * r;
    }
  }
  commitBox(b);
}

function syncInputs() {
  const b = boxAt(stage.time);
  const vals = {
    x: b.x - b.w / 2,
    y: b.y - b.h / 2,
    w: b.w,
    h: b.h,
    rot: b.rot,
  };
  for (const [k, input] of Object.entries(pos))
    if (document.activeElement !== input) input.value = Math.round(vals[k]);
}

function centerShape() {
  const M = src();
  commitBox({ ...boxAt(stage.time), x: M.width / 2, y: M.height / 2 });
}

function resetMedia() {
  mt.x = 0;
  mt.y = 0;
  panel.set({ zoom: 100 });
}

function addKeyframe() {
  const T = offset() + stage.time;
  const b = plain(boxAt(stage.time));
  keys = keys.filter((k) => Math.abs(k.t - T) >= KEY_EPS);
  keys.push({ ...b, t: T });
  keys.sort((a, c) => a.t - c.t);
  renderKeys();
  stage.invalidate();
}

function removeKey(k) {
  if (keys.length === 1) box = plain(k);
  keys = keys.filter((x) => x !== k);
  renderKeys();
  exportBar.refresh();
  stage.invalidate();
}

function clearKeyframes() {
  if (!keys.length) return;
  box = plain(boxAt(stage.time));
  keys = [];
  renderKeys();
  stage.invalidate();
}

function renderKeys() {
  keyList.replaceChildren(
    ...keys.map((k) =>
      h(
        "span",
        { class: "chip sc-key", "data-t": k.t },
        h(
          "button",
          {
            type: "button",
            title: "Go to this keyframe",
            onclick: () => {
              stage.pause();
              stage.seek(clamp(k.t - offset(), 0, stage.duration));
            },
          },
          formatTime(k.t),
        ),
        h("button", {
          type: "button",
          class: "sc-key-x",
          "aria-label": `Remove keyframe at ${formatTime(k.t)}`,
          html: icon("x"),
          onclick: () => removeKey(k),
        }),
      ),
    ),
  );
  paintKeys();
}

function paintKeys() {
  const T = offset() + stage.time;
  for (const chip of keyList.children)
    chip.setAttribute(
      "aria-pressed",
      String(Math.abs(+chip.dataset.t - T) < KEY_EPS),
    );
}

/* ---------- Media + trim ---------- */

function resetLayout() {
  box = defaultBox();
  keys = [];
  mt.x = 0;
  mt.y = 0;
  panel.set({ zoom: 100 }, { silent: true });
  const ratio = shapeRatio(currentShape());
  if (ratio) setRatio(ratio);
  else if (s.aspect !== "free") applyAspect(s.aspect);
  renderKeys();
  syncInputs();
}

function setupTrim() {
  const D = media.duration;
  for (const id of ["trimIn", "trimOut"])
    document.getElementById(`c-${id}`).max = D;
  panel.set({ trimIn: 0, trimOut: D }, { silent: true });
}

function syncTrim(id) {
  if (!isVideo()) return;
  const D = media.duration;
  let a = clamp(s.trimIn, 0, D),
    b = clamp(s.trimOut, 0, D);
  if (b - a < 0.1) {
    if (id === "trimIn") {
      b = Math.min(D, a + 0.1);
      a = Math.min(a, b - 0.1);
    } else {
      a = Math.max(0, b - 0.1);
      b = Math.max(b, a + 0.1);
    }
  }
  panel.set({ trimIn: a, trimOut: b }, { silent: true });
  stage.pause();
  stage.seek(id === "trimOut" ? stage.duration : 0); // show the frame at the edge being edited
}

function mediaRect() {
  const M = src(),
    z = s.zoom / 100;
  return {
    x: M.width / 2 + mt.x - (M.width * z) / 2,
    y: M.height / 2 + mt.y - (M.height * z) / 2,
    w: M.width * z,
    h: M.height * z,
  };
}

/* ---------- Views ---------- */

/** Extra room around the shape for the outline, shadow and feather (source px). */
function margin() {
  const k = kS();
  let m = 0;
  if (s.outline > 0 && !s.invert)
    m +=
      s.outlinePos === "outside"
        ? s.outline * k
        : s.outlinePos === "center"
          ? (s.outline * k) / 2
          : 0;
  if (s.shadow)
    m +=
      (s.shadowBlur + Math.max(Math.abs(s.shadowX), Math.abs(s.shadowY))) * k;
  return m + s.feather * k * 0.5;
}

/** Largest bounding box the shape takes (across keyframes), so the output size never changes mid-clip. */
function extent() {
  const spin = s.anim === "rotate";
  let w = 0,
    hh = 0;
  for (const b of keys.length ? keys : [box]) {
    const c = Math.abs(Math.cos(rad(b.rot))),
      sn = Math.abs(Math.sin(rad(b.rot))),
      diag = Math.hypot(b.w, b.h);
    w = Math.max(w, spin ? diag : b.w * c + b.h * sn);
    hh = Math.max(hh, spin ? diag : b.w * sn + b.h * c);
  }
  const m = 2 * margin();
  return [Math.max(4, w + m), Math.max(4, hh + m)];
}

/** The export framing at time t. */
function resultView(t) {
  const M = src();
  if (s.output === "original") {
    const o = outputSize(M.width, M.height, 1920);
    return { cw: o.w, ch: o.h, sc: o.w / M.width, fx: 0, fy: 0 };
  }
  const [ew, eh] = extent(),
    b = boxAt(t);
  let cw, ch, sc;
  if (s.output === "custom") {
    cw = even(clamp(s.outW || 1080, 16, 4096));
    ch = even(clamp(s.outH || 1080, 16, 4096));
    const pad = Math.max(0, Math.min(s.pad, cw / 2 - 4, ch / 2 - 4));
    sc = Math.min((cw - 2 * pad) / ew, (ch - 2 * pad) / eh);
  } else {
    const o = outputSize(ew, eh, 1920);
    cw = Math.max(2, o.w);
    ch = Math.max(2, o.h);
    sc = Math.min(cw / ew, ch / eh);
  }
  return { cw, ch, sc, fx: b.x - cw / 2 / sc, fy: b.y - ch / 2 / sc };
}

/** The whole source plus a margin, for positioning. */
function editView() {
  const M = src(),
    pad = 0.06 * Math.max(M.width, M.height);
  const o = outputSize(M.width + 2 * pad, M.height + 2 * pad, 1600);
  return {
    cw: o.w,
    ch: o.h,
    sc: o.w / (M.width + 2 * pad),
    fx: -pad,
    fy: -pad,
  };
}

/* ---------- Animation ---------- */

/** { piece: scale of the whole cut-out, mask: { s, rot } applied to the shape only } */
function animAt(t) {
  const out = { piece: 1, mask: { s: 1, rot: 0 } };
  if (s.anim === "none") return out;
  const D = stage.duration,
    d = Math.max(
      0.05,
      Math.min(s.animDur, s.anim === "scale-inout" ? D / 2 : D),
    );
  const e = (x) => ease(s.animEase, x);
  const grow = e(t / d),
    shrink = 1 - e((t - (D - d)) / d);
  if (s.anim === "scale-in") out.piece = grow;
  else if (s.anim === "scale-out") out.piece = shrink;
  else if (s.anim === "scale-inout") out.piece = Math.min(grow, shrink);
  else if (s.anim === "reveal") out.mask.s = Math.max(1e-4, grow);
  else if (s.anim === "rotate") {
    const turns = t / d;
    out.mask.rot = 360 * (Math.floor(turns) + e(turns % 1));
  }
  out.piece = Math.max(0, out.piece);
  return out;
}

/* ---------- Rendering ---------- */

function drawMedia(c, v, pad = 0) {
  const r = mediaRect();
  c.setTransform(v.sc, 0, 0, v.sc, -v.fx * v.sc + pad, -v.fy * v.sc + pad);
  c.imageSmoothingQuality = "high";
  c.drawImage(src().el, r.x, r.y, r.w, r.h);
  c.setTransform(1, 0, 0, 1, 0, 0);
}

/** Scene → canvas, then into the shape's own box (0..w, 0..h). */
function shapeTransform(c, v, b, ma) {
  c.setTransform(v.sc, 0, 0, v.sc, -v.fx * v.sc, -v.fy * v.sc);
  c.translate(b.x, b.y);
  c.rotate(rad(b.rot + ma.rot));
  c.scale(ma.s, ma.s);
  c.translate(-b.w / 2, -b.h / 2);
}

/** The shape filled white with hard edges (no feather, no invert). */
function drawHard(c, v, b, ma) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, v.cw, v.ch);
  const g = geometry(b.w, b.h);
  c.save();
  shapeTransform(c, v, b, ma);
  c.fillStyle = "#fff";
  if (g.path) c.fill(g.path, g.rule);
  else {
    const r = rasterMask(g.shape, b.w * v.sc, b.h * v.sc, onCustomReady);
    if (r) c.drawImage(r, 0, 0, b.w, b.h);
  }
  c.restore();
}

/**
 * The alpha mask for a view (feathered, inverted), cached per slot ('res' / 'edit'):
 * it is only rebuilt when the shape, its box, the view or the mask settings change.
 */
const masks = {};
function buildMask(slot, v, b, ma) {
  const key = JSON.stringify([
    v,
    b.x,
    b.y,
    b.w,
    b.h,
    b.rot,
    ma,
    shapeKey(),
    s.feather,
    s.invert,
  ]);
  if (masks[slot]?.key === key) return masks[slot];
  const hard = scratch(`sc-hard-${slot}`, v.cw, v.ch);
  drawHard(hard.getContext("2d"), v, b, ma);
  const mask = scratch(`sc-mask-${slot}`, v.cw, v.ch),
    mc = mask.getContext("2d");
  mc.setTransform(1, 0, 0, 1, 0, 0);
  mc.globalCompositeOperation = "source-over";
  mc.clearRect(0, 0, v.cw, v.ch);
  if (s.invert) {
    mc.fillStyle = "#fff";
    mc.fillRect(0, 0, v.cw, v.ch);
    mc.globalCompositeOperation = "destination-out";
  }
  const blur = s.feather * kS() * v.sc * 0.5;
  if (blur > 0.5) drawBlurred(mc, hard, 0, 0, v.cw, v.ch, blur);
  else mc.drawImage(hard, 0, 0);
  mc.globalCompositeOperation = "source-over";
  masks[slot] = { key, mask, hard };
  return masks[slot];
}

function inverseOf(c, name, w, hh) {
  const o = scratch(name, w, hh),
    oc = o.getContext("2d");
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.globalCompositeOperation = "source-over";
  oc.fillStyle = "#fff";
  oc.fillRect(0, 0, w, hh);
  oc.globalCompositeOperation = "destination-out";
  oc.drawImage(c, 0, 0);
  oc.globalCompositeOperation = "source-over";
  return o;
}

/** Dilate an alpha canvas by r px (stamps on three rings), for outlines of raster shapes. */
function grow(c, r, name, w, hh) {
  const o = scratch(name, w, hh),
    oc = o.getContext("2d");
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.clearRect(0, 0, w, hh);
  oc.drawImage(c, 0, 0);
  for (const f of [1, 0.66, 0.33]) {
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      oc.drawImage(c, Math.cos(a) * r * f, Math.sin(a) * r * f);
    }
  }
  return o;
}

/** Outline band for raster (custom image) shapes: dilate / erode the hard mask. Cached with the mask. */
function rasterOutline(slot, v, mk, px, where) {
  const key = `${mk.key}|${px}|${where}|${s.outlineColor}`;
  if (mk.outlineKey === key) return mk.outline;
  const { cw, ch } = v,
    n = (x) => `sc-ol-${x}-${slot}`;
  const kept = s.invert ? inverseOf(mk.hard, n("kept"), cw, ch) : mk.hard;
  const outer =
    where === "inside"
      ? kept
      : grow(kept, where === "center" ? px / 2 : px, n("outer"), cw, ch);
  const notKept = inverseOf(kept, n("not"), cw, ch);
  const innerInv =
    where === "outside"
      ? notKept
      : grow(notKept, where === "center" ? px / 2 : px, n("inner"), cw, ch);
  const band = scratch(n("band"), cw, ch),
    bc = band.getContext("2d");
  bc.setTransform(1, 0, 0, 1, 0, 0);
  bc.globalCompositeOperation = "source-over";
  bc.clearRect(0, 0, cw, ch);
  bc.drawImage(outer, 0, 0);
  bc.globalCompositeOperation = "destination-in";
  bc.drawImage(innerInv, 0, 0);
  bc.globalCompositeOperation = "source-in";
  bc.fillStyle = s.outlineColor;
  bc.fillRect(0, 0, cw, ch);
  bc.globalCompositeOperation = "source-over";
  Object.assign(mk, { outline: band, outlineKey: key });
  return band;
}

function drawOutline(c, slot, v, b, ma, mk) {
  if (!(s.outline > 0)) return;
  const wS = s.outline * kS();
  let where = s.outlinePos;
  if (s.invert && where !== "center")
    where = where === "inside" ? "outside" : "inside"; // the kept side flips
  const g = geometry(b.w, b.h);
  c.save();
  if (g.path) {
    shapeTransform(c, v, b, ma);
    c.strokeStyle = s.outlineColor;
    c.lineJoin = "round";
    c.lineWidth = where === "center" ? wS : wS * 2;
    if (where === "inside") c.clip(g.path, g.rule);
    else if (where === "outside") {
      const outside = new Path2D();
      outside.rect(-1e5, -1e5, 2e5, 2e5);
      outside.addPath(g.path);
      c.clip(outside, "evenodd");
    }
    c.stroke(g.path);
  } else {
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.drawImage(rasterOutline(slot, v, mk, wS * v.sc * ma.s, where), 0, 0);
  }
  c.restore();
}

const rgba = (hex, a) => {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/** One frame of the effect for view v. `edit` dims the outside instead of applying the background. */
function composite(c, slot, v, t, edit = false) {
  const { cw, ch } = v,
    k = kS();
  const b = boxAt(t),
    an = animAt(t);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, cw, ch);

  const content = scratch(`sc-content-${slot}`, cw, ch),
    cc = content.getContext("2d");
  cc.setTransform(1, 0, 0, 1, 0, 0);
  cc.clearRect(0, 0, cw, ch);
  drawMedia(cc, v);

  // Background (outside the shape)
  if (edit) {
    c.drawImage(content, 0, 0);
    c.fillStyle = "rgba(8,10,14,.62)";
    c.fillRect(0, 0, cw, ch);
  } else if (
    s.bg === "solid" ||
    (exportKind === "video" && !videoAlpha && isTransparent())
  ) {
    c.fillStyle = s.bg === "solid" ? s.bgColor : s.matte;
    c.fillRect(0, 0, cw, ch);
  } else if (s.bg === "blur") {
    const r = s.bgBlur * k * v.sc,
      p = Math.ceil(r * 2);
    const wide = scratch(`sc-bg-${slot}`, cw + 2 * p, ch + 2 * p),
      wc = wide.getContext("2d");
    wc.setTransform(1, 0, 0, 1, 0, 0);
    wc.clearRect(0, 0, wide.width, wide.height);
    drawMedia(wc, v, p); // drawn wider than the frame so the blur doesn't fade at the edges
    drawBlurred(c, wide, -p, -p, cw + 2 * p, ch + 2 * p, r);
    if (s.bgDim) {
      c.fillStyle = `rgba(0,0,0,${s.bgDim / 100})`;
      c.fillRect(0, 0, cw, ch);
    }
  }

  // The cut-out (+ outline), as one layer so the shadow and scale animation include both
  const mk = buildMask(slot, v, b, an.mask);
  if (an.piece <= 0.001) return;
  const piece = scratch(`sc-piece-${slot}`, cw, ch),
    pc = piece.getContext("2d");
  pc.setTransform(1, 0, 0, 1, 0, 0);
  pc.globalCompositeOperation = "source-over";
  pc.clearRect(0, 0, cw, ch);
  pc.drawImage(content, 0, 0);
  pc.globalCompositeOperation = "destination-in";
  pc.drawImage(mk.mask, 0, 0);
  pc.globalCompositeOperation = "source-over";
  drawOutline(pc, slot, v, b, an.mask, mk);

  const ps = an.piece,
    cx = (b.x - v.fx) * v.sc,
    cy = (b.y - v.fy) * v.sc;
  c.save();
  c.translate(cx, cy);
  c.scale(ps, ps);
  c.translate(-cx, -cy);
  if (s.shadow) {
    // shadow lengths ignore the transform, so scale them by hand
    c.shadowColor = rgba(s.shadowColor, s.shadowOpacity / 100);
    c.shadowBlur = s.shadowBlur * k * v.sc * ps;
    c.shadowOffsetX = s.shadowX * k * v.sc * ps;
    c.shadowOffsetY = s.shadowY * k * v.sc * ps;
  }
  c.drawImage(piece, 0, 0);
  c.restore();
}

/**
 * GIF has 1-bit alpha: the encoder makes pixels under 50% alpha clear and the rest opaque.
 * Pre-blend soft pixels with the matte (alpha kept), so opaque edge pixels get the matte's color
 * instead of a dark fringe. Composited on the GPU: matte, then the frame over it, then cut back to the frame's alpha.
 */
function matteEdges(c, w, hh, color) {
  const o = scratch("sc-matte", w, hh),
    oc = o.getContext("2d");
  oc.setTransform(1, 0, 0, 1, 0, 0);
  oc.globalCompositeOperation = "source-over";
  oc.fillStyle = color;
  oc.fillRect(0, 0, w, hh);
  oc.drawImage(c.canvas, 0, 0);
  oc.globalCompositeOperation = "destination-in";
  oc.drawImage(c.canvas, 0, 0);
  oc.globalCompositeOperation = "source-over";
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, w, hh);
  c.drawImage(o, 0, 0);
}

function render(t) {
  const v = resultView(t);
  if (canvas.width !== v.cw || canvas.height !== v.ch) {
    canvas.width = v.cw;
    canvas.height = v.ch;
  }
  composite(ctx, "res", v, t);
  if (exportKind === "gif" && isTransparent())
    matteEdges(ctx, v.cw, v.ch, s.matte);
  if (view === "edit" && !exportKind) renderEditor(t);
}

/* ---------- Editor: handles and dragging ---------- */

function renderEditor(t) {
  const v = editView();
  if (editor.width !== v.cw || editor.height !== v.ch) {
    editor.width = v.cw;
    editor.height = v.ch;
  }
  lastEditView = v;
  composite(ectx, "edit", v, t, true);
  drawHandles(v, t);
}

const cssScale = () =>
  editor.width / (editor.getBoundingClientRect().width || editor.width);
const toEditor = (v, x, y) => [(x - v.fx) * v.sc, (y - v.fy) * v.sc];
const accent = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue("--accent")
    .trim() || "#7c6cff";

function drawHandles(v, t) {
  const c = ectx,
    px = cssScale(),
    M = src();
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.save();
  // Export frame
  if (s.output !== "original") {
    const r = resultView(t);
    const [x0, y0] = toEditor(v, r.fx, r.fy);
    c.setLineDash([6 * px, 5 * px]);
    c.strokeStyle = "rgba(255,255,255,.55)";
    c.lineWidth = px;
    c.strokeRect(x0, y0, (r.cw / r.sc) * v.sc, (r.ch / r.sc) * v.sc);
    c.setLineDash([]);
  }
  // Snap guides
  c.strokeStyle = accent();
  c.lineWidth = px;
  if (guides.x) {
    const [gx] = toEditor(v, M.width / 2, 0);
    c.beginPath();
    c.moveTo(gx, 0);
    c.lineTo(gx, v.ch);
    c.stroke();
  }
  if (guides.y) {
    const [, gy] = toEditor(v, 0, M.height / 2);
    c.beginPath();
    c.moveTo(0, gy);
    c.lineTo(v.cw, gy);
    c.stroke();
  }
  if (s.mode === "shape") {
    const b = boxAt(t),
      [cx, cy] = toEditor(v, b.x, b.y),
      w = b.w * v.sc,
      hh = b.h * v.sc;
    c.translate(cx, cy);
    c.rotate(rad(b.rot));
    c.strokeStyle = "rgba(0,0,0,.45)";
    c.lineWidth = 3 * px;
    c.strokeRect(-w / 2, -hh / 2, w, hh);
    c.strokeStyle = "#fff";
    c.lineWidth = 1.25 * px;
    c.strokeRect(-w / 2, -hh / 2, w, hh);
    const rot = -hh / 2 - 26 * px;
    c.beginPath();
    c.moveTo(0, -hh / 2);
    c.lineTo(0, rot);
    c.stroke();
    c.fillStyle = "#fff";
    c.strokeStyle = accent();
    c.lineWidth = 2 * px;
    c.beginPath();
    c.arc(0, rot, 6 * px, 0, Math.PI * 2);
    c.fill();
    c.stroke();
    const hs = 9 * px;
    for (const hx of [-1, 0, 1])
      for (const hy of [-1, 0, 1]) {
        if (!hx && !hy) continue;
        c.fillRect((hx * w) / 2 - hs / 2, (hy * hh) / 2 - hs / 2, hs, hs);
        c.strokeRect((hx * w) / 2 - hs / 2, (hy * hh) / 2 - hs / 2, hs, hs);
      }
  }
  c.restore();
}

function toScene(e) {
  const r = editor.getBoundingClientRect(),
    v = lastEditView;
  const px = ((e.clientX - r.left) / r.width) * editor.width,
    py = ((e.clientY - r.top) / r.height) * editor.height;
  return { x: px / v.sc + v.fx, y: py / v.sc + v.fy };
}

/** What's under scene point p: rotate handle, a resize handle, the box, or nothing. */
function hitTest(p) {
  const v = lastEditView,
    b = boxAt(stage.time),
    px = cssScale();
  const tol = (10 * px) / v.sc;
  const a = rad(b.rot),
    dx = p.x - b.x,
    dy = p.y - b.y;
  const qx = dx * Math.cos(a) + dy * Math.sin(a),
    qy = -dx * Math.sin(a) + dy * Math.cos(a);
  if (Math.hypot(qx, qy - (-b.h / 2 - (26 * px) / v.sc)) < tol * 1.2)
    return { type: "rotate" };
  for (const hx of [-1, 1, 0])
    for (const hy of [-1, 1, 0]) {
      if (!hx && !hy) continue;
      if (
        Math.abs(qx - (hx * b.w) / 2) < tol &&
        Math.abs(qy - (hy * b.h) / 2) < tol
      )
        return { type: "resize", hx, hy };
    }
  if (Math.abs(qx) <= b.w / 2 && Math.abs(qy) <= b.h / 2)
    return { type: "move" };
  return null;
}

const RESIZE_CURSORS = ["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"];
function updateCursor(e) {
  let cur = "crosshair";
  if (s.mode === "media") cur = drag ? "grabbing" : "grab";
  else if (drag)
    cur =
      drag.type === "move"
        ? "move"
        : drag.type === "rotate"
          ? "grabbing"
          : editor.style.cursor;
  else if (e && lastEditView) {
    const hit = hitTest(toScene(e));
    if (hit?.type === "move") cur = "move";
    else if (hit?.type === "rotate") cur = "grab";
    else if (hit?.type === "resize") {
      const deg =
        ((((Math.atan2(hit.hy, hit.hx) * 180) / Math.PI +
          boxAt(stage.time).rot) %
          180) +
          180) %
        180;
      cur = RESIZE_CURSORS[Math.round(deg / 45) % 4];
    }
  }
  editor.style.cursor = cur;
}

function resizeBox(b, d, p, lock) {
  const b0 = d.b0,
    a = rad(b0.rot),
    cos = Math.cos(a),
    sin = Math.sin(a);
  const dx = p.x - b0.x,
    dy = p.y - b0.y;
  const qx = dx * cos + dy * sin,
    qy = -dx * sin + dy * cos; // pointer in the box's frame
  const ax = (-d.hx * b0.w) / 2,
    ay = (-d.hy * b0.h) / 2; // the side/corner that stays put
  let w = d.hx ? Math.max(MIN_SIZE, d.hx * (qx - ax)) : b0.w;
  let hh = d.hy ? Math.max(MIN_SIZE, d.hy * (qy - ay)) : b0.h;
  if (lock) {
    const r = b0.w / b0.h;
    if (d.hx && d.hy) {
      const f = Math.max(w / b0.w, hh / b0.h);
      w = b0.w * f;
      hh = b0.h * f;
    } else if (d.hx) hh = w / r;
    else w = hh * r;
  }
  const lx = d.hx ? ax + (d.hx * w) / 2 : 0,
    ly = d.hy ? ay + (d.hy * hh) / 2 : 0;
  Object.assign(b, {
    w,
    h: hh,
    x: b0.x + lx * cos - ly * sin,
    y: b0.y + lx * sin + ly * cos,
  });
}

editor.addEventListener("pointerdown", (e) => {
  if (e.button !== 0 || !lastEditView) return;
  const p = toScene(e);
  if (s.mode === "media") drag = { type: "media", start: p, x: mt.x, y: mt.y };
  else
    drag = {
      ...(hitTest(p) || { type: "draw" }),
      start: p,
      b0: plain(boxAt(stage.time)),
    };
  if (keys.length) stage.pause(); // edits land on the keyframe at the playhead, so hold still
  editor.setPointerCapture(e.pointerId);
  e.preventDefault();
  updateCursor(e);
});

editor.addEventListener("pointermove", (e) => {
  if (!drag) {
    updateCursor(e);
    return;
  }
  const p = toScene(e),
    M = src(),
    v = lastEditView;
  const tol = (8 * cssScale()) / v.sc;
  const dx = p.x - drag.start.x,
    dy = p.y - drag.start.y;
  guides = {};
  if (drag.type === "media") {
    let x = drag.x + dx,
      y = drag.y + dy;
    if (s.snap) {
      if (Math.abs(x) < tol) {
        x = 0;
        guides.x = true;
      }
      if (Math.abs(y) < tol) {
        y = 0;
        guides.y = true;
      }
    }
    mt.x = x;
    mt.y = y;
    stage.invalidate();
    return;
  }
  const b = { ...drag.b0 };
  const lock = !!s.lock !== e.shiftKey;
  if (drag.type === "move") {
    b.x += dx;
    b.y += dy;
    if (s.snap) {
      if (Math.abs(b.x - M.width / 2) < tol) {
        b.x = M.width / 2;
        guides.x = true;
      }
      if (Math.abs(b.y - M.height / 2) < tol) {
        b.y = M.height / 2;
        guides.y = true;
      }
    }
  } else if (drag.type === "rotate") {
    let a = (Math.atan2(p.y - b.y, p.x - b.x) * 180) / Math.PI + 90;
    a += 360 * Math.round((drag.b0.rot - a) / 360); // stay continuous with the start angle
    if (e.shiftKey) a = Math.round(a / 15) * 15;
    else if (s.snap && Math.abs(a - Math.round(a / 90) * 90) < 2)
      a = Math.round(a / 90) * 90;
    b.rot = Math.round(a * 10) / 10;
  } else if (drag.type === "resize") {
    resizeBox(b, drag, p, lock);
  } else {
    // draw a new box from the press point
    if (Math.abs(dx) < tol && Math.abs(dy) < tol) return;
    let w = Math.abs(dx),
      hh = Math.abs(dy);
    if (lock) hh = w / (drag.b0.w / drag.b0.h);
    Object.assign(b, {
      rot: 0,
      w,
      h: hh,
      x: drag.start.x + (Math.sign(dx) * w) / 2,
      y: drag.start.y + ((Math.sign(dy) || 1) * hh) / 2,
    });
  }
  commitBox(b);
});

function endDrag() {
  if (!drag) return;
  drag = null;
  guides = {};
  updateCursor();
  exportBar.refresh();
  stage.invalidate();
}
editor.addEventListener("pointerup", endDrag);
editor.addEventListener("pointercancel", endDrag);

editor.addEventListener(
  "wheel",
  (e) => {
    if (s.mode !== "media" || !lastEditView) return;
    e.preventDefault();
    const p = toScene(e),
      M = src();
    const z0 = s.zoom / 100,
      z1 = clamp(z0 * Math.exp(-e.deltaY * 0.0015), 0.1, 4);
    const cx = M.width / 2 + mt.x,
      cy = M.height / 2 + mt.y;
    // Zoom around the pointer: the media point under it stays under it.
    mt.x = p.x - ((p.x - cx) * z1) / z0 - M.width / 2;
    mt.y = p.y - ((p.y - cy) * z1) / z0 - M.height / 2;
    panel.set({ zoom: Math.round(z1 * 100) }, { silent: true });
    stage.invalidate();
  },
  { passive: false },
);

/* ---------- Preview: Edit / Result ---------- */

const viewButtons = [
  ["edit", "Edit"],
  ["result", "Result"],
].map(([v, label]) =>
  h(
    "button",
    { type: "button", "data-v": v, onclick: () => setView(v) },
    label,
  ),
);
const viewHint = h("span", { class: "sc-view-hint" });
document
  .getElementById("viewbar")
  .append(
    h(
      "div",
      { class: "segmented", role: "group", "aria-label": "Preview" },
      viewButtons,
    ),
    viewHint,
  );

function setView(v) {
  view = v;
  viewButtons.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.v === v)),
  );
  canvas.hidden = v === "edit";
  editor.hidden = v !== "edit";
  viewHint.textContent =
    v === "edit"
      ? "Drag the shape, its handles or the round rotation handle. Drag outside it to draw a new box."
      : "Exactly what gets exported.";
  stage.invalidate();
}

/* ---------- Upload, stage, export ---------- */

createDropzone(document.getElementById("upload"), {
  accept: ["video", "image"],
  onLoad: (m) => {
    media = m;
    if (isVideo()) setupTrim();
    resetLayout();
    overlay.hidden = true;
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    if (isVideo()) stage.play().catch(() => {});
  },
  onClear: () => {
    media = null;
    resetLayout();
    showDemoNote();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
  },
});

const stage = createStage({
  canvas,
  transport: document.getElementById("transport"),
  render,
  getDuration: () => (isVideo() ? Math.max(0.1, s.trimOut - s.trimIn) : s.clip),
  getVideo: () => (isVideo() ? media.el : null),
  getVideoOffset: () => (isVideo() ? s.trimIn : 0),
});
stage.events.addEventListener("tick", () => {
  if (keys.length) {
    syncInputs();
    paintKeys();
  }
});

const filename = () =>
  `${(media?.name || "shape-crop").replace(/\.[^.]+$/, "")}-shape-crop`;
let savedView = view;

const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  hint: () =>
    isTransparent()
      ? `${TRANSPARENT_HINT}${videoAlpha ? "" : " Video export here uses the matte color as the background."}`
      : "",
  actions: [
    {
      label: "Export SVG",
      icon: "image",
      onClick: exportSVG,
      show: () => isImage(),
    },
  ],
  beforeExport: (kind) => {
    exportKind = kind;
    savedView = view;
    setView("result");
    if (kind === "video" && isTransparent() && !videoAlpha) {
      toast(
        "This browser can’t record transparent video, so the matte color is used as the background. Use Chrome or Edge for a transparent WebM.",
        "warning",
        7000,
      );
    }
  },
  afterExport: () => {
    exportKind = null;
    setView(savedView);
  },
});

/* ---------- SVG export (images) ---------- */

const esc = (v) =>
  String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/"/g, "&quot;");
const f3 = (v) => +v.toFixed(3);
const blobToDataUrl = (blob) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Couldn’t read the image."));
    r.readAsDataURL(blob);
  });

/** The image embedded once, clipped by the shape as a vector clipPath (or a mask image when feathered, inverted or a raster shape). */
async function exportSVG() {
  if (!isImage()) return;
  try {
    const t = stage.time,
      v = resultView(t),
      b = boxAt(t),
      an = animAt(t),
      k = kS();
    const href = await blobToDataUrl(await (await fetch(media.url)).blob());
    const r = mediaRect(),
      g = geometry(b.w, b.h);
    const viewT = `matrix(${f3(v.sc)} 0 0 ${f3(v.sc)} ${f3(-v.fx * v.sc)} ${f3(-v.fy * v.sc)})`;
    const shapeT = `${viewT} translate(${f3(b.x)} ${f3(b.y)}) rotate(${f3(b.rot + an.mask.rot)}) scale(${f3(an.mask.s)}) translate(${f3(-b.w / 2)} ${f3(-b.h / 2)})${g.transform ? ` ${g.transform}` : ""}`;
    const vector = !!g.path && !s.invert && !(s.feather > 0);
    const size = `width="${v.cw}" height="${v.ch}"`;
    const image = (attrs = "") =>
      `<image href="${href}" x="${f3(r.x)}" y="${f3(r.y)}" width="${f3(r.w)}" height="${f3(r.h)}" preserveAspectRatio="none" transform="${viewT}"${attrs}/>`;
    const pathEl = (attrs) =>
      `<path d="${esc(g.d)}" transform="${shapeT}" ${attrs}/>`;
    const defs = [],
      body = [];

    if (s.bg === "solid") body.push(`<rect ${size} fill="${s.bgColor}"/>`);
    else if (s.bg === "blur") {
      defs.push(
        `<filter id="bg-blur" x="-10%" y="-10%" width="120%" height="120%"><feGaussianBlur stdDeviation="${f3(s.bgBlur * k * v.sc)}"/></filter>`,
      );
      body.push(`<g filter="url(#bg-blur)">${image()}</g>`);
      if (s.bgDim)
        body.push(
          `<rect ${size} fill="#000" fill-opacity="${s.bgDim / 100}"/>`,
        );
    }

    let clip;
    if (vector) {
      defs.push(
        `<clipPath id="shape">${pathEl(`clip-rule="${g.rule}"`)}</clipPath>`,
      );
      clip = 'clip-path="url(#shape)"';
    } else {
      // white + alpha mask image: as a luminance mask, white keeps and clear cuts
      const mk = buildMask("res", v, b, an.mask);
      defs.push(
        `<mask id="shape" maskUnits="userSpaceOnUse" x="0" y="0" ${size}><image href="${mk.mask.toDataURL("image/png")}" ${size}/></mask>`,
      );
      clip = 'mask="url(#shape)"';
    }
    const piece = [`<g ${clip}>${image()}</g>`];

    if (s.outline > 0) {
      let where = s.outlinePos;
      if (s.invert && where !== "center")
        where = where === "inside" ? "outside" : "inside";
      const w = s.outline * k * v.sc * an.mask.s;
      if (vector) {
        const stroke = (sw) =>
          pathEl(
            `fill="none" stroke="${s.outlineColor}" stroke-width="${f3(sw)}" stroke-linejoin="round" vector-effect="non-scaling-stroke"`,
          );
        if (where === "center") piece.push(stroke(w));
        else if (where === "inside")
          piece.push(`<g ${clip}>${stroke(w * 2)}</g>`);
        else piece.unshift(stroke(w * 2)); // under the image, so only the outer half shows
      } else {
        const oc = scratch("sc-svg-outline", v.cw, v.ch),
          ox = oc.getContext("2d");
        ox.setTransform(1, 0, 0, 1, 0, 0);
        ox.clearRect(0, 0, v.cw, v.ch);
        drawOutline(ox, "res", v, b, an.mask, buildMask("res", v, b, an.mask));
        piece.push(`<image href="${oc.toDataURL("image/png")}" ${size}/>`);
      }
    }

    let group = piece.join("");
    if (s.shadow) {
      defs.push(
        `<filter id="shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${f3(s.shadowX * k * v.sc)}" dy="${f3(s.shadowY * k * v.sc)}" stdDeviation="${f3((s.shadowBlur * k * v.sc) / 2)}" flood-color="${s.shadowColor}" flood-opacity="${s.shadowOpacity / 100}"/></filter>`,
      );
      group = `<g filter="url(#shadow)">${group}</g>`;
    }
    if (an.piece !== 1) {
      const cx = f3((b.x - v.fx) * v.sc),
        cy = f3((b.y - v.fy) * v.sc);
      group = `<g transform="translate(${cx} ${cy}) scale(${f3(an.piece)}) translate(${-cx} ${-cy})">${group}</g>`;
    }
    body.push(group);

    const svg = `<svg xmlns="http://www.w3.org/2000/svg" ${size} viewBox="0 0 ${v.cw} ${v.ch}">${defs.length ? `<defs>${defs.join("")}</defs>` : ""}${body.join("")}</svg>`;
    const blob = new Blob([svg], { type: "image/svg+xml" });
    downloadBlob(blob, `${filename()}.svg`);
    toast(`Saved ${filename()}.svg (${formatBytes(blob.size)})`, "success");
  } catch (err) {
    console.error(err);
    toast(err.message || "SVG export failed.", "error");
  }
}

/* ---------- Demo picture (before any upload) ---------- */

function makeDemo() {
  const c = document.createElement("canvas");
  c.width = 1280;
  c.height = 800;
  const g = c.getContext("2d");
  const sky = g.createLinearGradient(0, 0, 0, 800);
  sky.addColorStop(0, "#2b3a8f");
  sky.addColorStop(0.55, "#e0748b");
  sky.addColorStop(1, "#f6c48a");
  g.fillStyle = sky;
  g.fillRect(0, 0, 1280, 800);
  g.fillStyle = "#ffe6a8";
  g.beginPath();
  g.arc(820, 430, 120, 0, Math.PI * 2);
  g.fill();
  const hill = (color, base, amp, phase) => {
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(0, 800);
    for (let x = 0; x <= 1280; x += 16)
      g.lineTo(
        x,
        base +
          Math.sin(x / 210 + phase) * amp +
          Math.sin(x / 77 + phase * 2) * amp * 0.25,
      );
    g.lineTo(1280, 800);
    g.fill();
  };
  hill("#6b3d73", 520, 40, 1);
  hill("#3e2756", 600, 34, 2.4);
  hill("#1d1633", 690, 26, 4);
  return { kind: "image", el: c, width: 1280, height: 800, duration: 0 };
}

function showDemoNote() {
  overlay.hidden = false;
  overlay.classList.add("is-note");
  overlay.innerHTML =
    "<div><strong>Demo picture.</strong> Drop a video or image on the left to crop your own.</div>";
}

/* ---------- Start ---------- */
paintGrids();
resetLayout();
renderKeys();
showDemoNote();
setView("edit");
canvas.classList.toggle("checker", isTransparent());
