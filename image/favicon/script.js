/*
 * Favicon Generator: one source (image, SVG, or text/emoji on a shape) → favicon.ico (16/32/48),
 * PNGs (16, 32, 180, 192, 512, maskable 512), an SVG favicon and site.webmanifest, plus the <link> tags.

 *
 * drawIcon(ctx, S, opts) is the only drawing path; every size is drawn from the source directly
 * (vector sources stay crisp). The ICO stores PNG-compressed entries, which every current browser reads.
 */
import { createControls } from "/assets/js/lib/controls.js";
import {
  h,
  icon,
  toast,
  downloadBlob,
  formatBytes,
  store,
} from "/assets/js/lib/dom.js";
import {
  createImageDrop,
  canvasToBlob,
  copyBlob,
  downloadZip,
  svgBlob,
} from "/assets/js/lib/image-io.js";
import { roundRectPath, linearGradient, fit } from "/assets/js/lib/canvas.js";
import { FONTS, ensureFont, fontStack } from "/assets/js/lib/fonts.js";
import { copyText, debounce } from "/assets/js/lib/text-tool.js";

const $ = (id) => document.getElementById(id);
const EMOJI_STACK =
  '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
let media = null; // { el, width, height, kind } from the drop zone
let svgText = null; // original SVG markup when the source is an .svg

/* ---------- Panel ---------- */
const saved = store.get("opts:favicon", {});
const keep = (id, v) => saved[id] ?? v;
const panel = createControls(
  $("controls"),
  [
    {
      title: "Source",
      controls: [
        {
          id: "mode",
          type: "segmented",
          label: "Make it from",
          value: keep("mode", "text"),
          options: [
            ["text", "Text / emoji"],
            ["image", "Image / SVG"],
          ],
        },
      ],
    },
    {
      title: "Text",
      showIf: (st) => st.mode === "text",
      controls: [
        {
          id: "text",
          type: "text",
          label: "Letters or emoji",
          value: keep("text", "T"),
          placeholder: "A, Ab, 🚀…",
        },
        {
          id: "font",
          type: "select",
          label: "Font",
          value: keep("font", "Inter"),
          options: [
            ["emoji", "Emoji (system)"],
            ...FONTS.map((f) => [f.family, f.family]),
          ],
        },
        {
          id: "weight",
          type: "segmented",
          label: "Weight",
          value: keep("weight", "900"),
          options: [
            ["400", "Regular"],
            ["700", "Bold"],
            ["900", "Black"],
          ],
          showIf: (st) => st.font !== "emoji",
        },
        {
          id: "fg",
          type: "color",
          label: "Text color",
          value: keep("fg", "#ffffff"),
          showIf: (st) => st.font !== "emoji",
        },
        {
          id: "textSize",
          type: "range",
          label: "Size",
          min: 30,
          max: 100,
          value: keep("textSize", 72),
          unit: "%",
        },
      ],
    },
    {
      title: "Background",
      controls: [
        {
          id: "shape",
          type: "segmented",
          label: "Shape",
          value: keep("shape", "rounded"),
          options: [
            ["none", "None"],
            ["square", "Square"],
            ["rounded", "Rounded"],
            ["circle", "Circle"],
          ],
        },
        {
          id: "radius",
          type: "range",
          label: "Corner radius",
          min: 5,
          max: 45,
          value: keep("radius", 22),
          unit: "%",
          showIf: (st) => st.shape === "rounded",
        },
        {
          id: "fill",
          type: "segmented",
          label: "Fill",
          value: keep("fill", "gradient"),
          options: [
            ["solid", "Solid"],
            ["gradient", "Gradient"],
          ],
          showIf: (st) => st.shape !== "none",
        },
        {
          id: "bg1",
          type: "color",
          label: "Color",
          value: keep("bg1", "#7c5cff"),
          showIf: (st) => st.shape !== "none",
        },
        {
          id: "bg2",
          type: "color",
          label: "Second color",
          value: keep("bg2", "#2bb5ff"),
          showIf: (st) => st.shape !== "none" && st.fill === "gradient",
        },
        {
          id: "angle",
          type: "range",
          label: "Angle",
          min: 0,
          max: 360,
          value: keep("angle", 135),
          unit: "°",
          showIf: (st) => st.shape !== "none" && st.fill === "gradient",
        },
        {
          id: "padding",
          type: "range",
          label: "Padding",
          min: 0,
          max: 30,
          value: keep("padding", 8),
          unit: "%",
        },
      ],
    },
    {
      title: "Home screen & manifest",
      controls: [
        {
          id: "appName",
          type: "text",
          label: "App name",
          value: keep("appName", "My Website"),
        },
        {
          id: "shortName",
          type: "text",
          label: "Short name",
          value: keep("shortName", "Website"),
          hint: "Shown under the icon on phones (about 12 characters).",
        },
        {
          id: "theme",
          type: "color",
          label: "Theme color",
          value: keep("theme", "#7c5cff"),
        },
        {
          id: "touchBg",
          type: "color",
          label: "Apple touch / maskable background",
          value: keep("touchBg", "#ffffff"),
          hint: "Phones don’t show transparency: used when the shape is “None”, and around maskable icons.",
        },
        {
          id: "path",
          type: "text",
          label: "Files live at",
          value: keep("path", "/"),
          hint: "URL folder used in the HTML tags and manifest.",
        },
      ],
    },
  ],
  {
    onChange: (st, id) => {
      if (id === "mode") syncMode();
      onChange();
    },
  },
);
const s = panel.state;
// The image drop zone sits right under the Source switch.
$("controls").firstElementChild.after($("upload-section"));

