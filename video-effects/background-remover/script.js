/*
 * Background Remover: cut out the subject and replace the background
 * (transparent, color, blur, image or a looping video), with feathering, temporal smoothing and color matching.
 *
 * What to keep ("subject"):
 *   person: MediaPipe person segmentation (everyone in frame), photos and video;
 *   auto:   ISNet via lib/subject.js, the main subject(s) of a photo (objects, pets, products, groups);
 *   pick:   SAM 2.1 via lib/subject.js, clicks on the photo choose what to keep or drop, several objects at once;
 *   color:  color key (color-key.js) for text, logos and flat backgrounds, photos and video.
 * Per frame: background layer → subject alpha → subject layer (source, light/color match, cut out) → composite.
 * Photos are segmented once and refined in lib/still-mask.js (edge snap, add/erase brush), at full size up to 4096 px.
 * Exports: transparent WebM keeps alpha in Chromium (canRecordAlpha); elsewhere the matte color is recorded instead, with a warning.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { createDropzone } from "/assets/js/lib/upload.js";
import { createStage } from "/assets/js/lib/stage.js";
import {
  createExportBar,
  canRecordAlpha,
  TRANSPARENT_HINT,
} from "/assets/js/lib/exporter.js";
import {
  fit,
  outputSize,
  scratch,
  drawBlurred,
  supportsCanvasFilter,
} from "/assets/js/lib/canvas.js";
import { seekVideo } from "/assets/js/lib/media.js";
import { h, icon, toast } from "/assets/js/lib/dom.js";
import { hex } from "/assets/js/lib/palette.js";
import {
  SEGMENT_MODELS as MODELS,
  loadSegmenter,
  segmentImage,
} from "/assets/js/lib/vision.js";
import { createPersonMask } from "/assets/js/lib/person-mask.js";
import { createStillMask } from "/assets/js/lib/still-mask.js";
import {
  subjectPlan,
  loadSubjectModel,
  segmentSubject,
  embedPhoto,
  pickMask,
} from "/assets/js/lib/subject.js";
import { colorKey } from "./color-key.js";

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const marks = document.getElementById("marks"); // click points + brush cursor, never exported
const mctx = marks.getContext("2d");
const transportEl = document.getElementById("transport");
const videoAlpha = canRecordAlpha();

let media = null; // the person video/image
let bgMedia = null; // uploaded background image or video
let segmenter = null;
let stillSeg = null; // IMAGE-mode high-quality segmenter for photos
let modelError = null;
let exportKind = null; // 'video' | 'gif' while exporting

const bgImageZone = document.createElement("div");
const bgVideoZone = document.createElement("div");
const pickEl = h("div", { class: "bgr-actions" });
const brushEl = h("div", { class: "bgr-actions" });

const SUBJECT_HINTS = {
  person: "Everyone in the photo. Fast, made for people.",
  auto: "The main subject, whatever it is: objects, products, pets, cars, groups of people, logos.",
  pick: "Click what to keep on the preview. Switch to Remove (or hold Alt/Option) to click what should go. New object keeps several separate things.",
  color: "Removes one color. Click the background on the preview to pick it. Best for text, logos, scans and plain backdrops.",
};

/* ---------- Controls ---------- */
const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Subject",
      controls: [
        {
          id: "subject",
          type: "segmented",
          label: "Keep",
          value: "person",
          options: [
            ["person", "People"],
            ["auto", "Any object"],
            ["pick", "Click to pick"],
            ["color", "Color key"],
          ],
          showIf: () => !isVideo(),
        },
        {
          id: "vsubject",
          type: "segmented",
          label: "Keep",
          value: "person",
          options: [
            ["person", "People"],
            ["color", "Color key"],
          ],
          showIf: () => isVideo(),
          hint: "Any object and Click to pick work on photos.",
        },
        ...Object.entries(SUBJECT_HINTS).map(([key, text]) => ({
          type: "custom",
          el: h("div", { class: "ctrl-hint" }, text),
          showIf: (st) => subject(st) === key,
        })),
        {
          id: "pickMode",
          type: "segmented",
          label: "Clicks",
          value: "keep",
          options: [
            ["keep", "Keep"],
            ["remove", "Remove"],
          ],
          showIf: (st) => subject(st) === "pick",
        },
        { type: "custom", el: pickEl, showIf: (st) => subject(st) === "pick" },
        {
          id: "keyColor",
          type: "color",
          label: "Color to remove",
          value: "#ffffff",
          showIf: (st) => subject(st) === "color",
        },
        {
          id: "keyTolerance",
          type: "range",
          label: "Tolerance",
          min: 1,
          max: 100,
          value: 20,
          format: (v) => `${Math.round(v)}%`,
          showIf: (st) => subject(st) === "color",
          hint: "How different a color can be and still go.",
        },
        {
          id: "keySoftness",
          type: "range",
          label: "Key softness",
          min: 0,
          max: 100,
          value: 15,
          format: (v) => `${Math.round(v)}%`,
          showIf: (st) => subject(st) === "color",
        },
        {
          id: "keyEdges",
          type: "toggle",
          label: "Only the outer background",
          value: false,
          showIf: (st) => subject(st) === "color",
          hint: "Removes only the color that touches the border, so the same color inside the subject stays.",
        },
      ],
    },
    {
      title: "Background",
      controls: [
        {
          id: "bg",
          type: "segmented",
          label: "Replace with",
          value: "blur",
          options: [
            ["transparent", "None"],
            ["color", "Color"],
            ["blur", "Blur"],
            ["image", "Image"],
            ["video", "Video"],
          ],
        },
        {
          id: "bgColor",
          type: "color",
          label: "Color",
          value: "#1f6feb",
          showIf: (s) =>
            s.bg === "color" ||
            ((s.bg === "image" || s.bg === "video") && s.bgFit === "contain"),
        },
        {
          id: "blur",
          type: "range",
          label: "Blur",
          min: 2,
          max: 80,
          value: 24,
          unit: "px",
          showIf: (s) => s.bg === "blur",
        },
        {
          id: "dim",
          type: "range",
          label: "Darken background",
          min: 0,
          max: 0.8,
          step: 0.05,
          value: 0,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (s) => s.bg !== "transparent" && s.bg !== "color",
        },
        {
          type: "custom",
          label: "Background image",
          el: bgImageZone,
          showIf: (s) => s.bg === "image",
        },
        {
          type: "custom",
          label: "Background video (loops, muted)",
          el: bgVideoZone,
          showIf: (s) => s.bg === "video",
        },
        {
          id: "bgFit",
          type: "segmented",
          label: "Fit",
          value: "cover",
          options: [
            ["cover", "Fill"],
            ["contain", "Fit"],
          ],
          showIf: (s) => s.bg === "image" || s.bg === "video",
        },
        {
          id: "matte",
          type: "color",
          label: "Matte color",
          value: "#00b140",
          showIf: (s) => s.bg === "transparent",
          hint: videoAlpha
            ? "Used only where transparency can’t be kept. This browser records transparent WebM."
            : "This browser can’t record transparent video, so Export video uses this color. PNG and GIF stay transparent.",
        },
      ],
    },
    {
      title: "Edges",
      controls: [
        {
          id: "model",
          type: "select",
          label: "Segmentation model",
          value: "landscape",
          options: Object.entries(MODELS).map(([k, m]) => [k, m.label]),
          showIf: (st) => !isPhoto() && subject(st) === "person",
        },
        {
          id: "threshold",
          type: "range",
          label: "Edge threshold",
          min: 0.1,
          max: 0.9,
          step: 0.01,
          value: 0.5,
          decimals: 2,
          hint: "Higher keeps less of the subject; lower keeps more.",
          showIf: (st) => subject(st) !== "color",
        },
        {
          id: "softness",
          type: "range",
          label: "Edge softness",
          min: 0.01,
          max: 0.6,
          step: 0.01,
          value: 0.18,
          decimals: 2,
          showIf: (st) => subject(st) !== "color",
        },
        {
          id: "edgeSnap",
          type: "toggle",
          label: "Snap edges to the photo",
          value: true,
          showIf: (st) => isPhoto() && subject(st) !== "color",
          hint: "Follows hair and outlines in the photo instead of the blurry model edge.",
        },
        {
          id: "feather",
          type: "range",
          label: "Feather",
          min: 0,
          max: 24,
          value: 4,
          unit: "px",
          hint: supportsCanvasFilter
            ? ""
            : "Feather needs canvas filters (not available in this browser).",
        },
        {
          id: "smoothing",
          type: "range",
          label: "Smooth over time",
          min: 0,
          max: 0.9,
          step: 0.05,
          value: 0.5,
          decimals: 2,
          hint: "Blends each mask with the previous ones to stop edge flicker. GIF export uses 0 (frames are rendered out of order).",
          showIf: (st) => !isPhoto() && subject(st) === "person",
        },
        {
          id: "polarity",
          type: "segmented",
          label: "Mask",
          value: "auto",
          options: [
            ["auto", "Auto"],
            ["normal", "Normal"],
            ["invert", "Inverted"],
          ],
          hint: "Inverted keeps the background and removes the subject.",
        },
        {
          id: "showMask",
          type: "toggle",
          label: "Show mask (debug)",
          value: false,
        },
      ],
    },
    {
      title: "Touch up",
      showIf: () => isPhoto(),
      controls: [
        {
          id: "brush",
          type: "segmented",
          label: "Brush",
          value: "off",
          options: [
            ["off", "Off"],
            ["add", "Keep"],
            ["erase", "Remove"],
          ],
          hint: "Paint on the preview to fix what the model missed. Ctrl/⌘+Z undoes.",
        },
        {
          id: "brushSize",
          type: "range",
          label: "Brush size",
          min: 4,
          max: 300,
          value: 60,
          unit: "px",
          showIf: (st) => st.brush !== "off",
        },
        {
          id: "brushSoft",
          type: "range",
          label: "Brush softness",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.5,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (st) => st.brush !== "off",
        },
        { type: "custom", el: brushEl },
      ],
    },
    {
      title: "Blend",
      showIf: (s) => s.bg !== "transparent",
      controls: [
        {
          id: "match",
          type: "range",
          label: "Color match",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.3,
          format: (v) => `${Math.round(v * 100)}%`,
          hint: "Nudges the subject’s brightness and tint toward the new background.",
        },
        {
          id: "wrap",
          type: "range",
          label: "Light wrap",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.25,
          format: (v) => `${Math.round(v * 100)}%`,
          hint: "Lets background light spill onto the edges of the subject.",
        },
      ],
    },
    {
      title: "Clip",
      showIf: (s) => isPhoto() && s.bg === "video",
      controls: [
        {
          id: "clip",
          type: "range",
          label: "Clip length",
          min: 1,
          max: 20,
          step: 0.5,
          value: 5,
          unit: "s",
          decimals: 1,
          hint: "Length of the GIF or video made from the photo over the looping background.",
        },
      ],
    },
  ],
  {
    onChange: (s, id) => {
      if (id === "model") {
        segmenter = null;
        mask.reset();
        initModel();
      }
      if (id === "polarity") mask.polarity = null;
      if (id === "smoothing") mask.prev = null;
      if (id === "subject" || id === "vsubject") applySubject();
      if (KEY_IDS.includes(id) && isPhoto() && s.subject === "color") applySubject();
      if (["threshold", "softness", "polarity", "edgeSnap"].includes(id))
        updateStill();
      if (["brush", "subject", "vsubject"].includes(id)) {
        syncCursor();
        drawMarks();
      }
      if (id === "bg") {
        syncBgVideo(stage.time, true);
        syncTransport();
      }
      canvas.classList.toggle("checker", s.bg === "transparent");
      exportBar.refresh();
      stage.invalidate();
    },
  },
);
const s = panel.state;
const KEY_IDS = ["keyColor", "keyTolerance", "keySoftness", "keyEdges"];

