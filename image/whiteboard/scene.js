/*
 * Whiteboard scene: element geometry, hit testing, arrow binding, and rendering to canvas or SVG.

 *
 * Element: { id, type, x, y, w, h, points?, stroke, fill, fillStyle, strokeWidth, strokeStyle, opacity,
 *            sketch (hand-drawn), seed, text?, fontSize, font, align, startHead, endHead,
 *            start?: { id }, end?: { id }, groupId?, fileId? }
 *   Shapes, text, sticky notes and images use x/y/w/h (w, h ≥ 0). Lines, arrows and pen strokes use
 *   absolute `points` ([[x, y], …]); their x/y/w/h is kept as the points' bounding box.
 * Arrows bound to a shape (start/end) have that endpoint recomputed by updateBindings() so they stay
 * attached: it is the point where the line towards the shape's centre crosses its outline, plus a gap.
 */
export const FONTS = {
  hand: '"Kalam", "Comic Sans MS", "Segoe Print", cursive',
  sans: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};
export const BINDABLE = new Set([
  "rect",
  "ellipse",
  "diamond",
  "text",
  "sticky",
  "image",
]);
export const isLinear = (el) =>
  el.type === "line" || el.type === "arrow" || el.type === "draw";
const GAP = 6;

/* ---------- Geometry ---------- */
export function syncBox(el) {
  if (!el.points?.length) return el;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const [x, y] of el.points) {
    if (x < x0) x0 = x;
    if (y < y0) y0 = y;
    if (x > x1) x1 = x;
    if (y > y1) y1 = y;
  }
  el.x = x0;
  el.y = y0;
  el.w = x1 - x0;
  el.h = y1 - y0;
  return el;
}
export const bounds = (el) => ({ x: el.x, y: el.y, w: el.w, h: el.h });
export function unionBounds(els) {
  if (!els.length) return null;
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const e of els) {
    const pad = isLinear(e) ? e.strokeWidth || 2 : 0;
    x0 = Math.min(x0, e.x - pad);
    y0 = Math.min(y0, e.y - pad);
    x1 = Math.max(x1, e.x + e.w + pad);
    y1 = Math.max(y1, e.y + e.h + pad);
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
export const centerOf = (el) => [el.x + el.w / 2, el.y + el.h / 2];

function distToSeg(px, py, [ax, ay], [bx, by]) {
  const dx = bx - ax,
    dy = by - ay;
  const t =
    dx || dy
      ? Math.max(
          0,
          Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)),
        )
      : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Is (px, py) on the element? `tol` is in world units. */
export function hitTest(el, px, py, tol) {
  if (isLinear(el)) {
    const t = tol + (el.strokeWidth || 2) / 2;
    for (let i = 1; i < el.points.length; i++)
      if (distToSeg(px, py, el.points[i - 1], el.points[i]) <= t) return true;
    return (
      el.points.length === 1 &&
      Math.hypot(px - el.points[0][0], py - el.points[0][1]) <= t
    );
  }
  const { x, y, w, h } = el;
  if (px < x - tol || px > x + w + tol || py < y - tol || py > y + h + tol)
    return false;
  const filled =
    el.fill !== "none" ||
    el.type === "text" ||
    el.type === "sticky" ||
    el.type === "image" ||
    el.text;
  if (filled) {
    if (el.type === "ellipse")
      return (
        ((px - x - w / 2) / (w / 2 + tol)) ** 2 +
          ((py - y - h / 2) / (h / 2 + tol)) ** 2 <=
        1
      );
    if (el.type === "diamond")
      return (
        Math.abs(px - x - w / 2) / (w / 2 + tol) +
          Math.abs(py - y - h / 2) / (h / 2 + tol) <=
        1
      );
    return true;
  }
  // Unfilled shapes: only near the outline, so things drawn inside them stay clickable.
  const t = tol + (el.strokeWidth || 2);
  if (el.type === "ellipse") {
    const r = Math.hypot(
      (px - x - w / 2) / (w / 2),
      (py - y - h / 2) / (h / 2),
    );
    return (Math.abs(r - 1) * Math.min(w, h)) / 2 <= t;
  }
  const pts = outline(el);
  for (let i = 0; i < pts.length; i++)
    if (distToSeg(px, py, pts[i], pts[(i + 1) % pts.length]) <= t) return true;
  return false;
}
function outline(el) {
  const { x, y, w, h } = el;
  if (el.type === "diamond")
    return [
      [x + w / 2, y],
      [x + w, y + h / 2],
      [x + w / 2, y + h],
      [x, y + h / 2],
    ];
  return [
    [x, y],
    [x + w, y],
    [x + w, y + h],
    [x, y + h],
  ];
}