createImageDrop($("upload"), {
  label: "Drop an image or SVG",
  onLoad: async (m) => {
    media = m;
    svgText = /\.svg$/i.test(m.name)
      ? await fetch(m.url)
          .then((r) => r.text())
          .catch(() => null)
      : null;
    if (s.mode !== "image") panel.set({ mode: "image" });
    else onChange();
  },
  onClear: () => {
    media = null;
    svgText = null;
    onChange();
  },
});

function syncMode() {
  $("upload-section").hidden = s.mode !== "image";
}

function onChange() {
  store.set("opts:favicon", s);
  const fam = s.font;
  if (
    s.mode === "text" &&
    fam !== "emoji" &&
    !FONTS.find((f) => f.family === fam)?.system
  )
    ensureFont(fam, s.weight, () => rebuild());
  rebuild();
}

/* ---------- Drawing ---------- */
function bgFill(ctx, S) {
  return s.fill === "gradient"
    ? linearGradient(ctx, S, S, s.angle - 90, [s.bg1, s.bg2])
    : s.bg1;
}
function shapePath(ctx, S) {
  ctx.beginPath();
  if (s.shape === "circle") ctx.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  else
    roundRectPath(
      ctx,
      0,
      0,
      S,
      S,
      s.shape === "rounded" ? (S * s.radius) / 100 : 0,
    );
}
const fontFor = (size) =>
  s.font === "emoji"
    ? `${Math.round(size)}px ${EMOJI_STACK}`
    : `${s.weight} ${size}px ${fontStack(s.font)}`;

/** Text layout for a box of side `box`: { size, dx, baseline } in px. Draw left-aligned at (centre + dx, centre + baseline) to centre the ink. */
function textLayout(ctx, box) {
  const text = s.text.trim() || "?";
  ctx.font = fontFor(100);
  const m = ctx.measureText(text);
  const w =
    (m.actualBoundingBoxLeft ?? 0) + (m.actualBoundingBoxRight ?? m.width) ||
    m.width;
  const hh =
    (m.actualBoundingBoxAscent ?? 70) + (m.actualBoundingBoxDescent ?? 0) || 70;
  const size = (100 * ((box * s.textSize) / 100)) / Math.max(w, hh);
  const k = size / 100;
  return {
    text,
    size,
    dx:
      (((m.actualBoundingBoxLeft ?? 0) -
        (m.actualBoundingBoxRight ?? m.width)) /
        2) *
      k,
    baseline:
      (((m.actualBoundingBoxAscent ?? 70) - (m.actualBoundingBoxDescent ?? 0)) /
        2) *
      k,
  };
}

/**
 * Draw the icon at S×S. `matte`: fill transparent areas (apple-touch). `maskable`: full-bleed background
 * and content shrunk into the 80% safe circle.
 */
