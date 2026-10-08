/**
 * Images: anything the browser can decode (PNG, JPG, WebP, BMP, GIF, ICO, AVIF, SVG) plus HEIC
 * (heic-to) → PNG, JPG, WebP, BMP or ICO, with resize, quality and background options.
 * One or many images → one PDF (jsPDF), a page per image.
 * BMP and ICO are written here (the canvas can't encode them).
 */
import { loadLib } from '/assets/js/lib/cdn.js';
import { ConvertError } from '../registry.js';
import { loadImage, canvasToBlob, blobToDataUrl, PAGE_SIZES } from './_util.js';

const INPUTS = ['png', 'jpg', 'webp', 'bmp', 'gif', 'ico', 'avif', 'svg', 'heic'];
const OUTPUTS = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon' };
const OPAQUE = new Set(['jpg', 'bmp']);
const MAX_SIDE = 16384;

/* ----- options ----- */
const size = [
  { id: 'imgWidth', type: 'number', label: 'Width (px)', value: 0, min: 0, max: MAX_SIDE, hint: '0 keeps the original size.' },
  { id: 'imgHeight', type: 'number', label: 'Height (px)', value: 0, min: 0, max: MAX_SIDE },
  { id: 'keepRatio', type: 'toggle', label: 'Keep aspect ratio', value: true, hint: 'With both sizes set, the image fits inside them.' },
];
const quality = { id: 'quality', type: 'range', label: 'Quality', min: 40, max: 100, value: 88, unit: '%' };
const background = { id: 'imgBg', type: 'color', label: 'Background (for transparency)', value: '#ffffff' };
const icoSizes = { id: 'icoSizes', type: 'segmented', label: 'Icon sizes', value: 'set', options: [['set', '16–256 px set'], ['one', 'Single size']] };
const optionsFor = (to) => [...size, ...(to === 'jpg' || to === 'webp' ? [quality] : []), ...(OPAQUE.has(to) ? [background] : []), ...(to === 'ico' ? [icoSizes] : [])];

/** Output size from the resize options. */
function fitSize(w, h, o) {
  const W = Math.max(0, Math.round(+o.imgWidth || 0)), H = Math.max(0, Math.round(+o.imgHeight || 0));
  let out = [w, h];
  if (W || H) {
    if (o.keepRatio !== false) {
      const s = W && H ? Math.min(W / w, H / h) : W ? W / w : H / h;
      out = [w * s, h * s];
    } else out = [W || w, H || h];
  }
  const cap = Math.min(1, MAX_SIDE / Math.max(...out));
  return out.map((v) => Math.max(1, Math.round(v * cap)));
}

/** Intrinsic size of an SVG from width/height (px) or its viewBox. */
function svgSize(text) {
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0] || '';
  const attr = (n) => new RegExp(`\\s${n}\\s*=\\s*["']([^"']+)["']`, 'i').exec(tag)?.[1];
  const px = (v) => (v && /^[\d.]+(px)?$/.test(v.trim()) ? parseFloat(v) : 0);
  const vb = attr('viewBox')?.split(/[\s,]+/).map(Number);
  let w = px(attr('width')), h = px(attr('height'));
  if ((!w || !h) && vb?.length === 4 && vb[2] > 0 && vb[3] > 0) {
    if (w) h = (w * vb[3]) / vb[2]; else if (h) w = (h * vb[2]) / vb[3]; else { w = vb[2]; h = vb[3]; }
  }
  return { tag, w: w || 300, h: h || 150 };
}

/** Decode any input to a canvas at the requested size (SVG is rasterized at that size, so it stays sharp). */
async function decodeTo(item, o, to) {
  let blob = item.blob, svgText = null;
  if (item.format === 'heic') {
    const { heicTo } = await loadLib('heic');
    try { blob = await heicTo({ blob, type: 'image/png' }); } catch { throw new ConvertError(`${item.name} isn't a readable HEIC image.`); }
  }
  if (item.format === 'svg') svgText = await item.text();
  let w, h, img;
  if (svgText) {
    const s = svgSize(svgText);
    [w, h] = fitSize(s.w, s.h, o);
    const sized = s.tag.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, '').replace(/<svg\b/i, `<svg width="${w}" height="${h}"`);
    img = await loadImage(new Blob([svgText.replace(s.tag, sized)], { type: 'image/svg+xml' })).catch(() => {
      throw new ConvertError(`${item.name} couldn't be drawn (invalid SVG, or it references external files).`);
    });
  } else {
    img = await loadImage(blob).catch(() => { throw new ConvertError(`${item.name} couldn't be decoded (corrupt, or a format this browser can't read).`); });
    [w, h] = fitSize(img.naturalWidth, img.naturalHeight, o);
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (OPAQUE.has(to)) { x.fillStyle = o.imgBg || '#ffffff'; x.fillRect(0, 0, w, h); }
  x.imageSmoothingQuality = 'high';
  x.drawImage(img, 0, 0, w, h);
  return c;
}

/** 24-bit BMP (bottom-up rows, padded to 4 bytes). */
function encodeBmp(canvas) {
  const { width: w, height: h } = canvas;
  const { data } = canvas.getContext('2d').getImageData(0, 0, w, h);
  const row = Math.ceil((w * 3) / 4) * 4;
  const buf = new ArrayBuffer(54 + row * h);
  const v = new DataView(buf);
  v.setUint8(0, 0x42); v.setUint8(1, 0x4d);
  v.setUint32(2, buf.byteLength, true); v.setUint32(10, 54, true);
  v.setUint32(14, 40, true); v.setInt32(18, w, true); v.setInt32(22, h, true);
  v.setUint16(26, 1, true); v.setUint16(28, 24, true); v.setUint32(34, row * h, true);
  v.setInt32(38, 2835, true); v.setInt32(42, 2835, true); // 72 dpi
  const px = new Uint8Array(buf);
  for (let y = 0; y < h; y++) {
    let o = 54 + (h - 1 - y) * row;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      px[o++] = data[i + 2]; px[o++] = data[i + 1]; px[o++] = data[i];
    }
  }
  return buf;
}

