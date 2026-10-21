/* Text Match Cut — flicker through generated pages while the keyword stays locked in the centre. */
import { createControls } from "/assets/js/lib/controls.js";
import { createStage } from "/assets/js/lib/stage.js";
import { createExportBar, progressModal } from "/assets/js/lib/exporter.js";
import { scratch, drawBlurred, fit } from "/assets/js/lib/canvas.js";
import { rng, hash } from "/assets/js/lib/random.js";
import { overlayTexture } from "/assets/js/lib/paper-textures.js";
import { loadFontStylesheet, fontString } from "/assets/js/lib/fonts.js";
import { loadMedia } from "/assets/js/lib/media.js";
import { createDropzone } from "/assets/js/lib/upload.js";
import { loadGifenc, quantizeFrame, gifDelay } from "/assets/js/lib/gif.js";
import {
  h,
  icon,
  toast,
  downloadBlob,
  formatBytes,
} from "/assets/js/lib/dom.js";
import {
  TEMPLATES,
  PAGE_FONTS,
  buildPage,
  resetMeasurements,
} from "./pages.js";
import { LANG_OPTIONS } from "./lang.js";
import { SURFACES, getSurface, renderPhoto } from "./surfaces/index.js";
import { prepareLogo, demoLogo } from "./logo.js";
import { loadLib } from "/assets/js/lib/cdn.js";

const SIZES = {
  "9:16": [1080, 1920],
  "1:1": [1080, 1080],
  "16:9": [1920, 1080],
  "4:5": [1080, 1350],
};

const canvas = document.getElementById("preview");
const ctx = canvas.getContext("2d");

/* ---------- Frames ---------- */
// { id, kind: 'page', seed, template, locked } | { id, kind: 'logo', seed, surface, locked }
// | { id, kind: 'image', img, box: {x,y,w,h}, locked }
// Pages and logo surfaces are "generated" frames: the Frames slider sets how many, the mode their kind.
let frames = [];
let nextId = 1;
const enabledTemplates = new Set(TEMPLATES.map(([k]) => k));
const enabledSurfaces = new Set(SURFACES.map((x) => x.id));
const photoSurfaces = []; // { id: 'photo:<n>', img, name, dispose }
const randomSeed = () => Math.floor(Math.random() * 2 ** 31);

function pickFrom(set, avoid) {
  const list = [...set];
  const options = list.length > 1 ? list.filter((t) => t !== avoid) : list;
  return options[Math.floor(Math.random() * options.length)];
}
const pickTemplate = (avoid) => pickFrom(enabledTemplates, avoid);
/** The least-used surface (so every surface shows up before one repeats), never `avoid`. */
function pickSurface(avoid) {
  const used = new Map();
  for (const f of frames) if (f.kind === "logo") used.set(f.surface, (used.get(f.surface) || 0) + 1);
  const list = [...enabledSurfaces].filter((x) => x !== avoid || enabledSurfaces.size === 1);
  const least = Math.min(...list.map((x) => used.get(x) || 0));
  return pickFrom(new Set(list.filter((x) => (used.get(x) || 0) === least)));
}
const styleOf = (f) => (f?.kind === "logo" ? f.surface : f?.template);
const isGenerated = (f) => f.kind === "page" || f.kind === "logo";
const genFrames = () => frames.filter(isGenerated);

function newFrame(kind, avoid) {
  const f = { id: nextId++, kind, seed: randomSeed(), locked: false };
  if (kind === "logo") f.surface = pickSurface(avoid);
  else f.template = pickTemplate(avoid);
  return f;
}

/** The kind the i-th of n generated frames should have in the current mode. */
function wantKind(i, n) {
  if (s.mode === "text") return "page";
  if (s.mode === "logo") return "logo";
  if (i === n - 1) return s.mixEnd === "logo" ? "logo" : "page";
  if (s.mixPattern === "random") return hash(i, 7177) < s.mixRatio / 100 ? "logo" : "page";
  const pat = { tl: "pl", ttl: "ppl", tll: "pll" }[s.mixPattern] || "pl";
  return pat[i % pat.length] === "l" ? "logo" : "page";
}

/** Give every generated frame the kind the mode wants (locked frames keep theirs in Mixed mode). */
function assignKinds() {
  const gen = genFrames();
  gen.forEach((f, i) => {
    const want = wantKind(i, gen.length);
    if (f.kind === want || (f.locked && s.mode === "mixed")) return;
    f.kind = want;
    delete f.template;
    delete f.surface;
    regenerate(f, styleOf(gen[i - 1]));
  });
}

/** Match the number of generated frames to the "Frames" slider. */
function syncFrameCount() {
  const want = s.frames;
  while (genFrames().length < want) {
    const n = genFrames().length;
    frames.push(newFrame(wantKind(n, want), styleOf(frames[frames.length - 1])));
  }
  while (genFrames().length > want) {
    const victim =
      [...frames].reverse().find((f) => isGenerated(f) && !f.locked) ||
      [...frames].reverse().find(isGenerated);
    frames.splice(frames.indexOf(victim), 1);
  }
  assignKinds();
}

function regenerate(f, avoid) {
  f.seed = randomSeed();
  if (f.kind === "logo") f.surface = pickSurface(avoid ?? f.surface);
  else f.template = pickTemplate(avoid ?? f.template);
}

function shuffleAll() {
  frames.forEach((f, i) => {
    if (isGenerated(f) && !f.locked) regenerate(f, styleOf(frames[i - 1]));
  });
  changed();
}

/* ---------- Controls ---------- */
const templateChips = h(
  "div",
  { class: "chips" },
  TEMPLATES.map(([k, label]) => {
    const b = h(
      "button",
      { type: "button", class: "chip", "aria-pressed": "true" },
      label,
    );
    b.addEventListener("click", () => {
      if (enabledTemplates.has(k) && enabledTemplates.size === 1)
        return toast("Keep at least one page type.", "warning", 2500);
      enabledTemplates.has(k)
        ? enabledTemplates.delete(k)
        : enabledTemplates.add(k);
      b.setAttribute("aria-pressed", String(enabledTemplates.has(k)));
      frames.forEach((f, i) => {
        if (f.kind === "page" && !enabledTemplates.has(f.template))
          regenerate(f, frames[i - 1]?.template);
      });
      changed();
    });
    return b;
  }),
);

const surfaceChips = h(
  "div",
  { class: "chips" },
  SURFACES.map((x) => surfaceChip(x.id, x.name)),
);
function surfaceChip(id, label) {
  const b = h(
    "button",
    { type: "button", class: "chip", "aria-pressed": String(enabledSurfaces.has(id)) },
    label,
  );
  b.addEventListener("click", () => {
    if (enabledSurfaces.has(id) && enabledSurfaces.size === 1)
      return toast("Keep at least one surface.", "warning", 2500);
    enabledSurfaces.has(id) ? enabledSurfaces.delete(id) : enabledSurfaces.add(id);
    b.setAttribute("aria-pressed", String(enabledSurfaces.has(id)));
    frames.forEach((f, i) => {
      if (f.kind === "logo" && !enabledSurfaces.has(f.surface))
        regenerate(f, styleOf(frames[i - 1]));
    });
    changed();
  });
  return b;
}

