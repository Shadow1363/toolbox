/*
 * Progress Overlay: a bar that fills over the video (top, bottom, around the edges, segmented, circular)
 * and/or a countdown / count-up timer, with optional chapter markers. Can export the overlay alone.

 *
 * render(t): video (unless "overlay only") → bar (drawBar) → chapter labels → timer (drawTimer).
 * p = progress between "Starts at" and "Ends at"; chapters are { t, label } in stage seconds.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { createDropzone } from "/assets/js/lib/upload.js";
import { createStage } from "/assets/js/lib/stage.js";
import {
  createExportBar,
  canRecordAlpha,
  TRANSPARENT_HINT,
} from "/assets/js/lib/exporter.js";
import { outputSize } from "/assets/js/lib/canvas.js";
import { drawProgressOverlay } from "/assets/js/lib/progress-bar.js";
import { clamp } from "/assets/js/lib/easing.js";
import {
  fontOptions,
  weightOptions,
  ensureFont,
} from "/assets/js/lib/fonts.js";
import { h, icon, toast, formatTime, store } from "/assets/js/lib/dom.js";
import { receiveHandoff } from "/assets/js/lib/handoff.js";

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const videoAlpha = canRecordAlpha();
const SIZES = {
  "16:9": [1920, 1080],
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "4:5": [1080, 1350],
};
const SPOTS = [
  ["tl", "Top left"],
  ["tc", "Top center"],
  ["tr", "Top right"],
  ["ml", "Middle left"],
  ["mc", "Center"],
  ["mr", "Middle right"],
  ["bl", "Bottom left"],
  ["bc", "Bottom center"],
  ["br", "Bottom right"],
];

let media = null;
let chapters = store.get("progress-overlay:chapters", []);
let exportKind = null;

/* ---------- Chapters editor (custom element) ---------- */
const chapterList = h("div", { class: "po-chapters" });
const addChapterBtn = h("button", {
  type: "button",
  class: "btn btn-sm",
  html: `${icon("plus")} Add at playhead`,
  onclick: () => addChapter(),
});

