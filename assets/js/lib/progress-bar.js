/*
 * Progress overlay drawing (shared by Progress Overlay and the Auto Editor's progress effect):
 * a bar (line, rounded, segmented, around the edges, or a circle), chapter labels and a timer.
 *
 *   drawProgressOverlay(ctx, t, s, chapters)
 *
 * s = Progress Overlay panel state (mode, style, place, corner, circleSize, thickness, margin, segments, gap,
 * color, track, trackOpacity, reverse, glow, labels, labelSize, timerType, format, timerLabel, timerPos,
 * family, weight, timerSize, timerColor, pill, pillColor, pillOpacity, start, end, opacity).
 * chapters = [{ t, label }] in stage seconds. Sizes are authored for a 1080px short side.
 * The caller loads the fonts (ensureFont(s.family, s.weight) and Inter 700).
 */
import { roundRectPath } from "./canvas.js";
import { clamp } from "./easing.js";
import { fontString } from "./fonts.js";

export function drawProgressOverlay(ctx, t, s, chapters = []) {
  const W = ctx.canvas.width,
    H = ctx.canvas.height;
  const k = Math.min(W, H) / 1080;
  const a = s.start,
    b = Math.max(s.start + 0.1, s.end);
  const p = clamp((t - a) / (b - a));
  ctx.save();
  ctx.globalAlpha = s.opacity;
  let geo = {};
  if (s.mode !== "timer") geo = drawBar(p, W, H, k);
  if (s.mode !== "timer") drawLabels(geo, t, W, H, k);
  if (s.mode !== "bar") drawTimer(t, geo, W, H, k);
  ctx.restore();

  function rgba(hex, a) {
    const n = parseInt(hex.slice(1), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }

  /** Fractions (0..1 of the bar's time range) where chapter segments start, always beginning with 0. */
  function chapterStops() {
    const a = s.start,
      b = Math.max(s.start + 0.1, s.end);
    const inside = chapters
      .filter((c) => c.t > a + 0.05 && c.t < b - 0.05)
      .map((c) => (c.t - a) / (b - a));
    return [0, ...inside];
  }

  function segmentStops() {
    if (chapters.length) return chapterStops();
    return Array.from({ length: s.segments }, (_, i) => i / s.segments);
  }

  function spot(pos, W, H, w, hh, m) {
    const col = pos[1],
      row = pos[0];
    const x = col === "l" ? m : col === "r" ? W - m - w : (W - w) / 2;
    const y = row === "t" ? m : row === "b" ? H - m - hh : (H - hh) / 2;
    return { x, y };
  }

  /** Draws the bar; returns geometry for labels and the circle timer. */
  function drawBar(p, W, H, k) {
    const th = s.thickness * k,
      m = s.margin * k;
    const shown = s.reverse ? 1 - p : p;
    const fill = s.color,
      track = rgba(s.track, s.trackOpacity);
    ctx.save();
    if (s.glow > 0) {
      ctx.shadowColor = s.color;
      ctx.shadowBlur = s.glow * k;
    }
    const withGlow = (fn) => {
      fn();
    };
    const noGlow = (fn) => {
      ctx.save();
      ctx.shadowColor = "transparent";
      fn();
      ctx.restore();
    };

    if (s.style === "circle") {
      const R = (s.circleSize * k) / 2;
      const { x, y } = spot(s.corner, W, H, R * 2, R * 2, Math.max(m, 30 * k));
      const cx = x + R,
        cy = y + R,
        r = R - th / 2;
      ctx.lineWidth = th;
      ctx.lineCap = "round";
      noGlow(() => {
        ctx.strokeStyle = track;
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
      });
      if (shown > 0.001)
        withGlow(() => {
          ctx.strokeStyle = fill;
          ctx.beginPath();
          ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + shown * Math.PI * 2);
          ctx.stroke();
        });
      ctx.restore();
      return { circle: { cx, cy, r: r - th / 2 } };
    }

    if (s.place === "edges") {
      // One path around the frame, starting top-left, clockwise; dashed to the filled length.
      const i = m + th / 2;
      const L = 2 * (W - 2 * i) + 2 * (H - 2 * i);
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(i, i);
        ctx.lineTo(W - i, i);
        ctx.lineTo(W - i, H - i);
        ctx.lineTo(i, H - i);
        ctx.closePath();
      };
      ctx.lineWidth = th;
      ctx.lineJoin = "miter";
      noGlow(() => {
        ctx.strokeStyle = track;
        path();
        ctx.stroke();
      });
      if (shown > 0.001)
        withGlow(() => {
          ctx.strokeStyle = fill;
          ctx.setLineDash([shown * L, L + 1]);
          path();
          ctx.stroke();
          ctx.setLineDash([]);
        });
      ctx.restore();
      return { edges: true };
    }

    const y = s.place === "top" ? m : H - m - th;
    const x0 = m,
      len = W - 2 * m;
    const r = s.style === "line" ? 0 : th / 2;
    const bar = (x, w, color) => {
      if (w <= 0) return;
      ctx.fillStyle = color;
      ctx.beginPath();
      roundRectPath(ctx, x, y, w, th, Math.min(r, w / 2));
      ctx.fill();
    };
    if (s.style === "segments") {
      const stops = segmentStops();
      const gap = s.gap * k;
      stops.forEach((a, n) => {
        const b = stops[n + 1] ?? 1;
        const sx = x0 + a * len + (n ? gap / 2 : 0),
          ex = x0 + b * len - (n < stops.length - 1 ? gap / 2 : 0);
        noGlow(() => bar(sx, ex - sx, track));
        const f = clamp((shown - a) / (b - a));
        if (f > 0)
          withGlow(() =>
            bar(sx, Math.max(r * 2 * Math.min(1, f * 8), (ex - sx) * f), fill),
          );
      });
    } else {
      noGlow(() => bar(x0, len, track));
      if (shown > 0)
        withGlow(() =>
          bar(
            x0,
            Math.max(
              s.style === "rounded" ? th * Math.min(1, shown * 20) : 0,
              len * shown,
            ),
            fill,
          ),
        );
      // Chapter ticks
      noGlow(() => {
        ctx.fillStyle = rgba("#000000", 0.55);
        for (const f of chapterStops().slice(1))
          ctx.fillRect(
            x0 + f * len - Math.max(1, 1.5 * k),
            y,
            Math.max(2, 3 * k),
            th,
          );
      });
    }
    ctx.restore();
    return { line: { x0, len, y, th } };
  }

  function drawLabels(geo, t, W, H, k) {
    if (s.labels === "none" || !chapters.length || !geo.line) return;
    const { x0, len, y, th } = geo.line;
    const a = s.start,
      b = Math.max(s.start + 0.1, s.end);
    const stops = chapterStops();
    const named = [
      { t: a, label: chapters.find((c) => c.t <= a + 0.05)?.label ?? "" },
      ...chapters.filter((c) => c.t > a + 0.05 && c.t < b - 0.05),
    ];
    const size = s.labelSize * k;
    ctx.save();
    ctx.font = fontString("Inter", 700, size);
    ctx.textBaseline = s.place === "top" ? "top" : "bottom";
    const ly = s.place === "top" ? y + th + size * 0.4 : y - size * 0.4;
    const cur = named.reduce((acc, c, i) => (t >= c.t ? i : acc), 0);
    named.forEach((c, i) => {
      if (!c.label || (s.labels === "current" && i !== cur)) return;
      const from = x0 + stops[i] * len,
        to = x0 + (stops[i + 1] ?? 1) * len;
      const lx = clamp(from + size * 0.3, size * 0.3, W - size * 0.3);
      ctx.save();
      ctx.beginPath();
      ctx.rect(from, 0, Math.max(0, to - from - size * 0.2), H);
      ctx.clip(); // stay inside the segment
      ctx.globalAlpha = s.labels === "all" && i !== cur ? 0.6 : 1;
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = size * 0.25;
      ctx.fillStyle = "#ffffff";
      ctx.fillText(c.label, lx, ly);
      ctx.restore();
    });
    ctx.restore();
  }

  function formatClock(sec) {
    sec = Math.max(0, sec);
    const tenths = s.format === "m:ss.d";
    const total = tenths ? Math.floor(sec * 10) / 10 : Math.ceil(sec - 1e-6);
    const hh = Math.floor(total / 3600),
      mm = Math.floor(total / 60) % 60,
      ss = Math.floor(total % 60);
    const p2 = (n) => String(n).padStart(2, "0");
    switch (s.format) {
      case "mm:ss":
        return `${p2(Math.floor(total / 60))}:${p2(ss)}`;
      case "h:mm:ss":
        return `${hh}:${p2(mm)}:${p2(ss)}`;
      case "s":
        return String(Math.floor(total));
      case "m:ss.d":
        return `${Math.floor(total / 60)}:${p2(ss)}.${Math.floor((total * 10) % 10)}`;
      default:
        return `${Math.floor(total / 60)}:${p2(ss)}`;
    }
  }

  function drawTimer(t, geo, W, H, k) {
    const a = s.start,
      b = Math.max(s.start + 0.1, s.end);
    const value =
      s.timerType === "down" ? b - clamp(t, a, b) : clamp(t, a, b) - a;
    const text = formatClock(value);
    const size = s.timerSize * k;
    ctx.save();
    ctx.font = fontString(s.family, s.weight, size);
    ctx.textBaseline = "middle";
    ctx.textAlign = "center";
    const tw = ctx.measureText(text).width;
    const labelSize = size * 0.38;
    const hasLabel = !!s.timerLabel.trim();
    let cx, cy;
    if (s.timerPos === "circle" && geo.circle) {
      cx = geo.circle.cx;
      cy = geo.circle.cy;
    } else {
      const padX = s.pill ? size * 0.45 : 0,
        padY = s.pill ? size * 0.22 : 0;
      const bw = tw + padX * 2,
        bh = size * 1.05 + padY * 2 + (hasLabel ? labelSize * 1.2 : 0);
      const edge =
        s.timerPos[0] === "b" &&
        s.mode === "both" &&
        geo.line &&
        s.place === "bottom"
          ? (s.margin + s.thickness) * k + 30 * k
          : s.timerPos[0] === "t" &&
              s.mode === "both" &&
              geo.line &&
              s.place === "top"
            ? (s.margin + s.thickness) * k + 30 * k
            : 40 * k;
      const pos = spot(
        s.timerPos === "circle" ? "tr" : s.timerPos,
        W,
        H,
        bw,
        bh,
        edge,
      );
      cx = pos.x + bw / 2;
      cy = pos.y + bh / 2;
      if (s.pill) {
        ctx.fillStyle = rgba(s.pillColor, s.pillOpacity);
        ctx.beginPath();
        roundRectPath(ctx, pos.x, pos.y, bw, bh, Math.min(bh / 2, size * 0.4));
        ctx.fill();
      }
    }
    const textY = hasLabel ? cy + labelSize * 0.55 : cy;
    if (hasLabel) {
      ctx.font = fontString("Inter", 700, labelSize);
      ctx.fillStyle = rgba(s.timerColor, 0.8);
      ctx.fillText(
        s.timerLabel.toUpperCase(),
        cx,
        textY - size * 0.55 - labelSize * 0.25,
      );
      ctx.font = fontString(s.family, s.weight, size);
    }
    ctx.fillStyle = s.timerColor;
    if (!s.pill) {
      ctx.shadowColor = "rgba(0,0,0,.6)";
      ctx.shadowBlur = size * 0.15;
    }
    ctx.fillText(text, cx, textY + size * 0.03);
    ctx.restore();
  }
}
