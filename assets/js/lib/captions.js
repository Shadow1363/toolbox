/*
 * Captions renderer (Auto Captions, Waveform Video): draws one caption page at time t (karaoke wipe, pop-in, word highlight, boxes, outline).

 *
 *   drawCaption(ctx, page, t, style)
 *   style = { family, weight, size, uppercase, color, hlColor, highlight: 'none'|'color'|'box'|'wipe',
 *             reveal: 'page'|'word', pop, stroke, strokeColor, shadow, bg: 'none'|'box'|'lines',
 *             bgColor, bgOpacity, posY (0..100), width (0..100), lineHeight }
 * Sizes are authored for a 1080px short side and scaled by k.
 */
import { fontString } from "./fonts.js";
import { roundRectPath } from "./canvas.js";
import { easings, clamp } from "./easing.js";

const POP = 0.18; // seconds a word takes to pop in

/** Lay the page's words out in rows that fit `maxW`. */
function layout(ctx, words, size, maxW, spaceW) {
  const rows = [];
  let row = [],
    w = 0;
  for (const word of words) {
    const ww = ctx.measureText(word.label).width;
    if (row.length && w + spaceW + ww > maxW) {
      rows.push({ items: row, w });
      row = [];
      w = 0;
    }
    row.push({ word, w: ww });
    w += (row.length > 1 ? spaceW : 0) + ww;
  }
  if (row.length) rows.push({ items: row, w });
  return rows;
}

function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

export function drawCaption(ctx, page, t, o) {
  if (!page) return;
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const k = Math.min(W, H) / 1080;
  const size = o.size * k;
  const words = page.words.map((w, i) => ({
    ...w,
    label: o.uppercase ? w.text.toUpperCase() : w.text,
    // A word stays "current" until the next one starts, so the highlight never blinks off mid-line.
    until: page.words[i + 1]?.start ?? Math.max(w.end, page.until ?? w.end),
  }));
  ctx.save();
  ctx.font = fontString(o.family, o.weight, size);
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.lineJoin = "round";
  const spaceW = ctx.measureText(" ").width;
  const maxW = (W * o.width) / 100;
  const rows = layout(ctx, words, size, maxW, spaceW);
  const lineH = size * (o.lineHeight || 1.18);
  const blockH = lineH * rows.length;
  const cy = (H * o.posY) / 100;
  const top = Math.min(
    H - blockH - size * 0.4,
    Math.max(size * 0.4, cy - blockH / 2),
  );
  const pad = size * 0.32;
  const radius = size * 0.22;
  const stroke = o.stroke * k;

  // Position every word.
  rows.forEach((r, ri) => {
    let x = W / 2 - r.w / 2;
    r.y = top + lineH * (ri + 0.5);
    r.x = x;
    for (const it of r.items) {
      it.x = x;
      x += it.w + spaceW;
    }
  });

  const visible = (w) => o.reveal !== "word" || t >= w.start;
  const anyVisible = words.some(visible);

  // Background boxes.
  if (o.bg !== "none" && anyVisible) {
    ctx.fillStyle = hexA(o.bgColor, o.bgOpacity);
    if (o.bg === "box") {
      const bw = Math.max(...rows.map((r) => r.w));
      ctx.beginPath();
      roundRectPath(
        ctx,
        W / 2 - bw / 2 - pad * 1.4,
        top - pad * 0.6,
        bw + pad * 2.8,
        blockH + pad * 1.2,
        radius,
      );
      ctx.fill();
    } else {
      for (const r of rows) {
        ctx.beginPath();
        roundRectPath(
          ctx,
          r.x - pad,
          r.y - lineH / 2 + pad * 0.15,
          r.w + pad * 2,
          lineH - pad * 0.3,
          radius * 0.8,
        );
        ctx.fill();
      }
    }
  }

  for (const r of rows) {
    for (const it of r.items) {
      const w = it.word;
      if (!visible(w)) continue;
      const current = t >= w.start && t < w.until;
      const past = t >= w.until;
      let scale = 1,
        alpha = 1;
      if (o.pop) {
        const p = clamp((t - w.start) / POP);
        if (o.reveal === "word") {
          scale = 0.55 + 0.45 * easings.easeOutBack(p);
          alpha = clamp(p * 3);
        }
        if (current && o.highlight !== "none")
          scale *= 1 + 0.08 * easings.easeOut(p);
      }
      const cx = it.x + it.w / 2;
      ctx.save();
      ctx.globalAlpha *= alpha;
      ctx.translate(cx, r.y);
      ctx.scale(scale, scale);
      const x0 = -it.w / 2;

      if (o.highlight === "box" && current) {
        ctx.fillStyle = o.hlColor;
        ctx.beginPath();
        roundRectPath(
          ctx,
          x0 - pad * 0.55,
          -lineH / 2 + pad * 0.2,
          it.w + pad * 1.1,
          lineH - pad * 0.4,
          radius * 0.8,
        );
        ctx.fill();
      }
      if (o.shadow > 0) {
        ctx.shadowColor = "rgba(0,0,0,0.65)";
        ctx.shadowBlur = o.shadow * k;
        ctx.shadowOffsetY = o.shadow * 0.35 * k;
      }
      if (stroke > 0) {
        ctx.strokeStyle = o.strokeColor;
        ctx.lineWidth = stroke * 2;
        ctx.strokeText(w.label, x0, 0);
        ctx.shadowColor = "transparent";
      }
      const hl =
        (o.highlight === "color" && current) ||
        (o.highlight === "wipe" && past);
      ctx.fillStyle = hl ? o.hlColor : o.color;
      ctx.fillText(w.label, x0, 0);
      ctx.shadowColor = "transparent";
      if (o.highlight === "wipe" && current) {
        // Karaoke: fill the spoken part of the current word with the highlight colour.
        const p = clamp((t - w.start) / Math.max(0.05, w.end - w.start));
        ctx.save();
        ctx.beginPath();
        ctx.rect(x0 - stroke, -lineH, (it.w + stroke * 2) * p, lineH * 2);
        ctx.clip();
        ctx.fillStyle = o.hlColor;
        ctx.fillText(w.label, x0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
  }
  ctx.restore();
}
