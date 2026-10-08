/*
 * Social Image Maker: templates (sizes + safe areas), starter designs, and the renderer.

 *
 * Document: { v: 1, template, w, h, bg: { type, color, colors, angle, asset, blur, dim }, layers: [Layer] }
 * Layer: { id, type: 'text'|'image'|'rect'|'ellipse'|'line', name, x, y, w, h, rot, opacity, hidden, …type fields }
 *   (x, y) is the top-left of the unrotated box; rotation is around its centre, in degrees.
 * Images live in `assets` ({ id: dataURL }) so undo snapshots stay small; layers reference `asset`.
 */
import {
  fit,
  roundRectPath,
  linearGradient,
  drawBlurred,
} from "/assets/js/lib/canvas.js";
import { fontString } from "/assets/js/lib/fonts.js";

// Safe areas: `safe` = keep important content inside; `avoid` = covered by platform UI. Fractions of w/h.
export const TEMPLATES = [
  {
    id: "yt-thumb",
    name: "YouTube thumbnail",
    w: 1280,
    h: 720,
    guides: [
      { kind: "safe", x: 0.05, y: 0.06, w: 0.9, h: 0.88, label: "Title safe" },
      {
        kind: "avoid",
        x: 0.82,
        y: 0.84,
        w: 0.16,
        h: 0.12,
        label: "Duration badge",
      },
    ],
  },
  {
    id: "og",
    name: "Open Graph (link preview)",
    w: 1200,
    h: 630,
    guides: [
      { kind: "safe", x: 0.05, y: 0.08, w: 0.9, h: 0.84, label: "Margins" },
      {
        kind: "safe",
        x: (1200 - 630) / 2 / 1200,
        y: 0,
        w: 630 / 1200,
        h: 1,
        label: "Square crop (some apps)",
      },
    ],
  },
  {
    id: "x-post",
    name: "X / Twitter post",
    w: 1600,
    h: 900,
    guides: [
      { kind: "safe", x: 0.04, y: 0.06, w: 0.92, h: 0.88, label: "Margins" },
      {
        kind: "safe",
        x: 0.21875,
        y: 0,
        w: 0.5625,
        h: 1,
        label: "1:1 timeline crop",
      },
    ],
  },
  {
    id: "li-post",
    name: "LinkedIn post",
    w: 1200,
    h: 627,
    guides: [
      { kind: "safe", x: 0.05, y: 0.08, w: 0.9, h: 0.84, label: "Margins" },
    ],
  },
  {
    id: "li-banner",
    name: "LinkedIn banner",
    w: 1584,
    h: 396,
    guides: [
      {
        kind: "avoid",
        x: 0.02,
        y: 0.38,
        w: 0.2,
        h: 0.62,
        label: "Profile photo (desktop)",
      },
      {
        kind: "safe",
        x: 0.25,
        y: 0.1,
        w: 0.72,
        h: 0.62,
        label: "Visible on mobile",
      },
    ],
  },
  {
    id: "ig-post",
    name: "Instagram post (4:5)",
    w: 1080,
    h: 1350,
    guides: [
      {
        kind: "safe",
        x: 0,
        y: 0.1,
        w: 1,
        h: 0.8,
        label: "3:4 profile grid crop",
      },
      { kind: "safe", x: 0.06, y: 0.05, w: 0.88, h: 0.9, label: "Margins" },
    ],
  },
  {
    id: "ig-square",
    name: "Instagram post (1:1)",
    w: 1080,
    h: 1080,
    guides: [
      { kind: "safe", x: 0.06, y: 0.06, w: 0.88, h: 0.88, label: "Margins" },
    ],
  },
  {
    id: "ig-story",
    name: "Story / Reel (9:16)",
    w: 1080,
    h: 1920,
    guides: [
      {
        kind: "avoid",
        x: 0,
        y: 0,
        w: 1,
        h: 250 / 1920,
        label: "Profile & close buttons",
      },
      {
        kind: "avoid",
        x: 0,
        y: 1 - 340 / 1920,
        w: 1,
        h: 340 / 1920,
        label: "Reply bar",
      },
      {
        kind: "avoid",
        x: 0.84,
        y: 0.45,
        w: 0.16,
        h: 0.4,
        label: "Reel buttons",
      },
    ],
  },
  { id: "custom", name: "Custom size", w: 1200, h: 800, guides: [] },
];
export const template = (id) =>
  TEMPLATES.find((t) => t.id === id) || TEMPLATES[0];

