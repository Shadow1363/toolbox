/** Brick wall with the logo painted on as a mural: the paint follows the bricks and sinks into the mortar. */
import {
  pick, between, vary, noiseTex, grainTexture, texFill, lighting, stains,
  logoLayer, put, roughen, eat, displace,
} from './_common.js';

const PALETTES = [
  { brick: ['#9c4a33', '#b05a3c', '#87402e', '#a8553a'], mortar: '#b9afa2' },
  { brick: ['#b9763f', '#c98a4f', '#a8683a'], mortar: '#cfc6b6' },
  { brick: ['#5d4a43', '#6d564c', '#4f3f39'], mortar: '#8c847b' },
  { brick: ['#e9e4dc', '#dcd6cc', '#f1ede6'], mortar: '#c9c2b6' }, // whitewashed
  { brick: ['#3a3d42', '#43474d', '#33363a'], mortar: '#25272a' }, // painted dark
];

/** Brick geometry for this frame, so the wall and its height map line up. */
export function brickLayout(env, palette = pick(env.r, PALETTES)) {
  const { W, H, k, r } = env;
  const bw = between(r, 150, 230) * k;
  const bh = bw * between(r, 0.3, 0.36);
  const m = between(r, 5, 11) * k;
  const rows = [];
  for (let y = -bh * (1 + r()); y < H + bh; y += bh + m) {
    const shift = (rows.length % 2 ? 0.5 : 0) * (bw + m) + between(r, -0.05, 0.05) * bw;
    const bricks = [];
    for (let x = -bw - shift; x < W + bw; x += bw + m) bricks.push({ x, w: bw, c: vary(r, pick(r, palette.brick), 12), n: r() });
    rows.push({ y, h: bh, bricks });
  }
  return { rows, m, palette };
}

export function drawBricks(ctx, env, lay) {
  const { W, H, k, r } = env;
  ctx.fillStyle = lay.palette.mortar;
  ctx.fillRect(0, 0, W, H);
  texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.6, scale: Math.max(0.6, k) });
  const rad = lay.m * 0.6;
  for (const row of lay.rows) {
    for (const b of row.bricks) {
      ctx.fillStyle = b.c;
      ctx.beginPath();
      ctx.roundRect(b.x, row.y, b.w, row.h, rad);
      ctx.fill();
    }
  }
  texFill(ctx, noiseTex(21, { cx: 24, octaves: 4 }), r, { w: W, h: H, op: 'overlay', alpha: 0.45, scale: 1.2 * k });
  texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.5, scale: Math.max(0.6, k) });
  texFill(ctx, noiseTex(22, { cx: 3, octaves: 6 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.5, scale: 4 * k });
  // a light top lip and dark bottom edge on every brick
  ctx.save();
  for (const row of lay.rows) {
    for (const b of row.bricks) {
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      ctx.fillRect(b.x + rad, row.y, b.w - rad * 2, lay.m * 0.35);
      ctx.fillStyle = 'rgba(0,0,0,0.22)';
      ctx.fillRect(b.x + rad, row.y + row.h - lay.m * 0.35, b.w - rad * 2, lay.m * 0.35);
    }
  }
  ctx.restore();
}

/** Heights: bricks high, mortar low (grey on a mid-grey base). */
export function brickHeight(ctx, lay) {
  ctx.fillStyle = '#383838';
  ctx.fillRect(-1e5, -1e5, 2e5, 2e5);
  ctx.fillStyle = '#c8c8c8';
  for (const row of lay.rows) for (const b of row.bricks) { ctx.beginPath(); ctx.roundRect(b.x, row.y, b.w, row.h, lay.m * 0.6); ctx.fill(); }
}

/** Thin the paint in the mortar joints (a brush skips over the recessed lines). */
function mortarGaps(L, lay) {
  const x = L.c.ctx;
  x.save();
  x.translate(-L.x, -L.y);
  x.globalCompositeOperation = 'destination-out';
  x.fillStyle = 'rgba(0,0,0,0.45)';
  x.beginPath();
  x.rect(L.x, L.y, L.w, L.h);
  for (const row of lay.rows) for (const b of row.bricks) x.roundRect(b.x, row.y, b.w, row.h, lay.m * 0.6);
  x.fill('evenodd');
  x.restore();
}

export default {
  id: 'brick',
  name: 'Brick wall',
  render(ctx, env) {
    const { W, H, k, r, u } = env;
    const lay = brickLayout(env);
    drawBricks(ctx, env, lay);
    const ink = env.ink(['#f6f1e7', '#f2c12e', '#e2462f', '#2aa6c9', '#1d1d1f', '#47b26b', '#f08a24']);
    // sometimes the mural has a painted panel behind the logo
    if (r() < 0.35) {
      const panel = logoLayer(env, null, { name: 'panel' });
      const x = panel.c.ctx;
      x.clearRect(0, 0, panel.w, panel.h);
      x.fillStyle = vary(r, pick(r, ['#1d1d1f', '#f6f1e7', '#2a5d8f', '#c23b2a']), 8);
      const p = u * 0.12;
      x.beginPath();
      if (r() < 0.5) x.ellipse(panel.w / 2, panel.h / 2, env.box.w / 2 + p, env.box.h / 2 + p, 0, 0, Math.PI * 2);
      else x.roundRect(env.box.x - panel.x - p, env.box.y - panel.y - p, env.box.w + p * 2, env.box.h + p * 2, p);
      x.fill();
      roughen(panel, r, { blur: 2 * k, amount: 0.3, scale: k });
      displace(panel, (h) => brickHeight(h, lay), { strength: 8 * k, shade: 0.5 });
      eat(panel, grainTexture(), r, { amount: 0.4, lo: 0.65, hi: 0.95, scale: Math.max(0.6, k) });
      put(ctx, panel, { alpha: 0.95 });
    }
    const L = logoLayer(env, ink);
    roughen(L, r, { blur: Math.max(1, 1.6 * k), amount: 0.25, scale: k });
    displace(L, (h) => brickHeight(h, lay), { strength: 10 * k, shade: 0.7 });
    // paint is thinner in the mortar and in the pits
    mortarGaps(L, lay);
    eat(L, noiseTex(21, { cx: 24, octaves: 4 }), r, { amount: 0.5, lo: 0.65, hi: 0.95, scale: 1.2 * k });
    eat(L, grainTexture(), r, { amount: 0.45, lo: 0.6, hi: 0.9, scale: Math.max(0.6, k) });
    put(ctx, L, { alpha: 0.94 });
    // the brick texture back over the paint so it reads as painted on
    texFill(ctx, noiseTex(21, { cx: 24, octaves: 4 }), r, { w: W, h: H, op: 'overlay', alpha: 0.25, scale: 1.2 * k });
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.25, scale: Math.max(0.6, k) });
    stains(ctx, W, H, r, 2);
    lighting(ctx, W, H, r, 0.35);
    return { bg: lay.palette.mortar, surface: 'aged' };
  },
};
