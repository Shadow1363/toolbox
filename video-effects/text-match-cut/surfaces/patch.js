/** Embroidered patch sewn on a jacket: satin-stitched logo, merrowed border, raised edges. */
import {
  pick, between, vary, luma, tile, pattern, noiseTex, grainTexture, texFill, lighting,
  logoLayer, blankLike, copyOf, put, fillColor, paintInside, dilate, outline, bevel, dropShadow,
} from './_common.js';

const FABRICS = [
  { c: '#2f4a6d', kind: 'denim' },
  { c: '#4b5233', kind: 'canvas' },
  { c: '#1e1f22', kind: 'nylon' },
  { c: '#7d7f82', kind: 'knit' },
  { c: '#6b3d2a', kind: 'canvas' },
];
const PATCH = ['#1d1d1f', '#f1ece0', '#0b3d91', '#b3202b', '#24543a', '#e0b13b'];
const THREAD = ['#f6f3ea', '#f2c12e', '#d9302c', '#1d1d1f', '#2f7fd1', '#3aa35b'];

/** Stitch texture: fine parallel threads at an angle, with a little shine on each. */
function threads(ctx, k, angle) {
  const s = Math.max(3, Math.round(4 * k));
  const t = tile('threads', s, (c, n) => {
    c.fillStyle = '#7a7a7a';
    c.fillRect(0, 0, n, n);
    c.fillStyle = '#b8b8b8';
    c.fillRect(0, 0, n, n * 0.55);
    c.fillStyle = '#ffffff';
    c.globalAlpha = 0.35;
    c.fillRect(0, n * 0.1, n, n * 0.15);
  });
  return pattern(ctx, t, { rot: angle, sx: 1, sy: 1 });
}

export default {
  id: 'patch',
  name: 'Embroidered patch',
  render(ctx, env) {
    const { W, H, k, r, u, box } = env;
    const fab = pick(r, FABRICS);
    const base = vary(r, fab.c, 8);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    const weave = tile(`fab-${fab.kind}`, Math.max(3, Math.round(5 * k)), (c, n) => {
      c.fillStyle = '#808080';
      c.fillRect(0, 0, n, n);
      c.strokeStyle = fab.kind === 'nylon' ? '#8a8a8a' : '#a0a0a0';
      c.lineWidth = n * 0.3;
      c.beginPath();
      c.moveTo(0, n);
      c.lineTo(n, 0);
      c.stroke();
    });
    texFill(ctx, weave, r, { w: W, h: H, op: 'overlay', alpha: fab.kind === 'nylon' ? 0.25 : 0.6 });
    texFill(ctx, noiseTex(51, { cx: 5, octaves: 5 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.45, scale: 3 * k });
    if (fab.kind === 'denim') texFill(ctx, noiseTex(52, { cx: 2, cy: 64, octaves: 3 }), r, { w: W, h: H, op: 'overlay', alpha: 0.35, scale: 2 * k, rot: 90 });

    // patch shape: a border following the logo, or a round / rounded badge
    const shape = pick(r, ['contour', 'contour', 'circle', 'badge']);
    const patchHex = pick(r, PATCH);
    const patchColor = vary(r, patchHex, 6);
    const L = logoLayer(env, '#000', { pad: 0.42 });
    let P;
    if (shape === 'contour') {
      P = dilate(L, u * between(r, 0.06, 0.09), 'patch');
      // round off the inner corners a little
      P = dilate(P, u * 0.015, 'patch2');
    } else {
      P = blankLike(L, 'patch');
      const x = P.c.ctx;
      const cx = box.x + box.w / 2 - P.x, cy = box.y + box.h / 2 - P.y;
      x.fillStyle = '#000';
      x.beginPath();
      if (shape === 'circle') x.arc(cx, cy, Math.hypot(box.w, box.h) / 2 + u * 0.08, 0, Math.PI * 2);
      else x.roundRect(cx - box.w / 2 - u * 0.12, cy - box.h / 2 - u * 0.12, box.w + u * 0.24, box.h + u * 0.24, u * 0.12);
      x.fill();
    }
    dropShadow(ctx, P, { dx: 2 * k, dy: 5 * k, blur: 10 * k, alpha: 0.5 });
    const body = copyOf(P, 'patch-body');
    fillColor(body, patchColor);
    paintInside(body, pattern(ctx, weave, { x: r() * 99, y: r() * 99 }), { op: 'overlay', alpha: 0.7, name: 'pb-weave' });
    put(ctx, body);
    // merrowed border: a thick stitched rim
    const rim = outline(P, Math.max(5 * k, u * 0.035), 'rim');
    const rimColor = luma(patchHex) > 0.5 ? '#1d1d1f' : '#efe9dc';
    fillColor(rim, pick(r, [rimColor, rimColor, vary(r, pick(r, THREAD), 4)]));
    paintInside(rim, threads(ctx, k, between(r, 30, 60)), { op: 'overlay', alpha: 0.9, name: 'rim-thr' });
    put(ctx, rim);
    bevel(ctx, rim, { depth: 2 * k, raised: true, hi: 0.35, lo: 0.5, blur: k });
    bevel(ctx, P, { depth: 3 * k, raised: true, hi: 0.3, lo: 0.45, blur: 2 * k });

    // satin-stitched logo
    const ink = env.ink(THREAD);
    const art = logoLayer(env, ink, { pad: 0.42, name: 'stitch' });
    paintInside(art, threads(ctx, k, between(r, -70, 70)), { op: 'overlay', alpha: 0.85, name: 'art-thr' });
    paintInside(art, pattern(ctx, grainTexture(), { x: r() * 512, y: r() * 512, scale: Math.max(0.6, k) }), { op: 'soft-light', alpha: 0.6, name: 'art-grain' });
    dropShadow(ctx, art, { dx: k, dy: 2 * k, blur: 3 * k, alpha: 0.45 });
    put(ctx, art);
    bevel(ctx, art, { depth: 2.2 * k, raised: true, hi: 0.45, lo: 0.55, blur: k });
    // a thin running stitch around the logo
    const run = outline(art, Math.max(1.5, 1.6 * k), 'run');
    fillColor(run, 'rgba(0,0,0,0.35)');
    put(ctx, run);

    lighting(ctx, W, H, r, 0.3);
    return { bg: base, surface: 'paper' };
  },
};
