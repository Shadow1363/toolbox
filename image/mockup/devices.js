/*
 * Generic device frames for the Mockup Generator, drawn with canvas paths (no product shapes or logos).

 *
 *   const g = geometry(dev, sw, sh);         // body size + screen rect for a sw×sh screen
 *   drawDevice(ctx, dev, g, drawScreen);     // at (0, 0); drawScreen(ctx, rect) fills the clipped screen
 *
 * Each type has `units`: its screen width relative to the others (a phone next to a laptop looks the
 * right size). Bezels scale with the screen, so a frame looks the same at any export size.
 */
import { roundRectPath } from "/assets/js/lib/canvas.js";
import { rng } from "/assets/js/lib/random.js";

export const TYPES = {
  phone: { name: "Phone", units: 7.2, aspect: 9 / 19.5, rotate: true },
  tablet: { name: "Tablet", units: 17, aspect: 3 / 4, rotate: true },
  laptop: { name: "Laptop", units: 29, aspect: 16 / 10 },
  monitor: { name: "Monitor", units: 46, aspect: 16 / 9 },
  browser: { name: "Browser", units: 32, aspect: 16 / 10 },
};

export const COLORS = {
  black: { name: "Black", body: "#2b2b2f", edge: "#5a5a60" },
  silver: { name: "Silver", body: "#cfd2d6", edge: "#f2f3f5" },
  white: { name: "White", body: "#efefed", edge: "#ffffff" },
  blue: { name: "Blue", body: "#2b3955", edge: "#56688f" },
  rose: { name: "Rose", body: "#d9b8b0", edge: "#f3dcd6" },
};

/** Screen size (px) for a device whose type is drawn at `unit` px per unit. */
export function screenSize(dev, unit) {
  const T = TYPES[dev.type];
  let aspect = T.aspect;
  if (dev.type === "browser" && dev.media)
    aspect = Math.max(0.5, Math.min(2.6, dev.media.width / dev.media.height));
  let sw = T.units * unit * (dev.size / 100),
    sh = sw / aspect;
  if (T.rotate && dev.landscape) [sw, sh] = [sh, sw];
  if (dev.type === "browser" && aspect < 1) {
    sw = T.units * unit * 0.62 * (dev.size / 100);
    sh = sw / aspect;
  }
  return [sw, sh];
}

export function geometry(dev, sw, sh) {
  const base = Math.min(sw, sh);
  switch (dev.type) {
    case "phone": {
      const b = base * 0.045,
        R = base * 0.16;
      return {
        w: sw + 2 * b,
        h: sh + 2 * b,
        b,
        R,
        screen: { x: b, y: b, w: sw, h: sh, r: Math.max(0, R - b * 0.95) },
      };
    }
    case "tablet": {
      const b = base * 0.055,
        R = base * 0.075;
      return {
        w: sw + 2 * b,
        h: sh + 2 * b,
        b,
        R,
        screen: { x: b, y: b, w: sw, h: sh, r: Math.max(0, R - b) },
      };
    }
    case "laptop": {
      const bs = sw * 0.022,
        bt = sw * 0.03,
        bb = sw * 0.032;
      const lidW = sw + 2 * bs,
        lidH = sh + bt + bb,
        deckW = lidW * 1.13,
        deckH = sw * 0.028;
      const lx = (deckW - lidW) / 2;
      return {
        w: deckW,
        h: lidH + deckH,
        lx,
        lidW,
        lidH,
        deckH,
        bs,
        bt,
        screen: { x: lx + bs, y: bt, w: sw, h: sh, r: sw * 0.004 },
      };
    }
    case "monitor": {
      const b = sw * 0.013,
        bodyW = sw + 2 * b,
        bodyH = sh + 2 * b;
      const neckH = sw * 0.12,
        footH = sw * 0.022;
      return {
        w: bodyW,
        h: bodyH + neckH + footH,
        b,
        bodyW,
        bodyH,
        neckH,
        footH,
        screen: { x: b, y: b, w: sw, h: sh, r: sw * 0.003 },
      };
    }
    case "browser":
    default: {
      const tb = Math.max(sw * 0.052, 24);
      return {
        w: sw,
        h: sh + tb,
        tb,
        R: sw * 0.012,
        screen: { x: 0, y: tb, w: sw, h: sh, r: 0 },
      };
    }
  }
}

