/*
 * Code Screenshot: code → highlighted window on a background, exported as PNG (1×/2×/4×) or SVG.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Prism (lazy, from jsDelivr; its autoloader fetches each language and its dependencies) only
 * tokenizes; themes.js maps tokens to colors, so canvas and SVG draw the same `layout()` model.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { h, toast, store } from "/assets/js/lib/dom.js";
import { createImageExport } from "/assets/js/lib/image-io.js";
import { loadLib, LIBS } from "/assets/js/lib/cdn.js";
import { roundRectPath, linearGradient } from "/assets/js/lib/canvas.js";
import { GRADIENTS } from "/assets/js/lib/showcase-frame.js";
import { debounce } from "/assets/js/lib/text-tool.js";
import { THEMES, toLines } from "./themes.js";
import { LANGS, detect, langName, langExt } from "./languages.js";

const $ = (id) => document.getElementById(id);
const canvas = $("preview");
const codeEl = $("code");
const langEl = $("lang");

const SAMPLE = `// Debounce: run fn once input settles
export function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms = 200,
) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: T) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

const save = debounce((text: string) => {
  localStorage.setItem("draft", text);
}, 500);
`;

const MONO = [
  { family: "JetBrains Mono", spec: "JetBrains+Mono:wght@400;700" },
  { family: "Fira Code", spec: "Fira+Code:wght@400;700" },
  { family: "Source Code Pro", spec: "Source+Code+Pro:wght@400;700" },
  { family: "IBM Plex Mono", spec: "IBM+Plex+Mono:wght@400;700" },
  { family: "Roboto Mono", spec: "Roboto+Mono:wght@400;700" },
  { family: "Inconsolata", spec: "Inconsolata:wght@400;700" },
  { family: "Space Mono", spec: "Space+Mono:wght@400;700" },
  { family: "System mono", system: true },
];
const SYSTEM_MONO =
  'ui-monospace, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace';
const fontFamily = (fam) =>
  fam === "System mono" ? SYSTEM_MONO : `"${fam}", ${SYSTEM_MONO}`;

/* ---------- Panel ---------- */
const saved = store.get("opts:code-screenshot", {});
const keep = (id, v) => saved[id] ?? v;
const panel = createControls(
  $("controls"),
  [
    {
      title: "Style",
      controls: [
        {
          id: "theme",
          type: "select",
          label: "Theme",
          value: keep("theme", "midnight"),
          options: Object.entries(THEMES).map(([k, t]) => [
            k,
            `${t.name}${t.dark ? "" : " (light)"}`,
          ]),
        },
        {
          id: "font",
          type: "select",
          label: "Font",
          value: keep("font", "JetBrains Mono"),
          options: MONO.map((f) => [f.family, f.family]),
        },
        {
          id: "fontSize",
          type: "range",
          label: "Font size",
          min: 10,
          max: 28,
          value: keep("fontSize", 15),
          unit: "px",
        },
        {
          id: "lineHeight",
          type: "range",
          label: "Line height",
          min: 1.1,
          max: 2.2,
          step: 0.05,
          value: keep("lineHeight", 1.6),
        },
        {
          id: "tabSize",
          type: "segmented",
          label: "Tab width",
          value: keep("tabSize", "2"),
          options: [
            ["2", "2"],
            ["4", "4"],
            ["8", "8"],
          ],
        },
      ],
    },
    {
      title: "Window",
      controls: [
        {
          id: "chrome",
          type: "segmented",
          label: "Title bar",
          value: keep("chrome", "dots"),
          options: [
            ["dots", "Dots"],
            ["right", "Buttons"],
            ["bar", "Plain"],
            ["none", "None"],
          ],
        },
        {
          id: "title",
          type: "text",
          label: "File name",
          value: keep("title", "debounce.ts"),
          showIf: (st) => st.chrome !== "none",
          placeholder: "app.js",
        },
        {
          id: "lineNumbers",
          type: "toggle",
          label: "Line numbers",
          value: keep("lineNumbers", true),
        },
        {
          id: "startLine",
          type: "number",
          label: "First line number",
          min: 0,
          max: 99999,
          value: keep("startLine", 1),
          showIf: (st) => st.lineNumbers,
        },
        {
          id: "highlight",
          type: "text",
          label: "Highlight lines",
          value: keep("highlight", "7-10"),
          placeholder: "e.g. 3, 5-7",
          hint: "Or click lines in the preview.",
        },
        {
          id: "radius",
          type: "range",
          label: "Corner radius",
          min: 0,
          max: 24,
          value: keep("radius", 12),
          unit: "px",
        },
        {
          id: "shadow",
          type: "range",
          label: "Shadow",
          min: 0,
          max: 100,
          value: keep("shadow", 60),
          unit: "%",
        },
        {
          id: "minWidth",
          type: "range",
          label: "Minimum width",
          min: 0,
          max: 1400,
          step: 20,
          value: keep("minWidth", 0),
          format: (v) => (v ? `${v}px` : "Auto"),
        },
      ],
    },
    {
      title: "Background",
      controls: [
        {
          id: "bg",
          type: "segmented",
          label: "Type",
          value: keep("bg", "gradient"),
          options: [
            ["gradient", "Gradient"],
            ["solid", "Solid"],
            ["none", "Transparent"],
          ],
        },
        {
          id: "gradient",
          type: "swatches",
          label: "Gradient",
          value: keep("gradient", "sunset"),
          showIf: (st) => st.bg === "gradient",
          options: GRADIENTS.map((g) => ({
            label: g.label,
            value: g.value,
            preview: `linear-gradient(135deg,${g.colors.join(",")})`,
          })),
        },
        {
          id: "gAngle",
          type: "range",
          label: "Angle",
          min: 0,
          max: 360,
          value: keep("gAngle", 135),
          unit: "°",
          showIf: (st) => st.bg === "gradient",
        },
        {
          id: "bgColor",
          type: "color",
          label: "Color",
          value: keep("bgColor", "#e9ecf2"),
          showIf: (st) => st.bg === "solid",
        },
        {
          id: "padding",
          type: "range",
          label: "Padding",
          min: 0,
          max: 160,
          value: keep("padding", 64),
          unit: "px",
        },
      ],
    },
  ],
  {
    onChange: (st, id) => {
      store.set("opts:code-screenshot", st);
      if (id === "font") loadFont();
      draw();
    },
  },
);
const s = panel.state;