const logoEl = h("div", { class: "tmc-logo" });
const logoNote = h("p", { class: "ctrl-hint" });
const photosEl = h("div", { class: "tmc-shots" });
const shotsEl = h("div", { class: "tmc-shots" });

const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Mode",
      controls: [
        {
          id: "mode",
          type: "segmented",
          label: "Match cut on",
          value: "text",
          options: [
            ["text", "Text"],
            ["logo", "Logo"],
            ["mixed", "Mixed"],
          ],
          hint: "Text: your keyword on pages. Logo: your logo on real-world surfaces. Mixed: both, alternating.",
        },
        {
          id: "mixPattern",
          type: "select",
          label: "Pattern",
          value: "tl",
          options: [
            ["tl", "Text, logo, text, logo…"],
            ["ttl", "Text, text, logo…"],
            ["tll", "Text, logo, logo…"],
            ["random", "Random mix"],
          ],
          showIf: (st) => st.mode === "mixed",
        },
        {
          id: "mixRatio",
          type: "range",
          label: "Logo frames",
          min: 10,
          max: 90,
          step: 5,
          value: 50,
          unit: "%",
          showIf: (st) => st.mode === "mixed" && st.mixPattern === "random",
        },
        {
          id: "mixEnd",
          type: "segmented",
          label: "Last frame",
          value: "logo",
          options: [
            ["logo", "Logo"],
            ["text", "Text"],
          ],
          showIf: (st) => st.mode === "mixed",
        },
      ],
    },
    {
      title: "Text",
      showIf: (st) => st.mode !== "logo",
      controls: [
        {
          id: "keyword",
          type: "text",
          label: "Keyword or phrase",
          value: "Tool Box",
        },
        {
          id: "context",
          type: "textarea",
          label: "Context sentences (optional)",
          value: "",
          rows: 3,
          placeholder:
            "Paste sentences that use your keyword. Leave empty to generate filler text.",
        },
        {
          id: "lang",
          type: "segmented",
          label: "Page language",
          value: "en",
          options: LANG_OPTIONS,
          hint: "Language of the generated pages: filler text, headlines, menus and dates.",
        },
      ],
    },
    {
      title: "Pages",
      showIf: (st) => st.mode !== "logo",
      controls: [
        { type: "custom", label: "Page types", el: templateChips },
        { type: "button", text: "Shuffle pages", onClick: shuffleAll },
        {
          id: "keepSize",
          type: "toggle",
          label: "Same keyword size on every page",
          value: true,
        },
        {
          id: "keySize",
          type: "range",
          label: "Keyword size",
          min: 30,
          max: 220,
          value: 92,
          unit: "px",
          hint: "Relative to a 1080px frame.",
        },
      ],
    },
    {
      title: "Highlight",
      showIf: (st) => st.mode !== "logo",
      controls: [
        {
          id: "hlStyle",
          type: "segmented",
          label: "Style",
          value: "marker",
          options: [
            ["marker", "Marker"],
            ["underline", "Underline"],
            ["box", "Box"],
            ["none", "None"],
          ],
        },
        {
          id: "hlColor",
          type: "color",
          label: "Color",
          value: "#f5e663",
          showIf: (s) => s.hlStyle !== "none",
        },
        {
          id: "hlPadding",
          type: "range",
          label: "Padding",
          min: 0,
          max: 40,
          value: 12,
          unit: "px",
          showIf: (s) => s.hlStyle !== "none",
        },
        {
          id: "hlOpacity",
          type: "range",
          label: "Opacity",
          min: 0.1,
          max: 1,
          step: 0.01,
          value: 0.9,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (s) => s.hlStyle !== "none",
        },
      ],
    },
    {
      title: "Logo",
      showIf: (st) => st.mode !== "text",
      controls: [
        { type: "custom", el: logoEl },
        {
          id: "logoBg",
          type: "toggle",
          label: "Remove a solid background",
          value: true,
          hint: "For JPGs and other logos on white (or any one color). Transparent PNGs and SVGs are left as they are.",
        },
        {
          id: "logoThreshold",
          type: "range",
          label: "Background threshold",
          min: 1,
          max: 60,
          value: 18,
          hint: "Higher removes more of the colours close to the background.",
          showIf: (st) => st.logoBg,
        },
        {
          id: "logoColors",
          type: "segmented",
          label: "Logo colors",
          value: "surface",
          options: [
            ["surface", "One color per surface"],
            ["original", "Original colors"],
          ],
          hint: "One color: white paint on concrete, gold thread on a patch, a neon tube color… Original keeps your logo's colors.",
        },
        {
          id: "logoSize",
          type: "range",
          label: "Logo size",
          min: 120,
          max: 900,
          value: 460,
          unit: "px",
          hint: "Longest side, relative to a 1080px frame. The same on every frame.",
        },
        {
          id: "logoX",
          type: "range",
          label: "Horizontal position",
          min: -35,
          max: 35,
          value: 0,
          unit: "%",
        },
        {
          id: "logoY",
          type: "range",
          label: "Vertical position",
          min: -35,
          max: 35,
          value: 0,
          unit: "%",
          hint: "In Mixed mode the keyword moves with the logo, so both land on the same spot.",
        },
      ],
    },
    {
      title: "Surfaces",
      showIf: (st) => st.mode !== "text",
      controls: [
        { type: "custom", label: "Surface types", el: surfaceChips },
        { type: "button", text: "Shuffle surfaces", onClick: shuffleAll },
        { type: "custom", label: "Your own surface photos", el: photosEl },
      ],
    },
    {
      title: "Camera",
      controls: [
        {
          id: "blur",
          type: "range",
          label: "Blur strength",
          min: 0,
          max: 30,
          step: 0.5,
          value: 9,
          unit: "px",
          decimals: 1,
        },
        {
          id: "focus",
          type: "range",
          label: "Focus radius",
          min: 20,
          max: 700,
          value: 170,
          unit: "px",
          hint: "Sharp area around the keyword or logo. Blur increases beyond it.",
        },
        { id: "jitter", type: "toggle", label: "Handheld jitter", value: true },
        {
          id: "jitterAmount",
          type: "range",
          label: "Jitter amount",
          min: 1,
          max: 6,
          step: 0.5,
          value: 2,
          unit: "px",
          decimals: 1,
          showIf: (s) => s.jitter,
        },
      ],
    },
    {
      title: "Texture",
      controls: [
        {
          id: "texture",
          type: "segmented",
          label: "Paper texture",
          value: "fiber",
          options: [
            ["none", "None"],
            ["grain", "Grain"],
            ["fiber", "Fiber"],
            ["crumpled", "Crumple"],
          ],
        },
        {
          id: "textureAmount",
          type: "range",
          label: "Intensity",
          min: 0,
          max: 1,
          step: 0.01,
          value: 0.35,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (s) => s.texture !== "none",
        },
        {
          id: "vignette",
          type: "range",
          label: "Vignette",
          min: 0,
          max: 1,
          step: 0.01,
          value: 0.3,
          format: (v) => `${Math.round(v * 100)}%`,
        },
      ],
    },
    {
      title: "Timing",
      controls: [
        {
          id: "frames",
          type: "range",
          label: "Frames",
          min: 8,
          max: 40,
          value: 18,
        },
        {
          id: "frameMs",
          type: "range",
          label: "Time per frame",
          min: 40,
          max: 200,
          step: 10,
          value: 90,
          unit: " ms",
        },
        {
          id: "pacing",
          type: "select",
          label: "Pacing",
          value: "speed-up",
          options: [
            ["constant", "Constant"],
            ["speed-up", "Speed up (slow → fast)"],
            ["slow-down", "Slow down at the end"],
          ],
        },
        {
          id: "land",
          type: "toggle",
          label: "Land on a final frame",
          value: true,
          hint: "The last frame holds longer.",
        },
        {
          id: "landMs",
          type: "range",
          label: "Final frame hold",
          min: 200,
          max: 3000,
          step: 50,
          value: 1000,
          unit: " ms",
          showIf: (s) => s.land,
        },
      ],
    },
    {
      title: "Output",
      controls: [
        {
          id: "size",
          type: "segmented",
          label: "Size",
          value: "9:16",
          options: Object.keys(SIZES).map((k) => [k, k]),
        },
        {
          id: "gifScale",
          type: "segmented",
          label: "GIF scale",
          value: "50",
          options: [
            ["25", "25%"],
            ["50", "50%"],
            ["75", "75%"],
            ["100", "100%"],
          ],
          hint: "Smaller GIFs load faster. WebM and PNG frames are always full size.",
        },
        {
          id: "shutter",
          type: "toggle",
          label: "Shutter sound",
          value: false,
          hint: "Plays a camera shutter on every cut in the exported video (GIFs and PNGs are silent).",
        },
        {
          id: "shutterVolume",
          type: "range",
          label: "Shutter volume",
          min: 0.1,
          max: 1,
          step: 0.05,
          value: 0.8,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (s) => s.shutter,
        },
        {
          id: "shutterPreview",
          type: "toggle",
          label: "Hear it in the preview",
          value: true,
          showIf: (s) => s.shutter,
        },
      ],
    },
    { title: "Your screenshots", controls: [{ type: "custom", el: shotsEl }] },
  ],
  {
    persist: "text-match-cut",
    onChange: (st, id) => {
      if (id === "frames") syncFrameCount();
      if (id === "mode" || id === "mixPattern" || id === "mixRatio" || id === "mixEnd") assignKinds();
      if (id === "logoBg" || id === "logoThreshold") prepLogo();
      if (id === "shutter" || id === "shutterPreview") {
        if (st.shutter) shutter.load();
        return;
      }
      if (id === "shutterVolume") return;
      changed(id);
    },
  },
);

