/*
 * Palette Extractor: the main colors of an image (k-means in Lab, or median cut), with HEX/RGB/HSL,
 * coverage, a WCAG contrast matrix and exports (CSS, Tailwind, SCSS, JSON, PNG/SVG strip).

 *
 * Pixels are sampled at 200 px on the long side (samplePixels) so even huge photos extract instantly;
 * k-means is seeded, so the same image and settings always give the same palette.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { h, store, downloadBlob } from "/assets/js/lib/dom.js";
import {
  createImageDrop,
  createImageExport,
  safeName,
} from "/assets/js/lib/image-io.js";
import {
  samplePixels,
  kmeans,
  medianCut,
  hex,
  rgbToHsl,
  contrastRatio,
  wcag,
  readableOn,
} from "/assets/js/lib/palette.js";
import { copyText, actionButton } from "/assets/js/lib/text-tool.js";

const $ = (id) => document.getElementById(id);
const img = $("source");
let name = "palette";
let colors = []; // [{ rgb, share }]
let pixels = null;
let demo = false;

const saved = store.get("opts:palette", {});
const panel = createControls(
  $("controls"),
  [
    {
      title: "Extraction",
      controls: [
        {
          id: "count",
          type: "range",
          label: "Colors",
          min: 2,
          max: 16,
          value: saved.count ?? 6,
        },
        {
          id: "method",
          type: "segmented",
          label: "Method",
          value: saved.method ?? "kmeans",
          options: [
            ["kmeans", "K-means"],
            ["median", "Median cut"],
          ],
          hint: "K-means finds perceptually distinct colors; median cut is faster and keeps small accents.",
        },
        {
          id: "sort",
          type: "segmented",
          label: "Order",
          value: saved.sort ?? "share",
          options: [
            ["share", "Coverage"],
            ["hue", "Hue"],
            ["light", "Lightness"],
          ],
        },
        {
          id: "seed",
          type: "range",
          label: "Seed",
          min: 1,
          max: 50,
          value: 1,
          hint: "K-means starts from random colors; try another seed for a different take.",
          showIf: (s) => s.method === "kmeans",
        },
      ],
    },
    {
      title: "Names",
      controls: [
        {
          id: "prefix",
          type: "text",
          label: "Variable prefix",
          value: saved.prefix ?? "color",
        },
      ],
    },
  ],
  {
    onChange: (s, id) => {
      store.set("opts:palette", {
        count: s.count,
        method: s.method,
        sort: s.sort,
        prefix: s.prefix,
      });
      if (id === "prefix") renderCode();
      else extract();
    },
  },
);
const s = panel.state;

createImageDrop($("upload"), {
  label: "Drop an image",
  onLoad: (m) => {
    demo = false;
    name = safeName(m.name, "palette");
    img.src = m.url;
  },
  onClear: () => loadDemo(),
});
img.addEventListener("load", () => {
  pixels = samplePixels(img, 200);
  extract();
});

/* ---------- Extract ---------- */
function extract() {
  if (!pixels) return;
  if (!pixels.length) {
    colors = [];
    $("note").textContent = "This image is fully transparent.";
    return renderAll();
  }
  const found =
    s.method === "kmeans"
      ? kmeans(pixels, s.count, { seed: s.seed })
      : medianCut(pixels, s.count);
  colors = sortColors(found);
  $("note").textContent =
    found.length < s.count
      ? `Only ${found.length} distinct colors found.`
      : demo
        ? "Demo image. Drop, choose or paste your own."
        : "";
  renderAll();
}

function sortColors(list) {
  const out = [...list];
  if (s.sort === "hue")
    out.sort((a, b) => {
      const A = rgbToHsl(a.rgb),
        B = rgbToHsl(b.rgb);
      return (A[1] < 12) - (B[1] < 12) || A[0] - B[0] || A[2] - B[2];
    });
  if (s.sort === "light")
    out.sort((a, b) => rgbToHsl(b.rgb)[2] - rgbToHsl(a.rgb)[2]);
  return out;
}

/* ---------- Render ---------- */
const pct = (v) => `${v < 0.01 ? (v * 100).toFixed(1) : Math.round(v * 100)}%`;
const rgbStr = ([r, g, b]) => `rgb(${r}, ${g}, ${b})`;
const hslStr = (rgb) => {
  const [hh, ss, l] = rgbToHsl(rgb);
  return `hsl(${hh}, ${ss}%, ${l}%)`;
};