/* ---------- Code + language ---------- */
codeEl.value = store.get("code-screenshot:code", SAMPLE);
langEl.replaceChildren(
  h("option", { value: "auto" }, "Auto-detect"),
  ...LANGS.map(([id, label]) => h("option", { value: id }, label)),
);
langEl.value = store.get("code-screenshot:lang", "auto");
const lang = () =>
  langEl.value === "auto" ? detect(codeEl.value) : langEl.value;
const saveCode = debounce(
  () => store.set("code-screenshot:code", codeEl.value),
  400,
);
codeEl.addEventListener("input", () => {
  saveCode();
  retokenize();
});
langEl.addEventListener("change", () => {
  store.set("code-screenshot:lang", langEl.value);
  retokenize();
});
// Tab inserts spaces instead of leaving the field.
codeEl.addEventListener("keydown", (e) => {
  if (e.key !== "Tab" || e.shiftKey || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  document.execCommand("insertText", false, " ".repeat(+s.tabSize));
});

/* ---------- Prism ---------- */
let prism = null;
async function loadPrism() {
  if (prism) return prism;
  window.Prism = window.Prism || { manual: true };
  window.Prism.manual = true;
  await loadLib("prism");
  const P = await loadLib("prismAutoloader");
  P.plugins.autoloader.languages_path = LIBS.prismComponents.url;
  return (prism = P);
}
function loadLanguage(P, id) {
  if (P.languages[id]) return Promise.resolve();
  return new Promise((resolve, reject) =>
    P.plugins.autoloader.loadLanguages([id], resolve, () =>
      reject(new Error(`Couldn’t load ${langName(id)} highlighting.`)),
    ),
  );
}

let lines = [[]]; // [[{ text, role }]]
let tokenVersion = 0;
const retokenize = debounce(async () => {
  const v = ++tokenVersion;
  const id = lang();
  $("detected").textContent =
    langEl.value === "auto" ? `Detected: ${langName(id)}` : "";
  const code = codeEl.value.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  if (id === "plain") {
    lines = code.split("\n").map((t) => (t ? [{ text: t, role: "fg" }] : []));
    return draw();
  }
  // Draw plain text right away, then colors when Prism is ready.
  if (!prism) {
    lines = code.split("\n").map((t) => (t ? [{ text: t, role: "fg" }] : []));
    draw();
  }
  try {
    const P = await loadPrism();
    await loadLanguage(P, id);
    if (v !== tokenVersion) return;
    lines = toLines(P.tokenize(code, P.languages[id]));
  } catch (err) {
    console.error(err);
    toast(
      err.message ||
        "Syntax highlighting is unavailable. Check your connection.",
      "warning",
    );
    lines = code.split("\n").map((t) => (t ? [{ text: t, role: "fg" }] : []));
  }
  draw();
}, 120);

/* ---------- Fonts ---------- */
const linked = new Set();
function loadFont() {
  const f = MONO.find((m) => m.family === s.font);
  if (!f || f.system || linked.has(f.family)) return;
  linked.add(f.family);
  document.head.append(
    h("link", {
      rel: "stylesheet",
      href: `https://fonts.googleapis.com/css2?family=${f.spec}&display=swap`,
    }),
  );
  document.fonts
    ?.load(`400 16px "${f.family}"`)
    .then(() => document.fonts.load(`700 16px "${f.family}"`))
    .then(draw, draw);
}

/* ---------- Layout ---------- */
function parseRanges(str) {
  const set = new Set();
  for (const part of String(str).split(/[,\s]+/)) {
    const m = part.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) continue;
    const a = +m[1],
      b = m[2] ? +m[2] : a;
    for (let i = Math.min(a, b); i <= Math.max(a, b) && i - a < 5000; i++)
      set.add(i);
  }
  return set;
}