const s = panel.state;
const keyword = () => s.keyword.trim() || "Your keyword";

/* ---------- Logo ---------- */
let logoMedia = null; // the upload (loadMedia result), null = demo logo
let logo = demoLogo(); // { canvas, removed, color }

function prepLogo() {
  if (!logoMedia) {
    logo = demoLogo();
    logoNote.textContent = "Showing a demo logo. A simple one-color logo works best.";
  } else {
    const isSvg = /\.svg$/i.test(logoMedia.name);
    logo = prepareLogo(logoMedia.el, { removeBg: s.logoBg, threshold: s.logoThreshold, isSvg });
    logoNote.textContent = logo.empty
      ? "Nothing left of the logo: lower the background threshold."
      : logo.removed
        ? "Background removed."
        : "";
  }
}

createDropzone(logoEl, {
  accept: ["image"],
  label: "Drop your logo (PNG, SVG or JPG)",
  onLoad: (m) => {
    logoMedia = m;
    prepLogo();
    changed();
  },
  onClear: () => {
    logoMedia = null;
    prepLogo();
    changed();
  },
});
logoEl.append(logoNote);

/** Where the logo sits on a W×H frame: identical on every frame. */
function logoBox(W, H, k) {
  const L = logo.canvas;
  const S = s.logoSize * k;
  const sc = Math.min(S / L.width, S / L.height);
  const w = L.width * sc,
    hh = L.height * sc;
  const [cx, cy] = centerOf(W, H);
  return { x: cx - w / 2, y: cy - hh / 2, w, h: hh, cx, cy };
}

/** The match-cut point: the frame centre in Text mode, moved by the logo position otherwise. */
function centerOf(W, H) {
  if (s.mode === "text") return [W / 2, H / 2];
  return [W / 2 + (s.logoX / 100) * W, H / 2 + (s.logoY / 100) * H];
}

/* ---------- Timing ---------- */
function delays() {
  const n = frames.length;
  return frames.map((f, i) => {
    const x = n > 1 ? i / (n - 1) : 0;
    let d = s.frameMs;
    if (s.pacing === "speed-up") d *= 1.9 - 1.3 * x; // ~1.9× → 0.6×
    if (s.pacing === "slow-down") d *= 0.6 + 1.4 * x * x; // 0.6× → 2×
    if (s.land && i === n - 1) d = s.landMs;
    return gifDelay(d);
  });
}
let timeline = { starts: [0], total: 1 };
function rebuildTimeline() {
  const d = delays();
  const starts = [];
  let acc = 0;
  for (const ms of d) {
    starts.push(acc / 1000);
    acc += ms;
  }
  timeline = { starts, total: Math.max(0.05, acc / 1000), delays: d };
}
function frameAt(t) {
  const { starts } = timeline;
  let i = starts.length - 1;
  while (i > 0 && starts[i] > t + 1e-6) i--;
  return Math.max(0, i);
}

/* ---------- Page cache ---------- */
let fontVersion = 0;
const pageCache = new Map();
function pageFor(f) {
  const key = `${f.seed}|${f.template}|${keyword()}|${s.context}|${s.lang}|${fontVersion}`;
  let p = pageCache.get(key);
  if (!p) {
    if (pageCache.size > 120) pageCache.clear();
    p = buildPage(f.template, f.seed, keyword(), s.context, s.lang);
    pageCache.set(key, p);
  }
  return p;
}

