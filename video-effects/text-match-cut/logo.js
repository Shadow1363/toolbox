/**
 * Logo prep for Text Match Cut's Logo mode.
 *
 * prepareLogo(img, { removeBg, threshold, isSvg }) → { canvas, removed, color }
 *   Draws the upload at up to 1024 px (SVGs are rasterised at 1024), removes a solid
 *   background when the image is opaque and its border is one colour (JPGs on white),
 *   trims to the visible pixels and measures the average colour.
 * demoLogo() → the same shape for the built-in demo mark.
 */
const MAX = 1024;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** Median colour of the image border and how much it varies (0 = perfectly uniform). */
function borderColor(d, w, h) {
  const rs = [], gs = [], bs = [];
  const add = (x, y) => {
    const i = (y * w + x) * 4;
    rs.push(d[i]); gs.push(d[i + 1]); bs.push(d[i + 2]);
  };
  const step = Math.max(1, Math.floor(Math.max(w, h) / 200));
  for (let x = 0; x < w; x += step) { add(x, 0); add(x, h - 1); }
  for (let y = 0; y < h; y += step) { add(0, y); add(w - 1, y); }
  const med = (a) => a.sort((p, q) => p - q)[a.length >> 1];
  const bg = [med([...rs]), med([...gs]), med([...bs])];
  let off = 0;
  for (let i = 0; i < rs.length; i++) {
    if (Math.abs(rs[i] - bg[0]) + Math.abs(gs[i] - bg[1]) + Math.abs(bs[i] - bg[2]) > 60) off++;
  }
  return { bg, spread: off / rs.length };
}

export function prepareLogo(img, { removeBg = true, threshold = 24, isSvg = false } = {}) {
  const w0 = img.naturalWidth || img.width || 512, h0 = img.naturalHeight || img.height || 512;
  const sc = isSvg ? MAX / Math.max(w0, h0) : Math.min(1, MAX / Math.max(w0, h0));
  const src = canvas(w0 * sc, h0 * sc);
  const W = src.width, H = src.height;
  const x = src.getContext('2d', { willReadFrequently: true });
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, W, H);
  const data = x.getImageData(0, 0, W, H);
  const d = data.data;

  let opaque = true;
  for (let i = 3; i < d.length; i += 4 * 7) if (d[i] < 250) { opaque = false; break; }

  let removed = false;
  if (removeBg && opaque) {
    const { bg, spread } = borderColor(d, W, H);
    // only when most of the border is one colour, otherwise it's a photo or full-bleed artwork
    if (spread < 0.2) {
      const t = threshold * 4.4; // slider 0–100 → colour distance (max ≈ 441)
      const soft = Math.max(8, t * 0.6);
      for (let i = 0; i < d.length; i += 4) {
        const dist = Math.hypot(d[i] - bg[0], d[i + 1] - bg[1], d[i + 2] - bg[2]);
        const a = Math.min(1, Math.max(0, (dist - t) / soft));
        if (a < 1) {
          if (a > 0) {
            // un-mix the background from the edge pixels so no white fringe is left
            for (let c = 0; c < 3; c++) d[i + c] = Math.min(255, Math.max(0, (d[i + c] - bg[c] * (1 - a)) / a));
          }
          d[i + 3] = a * 255;
        }
      }
      removed = true;
    }
  }

  // trim to the visible pixels and measure the average colour
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  let sr = 0, sg = 0, sb = 0, sa = 0;
  for (let y = 0; y < H; y++) {
    for (let xx = 0; xx < W; xx++) {
      const i = (y * W + xx) * 4;
      const a = d[i + 3];
      if (a > 10) {
        if (xx < x0) x0 = xx;
        if (xx > x1) x1 = xx;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
        const wgt = a / 255;
        sr += d[i] * wgt; sg += d[i + 1] * wgt; sb += d[i + 2] * wgt; sa += wgt;
      }
    }
  }
  if (x1 < 0) return { canvas: src, removed, color: '#ffffff', empty: true };
  x.putImageData(data, 0, 0);
  const out = canvas(x1 - x0 + 1, y1 - y0 + 1);
  out.getContext('2d').drawImage(src, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
  const hex = (v) => Math.round(v / sa).toString(16).padStart(2, '0');
  return { canvas: out, removed, color: `#${hex(sr)}${hex(sg)}${hex(sb)}` };
}

/** Built-in demo: a one-colour mark (a hexagon with a lightning bolt cut out of it). */
export function demoLogo() {
  const S = 640;
  const c = canvas(S, S);
  const x = c.getContext('2d');
  x.fillStyle = '#ff5a36';
  x.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    const px = S / 2 + Math.cos(a) * S * 0.47, py = S / 2 + Math.sin(a) * S * 0.47;
    i ? x.lineTo(px, py) : x.moveTo(px, py);
  }
  x.closePath();
  x.lineJoin = 'round';
  x.lineWidth = S * 0.06;
  x.strokeStyle = '#ff5a36';
  x.stroke();
  x.fill();
  x.globalCompositeOperation = 'destination-out';
  x.beginPath();
  const bolt = [[0.56, 0.16], [0.3, 0.55], [0.48, 0.55], [0.42, 0.84], [0.7, 0.43], [0.52, 0.43], [0.6, 0.16]];
  bolt.forEach(([px, py], i) => (i ? x.lineTo(px * S, py * S) : x.moveTo(px * S, py * S)));
  x.closePath();
  x.fill();
  return { canvas: c, removed: false, color: '#ff5a36' };
}
