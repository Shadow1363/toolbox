/**
 * Backgrounds and torn-edge paths for the Paper Effect tool.
 * The overlay textures themselves live in /assets/js/lib/paper-textures.js.
 */
import { rng, fbm1 } from '/assets/js/lib/random.js';
import { grainTexture, fiberTexture } from '/assets/js/lib/paper-textures.js';

export { overlayTexture } from '/assets/js/lib/paper-textures.js';

const cache = new Map();
function cached(key, make) {
  if (!cache.has(key)) cache.set(key, make());
  return cache.get(key);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/* ---------- Backgrounds ---------- */

/** Background surface. Cached by kind/size/color. */
export function backgroundTexture(kind, w, h, color) {
  return cached(`bg-${kind}-${w}x${h}-${color}`, () => {
    const c = canvas(w, h);
    const ctx = c.getContext('2d');
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, w, h);
    const r = rng(42);
    if (kind === 'kraft') {
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.55;
      const fib = fiberTexture(1024, 9);
      for (let y = 0; y < h; y += 1024) for (let x = 0; x < w; x += 1024) ctx.drawImage(fib, x, y);
      ctx.globalAlpha = 0.25;
      ctx.drawImage(grainTexture(512, 4), 0, 0, w, h);
    } else if (kind === 'cardboard') {
      ctx.globalCompositeOperation = 'overlay';
      const step = Math.max(10, w / 120);
      for (let x = 0; x < w; x += step) {
        const g = ctx.createLinearGradient(x, 0, x + step, 0);
        g.addColorStop(0, 'rgba(0,0,0,.18)'); g.addColorStop(0.5, 'rgba(255,255,255,.18)'); g.addColorStop(1, 'rgba(0,0,0,.18)');
        ctx.fillStyle = g; ctx.fillRect(x, 0, step, h);
      }
      ctx.globalAlpha = 0.5;
      ctx.drawImage(fiberTexture(1024, 11), 0, 0, w, h);
    } else if (kind === 'grid') {
      ctx.globalAlpha = 0.3;
      ctx.globalCompositeOperation = 'overlay';
      ctx.drawImage(grainTexture(512, 6), 0, 0, w, h);
      ctx.globalCompositeOperation = 'source-over';
      const step = Math.round(Math.min(w, h) / 22);
      ctx.strokeStyle = '#6aa3d8';
      ctx.lineWidth = Math.max(1, step / 30);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      for (let x = (w % step) / 2; x < w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = (h % step) / 2; y < h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
    } else if (kind === 'wood') {
      // desk top: planks of long wavy grain lines
      const plank = Math.round(Math.min(w, h) / 4.5);
      for (let y0 = 0, i = 0; y0 < h; y0 += plank, i++) {
        ctx.fillStyle = `rgba(${i % 2 ? '0,0,0,.06' : '255,240,220,.05'})`;
        ctx.fillRect(0, y0, w, plank);
        for (let j = 0; j < plank / 5; j++) {
          const y = y0 + r() * plank, seed = i * 100 + j;
          ctx.beginPath();
          for (let x = 0; x <= w; x += 16) {
            const yy = y + fbm1(x / 380 + j, seed, 3) * plank * 0.18;
            x ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
          }
          ctx.strokeStyle = `rgba(60,30,10,${0.06 + r() * 0.2})`;
          ctx.lineWidth = 0.6 + r() * 2.4;
          ctx.stroke();
        }
        ctx.fillStyle = 'rgba(30,15,5,.45)';
        ctx.fillRect(0, y0, w, Math.max(1.5, plank / 120));
      }
      ctx.globalCompositeOperation = 'overlay';
      ctx.globalAlpha = 0.3;
      ctx.drawImage(grainTexture(512, 8), 0, 0, w, h);
    } else if (kind === 'cork') {
      for (let i = 0; i < (w * h) / 60; i++) {
        const v = r();
        ctx.fillStyle = v > 0.5 ? 'rgba(60,30,10,.35)' : 'rgba(255,230,190,.25)';
        const s = 1 + r() * 4;
        ctx.fillRect(r() * w, r() * h, s, s * (0.5 + r()));
      }
    }
    // gentle vignette sells the "surface"
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,.28)');
    ctx.fillStyle = vg; ctx.fillRect(0, 0, w, h);
    return c;
  });
}

/* ---------- Edges ---------- */

/**
 * Build the outline of a w×h rectangle (centred at 0,0) as a list of points.
 * style: 'straight' | 'torn' | 'cutout' | 'rounded'
 * rough: displacement in px. seed: changes the tear.
 */
export function edgePath(w, h, style, rough, seed) {
  const pts = [];
  if (style === 'rounded') return roundedPath(w, h, Math.min(w, h) * 0.06 + rough * 0.5);
  if (style === 'straight' || rough <= 0) {
    return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  }
  const corners = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const normals = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  const r = rng(seed * 7919 + 1);
  for (let side = 0; side < 4; side++) {
    const [ax, ay] = corners[side];
    const [bx, by] = corners[(side + 1) % 4];
    const [nx, ny] = normals[side];
    const len = Math.hypot(bx - ax, by - ay);
    if (style === 'cutout') {
      // Scissor cuts: a few long straight segments with slight angle changes.
      const segs = Math.max(2, Math.round(len / (rough * 18 + 60)));
      for (let i = 0; i < segs; i++) {
        const t = i / segs;
        const off = i === 0 ? 0 : (r() - 0.5) * rough;
        pts.push([ax + (bx - ax) * t + nx * off, ay + (by - ay) * t + ny * off]);
      }
    } else {
      // Torn: fractal noise for the large wobble + per-point jitter for fibres.
      const step = 3;
      const n = Math.max(4, Math.round(len / step));
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const d = fbm1(t * len * 0.012 + side * 50, seed, 4) * rough + (r() - 0.5) * rough * 0.35 - rough * 0.15;
        pts.push([ax + (bx - ax) * t + nx * d, ay + (by - ay) * t + ny * d]);
      }
    }
  }
  return pts;
}

/** A rounded rectangle (centred at 0,0) as points, so it goes through tracePath like the others. */
function roundedPath(w, h, rad) {
  const pts = [];
  rad = Math.min(rad, w / 2, h / 2);
  const corners = [[w / 2 - rad, -h / 2 + rad, -Math.PI / 2], [w / 2 - rad, h / 2 - rad, 0], [-w / 2 + rad, h / 2 - rad, Math.PI / 2], [-w / 2 + rad, -h / 2 + rad, Math.PI]];
  for (const [cx, cy, a0] of corners) {
    for (let i = 0; i <= 8; i++) {
      const a = a0 + (i / 8) * (Math.PI / 2);
      pts.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]);
    }
  }
  return pts;
}

export function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