/* ---------- Drawing ---------- */
function runOps(c, ops) {
  for (const op of ops) {
    if (op.t === "text") {
      c.font = op.f;
      c.fillStyle = op.c;
      c.globalAlpha = op.a ?? 1;
      if ("letterSpacing" in c) c.letterSpacing = `${op.ls || 0}px`;
      c.fillText(op.s, op.x, op.y);
    } else if (op.t === "rect") {
      c.globalAlpha = 1;
      c.beginPath();
      if (op.r) c.roundRect(op.x, op.y, op.w, op.h, op.r);
      else c.rect(op.x, op.y, op.w, op.h);
      if (op.c) {
        c.fillStyle = op.c;
        c.fill();
      }
      if (op.stroke) {
        c.strokeStyle = op.stroke;
        c.lineWidth = 1.5;
        c.stroke();
      }
    } else if (op.t === "line") {
      c.globalAlpha = 1;
      c.strokeStyle = op.c;
      c.lineWidth = op.w;
      c.beginPath();
      c.moveTo(op.x1, op.y1);
      c.lineTo(op.x2, op.y2);
      c.stroke();
    } else if (op.t === "stain") {
      c.globalAlpha = 1;
      const g = c.createRadialGradient(op.x, op.y, 0, op.x, op.y, op.r);
      g.addColorStop(0, op.c);
      g.addColorStop(0.7, op.c);
      g.addColorStop(1, "rgba(0,0,0,0)");
      c.fillStyle = g;
      c.fillRect(op.x - op.r, op.y - op.r, op.r * 2, op.r * 2);
    }
  }
  c.globalAlpha = 1;
  if ("letterSpacing" in c) c.letterSpacing = "0px";
}

const isDark = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) < 110;
};

/** Rough-edged highlight around a rect, in the current (page/image) coordinate space. unit = 1 output px. */
function drawHighlight(c, x, y, w, hgt, seed, unit, darkBg, redraw) {
  if (s.hlStyle === "none") return;
  const r = rng(seed ^ 0x5bd1e995);
  const j = (amt) => (r() - 0.5) * 2 * amt;
  c.save();
  c.globalAlpha = s.hlOpacity;
  if (s.hlStyle === "marker") {
    c.globalCompositeOperation = darkBg ? "source-over" : "multiply";
    c.fillStyle = s.hlColor;
    const slant = j(hgt * 0.05),
      n = 10,
      rough = hgt * 0.05;
    c.beginPath();
    c.moveTo(x + j(rough), y + slant);
    for (let i = 1; i <= n; i++)
      c.lineTo(x + (w * i) / n, y + slant * (1 - (2 * i) / n) + j(rough));
    c.lineTo(x + w + j(rough * 2), y + hgt / 2);
    for (let i = n; i >= 0; i--)
      c.lineTo(x + (w * i) / n, y + hgt - slant * (1 - (2 * i) / n) + j(rough));
    c.lineTo(x + j(rough * 2), y + hgt / 2);
    c.closePath();
    c.fill();
    c.globalCompositeOperation = "source-over";
    c.globalAlpha = 1;
    redraw?.(); // keep the word readable on top of an opaque highlight
  } else {
    c.strokeStyle = s.hlColor;
    c.lineCap = "round";
    c.lineJoin = "round";
    c.lineWidth = Math.max(3 * unit, hgt * 0.07);
    c.beginPath();
    if (s.hlStyle === "underline") {
      const yy = y + hgt - c.lineWidth / 2;
      c.moveTo(x, yy + j(unit * 2));
      for (let i = 1; i <= 8; i++)
        c.lineTo(x + (w * i) / 8, yy + j(unit * 2.5));
    } else {
      const pts = [
        [x, y],
        [x + w, y],
        [x + w, y + hgt],
        [x, y + hgt],
      ];
      pts.forEach(([px, py], i) =>
        i
          ? c.lineTo(px + j(unit * 3), py + j(unit * 3))
          : c.moveTo(px + j(unit * 3), py + j(unit * 3)),
      );
      c.closePath();
    }
    c.stroke();
  }
  c.restore();
}

/** Draw a frame's content (sharp, no blur) into c. Returns the keyword's on-screen size. */
function drawContent(c, W, H, k, f) {
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = "source-over";
  const seed = f.kind === "image" ? f.id * 7919 : f.seed;
  const [ox, oy] = centerOf(W, H);
  let dx = 0,
    dy = 0,
    rot = 0;
  if (s.jitter) {
    dx = (hash(seed, 1) - 0.5) * 2 * s.jitterAmount * k;
    dy = (hash(seed, 2) - 0.5) * 2 * s.jitterAmount * k;
    rot = (hash(seed, 3) - 0.5) * 0.012 * s.jitterAmount;
  }

  if (f.kind === "logo") {
    const box = logoBox(W, H, k);
    const surf = scratch(`tmc-surface-${W}x${H}`, W, H);
    const info = drawSurface(surf.getContext("2d"), W, H, k, f, box);
    c.fillStyle = info.bg;
    c.fillRect(0, 0, W, H);
    c.translate(ox + dx, oy + dy);
    c.rotate(rot);
    c.translate(-ox, -oy);
    c.drawImage(surf, 0, 0);
    c.setTransform(1, 0, 0, 1, 0, 0);
    return { w: box.w, h: box.h, surface: info.surface, bg: info.bg, cx: ox, cy: oy };
  }

  if (f.kind === "page") {
    const page = pageFor(f);
    const key = page.key;
    const scale = (s.keySize * k) / (s.keepSize ? key.size : 26);
    const cx = key.x + key.w / 2,
      cy = key.y - (key.ascent - key.descent) / 2;
    c.fillStyle = page.bg;
    c.fillRect(0, 0, W, H);
    c.translate(ox + dx, oy + dy);
    c.rotate(rot);
    c.scale(scale, scale);
    c.translate(-cx, -cy);
    runOps(c, page.ops);
    const pad = (s.hlPadding * k) / scale;
    const dark = isDark(page.bg);
    drawHighlight(
      c,
      key.x - pad,
      key.y - key.ascent - pad * 0.6,
      key.w + pad * 2,
      key.ascent + key.descent + pad * 1.2,
      f.seed,
      k / scale,
      dark,
      () =>
        runOps(c, [
          { ...page.keyOp, c: dark ? "#111111" : page.keyOp.c, a: 1 },
        ]),
    );
    c.setTransform(1, 0, 0, 1, 0, 0);
    return {
      w: (key.w + pad * 2) * scale,
      h: (key.ascent + key.descent + pad * 1.2) * scale,
      surface: page.surface,
      bg: page.bg,
      cx: ox,
      cy: oy,
    };
  }

  // Screenshot frame: the marked box goes to the centre.
  const { img, box } = f;
  const scale =
    s.mode === "logo"
      ? logoBox(W, H, k).h / box.h
      : s.keepSize
        ? (s.keySize * k * 1.2) / box.h
        : Math.max(W / img.width, H / img.height);
  const cover = fit(img.width, img.height, W, H, "cover");
  c.fillStyle = "#111";
  c.fillRect(0, 0, W, H);
  drawBlurred(c, img.el, cover.x, cover.y, cover.w, cover.h, 30 * k);
  c.translate(ox + dx, oy + dy);
  c.rotate(rot);
  c.scale(scale, scale);
  c.translate(-(box.x + box.w / 2), -(box.y + box.h / 2));
  c.drawImage(img.el, 0, 0);
  const pad = ((s.hlPadding * k) / scale) * 0.5;
  drawHighlight(
    c,
    box.x - pad,
    box.y - pad,
    box.w + pad * 2,
    box.h + pad * 2,
    f.id,
    k / scale,
    false,
    null,
  );
  c.setTransform(1, 0, 0, 1, 0, 0);
  return {
    w: box.w * scale,
    h: box.h * scale,
    surface: "screen",
    bg: "#111111",
    cx: ox,
    cy: oy,
  };
}

