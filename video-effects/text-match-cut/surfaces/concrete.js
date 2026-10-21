/** Concrete wall with the logo spray-painted or stencilled on it. */
import {
  pick, between, rgb, noiseTex, grainTexture, texFill, lighting, stains,
  logoLayer, put, roughen, eat, overspray, copyOf,
} from './_common.js';

/** Bare concrete: blotchy grey, fine grain, pits and water streaks. Shared with the poster and neon walls. */
export function concreteWall(ctx, env, { dark = false } = {}) {
  const { W, H, k, r } = env;
  const tone = dark ? between(r, 38, 62) : between(r, 112, 176);
  const warm = between(r, -7, 9);
  const base = rgb(tone + warm, tone, tone - warm * 0.8);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, W, H);
  texFill(ctx, noiseTex(11, { cx: 3, octaves: 6 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.45, scale: 3.5 * k });
  texFill(ctx, noiseTex(12, { cx: 12, octaves: 4 }), r, { w: W, h: H, op: 'overlay', alpha: 0.22, scale: 1.4 * k });
  texFill(ctx, noiseTex(13, { cx: 48, octaves: 3 }), r, { w: W, h: H, op: 'overlay', alpha: 0.35, scale: Math.max(0.6, k) });
  texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.65, scale: Math.max(0.6, k) });
  // pits
  ctx.save();
  for (let i = 0; i < 260; i++) {
    const x = r() * W, y = r() * H, rad = between(r, 0.6, 2.6) * k;
    ctx.fillStyle = `rgba(0,0,0,${between(r, 0.12, 0.35)})`;
    ctx.beginPath();
    ctx.arc(x, y, rad, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    ctx.beginPath();
    ctx.arc(x + rad * 0.4, y + rad * 0.5, rad * 0.7, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
  // water streaks running down
  ctx.save();
  ctx.globalCompositeOperation = 'multiply';
  for (let i = 0, n = Math.floor(between(r, 2, 7)); i < n; i++) {
    const x = r() * W, w = between(r, 20, 120) * k, y0 = r() * H * 0.4;
    const g = ctx.createLinearGradient(0, y0, 0, y0 + between(r, 0.3, 0.9) * H);
    g.addColorStop(0, 'rgba(60,50,40,0)');
    g.addColorStop(0.2, `rgba(60,50,40,${between(r, 0.08, 0.2)})`);
    g.addColorStop(1, 'rgba(60,50,40,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x, y0, w, H);
  }
  ctx.restore();
  stains(ctx, W, H, r, 3);
  return base;
}

/** Thin cracks: a dark wandering line with a light lip below it. */
export function cracks(ctx, env, n) {
  const { W, H, k, r } = env;
  for (let i = 0; i < n; i++) {
    let x = r() * W, y = r() * H, a = r() * Math.PI * 2;
    const pts = [[x, y]];
    const steps = Math.floor(between(r, 12, 40));
    for (let j = 0; j < steps; j++) {
      a += (r() - 0.5) * 0.9;
      const len = between(r, 8, 30) * k;
      x += Math.cos(a) * len;
      y += Math.sin(a) * len;
      pts.push([x, y]);
    }
    const width = between(r, 1, 2.6) * k;
    for (const [dy, color, lw] of [[width * 0.8, 'rgba(255,255,255,0.18)', width], [0, 'rgba(20,18,16,0.75)', width]]) {
      ctx.beginPath();
      pts.forEach(([px, py], j) => (j ? ctx.lineTo(px, py + dy) : ctx.moveTo(px, py + dy)));
      ctx.strokeStyle = color;
      ctx.lineWidth = lw;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  }
}

export default {
  id: 'concrete',
  name: 'Concrete wall',
  render(ctx, env) {
    const { W, H, k, r, u } = env;
    const base = concreteWall(ctx, env);
    const ink = env.ink(['#f3f0e8', '#121212', '#d93a2b', '#f2c12e', '#26b3a3', '#2f6fd6', '#e8519b']);
    const stencil = r() < 0.45;
    const L = logoLayer(env, ink);
    const sprayColor = ink || env.logoColor;
    if (stencil) {
      // crisp-ish edges, a soft halo where the paint got under the stencil, slightly patchy fill
      roughen(L, r, { blur: Math.max(1, u * 0.004), amount: 0.25, scale: k });
      const halo = copyOf(L, 'halo');
      put(ctx, halo, { alpha: 0.28, blur: u * 0.012 });
      overspray(ctx, L, r, sprayColor, { count: 500, size: 1.4 * k, reach: u * 0.02, alpha: 0.6 });
    } else {
      // freehand spray: soft edge, overspray mist and specks
      put(ctx, L, { alpha: 0.35, blur: u * 0.03 });
      roughen(L, r, { blur: Math.max(2, u * 0.012), amount: 0.8, scale: k });
      overspray(ctx, L, r, sprayColor, { count: 1400, size: 1.8 * k, reach: u * 0.05, alpha: 0.85 });
    }
    eat(L, noiseTex(12, { cx: 12, octaves: 4 }), r, { amount: 0.55, lo: 0.6, hi: 0.95, scale: 1.4 * k });
    eat(L, grainTexture(), r, { amount: 0.5, lo: 0.6, hi: 0.9, scale: Math.max(0.6, k) });
    put(ctx, L, { alpha: between(r, 0.86, 0.97) });
    // the wall's texture over the paint, then cracks through everything
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.35, scale: Math.max(0.6, k) });
    cracks(ctx, env, Math.floor(between(r, 1, 4)));
    lighting(ctx, W, H, r, 0.3);
    return { bg: base, surface: 'aged' };
  },
};