let uid = Date.now() % 100000;
export const newId = () => `l${(uid++).toString(36)}`;

export const PALETTES = [
  {
    colors: ["#7c5cff", "#2bb5ff"],
    text: "#ffffff",
    accent: "#ffd60a",
    onAccent: "#1d1d1f",
  },
  {
    colors: ["#ff5e7e", "#ff9a5a"],
    text: "#ffffff",
    accent: "#1d1d1f",
    onAccent: "#ffffff",
  },
  {
    colors: ["#0f2027", "#2c5364"],
    text: "#ffffff",
    accent: "#3fd2c7",
    onAccent: "#0f2027",
  },
  {
    colors: ["#f6f1e7", "#e9dfc9"],
    text: "#1d1d1f",
    accent: "#e4572e",
    onAccent: "#ffffff",
  },
];

/** A ready-made layout for a template so the editor never starts empty. */
export function starter(tid, paletteIndex = 0) {
  const T = template(tid);
  const { w, h } = T;
  const P = PALETTES[paletteIndex % PALETTES.length];
  const m = Math.min(w, h);
  const tall = h > w * 1.2;
  const pad = m * 0.08;
  const titleSize = Math.round(
    m * (tall ? 0.1 : T.id === "li-banner" ? 0.17 : 0.11),
  );
  const textW = tall ? w - 2 * pad : w * (T.id === "li-banner" ? 0.6 : 0.68);
  const x0 = T.id === "li-banner" ? w * 0.3 : pad;
  const y0 = tall ? h * 0.32 : T.id === "li-banner" ? h * 0.18 : h * 0.24;
  const layers = [
    {
      id: newId(),
      type: "ellipse",
      name: "Circle",
      x: w - m * 0.55,
      y: -m * 0.2,
      w: m * 0.75,
      h: m * 0.75,
      rot: 0,
      opacity: 0.18,
      fill: "#ffffff",
      stroke: "#ffffff",
      strokeWidth: 0,
    },
    {
      id: newId(),
      type: "rect",
      name: "Tag",
      x: x0,
      y: y0 - titleSize * 0.95,
      w: titleSize * 2.6,
      h: titleSize * 0.55,
      rot: 0,
      opacity: 1,
      fill: P.accent,
      stroke: "#000000",
      strokeWidth: 0,
      radius: titleSize * 0.27,
    },
    {
      id: newId(),
      type: "text",
      name: "Tag text",
      x: x0,
      y: y0 - titleSize * 0.95 + titleSize * 0.08,
      w: titleSize * 2.6,
      h: titleSize * 0.4,
      rot: 0,
      opacity: 1,
      text: "NEW POST",
      font: "Inter",
      weight: "800",
      size: Math.round(titleSize * 0.28),
      color: P.onAccent,
      align: "center",
      lineHeight: 1.2,
      spacing: 2,
      shadow: false,
      strokeW: 0,
      strokeC: "#000000",
    },
    {
      id: newId(),
      type: "text",
      name: "Title",
      x: x0,
      y: y0,
      w: textW,
      h: titleSize * 2.3,
      rot: 0,
      opacity: 1,
      text: "A headline people will click",
      font: "Inter",
      weight: "900",
      size: titleSize,
      color: P.text,
      align: "left",
      lineHeight: 1.08,
      spacing: -1,
      shadow: false,
      strokeW: 0,
      strokeC: "#000000",
    },
    {
      id: newId(),
      type: "text",
      name: "Subtitle",
      x: x0,
      y: y0 + titleSize * 2.5,
      w: textW,
      h: titleSize * 0.5,
      rot: 0,
      opacity: 0.85,
      text: "yourwebsite.com",
      font: "Inter",
      weight: "600",
      size: Math.round(titleSize * 0.36),
      color: P.text,
      align: "left",
      lineHeight: 1.3,
      spacing: 0,
      shadow: false,
      strokeW: 0,
      strokeC: "#000000",
    },
  ];
  return {
    v: 1,
    template: T.id,
    w,
    h,
    bg: {
      type: "gradient",
      color: P.colors[0],
      colors: [...P.colors],
      angle: 135,
      asset: null,
      blur: 0,
      dim: 0,
    },
    layers,
  };
}

