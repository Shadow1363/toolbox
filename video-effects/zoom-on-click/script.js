/*
 * Zoom on Click: smooth automatic zooms on screen recordings, framed with the Screen Showcase styles.

 *
 * Zoom points come from a click log (Screen Recorder hand-off or an imported .json), clicks on the
 * preview, or auto-suggestions. camera.js turns them into keyframes; render(t) samples the camera,
 * crops the recording (with optional motion blur and a click ring), then frames it with lib/showcase-frame.js.
 * Markers are drawn on a separate overlay canvas, so they never appear in an export.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { createDropzone } from "/assets/js/lib/upload.js";
import { createStage } from "/assets/js/lib/stage.js";
import {
  createExportBar,
  progressModal,
  TRANSPARENT_HINT,
} from "/assets/js/lib/exporter.js";
import { outputSize, scratch, roundRectPath } from "/assets/js/lib/canvas.js";
import { easingOptions, easings, clamp } from "/assets/js/lib/easing.js";
import { seekVideo } from "/assets/js/lib/media.js";
import { fontString } from "/assets/js/lib/fonts.js";
import { h, icon, toast, formatTime, store } from "/assets/js/lib/dom.js";
import { takeFile } from "/assets/js/lib/handoff.js";
import {
  backgroundSection,
  frameSection,
  drawShowcaseBackground,
  fitInFrame,
  buildFrameCard,
  drawCardShadow,
  mediaOffset,
} from "/assets/js/lib/showcase-frame.js";
import {
  FULL,
  buildKeyframes,
  cameraAt,
  viewRect,
  suggestZooms,
  parseClickLog,
} from "./camera.js";

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const marks = document.getElementById("marks");
const mctx = marks.getContext("2d");
const overlay = document.getElementById("overlay");
const timelineEl = document.getElementById("timeline");

const SIZES = {
  source: null,
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};
const RING_TIME = 0.7;
const POINT_IDS = ["pZoom", "pDur", "pHold", "pEasing"];

let media = null;
let points = [];
let selectedId = null;
let keys = [FULL];
let sessions = [];
let showZoom = true;
let nextId = 1;
let pendingClicks = null;

/* ---------- Points list + tools (custom panel elements) ---------- */
const listEl = h("div", { class: "zoc-list" });
const logInput = h("input", {
  type: "file",
  accept: ".json,application/json",
  hidden: true,
});
const toolsEl = h(
  "div",
  { class: "zoc-tools" },
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("wand")} Suggest zooms`,
    onclick: () => runSuggest(),
  }),
  h("button", {
    type: "button",
    class: "btn btn-sm",
    html: `${icon("upload")} Click log`,
    title: "Import a click log (.json)",
    onclick: () => logInput.click(),
  }),
  h("button", {
    type: "button",
    class: "btn btn-sm btn-ghost",
    html: `${icon("trash")} Clear`,
    onclick: () => clearPoints(),
  }),
  logInput,
);

const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Zoom points",
      controls: [
        { type: "custom", el: toolsEl },
        { type: "custom", el: listEl },
      ],
    },
    {
      title: "Selected zoom",
      showIf: () => !!selected(),
      controls: [
        {
          id: "pZoom",
          type: "range",
          label: "Zoom",
          min: 1.1,
          max: 5,
          step: 0.05,
          value: 2,
          format: (v) => `${v.toFixed(2)}×`,
        },
        {
          id: "pDur",
          type: "range",
          label: "Zoom move",
          min: 0.2,
          max: 3,
          step: 0.05,
          value: 0.8,
          unit: "s",
          decimals: 2,
        },
        {
          id: "pHold",
          type: "range",
          label: "Hold",
          min: 0,
          max: 8,
          step: 0.1,
          value: 1.2,
          unit: "s",
          decimals: 1,
        },
        {
          id: "pEasing",
          type: "select",
          label: "Easing",
          value: "easeInOut",
          options: easingOptions.filter(([v]) => !/Elastic|Bounce/.test(v)),
        },
        {
          type: "custom",
          el: h(
            "div",
            { class: "zoc-row" },
            h(
              "button",
              {
                type: "button",
                class: "btn btn-sm",
                onclick: () => moveSelectedToPlayhead(),
              },
              "Move to playhead",
            ),
            h("button", {
              type: "button",
              class: "btn btn-sm btn-ghost",
              html: `${icon("trash")} Delete`,
              onclick: () => removePoint(selectedId),
            }),
          ),
        },
      ],
    },
    {
      title: "Zoom defaults",
      controls: [
        {
          id: "zoom",
          type: "range",
          label: "Zoom",
          min: 1.1,
          max: 5,
          step: 0.05,
          value: 2,
          format: (v) => `${v.toFixed(2)}×`,
        },
        {
          id: "dur",
          type: "range",
          label: "Zoom move",
          min: 0.2,
          max: 3,
          step: 0.05,
          value: 0.8,
          unit: "s",
          decimals: 2,
        },
        {
          id: "hold",
          type: "range",
          label: "Hold",
          min: 0,
          max: 8,
          step: 0.1,
          value: 1.2,
          unit: "s",
          decimals: 1,
        },
        {
          id: "easing",
          type: "select",
          label: "Easing",
          value: "easeInOut",
          options: easingOptions.filter(([v]) => !/Elastic|Bounce/.test(v)),
        },
        {
          id: "follow",
          type: "range",
          label: "Follow nearby clicks",
          min: 0,
          max: 4,
          step: 0.1,
          value: 1,
          unit: "s",
          decimals: 1,
          hint: "Clicks closer than this (after the zoom out would end) pan from one to the next instead of zooming out and back in.",
        },
        {
          type: "button",
          text: "Apply these to every zoom",
          onClick: () => applyDefaultsToAll(),
        },
      ],
    },
    {
      title: "Effects",
      controls: [
        {
          id: "motionBlur",
          type: "toggle",
          label: "Motion blur on zoom moves",
          value: true,
        },
        {
          id: "mbStrength",
          type: "range",
          label: "Blur strength",
          min: 0.1,
          max: 1,
          step: 0.05,
          value: 0.5,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (s) => s.motionBlur,
        },
        {
          id: "ring",
          type: "toggle",
          label: "Highlight ring on clicks",
          value: true,
        },
        {
          id: "ringColor",
          type: "color",
          label: "Ring color",
          value: "#ff3d71",
          showIf: (s) => s.ring,
        },
        {
          id: "ringSize",
          type: "range",
          label: "Ring size",
          min: 20,
          max: 160,
          value: 64,
          unit: "px",
          showIf: (s) => s.ring,
        },
      ],
    },
    {
      title: "Canvas",
      controls: [
        {
          id: "size",
          type: "segmented",
          label: "Aspect ratio",
          value: "source",
          options: Object.keys(SIZES).map((k) => [
            k,
            k === "source" ? "Source" : k,
          ]),
        },
        {
          id: "clip",
          type: "range",
          label: "Clip length (images)",
          min: 2,
          max: 30,
          step: 0.5,
          value: 6,
          unit: "s",
          decimals: 1,
          showIf: () => !isVideo(),
        },
      ],
    },
    backgroundSection({ value: "gradient" }),
    frameSection({ frame: "none", padding: 7 }),
  ],
  {
    onChange: (st, id) => {
      if (POINT_IDS.includes(id) && selected()) {
        const p = selected();
        Object.assign(p, {
          zoom: st.pZoom,
          dur: st.pDur,
          hold: st.pHold,
          easing: st.pEasing,
        });
        pointsChanged();
      }
      if (id === "follow") pointsChanged();
      resize();
      exportBar.refresh();
      stage.invalidate();
    },
  },
);
const s = panel.state;
function selected() {
  return points.find((p) => p.id === selectedId) || null;
}
function isVideo() {
  return media?.kind === "video";
}

/* ---------- Demo ---------- */
function demoShot() {
  const W = 1600,
    H = 1000;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d");
  g.fillStyle = "#f6f7fb";
  g.fillRect(0, 0, W, H);
  g.fillStyle = "#ffffff";
  g.fillRect(0, 0, W, 72);
  g.fillStyle = "#e8eaf1";
  g.fillRect(0, 72, W, 1);
  g.fillStyle = "#7c6cff";
  g.beginPath();
  roundRectPath(g, 32, 18, 36, 36, 9);
  g.fill();
  g.fillStyle = "#141821";
  g.font = fontString("Inter", 700, 22);
  g.fillText("Lumenly", 82, 44);
  g.fillStyle = "#141821";
  g.font = fontString("Inter", 800, 46);
  g.fillText("Invite your team", 120, 210);
  g.fillStyle = "#7b8396";
  g.font = fontString("Inter", 400, 22);
  g.fillText(
    "Everyone you add can edit projects and leave comments.",
    120,
    256,
  );
  for (let i = 0; i < 3; i++) {
    g.fillStyle = "#fff";
    g.beginPath();
    roundRectPath(g, 120, 320 + i * 96, 820, 72, 14);
    g.fill();
    g.fillStyle = ["#ffb4a2", "#a0e7c5", "#b8c0ff"][i];
    g.beginPath();
    g.arc(166, 356 + i * 96, 22, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#141821";
    g.font = fontString("Inter", 600, 21);
    g.fillText(
      ["Ada Brightwater", "Rui Okonkwo", "Mina Delacroix"][i],
      206,
      352 + i * 96,
    );
    g.fillStyle = "#8a93a6";
    g.font = fontString("Inter", 400, 17);
    g.fillText(["Owner", "Editor", "Pending invite"][i], 206, 378 + i * 96);
  }
  g.fillStyle = "#7c6cff";
  g.beginPath();
  roundRectPath(g, 1060, 330, 360, 66, 14);
  g.fill();
  g.fillStyle = "#fff";
  g.font = fontString("Inter", 700, 22);
  g.textAlign = "center";
  g.fillText("+ Add member", 1240, 371);
  g.fillStyle = "#fff";
  g.beginPath();
  roundRectPath(g, 1060, 430, 360, 240, 14);
  g.fill();
  g.fillStyle = "#8a93a6";
  g.font = fontString("Inter", 500, 17);
  g.fillText("Seats used: 3 of 10", 1240, 470);
  g.textAlign = "left";
  return {
    kind: "image",
    el: c,
    width: W,
    height: H,
    duration: 0,
    name: "demo",
  };
}
const demo = demoShot();
const src = () => media || demo;
const DEMO_POINTS = [
  { t: 1.0, x: 0.775, y: 0.363 },
  { t: 2.6, x: 0.32, y: 0.45 },
];

/* ---------- Upload ---------- */
const drop = createDropzone(document.getElementById("upload"), {
  accept: ["video", "image"],
  label: "Drop a screen recording",
  onLoad: (m) => {
    media = m;
    onMediaChange();
  },
  onClear: () => {
    media = null;
    onMediaChange();
  },
});

function onMediaChange() {
  selectedId = null;
  const saved = media ? store.get(storeKey()) : null;
  if (pendingClicks && media) {
    setPoints([]);
    try {
      importClicks(parseClickLog(pendingClicks, media.width, media.height));
    } catch (err) {
      toast(`Couldn’t read the click log: ${err.message}`, "error");
    }
    pendingClicks = null;
  } else if (saved?.points?.length) {
    setPoints(saved.points.map((p) => ({ ...p, id: nextId++ })));
    toast("Restored your zoom points for this recording.");
  } else setPoints(media ? [] : DEMO_POINTS.map((p) => newPoint(p, "click")));
  resize();
  panel.refresh();
  stage.reset();
  exportBar.refresh();
  showHint();
  stage.play().catch(() => {});
}

const storeKey = () => `zoom-on-click:${media.name}:${media.size}`;
let saveTimer = 0;
function save() {
  if (!media) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(
    () =>
      store.set(
        storeKey(),
        points.length
          ? { v: 1, points: points.map(({ id, ...p }) => p) }
          : null,
      ),
    400,
  );
}

/* ---------- Points ---------- */
function newPoint({ t, x, y }, source) {
  return {
    id: nextId++,
    t: Math.max(0, t),
    x: clamp(x),
    y: clamp(y),
    zoom: s.zoom,
    dur: s.dur,
    hold: s.hold,
    easing: s.easing,
    source,
  };
}

function setPoints(list) {
  points = list.sort((a, b) => a.t - b.t);
  pointsChanged();
}

function pointsChanged() {
  points.sort((a, b) => a.t - b.t);
  ({ keys, sessions } = buildKeyframes(points, { follow: s.follow }));
  renderList();
  renderTimeline();
  save();
  stage?.invalidate();
}

function select(id, { seek = false } = {}) {
  selectedId = id;
  const p = selected();
  if (p)
    panel.set(
      { pZoom: p.zoom, pDur: p.dur, pHold: p.hold, pEasing: p.easing },
      { silent: true },
    );
  panel.refresh();
  if (p && seek) stage.seek(Math.max(0, p.t - p.dur / 2 - 0.4));
  renderList();
  renderTimeline();
  stage.invalidate();
}

function removePoint(id) {
  setPoints(points.filter((p) => p.id !== id));
  if (selectedId === id) select(null);
}

function clearPoints() {
  if (points.length && !confirm("Remove every zoom point?")) return;
  setPoints([]);
  select(null);
}

function moveSelectedToPlayhead() {
  const p = selected();
  if (!p) return;
  p.t = stage.time;
  pointsChanged();
}

function applyDefaultsToAll() {
  points.forEach((p) =>
    Object.assign(p, {
      zoom: s.zoom,
      dur: s.dur,
      hold: s.hold,
      easing: s.easing,
    }),
  );
  if (selected()) select(selectedId);
  pointsChanged();
  toast(`Updated ${points.length} zoom${points.length === 1 ? "" : "s"}.`);
}

const SOURCE_LABEL = { click: "click log", manual: "added", auto: "suggested" };
function renderList() {
  if (!points.length) {
    listEl.replaceChildren(
      h(
        "p",
        { class: "zoc-empty" },
        "No zooms yet. Click the preview to add one at the playhead, import a click log, or let the tool suggest zooms.",
      ),
    );
    return;
  }
  listEl.replaceChildren(
    ...points.map((p) =>
      h(
        "div",
        {
          class: `zoc-item${p.id === selectedId ? " is-selected" : ""}`,
          role: "button",
          tabindex: "0",
          onclick: () => select(p.id, { seek: true }),
          onkeydown: (e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              select(p.id, { seek: true });
            }
          },
        },
        h("span", { class: "zoc-time" }, formatTime(p.t)),
        h("span", { class: "zoc-zoom" }, `${p.zoom.toFixed(1)}×`),
        h(
          "span",
          { class: `zoc-src is-${p.source}` },
          SOURCE_LABEL[p.source] || p.source,
        ),
        h("button", {
          type: "button",
          class: "btn btn-ghost zoc-del",
          "aria-label": "Delete zoom",
          html: icon("x"),
          onclick: (e) => {
            e.stopPropagation();
            removePoint(p.id);
          },
        }),
      ),
    ),
  );
}

/* ---------- Timeline strip ---------- */
const playhead = h("div", { class: "zoc-playhead" });
function renderTimeline() {
  const D = duration();
  const pct = (t) => `${clamp(t / D) * 100}%`;
  timelineEl.replaceChildren(
    ...sessions.map((se) =>
      h("div", {
        class: "zoc-session",
        style: `left:${pct(se.start)};width:calc(${pct(se.end)} - ${pct(se.start)})`,
      }),
    ),
    ...points.map((p) =>
      h("button", {
        type: "button",
        class: `zoc-dot${p.id === selectedId ? " is-selected" : ""} is-${p.source}`,
        style: `left:${pct(p.t)}`,
        title: `${formatTime(p.t)} · ${p.zoom.toFixed(1)}×`,
        "aria-label": `Zoom at ${formatTime(p.t)}`,
        onclick: (e) => {
          e.stopPropagation();
          select(p.id, { seek: true });
        },
      }),
    ),
    playhead,
  );
}
timelineEl.addEventListener("click", (e) => {
  const r = timelineEl.getBoundingClientRect();
  stage.seek(clamp((e.clientX - r.left) / r.width) * duration());
});

/* ---------- Click log import ---------- */
function importClicks(clicks) {
  // Skip clicks that are already points (re-importing the same log adds nothing).
  const dup = (c) =>
    points.some(
      (p) =>
        Math.abs(p.t - c.t) < 0.05 &&
        Math.abs(p.x - c.x) < 0.01 &&
        Math.abs(p.y - c.y) < 0.01,
    );
  const added = clicks.filter((c) => !dup(c)).map((c) => newPoint(c, "click"));
  setPoints([...points, ...added]);
  toast(
    `Added ${added.length} zoom${added.length === 1 ? "" : "s"} from the click log.`,
    "success",
  );
}

logInput.addEventListener("change", async () => {
  const f = logInput.files[0];
  logInput.value = "";
  if (!f) return;
  try {
    const m = src();
    const clicks = parseClickLog(await f.text(), m.width, m.height);
    if (!clicks.length)
      throw new Error("That click log has no clicks inside the frame.");
    importClicks(clicks);
  } catch (err) {
    toast(`Couldn’t read that click log: ${err.message}`, "error", 7000);
  }
});

/* ---------- Auto suggestions ---------- */
async function runSuggest() {
  if (!isVideo()) {
    toast(
      "Suggestions need a video. Drop a screen recording first.",
      "warning",
    );
    return;
  }
  const ctrl = new AbortController();
  stage.pause();
  const resumeAt = stage.time;
  const modal = progressModal(
    "Finding zoom moments…",
    () => ctrl.abort(),
    "Scanning the recording for places where something on screen changes.",
  );
  try {
    const found = await suggestZooms(media.el, {
      signal: ctrl.signal,
      onProgress: modal.set,
      seek: seekVideo,
    });
    if (!found) {
      toast("Cancelled.");
      return;
    }
    const fresh = found.filter(
      (f) => !points.some((p) => Math.abs(p.t - f.t) < 1),
    );
    setPoints([
      ...points.filter((p) => p.source !== "auto"),
      ...fresh.map((f) => newPoint(f, "auto")),
    ]);
    toast(
      fresh.length
        ? `Suggested ${fresh.length} zoom${fresh.length === 1 ? "" : "s"}. Delete any you don’t want.`
        : "No clear moments found. Add zooms by clicking the preview.",
      fresh.length ? "success" : "info",
      6000,
    );
  } catch (err) {
    console.error(err);
    toast(err.message || "Analysis failed.", "error");
  } finally {
    modal.close();
    stage.seek(resumeAt);
  }
}

/* ---------- Layout ---------- */
function resize() {
  const m = src();
  const [w, hh] = SIZES[s.size] || [
    outputSize(m.width, m.height, 1920).w,
    outputSize(m.width, m.height, 1920).h,
  ];
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = marks.width = w;
    canvas.height = marks.height = hh;
  }
  canvas.classList.toggle("checker", s.bg === "transparent");
}

let layout = null; // where the media sits on the canvas, for pointer mapping and markers

/* ---------- Rendering ---------- */
function drawZoomed(c, m, cam, t, bw, bh, k) {
  const draw = (v, alpha) => {
    const r = viewRect(v, m.width, m.height);
    c.globalAlpha = alpha;
    c.drawImage(m.el, r.sx, r.sy, r.sw, r.sh, 0, 0, bw, bh);
  };
  c.clearRect(0, 0, bw, bh);
  c.imageSmoothingQuality = "high";
  const prev = cameraAt(keys, t - 1 / 30);
  const motion =
    (Math.abs(cam.cx - prev.cx) + Math.abs(cam.cy - prev.cy)) * bw * cam.z +
    Math.abs(Math.log(cam.z / prev.z)) * bw;
  if (s.motionBlur && showZoom && motion * s.mbStrength > 1.5) {
    // Average cameras across a shutter of up to 1/30 s (the frame stays the same; only the view moves).
    // Enough samples that neighbours are ≤ ~2 px apart, so the blur is smooth rather than ghosted copies.
    // Capped at ~3.5% of the width so even fast moves stay subtle.
    const smear = Math.min(motion * s.mbStrength, bw * 0.035);
    const shutter = smear / motion / 30;
    const N = Math.min(24, Math.max(3, Math.ceil(smear / 2)));
    for (let j = 0; j < N; j++)
      draw(cameraAt(keys, t - (shutter * j) / (N - 1)), 1 / (j + 1));
    c.globalAlpha = 1;
  } else draw(cam, 1);

  if (s.ring && showZoom) {
    for (const p of points) {
      const q = (t - p.t) / RING_TIME;
      if (q < 0 || q > 1) continue;
      const x = (p.x - (cam.cx - 0.5 / cam.z)) * cam.z * bw;
      const y = (p.y - (cam.cy - 0.5 / cam.z)) * cam.z * bh;
      const kk = k; // ring size is authored for a 1080px output, like every other size
      const r = s.ringSize * kk * (0.35 + 0.65 * easings.easeOut(q));
      c.save();
      c.globalAlpha = (1 - q) * 0.9;
      c.strokeStyle = s.ringColor;
      c.lineWidth = Math.max(2, 5 * kk);
      c.shadowColor = "rgba(0,0,0,.35)";
      c.shadowBlur = 8 * kk;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = (1 - q) * 0.35;
      c.fillStyle = s.ringColor;
      c.beginPath();
      c.arc(x, y, r * 0.45, 0, Math.PI * 2);
      c.fill();
      c.restore();
    }
  }
}

let exportMode = null;

function render(t) {
  const W = canvas.width,
    H = canvas.height;
  const k = Math.min(W, H) / 1080;
  const m = src();
  ctx.clearRect(0, 0, W, H);
  drawShowcaseBackground(ctx, m, W, H, k, s);
  const box = fitInFrame(m, W, H, k, s);
  const bw = Math.round(box.w),
    bh = Math.round(box.h);
  const cam = showZoom ? (drag ? drag.cam : cameraAt(keys, t)) : FULL;
  const content = scratch(`zoc-content-${bw}x${bh}`, bw, bh);
  drawZoomed(content.getContext("2d"), m, cam, t, bw, bh, k);
  const { card, r } = buildFrameCard(content, bw, bh, k, s, "zoc-card");
  const tf = {
    rx: 0,
    ry: 0,
    scale: 1,
    x: W / 2,
    y: H / 2,
    focal: Math.max(W, H) * 1.6,
  };
  drawCardShadow(ctx, card, r, tf, s, k);
  const x0 = Math.round(W / 2 - card.width / 2),
    y0 = Math.round(H / 2 - card.height / 2);
  ctx.drawImage(card, x0, y0);
  const off = mediaOffset(s, k);
  layout = { x: x0 + off.x, y: y0 + off.y, w: bw, h: bh, cam };
  drawMarks(t);
  syncPlayhead(t);
}

/** Canvas point → source fraction (through the current camera). */
function toSource(px, py) {
  if (!layout) return null;
  const u = (px - layout.x) / layout.w,
    v = (py - layout.y) / layout.h;
  if (u < 0 || u > 1 || v < 0 || v > 1) return null;
  const c = layout.cam;
  return { x: c.cx - 0.5 / c.z + u / c.z, y: c.cy - 0.5 / c.z + v / c.z };
}
function toCanvas(p) {
  const c = layout.cam;
  return {
    x: layout.x + (p.x - (c.cx - 0.5 / c.z)) * c.z * layout.w,
    y: layout.y + (p.y - (c.cy - 0.5 / c.z)) * c.z * layout.h,
  };
}

/** Markers for points near the playhead (and the selected one). Overlay only: never exported. */
function drawMarks(t) {
  const W = marks.width,
    H = marks.height;
  mctx.clearRect(0, 0, W, H);
  if (!layout || exportMode) return;
  const k = Math.min(W, H) / 1080;
  for (const p of points) {
    const near = Math.abs(t - p.t) < Math.max(1.5, p.hold);
    if (!near && p.id !== selectedId) continue;
    const { x, y } = toCanvas(p);
    const sel = p.id === selectedId;
    mctx.save();
    mctx.globalAlpha = sel ? 1 : 0.75;
    mctx.lineWidth = 3 * k;
    mctx.strokeStyle = "#fff";
    mctx.fillStyle = sel ? "#0a84ff" : "rgba(10,132,255,.55)";
    mctx.beginPath();
    mctx.arc(x, y, (sel ? 16 : 12) * k, 0, Math.PI * 2);
    mctx.fill();
    mctx.stroke();
    // Label on a dark pill so it reads on light and dark recordings alike.
    const label = `${p.zoom.toFixed(1)}× · ${formatTime(p.t)}`;
    mctx.font = fontString("Inter", 700, 26 * k);
    const tw = mctx.measureText(label).width,
      ph = 38 * k,
      lx = x + 20 * k,
      ly = y - ph - 6 * k;
    mctx.fillStyle = sel ? "#0a84ff" : "rgba(20,24,33,.82)";
    mctx.beginPath();
    roundRectPath(mctx, lx, ly, tw + 24 * k, ph, ph / 2);
    mctx.fill();
    mctx.fillStyle = "#fff";
    mctx.textBaseline = "middle";
    mctx.fillText(label, lx + 12 * k, ly + ph / 2 + k);
    mctx.restore();
  }
}

function syncPlayhead(t) {
  playhead.style.left = `${clamp(t / duration()) * 100}%`;
}

/** Keep the marker canvas exactly on top of the (CSS-scaled) preview canvas. */
function placeMarks() {
  Object.assign(marks.style, {
    left: `${canvas.offsetLeft}px`,
    top: `${canvas.offsetTop}px`,
    width: `${canvas.offsetWidth}px`,
    height: `${canvas.offsetHeight}px`,
  });
}
new ResizeObserver(placeMarks).observe(canvas);
window.addEventListener("resize", placeMarks);

/* ---------- Pointer: click to add, drag to move ---------- */
let drag = null;
const eventPoint = (e) => {
  const r = canvas.getBoundingClientRect();
  return {
    px: ((e.clientX - r.left) / r.width) * canvas.width,
    py: ((e.clientY - r.top) / r.height) * canvas.height,
    scale: canvas.width / r.width,
  };
};
function hitPoint(px, py, scale) {
  let best = null,
    bestD = 16 * scale;
  for (const p of points) {
    if (
      Math.abs(stage.time - p.t) >= Math.max(1.5, p.hold) &&
      p.id !== selectedId
    )
      continue;
    const c = toCanvas(p);
    const d = Math.hypot(c.x - px, c.y - py);
    if (d < bestD) {
      best = p;
      bestD = d;
    }
  }
  return best;
}
canvas.addEventListener("pointerdown", (e) => {
  if (stage.playing) stage.pause();
  const { px, py, scale } = eventPoint(e);
  const hit = hitPoint(px, py, scale);
  if (hit) {
    select(hit.id);
    drag = { id: hit.id, cam: layout.cam };
  } else {
    const at = toSource(px, py);
    if (!at) return;
    const p = newPoint({ t: stage.time, ...at }, "manual");
    setPoints([...points, p]);
    select(p.id);
    drag = { id: p.id, cam: layout.cam };
  }
  canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener("pointermove", (e) => {
  const { px, py, scale } = eventPoint(e);
  if (!drag) {
    canvas.style.cursor = hitPoint(px, py, scale)
      ? "grab"
      : toSource(px, py)
        ? "crosshair"
        : "default";
    return;
  }
  const p = points.find((q) => q.id === drag.id);
  const at = toSource(px, py);
  if (p && at) {
    p.x = clamp(at.x);
    p.y = clamp(at.y);
    stage.invalidate();
  }
});
const endDrag = () => {
  if (drag) {
    drag = null;
    pointsChanged();
  }
};
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);
window.addEventListener("keydown", (e) => {
  if (
    (e.key === "Delete" || e.key === "Backspace") &&
    selectedId &&
    !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName)
  ) {
    e.preventDefault();
    removePoint(selectedId);
  }
});

/* ---------- Result / Original switch ---------- */
const viewBtns = document.querySelectorAll("#viewbar [data-v]");
viewBtns.forEach((b) =>
  b.addEventListener("click", () => {
    showZoom = b.dataset.v === "result";
    viewBtns.forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
    stage.invalidate();
  }),
);

function showHint() {
  overlay.hidden = false;
  overlay.classList.add("is-note");
  overlay.innerHTML = media
    ? "<div>Click the preview to add a zoom at the playhead. Drag a marker to move it.</div>"
    : "<div><strong>Showing a demo.</strong> Drop a screen recording on the left, then click where the action is.</div>";
  clearTimeout(showHint.timer);
  if (media)
    showHint.timer = setTimeout(() => {
      overlay.hidden = true;
    }, 6000);
}

const duration = () => (isVideo() ? media.duration : s.clip);

const stage = createStage({
  canvas,
  transport: document.getElementById("transport"),
  render,
  getDuration: duration,
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename: () => `${(media?.name || "demo").replace(/\.[^.]+$/, "")}-zoomed`,
  getVideo: () => (isVideo() ? media.el : null),
  hint: () => (s.bg === "transparent" ? TRANSPARENT_HINT : ""),
  beforeExport: (kind) => {
    exportMode = kind;
    showZoom = true;
    viewBtns.forEach((x) =>
      x.setAttribute("aria-pressed", String(x.dataset.v === "result")),
    );
  },
  afterExport: () => {
    exportMode = null;
    stage.invalidate();
  },
});

/* ---------- Start ---------- */
resize();
setPoints(DEMO_POINTS.map((p) => newPoint(p, "click")));
showHint();
stage.play().catch(() => {});

// A recording handed over by another tool (e.g. a future Screen Recorder), with its click log.
takeFile("zoom-on-click").then((item) => {
  if (!item) return;
  if (Array.isArray(item.meta?.clicks)) pendingClicks = item.meta; // parsed once the video's size is known
  drop.load(item.file);
});
