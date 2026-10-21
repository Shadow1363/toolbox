/** Wood: the logo burned in (pyrography) or carved into the grain. */
import { fbm1 } from '/assets/js/lib/random.js';
import {
  pick, between, vary, noiseTex, grainTexture, texFill, lighting,
  logoLayer, copyOf, put, fillColor, roughen, bevel, eat,
} from './_common.js';

const WOODS = [
  { c: '#c99a63', grain: '#8a5a2e' }, // oak
  { c: '#6b4429', grain: '#3a2112' }, // walnut
  { c: '#e2c08d', grain: '#b0834c' }, // pine
  { c: '#a5573a', grain: '#62291a' }, // cherry
  { c: '#d8b98f', grain: '#9c7448' }, // ash
];

function grainLines(ctx, env, wood, vertical) {
  const { W, H, k, r } = env;
  const [len, across] = vertical ? [H, W] : [W, H];
  ctx.save();
  if (vertical) { ctx.translate(W, 0); ctx.rotate(Math.PI / 2); }
  const seed = Math.floor(r() * 1e6);
  const n = Math.floor(across / (7 * k));
  for (let i = 0; i < n; i++) {
    const y0 = (i / n) * across + (r() - 0.5) * 6 * k;
    ctx.beginPath();
    for (let x = -20; x <= len + 20; x += 24 * k) {
      const y = y0 + fbm1(x / (420 * k) + i * 0.13, seed) * 38 * k + fbm1(x / (90 * k), seed + i) * 3 * k;
      x < 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = wood.grain;
    ctx.globalAlpha = between(r, 0.05, 0.3);
    ctx.lineWidth = between(r, 0.6, 3.2) * k;
    ctx.stroke();
  }
  ctx.restore();
}

export default {
  id: 'wood',
  name: 'Wood',
  render(ctx, env) {
    const { W, H, k, r, u } = env;
    const wood = pick(r, WOODS);
    const base = vary(r, wood.c, 8);
    const vertical = r() < 0.4;
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    const streak = noiseTex(71, { cx: 1, cy: 48, octaves: 4 });
    texFill(ctx, streak, r, { w: W, h: H, op: 'overlay', alpha: 0.5, sx: 10 * k, sy: 2 * k, rot: vertical ? 90 : 0 });
    grainLines(ctx, env, wood, vertical);
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.35, scale: Math.max(0.6, k) });
    // plank seams
    if (r() < 0.6) {
      const step = between(r, 0.28, 0.5) * Math.min(W, H) * (vertical ? 1 : 1);
      const off = r() * step;
      ctx.save();
      for (let p = off; p < (vertical ? W : H); p += step) {
        ctx.fillStyle = 'rgba(20,10,5,0.55)';
        vertical ? ctx.fillRect(p, 0, 3 * k, H) : ctx.fillRect(0, p, W, 3 * k);
        ctx.fillStyle = 'rgba(255,240,220,0.15)';
        vertical ? ctx.fillRect(p + 3 * k, 0, 2 * k, H) : ctx.fillRect(0, p + 3 * k, W, 2 * k);
      }
      ctx.restore();
    }
    // varnish sheen
    texFill(ctx, noiseTex(72, { cx: 3, octaves: 5 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.4, scale: 4 * k });

    const burned = r() < 0.55;
    const ink = env.ink(burned ? ['#2a1608', '#1a0d05', '#3b1f0c'] : [wood.grain]);
    const L = logoLayer(env, ink);
    if (burned) {
      roughen(L, r, { blur: Math.max(1, u * 0.004), amount: 0.35, scale: k });
      // scorched halo, then the burn itself; multiply keeps the grain visible
      put(ctx, copyOf(L, 'scorch'), { op: 'multiply', alpha: 0.45, blur: u * 0.02 });
      eat(L, streak, r, { amount: 0.35, lo: 0.6, hi: 0.95, sx: 10 * k, sy: 2 * k, rot: vertical ? 90 : 0 });
      put(ctx, L, { op: 'multiply', alpha: 0.92 });
      put(ctx, L, { op: 'multiply', alpha: 0.4 });
    } else {
      const depth = Math.max(1.5, u * 0.01);
      const floor = copyOf(L, 'floor');
      if (ink) fillColor(floor, ink);
      put(ctx, floor, { op: ink ? 'multiply' : 'source-over', alpha: ink ? 0.5 : 0.9 });
      bevel(ctx, L, { depth, raised: false, hi: 0.5, lo: 0.8, blur: depth * 0.4 });
    }
    lighting(ctx, W, H, r, 0.3);
    return { bg: base, surface: 'paper' };
  },
};