/** One logo frame: the surface module draws the whole frame with the logo applied. */
function drawSurface(c, W, H, k, f, box) {
  const r = rng(f.seed);
  const env = {
    W,
    H,
    k,
    r,
    seed: f.seed,
    box,
    u: Math.max(box.w, box.h),
    logo: logo.canvas,
    logoColor: logo.color,
    ink: (palette) => {
      const v = palette[Math.floor(r() * palette.length)];
      return s.logoColors === "original" ? null : v;
    },
  };
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  c.filter = "none";
  c.clearRect(0, 0, W, H);
  const photo = photoSurfaces.find((p) => p.id === f.surface);
  const info = photo ? renderPhoto(c, env, photo.img) : getSurface(f.surface).render(c, env);
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
  c.globalCompositeOperation = "source-over";
  c.filter = "none";
  return info;
}

/** Keep an ellipse around the centre and fade out beyond it. */
function maskEllipse(c, W, H, rx, ry, inner, cx = W / 2, cy = H / 2) {
  c.save();
  c.globalCompositeOperation = "destination-in";
  c.translate(cx, cy);
  c.scale(1, ry / rx);
  const g = c.createRadialGradient(0, 0, rx * inner, 0, 0, rx);
  g.addColorStop(0, "rgba(0,0,0,1)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  c.fillStyle = g;
  const big = Math.max(W, H) * 4 * Math.max(1, rx / ry);
  c.fillRect(-big, -big, big * 2, big * 2);
  c.restore();
}

function renderFrame(out, W, H, f) {
  const k = Math.min(W, H) / 1080;
  const sharp = scratch(`tmc-sharp-${W}x${H}`, W, H);
  const sctx = sharp.getContext("2d");
  const info = drawContent(sctx, W, H, k, f);

  out.setTransform(1, 0, 0, 1, 0, 0);
  out.globalCompositeOperation = "source-over";
  out.globalAlpha = 1;
  const b = s.blur * k;
  if (b <= 0.3) out.drawImage(sharp, 0, 0);
  else {
    // depth of field: heavy blur everywhere → medium ring → sharp centre
    out.fillStyle = info.bg;
    out.fillRect(0, 0, W, H);
    drawBlurred(out, sharp, 0, 0, W, H, b);
    const R = s.focus * k;
    const mid = scratch(`tmc-mid-${W}x${H}`, W, H);
    const mctx = mid.getContext("2d");
    mctx.setTransform(1, 0, 0, 1, 0, 0);
    mctx.clearRect(0, 0, W, H);
    drawBlurred(mctx, sharp, 0, 0, W, H, b * 0.4);
    maskEllipse(mctx, W, H, info.w / 2 + R * 2, info.h / 2 + R * 1.3, 0.35, info.cx, info.cy);
    out.drawImage(mid, 0, 0);
    const focus = scratch(`tmc-focus-${W}x${H}`, W, H);
    const fctx = focus.getContext("2d");
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, W, H);
    fctx.drawImage(sharp, 0, 0);
    maskEllipse(fctx, W, H, info.w / 2 + R, info.h / 2 + R * 0.6, 0.45, info.cx, info.cy);
    out.drawImage(focus, 0, 0);
  }

  // Paper texture (lighter on screen-style pages)
  const amount =
    s.texture === "none"
      ? 0
      : s.textureAmount *
        ({ screen: 0.4, paper: 1, aged: 1.25 }[info.surface] || 1);
  if (amount > 0) {
    const seed = f.kind === "image" ? f.id : f.seed;
    out.save();
    out.globalCompositeOperation = "overlay";
    out.globalAlpha = Math.min(1, amount);
    const tex = overlayTexture(s.texture);
    if (s.texture === "crumpled") {
      out.translate(W / 2, H / 2);
      out.rotate(Math.floor(hash(seed, 31) * 4) * (Math.PI / 2));
      out.scale(hash(seed, 32) > 0.5 ? -1 : 1, 1);
      const sz = Math.max(W, H) * 1.05;
      out.drawImage(tex, -sz / 2, -sz / 2, sz, sz);
    } else {
      const pat = out.createPattern(tex, "repeat");
      pat.setTransform?.(
        new DOMMatrix()
          .translate(hash(seed, 33) * 512, hash(seed, 34) * 512)
          .scale(Math.max(0.6, k)),
      );
      out.fillStyle = pat;
      out.fillRect(0, 0, W, H);
    }
    out.restore();
  }

  if (s.vignette > 0) {
    const g = out.createRadialGradient(
      W / 2,
      H / 2,
      Math.min(W, H) * 0.3,
      W / 2,
      H / 2,
      Math.hypot(W, H) * 0.55,
    );
    g.addColorStop(0, "rgba(0,0,0,0)");
    g.addColorStop(1, `rgba(0,0,0,${s.vignette})`);
    out.fillStyle = g;
    out.fillRect(0, 0, W, H);
  }
}

/* ---------- Preview ---------- */
let lastRendered = "";
let version = 0;
function render(t) {
  if (!frames.length) return;
  const i = frameAt(t);
  const tag = `${i}|${version}`;
  if (tag === lastRendered) return;
  lastRendered = tag;
  renderFrame(ctx, canvas.width, canvas.height, frames[i]);
  filmstrip.mark(i);
}

function resize() {
  const [w, h] = SIZES[s.size];
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w;
    canvas.height = h;
  }
}

/** Something changed: rebuild timing, redraw preview, refresh thumbnails and the GIF estimate. */
function changed(id) {
  resize();
  rebuildTimeline();
  version++;
  stage.invalidate();
  if (
    id !== "frameMs" &&
    id !== "pacing" &&
    id !== "land" &&
    id !== "landMs" &&
    id !== "gifScale"
  )
    filmstrip.refresh();
  else filmstrip.relabel();
  scheduleEstimate();
}

const stage = createStage({
  canvas,
  transport: document.getElementById("transport"),
  render,
  getDuration: () => timeline.total,
});

/* ---------- Filmstrip ---------- */
function frameLabel(f) {
  if (f.kind === "image") return f.img.name;
  if (f.kind === "page") return TEMPLATES.find(([k]) => k === f.template)?.[1] || f.template;
  return photoSurfaces.find((p) => p.id === f.surface)?.name || getSurface(f.surface).name;
}