/* ---------- Text layout ---------- */
const measureCtx = document.createElement("canvas").getContext("2d");

/** Wrap a text layer into lines that fit its width. Explicit newlines are kept. */
export function textLines(L, ctx = measureCtx) {
  ctx.font = fontString(L.font, L.weight, L.size);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${L.spacing || 0}px`;
  const out = [];
  for (const para of String(L.text).split("\n")) {
    const words = para.split(/(\s+)/);
    let line = "";
    for (const w of words) {
      const next = line + w;
      if (line && ctx.measureText(next.trimEnd()).width > L.w && w.trim()) {
        out.push(line.trimEnd());
        line = w.trimStart();
      } else line = next;
    }
    out.push(line.trimEnd());
  }
  return out;
}
export const textHeight = (L) =>
  Math.max(L.size, textLines(L).length * L.size * L.lineHeight);

/* ---------- Rendering ---------- */
/** Draw the document at `scale` (1 = template pixels). `images` maps asset id → loaded <img>. */
export function renderDoc(ctx, doc, images, scale = 1, { skip } = {}) {
  const { w, h } = doc;
  ctx.save();
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, w, h);
  const bg = doc.bg;
  if (bg.type === "solid") {
    ctx.fillStyle = bg.color;
    ctx.fillRect(0, 0, w, h);
  } else if (bg.type === "gradient") {
    ctx.fillStyle = linearGradient(ctx, w, h, bg.angle - 90, bg.colors);
    ctx.fillRect(0, 0, w, h);
  } else if (bg.type === "image") {
    const img = images.get(bg.asset);
    if (img) {
      const f = fit(img.naturalWidth, img.naturalHeight, w, h, "cover");
      if (bg.blur > 0) {
        const m = bg.blur * 2;
        drawBlurred(
          ctx,
          img,
          f.x - m,
          f.y - m,
          f.w + 2 * m,
          f.h + 2 * m,
          bg.blur,
        );
      } else ctx.drawImage(img, f.x, f.y, f.w, f.h);
    } else {
      ctx.fillStyle = "#d9dce3";
      ctx.fillRect(0, 0, w, h);
    }
    if (bg.dim > 0) {
      ctx.fillStyle = `rgba(0,0,0,${bg.dim / 100})`;
      ctx.fillRect(0, 0, w, h);
    }
  }
  for (const L of doc.layers)
    if (!L.hidden && L.id !== skip) drawLayer(ctx, L, images);
  ctx.restore();
}

export function drawLayer(ctx, L, images) {
  ctx.save();
  ctx.globalAlpha = L.opacity ?? 1;
  const cx = L.x + L.w / 2,
    cy = L.y + L.h / 2;
  ctx.translate(cx, cy);
  ctx.rotate(((L.rot || 0) * Math.PI) / 180);
  ctx.translate(-L.w / 2, -L.h / 2);
  if (L.type === "rect" || L.type === "ellipse") {
    ctx.beginPath();
    if (L.type === "rect")
      roundRectPath(
        ctx,
        0,
        0,
        L.w,
        L.h,
        Math.min(L.radius || 0, L.w / 2, L.h / 2),
      );
    else
      ctx.ellipse(
        L.w / 2,
        L.h / 2,
        Math.abs(L.w / 2),
        Math.abs(L.h / 2),
        0,
        0,
        Math.PI * 2,
      );
    if (L.fill && L.fill !== "none") {
      ctx.fillStyle = L.fill;
      ctx.fill();
    }
    if (L.strokeWidth > 0) {
      ctx.strokeStyle = L.stroke;
      ctx.lineWidth = L.strokeWidth;
      ctx.stroke();
    }
  } else if (L.type === "line") {
    ctx.beginPath();
    ctx.moveTo(0, L.h / 2);
    ctx.lineTo(L.w, L.h / 2);
    ctx.strokeStyle = L.stroke;
    ctx.lineWidth = Math.max(1, L.strokeWidth);
    ctx.lineCap = "round";
    ctx.stroke();
  } else if (L.type === "image") {
    const img = images.get(L.asset);
    ctx.beginPath();
    roundRectPath(
      ctx,
      0,
      0,
      L.w,
      L.h,
      Math.min(L.radius || 0, L.w / 2, L.h / 2),
    );
    ctx.clip();
    if (img) {
      const f = fit(
        img.naturalWidth,
        img.naturalHeight,
        L.w,
        L.h,
        L.fit || "cover",
      );
      ctx.drawImage(img, f.x, f.y, f.w, f.h);
    } else {
      ctx.fillStyle = "rgba(128,128,128,0.3)";
      ctx.fillRect(0, 0, L.w, L.h);
    }
  } else if (L.type === "text") drawText(ctx, L);
  ctx.restore();
}

function drawText(ctx, L) {
  const lines = textLines(L, ctx);
  const lh = L.size * L.lineHeight;
  ctx.font = fontString(L.font, L.weight, L.size);
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${L.spacing || 0}px`;
  ctx.textBaseline = "middle";
  ctx.textAlign = L.align;
  const x = L.align === "center" ? L.w / 2 : L.align === "right" ? L.w : 0;
  if (L.bgOn) {
    ctx.save();
    ctx.fillStyle = L.bgColor || "#000000";
    const p = L.size * 0.25;
    lines.forEach((t, i) => {
      if (!t) return;
      const tw = ctx.measureText(t).width;
      const bx =
        L.align === "center" ? x - tw / 2 : L.align === "right" ? x - tw : x;
      ctx.beginPath();
      roundRectPath(ctx, bx - p, i * lh, tw + 2 * p, lh, p * 0.8);
      ctx.fill();
    });
    ctx.restore();
  }
  if (L.shadow) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = L.size * 0.25;
    ctx.shadowOffsetY = L.size * 0.08;
  }
  lines.forEach((t, i) => {
    const y = i * lh + lh / 2;
    if (L.strokeW > 0) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = L.strokeC;
      ctx.lineWidth = L.strokeW * 2;
      ctx.strokeText(t, x, y);
    }
    ctx.fillStyle = L.color;
    ctx.fillText(t, x, y);
  });
}

/* ---------- Geometry ---------- */
export const center = (L) => [L.x + L.w / 2, L.y + L.h / 2];

/** Point (doc px) → layer-local coords (0..w, 0..h when inside). */
export function toLocal(L, px, py) {
  const [cx, cy] = center(L);
  const a = (-(L.rot || 0) * Math.PI) / 180;
  const dx = px - cx,
    dy = py - cy;
  return [
    dx * Math.cos(a) - dy * Math.sin(a) + L.w / 2,
    dx * Math.sin(a) + dy * Math.cos(a) + L.h / 2,
  ];
}
export function toWorld(L, lx, ly) {
  const [cx, cy] = center(L);
  const a = ((L.rot || 0) * Math.PI) / 180;
  const dx = lx - L.w / 2,
    dy = ly - L.h / 2;
  return [
    cx + dx * Math.cos(a) - dy * Math.sin(a),
    cy + dx * Math.sin(a) + dy * Math.cos(a),
  ];
}
export function hit(L, px, py, tol = 0) {
  const [x, y] = toLocal(L, px, py);
  const t = L.type === "line" ? Math.max(tol, 10) : tol;
  return x >= -t && x <= L.w + t && y >= -t && y <= L.h + t;
}
