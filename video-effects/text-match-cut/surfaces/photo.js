/**
 * A surface from the user's own photo: the logo is blended into it (multiply on light
 * photos, screen on dark ones), bent along its brightness and given its texture back.
 * Not in SURFACES: the script calls renderPhoto(ctx, env, img) for 'photo:<id>' frames.
 */
import { fit } from '/assets/js/lib/canvas.js';
import { between, canvasNamed, logoLayer, put, displace, paintInside, pattern } from './_common.js';

/** Average brightness (0–1) of a region of a canvas. */
function brightness(src, x, y, w, h) {
  const c = canvasNamed('photo-probe', 16, 16, true);
  c.ctx.drawImage(src, x, y, w, h, 0, 0, 16, 16);
  const d = c.ctx.getImageData(0, 0, 16, 16).data;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
  return sum / (256 * 255);
}

export function renderPhoto(ctx, env, img) {
  const { W, H, r, u, box } = env;
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  // a slightly different crop each time
  const z = between(r, 1, 1.18);
  const cover = fit(iw, ih, W, H, 'cover');
  const w = cover.w * z, hh = cover.h * z;
  const x = cover.x - (w - cover.w) * r(), y = cover.y - (hh - cover.h) * r();
  ctx.drawImage(img, x, y, w, hh);

  const light = brightness(ctx.canvas, box.x, box.y, box.w, box.h) > 0.45;
  const ink = env.ink(light ? ['#141414', '#1d1d1f'] : ['#f5f5f2', '#ffffff']);
  const L = logoLayer(env, ink);
  // the photo's own brightness as a height map: the logo bends over its bumps
  displace(L, (h) => { h.filter = 'grayscale(1)'; h.drawImage(img, x, y, w, hh); h.filter = 'none'; }, { strength: 40 * (u / 400), shade: 0.6, blur: 3 });
  // texture back on top of the ink
  paintInside(L, pattern(ctx, ctx.canvas), { op: 'overlay', alpha: 0.5, name: 'photo-tex' });
  put(ctx, L, { op: light ? 'multiply' : 'screen', alpha: 0.92 });
  put(ctx, L, { op: 'soft-light', alpha: 0.4 });
  return { bg: '#222222', surface: 'paper' };
}
