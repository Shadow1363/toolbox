/** PDF → plain text, page images, and the images embedded in a PDF (pdf.js). */
import { loadLib, LIBS, workerUrl } from '/assets/js/lib/cdn.js';
import { ConvertError, Item } from '../registry.js';
import { canvasToBlob } from './_util.js';
import { outputName } from '../formats.js';

let pdfjsReady;
/** pdf.js with its parser in a worker (a same-origin blob that imports the CDN worker). */
export function loadPdfjs() {
  pdfjsReady ||= loadLib('pdfjs').then((pdfjs) => {
    if (!pdfjs.GlobalWorkerOptions.workerPort) {
      pdfjs.GlobalWorkerOptions.workerPort = new Worker(workerUrl(LIBS.pdfjsWorker.url), { type: 'module' });
    }
    return pdfjs;
  }).catch((err) => { pdfjsReady = null; throw err; });
  return pdfjsReady;
}

export async function openPdf(item) {
  const pdfjs = await loadPdfjs();
  try {
    return await pdfjs.getDocument({ data: new Uint8Array(await item.arrayBuffer()), isEvalSupported: false }).promise;
  } catch (err) {
    if (err?.name === 'PasswordException') throw new ConvertError('This PDF is password-protected. Remove the password first.');
    throw new ConvertError('This PDF couldn\'t be read (it may be corrupt).');
  }
}

/** Free the worker's copy of the document (pdf.js 6 moved destroy() to the loading task). */
export const closePdf = (pdf) => (pdf.destroy ? pdf.destroy() : pdf.loadingTask?.destroy());