const mctx = document.createElement("canvas").getContext("2d");
/** Everything needed to draw, in 1× px. */
function layout() {
  const theme = THEMES[s.theme] || THEMES.midnight;
  const fs = s.fontSize,
    lh = Math.round(fs * s.lineHeight);
  const font = fontFamily(s.font);
  mctx.font = `${fs}px ${font}`;
  const tab = " ".repeat(+s.tabSize);
  const rows = lines.map((line) => {
    let x = 0;
    const segs = line.map((t) => {
      const text = t.text.replace(/\t/g, tab);
      const w = mctx.measureText(text).width;
      const seg = { text, color: theme[t.role] || theme.fg, x, w };
      x += w;
      return seg;
    });
    return { segs, w: x };
  });
  const first = s.lineNumbers ? Math.max(0, s.startLine | 0) : 1;
  const numW = s.lineNumbers
    ? mctx.measureText(String(first + rows.length - 1)).width
    : 0;
  const gutter = s.lineNumbers ? Math.ceil(numW + fs * 1.4) : 0;
  const padX = Math.round(fs * 1.5),
    padY = Math.round(fs * 1.25);
  const titleH = s.chrome === "none" ? 0 : Math.round(Math.max(34, fs * 2.6));
  const contentW = Math.max(0, ...rows.map((r) => r.w));
  const winW = Math.ceil(
    Math.max(s.minWidth, padX * 2 + gutter + contentW, titleH ? 200 : 0),
  );
  const winH = Math.ceil(titleH + padY * 2 + Math.max(1, rows.length) * lh);
  const pad = s.padding;
  return {
    theme,
    fs,
    lh,
    font,
    rows,
    first,
    gutter,
    numW,
    padX,
    padY,
    titleH,
    winW,
    winH,
    pad,
    W: winW + pad * 2,
    H: winH + pad * 2,
    hl: parseRanges(s.highlight),
  };
}

