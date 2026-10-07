/**
 * Procedural paper textures (grain, fibre, crumpled), shared by paper-style tools.
 * They are grayscale around mid-gray, meant for 'overlay' / 'soft-light' blending.
 * Generated once and cached.
 */
import { rng } from './random.js';

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

/** Fine random grain. */
export function grainTexture(size = 512, seed = 1) {
  return cached(`grain-${size}-${seed}`, () => {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const r = rng(seed);
    for (let i = 0; i < img.data.length; i += 4) {
      const v = 128 + (r() + r() + r() - 1.5) * 70;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
      img.data[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    return c;
  });
}

/** Grain plus short paper fibres. */
export function fiberTexture(size = 1024, seed = 2) {
  return cached(`fiber-${size}-${seed}`, () => {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    ctx.globalAlpha = 0.5;
    ctx.drawImage(grainTexture(512, seed + 10), 0, 0, size, size);
    const r = rng(seed);
    ctx.lineCap = 'round';
    for (let i = 0; i < size * 3; i++) {
      const x = r() * size, y = r() * size, len = 6 + r() * 34, a = r() * Math.PI * 2, bend = (r() - 0.5) * 0.8;
      const light = r() > 0.5;
      ctx.strokeStyle = light ? '#ffffff' : '#000000';
      ctx.globalAlpha = 0.05 + r() * 0.12;
      ctx.lineWidth = 0.5 + r() * 1.2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + Math.cos(a + bend) * len * 0.5, y + Math.sin(a + bend) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
      ctx.stroke();
    }
    return c;
  });
}

/** Faceted, crumpled paper: shaded triangles from a jittered grid, softened, with crease lines. */
export function crumpledTexture(size = 1024, seed = 3) {
  return cached(`crumpled-${size}-${seed}`, () => {
    const c = canvas(size, size);
    const ctx = c.getContext('2d');
    const r = rng(seed);
    const n = 13;
    const pts = [];
    for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) {
      const edge = i === 0 || j === 0 || i === n || j === n;
      pts.push([(i + (edge ? 0 : (r() - 0.5) * 0.8)) * (size / n), (j + (edge ? 0 : (r() - 0.5) * 0.8)) * (size / n)]);
    }
    const P = (i, j) => pts[j * (n + 1) + i];
    const light = [-0.5, -0.7, 0.5];
    const tri = (a, b, d) => {
      // random surface normal → lambert shade
      const nx = (r() - 0.5) * 1.6, ny = (r() - 0.5) * 1.6, nz = 1;
      const len = Math.hypot(nx, ny, nz);
      const dot = (nx * light[0] + ny * light[1] + nz * light[2]) / len;
      const v = Math.round(128 + (dot - 0.55) * 85);
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.beginPath(); ctx.moveTo(...a); ctx.lineTo(...b); ctx.lineTo(...d); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = ctx.fillStyle; ctx.lineWidth = 1; ctx.stroke();
    };
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      if (r() > 0.5) { tri(P(i, j), P(i + 1, j), P(i + 1, j + 1)); tri(P(i, j), P(i + 1, j + 1), P(i, j + 1)); }
      else { tri(P(i, j), P(i + 1, j), P(i, j + 1)); tri(P(i + 1, j), P(i + 1, j + 1), P(i, j + 1)); }
    }
    // soften facets
    const soft = canvas(size, size);
    const sctx = soft.getContext('2d');
    sctx.filter = 'blur(4px)';
    sctx.drawImage(c, 0, 0);
    if (sctx.filter !== 'blur(4px)') { // Safari: cheap blur
      const s = canvas(size / 8, size / 8);
      s.getContext('2d').drawImage(c, 0, 0, s.width, s.height);
      sctx.drawImage(s, 0, 0, size, size);
    }
    // crease lines
    sctx.filter = 'none';
    sctx.lineCap = 'round';
    for (let k = 0; k < 34; k++) {
      const [x1, y1] = pts[Math.floor(r() * pts.length)];
      const a = r() * Math.PI * 2, len = size * (0.1 + r() * 0.35);
      sctx.globalAlpha = 0.16 + r() * 0.16;
      sctx.strokeStyle = r() > 0.4 ? '#000' : '#fff';
      sctx.lineWidth = 0.6 + r();
      sctx.beginPath(); sctx.moveTo(x1, y1);
      sctx.lineTo(x1 + Math.cos(a) * len, y1 + Math.sin(a) * len);
      sctx.stroke();
    }
    sctx.globalAlpha = 0.4;
    sctx.globalCompositeOperation = 'overlay';
    sctx.drawImage(grainTexture(512, seed + 5), 0, 0, size, size);
    return soft;
  });
}

export function overlayTexture(kind) {
  if (kind === 'grain') return grainTexture();
  if (kind === 'fiber') return fiberTexture();
  if (kind === 'crumpled') return crumpledTexture();
  return null;
}