function renderAll() {
  $("strip").replaceChildren(
    ...colors.map((c) =>
      h("button", {
        type: "button",
        style: `background:${hex(c.rgb)};flex:${Math.max(c.share, 0.02)}`,
        title: `${hex(c.rgb)} · ${pct(c.share)} · click to copy`,
        onclick: () => copyText(hex(c.rgb), `Copied ${hex(c.rgb)}`),
      }),
    ),
  );
  $("swatches").replaceChildren(
    ...colors.map((c) => {
      const x = hex(c.rgb);
      return h(
        "button",
        {
          type: "button",
          class: "pal-swatch",
          title: "Click to copy HEX",
          onclick: () => copyText(x, `Copied ${x}`),
        },
        h(
          "div",
          {
            class: "pal-chip",
            style: `background:${x};color:${readableOn(c.rgb)}`,
          },
          h("span", {}, x.toUpperCase()),
          h("span", {}, pct(c.share)),
        ),
        h(
          "div",
          { class: "pal-info" },
          h("b", {}, x),
          h("span", {}, rgbStr(c.rgb)),
          h("span", {}, hslStr(c.rgb)),
        ),
      );
    }),
  );
  renderMatrix();
  renderCode();
  exportBar.refresh();
}

function renderMatrix() {
  const head = h(
    "tr",
    {},
    h("th", { title: "Text ↓ / Background →" }, "Aa"),
    colors.map((c) =>
      h(
        "th",
        { title: hex(c.rgb) },
        h("span", { style: `background:${hex(c.rgb)}` }),
      ),
    ),
  );
  const rows = colors.map((fg, i) =>
    h(
      "tr",
      {},
      h(
        "th",
        { title: hex(fg.rgb) },
        h("span", { style: `background:${hex(fg.rgb)}` }),
      ),
      colors.map((bg, j) => {
        if (i === j) return h("td", { class: "self" }, "—");
        const r = contrastRatio(fg.rgb, bg.rgb);
        const level = wcag(r);
        return h(
          "td",
          {
            class: level === "Fail" ? "fail" : "",
            style: `background:${hex(bg.rgb)};color:${hex(fg.rgb)}`,
            title: `${hex(fg.rgb)} on ${hex(bg.rgb)}: ${r.toFixed(2)}:1 (${level})`,
          },
          `${r.toFixed(1)}:1`,
          h("small", {}, level),
        );
      }),
    ),
  );
  $("matrix").replaceChildren(h("thead", {}, head), h("tbody", {}, rows));
}

/* ---------- Code exports ---------- */
const FORMATS = [
  ["css", "CSS"],
  ["tailwind", "Tailwind"],
  ["scss", "SCSS"],
  ["json", "JSON"],
];
let fmt = store.get("palette:fmt", "css");
const fmtBtns = FORMATS.map(([v, l]) =>
  h(
    "button",
    {
      type: "button",
      "data-v": v,
      onclick: () => {
        fmt = v;
        store.set("palette:fmt", v);
        renderCode();
      },
    },
    l,
  ),
);
$("fmt").replaceChildren(...fmtBtns);

const slug = () =>
  (s.prefix || "color")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || "color";
