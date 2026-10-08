/*
 * Retro Looks: VHS, CRT, film grain, 8mm, dithering and ASCII art as stackable WebGL effects.

 *
 * render(t): source frame (video, image or the built-in demo) → engine.render(passes) → copied onto
 * the 2D preview. Every effect is seeded from the frame index (24 fps), so preview and export match.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { createDropzone } from "/assets/js/lib/upload.js";
import { createStage } from "/assets/js/lib/stage.js";
import { createExportBar } from "/assets/js/lib/exporter.js";
import { outputSize, scratch, linearGradient } from "/assets/js/lib/canvas.js";
import { ensureFont, fontString } from "/assets/js/lib/fonts.js";
import { createRetroEngine } from "./engine.js";
import { EFFECTS, PALETTES, CHARSETS, buildAtlas } from "./effects.js";

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");
const overlay = document.getElementById("overlay");
const engine = createRetroEngine();
let media = null;

const today = new Date();
const MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
];
const defaultDate = `${MONTHS[today.getMonth()]}. ${String(today.getDate()).padStart(2, "0")} ${today.getFullYear()}`;

/* ---------- Presets: each one switches a stack of effects on with matching settings ---------- */
const OFF = {
  ditherOn: false,
  asciiOn: false,
  filmOn: false,
  mmOn: false,
  vhsOn: false,
  crtOn: false,
};
const PRESETS = [
  {
    label: "VHS",
    value: "vhs",
    patch: {
      ...OFF,
      vhsOn: true,
      vhsOsd: true,
      vhsBleed: 6,
      vhsTracking: 0.6,
      vhsNoise: 0.35,
      vhsWobble: 0.6,
      vhsSat: 0.85,
    },
  },
  {
    label: "CRT",
    value: "crt",
    patch: {
      ...OFF,
      crtOn: true,
      crtCurve: 0.6,
      crtScan: 0.6,
      crtMask: 0.35,
      crtGlow: 0.5,
    },
  },
  {
    label: "VHS on a CRT",
    value: "vhscrt",
    patch: {
      ...OFF,
      vhsOn: true,
      vhsOsd: true,
      crtOn: true,
      crtCurve: 0.5,
      crtScan: 0.5,
    },
  },
  {
    label: "Old film",
    value: "film",
    patch: {
      ...OFF,
      filmOn: true,
      filmGrain: 0.18,
      filmDust: 0.5,
      filmScratch: 0.35,
      filmFlicker: 0.12,
      filmVignette: 0.6,
      filmFade: 0.8,
    },
  },
  {
    label: "8mm home movie",
    value: "mm8",
    patch: {
      ...OFF,
      mmOn: true,
      filmOn: true,
      filmGrain: 0.08,
      filmDust: 0.25,
      filmScratch: 0.1,
      filmFade: 0,
      filmVignette: 0.2,
    },
  },
  {
    label: "Handheld (4 greens)",
    value: "handheld",
    patch: {
      ...OFF,
      ditherOn: true,
      palette: "handheld",
      ditherPixel: 6,
      ditherSpread: 1,
    },
  },
  {
    label: "1-bit",
    value: "bw",
    patch: {
      ...OFF,
      ditherOn: true,
      palette: "bw",
      ditherPixel: 3,
      ditherSpread: 1,
    },
  },
  {
    label: "ASCII",
    value: "ascii",
    patch: { ...OFF, asciiOn: true, asciiColor: "color", charset: "classic" },
  },
  {
    label: "Terminal",
    value: "term",
    patch: {
      ...OFF,
      asciiOn: true,
      asciiColor: "mono",
      asciiFg: "#33ff66",
      asciiBg: "#020a04",
      charset: "dense",
      crtOn: true,
      crtCurve: 0.4,
      crtScan: 0.4,
      crtGlow: 0.6,
      crtMask: 0,
    },
  },
];

