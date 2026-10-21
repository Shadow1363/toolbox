/** Die-cut vinyl sticker on a laptop lid or wrapped around a water bottle. */
import {
  pick, between, vary, noiseTex, grainTexture, texFill, lighting,
  logoLayer, blankLike, copyOf, put, fillColor, dilate, bevel, dropShadow, paintInside,
} from './_common.js';

const LIDS = ['#2b2d31', '#c9cbce', '#e6e2da', '#33475b', '#b9a7c9', '#9fb7a5'];
const BOTTLES = ['#1d5e8c', '#d94f3d', '#2f7d5b', '#1d1d1f', '#e8e4dc', '#f0b429', '#7b5ea7'];
const INKS = ['#1d1d1f', '#e2462f', '#2f6fd6', '#1f8a5b', '#f08a24'];

/** Wrap a layer around a vertical cylinder of radius R centred at frame x = cx (strips, squeezed toward the sides). */
function wrapCylinder(L, cx, R) {
  const out = blankLike(L, 'wrap');
  const x = out.c.ctx;
  const c = cx - L.x;
  for (let sx = 0; sx < L.w; sx += 2) {
    const a0 = (sx - c) / R, a1 = (sx + 2 - c) / R;
    if (Math.abs(a0) > 1.5 || Math.abs(a1) > 1.5) continue;
    const d0 = c + R * Math.sin(a0), d1 = c + R * Math.sin(a1);
    x.drawImage(L.c, sx, 0, 2, L.h, d0, 0, Math.max(0.5, d1 - d0 + 0.3), L.h);
  }
  return out;
}

/** Shading across a cylinder: dark sides, a bright highlight stripe. */
function cylinderShade(ctx, cx, R, y0, y1, hi) {
  const g = ctx.createLinearGradient(cx - R, 0, cx + R, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.55)');
  g.addColorStop(0.22, 'rgba(0,0,0,0.12)');
  g.addColorStop(0.32 + hi * 0.1, 'rgba(255,255,255,0.35)');
  g.addColorStop(0.42 + hi * 0.1, 'rgba(255,255,255,0)');
  g.addColorStop(0.8, 'rgba(0,0,0,0.18)');
  g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g;
  ctx.fillRect(cx - R, y0, R * 2, y1 - y0);
}

export default {
  id: 'sticker',
  name: 'Sticker',
  render(ctx, env) {
    const { W, H, k, r, u, box } = env;
    const bottle = r() < 0.45;
    const cx = box.x + box.w / 2;
    let bg, R = 0;
    if (bottle) {
      // a blurry room behind a bottle
      const wall = vary(r, pick(r, ['#d9d4cb', '#a9b4b8', '#3b3f45', '#e9dfcf']), 10);
      const g = ctx.createLinearGradient(0, 0, 0, H);
      g.addColorStop(0, wall);
      g.addColorStop(1, vary(r, '#6d6258', 10));
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
      texFill(ctx, noiseTex(91, { cx: 2, octaves: 4 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.5, scale: 6 * k });
      R = Math.max(box.w * between(r, 0.62, 0.8), u * 0.55);
      const body = vary(r, pick(r, BOTTLES), 8);
      ctx.save();
      ctx.shadowColor = 'rgba(0,0,0,0.35)';
      ctx.shadowBlur = 40 * k;
      ctx.shadowOffsetX = 18 * k;
      ctx.fillStyle = body;
      ctx.beginPath();
      ctx.roundRect(cx - R, -R, R * 2, H + R * 2, R * 0.3);
      ctx.fill();
      ctx.restore();
      texFill(ctx, grainTexture(), r, { x: cx - R, w: R * 2, h: H, op: 'overlay', alpha: 0.25, scale: Math.max(0.6, k) });
      bg = body;
    } else {
      const lid = vary(r, pick(r, LIDS), 6);
      ctx.fillStyle = lid;
      ctx.fillRect(0, 0, W, H);
      texFill(ctx, noiseTex(92, { cx: 1, cy: 64, octaves: 3 }), r, { w: W, h: H, op: 'overlay', alpha: 0.12, sx: 8 * k, sy: k });
      texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.2, scale: Math.max(0.6, k) });
      // a couple of other stickers out at the edges
      for (let i = 0, n = Math.floor(between(r, 1, 4)); i < n; i++) {
        const a = r() * Math.PI * 2, d = u * between(r, 0.95, 1.5);
        const x = cx + Math.cos(a) * d, y = box.y + box.h / 2 + Math.sin(a) * d, s = u * between(r, 0.2, 0.4);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(between(r, -0.5, 0.5));
        ctx.shadowColor = 'rgba(0,0,0,0.3)';
        ctx.shadowBlur = 8 * k;
        ctx.shadowOffsetY = 3 * k;
        ctx.fillStyle = vary(r, pick(r, ['#f2c12e', '#2aa6c9', '#e8519b', '#ffffff', '#47b26b']), 10);
        ctx.beginPath();
        if (r() < 0.5) ctx.arc(0, 0, s / 2, 0, Math.PI * 2);
        else ctx.roundRect(-s / 2, -s * 0.35, s, s * 0.7, s * 0.15);
        ctx.fill();
        ctx.restore();
      }
      bg = lid;
    }

    // sticker: logo + white die-cut border
    const ink = env.ink(INKS);
    const art = logoLayer(env, ink, { pad: 0.3, name: 'st-art' });
    const border = dilate(art, u * between(r, 0.035, 0.055), 'st-border');
    const sticker = copyOf(border, 'st-body');
    fillColor(sticker, pick(r, ['#ffffff', '#ffffff', '#f6f2e8']));
    sticker.c.ctx.drawImage(art.c, 0, 0);
    // vinyl gloss
    const gl = sticker.c.ctx.createLinearGradient(0, 0, sticker.w, sticker.h);
    const p = between(r, 0.25, 0.6);
    gl.addColorStop(Math.max(0, p - 0.18), 'rgba(255,255,255,0)');
    gl.addColorStop(p, 'rgba(255,255,255,0.32)');
    gl.addColorStop(Math.min(1, p + 0.2), 'rgba(255,255,255,0)');
    const glossy = sticker.c.ctx;
    glossy.save();
    glossy.globalCompositeOperation = 'source-atop';
    glossy.fillStyle = gl;
    glossy.fillRect(0, 0, sticker.w, sticker.h);
    glossy.restore();
    const final = bottle ? wrapCylinder(sticker, cx, R) : sticker;
    dropShadow(ctx, final, { dx: k, dy: 2 * k, blur: 3 * k, alpha: 0.35 });
    put(ctx, final);
    bevel(ctx, final, { depth: 1.2 * k, raised: true, hi: 0.4, lo: 0.25, blur: 0.5 * k });
    if (bottle) {
      ctx.save();
      ctx.globalCompositeOperation = 'soft-light';
      cylinderShade(ctx, cx, R, 0, H, r());
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 0.6;
      cylinderShade(ctx, cx, R, 0, H, 0.5);
      ctx.restore();
    }
    lighting(ctx, W, H, r, 0.25);
    return { bg, surface: 'screen' };
  },
};