/** "1-3, 5" → [1, 2, 3, 5] within 1..n. Empty or "all" → every page. */
export function parsePages(spec, n) {
  if (!spec || /^\s*all\s*$/i.test(spec)) return Array.from({ length: n }, (_, i) => i + 1);
  const out = new Set();
  for (const part of spec.split(/[,\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part);
    if (!m) throw new ConvertError(`“${part}” isn't a page or range (use e.g. 1-3, 5).`);
    for (let p = +m[1]; p <= +(m[2] || m[1]); p++) if (p >= 1 && p <= n) out.add(p);
  }
  if (!out.size) throw new ConvertError(`No pages in that range: this PDF has ${n} page${n > 1 ? 's' : ''}.`);
  return [...out].sort((a, b) => a - b);
}

/**
 * Rebuild reading order: PDFs store text in drawing order (list numbers often come after their
 * item), so group runs into lines by baseline, sort each line left to right, and keep a blank
 * line where the vertical gap is larger than usual (paragraph breaks).
 */
async function pageText(page) {
  const { items } = await page.getTextContent();
  const runs = items.filter((it) => it.str?.trim() && it.transform)
    .map((it) => ({ s: it.str, x: it.transform[4], y: it.transform[5], w: it.width || 0, h: Math.abs(it.transform[3]) || 10 }));
  const lines = [];
  for (const r of runs.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((l) => Math.abs(l.y - r.y) < Math.min(l.h, r.h) * 0.5);
    if (line) line.runs.push(r); else lines.push({ y: r.y, h: r.h, runs: [r] });
  }
  lines.sort((a, b) => b.y - a.y);
  let out = '', prev = null;
  for (const l of lines) {
    l.runs.sort((a, b) => a.x - b.x);
    let text = '', end = null;
    for (const r of l.runs) {
      if (end != null && r.x - end > r.h * 0.15 && !/\s$/.test(text) && !/^\s/.test(r.s)) text += ' ';
      text += r.s;
      end = r.x + r.w;
    }
    if (prev) out += prev.y - l.y > Math.max(prev.h, l.h) * 1.9 ? '\n\n' : '\n';
    out += text.trim();
    prev = l;
  }
  return out;
}

const imageTarget = (to, mime) => ({
  from: 'pdf', to, final: true,
  options: [
    { id: 'pdfExtract', type: 'segmented', label: 'Save', value: 'pages', options: [['pages', 'Each page'], ['images', 'Images inside']],
      hint: 'Images inside: every picture embedded in the PDF at its own resolution, each saved once.' },
    { id: 'pdfDpi', type: 'segmented', label: 'Resolution', value: '150', options: [['72', '72 dpi'], ['150', '150 dpi'], ['300', '300 dpi']], showIf: (s) => s.pdfExtract !== 'images' },
    { id: 'pdfMinSize', type: 'range', label: 'Skip images smaller than', min: 0, max: 400, step: 8, value: 32, unit: 'px', showIf: (s) => s.pdfExtract === 'images' },
    { id: 'pdfPages', type: 'text', label: 'Pages', value: 'all', placeholder: 'all, or 1-3, 5' },
    ...(to === 'jpg' ? [{ id: 'quality', type: 'range', label: 'Quality', min: 40, max: 100, value: 88, unit: '%' }] : []),
  ],
  async convert(item, o, ctx) {
    const pdf = await openPdf(item);
    try {
      return o.pdfExtract === 'images' ? await extractImages(pdf, item, to, mime, o, ctx) : await renderPages(pdf, item, to, mime, o, ctx);
    } finally {
      await closePdf(pdf);
    }
  },
});

const checkCancel = (ctx) => { if (ctx.signal?.aborted) throw new DOMException('Cancelled', 'AbortError'); };
const pad = (n, max) => String(n).padStart(String(max).length, '0');

async function renderPages(pdf, item, to, mime, o, ctx) {
  const pages = parsePages(o.pdfPages, pdf.numPages);
  const out = [];
  const c = document.createElement('canvas');
  const x = c.getContext('2d');
  const base = outputName(item.name, to).replace(/\.\w+$/, '');
  for (const [i, p] of pages.entries()) {
    checkCancel(ctx);
    ctx.status?.(`Rendering page ${p} of ${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    let viewport = page.getViewport({ scale: +o.pdfDpi / 72 });
    const cap = 8000 / Math.max(viewport.width, viewport.height); // stay under browser canvas limits
    if (cap < 1) viewport = page.getViewport({ scale: (+o.pdfDpi / 72) * cap });
    c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: x, canvas: c, viewport }).promise;
    const blob = await canvasToBlob(c, mime, to === 'jpg' ? o.quality / 100 : undefined);
    out.push(new Item(blob, `${base}-page${pad(p, pdf.numPages)}.${to}`, to));
    ctx.progress?.((i + 1) / pages.length);
  }
  return out;
}

/**
 * Every raster image drawn on the chosen pages, at its native size. pdf.js hands over decoded
 * pixels (RGB/RGBA/1-bit grey) or an ImageBitmap; images reused on several pages are saved once
 * (keyed by their PDF object ref). Stencil masks (one-colour shapes) aren't pictures and are skipped.
 */
async function extractImages(pdf, item, to, mime, o, ctx) {
  const pdfjs = await loadPdfjs();
  const { OPS } = pdfjs;
  const PAINT = new Set([OPS.paintImageXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObject]);
  const pages = parsePages(o.pdfPages, pdf.numPages);
  const min = +o.pdfMinSize || 0;
  const seen = new Set();
  const found = []; // { page, canvas }
  let skipped = 0;
  for (const [i, p] of pages.entries()) {
    checkCancel(ctx);
    ctx.status?.(`Looking for images on page ${p} of ${pdf.numPages}…`);
    const page = await pdf.getPage(p);
    const ops = await page.getOperatorList();
    for (let k = 0; k < ops.fnArray.length; k++) {
      if (!PAINT.has(ops.fnArray[k])) continue;
      const arg = ops.argsArray[k][0];
      let img = arg;
      if (typeof arg === 'string') {
        const objs = arg.startsWith('g_') ? page.commonObjs : page.objs;
        img = await new Promise((resolve) => objs.get(arg, resolve));
      }
      if (!img?.width || !img?.height) continue;
      const key = img.ref || (typeof arg === 'string' ? arg : null);
      if (key) { if (seen.has(key)) continue; seen.add(key); }
      if (Math.max(img.width, img.height) < min) { skipped++; continue; }
      const c = imageCanvas(img, pdfjs.ImageKind);
      if (c) found.push({ page: p, canvas: c });
    }
    page.cleanup?.();
    ctx.progress?.(((i + 1) / pages.length) * 0.5);
  }
  if (!found.length) {
    throw new ConvertError(skipped
      ? `Only small images found (${skipped}); lower “Skip images smaller than” to include them.`
      : 'No embedded images on these pages. Text and vector drawings aren\'t images: choose “Each page” to save the pages as pictures.');
  }
  if (skipped) ctx.warn?.(`Skipped ${skipped} image${skipped > 1 ? 's' : ''} smaller than ${min} px (icons, bullets, lines).`);
  const base = outputName(item.name, to).replace(/\.\w+$/, '');
  const out = [];
  for (const [i, f] of found.entries()) {
    checkCancel(ctx);
    ctx.status?.(`Saving image ${i + 1} of ${found.length}…`);
    let c = f.canvas;
    if (to === 'jpg') { // JPEG has no alpha: flatten onto white
      const flat = document.createElement('canvas');
      flat.width = c.width; flat.height = c.height;
      const fx = flat.getContext('2d');
      fx.fillStyle = '#fff'; fx.fillRect(0, 0, c.width, c.height);
      fx.drawImage(c, 0, 0);
      c = flat;
    }
    const blob = await canvasToBlob(c, mime, to === 'jpg' ? o.quality / 100 : undefined);
    out.push(new Item(blob, `${base}-p${pad(f.page, pdf.numPages)}-img${pad(i + 1, found.length)}.${to}`, to));
    f.canvas.width = f.canvas.height = 0; // free the pixels early
    ctx.progress?.(0.5 + ((i + 1) / found.length) * 0.5);
  }
  return out;
}

/** A pdf.js image object (decoded pixels or ImageBitmap) on a canvas, or null for a format we can't read. */
function imageCanvas(img, ImageKind) {
  const { width: w, height: h } = img;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d');
  if (img.bitmap) { x.drawImage(img.bitmap, 0, 0); return c; }
  const src = img.data;
  if (!src) return null;
  const out = x.createImageData(w, h);
  const d = out.data;
  if (img.kind === ImageKind.RGBA_32BPP) d.set(src.subarray(0, d.length));
  else if (img.kind === ImageKind.RGB_24BPP) {
    for (let i = 0, j = 0; j < d.length; i += 3, j += 4) { d[j] = src[i]; d[j + 1] = src[i + 1]; d[j + 2] = src[i + 2]; d[j + 3] = 255; }
  } else if (img.kind === ImageKind.GRAYSCALE_1BPP) {
    const rowBytes = (w + 7) >> 3;
    for (let y = 0; y < h; y++) {
      for (let px = 0; px < w; px++) {
        const v = (src[y * rowBytes + (px >> 3)] >> (7 - (px & 7))) & 1 ? 255 : 0;
        const j = (y * w + px) * 4;
        d[j] = d[j + 1] = d[j + 2] = v; d[j + 3] = 255;
      }
    }
  } else return null;
  x.putImageData(out, 0, 0);
  return c;
}

export default [
  {
    from: 'pdf', to: 'txt',
    note: 'Text only, in reading order as best it can; scanned PDFs are images and have no text (there\'s no OCR).',
    async convert(item, o, ctx) {
      const pdf = await openPdf(item);
      const parts = [];
      for (let p = 1; p <= pdf.numPages; p++) {
        ctx.status?.(`Reading page ${p} of ${pdf.numPages}…`);
        parts.push(await pageText(await pdf.getPage(p)));
        ctx.progress?.(p / pdf.numPages);
      }
      await closePdf(pdf);
      const text = parts.join('\n\n');
      if (!text.trim()) ctx.warn?.('No text found: this looks like a scanned PDF (pages are pictures). Try PDF → PNG instead.');
      return item.as('txt', `${text}\n`);
    },
  },
  imageTarget('png', 'image/png'),
  imageTarget('jpg', 'image/jpeg'),
];
