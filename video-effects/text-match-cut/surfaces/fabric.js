/** Shirt or sports jersey: the logo is screen-printed, bent by the folds, with the weave showing through. */
import {
  pick, between, vary, luma, tile, pattern, noiseTex, grainTexture, texFill, lighting,
  logoLayer, put, roughen, eat, displace,
} from './_common.js';

const COLORS = ['#c8102e', '#0b3d91', '#1d1d1f', '#f4f4f2', '#1f7a3a', '#5b2a86', '#f2a900', '#7a8a99', '#0f6e8c', '#e86a1c'];

/** Soft folds across the cloth: ridges and valleys running at roughly one angle. */
function foldLayout(env) {
  const { W, H, k, r } = env;
  const base = between(r, -0.7, 0.7) + (r() < 0.3 ? Math.PI / 2 : 0);
  const folds = [];
  for (let i = 0, n = Math.floor(between(r, 3, 7)); i < n; i++) {
    folds.push({
      x: r() * W, y: r() * H,
      a: base + between(r, -0.3, 0.3),
      w: between(r, 70, 260) * k,
      d: between(r, 0.35, 1) * (r() < 0.6 ? 1 : -1),
    });
  }
  return folds;
}

/** Folds as heights (grey) or as light and shadow (lit from the top-left). */
function drawFolds(ctx, folds, mode, amount = 1) {
  for (const f of folds) {
    const nx = Math.cos(f.a + Math.PI / 2), ny = Math.sin(f.a + Math.PI / 2);
    const g = ctx.createLinearGradient(f.x - nx * f.w, f.y - ny * f.w, f.x + nx * f.w, f.y + ny * f.w);
    const a = Math.abs(f.d) * amount;
    if (mode === 'height') {
      const c = f.d > 0 ? '255,255,255' : '0,0,0';
      g.addColorStop(0, `rgba(${c},0)`);
      g.addColorStop(0.5, `rgba(${c},${a * 0.55})`);
      g.addColorStop(1, `rgba(${c},0)`);
    } else {
      // the side of a ridge that faces the light is bright, the far side dark (flipped for a valley)
      const facing = (nx * -0.7 + ny * -0.7 > 0) === f.d > 0;
      const [c1, c2] = facing ? ['255,255,255', '0,0,0'] : ['0,0,0', '255,255,255'];
      g.addColorStop(0, `rgba(${c1},0)`);
      g.addColorStop(0.3, `rgba(${c1},${a * 0.5})`);
      g.addColorStop(0.5, 'rgba(128,128,128,0)');
      g.addColorStop(0.72, `rgba(${c2},${a * 0.6})`);
      g.addColorStop(1, `rgba(${c2},0)`);
    }
    ctx.fillStyle = g;
    ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  }
}

function weaveTile(kind, k) {
  const size = Math.max(3, Math.round((kind === 'mesh' ? 9 : 6) * k));
  return tile(`weave-${kind}`, size, (c, s) => {
    c.fillStyle = '#808080';
    c.fillRect(0, 0, s, s);
    if (kind === 'mesh') {
      // jersey mesh: little holes on an offset grid
      c.fillStyle = '#202020';
      for (const [x, y] of [[0.25, 0.25], [0.75, 0.75]]) { c.beginPath(); c.arc(x * s, y * s, s * 0.14, 0, Math.PI * 2); c.fill(); }
      c.fillStyle = '#b0b0b0';
      for (const [x, y] of [[0.75, 0.25], [0.25, 0.75]]) { c.beginPath(); c.arc(x * s, y * s, s * 0.2, 0, Math.PI * 2); c.fill(); }
    } else {
      // cotton twill: diagonal ribs
      c.strokeStyle = '#a8a8a8';
      c.lineWidth = s * 0.35;
      for (let o = -s; o <= s; o += s) { c.beginPath(); c.moveTo(o, s); c.lineTo(o + s, 0); c.stroke(); }
      c.strokeStyle = '#5a5a5a';
      c.lineWidth = s * 0.12;
      for (let o = -s; o <= s; o += s) { c.beginPath(); c.moveTo(o + s * 0.5, s); c.lineTo(o + s * 1.5, 0); c.stroke(); }
    }
  });
}

export default {
  id: 'fabric',
  name: 'Shirt / jersey',
  render(ctx, env) {
    const { W, H, k, r, u, box } = env;
    const baseHex = pick(r, COLORS);
    const base = vary(r, baseHex, 8);
    const kind = r() < 0.5 ? 'mesh' : 'twill';
    const folds = foldLayout(env);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    const weave = weaveTile(kind, k);
    texFill(ctx, weave, r, { w: W, h: H, op: 'overlay', alpha: 0.55 });
    texFill(ctx, noiseTex(41, { cx: 6, octaves: 5 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.35, scale: 2.5 * k });
    // a stitched seam away from the logo
    if (r() < 0.6) {
      const side = r() < 0.5 ? -1 : 1;
      const x = box.x + box.w / 2 + side * (box.w / 2 + between(r, 0.35, 0.8) * u);
      ctx.save();
      ctx.strokeStyle = 'rgba(0,0,0,0.25)';
      ctx.lineWidth = 6 * k;
      ctx.beginPath();
      ctx.moveTo(x, -10);
      ctx.bezierCurveTo(x + side * 40 * k, H * 0.3, x - side * 30 * k, H * 0.7, x + side * 20 * k, H + 10);
      ctx.stroke();
      ctx.setLineDash([7 * k, 5 * k]);
      ctx.strokeStyle = luma(baseHex) > 0.5 ? 'rgba(0,0,0,0.35)' : 'rgba(255,255,255,0.35)';
      ctx.lineWidth = 1.6 * k;
      ctx.translate(side * 9 * k, 0);
      ctx.stroke();
      ctx.restore();
    }
    const dark = luma(baseHex) < 0.55;
    const ink = env.ink(dark ? ['#ffffff', '#f2c12e', '#efe6d2', '#e4e4e4'] : ['#111111', '#c8102e', '#0b3d91', '#1f7a3a']);
    const L = logoLayer(env, ink);
    roughen(L, r, { blur: Math.max(1, 1.2 * k), amount: 0.15, scale: k });
    displace(L, (h) => drawFolds(h, folds, 'height'), { strength: 2600 * k, shade: 0, blur: 3 * k });
    // the ink cracks a little along the weave, which then shows through
    eat(L, weave, r, { amount: 0.35, lo: 0.25, hi: 0.5 });
    eat(L, grainTexture(), r, { amount: 0.3, lo: 0.7, hi: 0.95, scale: Math.max(0.6, k) });
    put(ctx, L, { alpha: 0.95 });
    texFill(ctx, weave, r, { w: W, h: H, op: 'overlay', alpha: 0.35 });
    drawFoldsShade(ctx, folds, W, H);
    lighting(ctx, W, H, r, 0.3);
    return { bg: base, surface: 'paper' };
  },
};

function drawFoldsShade(ctx, folds, W, H) {
  ctx.save();
  ctx.globalCompositeOperation = 'soft-light';
  drawFolds(ctx, folds, 'shade', 1);
  ctx.globalCompositeOperation = 'multiply';
  ctx.globalAlpha = 0.25;
  drawFolds(ctx, folds.filter((f) => f.d < 0), 'height', 1);
  ctx.restore();
}