const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Overlay",
      controls: [
        {
          id: "mode",
          type: "segmented",
          label: "Show",
          value: "bar",
          options: [
            ["bar", "Bar"],
            ["timer", "Timer"],
            ["both", "Both"],
          ],
        },
        {
          id: "preset",
          type: "presets",
          label: "Presets",
          value: "line",
          options: [
            {
              label: "Thin line",
              value: "line",
              patch: {
                style: "line",
                place: "bottom",
                thickness: 8,
                margin: 0,
                color: "#ff3d71",
                track: "#ffffff",
                trackOpacity: 0.18,
              },
            },
            {
              label: "Rounded",
              value: "rounded",
              patch: {
                style: "rounded",
                place: "bottom",
                thickness: 22,
                margin: 40,
                color: "#ffffff",
                track: "#000000",
                trackOpacity: 0.35,
              },
            },
            {
              label: "Chapters",
              value: "segments",
              patch: {
                style: "segments",
                place: "bottom",
                thickness: 14,
                margin: 40,
                color: "#ffd23f",
                track: "#ffffff",
                trackOpacity: 0.3,
                labels: "all",
              },
            },
            {
              label: "Border",
              value: "edges",
              patch: {
                style: "line",
                place: "edges",
                thickness: 14,
                margin: 0,
                color: "#22d3ee",
                track: "#ffffff",
                trackOpacity: 0,
              },
            },
            {
              label: "Ring timer",
              value: "ring",
              patch: {
                mode: "both",
                style: "circle",
                corner: "tr",
                circleSize: 150,
                thickness: 14,
                color: "#5cf08f",
                track: "#000000",
                trackOpacity: 0.4,
                timerPos: "circle",
                timerSize: 44,
              },
            },
          ],
        },
      ],
    },
    {
      title: "Bar",
      showIf: (s) => s.mode !== "timer",
      controls: [
        {
          id: "style",
          type: "segmented",
          label: "Style",
          value: "line",
          options: [
            ["line", "Line"],
            ["rounded", "Rounded"],
            ["segments", "Segmented"],
            ["circle", "Circle"],
          ],
        },
        {
          id: "place",
          type: "segmented",
          label: "Position",
          value: "bottom",
          options: [
            ["top", "Top"],
            ["bottom", "Bottom"],
            ["edges", "Edges"],
          ],
          showIf: (s) => s.style !== "circle",
        },
        {
          id: "corner",
          type: "select",
          label: "Position",
          value: "tr",
          options: SPOTS,
          showIf: (s) => s.style === "circle",
        },
        {
          id: "circleSize",
          type: "range",
          label: "Circle size",
          min: 40,
          max: 600,
          value: 150,
          unit: "px",
          showIf: (s) => s.style === "circle",
        },
        {
          id: "thickness",
          type: "range",
          label: "Thickness",
          min: 2,
          max: 80,
          value: 8,
          unit: "px",
        },
        {
          id: "margin",
          type: "range",
          label: "Inset from edge",
          min: 0,
          max: 200,
          value: 0,
          unit: "px",
        },
        {
          id: "segments",
          type: "range",
          label: "Segments",
          min: 2,
          max: 20,
          value: 4,
          showIf: (s) => s.style === "segments",
          hint: "Used when there are no chapters; chapters set the segments otherwise.",
        },
        {
          id: "gap",
          type: "range",
          label: "Segment gap",
          min: 0,
          max: 40,
          value: 10,
          unit: "px",
          showIf: (s) => s.style === "segments",
        },
        { id: "color", type: "color", label: "Fill", value: "#ff3d71" },
        { id: "track", type: "color", label: "Track", value: "#ffffff" },
        {
          id: "trackOpacity",
          type: "range",
          label: "Track opacity",
          min: 0,
          max: 1,
          step: 0.01,
          value: 0.18,
          format: (v) => `${Math.round(v * 100)}%`,
        },
        {
          id: "reverse",
          type: "toggle",
          label: "Empty instead of fill (time left)",
          value: false,
        },
        {
          id: "glow",
          type: "range",
          label: "Glow",
          min: 0,
          max: 40,
          value: 0,
          unit: "px",
        },
      ],
    },
    {
      title: "Timer",
      showIf: (s) => s.mode !== "bar",
      controls: [
        {
          id: "timerType",
          type: "segmented",
          label: "Counts",
          value: "down",
          options: [
            ["down", "Down (left)"],
            ["up", "Up (elapsed)"],
          ],
        },
        {
          id: "format",
          type: "select",
          label: "Format",
          value: "m:ss",
          options: [
            ["m:ss", "1:05"],
            ["mm:ss", "01:05"],
            ["h:mm:ss", "0:01:05"],
            ["s", "65"],
            ["m:ss.d", "1:05.3"],
          ],
        },
        {
          id: "timerLabel",
          type: "text",
          label: "Label",
          value: "",
          placeholder: "e.g. Time left",
        },
        {
          id: "timerPos",
          type: "select",
          label: "Position",
          value: "tr",
          options: [...SPOTS, ["circle", "Inside the circle"]],
        },
        {
          id: "family",
          type: "select",
          label: "Font",
          value: "Space Mono",
          options: fontOptions,
        },
        {
          id: "weight",
          type: "select",
          label: "Weight",
          value: "700",
          options: weightOptions,
        },
        {
          id: "timerSize",
          type: "range",
          label: "Size",
          min: 16,
          max: 300,
          value: 64,
          unit: "px",
        },
        { id: "timerColor", type: "color", label: "Color", value: "#ffffff" },
        { id: "pill", type: "toggle", label: "Background pill", value: true },
        {
          id: "pillColor",
          type: "color",
          label: "Pill color",
          value: "#000000",
          showIf: (s) => s.pill,
        },
        {
          id: "pillOpacity",
          type: "range",
          label: "Pill opacity",
          min: 0.1,
          max: 1,
          step: 0.05,
          value: 0.55,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (s) => s.pill,
        },
      ],
    },
    {
      title: "Timing",
      controls: [
        {
          id: "start",
          type: "range",
          label: "Starts at",
          min: 0,
          max: 60,
          step: 0.1,
          value: 0,
          unit: "s",
          decimals: 1,
        },
        {
          id: "end",
          type: "range",
          label: "Ends at",
          min: 0.1,
          max: 60,
          step: 0.1,
          value: 15,
          unit: "s",
          decimals: 1,
          hint: "Follows the end of the clip until you move it.",
        },
        {
          id: "clip",
          type: "range",
          label: "Length (no video)",
          min: 1,
          max: 600,
          step: 1,
          value: 15,
          unit: "s",
          showIf: () => media?.kind !== "video",
        },
      ],
    },
    {
      title: "Chapters",
      controls: [
        { type: "custom", el: chapterList },
        { type: "custom", el: addChapterBtn },
        {
          id: "labels",
          type: "segmented",
          label: "Labels",
          value: "current",
          options: [
            ["none", "None"],
            ["current", "Current"],
            ["all", "All"],
          ],
        },
        {
          id: "labelSize",
          type: "range",
          label: "Label size",
          min: 12,
          max: 80,
          value: 30,
          unit: "px",
          showIf: (s) => s.labels !== "none",
        },
      ],
    },
    {
      title: "Output",
      controls: [
        {
          id: "overlayOnly",
          type: "toggle",
          label: "Overlay only (transparent)",
          value: false,
          hint: "Hides the video so you can lay the overlay over footage in an editor.",
        },
        {
          id: "matte",
          type: "color",
          label: "Matte color",
          value: "#00b140",
          showIf: (s) => s.overlayOnly && !videoAlpha,
          hint: "This browser can’t record transparent video, so Export video uses this color. PNG and GIF stay transparent.",
        },
        {
          id: "bgColor",
          type: "color",
          label: "Background (no video)",
          value: "#111318",
          showIf: (s) => !s.overlayOnly && !media,
        },
        {
          id: "size",
          type: "segmented",
          label: "Canvas (no video)",
          value: "16:9",
          options: Object.keys(SIZES).map((k) => [k, k]),
          showIf: () => !media,
        },
        {
          id: "opacity",
          type: "range",
          label: "Overlay opacity",
          min: 0.1,
          max: 1,
          step: 0.01,
          value: 1,
          format: (v) => `${Math.round(v * 100)}%`,
        },
      ],
    },
  ],
  {
    persist: { key: "progress-overlay", skip: ["start", "end"] },
    onChange: (st, id) => {
      if (id === "end") endFollows = st.end >= clipLength() - 0.05;
      if (id === "clip") syncRanges();
      if (id === "family" || id === "weight")
        ensureFont(st.family, st.weight, () => stage.invalidate());
      resize();
      exportBar.refresh();
      stage.invalidate();
    },
  },
);
const s = panel.state;

