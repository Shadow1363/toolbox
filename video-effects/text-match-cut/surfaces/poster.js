/** Street poster or billboard: the logo printed on paper pasted to a wall, wrinkled and torn. */
import {
  pick, between, vary, luma, crumpledTexture, grainTexture, texFill, pattern, lighting,
  logoLayer, put, displace, eat,
} from './_common.js';
import { concreteWall } from './concrete.js';
import { brickLayout, drawBricks } from './brick.js';

const PAPERS = ['#f3eee2', '#f2c12e', '#e2462f', '#1d1d1f', '#2f6fd6', '#f08a24', '#e9dccb', '#3aa35b'];

/** A rectangle with jagged (torn) edges. */
function tornRect(ctx, x, y, w, h, r, rough) {
  const pts = [];
  const side = (x0, y0, x1, y1) => {
    const n = Math.max(4, Math.floor(Math.hypot(x1 - x0, y1 - y0) / (rough * 3)));
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const nx = -(y1 - y0), ny = x1 - x0, l = Math.hypot(nx, ny);
      const j = (r() - 0.5) * rough;
      pts.push([x0 + (x1 - x0) * t + (nx / l) * j, y0 + (y1 - y0) * t + (ny / l) * j]);
    }
  };
  side(x, y, x + w, y);
  side(x + w, y, x + w, y + h);
  side(x + w, y + h, x, y + h);
  side(x, y + h, x, y);
  ctx.beginPath();
  pts.forEach(([px, py], i) => (i ? ctx.lineTo(px, py) : ctx.moveTo(px, py)));
  ctx.closePath();
}

export default {
  id: 'poster',
  name: 'Billboard / poster',
  render(ctx, env) {
    const { W, H, k, r, u, box } = env;
    let bg;
    if (r() < 0.5) bg = concreteWall(ctx, env);
    else { const lay = brickLayout(env); drawBricks(ctx, env, lay); bg = lay.palette.mortar; }
    const billboard = r() < 0.35;
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    const pw = Math.max(box.w + u * 0.5, u * between(r, 1.2, 1.5));
    // the logo sits in the top part of a poster, the middle of a billboard
    const top = Math.max(box.h / 2 + u * 0.15, u * 0.45);
    const ph = Math.max(billboard ? box.h + u * 0.5 : top + box.h / 2 + u * 0.6, pw * (billboard ? between(r, 0.5, 0.62) : between(r, 1.3, 1.45)));
    const px = cx - pw / 2;
    const py = billboard ? cy - ph / 2 : cy - top;
    const paperHex = pick(r, PAPERS);
    const paper = vary(r, paperHex, 6);
    const crumple = crumpledTexture();
    const crumpleAt = { x: r() * 1024, y: r() * 1024, scale: Math.max(0.6, u / 700) };

    // scraps of older posters underneath
    if (!billboard) {
      for (let i = 0, n = Math.floor(between(r, 2, 5)); i < n; i++) {
        ctx.save();
        ctx.fillStyle = vary(r, pick(r, PAPERS), 12);
        const sw = u * between(r, 0.5, 1.1), sh = u * between(r, 0.4, 1);
        tornRect(ctx, px + between(r, -0.4, 1) * pw - sw / 2, py + between(r, -0.3, 1.1) * ph - sh / 2, sw, sh, r, 14 * k);
        ctx.fill();
        ctx.globalCompositeOperation = 'overlay';
        ctx.fillStyle = pattern(ctx, crumple, { x: r() * 900, scale: crumpleAt.scale });
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.save();
    if (billboard) {
      // metal frame and a lamp arm above
      ctx.fillStyle = '#2a2b2e';
      const f = u * 0.05;
      ctx.shadowColor = 'rgba(0,0,0,0.45)';
      ctx.shadowBlur = 30 * k;
      ctx.shadowOffsetY = 14 * k;
      ctx.fillRect(px - f, py - f, pw + f * 2, ph + f * 2);
      ctx.shadowColor = 'transparent';
      ctx.fillStyle = paper;
      ctx.fillRect(px, py, pw, ph);
    } else {
      ctx.shadowColor = 'rgba(0,0,0,0.3)';
      ctx.shadowBlur = 8 * k;
      ctx.shadowOffsetY = 3 * k;
      ctx.fillStyle = paper;
      tornRect(ctx, px, py, pw, ph, r, 10 * k);
      ctx.fill();
    }
    ctx.restore();

    // a simple layout: a colour band and lines of "copy" (blocks, no real text)
    const dark = luma(paperHex) < 0.5;
    const accent = vary(r, pick(r, PAPERS.filter((c) => c !== paperHex)), 6);
    ctx.save();
    ctx.beginPath();
    ctx.rect(px, py, pw, ph);
    ctx.clip();
    if (r() < 0.6) {
      ctx.fillStyle = accent;
      const bandY = billboard ? py + ph * 0.82 : box.y + box.h + u * between(r, 0.12, 0.2);
      ctx.fillRect(px, bandY, pw, ph * 0.12);
    }
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.75)' : 'rgba(20,20,20,0.75)';
    const lines = billboard ? 0 : Math.floor(between(r, 2, 4));
    let ly = box.y + box.h + u * 0.4;
    for (let i = 0; i < lines && ly < py + ph - u * 0.12; i++) {
      const lw = pw * between(r, 0.35, 0.75);
      ctx.fillRect(cx - lw / 2, ly, lw, u * (i ? 0.035 : 0.06));
      ly += u * (i ? 0.07 : 0.11);
    }
    ctx.restore();

    const ink = env.ink(dark ? ['#ffffff', '#f2c12e'] : ['#1d1d1f', '#c0272d', '#1f3f9a']);
    const L = logoLayer(env, ink);
    const crumpleHeight = (h) => {
      h.save();
      h.fillStyle = pattern(h, crumple, crumpleAt);
      h.fillRect(L.x, L.y, L.w, L.h);
      h.restore();
    };
    if (!billboard) displace(L, crumpleHeight, { strength: 260 * k, shade: 0, blur: 2 * k });
    eat(L, grainTexture(), r, { amount: 0.25, lo: 0.7, hi: 0.95, scale: Math.max(0.6, k) });
    put(ctx, L, { alpha: 0.96 });

    // paper wrinkles and wheat-paste bubbles over the whole sheet
    ctx.save();
    ctx.beginPath();
    if (billboard) ctx.rect(px, py, pw, ph);
    else tornRect(ctx, px, py, pw, ph, r, 10 * k);
    ctx.clip();
    ctx.globalCompositeOperation = billboard ? 'soft-light' : 'overlay';
    ctx.globalAlpha = billboard ? 0.5 : 0.85;
    ctx.fillStyle = pattern(ctx, crumple, crumpleAt);
    ctx.fillRect(px, py, pw, ph);
    if (billboard) {
      // seams between the printed sheets
      ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = 0.25;
      ctx.fillStyle = '#000';
      for (let i = 1; i < 4; i++) ctx.fillRect(px + (pw * i) / 4, py, 2 * k, ph);
    }
    ctx.restore();
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.2, scale: Math.max(0.6, k) });
    lighting(ctx, W, H, r, 0.35);
    return { bg, surface: 'aged' };
  },
};
