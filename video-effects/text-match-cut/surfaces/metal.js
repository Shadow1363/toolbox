/** Brushed metal plate with the logo engraved, embossed or enamel-filled. */
import {
  pick, between, vary, noiseTex, grainTexture, texFill, pattern, lighting,
  logoLayer, copyOf, put, fillColor, paintInside, bevel, dropShadow,
} from './_common.js';

const METALS = [
  { c: '#b9bcc0', engrave: '#4a4d52' }, // steel
  { c: '#d0d2d4', engrave: '#5a5d61' }, // aluminium
  { c: '#b8964f', engrave: '#4d3a17' }, // brass
  { c: '#b46f4a', engrave: '#4a2414' }, // copper
  { c: '#55595f', engrave: '#1d1f22' }, // gunmetal
];

export default {
  id: 'metal',
  name: 'Metal',
  render(ctx, env) {
    const { W, H, k, r, u } = env;
    const m = pick(r, METALS);
    const base = vary(r, m.c, 6);
    const angle = r() < 0.7 ? 0 : between(r, -25, 25);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    // brushed streaks
    const streaks = noiseTex(61, { cx: 1, cy: 96, octaves: 3 });
    texFill(ctx, streaks, r, { w: W, h: H, op: 'overlay', alpha: 0.6, sx: 8 * k, sy: 1.2 * k, rot: angle });
    texFill(ctx, noiseTex(62, { cx: 2, cy: 32, octaves: 4 }), r, { w: W, h: H, op: 'overlay', alpha: 0.35, sx: 6 * k, sy: 3 * k, rot: angle });
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.25, scale: Math.max(0.6, k) });
    // sheen bands
    const a = between(r, -0.4, 0.4) + Math.PI / 4;
    const g = ctx.createLinearGradient(W / 2 - Math.cos(a) * W, H / 2 - Math.sin(a) * H, W / 2 + Math.cos(a) * W, H / 2 + Math.sin(a) * H);
    for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, i % 2 ? `rgba(255,255,255,${between(r, 0.15, 0.35)})` : `rgba(0,0,0,${between(r, 0.05, 0.2)})`);
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();
    // screws when it's a plate
    if (r() < 0.5) {
      const off = between(r, 0.12, 0.2) * Math.min(W, H);
      for (const [x, y] of [[off, off], [W - off, off], [off, H - off], [W - off, H - off]]) {
        const rad = 16 * k;
        const sg = ctx.createRadialGradient(x - rad * 0.3, y - rad * 0.3, 0, x, y, rad);
        sg.addColorStop(0, 'rgba(255,255,255,0.7)');
        sg.addColorStop(1, 'rgba(0,0,0,0.45)');
        ctx.fillStyle = sg;
        ctx.beginPath();
        ctx.arc(x, y, rad, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(r() * Math.PI);
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        ctx.fillRect(-rad * 0.75, -rad * 0.12, rad * 1.5, rad * 0.24);
        ctx.restore();
      }
    }

    const style = pick(r, ['engrave', 'engrave', 'emboss']);
    const ink = env.ink([m.engrave]);
    const enamel = !ink; // "Original colours": enamel fill in the logo's colours
    const L = logoLayer(env, enamel ? null : '#000');
    const depth = Math.max(1.5, u * 0.008);
    if (style === 'engrave') {
      const cut = copyOf(L, 'cut');
      if (enamel) {
        paintInside(cut, pattern(ctx, grainTexture(), { x: r() * 512, scale: Math.max(0.6, k) }), { op: 'overlay', alpha: 0.4, name: 'en-gr' });
        put(ctx, cut);
      } else {
        // the cut floor: darker, brushed the other way
        fillColor(cut, ink);
        put(ctx, cut, { op: 'multiply', alpha: 0.55 });
        const floor = copyOf(L, 'floor');
        fillColor(floor, base);
        paintInside(floor, pattern(ctx, streaks, { sx: 1.2 * k, sy: 8 * k, x: r() * 999 }), { op: 'overlay', alpha: 0.7, name: 'fl-st' });
        put(ctx, floor, { op: 'soft-light', alpha: 0.8 });
      }
      bevel(ctx, L, { depth, raised: false, hi: 0.7, lo: 0.75, blur: depth * 0.4 });
    } else {
      dropShadow(ctx, L, { dx: depth * 0.6, dy: depth * 1.2, blur: depth * 2, alpha: 0.35 });
      if (enamel) put(ctx, L);
      else {
        const top = copyOf(L, 'top');
        fillColor(top, base);
        paintInside(top, pattern(ctx, streaks, { sx: 8 * k, sy: 1.2 * k, rot: angle, x: r() * 999 }), { op: 'overlay', alpha: 0.6, name: 'tp-st' });
        put(ctx, top);
      }
      bevel(ctx, L, { depth: depth * 1.4, raised: true, hi: 0.75, lo: 0.7, blur: depth * 0.5 });
    }
    lighting(ctx, W, H, r, 0.3);
    return { bg: base, surface: 'screen' };
  },
};