/* ---------- Uploads ---------- */
createDropzone(document.getElementById("upload"), {
  accept: ["video", "image"],
  label: "Drop a photo or video of a person",
  onLoad: (m) => {
    media = m;
    const { w, h: ch } = outputSize(m.width, m.height, m.kind === "image" ? 4096 : 1920);
    canvas.width = w;
    canvas.height = ch;
    mask.reset();
    resetPhoto();
    syncTransport();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    overlay.hidden = true;
    syncCursor();
    drawMarks();
    if (m.kind === "image") applySubject();
    else if (segmenter || subject() === "color") stage.play().catch(() => {});
    else initModel();
  },
  onClear: () => {
    media = null;
    mask.reset();
    resetPhoto();
    drawMarks();
    syncTransport();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    showIntro();
  },
});

const onBg = (m) => {
  bgMedia?.el.pause?.();
  bgMedia = m;
  if (m.kind === "video") {
    m.el.loop = true;
    m.el.muted = true;
  }
  syncBgVideo(stage.time, true);
  stage.invalidate();
};
const clearBg = () => {
  bgMedia = null;
  stage.invalidate();
};
createDropzone(bgImageZone, {
  accept: ["image"],
  label: "Drop a background image",
  onLoad: onBg,
  onClear: clearBg,
});
createDropzone(bgVideoZone, {
  accept: ["video"],
  label: "Drop a background video",
  onLoad: onBg,
  onClear: clearBg,
});
const bgSource = () =>
  bgMedia && bgMedia.kind === (s.bg === "video" ? "video" : "image")
    ? bgMedia
    : null;