/* ---------- Binding ---------- */
/** Where a line from `from` towards the centre of `el` meets el's outline, pushed out by GAP. */
export function edgePoint(el, from) {
  const [cx, cy] = centerOf(el);
  let dx = from[0] - cx,
    dy = from[1] - cy;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return [cx, cy];
  dx /= len;
  dy /= len;
  const a = el.w / 2,
    b = el.h / 2;
  let t;
  if (el.type === "ellipse")
    t = 1 / Math.sqrt((dx * dx) / (a * a || 1) + (dy * dy) / (b * b || 1));
  else if (el.type === "diamond")
    t = 1 / (Math.abs(dx) / (a || 1) + Math.abs(dy) / (b || 1));
  else
    t = Math.min(
      Math.abs(dx) > 1e-9 ? a / Math.abs(dx) : Infinity,
      Math.abs(dy) > 1e-9 ? b / Math.abs(dy) : Infinity,
    );
  t += GAP;
  if (t >= len) return [cx + dx * Math.min(t, len), cy + dy * Math.min(t, len)];
  return [cx + dx * t, cy + dy * t];
}

/** Re-attach every bound arrow/line endpoint. `byId` maps id → element. */
export function updateBindings(elements, byId) {
  for (const el of elements) {
    if (!(el.type === "arrow" || el.type === "line") || el.points.length < 2)
      continue;
    const A = el.start && byId.get(el.start.id),
      B = el.end && byId.get(el.end.id);
    if (el.start && !A) delete el.start;
    if (el.end && !B) delete el.end;
    if (!A && !B) continue;
    const n = el.points.length - 1;
    // Aim each end at the other end's shape centre (or its free point).
    const otherForStart = B ? centerOf(B) : el.points[Math.min(1, n)];
    const otherForEnd = A ? centerOf(A) : el.points[Math.max(0, n - 1)];
    if (A) el.points[0] = edgePoint(A, n > 1 ? el.points[1] : otherForStart);
    if (B) el.points[n] = edgePoint(B, n > 1 ? el.points[n - 1] : otherForEnd);
    syncBox(el);
  }
}

/** The topmost bindable element under (x, y), ignoring `skip`. */
export function bindTarget(elements, x, y, skip) {
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!BINDABLE.has(el.type) || skip.has(el.id)) continue;
    if (
      x >= el.x - 8 &&
      x <= el.x + el.w + 8 &&
      y >= el.y - 8 &&
      y <= el.y + el.h + 8
    )
      return el;
  }
  return null;
}

/* ---------- Text ---------- */
const mctx = document.createElement("canvas").getContext("2d");
export const fontCss = (el) =>
  `${el.type === "sticky" ? 400 : 400} ${el.fontSize}px ${FONTS[el.font] || FONTS.hand}`;

/** Lines of text wrapped to `maxW` (no wrapping when maxW is falsy). */
export function wrapText(el, maxW) {
  mctx.font = fontCss(el);
  const out = [];
  for (const para of String(el.text ?? "").split("\n")) {
    if (!maxW) {
      out.push(para);
      continue;
    }
    let line = "";
    for (const word of para.split(/(\s+)/)) {
      const next = line + word;
      if (
        line &&
        word.trim() &&
        mctx.measureText(next.trimEnd()).width > maxW
      ) {
        out.push(line.trimEnd());
        line = word.trimStart();
      } else line = next;
    }
    out.push(line);
  }
  return out;
}
/** Size a free text element to its content. */
export function measureText(el) {
  const lines = wrapText(el, 0);
  mctx.font = fontCss(el);
  el.w = Math.max(8, ...lines.map((l) => mctx.measureText(l).width)) + 2;
  el.h = lines.length * el.fontSize * 1.25;
  return el;
}