const gradientColors = () =>
  (GRADIENTS.find((g) => g.value === s.gradient) || GRADIENTS[0]).colors;

/* ---------- Canvas ---------- */
function paint(ctx, L, scale) {
  const { theme, pad, winW, winH, titleH, padX, padY, lh, fs, gutter } = L;
  ctx.save();
  ctx.scale(scale, scale);
  ctx.clearRect(0, 0, L.W, L.H);
  if (s.bg === "gradient") {
    ctx.fillStyle = linearGradient(
      ctx,
      L.W,
      L.H,
      s.gAngle - 90,
      gradientColors(),
    );
    ctx.fillRect(0, 0, L.W, L.H);
  } else if (s.bg === "solid") {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, L.W, L.H);
  }

  // Window + shadow
  const r = s.radius;
  ctx.save();
  if (s.shadow > 0) {
    ctx.shadowColor = `rgba(0,0,0,${(0.55 * s.shadow) / 100})`;
    ctx.shadowBlur = 60 * (s.shadow / 100) + 8;
    ctx.shadowOffsetY = 22 * (s.shadow / 100);
  }
  ctx.beginPath();
  roundRectPath(ctx, pad, pad, winW, winH, r);
  ctx.fillStyle = theme.bg;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  roundRectPath(ctx, pad, pad, winW, winH, r);
  ctx.clip();

  // Title bar
  if (titleH) {
    if (s.chrome === "dots") {
      ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
        ctx.fillStyle = c;
        ctx.beginPath();
        ctx.arc(pad + 20 + i * 20, pad + titleH / 2, 6, 0, Math.PI * 2);
        ctx.fill();
      });
    } else if (s.chrome === "right") {
      ctx.strokeStyle = theme.title;
      ctx.lineWidth = 1.4;
      const y = pad + titleH / 2,
        x0 = pad + winW - 22;
      ctx.beginPath();
      ctx.moveTo(x0 - 4.5, y - 4.5);
      ctx.lineTo(x0 + 4.5, y + 4.5);
      ctx.moveTo(x0 + 4.5, y - 4.5);
      ctx.lineTo(x0 - 4.5, y + 4.5); // ×
      ctx.rect(x0 - 32 - 4.5, y - 4.5, 9, 9); // □
      ctx.moveTo(x0 - 64 - 5, y);
      ctx.lineTo(x0 - 64 + 5, y); // –
      ctx.stroke();
    }
    if (s.title.trim()) {
      ctx.fillStyle = theme.title;
      ctx.font = `${Math.round(fs * 0.86)}px ${L.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(s.title.trim(), pad + winW / 2, pad + titleH / 2 + 0.5);
    }
    if (s.chrome === "bar" || s.chrome === "right") {
      ctx.fillStyle = theme.border;
      ctx.fillRect(pad, pad + titleH - 1, winW, 1);
    }
  }

  // Lines
  const top = pad + titleH + padY;
  const textX = pad + padX + gutter;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  L.rows.forEach((row, i) => {
    const y = top + i * lh;
    const n = L.first + i;
    if (L.hl.has(n)) {
      ctx.fillStyle = theme.hl;
      ctx.fillRect(pad, y, winW, lh);
      ctx.fillStyle = theme.keyword;
      ctx.fillRect(pad, y, 3, lh);
    }
    if (s.lineNumbers) {
      ctx.font = `${fs}px ${L.font}`;
      ctx.fillStyle = L.hl.has(n) ? theme.fg : theme.gutter;
      ctx.textAlign = "right";
      ctx.fillText(String(n), pad + padX + L.numW, y + lh / 2);
      ctx.textAlign = "left";
    }
    ctx.font = `${fs}px ${L.font}`;
    for (const seg of row.segs) {
      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, textX + seg.x, y + lh / 2);
    }
  });
  ctx.restore();
  // Hairline border on dark-on-dark windows
  ctx.beginPath();
  roundRectPath(ctx, pad + 0.5, pad + 0.5, winW - 1, winH - 1, r);
  ctx.strokeStyle = theme.border;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

let last = null;
function draw() {
  const L = (last = layout());
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.ceil(L.W * dpr);
  canvas.height = Math.ceil(L.H * dpr);
  canvas.style.width = `${L.W}px`;
  $("stage").classList.toggle("is-checker", s.bg === "none");
  paint(canvas.getContext("2d"), L, dpr);
  exportBar?.refresh();
}

function renderAt(scale) {
  const L = layout();
  const c = document.createElement("canvas");
  c.width = Math.ceil(L.W * scale);
  c.height = Math.ceil(L.H * scale);
  paint(c.getContext("2d"), L, scale);
  return c;
}

/* ---------- SVG ---------- */
const esc = (t) =>
  t.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function toSvg() {
  const L = layout();
  const { theme, pad, winW, winH, titleH, padX, padY, lh, fs } = L;
  const f = MONO.find((m) => m.family === s.font);
  const out = [];
  const defs = [];
  if (f && !f.system)
    defs.push(
      `<style>@import url('https://fonts.googleapis.com/css2?family=${f.spec}&amp;display=swap');</style>`,
    );
  if (s.bg === "gradient") {
    const a = ((s.gAngle - 90) * Math.PI) / 180;
    const len = Math.abs(L.W * Math.cos(a)) + Math.abs(L.H * Math.sin(a));
    const dx = (Math.cos(a) * len) / 2,
      dy = (Math.sin(a) * len) / 2;
    const cols = gradientColors();
    defs.push(
      `<linearGradient id="bg" gradientUnits="userSpaceOnUse" x1="${L.W / 2 - dx}" y1="${L.H / 2 - dy}" x2="${L.W / 2 + dx}" y2="${L.H / 2 + dy}">${cols.map((c, i) => `<stop offset="${cols.length > 1 ? i / (cols.length - 1) : 0}" stop-color="${c}"/>`).join("")}</linearGradient>`,
    );
    out.push(`<rect width="${L.W}" height="${L.H}" fill="url(#bg)"/>`);
  } else if (s.bg === "solid")
    out.push(`<rect width="${L.W}" height="${L.H}" fill="${s.bgColor}"/>`);
  if (s.shadow > 0)
    defs.push(
      `<filter id="sh" x="-30%" y="-30%" width="160%" height="170%"><feDropShadow dx="0" dy="${((22 * s.shadow) / 100).toFixed(1)}" stdDeviation="${(((60 * s.shadow) / 100 + 8) / 2).toFixed(1)}" flood-color="#000" flood-opacity="${((0.55 * s.shadow) / 100).toFixed(3)}"/></filter>`,
    );
  defs.push(
    `<clipPath id="win"><rect x="${pad}" y="${pad}" width="${winW}" height="${winH}" rx="${s.radius}"/></clipPath>`,
  );
  out.push(
    `<rect x="${pad}" y="${pad}" width="${winW}" height="${winH}" rx="${s.radius}" fill="${theme.bg}"${s.shadow > 0 ? ' filter="url(#sh)"' : ""}/>`,
  );
  out.push('<g clip-path="url(#win)">');
  if (titleH) {
    const cy = pad + titleH / 2;
    if (s.chrome === "dots")
      ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) =>
        out.push(
          `<circle cx="${pad + 20 + i * 20}" cy="${cy}" r="6" fill="${c}"/>`,
        ),
      );
    if (s.chrome === "right") {
      const x0 = pad + winW - 22;
      out.push(
        `<path d="M${x0 - 4.5} ${cy - 4.5}l9 9m0-9l-9 9M${x0 - 36.5} ${cy - 4.5}h9v9h-9zM${x0 - 69} ${cy}h10" stroke="${theme.title}" stroke-width="1.4" fill="none"/>`,
      );
    }
    if (s.title.trim())
      out.push(
        `<text x="${pad + winW / 2}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-size="${Math.round(fs * 0.86)}" fill="${theme.title}">${esc(s.title.trim())}</text>`,
      );
    if (s.chrome === "bar" || s.chrome === "right")
      out.push(
        `<rect x="${pad}" y="${pad + titleH - 1}" width="${winW}" height="1" fill="${theme.border}"/>`,
      );
  }
  const top = pad + titleH + padY,
    textX = pad + padX + L.gutter;
  L.rows.forEach((row, i) => {
    const y = top + i * lh,
      n = L.first + i,
      cy = (y + lh / 2).toFixed(2);
    if (L.hl.has(n))
      out.push(
        `<rect x="${pad}" y="${y}" width="${winW}" height="${lh}" fill="${theme.hl}"/><rect x="${pad}" y="${y}" width="3" height="${lh}" fill="${theme.keyword}"/>`,
      );
    if (s.lineNumbers)
      out.push(
        `<text x="${(pad + padX + L.numW).toFixed(2)}" y="${cy}" text-anchor="end" dominant-baseline="central" fill="${L.hl.has(n) ? theme.fg : theme.gutter}">${n}</text>`,
      );
    if (row.segs.length)
      out.push(
        `<text x="${textX}" y="${cy}" dominant-baseline="central" xml:space="preserve">${row.segs.map((g) => `<tspan fill="${g.color}">${esc(g.text)}</tspan>`).join("")}</text>`,
      );
  });
  out.push("</g>");
  out.push(
    `<rect x="${pad + 0.5}" y="${pad + 0.5}" width="${winW - 1}" height="${winH - 1}" rx="${s.radius}" fill="none" stroke="${theme.border}"/>`,
  );
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" font-family='${L.font.replace(/'/g, '"')}' font-size="${fs}" style="white-space:pre"><defs>${defs.join("")}</defs>${out.join("")}</svg>`;
}

/* ---------- Click a line to highlight it ---------- */
canvas.addEventListener("click", (e) => {
  if (!last) return;
  const r = canvas.getBoundingClientRect();
  const y = ((e.clientY - r.top) / r.height) * last.H;
  const i = Math.floor((y - last.pad - last.titleH - last.padY) / last.lh);
  if (i < 0 || i >= last.rows.length) return;
  const n = last.first + i;
  const set = parseRanges(s.highlight);
  if (set.has(n)) set.delete(n);
  else set.add(n);
  panel.set({ highlight: compactRanges([...set].sort((a, b) => a - b)) });
});
function compactRanges(nums) {
  const out = [];
  for (let i = 0; i < nums.length; i++) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    out.push(j > i ? `${nums[i]}-${nums[j]}` : `${nums[i]}`);
    i = j;
  }
  return out.join(", ");
}

/* ---------- Export ---------- */
const filename = () => {
  const t = s.title
    .trim()
    .replace(/\.[^.]+$/, "")
    .replace(/[^\w.-]+/g, "-");
  return t || `code-${langExt(lang())}`;
};
const exportBar = createImageExport($("export"), {
  id: "code-screenshot",
  getCanvas: renderAt,
  svg: async () => toSvg(),
  formats: ["png", "svg", "jpg", "webp"],
  scales: [1, 2, 4],
  filename,
  matte: () => (s.bg === "solid" ? s.bgColor : "#ffffff"),
});
if (!store.get("img-export:code-screenshot")) {
  exportBar.state.scale = 2;
  exportBar.refresh();
}

loadFont();
retokenize();
draw();