function drawIcon(ctx, S, { matte = null, maskable = false } = {}) {
  ctx.clearRect(0, 0, S, S);
  ctx.save();
  if (maskable) {
    ctx.fillStyle = s.shape === "none" ? matte : bgFill(ctx, S);
    ctx.fillRect(0, 0, S, S);
  } else {
    if (matte && s.shape !== "square") {
      ctx.fillStyle = matte;
      ctx.fillRect(0, 0, S, S);
    }
    if (s.shape !== "none") {
      shapePath(ctx, S);
      ctx.fillStyle = bgFill(ctx, S);
      ctx.fill();
    }
  }
  const inner = maskable ? S * 0.62 : S * (1 - (2 * s.padding) / 100);
  const off = (S - inner) / 2;
  if (s.mode === "text") {
    const L = textLayout(ctx, inner);
    ctx.font = fontFor(L.size);
    ctx.fillStyle = s.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(L.text, S / 2 + L.dx, S / 2 + L.baseline);
  } else if (media) {
    const f = fit(media.width, media.height, inner, inner);
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(media.el, off + f.x, off + f.y, f.w, f.h);
  }
  ctx.restore();
}

function render(S, opts) {
  const c = document.createElement("canvas");
  c.width = c.height = S;
  drawIcon(c.getContext("2d"), S, opts);
  return c;
}

/* ---------- SVG favicon ---------- */
const esc = (t) =>
  t.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );
const b64 = (str) =>
  btoa(String.fromCharCode(...new TextEncoder().encode(str)));