/* ---------- Rough options ---------- */
const DASH = {
  dashed: (w) => [w * 4, w * 3],
  dotted: (w) => [w * 0.5, w * 2.5],
};
export function roughOpts(el) {
  const o = {
    seed: el.seed,
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    roughness: 1.2,
    bowing: 1,
    preserveVertices: true,
  };
  if (el.fill !== "none" && !isLinear(el)) {
    o.fill = el.fill;
    o.fillStyle =
      el.fillStyle === "solid"
        ? "solid"
        : el.fillStyle === "cross"
          ? "cross-hatch"
          : "hachure";
    o.fillWeight = el.strokeWidth / 2;
    o.hachureGap = el.strokeWidth * 4;
  }
  if (el.strokeStyle !== "solid")
    o.strokeLineDash = DASH[el.strokeStyle](el.strokeWidth);
  return o;
}

/* ---------- Arrowheads ---------- */
function headPaths(el) {
  const out = [];
  const pts = el.points;
  if (pts.length < 2) return out;
  const size = Math.max(10, el.strokeWidth * 4.5);
  const mk = (tip, prev, kind) => {
    const ang = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
    if (kind === "dot") {
      out.push({ kind: "dot", c: tip, r: size * 0.32 });
      return;
    }
    const a1 = ang + Math.PI - 0.45,
      a2 = ang + Math.PI + 0.45;
    const p1 = [tip[0] + Math.cos(a1) * size, tip[1] + Math.sin(a1) * size];
    const p2 = [tip[0] + Math.cos(a2) * size, tip[1] + Math.sin(a2) * size];
    out.push({ kind, pts: [p1, tip, p2] });
  };
  if (el.endHead && el.endHead !== "none")
    mk(pts[pts.length - 1], pts[pts.length - 2], el.endHead);
  if (el.startHead && el.startHead !== "none") mk(pts[0], pts[1], el.startHead);
  return out;
}

/* ---------- Canvas rendering ---------- */
const roughCache = new Map(); // id → { key, drawables }

function drawablesFor(el, gen) {
  const key = JSON.stringify([
    el.type,
    el.x,
    el.y,
    el.w,
    el.h,
    el.points,
    el.stroke,
    el.fill,
    el.fillStyle,
    el.strokeWidth,
    el.strokeStyle,
    el.seed,
    el.startHead,
    el.endHead,
  ]);
  const hit = roughCache.get(el.id);
  if (hit && hit.key === key) return hit.drawables;
  const o = roughOpts(el);
  const ds = [];
  const { x, y, w, h } = el;
  if (el.type === "rect") ds.push(gen.rectangle(x, y, w, h, o));
  else if (el.type === "ellipse")
    ds.push(gen.ellipse(x + w / 2, y + h / 2, w, h, o));
  else if (el.type === "diamond") ds.push(gen.polygon(outline(el), o));
  else if (el.type === "line" || el.type === "arrow") {
    ds.push(gen.linearPath(el.points, o));
    for (const hd of headPaths(el)) {
      if (hd.kind === "dot")
        ds.push(
          gen.circle(hd.c[0], hd.c[1], hd.r * 2, {
            ...o,
            fill: el.stroke,
            fillStyle: "solid",
          }),
        );
      else if (hd.kind === "triangle")
        ds.push(
          gen.polygon(hd.pts, {
            ...o,
            fill: el.stroke,
            fillStyle: "solid",
            strokeLineDash: undefined,
          }),
        );
      else ds.push(gen.linearPath(hd.pts, { ...o, strokeLineDash: undefined }));
    }
  }
  roughCache.set(el.id, { key, drawables: ds });
  return ds;
}
export const forgetRough = (id) => roughCache.delete(id);

function dash(ctx, el) {
  ctx.setLineDash(
    el.strokeStyle !== "solid" ? DASH[el.strokeStyle](el.strokeWidth) : [],
  );
}

function freehandPath(ctx, pts) {
  ctx.beginPath();
  if (pts.length < 3) {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
    return;
  }
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2,
      my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  const l = pts[pts.length - 1];
  ctx.lineTo(l[0], l[1]);
}

/**
 * Draw one element. `env` = { rough: RoughCanvas | null, gen, images: Map(fileId → img), editingId }.
 */