const vgrad = (ctx, y0, y1, stops) => {
  const g = ctx.createLinearGradient(0, y0, 0, y1);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
};
const hgrad = (ctx, x0, x1, stops) => {
  const g = ctx.createLinearGradient(x0, 0, x1, 0);
  stops.forEach((c, i) => g.addColorStop(i / (stops.length - 1), c));
  return g;
};
const rr = (ctx, x, y, w, h, r) => {
  ctx.beginPath();
  roundRectPath(ctx, x, y, w, h, r);
};

/** Draw the whole device at (0, 0). drawScreen(ctx, rect) is called with the screen clipped. */
export function drawDevice(ctx, dev, g, drawScreen) {
  const col = COLORS[dev.color] || COLORS.black;
  const sc = g.screen;
  const screen = (x0 = 0, y0 = 0) => {
    ctx.save();
    rr(ctx, x0 + sc.x, y0 + sc.y, sc.w, sc.h, sc.r);
    ctx.clip();
    drawScreen(ctx, { x: x0 + sc.x, y: y0 + sc.y, w: sc.w, h: sc.h });
    // A faint glass sheen across the top-left.
    const sheen = ctx.createLinearGradient(
      x0 + sc.x,
      y0 + sc.y,
      x0 + sc.x + sc.w * 0.7,
      y0 + sc.y + sc.h * 0.7,
    );
    sheen.addColorStop(0, "rgba(255,255,255,0.06)");
    sheen.addColorStop(0.5, "rgba(255,255,255,0)");
    ctx.fillStyle = sheen;
    ctx.fillRect(x0 + sc.x, y0 + sc.y, sc.w, sc.h);
    ctx.restore();
  };

  if (dev.type === "phone" || dev.type === "tablet") {
    const { w, h, b, R } = g;
    const land = !!dev.landscape;
    const base = Math.min(sc.w, sc.h);
    // Side buttons, drawn first so the body overlaps them.
    if (dev.type === "phone") {
      const p = base * 0.012,
        t = base * 0.02;
      ctx.fillStyle = col.edge;
      const btn = (along, len, side) => {
        if (!land) {
          const y = h * along;
          side === "l"
            ? rr(ctx, -p, y, p + t, h * len, t / 2)
            : rr(ctx, w - t, y, p + t, h * len, t / 2);
        } else {
          const x = w * (1 - along - len);
          side === "l"
            ? rr(ctx, x, -p, w * len, p + t, t / 2)
            : rr(ctx, x, h - t, w * len, p + t, t / 2);
        }
        ctx.fill();
      };
      btn(0.17, 0.045, "l");
      btn(0.25, 0.075, "l");
      btn(0.34, 0.075, "l");
      btn(0.27, 0.11, "r");
    }
    rr(ctx, 0, 0, w, h, R);
    ctx.fillStyle = land
      ? vgrad(ctx, 0, h, [col.edge, col.body, col.body, col.edge])
      : hgrad(ctx, 0, w, [col.edge, col.body, col.body, col.edge]);
    ctx.fill();
    const f = b * (dev.type === "phone" ? 0.3 : 0.22);
    rr(ctx, f, f, w - 2 * f, h - 2 * f, Math.max(0, R - f));
    ctx.fillStyle = "#09090b";
    ctx.fill();
    screen();
    // Front camera: a punch hole on phones, a dot in the bezel on tablets.
    const cx = land
      ? dev.type === "phone"
        ? sc.x + base * 0.06
        : b / 2
      : w / 2;
    const cy = land ? h / 2 : dev.type === "phone" ? sc.y + base * 0.06 : b / 2;
    const cr = dev.type === "phone" ? base * 0.022 : b * 0.13;
    ctx.beginPath();
    ctx.arc(cx, cy, cr, 0, Math.PI * 2);
    ctx.fillStyle = "#050506";
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx - cr * 0.25, cy - cr * 0.25, cr * 0.35, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(80,90,140,0.55)";
    ctx.fill();
    return;
  }

  if (dev.type === "laptop") {
    const { lx, lidW, lidH, deckH, w } = g;
    const R = lidW * 0.02;
    // Lid: thin coloured rim, black glass bezel.
    rr(ctx, lx, 0, lidW, lidH, [R, R, R * 0.25, R * 0.25]);
    ctx.fillStyle = col.edge;
    ctx.fill();
    const f = lidW * 0.004;
    rr(ctx, lx + f, f, lidW - 2 * f, lidH - f, [R - f, R - f, 0, 0]);
    ctx.fillStyle = "#0b0b0d";
    ctx.fill();
    screen();
    ctx.beginPath();
    ctx.arc(lx + lidW / 2, g.bt / 2, lidW * 0.0035, 0, Math.PI * 2);
    ctx.fillStyle = "#26262b";
    ctx.fill();
    // Hinge shadow, deck with rounded front corners and a thumb notch.
    const y = lidH;
    ctx.fillStyle = vgrad(ctx, y, y + deckH * 0.35, ["#111", col.body]);
    ctx.fillRect(lx + lidW * 0.04, y, lidW * 0.92, deckH * 0.35);
    rr(ctx, 0, y, w, deckH, [
      deckH * 0.15,
      deckH * 0.15,
      deckH * 0.9,
      deckH * 0.9,
    ]);
    ctx.fillStyle = vgrad(ctx, y, y + deckH, [
      col.edge,
      col.body,
      col.body,
      shade(col.body, -0.35),
    ]);
    ctx.fill();
    const nw = lidW * 0.15,
      nh = deckH * 0.38;
    rr(ctx, (w - nw) / 2, y, nw, nh, [0, 0, nh * 0.8, nh * 0.8]);
    ctx.fillStyle = shade(col.body, -0.18);
    ctx.fill();
    return;
  }

  if (dev.type === "monitor") {
    const { bodyW, bodyH, neckH, footH, b } = g;
    // Stand behind the body.
    const nw = bodyW * 0.11;
    ctx.fillStyle = hgrad(ctx, (bodyW - nw) / 2, (bodyW + nw) / 2, [
      shade(col.body, -0.25),
      col.edge,
      shade(col.body, -0.25),
    ]);
    ctx.beginPath();
    ctx.moveTo((bodyW - nw) / 2, bodyH - b);
    ctx.lineTo((bodyW + nw) / 2, bodyH - b);
    ctx.lineTo((bodyW + nw * 1.15) / 2, bodyH + neckH);
    ctx.lineTo((bodyW - nw * 1.15) / 2, bodyH + neckH);
    ctx.closePath();
    ctx.fill();
    const fw = bodyW * 0.34;
    rr(
      ctx,
      (bodyW - fw) / 2,
      bodyH + neckH - footH * 0.1,
      fw,
      footH,
      footH * 0.5,
    );
    ctx.fillStyle = vgrad(ctx, bodyH + neckH, bodyH + neckH + footH, [
      col.edge,
      shade(col.body, -0.3),
    ]);
    ctx.fill();
    const R = bodyW * 0.008;
    rr(ctx, 0, 0, bodyW, bodyH, R);
    ctx.fillStyle = col.edge;
    ctx.fill();
    const f = b * 0.3;
    rr(ctx, f, f, bodyW - 2 * f, bodyH - 2 * f, Math.max(0, R - f));
    ctx.fillStyle = "#0b0b0d";
    ctx.fill();
    screen();
    return;
  }

  // Browser window
  const dark = dev.theme === "dark";
  const { w, h, tb, R } = g;
  const C = dark
    ? {
        bar: "#2b2b2f",
        url: "#1c1c1f",
        text: "#e7e7ea",
        muted: "#8e8e93",
        line: "rgba(255,255,255,0.08)",
      }
    : {
        bar: "#ebebed",
        url: "#ffffff",
        text: "#1d1d1f",
        muted: "#8a8a8e",
        line: "rgba(0,0,0,0.09)",
      };
  ctx.save();
  rr(ctx, 0, 0, w, h, R);
  ctx.clip();
  ctx.fillStyle = C.bar;
  ctx.fillRect(0, 0, w, tb);
  const dr = tb * 0.11;
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(tb * 0.5 + i * tb * 0.38, tb / 2, dr, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  const uw = Math.min(w * 0.56, Math.max(w * 0.3, tb * 14)),
    uh = tb * 0.6;
  const ux = (w - uw) / 2,
    uy = (tb - uh) / 2;
  rr(ctx, ux, uy, uw, uh, uh * 0.3);
  ctx.fillStyle = C.url;
  ctx.fill();
  // Lock + address text
  const fs = uh * 0.48;
  const text = (dev.url || "").trim();
  ctx.font = `500 ${fs}px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`;
  const tw = Math.min(ctx.measureText(text).width, uw - fs * 4);
  const lx0 = w / 2 - (tw + fs * 1.3) / 2;
  ctx.strokeStyle = C.muted;
  ctx.lineWidth = fs * 0.12;
  ctx.fillStyle = C.muted;
  rr(ctx, lx0, tb / 2 - fs * 0.12, fs * 0.62, fs * 0.5, fs * 0.08);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(lx0 + fs * 0.31, tb / 2 - fs * 0.12, fs * 0.2, Math.PI, 0);
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.save();
  ctx.beginPath();
  ctx.rect(ux, uy, uw - fs, uh);
  ctx.clip();
  ctx.fillText(text, lx0 + fs * 1.3, tb / 2 + fs * 0.04);
  ctx.restore();
  ctx.fillStyle = C.line;
  ctx.fillRect(0, tb - 1, w, 1);
  screen();
  ctx.restore();
  rr(ctx, 0.5, 0.5, w - 1, h - 1, R);
  ctx.strokeStyle = dark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** Lighten (+) or darken (−) a hex colour. */
export function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) =>
    Math.round(amt < 0 ? v * (1 + amt) : v + (255 - v) * amt),
  );
  return `rgb(${ch.join(",")})`;
}