/* ---------- Background video sync ---------- */
const bgTarget = (t) => (bgMedia?.duration ? t % bgMedia.duration : 0);

/** Keep the looping background video near stage time t: play along while the stage plays, park it when paused. */
function syncBgVideo(t, force = false) {
  const v = s.bg === "video" && bgMedia?.kind === "video" ? bgMedia.el : null;
  if (!v) return;
  const target = bgTarget(t);
  if (stage.playing && exportKind !== "gif") {
    if (v.paused) v.play().catch(() => {});
    if (force || Math.abs(v.currentTime - target) > 0.3) v.currentTime = target;
  } else {
    if (!v.paused) v.pause();
    if (force || Math.abs(v.currentTime - target) > 0.04)
      v.currentTime = target;
  }
}

/* ---------- Model ---------- */
const mask = createPersonMask("bgr");
let loadingKey = null;
async function initModel() {
  const key = s.model;
  if (segmenter || loadingKey === key) return;
  loadingKey = key;
  modelError = null;
  showStatus(
    `<div class="spinner"></div>Loading segmentation model…<br><small>First load downloads ~${key === "quality" ? "25" : "10"} MB, then it's cached.</small>`,
  );
  try {
    const seg = await loadSegmenter(key);
    if (s.model !== key) return;
    segmenter = seg;
    overlay.hidden = !!media || false;
    if (!media) showIntro();
    stage.invalidate();
    if (media) stage.play().catch(() => {});
  } catch (err) {
    console.error(err);
    modelError = err;
    showStatus(
      "<strong>Could not load the segmentation model.</strong><br>Check your connection or content blockers, then pick the model again.",
    );
    toast("Segmentation model failed to load.", "error", 7000);
  } finally {
    if (loadingKey === key) loadingKey = null;
  }
}

/* ---------- Photo: segment once (per subject mode), snapped to the photo's edges ---------- */
const still = createStillMask("bgr");
let stillPhoto = null; // the photo `still` was built for (brush edits survive mode switches on it)
let stillShown = false; // false: no mask to show yet (e.g. Click to pick before the first click)
let rawCache = {}; // subject mode → raw mask for the current photo
let picks = [[]]; // click groups, one per object: [{ x, y (0..1), keep }]
let pickPhoto = null; // the photo the selection model has encoded
let applyToken = 0;

/**
 * The subject mode for the current media. Hoisted: showIf calls it while the panel builds,
 * before `s` exists, so showIf passes its own state.
 */
function subject(st) {
  const v = st || s;
  return isVideo() ? v.vsubject : v.subject;
}

function resetPhoto() {
  still.reset();
  stillPhoto = null;
  stillShown = false;
  rawCache = {};
  picks = [[]];
  pickPhoto = null;
  applyToken++;
  renderPickButtons();
  renderBrushButtons();
}