export function drawElement(ctx, el, env) {
  ctx.save();
  ctx.globalAlpha = ((el.opacity ?? 100) / 100) * (el._fade ? 0.25 : 1);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const { x, y, w, h } = el;
  const sketch = el.sketch && env.rough;

  if (el.type === "image") {
    const img = env.images.get(el.fileId);
    if (img) ctx.drawImage(img, x, y, w, h);
    else {
      ctx.fillStyle = "rgba(128,128,128,.25)";
      ctx.fillRect(x, y, w, h);
    }
  } else if (el.type === "sticky") {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.18)";
    ctx.shadowBlur = 12;
    ctx.shadowOffsetY = 4;
    ctx.fillStyle = el.fill === "none" ? "#fff3a3" : el.fill;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
  } else if (el.type === "draw") {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    dash(ctx, el);
    freehandPath(ctx, el.points);
    ctx.stroke();
  } else if (sketch && el.type !== "text") {
    for (const d of drawablesFor(el, env.gen)) env.rough.draw(d);
  } else if (
    el.type === "rect" ||
    el.type === "ellipse" ||
    el.type === "diamond"
  ) {
    ctx.beginPath();
    if (el.type === "rect") {
      const r = Math.min(8, w / 4, h / 4);
      ctx.roundRect ? ctx.roundRect(x, y, w, h, r) : ctx.rect(x, y, w, h);
    } else if (el.type === "ellipse")
      ctx.ellipse(
        x + w / 2,
        y + h / 2,
        Math.max(0.5, w / 2),
        Math.max(0.5, h / 2),
        0,
        0,
        Math.PI * 2,
      );
    else {
      const p = outline(el);
      ctx.moveTo(...p[0]);
      p.slice(1).forEach((q) => ctx.lineTo(...q));
      ctx.closePath();
    }
    if (el.fill !== "none") {
      ctx.fillStyle = el.fill;
      ctx.fill();
    }
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    dash(ctx, el);
    ctx.stroke();
  } else if (el.type === "line" || el.type === "arrow") {
    ctx.strokeStyle = el.stroke;
    ctx.lineWidth = el.strokeWidth;
    dash(ctx, el);
    ctx.beginPath();
    el.points.forEach((p, i) =>
      i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]),
    );
    ctx.stroke();
    ctx.setLineDash([]);
    for (const hd of headPaths(el)) {
      ctx.beginPath();
      if (hd.kind === "dot") {
        ctx.arc(hd.c[0], hd.c[1], hd.r, 0, Math.PI * 2);
        ctx.fillStyle = el.stroke;
        ctx.fill();
        continue;
      }
      ctx.moveTo(...hd.pts[0]);
      ctx.lineTo(...hd.pts[1]);
      ctx.lineTo(...hd.pts[2]);
      if (hd.kind === "triangle") {
        ctx.closePath();
        ctx.fillStyle = el.stroke;
        ctx.fill();
      }
      ctx.stroke();
    }
  }

  // Text: free text, sticky notes and shape labels.
  if (el.text && el.id !== env.editingId) {
    ctx.setLineDash([]);
    ctx.fillStyle = el.type === "sticky" ? "#2b2b2b" : el.stroke;
    ctx.font = fontCss(el);
    ctx.textBaseline = "middle";
    const lh = el.fontSize * 1.25;
    if (el.type === "text") {
      ctx.textAlign = el.align || "left";
      const tx =
        el.align === "center" ? x + w / 2 : el.align === "right" ? x + w : x;
      String(el.text)
        .split("\n")
        .forEach((l, i) => ctx.fillText(l, tx, y + i * lh + lh / 2));
    } else {
      const pad = el.type === "sticky" ? 16 : Math.max(8, w * 0.08);
      const lines = wrapText(el, Math.max(10, w - pad * 2));
      ctx.textAlign = el.type === "sticky" ? el.align || "left" : "center";
      const tx =
        ctx.textAlign === "left"
          ? x + pad
          : ctx.textAlign === "right"
            ? x + w - pad
            : x + w / 2;
      const top =
        el.type === "sticky" ? y + pad : y + h / 2 - (lines.length * lh) / 2;
      lines.forEach((l, i) => ctx.fillText(l, tx, top + i * lh + lh / 2));
    }
  }
  ctx.restore();
}

/* ---------- SVG ---------- */
const esc = (t) =>
  String(t).replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