function buildSvg() {
  if (s.mode === "image" && !svgText) return null; // raster sources: the PNGs cover it
  const S = 100;
  const parts = [];
  let defs = "";
  if (s.shape !== "none") {
    let fill = s.bg1;
    if (s.fill === "gradient") {
      const a = ((s.angle - 90) * Math.PI) / 180;
      const len = Math.abs(Math.cos(a)) + Math.abs(Math.sin(a));
      const dx = (Math.cos(a) * len) / 2,
        dy = (Math.sin(a) * len) / 2;
      defs = `<defs><linearGradient id="g" x1="${0.5 - dx}" y1="${0.5 - dy}" x2="${0.5 + dx}" y2="${0.5 + dy}"><stop offset="0" stop-color="${s.bg1}"/><stop offset="1" stop-color="${s.bg2}"/></linearGradient></defs>`;
      fill = "url(#g)";
    }
    parts.push(
      s.shape === "circle"
        ? `<circle cx="50" cy="50" r="50" fill="${fill}"/>`
        : `<rect width="100" height="100" rx="${s.shape === "rounded" ? s.radius : 0}" fill="${fill}"/>`,
    );
  }
  const inner = S * (1 - (2 * s.padding) / 100),
    off = (S - inner) / 2;
  if (s.mode === "text") {
    const ctx = document.createElement("canvas").getContext("2d");
    const L = textLayout(ctx, inner);
    const family = s.font === "emoji" ? EMOJI_STACK : fontStack(s.font);
    parts.push(
      `<text x="${(50 + L.dx).toFixed(2)}" y="${(50 + L.baseline).toFixed(2)}" font-family='${family}'${s.font === "emoji" ? "" : ` font-weight="${s.weight}" fill="${s.fg}"`} font-size="${L.size.toFixed(2)}">${esc(L.text)}</text>`,
    );
  } else {
    if (s.shape === "none" && s.padding === 0) return svgText;
    const f = fit(media.width, media.height, inner, inner);
    parts.push(
      `<image x="${(off + f.x).toFixed(2)}" y="${(off + f.y).toFixed(2)}" width="${f.w.toFixed(2)}" height="${f.h.toFixed(2)}" href="data:image/svg+xml;base64,${b64(svgText)}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${defs}${parts.join("")}</svg>`;
}

/* ---------- ICO ---------- */
async function buildIco(sizes) {
  const pngs = await Promise.all(
    sizes.map(
      async (S) =>
        new Uint8Array(
          await (await canvasToBlob(render(S), "image/png")).arrayBuffer(),
        ),
    ),
  );
  const head = 6 + 16 * sizes.length;
  const total = head + pngs.reduce((a, p) => a + p.length, 0);
  const buf = new Uint8Array(total),
    dv = new DataView(buf.buffer);
  dv.setUint16(2, 1, true);
  dv.setUint16(4, sizes.length, true);
  let at = head;
  sizes.forEach((S, i) => {
    const e = 6 + i * 16;
    buf[e] = S >= 256 ? 0 : S;
    buf[e + 1] = S >= 256 ? 0 : S;
    dv.setUint16(e + 4, 1, true);
    dv.setUint16(e + 6, 32, true);
    dv.setUint32(e + 8, pngs[i].length, true);
    dv.setUint32(e + 12, at, true);
    buf.set(pngs[i], at);
    at += pngs[i].length;
  });
  return new Blob([buf], { type: "image/x-icon" });
}

/* ---------- Build everything ---------- */
const PNGS = [
  { name: "favicon-16x16.png", size: 16 },
  { name: "favicon-32x32.png", size: 32 },
  { name: "apple-touch-icon.png", size: 180, touch: true },
  { name: "icon-192.png", size: 192 },
  { name: "icon-512.png", size: 512 },
  { name: "icon-512-maskable.png", size: 512, maskable: true },
];
let out = null; // { files: [{ name, blob, url, size }], svg, html, manifest }
const prefix = () => {
  const p = (s.path || "/").trim() || "/";
  return p.endsWith("/") ? p : `${p}/`;
};
const ready = () => (s.mode === "text" ? !!s.text.trim() : !!media);

function manifest() {
  const p = prefix();
  return JSON.stringify(
    {
      name: s.appName,
      short_name: s.shortName,
      icons: [
        { src: `${p}icon-192.png`, sizes: "192x192", type: "image/png" },
        { src: `${p}icon-512.png`, sizes: "512x512", type: "image/png" },
        {
          src: `${p}icon-512-maskable.png`,
          sizes: "512x512",
          type: "image/png",
          purpose: "maskable",
        },
      ],
      theme_color: s.theme,
      background_color: s.touchBg,
      display: "standalone",
      start_url: "/",
    },
    null,
    2,
  );
}
function htmlTags(hasSvg) {
  const p = prefix();
  return [
    `<link rel="icon" href="${p}favicon.ico" sizes="48x48">`,
    hasSvg && `<link rel="icon" href="${p}favicon.svg" type="image/svg+xml">`,
    `<link rel="icon" href="${p}favicon-32x32.png" type="image/png" sizes="32x32">`,
    `<link rel="icon" href="${p}favicon-16x16.png" type="image/png" sizes="16x16">`,
    `<link rel="apple-touch-icon" href="${p}apple-touch-icon.png">`,
    `<link rel="manifest" href="${p}site.webmanifest">`,
    `<meta name="theme-color" content="${s.theme}">`,
  ]
    .filter(Boolean)
    .join("\n");
}

let version = 0;
const rebuild = debounce(async () => {
  const v = ++version;
  if (!ready()) {
    out = null;
    return paint();
  }
  const files = [];
  for (const p of PNGS) {
    const blob = await canvasToBlob(
      render(p.size, {
        matte: p.touch || p.maskable ? s.touchBg : null,
        maskable: p.maskable,
      }),
      "image/png",
    );
    files.push({ ...p, blob });
  }
  const ico = await buildIco([16, 32, 48]);
  const svg = buildSvg();
  if (v !== version) return;
  files.unshift({ name: "favicon.ico", size: 48, blob: ico, ico: true });
  if (svg) files.push({ name: "favicon.svg", size: "SVG", blob: svgBlob(svg) });
  out?.files.forEach((f) => URL.revokeObjectURL(f.url));
  files.forEach((f) => {
    f.url = URL.createObjectURL(f.blob);
  });
  out = { files, svg, html: htmlTags(!!svg), manifest: manifest() };
  paint();
}, 120);

/* ---------- Previews ---------- */
const file = (name) => out?.files.find((f) => f.name === name);

function paint() {
  const tabIcon = file("favicon-32x32.png")?.url;
  const tab = (theme) =>
    h(
      "div",
      { class: `fav-window ${theme}` },
      h(
        "div",
        { class: "fav-strip" },
        h("div", { class: "fav-dots" }, h("i"), h("i"), h("i")),
        h(
          "div",
          { class: "fav-tab is-active" },
          tabIcon
            ? h("img", { src: tabIcon, alt: "" })
            : h("i", { class: "ph" }),
          h("span", {}, s.appName || "My Website"),
        ),
        h(
          "div",
          { class: "fav-tab" },
          h("i", { class: "ph" }),
          h("span", {}, "Another tab"),
        ),
      ),
      h(
        "div",
        { class: "fav-bar" },
        h(
          "div",
          { class: "fav-url" },
          tabIcon
            ? h("img", { src: file("favicon-16x16.png").url, alt: "" })
            : "",
          "example.com",
        ),
      ),
      h("div", { class: "fav-page" }),
    );
  $("tabs").replaceChildren(tab("light"), tab("dark"));

  const fake = [
    "#ff9f0a",
    "#34c759",
    "#0a84ff",
    "#ff375f",
    "#5e5ce6",
    "#64d2ff",
    "#ffd60a",
    "#bf5af2",
    "#30d158",
    "#ff453a",
    "#ac8e68",
  ];
  const labels = [
    "Notes",
    "Maps",
    "Mail",
    "Music",
    "Photos",
    "Weather",
    "Clock",
    "Podcasts",
    "Health",
    "Camera",
    "Files",
  ];
  const apps = fake.map((c, i) =>
    h(
      "div",
      { class: "fav-app" },
      h("div", {
        class: "ic",
        style: `background:linear-gradient(160deg,${c},color-mix(in srgb,${c} 60%,#000))`,
      }),
      h("span", {}, labels[i]),
    ),
  );
  const touch = file("apple-touch-icon.png")?.url;
  apps.splice(
    5,
    0,
    h(
      "div",
      { class: "fav-app is-ours" },
      touch
        ? h("img", { class: "ic", src: touch, alt: "" })
        : h("div", { class: "ic", style: "background:#fff3" }),
      h("span", {}, s.shortName || "Website"),
    ),
  );
  $("phone").replaceChildren(h("div", { class: "fav-screen" }, apps));

  $("sizes").replaceChildren(
    ...(out?.files || []).map((f) => {
      const px = typeof f.size === "number" ? Math.min(f.size, 96) : 48;
      return h(
        "button",
        {
          type: "button",
          class: "fav-size",
          title: `Download ${f.name}`,
          onclick: () => downloadBlob(f.blob, f.name),
        },
        h(
          "div",
          {
            class: "checker",
            style: `width:${Math.max(px, 28) + 8}px;height:${Math.max(px, 28) + 8}px`,
          },
          h("img", {
            src: f.url,
            alt: f.name,
            width: f.ico ? 32 : px,
            height: f.ico ? 32 : px,
          }),
        ),
        h("b", {}, f.name),
        h(
          "span",
          {},
          `${f.ico ? "16, 32, 48" : typeof f.size === "number" ? `${f.size}×${f.size}` : "vector"} · ${formatBytes(f.blob.size)}`,
        ),
      );
    }),
  );
  $("code").textContent = out
    ? out.html
    : s.mode === "image"
      ? "Drop, choose or paste an image to start."
      : "Type a letter or an emoji to start.";
  for (const b of actionBtns) b.disabled = !out;
}

/* ---------- Actions ---------- */
const btn = (label, ic, fn, primary) => {
  const b = h("button", {
    type: "button",
    class: `btn${primary ? " btn-primary" : ""}`,
    html: `${icon(ic)} ${label}`,
  });
  b.addEventListener("click", fn);
  return b;
};
const actionBtns = [
  btn(
    "Download all (.zip)",
    "archive",
    async () => {
      try {
        await downloadZip(
          [
            ...out.files.map((f) => ({ name: f.name, blob: f.blob })),
            { name: "site.webmanifest", text: out.manifest },
            { name: "favicon-tags.html", text: `${out.html}\n` },
          ],
          "favicons.zip",
        );
      } catch (err) {
        toast(err.message, "error");
      }
    },
    true,
  ),
  btn("Copy HTML", "copy", () => copyText(out.html, "HTML tags copied")),
  btn("Copy 512px PNG", "copy", () => copyBlob(file("icon-512.png").blob)),
  btn("Manifest", "download", () =>
    downloadBlob(
      new Blob([out.manifest], { type: "application/manifest+json" }),
      "site.webmanifest",
    ),
  ),
];
$("actions").append(
  ...actionBtns,
  h("span", { class: "spacer" }),
  h(
    "span",
    { class: "hint" },
    "SVG favicons use the visitor’s fonts: system fonts and emoji match exactly; web fonts fall back.",
  ),
);

syncMode();
onChange();