/** Build (or reuse) the raw mask for the chosen subject mode and show it. Videos just redraw. */
async function applySubject() {
  const m = media;
  if (!m || m.kind !== "image") {
    stage.invalidate();
    exportBar.refresh();
    return;
  }
  const mode = s.subject;
  const token = ++applyToken;
  const current = () => token === applyToken && media === m;
  try {
    let raw = null;
    if (mode === "person") raw = rawCache.person ||= await detectPerson(m, current);
    else if (mode === "auto") raw = rawCache.auto ||= await detectAuto(m, current);
    else if (mode === "color") raw = colorKey(m.el, keyOptions(), 1536);
    else if (mode === "pick") {
      await preparePick(m, current);
      if (!current()) return;
      raw = await pickRaw();
    }
    if (!current()) return;
    setStill(m, raw);
    if (mode === "pick" && !raw) showNote("Click what you want to keep.");
    else overlay.hidden = true;
  } catch (err) {
    if (!current()) return;
    console.error(err);
    const what = { person: "the person", auto: "the subject", pick: "the photo" }[mode] || "the photo";
    showStatus(
      `<strong>Could not read ${what}.</strong><br>${err.message || "Check your connection or content blockers"}. Pick the mode again to retry.`,
    );
    toast("Segmentation failed.", "error", 7000);
  }
}

async function detectPerson(m, current) {
  showStatus(
    "<div class=\"spinner\"></div>Detecting people…<br><small>The first photo downloads the high-quality model (~16 MB), then it's cached.</small>",
  );
  stillSeg ||= await loadSegmenter("quality", { mode: "IMAGE" });
  if (!current()) return null;
  await paint(); // let the status show before the (blocking) model run
  const raw = segmentImage(stillSeg, m.el, "quality");
  if (!raw) throw new Error("The segmenter returned no mask");
  return raw;
}

async function detectAuto(m, current) {
  await ensureModel("auto", "object model", current);
  if (!current()) return null;
  const slow = (await subjectPlan("auto")).device !== "webgpu";
  showStatus(
    `<div class="spinner"></div>Finding the subject…${slow ? "<br><small>No WebGPU here, so this runs on the CPU and can take a minute.</small>" : ""}`,
  );
  return segmentSubject(m.el);
}

async function preparePick(m, current) {
  if (pickPhoto === m) return;
  await ensureModel("pick", "selection model", current);
  if (!current()) return;
  showStatus("<div class=\"spinner\"></div>Reading the photo…<br><small>Once per photo; after that every click is quick.</small>");
  await embedPhoto(m.el);
  if (media === m) pickPhoto = m;
}

const confirmed = {};
/** Ask before a large first download, then load the model with a progress readout. */
async function ensureModel(kind, label, current) {
  const plan = await subjectPlan(kind);
  if (!plan.cached && !confirmed[kind]) {
    const mb = Math.round(plan.bytes / 1e6);
    await new Promise((resolve) => {
      showStatus(
        `<strong>This mode needs the ${label} (${mb} MB).</strong><br><small>It downloads once from Hugging Face and stays in your browser. Your photo never leaves your device.${plan.device === "webgpu" ? "" : "<br>No WebGPU in this browser: it will run on the CPU, which is slower."}</small><br><button type="button" class="btn btn-primary btn-sm" style="margin-top:10px">Download ${mb} MB</button>`,
      );
      overlay.querySelector("button").onclick = () => {
        confirmed[kind] = true;
        resolve();
      };
    });
  }
  if (!current()) return;
  showStatus(`<div class="spinner"></div>Loading the ${label}…`);
  await loadSubjectModel(kind, {
    onDownload: (l, t) => {
      if (current())
        showStatus(`<div class="spinner"></div>Downloading the ${label}… ${Math.round((l / t) * 100)}%<br><small>${Math.round(l / 1e6)} of ${Math.round(t / 1e6)} MB, once.</small>`);
    },
  });
}

/** Mask for the current clicks, or null when nothing is marked to keep. */
async function pickRaw() {
  const groups = picks.filter((g) => g.length);
  if (!groups.some((g) => g.some((p) => p.keep))) return null;
  return pickMask(groups);
}

/** Re-run the selection after the clicks change; one request at a time, the latest clicks win. */
let pickBusy = false,
  pickAgain = false;
async function runPick() {
  if (pickBusy) {
    pickAgain = true;
    return;
  }
  pickBusy = true;
  try {
    do {
      pickAgain = false;
      const m = media;
      const raw = await pickRaw();
      if (media !== m || s.subject !== "pick") return;
      setStill(m, raw);
      if (raw) overlay.hidden = true;
      else showNote("Click what you want to keep.");
    } while (pickAgain);
  } catch (err) {
    console.error(err);
    toast(`Selection failed: ${err.message}`, "error", 7000);
  } finally {
    pickBusy = false;
  }
}

function setStill(m, raw) {
  if (!raw) {
    stillShown = false;
  } else {
    if (still.ready && stillPhoto === m) still.setMask(raw);
    else {
      still.setSource(m.el, raw);
      stillPhoto = m;
    }
    stillShown = true;
    updateStill();
  }
  syncCursor();
  renderBrushButtons();
  exportBar.refresh();
  stage.invalidate();
  drawMarks();
}