/** A made-up app UI for devices without a screenshot. Deterministic per seed. */
export function drawFakeUI(ctx, { x, y, w, h }, seed = 1, dark = false) {
  const r = rng(seed * 9973);
  const hue = Math.floor(r() * 360);
  const bg = dark ? "#121318" : "#f5f6fa",
    card = dark ? "#1d1f27" : "#ffffff",
    line = dark ? "#2e313d" : "#e3e5ec",
    ink = dark ? "#3a3e4c" : "#d6d9e2";
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);
  const u = Math.min(w, h) / 20;
  const wide = w > h * 1.1;
  const pad = wide ? w * 0.05 : u * 1.2;
  // Header
  const hh = Math.max(u * 2.2, h * (wide ? 0.08 : 0.06));
  ctx.fillStyle = card;
  ctx.fillRect(0, 0, w, hh);
  ctx.fillStyle = line;
  ctx.fillRect(0, hh - 1, w, 1);
  ctx.fillStyle = `hsl(${hue} 80% 58%)`;
  ctx.beginPath();
  ctx.arc(pad + hh * 0.25, hh / 2, hh * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = ink;
  rr(ctx, pad + hh * 0.6, hh / 2 - hh * 0.09, hh * 1.6, hh * 0.18, hh * 0.09);
  ctx.fill();
  if (wide) {
    for (let i = 0; i < 4; i++) {
      rr(
        ctx,
        w - pad - (4 - i) * hh * 1.25,
        hh / 2 - hh * 0.07,
        hh * 0.9,
        hh * 0.14,
        hh * 0.07,
      );
      ctx.fill();
    }
    ctx.fillStyle = `hsl(${hue} 80% 58%)`;
    rr(ctx, w - pad - hh * 0.2, hh * 0.28, hh * 0.2, hh * 0.44, hh * 0.1);
    ctx.fill();
  } else {
    for (let i = 0; i < 3; i++) {
      rr(
        ctx,
        w - pad - hh * 0.5,
        hh * 0.36 + i * hh * 0.13,
        hh * 0.5,
        hh * 0.06,
        hh * 0.03,
      );
      ctx.fill();
    }
  }
  // Hero
  const top = hh + pad;
  const heroH = wide ? h * 0.36 : h * 0.26;
  const grad = ctx.createLinearGradient(pad, top, w - pad, top + heroH);
  grad.addColorStop(0, `hsl(${hue} 85% 60%)`);
  grad.addColorStop(1, `hsl(${(hue + 50) % 360} 80% 55%)`);
  rr(ctx, pad, top, w - 2 * pad, heroH, u * 0.8);
  ctx.fillStyle = grad;
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.92)";
  const tx = pad + (wide ? heroH * 0.25 : u * 1.2);
  rr(
    ctx,
    tx,
    top + heroH * 0.3,
    (w - 2 * pad) * (wide ? 0.38 : 0.6),
    heroH * 0.1,
    heroH * 0.05,
  );
  ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  rr(
    ctx,
    tx,
    top + heroH * 0.48,
    (w - 2 * pad) * (wide ? 0.3 : 0.45),
    heroH * 0.06,
    heroH * 0.03,
  );
  ctx.fill();
  rr(
    ctx,
    tx,
    top + heroH * 0.6,
    (w - 2 * pad) * (wide ? 0.24 : 0.35),
    heroH * 0.06,
    heroH * 0.03,
  );
  ctx.fill();
  ctx.fillStyle = "#ffffff";
  rr(ctx, tx, top + heroH * 0.74, heroH * 0.5, heroH * 0.12, heroH * 0.06);
  ctx.fill();
  // Cards
  const cols = wide ? 3 : w > h * 0.65 ? 2 : 1;
  const gy = top + heroH + pad;
  const gap = pad * 0.6;
  const cw = (w - 2 * pad - gap * (cols - 1)) / cols;
  const ch = wide ? cw * 0.75 : cw * (cols === 1 ? 0.55 : 0.9);
  for (let row = 0; gy + row * (ch + gap) < h; row++) {
    for (let c = 0; c < cols; c++) {
      const cx = pad + c * (cw + gap),
        cy = gy + row * (ch + gap);
      rr(ctx, cx, cy, cw, ch, u * 0.6);
      ctx.fillStyle = card;
      ctx.fill();
      ctx.strokeStyle = line;
      ctx.lineWidth = 1;
      ctx.stroke();
      const ih = ch * 0.5;
      rr(ctx, cx + u * 0.5, cy + u * 0.5, cw - u, ih - u * 0.5, u * 0.4);
      ctx.fillStyle = `hsl(${(hue + 30 * (row * cols + c + 1)) % 360} 60% ${dark ? 30 : 86}%)`;
      ctx.fill();
      ctx.fillStyle = ink;
      rr(
        ctx,
        cx + u * 0.5,
        cy + ih + u * 0.5,
        cw * (0.5 + r() * 0.3),
        u * 0.45,
        u * 0.22,
      );
      ctx.fill();
      rr(
        ctx,
        cx + u * 0.5,
        cy + ih + u * 1.3,
        cw * (0.3 + r() * 0.3),
        u * 0.35,
        u * 0.18,
      );
      ctx.fill();
    }
  }
  ctx.restore();
}