const names = () => colors.map((_, i) => `${slug()}-${(i + 1) * 100}`);
function code() {
  const hexes = colors.map((c) => hex(c.rgb));
  const n = names();
  switch (fmt) {
    case "tailwind": {
      const key = /^[a-z_$][\w$]*$/i.test(slug()) ? slug() : `'${slug()}'`;
      return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        ${key}: {\n${hexes.map((x, i) => `          ${(i + 1) * 100}: '${x}',`).join("\n")}\n        },\n      },\n    },\n  },\n};\n\n/* Tailwind v4 (CSS) */\n@theme {\n${hexes.map((x, i) => `  --color-${n[i]}: ${x};`).join("\n")}\n}\n`;
    }
    case "scss":
      return `${hexes.map((x, i) => `$${n[i]}: ${x};`).join("\n")}\n\n$${slug()}-palette: (\n${hexes.map((x, i) => `  ${(i + 1) * 100}: ${x},`).join("\n")}\n);\n`;
    case "json":
      return `${JSON.stringify(
        colors.map((c, i) => ({
          name: n[i],
          hex: hexes[i],
          rgb: c.rgb,
          hsl: rgbToHsl(c.rgb),
          share: +c.share.toFixed(4),
        })),
        null,
        2,
      )}\n`;
    default:
      return `:root {\n${hexes.map((x, i) => `  --${n[i]}: ${x};`).join("\n")}\n}\n`;
  }
}
const EXT = { css: "css", tailwind: "js", scss: "scss", json: "json" };
function renderCode() {
  fmtBtns.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.v === fmt)),
  );
  $("code").textContent = colors.length ? code() : "";
}
$("code-actions").append(
  actionButton("Copy code", "copy", () => copyText(code())),
  actionButton("Download", "download", () =>
    downloadBlob(
      new Blob([code()], { type: "text/plain" }),
      `${name}-palette.${EXT[fmt]}`,
    ),
  ),
);

/* ---------- Swatch strip (PNG / SVG) ---------- */
const CELL = 200,
  STRIP_H = 260,
  LABEL_H = 70;
function stripCanvas(scale = 1) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, colors.length) * CELL * scale;
  c.height = STRIP_H * scale;
  const x = c.getContext("2d");
  x.scale(scale, scale);
  colors.forEach((col, i) => {
    x.fillStyle = hex(col.rgb);
    x.fillRect(i * CELL, 0, CELL, STRIP_H - LABEL_H);
    x.fillStyle = "#ffffff";
    x.fillRect(i * CELL, STRIP_H - LABEL_H, CELL, LABEL_H);
    x.fillStyle = "#1d1d1f";
    x.font = "600 22px Menlo, Consolas, monospace";
    x.fillText(
      hex(col.rgb).toUpperCase(),
      i * CELL + 18,
      STRIP_H - LABEL_H + 32,
    );
    x.fillStyle = "#86868b";
    x.font = "16px Menlo, Consolas, monospace";
    x.fillText(pct(col.share), i * CELL + 18, STRIP_H - LABEL_H + 56);
  });
  return c;
}
function stripSvg() {
  const W = colors.length * CELL;
  const cells = colors
    .map(
      (col, i) =>
        `<rect x="${i * CELL}" width="${CELL}" height="${STRIP_H - LABEL_H}" fill="${hex(col.rgb)}"/>` +
        `<text x="${i * CELL + 18}" y="${STRIP_H - LABEL_H + 32}" font-size="22" font-weight="600" fill="#1d1d1f">${hex(col.rgb).toUpperCase()}</text>` +
        `<text x="${i * CELL + 18}" y="${STRIP_H - LABEL_H + 56}" font-size="16" fill="#86868b">${pct(col.share)}</text>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${STRIP_H}" viewBox="0 0 ${W} ${STRIP_H}" font-family="Menlo, Consolas, monospace"><rect width="${W}" height="${STRIP_H}" fill="#fff"/>${cells}</svg>`;
}
const exportBar = createImageExport($("export"), {
  id: "palette",
  getCanvas: stripCanvas,
  svg: stripSvg,
  formats: ["png", "svg"],
  scales: [1, 2],
  filename: () => `${name}-palette`,
  enabled: () => colors.length > 0,
});

/* ---------- Demo ---------- */
function loadDemo() {
  name = "palette";
  const c = document.createElement("canvas");
  c.width = 800;
  c.height = 500;
  const x = c.getContext("2d");
  const sky = x.createLinearGradient(0, 0, 0, 330);
  sky.addColorStop(0, "#2b2d6e");
  sky.addColorStop(0.55, "#c8507a");
  sky.addColorStop(1, "#ffb36b");
  x.fillStyle = sky;
  x.fillRect(0, 0, 800, 330);
  x.fillStyle = "#ffe7a3";
  x.beginPath();
  x.arc(560, 300, 70, 0, Math.PI * 2);
  x.fill();
  x.fillStyle = "#3c2a55";
  x.beginPath();
  x.moveTo(0, 330);
  x.lineTo(180, 190);
  x.lineTo(330, 300);
  x.lineTo(470, 210);
  x.lineTo(800, 330);
  x.fill();
  const sea = x.createLinearGradient(0, 330, 0, 500);
  sea.addColorStop(0, "#16426b");
  sea.addColorStop(1, "#0b2038");
  x.fillStyle = sea;
  x.fillRect(0, 330, 800, 170);
  x.fillStyle = "rgba(255, 210, 140, 0.55)";
  for (let i = 0; i < 9; i++)
    x.fillRect(520 - i * 6, 345 + i * 16, 80 + i * 12, 4);
  demo = true;
  img.src = c.toDataURL("image/png");
}
loadDemo();