function keyOptions() {
  return {
    color: s.keyColor,
    tolerance: s.keyTolerance,
    softness: s.keySoftness,
    edgesOnly: s.keyEdges,
  };
}

function updateStill() {
  if (!still.ready) return;
  const mode = subject();
  // Auto polarity is a person heuristic; other modes already mark the subject.
  const polarity = mode !== "person" && s.polarity === "auto" ? "normal" : s.polarity;
  still.update(
    mode === "color"
      ? { threshold: 0.5, softness: 1, polarity, edgeSnap: false }
      : { threshold: s.threshold, softness: s.softness, polarity, edgeSnap: s.edgeSnap },
  );
  stage.invalidate();
  drawMarks();
}

const paint = () => new Promise((r) => setTimeout(r, 30));

/** Photos only need the play bar when a looping background video moves behind them. */
function syncTransport() {
  transportEl.hidden = isPhoto() && s.bg !== "video";
  if (transportEl.hidden) {
    stage.pause();
    stage.seek(0);
  }
}

function showStatus(html) {
  overlay.classList.remove("is-note");
  overlay.hidden = false;
  overlay.innerHTML = `<div>${html}</div>`;
}
function showNote(text) {
  overlay.classList.add("is-note");
  overlay.hidden = false;
  overlay.replaceChildren(h("div", {}, text));
}
function showIntro() {
  showStatus(
    "<strong>Drop a photo or video on the left.</strong><br>People, objects, logos or text: the background is removed on your device, nothing is uploaded.",
  );
}

/* ---------- Rendering ---------- */
const transparentOut = () =>
  s.bg === "transparent" && !(exportKind === "video" && !videoAlpha);

/** Average color (0..255) of a canvas region, weighted by alpha. Cheap: reads an 8×8 downscale. */
function average(src, name) {
  const c = scratch(`bgr-avg-${name}`, 8, 8);
  const cx = c.getContext("2d", { willReadFrequently: true });
  cx.clearRect(0, 0, 8, 8);
  cx.drawImage(src, 0, 0, 8, 8);
  const d = cx.getImageData(0, 0, 8, 8).data;
  let r = 0,
    g = 0,
    b = 0,
    a = 0;
  for (let i = 0; i < d.length; i += 4) {
    const w = d[i + 3];
    r += d[i] * w;
    g += d[i + 1] * w;
    b += d[i + 2] * w;
    a += w;
  }
  return a
    ? {
        r: r / a,
        g: g / a,
        b: b / a,
        lum: (0.299 * r + 0.587 * g + 0.114 * b) / a,
      }
    : null;
}

function drawBackground(c, W, H, k) {
  if (s.bg === "transparent") {
    if (!transparentOut()) {
      c.fillStyle = s.matte;
      c.fillRect(0, 0, W, H);
    }
    return;
  }
  if (s.bg === "color") {
    c.fillStyle = s.bgColor;
    c.fillRect(0, 0, W, H);
    return;
  }
  if (s.bg === "blur") {
    const pad = s.blur * k * 2;
    drawBlurred(c, media.el, -pad, -pad, W + pad * 2, H + pad * 2, s.blur * k);
  } else {
    const bg = bgSource();
    c.fillStyle = s.bgColor;
    c.fillRect(0, 0, W, H);
    if (bg) {
      const f = fit(bg.width, bg.height, W, H, s.bgFit);
      c.drawImage(bg.el, f.x, f.y, f.w, f.h);
    } else {
      // No upload yet: a soft placeholder gradient.
      const g = c.createLinearGradient(0, 0, W, H);
      g.addColorStop(0, "#3a2f7a");
      g.addColorStop(1, "#0f5f73");
      c.fillStyle = g;
      c.fillRect(0, 0, W, H);
    }
  }
  if (s.dim > 0) {
    c.fillStyle = `rgba(0,0,0,${s.dim})`;
    c.fillRect(0, 0, W, H);
  }
}

