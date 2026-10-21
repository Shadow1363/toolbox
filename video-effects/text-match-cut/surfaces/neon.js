/** Neon sign: the logo's outline bent into glowing tubes on a dark wall. */
import { pick, between, hexToRgb, luma, lighting, logoLayer, copyOf, put, fillColor, outline, erode, dropShadow } from './_common.js';
import { concreteWall } from './concrete.js';
import { brickLayout, drawBricks } from './brick.js';

const TUBES = ['#ff3ea5', '#2ee6ff', '#ff4a3d', '#ffd23f', '#5dff7a', '#b06bff', '#ff8a2b'];
const DARK_BRICK = { brick: ['#2a2422', '#322a27', '#241f1d'], mortar: '#151312' };

export default {
  id: 'neon',
  name: 'Neon sign',
  render(ctx, env) {
    const { W, H, k, r, u, box } = env;
    if (r() < 0.5) drawBricks(ctx, env, brickLayout(env, DARK_BRICK));
    else concreteWall(ctx, env, { dark: true });
    // darken the room
    ctx.fillStyle = 'rgba(5,5,10,0.45)';
    ctx.fillRect(0, 0, W, H);

    // a near-black logo can't glow in its own colours, so it gets a tube colour anyway
    const own = env.ink(TUBES);
    const ink = own || (luma(env.logoColor) < 0.3 ? pick(r, TUBES) : null);
    const glowHex = ink || env.logoColor;
    const [R, G, B] = hexToRgb(glowHex);
    const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    // light spilling onto the wall
    const spill = ctx.createRadialGradient(cx, cy, 0, cx, cy, u * 1.4);
    spill.addColorStop(0, `rgba(${R},${G},${B},0.32)`);
    spill.addColorStop(0.5, `rgba(${R},${G},${B},0.12)`);
    spill.addColorStop(1, `rgba(${R},${G},${B},0)`);
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.fillStyle = spill;
    ctx.fillRect(0, 0, W, H);
    ctx.restore();

    // tubes: a band along the logo's edges (in its own colours with "Original colours")
    const art = logoLayer(env, ink, { pad: 0.35 });
    const tw = Math.max(3 * k, u * between(r, 0.016, 0.026));
    const tube = outline(art, tw, 'tube');
    // unlit tubes cast a faint shadow on the wall
    dropShadow(ctx, tube, { dx: 0, dy: tw * 1.6, blur: tw * 1.5, alpha: 0.55 });
    // a clear acrylic backing plate, sometimes
    if (r() < 0.4) {
      ctx.save();
      ctx.strokeStyle = 'rgba(255,255,255,0.12)';
      ctx.fillStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 2 * k;
      const p = u * 0.14;
      ctx.beginPath();
      ctx.roundRect(box.x - p, box.y - p, box.w + p * 2, box.h + p * 2, p * 0.5);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    // glow: wide, then tight, added light
    const level = between(r, 0.85, 1);
    put(ctx, tube, { op: 'lighter', alpha: 0.55 * level, blur: u * 0.07 });
    put(ctx, tube, { op: 'lighter', alpha: 0.8 * level, blur: u * 0.022 });
    put(ctx, tube, { op: 'lighter', alpha: 0.9 * level, blur: tw * 0.6 });
    put(ctx, tube, { alpha: 0.95 });
    // hot white core
    const core = erode(tube, tw * 0.28, 'tube-core');
    const white = copyOf(core, 'tube-white');
    fillColor(white, '#ffffff');
    put(ctx, white, { op: 'lighter', alpha: 0.75 * level, blur: tw * 0.25 });
    lighting(ctx, W, H, r, 0.2);
    return { bg: '#0d0c10', surface: 'screen' };
  },
};
