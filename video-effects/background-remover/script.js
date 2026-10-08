/*
 * Background Remover: segment the person on every frame and replace the background
 * (transparent, color, blur, image or a looping video), with feathering, temporal smoothing and color matching.

 *
 * Per frame: background layer → mask.update (lib/person-mask.js) → person layer (source, light/color match,
 * cut out by the mask) → composite. Exports: transparent WebM keeps alpha in Chromium (canRecordAlpha);
 * elsewhere the matte color is recorded instead, with a warning.
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
import { toast } from "/assets/js/lib/dom.js";
import {
  SEGMENT_MODELS as MODELS,
  loadSegmenter,
} from "/assets/js/lib/vision.js";
import { createPersonMask } from "/assets/js/lib/person-mask.js";

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const videoAlpha = canRecordAlpha();

let media = null; // the person video/image
let bgMedia = null; // uploaded background image or video
let segmenter = null;
let modelError = null;
let exportKind = null; // 'video' | 'gif' while exporting

const bgImageZone = document.createElement("div");
const bgVideoZone = document.createElement("div");

/* ---------- Controls ---------- */
const panel = createControls(
  document.getElementById("controls"),
  [
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
          hint: "Higher keeps less of the person; lower keeps more.",
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
          hint: "Nudges the person’s brightness and tint toward the new background.",
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
          hint: "Lets background light spill onto the edges of the person.",
        },
      ],
    },
    {
      title: "Clip",
      showIf: () => media?.kind === "image",
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
      if (id === "bg") syncBgVideo(stage.time, true);
      canvas.classList.toggle("checker", s.bg === "transparent");
      exportBar.refresh();
      stage.invalidate();
    },
  },
);
const s = panel.state;

/* ---------- Uploads ---------- */
createDropzone(document.getElementById("upload"), {
  accept: ["video", "image"],
  label: "Drop a video of a person",
  onLoad: (m) => {
    media = m;
    const { w, h } = outputSize(m.width, m.height, 1920);
    canvas.width = w;
    canvas.height = h;
    mask.reset();
    panel.refresh();
    stage.reset();
    exportBar.refresh();
    overlay.hidden = true;
    if (segmenter) stage.play().catch(() => {});
    else initModel();
  },
  onClear: () => {
    media = null;
    mask.reset();
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

function showStatus(html) {
  overlay.classList.remove("is-note");
  overlay.hidden = false;
  overlay.innerHTML = `<div>${html}</div>`;
}
function showIntro() {
  showStatus(
    "<strong>Drop a video of a person on the left.</strong><br>The background is removed on your device: nothing is uploaded.",
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
  const smoothing = exportKind === "gif" ? 0 : s.smoothing;
  const haveMask = mask.update(segmenter, src, t, {
    model: s.model,
    smoothing,
    still: media.kind !== "video",
  });
  if (!haveMask) {
    // model still loading: show the original
    ctx.drawImage(src, 0, 0, W, H);
    return;
  }
  const alpha = mask.full(W, H, {
    threshold: s.threshold,
    softness: s.softness,
    polarity: s.polarity,
    feather: s.feather * k,
  });

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

const isVideo = () => media?.kind === "video";
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

const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename: () =>
    `${(media?.name || "clip").replace(/\.[^.]+$/, "")}-${s.bg === "transparent" ? "no-bg" : "new-bg"}`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  hint: () => {
    if (!media) return "";
    if (s.bg !== "transparent")
      return "Export runs in real time; segmentation happens on every frame.";
    return `${TRANSPARENT_HINT}${videoAlpha ? "" : " Video export here uses the matte color."}`;
  },
  beforeExport: (kind) => {
    if (!segmenter && !modelError)
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
    stage.invalidate();
  },
  afterExport: () => {
    exportKind = null;
    mask.prev = null;
    stage.invalidate();
  },
  // GIF frames are seeked one by one: park the background video on the matching frame first.
  prepareFrame: async (t) => {
    if (s.bg === "video" && bgMedia?.kind === "video")
      await seekVideo(bgMedia.el, bgTarget(t));
  },
});

canvas.width = 1280;
canvas.height = 720;
showIntro();
loadSegmenter(s.model)
  .then((seg) => {
    if (s.model === "landscape" && !segmenter) segmenter = seg;
  })
  .catch(() => {});
