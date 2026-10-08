/** PDF → plain text and page images (pdf.js). */
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
    { id: 'pdfDpi', type: 'segmented', label: 'Resolution', value: '150', options: [['72', '72 dpi'], ['150', '150 dpi'], ['300', '300 dpi']] },
    { id: 'pdfPages', type: 'text', label: 'Pages', value: 'all', placeholder: 'all, or 1-3, 5' },
    ...(to === 'jpg' ? [{ id: 'quality', type: 'range', label: 'Quality', min: 40, max: 100, value: 88, unit: '%' }] : []),
  ],
  async convert(item, o, ctx) {
    const pdf = await openPdf(item);
    const pages = parsePages(o.pdfPages, pdf.numPages);
    const out = [];
    const c = document.createElement('canvas');
    const x = c.getContext('2d');
    for (const [i, p] of pages.entries()) {
      if (ctx.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      ctx.status?.(`Rendering page ${p} of ${pdf.numPages}…`);
      const page = await pdf.getPage(p);
      let viewport = page.getViewport({ scale: +o.pdfDpi / 72 });
      const cap = 8000 / Math.max(viewport.width, viewport.height); // stay under browser canvas limits
      if (cap < 1) viewport = page.getViewport({ scale: (+o.pdfDpi / 72) * cap });
      c.width = Math.ceil(viewport.width); c.height = Math.ceil(viewport.height);
      x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
      await page.render({ canvasContext: x, canvas: c, viewport }).promise;
      const blob = await canvasToBlob(c, mime, to === 'jpg' ? o.quality / 100 : undefined);
      const base = outputName(item.name, to).replace(/\.\w+$/, '');
      out.push(new Item(blob, `${base}-page${String(p).padStart(String(pdf.numPages).length, '0')}.${to}`, to));
      ctx.progress?.((i + 1) / pages.length);
    }
    await closePdf(pdf);
    return out;
  },
});

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