function render(t) {
  const W = canvas.width,
    H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!media) {
    ctx.fillStyle = "#111318";
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const k = Math.min(W, H) / 1080;
  const src = media.el;
  syncBgVideo(t);

  // 1. Background layer (kept separately so color matching can read it).
  const bgLayer = scratch(`bgr-bg-${W}x${H}`, W, H);
  const bctx = bgLayer.getContext("2d");
  bctx.clearRect(0, 0, W, H);
  drawBackground(bctx, W, H, k);

  // 2. Mask
  const alpha = personAlpha(t, W, H, k);
  if (!alpha) {
    // model still loading: show the original
    ctx.drawImage(src, 0, 0, W, H);
    return;
  }

  if (s.showMask) {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    ctx.drawImage(alpha, 0, 0);
    return;
  }

  // 3. Person layer: source → light/color match → cut out.
  const person = scratch(`bgr-person-${W}x${H}`, W, H);
  const pctx = person.getContext("2d");
  pctx.globalCompositeOperation = "source-over";
  pctx.clearRect(0, 0, W, H);
  const solidBg = s.bg !== "transparent";
  const bgAvg =
    solidBg && (s.match > 0 || s.wrap > 0) ? average(bgLayer, "bg") : null;
  if (bgAvg && s.match > 0 && supportsCanvasFilter) {
    // Brightness: move the person's average luminance part of the way toward the background's.
    const cut = scratch("bgr-avgcut", 64, 64),
      cc = cut.getContext("2d");
    cc.globalCompositeOperation = "source-over";
    cc.clearRect(0, 0, 64, 64);
    cc.drawImage(src, 0, 0, 64, 64);
    cc.globalCompositeOperation = "destination-in";
    cc.drawImage(alpha, 0, 0, 64, 64);
    const pAvg = average(cut, "person");
    if (pAvg && pAvg.lum > 1) {
      const ratio = Math.min(
        1.35,
        Math.max(0.65, (bgAvg.lum + 40) / (pAvg.lum + 40)),
      );
      pctx.filter = `brightness(${1 + (ratio - 1) * s.match})`;
    }
  }
  pctx.drawImage(src, 0, 0, W, H);
  pctx.filter = "none";
  if (bgAvg && s.match > 0) {
    pctx.globalCompositeOperation = "soft-light";
    pctx.fillStyle = `rgba(${bgAvg.r | 0},${bgAvg.g | 0},${bgAvg.b | 0},${0.55 * s.match})`;
    pctx.fillRect(0, 0, W, H);
  }
  pctx.globalCompositeOperation = "destination-in";
  pctx.drawImage(alpha, 0, 0);
  pctx.globalCompositeOperation = "source-over";

  // 4. Composite: background, person, then light wrap (blurred background on the person's edge band).
  ctx.drawImage(bgLayer, 0, 0);
  ctx.drawImage(person, 0, 0);
  if (solidBg && s.wrap > 0 && supportsCanvasFilter) {
    const wrap = scratch(`bgr-wrap-${W}x${H}`, W, H),
      wctx = wrap.getContext("2d");
    const r = Math.max(2, 14 * k);
    wctx.globalCompositeOperation = "source-over";
    wctx.clearRect(0, 0, W, H);
    wctx.filter = `blur(${r}px)`;
    wctx.drawImage(bgLayer, 0, 0); // background light, blurred
    wctx.filter = "none";
    wctx.globalCompositeOperation = "destination-in";
    wctx.drawImage(alpha, 0, 0); // only over the person…
    wctx.globalCompositeOperation = "destination-out";
    wctx.filter = `blur(${r}px)`;
    wctx.drawImage(alpha, 0, 0); // …minus their blurred interior = an edge band
    wctx.filter = "none";
    wctx.globalCompositeOperation = "source-over";
    ctx.save();
    ctx.globalAlpha = Math.min(1, s.wrap * 1.6);
    ctx.globalCompositeOperation = "screen";
    ctx.drawImage(wrap, 0, 0);
    ctx.restore();
  }
}

/** Full-size subject alpha for this frame, or null while there's no mask yet (the original shows). */
function personAlpha(t, W, H, k) {
  if (isPhoto())
    return still.ready && stillShown ? still.full(W, H, s.feather * k) : null;
  if (subject() === "color") return keyAlpha(W, H, k);
  const smoothing = exportKind === "gif" ? 0 : s.smoothing;
  if (!mask.update(segmenter, media.el, t, { model: s.model, smoothing }))
    return null;
  return mask.full(W, H, {
    threshold: s.threshold,
    softness: s.softness,
    polarity: s.polarity,
    feather: s.feather * k,
  });
}

/** Video color key: keyed at ≤ 640 px every frame, then upscaled and feathered. */
function keyAlpha(W, H, k) {
  const m = colorKey(media.el, keyOptions(), 640);
  const small = scratch("bgr-key-small", m.width, m.height);
  const sx = small.getContext("2d");
  const img = sx.createImageData(m.width, m.height);
  const invert = s.polarity === "invert";
  for (let i = 0, j = 0; i < m.data.length; i++, j += 4) {
    img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
    img.data[j + 3] = (invert ? 1 - m.data[i] : m.data[i]) * 255;
  }
  sx.putImageData(img, 0, 0);
  const c = scratch(`bgr-key-full-${W}x${H}`, W, H);
  const fx = c.getContext("2d");
  fx.clearRect(0, 0, W, H);
  fx.imageSmoothingEnabled = true;
  fx.imageSmoothingQuality = "high";
  if (s.feather > 0 && supportsCanvasFilter) fx.filter = `blur(${s.feather * k}px)`;
  fx.drawImage(small, 0, 0, W, H);
  fx.filter = "none";
  return c;
}

function isVideo() {
  return media?.kind === "video";
}
function isPhoto() {
  return media?.kind === "image";
}
/** A photo only moves (and so only makes a GIF or video) over a background video. */
const moving = () => isVideo() || (isPhoto() && s.bg === "video");
const duration = () => (isVideo() ? media.duration : media ? s.clip : 1);

const stage = createStage({
  canvas,
  transport: document.getElementById("transport"),
  render,
  getDuration: duration,
  getVideo: () => (isVideo() ? media.el : null),
});
stage.events.addEventListener("tick", () => {
  if (!stage.playing) syncBgVideo(stage.time);
});