/* ---------- Media ---------- */
const drop = createDropzone(document.getElementById("upload"), {
  accept: ["video", "image"],
  label: "Drop a video (optional)",
  onLoad: (m) => {
    media = m;
    onMedia();
  },
  onClear: () => {
    media = null;
    onMedia();
  },
});

function onMedia() {
  resize();
  syncRanges();
  panel.refresh();
  stage.reset();
  exportBar.refresh();
  overlay.hidden = !!media;
  stage.play().catch(() => {});
}

const clipLength = () => (media?.kind === "video" ? media.duration : s.clip);
let endFollows = true;
function syncRanges() {
  const len = clipLength();
  for (const id of ["start", "end"])
    document.getElementById(`c-${id}`).max = len;
  const patch = { start: Math.min(s.start, len - 0.1) };
  if (endFollows || s.end > len) patch.end = len;
  panel.set(patch, { silent: true });
  renderChapters();
}

function resize() {
  let w, hh;
  if (media) ({ w, h: hh } = outputSize(media.width, media.height, 1920));
  else [w, hh] = SIZES[s.size];
  if (canvas.width !== w || canvas.height !== hh) {
    canvas.width = w;
    canvas.height = hh;
  }
  canvas.classList.toggle("checker", s.overlayOnly);
}

/* ---------- Chapters ---------- */
function saveChapters() {
  chapters.sort((a, b) => a.t - b.t);
  store.set("progress-overlay:chapters", chapters);
  stage?.invalidate();
}