/** ICO with PNG-compressed entries (supported by Windows Vista+ and every browser). */
async function encodeIco(canvas, mode) {
  const max = Math.max(canvas.width, canvas.height);
  const sizes = mode === 'one' ? [Math.min(256, max)] : [16, 32, 48, 256];
  const pngs = await Promise.all(sizes.map(async (s) => {
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const x = c.getContext('2d');
    x.imageSmoothingQuality = 'high';
    const k = s / max, w = canvas.width * k, h = canvas.height * k;
    x.drawImage(canvas, (s - w) / 2, (s - h) / 2, w, h); // non-square images are centred on a clear square
    return new Uint8Array(await (await canvasToBlob(c)).arrayBuffer());
  }));
  const total = 6 + 16 * sizes.length + pngs.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  const v = new DataView(out.buffer);
  v.setUint16(2, 1, true); v.setUint16(4, sizes.length, true);
  let offset = 6 + 16 * sizes.length;
  sizes.forEach((s, i) => {
    const e = 6 + i * 16;
    v.setUint8(e, s >= 256 ? 0 : s); v.setUint8(e + 1, s >= 256 ? 0 : s);
    v.setUint16(e + 4, 1, true); v.setUint16(e + 6, 32, true);
    v.setUint32(e + 8, pngs[i].length, true); v.setUint32(e + 12, offset, true);
    out.set(pngs[i], offset);
    offset += pngs[i].length;
  });
  return out;
}

async function encode(canvas, to, o) {
  if (to === 'bmp') return encodeBmp(canvas);
  if (to === 'ico') return encodeIco(canvas, o.icoSizes);
  const blob = await canvasToBlob(canvas, OUTPUTS[to], to === 'jpg' || to === 'webp' ? (+o.quality || 88) / 100 : undefined);
  if (blob.type !== OUTPUTS[to]) throw new ConvertError(`This browser can't save ${to.toUpperCase()} images (Safari can't write WebP). Try Chrome, Edge or Firefox, or pick PNG.`);
  return blob.arrayBuffer();
}

const imageConverters = INPUTS.flatMap((from) => Object.keys(OUTPUTS)
  .filter((to) => to !== from && !(from === 'heic' && !['png', 'jpg'].includes(to)))
  .map((to) => ({
    from, to, options: optionsFor(to),
    note: from === 'gif' ? 'Animated GIFs keep only their first frame (use GIF → MP4 or WebM to keep the animation).'
      : OPAQUE.has(to) && !OPAQUE.has(from) ? `${to.toUpperCase()} has no transparency: clear areas get the background colour.` : undefined,
    async convert(item, o) {
      return item.as(to, await encode(await decodeTo(item, o, to), to, o));
    },
  })));

/* ----- images → PDF ----- */
const pdfPage = { id: 'pdfPage', type: 'segmented', label: 'PDF page', value: 'fit', options: [['fit', 'Fit each image'], ['A4', 'A4'], ['LETTER', 'Letter']] };
const pdfConverters = INPUTS.map((from) => ({
  from, to: 'pdf', many: true, final: true, options: [pdfPage, ...size],
  async convert(items, o, ctx) {
    const { jsPDF } = await loadLib('jspdf');
    let pdf = null;
    for (const [i, item] of items.entries()) {
      ctx.status?.(`Adding image ${i + 1} of ${items.length}…`);
      const photo = item.format === 'jpg' || item.format === 'heic';
      const c = await decodeTo(item, o, photo ? 'jpg' : 'png');
      const data = await blobToDataUrl(await canvasToBlob(c, photo ? 'image/jpeg' : 'image/png', 0.92));
      const iw = c.width * 0.75, ih = c.height * 0.75; // px at 96 dpi → points
      let pw, ph, x, y, w, h;
      if (o.pdfPage === 'fit') { [pw, ph] = [iw, ih]; [x, y, w, h] = [0, 0, iw, ih]; } else {
        [pw, ph] = PAGE_SIZES[o.pdfPage];
        if (iw > ih) [pw, ph] = [ph, pw]; // landscape pages for wide images
        const m = 36, s = Math.min(1, (pw - 2 * m) / iw, (ph - 2 * m) / ih);
        [w, h] = [iw * s, ih * s]; [x, y] = [(pw - w) / 2, (ph - h) / 2];
      }
      const orientation = pw > ph ? 'landscape' : 'portrait';
      if (!pdf) pdf = new jsPDF({ unit: 'pt', format: [pw, ph], orientation, compress: true });
      else pdf.addPage([pw, ph], orientation);
      pdf.addImage(data, photo ? 'JPEG' : 'PNG', x, y, w, h, undefined, 'FAST');
      ctx.progress?.((i + 1) / items.length);
    }
    pdf.setProperties({ creator: 'Toolbox' });
    const first = items[0];
    const name = items.length > 1 ? 'images.pdf' : first.name;
    return Object.assign(first.as('pdf', pdf.output('arraybuffer')), items.length > 1 ? { name } : {});
  },
}));

export default [...imageConverters, ...pdfConverters];