const on = (k) => (s) => s[k];
const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Look",
      controls: [
        {
          id: "preset",
          type: "presets",
          label: "Presets",
          value: "vhs",
          options: PRESETS,
        },
        {
          id: "clip",
          type: "range",
          label: "Clip length (images)",
          min: 1,
          max: 20,
          step: 0.5,
          value: 6,
          unit: "s",
          decimals: 1,
          showIf: () => !isVideo(),
        },
      ],
    },
    {
      title: "Dithering",
      controls: [
        { id: "ditherOn", type: "toggle", label: "Enable", value: false },
        {
          id: "palette",
          type: "select",
          label: "Palette",
          value: "handheld",
          options: Object.entries(PALETTES).map(([k, p]) => [k, p.label]),
          showIf: on("ditherOn"),
        },
        {
          id: "duoDark",
          type: "color",
          label: "Dark",
          value: "#1b1035",
          showIf: (s) => s.ditherOn && s.palette === "duotone",
        },
        {
          id: "duoLight",
          type: "color",
          label: "Light",
          value: "#ff9ec7",
          showIf: (s) => s.ditherOn && s.palette === "duotone",
        },
        {
          id: "ditherPixel",
          type: "range",
          label: "Pixel size",
          min: 1,
          max: 16,
          value: 6,
          unit: "px",
          showIf: on("ditherOn"),
        },
        {
          id: "ditherSpread",
          type: "range",
          label: "Dither",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 1,
          decimals: 2,
          showIf: on("ditherOn"),
        },
        {
          id: "ditherContrast",
          type: "range",
          label: "Contrast",
          min: 0.5,
          max: 2,
          step: 0.05,
          value: 1.15,
          decimals: 2,
          showIf: on("ditherOn"),
        },
        {
          id: "ditherBright",
          type: "range",
          label: "Brightness",
          min: -0.4,
          max: 0.4,
          step: 0.02,
          value: 0,
          decimals: 2,
          showIf: on("ditherOn"),
        },
      ],
    },
    {
      title: "ASCII art",
      controls: [
        { id: "asciiOn", type: "toggle", label: "Enable", value: false },
        {
          id: "charset",
          type: "select",
          label: "Characters",
          value: "classic",
          options: [
            ...Object.entries(CHARSETS).map(([k, c]) => [k, c.label]),
            ["custom", "Custom…"],
          ],
          showIf: on("asciiOn"),
        },
        {
          id: "customChars",
          type: "text",
          label: "Custom characters",
          value: " .oO@",
          showIf: (s) => s.asciiOn && s.charset === "custom",
          hint: "Any characters; they’re sorted by how much ink they use.",
        },
        {
          id: "asciiCell",
          type: "range",
          label: "Character size",
          min: 4,
          max: 40,
          value: 12,
          unit: "px",
          showIf: on("asciiOn"),
        },
        {
          id: "asciiColor",
          type: "segmented",
          label: "Color",
          value: "color",
          options: [
            ["color", "Video colors"],
            ["mono", "Mono"],
          ],
          showIf: on("asciiOn"),
        },
        {
          id: "asciiFg",
          type: "color",
          label: "Text",
          value: "#ffffff",
          showIf: (s) => s.asciiOn && s.asciiColor === "mono",
        },
        {
          id: "asciiBg",
          type: "color",
          label: "Background",
          value: "#000000",
          showIf: on("asciiOn"),
        },
        {
          id: "asciiGamma",
          type: "range",
          label: "Gamma",
          min: 0.4,
          max: 2,
          step: 0.05,
          value: 0.9,
          decimals: 2,
          showIf: on("asciiOn"),
        },
        {
          id: "asciiBoost",
          type: "range",
          label: "Color boost",
          min: 0.5,
          max: 2.5,
          step: 0.05,
          value: 1.4,
          decimals: 2,
          showIf: (s) => s.asciiOn && s.asciiColor === "color",
        },
      ],
    },
    {
      title: "Film grain & dust",
      controls: [
        { id: "filmOn", type: "toggle", label: "Enable", value: false },
        {
          id: "filmGrain",
          type: "range",
          label: "Grain",
          min: 0,
          max: 0.5,
          step: 0.01,
          value: 0.15,
          decimals: 2,
          showIf: on("filmOn"),
        },
        {
          id: "filmDust",
          type: "range",
          label: "Dust",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.4,
          decimals: 2,
          showIf: on("filmOn"),
        },
        {
          id: "filmScratch",
          type: "range",
          label: "Scratches",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.3,
          decimals: 2,
          showIf: on("filmOn"),
        },
        {
          id: "filmFlicker",
          type: "range",
          label: "Flicker",
          min: 0,
          max: 0.4,
          step: 0.01,
          value: 0.1,
          decimals: 2,
          showIf: on("filmOn"),
        },
        {
          id: "filmVignette",
          type: "range",
          label: "Vignette",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 0.5,
          decimals: 2,
          showIf: on("filmOn"),
        },
        {
          id: "filmFade",
          type: "range",
          label: "Faded sepia",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.6,
          decimals: 2,
          showIf: on("filmOn"),
        },
      ],
    },
    {
      title: "8mm",
      controls: [
        { id: "mmOn", type: "toggle", label: "Enable", value: false },
        {
          id: "mmWarm",
          type: "range",
          label: "Warm tone",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.7,
          decimals: 2,
          showIf: on("mmOn"),
        },
        {
          id: "mmVignette",
          type: "range",
          label: "Vignette",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 0.8,
          decimals: 2,
          showIf: on("mmOn"),
        },
        {
          id: "mmFlicker",
          type: "range",
          label: "Flicker",
          min: 0,
          max: 0.5,
          step: 0.01,
          value: 0.14,
          decimals: 2,
          showIf: on("mmOn"),
        },
        {
          id: "mmWeave",
          type: "range",
          label: "Gate weave",
          min: 0,
          max: 2,
          step: 0.05,
          value: 0.8,
          decimals: 2,
          showIf: on("mmOn"),
        },
        {
          id: "mmSoft",
          type: "range",
          label: "Softness",
          min: 0,
          max: 6,
          step: 0.1,
          value: 1.5,
          unit: "px",
          decimals: 1,
          showIf: on("mmOn"),
        },
        {
          id: "mmGrain",
          type: "range",
          label: "Grain",
          min: 0,
          max: 0.4,
          step: 0.01,
          value: 0.12,
          decimals: 2,
          showIf: on("mmOn"),
        },
        {
          id: "mmGate",
          type: "toggle",
          label: "Rounded film gate",
          value: true,
          showIf: on("mmOn"),
        },
      ],
    },
    {
      title: "VHS",
      controls: [
        { id: "vhsOn", type: "toggle", label: "Enable", value: true },
        {
          id: "vhsBleed",
          type: "range",
          label: "Color bleed",
          min: 0,
          max: 20,
          step: 0.5,
          value: 6,
          unit: "px",
          decimals: 1,
          showIf: on("vhsOn"),
        },
        {
          id: "vhsTracking",
          type: "range",
          label: "Tracking lines",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.6,
          decimals: 2,
          showIf: on("vhsOn"),
        },
        {
          id: "vhsNoise",
          type: "range",
          label: "Noise",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.35,
          decimals: 2,
          showIf: on("vhsOn"),
        },
        {
          id: "vhsWobble",
          type: "range",
          label: "Line wobble",
          min: 0,
          max: 2,
          step: 0.05,
          value: 0.6,
          decimals: 2,
          showIf: on("vhsOn"),
        },
        {
          id: "vhsSat",
          type: "range",
          label: "Color",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 0.85,
          decimals: 2,
          showIf: on("vhsOn"),
        },
        {
          id: "vhsOsd",
          type: "toggle",
          label: "Timestamp",
          value: true,
          showIf: on("vhsOn"),
        },
        {
          id: "vhsDate",
          type: "text",
          label: "Date",
          value: defaultDate,
          showIf: (s) => s.vhsOn && s.vhsOsd,
        },
        {
          id: "vhsClock",
          type: "text",
          label: "Start time",
          value: "AM 10:24",
          showIf: (s) => s.vhsOn && s.vhsOsd,
          hint: "Seconds count up from here as the clip plays.",
        },
        {
          id: "vhsPlay",
          type: "toggle",
          label: 'Show "PLAY"',
          value: true,
          showIf: (s) => s.vhsOn && s.vhsOsd,
        },
      ],
    },
    {
      title: "CRT",
      controls: [
        { id: "crtOn", type: "toggle", label: "Enable", value: false },
        {
          id: "crtCurve",
          type: "range",
          label: "Curvature",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 0.6,
          decimals: 2,
          showIf: on("crtOn"),
        },
        {
          id: "crtScan",
          type: "range",
          label: "Scanlines",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.6,
          decimals: 2,
          showIf: on("crtOn"),
        },
        {
          id: "crtScanSize",
          type: "range",
          label: "Line spacing",
          min: 2,
          max: 12,
          step: 0.5,
          value: 4,
          unit: "px",
          decimals: 1,
          showIf: on("crtOn"),
        },
        {
          id: "crtMask",
          type: "range",
          label: "RGB mask",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.35,
          decimals: 2,
          showIf: on("crtOn"),
        },
        {
          id: "crtGlow",
          type: "range",
          label: "Glow",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 0.5,
          decimals: 2,
          showIf: on("crtOn"),
        },
        {
          id: "crtVignette",
          type: "range",
          label: "Vignette",
          min: 0,
          max: 1.5,
          step: 0.05,
          value: 0.6,
          decimals: 2,
          showIf: on("crtOn"),
        },
      ],
    },
  ],
  {
    onChange: (st, id) => {
      if (["charset", "customChars", "preset"].includes(id)) rebuildAtlas();
      updateHint();
      exportBar.refresh();
      stage.invalidate();
    },
  },
);
const s = panel.state;
function isVideo() {
  return media?.kind === "video";
}