function addChapter() {
  const t = +stage.time.toFixed(1);
  if (chapters.some((c) => Math.abs(c.t - t) < 0.05)) {
    toast("There’s already a chapter here. Move the playhead first.");
    return;
  }
  chapters.push({ t, label: `Chapter ${chapters.length + 1}` });
  saveChapters();
  renderChapters();
}

function renderChapters() {
  if (!chapters.length) {
    chapterList.replaceChildren(
      h(
        "p",
        { class: "po-empty" },
        "No chapters. Add one at the playhead to mark sections on the bar.",
      ),
    );
    return;
  }
  const len = clipLength();
  chapterList.replaceChildren(
    ...chapters.map((c) => {
      const time = h("input", {
        type: "number",
        min: 0,
        max: len,
        step: 0.1,
        value: c.t,
        "aria-label": "Chapter start (seconds)",
      });
      const label = h("input", {
        type: "text",
        value: c.label,
        "aria-label": "Chapter label",
      });
      time.addEventListener("change", () => {
        c.t = clamp(+time.value || 0, 0, len);
        saveChapters();
        renderChapters();
      });
      label.addEventListener("input", () => {
        c.label = label.value;
        saveChapters();
      });
      return h(
        "div",
        { class: "po-chapter" },
        time,
        label,
        h("button", {
          type: "button",
          class: "btn btn-ghost po-del",
          "aria-label": "Remove chapter",
          html: icon("x"),
          onclick: () => {
            chapters = chapters.filter((x) => x !== c);
            saveChapters();
            renderChapters();
          },
        }),
      );
    }),
  );
}

function render(t) {
  const W = canvas.width,
    H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const transparent = s.overlayOnly && !(exportKind === "video" && !videoAlpha);
  if (s.overlayOnly) {
    if (!transparent) {
      ctx.fillStyle = s.matte;
      ctx.fillRect(0, 0, W, H);
    }
  } else if (media) ctx.drawImage(media.el, 0, 0, W, H);
  else {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, W, H);
  }

  drawProgressOverlay(ctx, t, s, chapters);
}

const isVideo = () => media?.kind === "video";
const stage = createStage({
  canvas,
  transport: document.getElementById("transport"),
  render,
  getDuration: clipLength,
  getVideo: () => (isVideo() ? media.el : null), // the video keeps the clock even when it's hidden (overlay only)
});

const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename: () =>
    `${media ? media.name.replace(/\.[^.]+$/, "") : "overlay"}-${s.mode === "timer" ? "timer" : "progress"}${s.overlayOnly ? "-alpha" : ""}`,
  getVideo: () => (isVideo() ? media.el : null),
  hasAudio: () => isVideo() && !s.overlayOnly,
  hint: () =>
    s.overlayOnly
      ? `${TRANSPARENT_HINT}${videoAlpha ? "" : " Video export here uses the matte color."}`
      : "",
  beforeExport: (kind) => {
    if (kind === "video" && s.overlayOnly && !videoAlpha)
      toast(
        "This browser can’t record transparent video, so the matte color is used. Use Chrome or Edge for a transparent WebM.",
        "warning",
        7000,
      );
    exportKind = kind;
    stage.invalidate();
  },
  afterExport: () => {
    exportKind = null;
    stage.invalidate();
  },
});

overlay.hidden = false;
overlay.classList.add("is-note");
overlay.innerHTML =
  "<div>No video needed: export the overlay on its own, or drop a video to put it on top.</div>";
resize();
syncRanges();
ensureFont(s.family, s.weight, () => stage.invalidate());
ensureFont("Inter", 700, () => stage.invalidate());
stage.play().catch(() => {});

// A file sent from another tool's "Open in…" menu.
receiveHandoff("progress-overlay", (file) => drop.load(file));
