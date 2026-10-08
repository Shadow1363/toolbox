/*
 * Screen Showcase styling, shared by Screen Showcase and Zoom on Click: backgrounds (solid, gradient,
 * blurred media), browser/phone frames, rounded corners, border and the soft drop shadow.

 *
 *   createControls(root, [backgroundSection(), frameSection(), ...])   // the shared panel sections
 *   drawShowcaseBackground(ctx, media, W, H, k, s)                     // s = panel state
 *   const box = fitInFrame(media, W, H, k, s)                          // { w, h } of the media inside padding + chrome
 *   const { card, r } = buildFrameCard(source, box.w, box.h, k, s)     // source: anything drawable at that size
 *   drawCardShadow(ctx, card, r, tf, s, k, alpha)                      // tf = { rx, ry, scale, x, y, focal }
 */
import {
  fit,
  roundRectPath,
  linearGradient,
  scratch,
  drawBlurred,
} from "./canvas.js";
import { projectPoint } from "./perspective.js";
import { fontString } from "./fonts.js";

export const GRADIENTS = [
  {
    label: "Aurora",
    value: "aurora",
    colors: ["#ff7eb3", "#7c6cff", "#22d3ee"],
  },
  {
    label: "Sunset",
    value: "sunset",
    colors: ["#ff9a5a", "#ff5e7e", "#a43cf0"],
  },
  { label: "Ocean", value: "ocean", colors: ["#1fa2ff", "#12d8fa", "#a6ffcb"] },
  {
    label: "Midnight",
    value: "midnight",
    colors: ["#0f0c29", "#302b63", "#24243e"],
  },
  { label: "Peach", value: "peach", colors: ["#ffecd2", "#fcb69f"] },
  { label: "Forest", value: "forest", colors: ["#134e5e", "#71b280"] },
  { label: "Mono", value: "mono", colors: ["#e9ecf2", "#c3c9d6"] },
];

/** Panel section: background type, color, gradient, blur. `extra` options let a tool add e.g. 'none'. */
export function backgroundSection({
  value = "gradient",
  options = [
    ["transparent", "None"],
    ["solid", "Solid"],
    ["gradient", "Gradient"],
    ["blur", "Blurred"],
  ],
} = {}) {
  return {
    title: "Background",
    controls: [
      { id: "bg", type: "segmented", label: "Type", value, options },
      {
        id: "bgColor",
        type: "color",
        label: "Color",
        value: "#111318",
        showIf: (s) => s.bg === "solid",
      },
      {
        id: "gradient",
        type: "swatches",
        label: "Gradient",
        value: "aurora",
        showIf: (s) => s.bg === "gradient",
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
        value: 135,
        unit: "°",
        showIf: (s) => s.bg === "gradient",
      },
      {
        id: "blurAmount",
        type: "range",
        label: "Blur",
        min: 10,
        max: 120,
        value: 60,
        unit: "px",
        showIf: (s) => s.bg === "blur",
      },
    ],
  };
}

/** Panel section: frame, address bar, padding, radius, border, shadow. */
export function frameSection({ frame = "browser-light", padding = 10 } = {}) {
  return {
    title: "Frame",
    controls: [
      {
        id: "frame",
        type: "select",
        label: "Frame",
        value: frame,
        options: [
          ["none", "None"],
          ["browser-light", "Browser (light)"],
          ["browser-dark", "Browser (dark)"],
          ["phone", "Phone"],
        ],
      },
      {
        id: "url",
        type: "text",
        label: "Address bar",
        value: "yourproduct.com",
        showIf: (s) => s.frame.startsWith("browser"),
      },
      {
        id: "padding",
        type: "range",
        label: "Padding",
        min: 0,
        max: 30,
        value: padding,
        unit: "%",
      },
      {
        id: "radius",
        type: "range",
        label: "Corner radius",
        min: 0,
        max: 60,
        value: 14,
        unit: "px",
      },
      {
        id: "border",
        type: "range",
        label: "Border",
        min: 0,
        max: 20,
        value: 0,
        unit: "px",
      },
      {
        id: "borderColor",
        type: "color",
        label: "Border color",
        value: "#ffffff",
        showIf: (s) => s.border > 0,
      },
      {
        id: "shadow",
        type: "range",
        label: "Shadow",
        min: 0,
        max: 150,
        value: 60,
        unit: "px",
      },
      {
        id: "shadowOpacity",
        type: "range",
        label: "Shadow strength",
        min: 0,
        max: 1,
        step: 0.01,
        value: 0.4,
        format: (v) => `${Math.round(v * 100)}%`,
        showIf: (s) => s.shadow > 0,
      },
    ],
  };
}

/** Frame chrome (in px) around the media. */
export function frameChrome(frame, k) {
  if (frame.startsWith("browser"))
    return { top: Math.round(46 * k), side: 0, bottom: 0 };
  if (frame === "phone")
    return {
      top: Math.round(16 * k),
      side: Math.round(16 * k),
      bottom: Math.round(16 * k),
    };
  return { top: 0, side: 0, bottom: 0 };
}

/** Size of the media inside the padded stage, leaving room for the frame chrome. */
export function fitInFrame(m, W, H, k, s) {
  const pad = (Math.min(W, H) * s.padding) / 100;
  const ch = frameChrome(s.frame, k);
  return fit(
    m.width,
    m.height,
    W - pad * 2 - ch.side * 2,
    H - pad * 2 - ch.top - ch.bottom,
  );
}