const filmstrip = (() => {
  const root = document.getElementById("filmstrip");
  const count = h("span", { class: "muted" });
  const head = h(
    "div",
    { class: "tmc-strip-head" },
    h("strong", {}, "Frames "),
    count,
    h("span", { style: "flex:1" }),
    h("button", {
      type: "button",
      class: "btn btn-sm",
      html: `${icon("shuffle")} Shuffle`,
      onclick: shuffleAll,
    }),
  );
  const list = h("div", { class: "tmc-strip", role: "list" });
  root.append(head, list);
  let items = [];
  let job = 0;

  function refresh() {
    const myJob = ++job;
    count.textContent = `(${frames.length}) · ${timeline.total.toFixed(2)}s`;
    const [W, H] = SIZES[s.size];
    const th = 112,
      tw = Math.round((th * W) / H);
    items = frames.map((f, i) => {
      const c = h("canvas", {
        width: tw * 2,
        height: th * 2,
        style: `width:${tw}px;height:${th}px`,
      });
      const lock = h("button", {
        type: "button",
        class: "tmc-mini",
        title: f.locked ? "Unlock" : "Lock (keep when shuffling)",
        "aria-pressed": String(f.locked),
        html: icon(f.locked ? "lock" : "unlock"),
      });
      const regen = h("button", {
        type: "button",
        class: "tmc-mini",
        title: f.kind === "logo" ? "Regenerate this surface" : "Regenerate this page",
        html: icon("restart"),
        hidden: !isGenerated(f),
      });
      const del = h("button", {
        type: "button",
        class: "tmc-mini",
        title: "Remove frame",
        html: icon("x"),
      });
      const label = h("span", { class: "tmc-ms" });
      const item = h(
        "div",
        { class: `tmc-frame${f.locked ? " is-locked" : ""}`, role: "listitem" },
        h(
          "button",
          {
            type: "button",
            class: "tmc-thumb",
            title: `Show this frame (${frameLabel(f)})`,
            onclick: () => {
              stage.pause();
              stage.seek(timeline.starts[frames.indexOf(f)] + 0.0005);
            },
          },
          c,
        ),
        h(
          "div",
          { class: "tmc-frame-bar" },
          label,
          h("span", { style: "flex:1" }),
          lock,
          regen,
          del,
        ),
      );
      lock.addEventListener("click", () => {
        f.locked = !f.locked;
        refresh();
      });
      regen.addEventListener("click", () => {
        regenerate(f);
        changed();
      });
      del.addEventListener("click", () => {
        if (frames.length <= 2)
          return toast("Keep at least two frames.", "warning", 2500);
        frames.splice(frames.indexOf(f), 1);
        if (f.kind === "image") renderShots();
        else {
          panel.set({ frames: genFrames().length }, { silent: true });
          assignKinds();
        }
        changed();
      });
      return { item, canvas: c, label, f, drawn: false };
    });
    list.replaceChildren(...items.map((x) => x.item));
    relabel();
    // draw thumbnails a few per animation frame so the UI stays responsive
    let n = 0;
    const step = () => {
      if (myJob !== job) return;
      const t0 = performance.now();
      while (n < items.length && performance.now() - t0 < 24) {
        const it = items[n++];
        renderFrame(
          it.canvas.getContext("2d"),
          it.canvas.width,
          it.canvas.height,
          it.f,
        );
      }
      if (n < items.length) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function relabel() {
    count.textContent = `(${frames.length}) · ${timeline.total.toFixed(2)}s`;
    items.forEach((it, i) => {
      it.label.textContent = `${i + 1} · ${timeline.delays?.[i] ?? ""}ms`;
    });
  }

  let current = -1;
  function mark(i) {
    if (i === current) return;
    items[current]?.item.classList.remove("is-current");
    items[i]?.item.classList.add("is-current");
    current = i;
  }
  return { refresh, relabel, mark };
})();

/* ---------- Screenshots ---------- */
const shotInput = h("input", {
  type: "file",
  accept: "image/*",
  multiple: true,
  "aria-label": "Add screenshots",
});
const shotZone = h(
  "div",
  { class: "dropzone tmc-shot-zone", html: icon("upload") },
  h("strong", {}, "Add screenshots"),
  h("span", {}, "Then click the word in each one"),
  shotInput,
);
const shotList = h("ul", { class: "tmc-shot-list" });
shotsEl.append(shotZone, shotList);

async function addShots(files) {
  for (const file of files) {
    try {
      const m = await loadMedia(file, { accept: ["image"] });
      const img = { el: m.el, width: m.width, height: m.height, name: m.name };
      const box = await markWord(img, null);
      if (!box) {
        m.dispose();
        continue;
      }
      const frame = { id: nextId++, kind: "image", img, box, locked: true };
      // mix it in somewhere before the final frame
      const at = Math.floor(Math.random() * Math.max(1, frames.length - 1));
      frames.splice(at, 0, frame);
    } catch (err) {
      toast(err.message || "Could not open that image.", "error", 6000);
    }
  }
  renderShots();
  changed();
}
shotInput.addEventListener("change", () => {
  addShots([...shotInput.files]);
  shotInput.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  shotZone.addEventListener(ev, (e) => {
    e.preventDefault();
    shotZone.classList.add("is-over");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  shotZone.addEventListener(ev, (e) => {
    e.preventDefault();
    shotZone.classList.remove("is-over");
  }),
);
shotZone.addEventListener("drop", (e) => addShots([...e.dataTransfer.files]));

function renderShots() {
  const shots = frames.filter((f) => f.kind === "image");
  shotList.replaceChildren(
    ...shots.map((f) =>
      h(
        "li",
        {},
        h("img", { src: f.img.el.src, alt: "" }),
        h("span", { class: "tmc-shot-name", title: f.img.name }, f.img.name),
        h("button", {
          type: "button",
          class: "tmc-mini",
          title: "Re-mark the word",
          html: icon("target"),
          onclick: async () => {
            const box = await markWord(f.img, f.box);
            if (box) {
              f.box = box;
              changed();
            }
          },
        }),
        h("button", {
          type: "button",
          class: "tmc-mini",
          title: "Remove",
          html: icon("x"),
          onclick: () => {
            frames.splice(frames.indexOf(f), 1);
            renderShots();
            changed();
          },
        }),
      ),
    ),
  );
}

/* ---------- Your own surface photos ---------- */
const photoInput = h("input", {
  type: "file",
  accept: "image/*",
  multiple: true,
  "aria-label": "Add surface photos",
});
const photoZone = h(
  "div",
  { class: "dropzone tmc-shot-zone", html: icon("upload") },
  h("strong", {}, "Add surface photos"),
  h("span", {}, "A wall, a T-shirt, a box… The logo is blended into them"),
  photoInput,
);
const photoList = h("ul", { class: "tmc-shot-list" });
photosEl.append(photoZone, photoList);

async function addPhotos(files) {
  for (const file of files) {
    try {
      const m = await loadMedia(file, { accept: ["image"] });
      const id = `photo:${nextId++}`;
      photoSurfaces.push({ id, img: m.el, name: m.name, dispose: m.dispose });
      enabledSurfaces.add(id);
      // use it right away on one generated logo frame
      const target = frames.find((f) => f.kind === "logo" && !f.locked && !f.surface.startsWith("photo:"));
      if (target) {
        target.surface = id;
        target.seed = randomSeed();
      }
    } catch (err) {
      toast(err.message || "Could not open that image.", "error", 6000);
    }
  }
  renderPhotos();
  changed();
}
photoInput.addEventListener("change", () => {
  addPhotos([...photoInput.files]);
  photoInput.value = "";
});
["dragenter", "dragover"].forEach((ev) =>
  photoZone.addEventListener(ev, (e) => {
    e.preventDefault();
    photoZone.classList.add("is-over");
  }),
);
["dragleave", "drop"].forEach((ev) =>
  photoZone.addEventListener(ev, (e) => {
    e.preventDefault();
    photoZone.classList.remove("is-over");
  }),
);
photoZone.addEventListener("drop", (e) => addPhotos([...e.dataTransfer.files]));

function renderPhotos() {
  photoList.replaceChildren(
    ...photoSurfaces.map((p) =>
      h(
        "li",
        {},
        h("img", { src: p.img.src, alt: "" }),
        h("span", { class: "tmc-shot-name", title: p.name }, p.name),
        h("button", {
          type: "button",
          class: "tmc-mini",
          title: enabledSurfaces.has(p.id) ? "In the rotation (click to skip)" : "Skipped (click to use)",
          "aria-pressed": String(enabledSurfaces.has(p.id)),
          html: icon("check"),
          onclick: () => {
            if (enabledSurfaces.has(p.id) && enabledSurfaces.size === 1)
              return toast("Keep at least one surface.", "warning", 2500);
            if (enabledSurfaces.has(p.id)) enabledSurfaces.delete(p.id);
            else enabledSurfaces.add(p.id);
            frames.forEach((f, i) => {
              if (f.kind === "logo" && !enabledSurfaces.has(f.surface)) regenerate(f, styleOf(frames[i - 1]));
            });
            renderPhotos();
            changed();
          },
        }),
        h("button", {
          type: "button",
          class: "tmc-mini",
          title: "Remove",
          html: icon("x"),
          onclick: () => {
            photoSurfaces.splice(photoSurfaces.indexOf(p), 1);
            enabledSurfaces.delete(p.id);
            if (!enabledSurfaces.size) {
              SURFACES.forEach((x) => enabledSurfaces.add(x.id));
              [...surfaceChips.children].forEach((c) => c.setAttribute("aria-pressed", "true"));
            }
            frames.forEach((f, i) => {
              if (f.kind === "logo" && f.surface === p.id) regenerate(f, styleOf(frames[i - 1]));
            });
            p.dispose();
            renderPhotos();
            changed();
          },
        }),
      ),
    ),
  );
}

/** Modal where the user clicks the word (or drags a box around it). Resolves to a box in image pixels, or null. */
function markWord(img, initial) {
  return new Promise((resolve) => {
    const maxW = Math.min(window.innerWidth - 80, 1000),
      maxH = window.innerHeight * 0.62;
    const sc = Math.min(maxW / img.width, maxH / img.height, 1);
    const cw = Math.round(img.width * sc),
      ch = Math.round(img.height * sc);
    const cv = h("canvas", { width: cw, height: ch, class: "tmc-mark-canvas" });
    const c = cv.getContext("2d");
    let box = initial ? { ...initial } : null;
    const def = { w: img.width * 0.22, h: Math.max(24, img.height * 0.05) };

    const draw = () => {
      c.clearRect(0, 0, cw, ch);
      c.drawImage(img.el, 0, 0, cw, ch);
      if (!box) return;
      c.fillStyle = "rgba(0,0,0,.45)";
      c.fillRect(0, 0, cw, ch);
      const bx = box.x * sc,
        by = box.y * sc,
        bw = box.w * sc,
        bh = box.h * sc;
      c.drawImage(img.el, box.x, box.y, box.w, box.h, bx, by, bw, bh);
      c.strokeStyle = "#f5e663";
      c.lineWidth = 2;
      c.strokeRect(bx, by, bw, bh);
    };
    draw();

    const pos = (e) => {
      const r = cv.getBoundingClientRect();
      return [
        (e.clientX - r.left) * (img.width / r.width),
        (e.clientY - r.top) * (img.height / r.height),
      ];
    };
    let start = null;
    cv.addEventListener("pointerdown", (e) => {
      start = pos(e);
      cv.setPointerCapture(e.pointerId);
    });
    cv.addEventListener("pointermove", (e) => {
      if (!start) return;
      const [x, y] = pos(e);
      if (Math.abs(x - start[0]) > 6 / sc || Math.abs(y - start[1]) > 6 / sc) {
        box = {
          x: Math.min(x, start[0]),
          y: Math.min(y, start[1]),
          w: Math.abs(x - start[0]),
          h: Math.abs(y - start[1]),
        };
        draw();
      }
    });
    cv.addEventListener("pointerup", (e) => {
      const [x, y] = pos(e);
      const dragged =
        Math.abs(x - start[0]) > 6 / sc || Math.abs(y - start[1]) > 6 / sc;
      if (!dragged) {
        const size = box || def;
        box = { x: x - size.w / 2, y: y - size.h / 2, w: size.w, h: size.h };
      }
      start = null;
      ok.disabled = false;
      draw();
    });

    const close = (val) => {
      modal.remove();
      document.removeEventListener("keydown", onKey);
      resolve(val);
    };
    const onKey = (e) => {
      if (e.key === "Escape") close(null);
    };
    document.addEventListener("keydown", onKey);
    const ok = h(
      "button",
      {
        type: "button",
        class: "btn btn-primary",
        disabled: !box,
        onclick: () => close(box),
      },
      "Use this spot",
    );
    const modal = h(
      "div",
      {
        class: "modal-backdrop",
        role: "dialog",
        "aria-modal": "true",
        "aria-label": "Mark the word",
      },
      h(
        "div",
        { class: "modal tmc-mark" },
        h("h2", {}, "Where is the word?"),
        h(
          "p",
          {},
          `Click the center of ${s.mode === "logo" ? "your logo" : `“${keyword()}”`} in ${img.name}, or drag a box around it for exact sizing.`,
        ),
        h("div", { class: "tmc-mark-wrap" }, cv),
        h(
          "div",
          { class: "modal-actions" },
          h(
            "button",
            { type: "button", class: "btn", onclick: () => close(null) },
            "Cancel",
          ),
          ok,
        ),
      ),
    );
    document.body.append(modal);
  });
}

/* ---------- Export: GIF / ZIP ---------- */
const loadJSZip = () => loadLib("jszip");

const slug = () =>
  keyword()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "match-cut";
const gifSize = () => {
  const [W, H] = SIZES[s.size];
  const sc = +s.gifScale / 100;
  return [Math.round((W * sc) / 2) * 2, Math.round((H * sc) / 2) * 2];
};
const nextTick = () => new Promise((r) => setTimeout(r, 0));

function encodeFrame(lib, gctx, gw, gh, f) {
  renderFrame(gctx, gw, gh, f);
  return quantizeFrame(lib, gctx, gw, gh);
}

async function exportGif(btn) {
  let cancelled = false;
  const modal = progressModal(
    "Encoding GIF…",
    () => {
      cancelled = true;
    },
    "Rendering and compressing every frame. This can take a few seconds.",
  );
  btn.disabled = true;
  stage.pause();
  try {
    const lib = await loadGifenc();
    const [gw, gh] = gifSize();
    const gc = scratch("tmc-gif", gw, gh);
    const gctx = gc.getContext("2d", { willReadFrequently: true });
    const gif = lib.GIFEncoder();
    const d = delays();
    for (let i = 0; i < frames.length; i++) {
      if (cancelled) return toast("GIF export cancelled.");
      const { index, palette } = encodeFrame(lib, gctx, gw, gh, frames[i]);
      gif.writeFrame(index, gw, gh, { palette, delay: d[i], repeat: 0 });
      modal.set((i + 1) / frames.length);
      await nextTick();
    }
    gif.finish();
    const blob = new Blob([gif.bytes()], { type: "image/gif" });
    downloadBlob(blob, `match-cut-${slug()}.gif`);
    toast(`Saved GIF (${formatBytes(blob.size)})`, "success");
  } catch (err) {
    console.error(err);
    toast(err.message || "GIF export failed.", "error", 7000);
  } finally {
    modal.close();
    btn.disabled = false;
  }
}

async function exportZip(btn) {
  let cancelled = false;
  const modal = progressModal(
    "Saving PNG frames…",
    () => {
      cancelled = true;
    },
    "Rendering full-size frames and zipping them with their timings.",
  );
  btn.disabled = true;
  stage.pause();
  try {
    const JSZip = await loadJSZip();
    const zip = new JSZip();
    const [W, H] = SIZES[s.size];
    const c = scratch("tmc-zip", W, H);
    const zctx = c.getContext("2d");
    const d = delays();
    const timing = ["file,duration_ms"];
    for (let i = 0; i < frames.length; i++) {
      if (cancelled) return toast("Export cancelled.");
      renderFrame(zctx, W, H, frames[i]);
      const blob = await new Promise((r) => c.toBlob(r, "image/png"));
      const name = `frame-${String(i + 1).padStart(3, "0")}.png`;
      zip.file(name, blob);
      timing.push(`${name},${d[i]}`);
      modal.set(((i + 1) / frames.length) * 0.8);
    }
    zip.file("timing.csv", timing.join("\n"));
    const out = await zip.generateAsync({ type: "blob" }, (m) =>
      modal.set(0.8 + (m.percent / 100) * 0.2),
    );
    downloadBlob(out, `match-cut-${slug()}-frames.zip`);
    toast(
      `Saved ${frames.length} frames (${formatBytes(out.size)})`,
      "success",
    );
  } catch (err) {
    console.error(err);
    toast(err.message || "ZIP export failed.", "error", 7000);
  } finally {
    modal.close();
    btn.disabled = false;
  }
}

/* ---------- GIF size estimate ---------- */
let estimate = "";
let estimateTimer = 0;
function scheduleEstimate() {
  clearTimeout(estimateTimer);
  estimateTimer = setTimeout(async () => {
    try {
      const lib = await loadGifenc();
      const [gw, gh] = gifSize();
      const gc = scratch("tmc-est", gw, gh);
      const gctx = gc.getContext("2d", { willReadFrequently: true });
      const samples = [0, Math.floor(frames.length / 2)].filter(
        (v, i, a) => a.indexOf(v) === i,
      );
      let bytes = 0;
      for (const i of samples) {
        const gif = lib.GIFEncoder();
        const { index, palette } = encodeFrame(lib, gctx, gw, gh, frames[i]);
        gif.writeFrame(index, gw, gh, { palette });
        gif.finish();
        bytes += gif.bytes().length;
      }
      const total = (bytes / samples.length) * frames.length;
      estimate = `GIF ≈ ${formatBytes(total)} · ${gw}×${gh} · ${frames.length} frames · ${timeline.total.toFixed(1)}s`;
    } catch {
      estimate = "";
    }
    exportBar.refresh();
  }, 700);
}

/* ---------- Shutter sound ---------- */
// One click per cut, fired from the stage clock so it lands on the frame change.
// Plays through the speakers while previewing, and into the recording while exporting video.
const shutter = (() => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  let actx = null;
  let dest = null;
  let buffer = null;
  let loading = null;
  let last = -1;
  let playing = null;
  let exporting = false;

  function load() {
    if (!Ctx) return Promise.resolve(null);
    actx ||= new Ctx();
    actx.resume().catch(() => {});
    loading ||= fetch(new URL("./shutter.mp3", import.meta.url))
      .then((r) => r.arrayBuffer())
      .then((data) => actx.decodeAudioData(data))
      .then((b) => (buffer = b))
      .catch((err) => {
        console.warn("Shutter sound unavailable", err);
        loading = null;
        return null;
      });
    return loading;
  }

  function cut() {
    try {
      playing?.stop();
    } catch {}
    playing = null;
  }

  stage.events.addEventListener("tick", (e) => {
    const i = frameAt(e.detail.t);
    if (i === last) return;
    last = i;
    if (!buffer || !s.shutter) return;
    // Preview: only while playing, so scrubbing stays quiet.
    if (!exporting && (!s.shutterPreview || !stage.playing)) return;
    cut();
    const src = actx.createBufferSource();
    const gain = actx.createGain();
    src.buffer = buffer;
    gain.gain.value = s.shutterVolume;
    src.connect(gain).connect(exporting ? dest : actx.destination);
    src.start();
    playing = src;
  });

  return {
    load,
    /** Called inside the export click: resume audio and route clicks to the recording. */
    track() {
      if (!s.shutter || !buffer) return null;
      actx.resume();
      dest ||= actx.createMediaStreamDestination();
      cut();
      exporting = true;
      last = -1;
      return dest.stream.getAudioTracks()[0];
    },
    stop() {
      exporting = false;
      cut();
    },
  };
})();

const exportBar = createExportBar(document.getElementById("export"), {
  stage,
  filename: () => `match-cut-${slug()}`,
  primary: "gif",
  getAudio: () => shutter.track(),
  hasAudio: () => false, // the Shutter sound toggle in Output decides
  beforeExport: async (kind) => {
    if (kind === "video" && s.shutter && !(await shutter.load()))
      toast("Couldn't load the shutter sound; exporting without it.", "warning");
  },
  afterExport: () => shutter.stop(),
  onGif: exportGif,
  actions: [{ label: "PNG frames (.zip)", icon: "archive", onClick: exportZip }],
  hint: () => estimate,
});

/* ---------- Fonts ---------- */
// Pages are measured with real fonts, so re-layout once the web fonts are in.
// Any face (weight/italic) can arrive late, so re-measure whenever a font finishes loading.
loadFontStylesheet();
if (document.fonts) {
  let relayout = 0;
  document.fonts.addEventListener("loadingdone", () => {
    clearTimeout(relayout);
    relayout = setTimeout(() => {
      resetMeasurements();
      fontVersion++;
      changed();
    }, 120);
  });
  for (const fam of PAGE_FONTS) {
    for (const w of [400, 700, 800, 900])
      document.fonts.load(fontString(fam, w, 32)).catch(() => {});
    for (const w of [400, 700])
      document.fonts.load(fontString(fam, w, 32, true)).catch(() => {});
  }
}

/* ---------- Start ---------- */
prepLogo();
syncFrameCount();
resize();
rebuildTimeline();
filmstrip.refresh();
scheduleEstimate();
stage.play().catch(() => {});