/* ---------- Upload ---------- */
createDropzone(document.getElementById("upload"), {
  accept: ["video", "image"],
  label: "Drop a video or image",
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
  const src = media || { width: 1280, height: 720 };
  const { w, h } = outputSize(src.width, src.height, 1920);
  canvas.width = w;
  canvas.height = h;
  panel.refresh();
  stage.reset();
  exportBar.refresh();
  updateHint();
  stage.play().catch(() => {});
}

/* ---------- ASCII atlas ---------- */
const env = {
  atlas: null,
  atlasVersion: 0,
  osd: { canvas: document.createElement("canvas"), version: 0 },
};
function rebuildAtlas() {
  const chars =
    s.charset === "custom" ? s.customChars || " ." : CHARSETS[s.charset].chars;
  const key = `${chars}|Space Mono`;
  if (env.atlasKey === key) return;
  env.atlasKey = key;
  env.atlas = buildAtlas(chars.length >= 2 ? chars : ` ${chars}`, "Space Mono");
  env.atlasVersion++;
}

/* ---------- VHS on-screen display (camcorder text, composited inside the VHS pass) ---------- */
function drawOsd(t, W, H) {
  const c = env.osd.canvas;
  const w = Math.round(W / 2),
    h = Math.round(H / 2); // half resolution is plenty for blurry tape text
  if (c.width !== w || c.height !== h) {
    c.width = w;
    c.height = h;
  }
  const g = c.getContext("2d");
  g.clearRect(0, 0, w, h);
  const k = Math.min(w, h) / 540;
  const size = 34 * k;
  g.font = fontString("VT323", 400, size);
  g.textBaseline = "alphabetic";
  const text = (str, x, y) => {
    g.fillStyle = "rgba(0,0,0,.55)";
    g.fillText(str, x + 2 * k, y + 2 * k);
    g.fillStyle = "#ffffff";
    g.fillText(str, x, y);
  };
  const m = 34 * k;
  if (s.vhsPlay) text("PLAY ▶", m, m + size);
  // Clock: "AM 10:24" + elapsed seconds.
  const match = /^(AM|PM)?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?$/i.exec(
    s.vhsClock.trim(),
  );
  let clock = s.vhsClock;
  if (match) {
    const base =
      +match[2] * 3600 + +match[3] * 60 + +(match[4] || 0) + Math.floor(t);
    const hh = Math.floor(base / 3600) % 24,
      mm = Math.floor(base / 60) % 60,
      ss = base % 60;
    clock = `${match[1] ? `${match[1].toUpperCase()} ` : ""}${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  text(clock, m, h - m - size * 1.05);
  text(s.vhsDate, m, h - m);
  env.osd.version++;
}

/* ---------- Built-in demo (shown until something is uploaded) ---------- */
function drawDemo(t, W, H) {
  const c = scratch("retro-demo", W, H);
  const g = c.getContext("2d");
  g.fillStyle = linearGradient(g, W, H, 90, ["#1d1b4b", "#c2447a", "#ffb36b"]);
  g.fillRect(0, 0, W, H);
  // Sun with stripes
  const cx = W / 2,
    cy = H * 0.58,
    r = H * 0.26;
  g.save();
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.clip();
  g.fillStyle = linearGradient(g, W, H, 90, ["#ffe66d", "#ff6b6b"]);
  g.fillRect(cx - r, cy - r, r * 2, r * 2);
  g.fillStyle = "#c2447a";
  for (let i = 0; i < 6; i++)
    g.fillRect(
      cx - r,
      cy + r * (0.1 + i * 0.16) - ((t * 20) % (r * 0.16)) * 0.3,
      r * 2,
      r * 0.03 * (i + 1),
    );
  g.restore();
  // Grid floor
  g.fillStyle = "#120c2c";
  g.fillRect(0, H * 0.7, W, H * 0.3);
  g.strokeStyle = "#ff4fd8";
  g.lineWidth = Math.max(1, H / 360);
  for (let i = 0; i < 12; i++) {
    const y = H * 0.7 + H * 0.3 * (i / 12 + ((t * 0.25) % (1 / 12))) ** 2 * 1.0;
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(W, y);
    g.stroke();
  }
  for (let i = -10; i <= 10; i++) {
    g.beginPath();
    g.moveTo(cx + i * W * 0.02, H * 0.7);
    g.lineTo(cx + i * W * 0.16, H);
    g.stroke();
  }
  g.fillStyle = "#ffffff";
  g.font = fontString("Inter", 900, H * 0.11);
  g.textAlign = "center";
  g.fillText("RETRO", cx, H * 0.26 + Math.sin(t * 2) * H * 0.01);
  return c;
}

/* ---------- Rendering ---------- */
function render(t) {
  const W = canvas.width,
    H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const source = media ? media.el : drawDemo(t, W, H);
  if (!engine) {
    ctx.drawImage(source, 0, 0, W, H);
    return;
  }
  // Upload the frame at output size (videos larger than 1920 are downscaled first).
  let frameSrc = source;
  if (media && (media.width !== W || media.height !== H)) {
    const sc = scratch(`retro-src-${W}x${H}`, W, H);
    const sctx = sc.getContext("2d");
    sctx.drawImage(source, 0, 0, W, H);
    frameSrc = sc;
  }
  if (s.vhsOn && s.vhsOsd) drawOsd(t, W, H);
  const k = Math.min(W, H) / 1080;
  const fx = {
    ditherOn: "dither",
    asciiOn: "ascii",
    filmOn: "film",
    mmOn: "mm8",
    vhsOn: "vhs",
    crtOn: "crt",
  };
  const enabled = new Set(
    Object.entries(fx)
      .filter(([key]) => s[key])
      .map(([, id]) => id),
  );
  const passes = EFFECTS.filter((e) => enabled.has(e.id)).map((e) => ({
    id: e.id,
    glsl: e.glsl,
    uniforms: e.uniforms(s, env),
    textures: e.textures?.(s, env),
  }));
  const out = engine.render(frameSrc, W, H, passes, {
    time: t,
    frame: Math.floor(t * 24),
    k,
  });
  if (out) ctx.drawImage(out, 0, 0);
  else ctx.drawImage(source, 0, 0, W, H);
}

function updateHint() {
  if (!engine) {
    overlay.hidden = false;
    overlay.classList.add("is-note");
    overlay.innerHTML =
      "<div><strong>WebGL isn’t available in this browser</strong>, so the effects can’t run. The preview shows the original.</div>";
    return;
  }
  overlay.hidden = !!media;
  if (!media) {
    overlay.classList.add("is-note");
    overlay.innerHTML =
      "<div><strong>Showing a demo.</strong> Drop a video or image on the left. Effects stack in the order listed.</div>";
  }
}

const stage = createStage({
  canvas,
  transport: document.getElementById("transport"),
  render,
  getDuration: () => (isVideo() ? media.duration : s.clip),
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename: () =>
    `${(media?.name || "retro").replace(/\.[^.]+$/, "")}-${s.preset || "retro"}`,
  getVideo: () => (isVideo() ? media.el : null),
  hint: () =>
    s.ditherOn && !s.asciiOn
      ? "Tip: GIF at full width keeps dithered pixels crisp."
      : "",
});

rebuildAtlas();
onMedia();
ensureFont("VT323", 400, () => stage.invalidate());
ensureFont("Space Mono", 700, () => {
  env.atlasKey = null;
  rebuildAtlas();
  stage.invalidate();
});
ensureFont("Inter", 900, () => stage.invalidate());