export function elementSvg(el, env) {
  const parts = [];
  const op = (el.opacity ?? 100) / 100;
  const { x, y, w, h } = el;
  const dashAttr =
    el.strokeStyle !== "solid"
      ? ` stroke-dasharray="${DASH[el.strokeStyle](el.strokeWidth).join(" ")}"`
      : "";
  const stroke = `stroke="${el.stroke}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"${dashAttr}`;
  if (el.type === "image") {
    const src = env.files[el.fileId];
    if (src)
      parts.push(
        `<image x="${x}" y="${y}" width="${w}" height="${h}" href="${src}" preserveAspectRatio="none"/>`,
      );
  } else if (el.type === "sticky") {
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${el.fill === "none" ? "#fff3a3" : el.fill}" filter="url(#wb-sticky)"/>`,
    );
  } else if (el.type === "draw") {
    const pts = el.points;
    let d = `M${pts[0][0]} ${pts[0][1]}`;
    if (pts.length < 3)
      d +=
        pts
          .slice(1)
          .map((p) => `L${p[0]} ${p[1]}`)
          .join("") || `l0.01 0`;
    else {
      for (let i = 1; i < pts.length - 1; i++)
        d += `Q${pts[i][0]} ${pts[i][1]} ${(pts[i][0] + pts[i + 1][0]) / 2} ${(pts[i][1] + pts[i + 1][1]) / 2}`;
      d += `L${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]}`;
    }
    parts.push(`<path d="${d}" fill="none" ${stroke}/>`);
  } else if (el.sketch && env.gen && el.type !== "text") {
    for (const dr of drawablesFor(el, env.gen)) {
      for (const p of env.gen.toPaths(dr)) {
        parts.push(
          `<path d="${p.d}" stroke="${p.stroke}" stroke-width="${p.strokeWidth}" fill="${p.fill || "none"}" stroke-linecap="round" stroke-linejoin="round"${p.fill && p.fill !== "none" && p.stroke === "none" ? "" : dashAttr}/>`,
        );
      }
    }
  } else if (el.type === "rect") {
    parts.push(
      `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(8, w / 4, h / 4)}" fill="${el.fill}" ${stroke}/>`,
    );
  } else if (el.type === "ellipse") {
    parts.push(
      `<ellipse cx="${x + w / 2}" cy="${y + h / 2}" rx="${w / 2}" ry="${h / 2}" fill="${el.fill}" ${stroke}/>`,
    );
  } else if (el.type === "diamond") {
    parts.push(
      `<polygon points="${outline(el)
        .map((p) => p.join(","))
        .join(" ")}" fill="${el.fill}" ${stroke}/>`,
    );
  } else if (el.type === "line" || el.type === "arrow") {
    parts.push(
      `<polyline points="${el.points.map((p) => p.join(",")).join(" ")}" fill="none" ${stroke}/>`,
    );
    for (const hd of headPaths(el)) {
      if (hd.kind === "dot")
        parts.push(
          `<circle cx="${hd.c[0]}" cy="${hd.c[1]}" r="${hd.r}" fill="${el.stroke}"/>`,
        );
      else
        parts.push(
          `<polyline points="${hd.pts.map((p) => p.join(",")).join(" ")}" fill="${hd.kind === "triangle" ? el.stroke : "none"}" stroke="${el.stroke}" stroke-width="${el.strokeWidth}" stroke-linecap="round" stroke-linejoin="round"/>`,
        );
    }
  }
  if (el.text) {
    const lh = el.fontSize * 1.25;
    const fill = el.type === "sticky" ? "#2b2b2b" : el.stroke;
    let lines, anchor, tx, top;
    if (el.type === "text") {
      lines = String(el.text).split("\n");
      anchor =
        el.align === "center"
          ? "middle"
          : el.align === "right"
            ? "end"
            : "start";
      tx = el.align === "center" ? x + w / 2 : el.align === "right" ? x + w : x;
      top = y;
    } else {
      const pad = el.type === "sticky" ? 16 : Math.max(8, w * 0.08);
      lines = wrapText(el, Math.max(10, w - pad * 2));
      const al = el.type === "sticky" ? el.align || "left" : "center";
      anchor = al === "center" ? "middle" : al === "right" ? "end" : "start";
      tx = al === "left" ? x + pad : al === "right" ? x + w - pad : x + w / 2;
      top =
        el.type === "sticky" ? y + pad : y + h / 2 - (lines.length * lh) / 2;
    }
    parts.push(
      `<text font-family='${(FONTS[el.font] || FONTS.hand).replace(/'/g, '"')}' font-size="${el.fontSize}" fill="${fill}" text-anchor="${anchor}" xml:space="preserve">${lines.map((l, i) => `<tspan x="${tx}" y="${top + i * lh + lh / 2}" dominant-baseline="central">${esc(l)}</tspan>`).join("")}</text>`,
    );
  }
  return op < 1 ? `<g opacity="${op}">${parts.join("")}</g>` : parts.join("");
}