let savedSize = null;
const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename: () =>
    `${(media?.name || "clip").replace(/\.[^.]+$/, "")}-${s.bg === "transparent" ? "no-bg" : "new-bg"}`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media && moving(),
  gif: () => !!media && moving(),
  png: () => !!media,
  hint: () => {
    if (!media) return "";
    if (isPhoto()) {
      const tip = moving()
        ? "PNG saves the full-resolution still; GIF and video play the background video behind the person."
        : "PNG saves the full-resolution photo.";
      return s.bg === "transparent" ? `${TRANSPARENT_HINT} ${tip}` : tip;
    }
    if (s.bg !== "transparent")
      return "Export runs in real time; segmentation happens on every frame.";
    return `${TRANSPARENT_HINT}${videoAlpha ? "" : " Video export here uses the matte color."}`;
  },
  beforeExport: (kind) => {
    if (isPhoto() && !(still.ready && stillShown))
      throw new Error(
        s.subject === "pick"
          ? "Click what you want to keep on the preview first."
          : "Still finding the subject. Try again in a moment.",
      );
    if (isVideo() && subject() === "person" && !segmenter && !modelError)
      throw new Error(
        "The segmentation model is still loading. Try again in a moment.",
      );
    if (kind === "video" && s.bg === "transparent" && !videoAlpha) {
      toast(
        "This browser can’t record transparent video, so the matte color is used as the background. Use Chrome or Edge for a transparent WebM.",
        "warning",
        7000,
      );
    }
    exportKind = kind;
    mask.prev = null;
    // Photos preview at full resolution; video encoders want at most 1920 px.
    if (kind === "video" && Math.max(canvas.width, canvas.height) > 1920) {
      savedSize = [canvas.width, canvas.height];
      const { w, h } = outputSize(canvas.width, canvas.height, 1920);
      canvas.width = w;
      canvas.height = h;
    }
    stage.invalidate();
  },
  afterExport: () => {
    exportKind = null;
    drawMarks();
    mask.prev = null;
    if (savedSize) {
      [canvas.width, canvas.height] = savedSize;
      savedSize = null;
    }
    stage.invalidate();
  },
  // GIF frames are seeked one by one: park the background video on the matching frame first.
  prepareFrame: async (t) => {
    if (s.bg === "video" && bgMedia?.kind === "video")
      await seekVideo(bgMedia.el, bgTarget(t));
  },
});

/* ---------- On the preview: click to pick, sample the key color, brush ---------- */
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return {
    x: ((e.clientX - r.left) / r.width) * canvas.width,
    y: ((e.clientY - r.top) / r.height) * canvas.height,
  };
};
/** Canvas px per CSS px, so marks keep their on-screen size. */
const pxScale = () =>
  canvas.width / (canvas.getBoundingClientRect().width || canvas.width);
function brushActive() {
  return isPhoto() && still.ready && stillShown && s.brush !== "off";
}
const picking = () => isPhoto() && s.subject === "pick" && pickPhoto === media;
/** Crosshair while the preview takes clicks (brush, click to pick, color sampling). */
function syncCursor() {
  canvas.classList.toggle("bgr-brushing", brushActive());
  canvas.classList.toggle("bgr-picking", !!media && (subject() === "color" || (isPhoto() && s.subject === "pick")));
}

function renderPickButtons() {
  const clicks = picks.reduce((n, g) => n + g.length, 0);
  const objects = picks.filter((g) => g.some((p) => p.keep)).length;
  const btn = (label, ic, onClick, enabled) =>
    h("button", { type: "button", class: "btn btn-sm", html: `${icon(ic)} ${label}`, disabled: !enabled, onclick: onClick });
  pickEl.replaceChildren(
    btn("New object", "plus", () => { picks.push([]); afterPick(); }, picks[picks.length - 1].length > 0),
    btn("Undo click", "restart", undoPick, clicks > 0),
    btn("Clear", "trash", () => { picks = [[]]; afterPick(); }, clicks > 0),
    h("div", { class: "ctrl-hint" },
      clicks ? `${objects} object${objects === 1 ? "" : "s"} · ${clicks} click${clicks === 1 ? "" : "s"}` : "No clicks yet."),
  );
}
function undoPick() {
  if (!picks[picks.length - 1].length && picks.length > 1) picks.pop();
  picks[picks.length - 1].pop();
  afterPick();
}
function afterPick() {
  renderPickButtons();
  drawMarks();
  if (picking()) runPick();
}

function renderBrushButtons() {
  const btn = (label, ic, onClick, enabled) =>
    h("button", { type: "button", class: "btn btn-sm", html: `${icon(ic)} ${label}`, disabled: !enabled, onclick: onClick });
  brushEl.replaceChildren(
    btn("Undo", "restart", () => { still.undo(); afterEdit(); }, still.canUndo),
    btn("Redo", "arrow", () => { still.redo(); afterEdit(); }, still.canRedo),
    btn("Reset edits", "trash", () => { still.clearEdits(); afterEdit(); }, still.edited),
  );
}
function afterEdit() {
  renderBrushButtons();
  stage.invalidate();
  drawMarks();
}

/** The source pixel under a canvas point, as #rrggbb. */
function sampleColor(p) {
  const src = media.el;
  const sw = src.naturalWidth || src.videoWidth || src.width;
  const sh = src.naturalHeight || src.videoHeight || src.height;
  const c = scratch("bgr-sample", 1, 1);
  const x = c.getContext("2d", { willReadFrequently: true });
  x.clearRect(0, 0, 1, 1);
  x.drawImage(src, Math.floor((p.x / canvas.width) * sw), Math.floor((p.y / canvas.height) * sh), 1, 1, 0, 0, 1, 1);
  const d = x.getImageData(0, 0, 1, 1).data;
  return hex([d[0], d[1], d[2]]);
}

let stroke = null,
  pointer = null;