/** Where the media sits inside the card built by buildFrameCard: { x, y } offset in card pixels. */
export function mediaOffset(s, k) {
  const ch = frameChrome(s.frame, k);
  return { x: ch.side, y: ch.top };
}

/** Render `source` (drawn at mw×mh) plus frame chrome, radius and border into an offscreen card. */
export function buildFrameCard(source, mw, mh, k, s, name = "showcase-card") {
  const ch = frameChrome(s.frame, k);
  const W = Math.round(mw + ch.side * 2),
    H = Math.round(mh + ch.top + ch.bottom);
  const card = scratch(name, W, H);
  const c = card.getContext("2d");
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  const r = s.frame === "phone" ? Math.max(s.radius, 40) * k : s.radius * k;

  c.save();
  c.beginPath();
  roundRectPath(c, 0, 0, W, H, r);
  c.clip();

  if (s.frame.startsWith("browser")) {
    const dark = s.frame === "browser-dark";
    c.fillStyle = dark ? "#1f2229" : "#eef0f4";
    c.fillRect(0, 0, W, ch.top);
    const dot = 6 * k,
      cy = ch.top / 2;
    ["#ff5f57", "#febc2e", "#28c840"].forEach((col, i) => {
      c.fillStyle = col;
      c.beginPath();
      c.arc(20 * k + i * 20 * k, cy, dot, 0, Math.PI * 2);
      c.fill();
    });
    const urlW = Math.min(W * 0.5, 520 * k),
      urlH = 26 * k;
    c.fillStyle = dark ? "#2c3039" : "#ffffff";
    c.beginPath();
    roundRectPath(c, (W - urlW) / 2, cy - urlH / 2, urlW, urlH, urlH / 2);
    c.fill();
    c.fillStyle = dark ? "#a6adbb" : "#5b6477";
    c.font = fontString("Inter", 500, 13 * k);
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(s.url, W / 2, cy + 0.5);
    c.drawImage(source, 0, ch.top, mw, mh);
  } else if (s.frame === "phone") {
    c.fillStyle = "#0b0c10";
    c.fillRect(0, 0, W, H);
    const ir = Math.max(0, r - ch.side);
    c.save();
    c.beginPath();
    roundRectPath(c, ch.side, ch.top, mw, mh, ir);
    c.clip();
    c.drawImage(source, ch.side, ch.top, mw, mh);
    c.restore();
    // camera island (portrait screens only)
    if (mh > mw) {
      const iw = Math.min(mw * 0.3, 120 * k),
        ih = iw * 0.3;
      c.fillStyle = "#0b0c10";
      c.beginPath();
      roundRectPath(c, (W - iw) / 2, ch.top + 12 * k, iw, ih, ih / 2);
      c.fill();
    }
  } else {
    c.drawImage(source, 0, 0, mw, mh);
  }
  c.restore();

  if (s.border > 0) {
    const bw = s.border * k;
    c.lineWidth = bw;
    c.strokeStyle = s.borderColor;
    c.beginPath();
    roundRectPath(c, bw / 2, bw / 2, W - bw, H - bw, Math.max(0, r - bw / 2));
    c.stroke();
  }
  return { card, r };
}

/** Stage background: nothing (transparent), solid, gradient, or the media blurred to fill. */
export function drawShowcaseBackground(ctx, m, W, H, k, s) {
  if (s.bg === "transparent") return;
  if (s.bg === "solid") {
    ctx.fillStyle = s.bgColor;
    ctx.fillRect(0, 0, W, H);
    return;
  }
  if (s.bg === "gradient") {
    const g = GRADIENTS.find((x) => x.value === s.gradient) || GRADIENTS[0];
    ctx.fillStyle = linearGradient(ctx, W, H, s.gAngle, g.colors);
    ctx.fillRect(0, 0, W, H);
    return;
  }
  const f = fit(m.width, m.height, W, H, "cover");
  const pad = s.blurAmount * k * 2;
  drawBlurred(
    ctx,
    m.el,
    f.x - pad,
    f.y - pad,
    f.w + pad * 2,
    f.h + pad * 2,
    s.blurAmount * k,
  );
  ctx.fillStyle = "rgba(0,0,0,.18)";
  ctx.fillRect(0, 0, W, H);
}

/** Outline of the card (rounded corners), projected, as a polygon for the shadow. */
export function shadowPolygon(w, h, r, tf) {
  const pts = [];
  const corners = [
    [w / 2 - r, -h / 2 + r, -Math.PI / 2],
    [w / 2 - r, h / 2 - r, 0],
    [-w / 2 + r, h / 2 - r, Math.PI / 2],
    [-w / 2 + r, -h / 2 + r, Math.PI],
  ];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 6; i++) {
      const a = a0 + (i / 6) * (Math.PI / 2);
      pts.push(projectPoint(cx + Math.cos(a) * r, cy + Math.sin(a) * r, tf));
    }
  }
  return pts;
}

/** Soft drop shadow under the (possibly tilted) card. Drawn off-screen and offset back so only the shadow shows. */
export function drawCardShadow(ctx, card, r, tf, s, k, alpha = 1) {
  if (!(s.shadow > 0)) return;
  const poly = shadowPolygon(card.width, card.height, r, tf);
  const OFF = 100000;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${s.shadowOpacity * alpha})`;
  ctx.shadowBlur = s.shadow * k;
  ctx.shadowOffsetX = OFF;
  ctx.shadowOffsetY = s.shadow * 0.4 * k;
  ctx.translate(-OFF, 0);
  ctx.beginPath();
  poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  ctx.fillStyle = "#000";
  ctx.fill();
  ctx.restore();
}
