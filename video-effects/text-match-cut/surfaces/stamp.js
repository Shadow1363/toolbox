/** Paper or cardboard with the logo rubber-stamped in ink: patchy coverage, bleed, sometimes a stamp frame. */
import {
  pick, between, vary, noiseTex, grainTexture, fiberTexture, texFill, lighting, stains,
  logoLayer, copyOf, put, roughen, eat,
} from './_common.js';

const PAPERS = [
  { c: '#b88a57', kind: 'kraft' },
  { c: '#a77a4a', kind: 'kraft' },
  { c: '#f1ead9', kind: 'paper' },
  { c: '#e8dfc7', kind: 'paper' },
  { c: '#f7f5ef', kind: 'paper' },
];
const INKS = ['#c0272d', '#1f3f9a', '#1a1a1a', '#5b2c83', '#1f6b3a'];

export default {
  id: 'stamp',
  name: 'Paper / cardboard',
  render(ctx, env) {
    const { W, H, k, r, u, box } = env;
    const paper = pick(r, PAPERS);
    const base = vary(r, paper.c, 6);
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, W, H);
    texFill(ctx, fiberTexture(), r, { w: W, h: H, op: 'overlay', alpha: paper.kind === 'kraft' ? 0.7 : 0.5, scale: Math.max(0.6, k) });
    texFill(ctx, grainTexture(), r, { w: W, h: H, op: 'overlay', alpha: 0.35, scale: Math.max(0.6, k) });
    texFill(ctx, noiseTex(81, { cx: 4, octaves: 5 }), r, { w: W, h: H, op: 'soft-light', alpha: 0.4, scale: 3 * k });
    if (paper.kind === 'kraft') {
      // corrugation showing through the liner
      const step = between(r, 22, 30) * k;
      const g = ctx.createLinearGradient(0, 0, step, 0);
      g.addColorStop(0, 'rgba(0,0,0,0.06)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.05)');
      g.addColorStop(1, 'rgba(0,0,0,0.06)');
      ctx.save();
      const vertical = r() < 0.5;
      if (vertical) { ctx.translate(W / 2, H / 2); ctx.rotate(Math.PI / 2); ctx.translate(-H / 2, -W / 2); }
      const [w, h] = vertical ? [H, W] : [W, H];
      ctx.fillStyle = g;
      for (let x = 0; x < w; x += step) { ctx.save(); ctx.translate(x, 0); ctx.fillRect(0, 0, step, h); ctx.restore(); }
      ctx.restore();
      // packing tape strip away from the logo
      if (r() < 0.5) {
        const y = r() < 0.5 ? box.y - u * between(r, 0.5, 0.9) : box.y + box.h + u * between(r, 0.3, 0.6);
        ctx.fillStyle = 'rgba(214,190,140,0.55)';
        ctx.fillRect(0, y, W, u * 0.28);
        ctx.fillStyle = 'rgba(255,255,255,0.18)';
        ctx.fillRect(0, y + u * 0.03, W, u * 0.04);
      }
    } else {
      // a faint fold line
      if (r() < 0.5) {
        const y = r() * H;
        ctx.fillStyle = 'rgba(0,0,0,0.06)';
        ctx.fillRect(0, y, W, 2 * k);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillRect(0, y + 2 * k, W, 1.5 * k);
      }
    }
    stains(ctx, W, H, r, 2, '90,60,30', 0.12);

    const ink = env.ink(INKS);
    const L = logoLayer(env, ink, { pad: 0.35 });
    // optional stamp frame around the logo (part of the stamp, so it gets the same ink treatment)
    const frame = pick(r, [null, null, 'rect', 'circle']);
    if (frame) {
      const x = L.c.ctx;
      const cx = box.x + box.w / 2 - L.x, cy = box.y + box.h / 2 - L.y;
      x.strokeStyle = ink || env.logoColor;
      x.lineWidth = Math.max(2, u * 0.022);
      const p = u * 0.12;
      for (const [grow, lw] of [[0, 1], [u * 0.045, 0.45]]) {
        x.lineWidth = Math.max(1.5, u * 0.022 * lw);
        x.beginPath();
        if (frame === 'rect') x.roundRect(cx - box.w / 2 - p - grow, cy - box.h / 2 - p - grow, box.w + (p + grow) * 2, box.h + (p + grow) * 2, u * 0.03);
        else x.arc(cx, cy, Math.hypot(box.w, box.h) / 2 + p * 0.6 + grow, 0, Math.PI * 2);
        x.stroke();
      }
    }
    roughen(L, r, { blur: Math.max(1, u * 0.005), amount: 0.45, scale: k });
    // ink bleeding into the fibres
    put(ctx, copyOf(L, 'bleed'), { op: 'multiply', alpha: 0.25, blur: Math.max(1, u * 0.006) });
    // uneven pressure: big patchy gaps plus fine speckle
    eat(L, noiseTex(82, { cx: 3, octaves: 5 }), r, { amount: between(r, 0.5, 0.9), lo: 0.55, hi: 0.9, scale: (u / 200) });
    eat(L, grainTexture(), r, { amount: 0.6, lo: 0.6, hi: 0.85, scale: Math.max(0.6, k) });
    put(ctx, L, { op: 'multiply', alpha: between(r, 0.82, 0.95) });
    lighting(ctx, W, H, r, 0.25);
    return { bg: base, surface: 'aged' };
  },
};
