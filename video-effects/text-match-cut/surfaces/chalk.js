/** Chalkboard with the logo drawn in chalk: broken strokes, hatched fill, dust. */
import {
  pick, between, vary, tile, noiseTex, grainTexture, texFill, lighting,
  logoLayer, copyOf, put, roughen, eat, outline, paintInside, pattern,
} from './_common.js';

const BOARDS = ['#28382f', '#2c4136', '#1f2421', '#262a2e', '#2f3a33'];
const CHALK = ['#f4f1e8', '#f4f1e8', '#f7e27a', '#f2a7c3', '#9fd3f2', '#b7e4a1'];

export default {
  id: 'chalk',
  name: 'Chalkboard',
  render(ctx, env) {
    const { W, H, k, r, u } = env;
    const base = vary(r, pick(r, BOARDS), 5);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    texFill(ctx, noiseTex(101, { cx: 3, octaves: 6 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.6, scale: 4 * k });
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.4, scale: Math.max(0.6, k) });
    // eraser smears: wide soft arcs of chalk dust
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0, n = Math.floor(between(r, 4, 9)); i < n; i++) {
      const y = r() * H, x = r() * W, len = between(r, 0.3, 0.9) * W;
      ctx.strokeStyle = `rgba(230,235,230,${between(r, 0.03, 0.08)})`;
      ctx.lineWidth = between(r, 60, 160) * k;
      ctx.filter = `blur(${12 * k}px)`;
      ctx.beginPath();
      ctx.moveTo(x - len / 2, y);
      ctx.quadraticCurveTo(x, y + between(r, -80, 80) * k, x + len / 2, y + between(r, -40, 40) * k);
      ctx.stroke();
    }
    ctx.restore();
    // ghost of old writing
    ctx.save();
    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 4 * k;
    for (let i = 0; i < 6; i++) {
      const x = r() * W, y = r() * H;
      ctx.beginPath();
      ctx.moveTo(x, y);
      for (let j = 0; j < 8; j++) ctx.lineTo(x + j * 30 * k, y + Math.sin(j * 1.7 + i) * 14 * k);
      ctx.stroke();
    }
    ctx.restore();

    const ink = env.ink(CHALK);
    const L = logoLayer(env, ink);
    const edge = outline(L, Math.max(2, u * 0.014), 'chalk-edge');
    roughen(L, r, { blur: Math.max(1, u * 0.004), amount: 0.4, scale: k });
    // hatched fill: chalk strokes at an angle, lighter than the outline
    const hatch = tile('chalk-hatch', Math.max(4, Math.round(9 * k)), (c, n) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, n, n * 0.45);
    });
    const hx = L.c.ctx;
    hx.save();
    hx.globalCompositeOperation = 'destination-out';
    hx.globalAlpha = between(r, 0.35, 0.6);
    hx.fillStyle = pattern(hx, hatch, { rot: between(r, 20, 70), x: r() * 50 });
    hx.fillRect(0, 0, L.w, L.h);
    hx.restore();
    // the outline is pressed harder
    hx.drawImage(edge.c, 0, 0);
    // chalk skips over the board's grain
    eat(L, grainTexture(), r, { amount: 0.85, lo: 0.5, hi: 0.75, scale: Math.max(0.6, k) });
    eat(L, noiseTex(102, { cx: 16, octaves: 3 }), r, { amount: 0.5, lo: 0.55, hi: 0.85, scale: k });
    put(ctx, copyOf(L, 'dust'), { alpha: 0.18, blur: u * 0.02 });
    put(ctx, L, { alpha: 0.9 });
    lighting(ctx, W, H, r, 0.25);
    return { bg: base, surface: 'screen' };
  },
};