canvas.addEventListener("pointerdown", (e) => {
  if (!media || exportKind || e.button > 0) return;
  const p = toCanvas(e);
  if (brushActive()) {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    const f = still.width / canvas.width,
      k = Math.min(canvas.width, canvas.height) / 1080;
    still.beginStroke(s.brush, (s.brushSize * k * f) / 2, s.brushSoft);
    still.strokeTo(p.x * f, p.y * f);
    stroke = { f };
    stage.invalidate();
    return;
  }
  if (picking()) {
    e.preventDefault();
    const keep = (s.pickMode === "keep") !== e.altKey;
    picks[picks.length - 1].push({ x: p.x / canvas.width, y: p.y / canvas.height, keep });
    afterPick();
    return;
  }
  if (subject() === "color") {
    e.preventDefault();
    panel.set({ keyColor: sampleColor(p) });
  }
});
canvas.addEventListener("pointermove", (e) => {
  const p = toCanvas(e);
  pointer = p;
  if (stroke) {
    still.strokeTo(p.x * stroke.f, p.y * stroke.f);
    stage.invalidate();
  }
  if (brushActive()) drawMarks();
});
const endPointer = () => {
  if (stroke) {
    still.endStroke();
    stroke = null;
    afterEdit();
  }
};
canvas.addEventListener("pointerup", endPointer);
canvas.addEventListener("pointercancel", endPointer);
canvas.addEventListener("pointerleave", () => {
  pointer = null;
  if (brushActive()) drawMarks();
});

document.addEventListener("keydown", (e) => {
  if (!(e.ctrlKey || e.metaKey) || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  const key = e.key.toLowerCase();
  if (brushActive()) {
    if (key === "z" && !e.shiftKey) { e.preventDefault(); still.undo(); afterEdit(); }
    else if ((key === "z" && e.shiftKey) || key === "y") { e.preventDefault(); still.redo(); afterEdit(); }
  } else if (picking() && key === "z" && !e.shiftKey) {
    e.preventDefault();
    undoPick();
  }
});

/** Click points (Click to pick) and the brush cursor + mask tint. A separate canvas: no export includes it. */
function drawMarks() {
  const W = canvas.width,
    H = canvas.height;
  if (marks.width !== W || marks.height !== H) {
    marks.width = W;
    marks.height = H;
  }
  mctx.clearRect(0, 0, W, H);
  if (!media || exportKind) return;
  const q = pxScale();
  if (brushActive()) {
    const tint = scratch("bgr-brush-tint", still.width, still.height);
    const tx = tint.getContext("2d");
    tx.globalCompositeOperation = "source-over";
    tx.clearRect(0, 0, tint.width, tint.height);
    tx.drawImage(still.canvas, 0, 0);
    tx.globalCompositeOperation = "source-in";
    tx.fillStyle = "rgb(124,108,255)";
    tx.fillRect(0, 0, tint.width, tint.height);
    mctx.globalAlpha = 0.45;
    mctx.drawImage(tint, 0, 0, W, H);
    mctx.globalAlpha = 1;
    if (pointer) {
      const k = Math.min(W, H) / 1080,
        r = (s.brushSize * k) / 2;
      mctx.lineWidth = 1.5 * q;
      mctx.strokeStyle = "rgba(0,0,0,.6)";
      mctx.beginPath();
      mctx.arc(pointer.x, pointer.y, r + q, 0, Math.PI * 2);
      mctx.stroke();
      mctx.strokeStyle = s.brush === "add" ? "#ffffff" : "#ff6b6b";
      mctx.beginPath();
      mctx.arc(pointer.x, pointer.y, r, 0, Math.PI * 2);
      mctx.stroke();
    }
  }
  if (!isPhoto() || s.subject !== "pick") return;
  const multi = picks.filter((g) => g.length).length > 1;
  picks.forEach((g, gi) =>
    g.forEach((pt) => {
      const x = pt.x * W,
        y = pt.y * H,
        r = 8 * q;
      mctx.fillStyle = pt.keep ? "#2fbf71" : "#e5484d";
      mctx.strokeStyle = "#fff";
      mctx.lineWidth = 2 * q;
      mctx.beginPath();
      mctx.arc(x, y, r, 0, Math.PI * 2);
      mctx.fill();
      mctx.stroke();
      mctx.beginPath(); // + or −
      mctx.moveTo(x - r * 0.5, y);
      mctx.lineTo(x + r * 0.5, y);
      if (pt.keep) {
        mctx.moveTo(x, y - r * 0.5);
        mctx.lineTo(x, y + r * 0.5);
      }
      mctx.stroke();
      if (multi) {
        mctx.font = `600 ${12 * q}px system-ui, sans-serif`;
        mctx.lineWidth = 3 * q;
        mctx.strokeStyle = "rgba(0,0,0,.7)";
        mctx.strokeText(String(gi + 1), x + r + 2 * q, y - r);
        mctx.fillStyle = "#fff";
        mctx.fillText(String(gi + 1), x + r + 2 * q, y - r);
      }
    }),
  );
}

/** Keep the marks canvas exactly on top of the (CSS-scaled) preview canvas. */
function placeMarks() {
  Object.assign(marks.style, {
    left: `${canvas.offsetLeft}px`,
    top: `${canvas.offsetTop}px`,
    width: `${canvas.offsetWidth}px`,
    height: `${canvas.offsetHeight}px`,
  });
  drawMarks();
}
new ResizeObserver(placeMarks).observe(canvas);
window.addEventListener("resize", placeMarks);

canvas.width = 1280;
canvas.height = 720;
showIntro();
loadSegmenter(s.model)
  .then((seg) => {
    if (s.model === "landscape" && !segmenter) segmenter = seg;
  })
  .catch(() => {});
