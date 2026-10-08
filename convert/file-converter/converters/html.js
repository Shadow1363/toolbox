/**
 * HTML → Markdown (turndown + GFM tables), plain text, PDF (pdfmake + html-to-pdfmake)
 * and DOCX (html-docx.js). HTML is the hub for documents: Markdown, DOCX and text reach
 * PDF/DOCX through it.
 */
import { loadLib } from '/assets/js/lib/cdn.js';
import { parseHtml, titleOf, inlineImages, pageSizeOption, PAGE_SIZES } from './_util.js';
import { htmlToDocx } from './html-docx.js';

const LAYOUT_NOTE = 'Keeps text structure (headings, lists, tables, links, images); CSS layout, fonts and colours are simplified.';

export default [
  {
    from: 'html', to: 'md',
    note: 'Markdown has no colours, fonts or layout; those are dropped.',
    async convert(item) {
      const [{ default: Turndown }, gfm] = await Promise.all([loadLib('turndown'), loadLib('turndownGfm')]);
      const td = new Turndown({ headingStyle: 'atx', codeBlockStyle: 'fenced', bulletListMarker: '-', emDelimiter: '*' });
      td.use(gfm.gfm);
      td.remove(['script', 'style', 'noscript']);
      return item.as('md', `${td.turndown(parseHtml(await item.text()).body).trim()}\n`);
    },
  },
  {
    from: 'html', to: 'txt',
    async convert(item) {
      return item.as('txt', `${htmlToText(parseHtml(await item.text()).body)}\n`);
    },
  },
  {
    from: 'html', to: 'pdf',
    note: `${LAYOUT_NOTE} PDF text uses the Roboto font, which has no Chinese, Japanese or Korean glyphs.`,
    options: [pageSizeOption],
    async convert(item, o, ctx) {
      const doc = parseHtml(await item.text());
      const dropped = await inlineImages(doc);
      if (dropped) ctx.warn?.(`${dropped} image${dropped > 1 ? 's' : ''} couldn't be loaded (blocked by the server) and were left out.`);
      if (/[぀-ヿ㐀-鿿가-힯]/.test(doc.body.textContent)) ctx.warn?.('Some characters (CJK) aren\'t in the PDF font and will be missing.');
      const [w, h] = PAGE_SIZES[o.pageSize] || PAGE_SIZES.A4;
      const margins = [56, 56, 56, 64];
      const maxW = w - margins[0] - margins[2];
      doc.querySelectorAll('img').forEach((img) => {
        const iw = (+img.dataset.w || 300) * 0.75;
        img.setAttribute('width', String(Math.min(iw, maxW)));
        img.removeAttribute('height');
      });
      const pdfMake = await loadPdfMake();
      const { default: htmlToPdfmake } = await loadLib('htmlToPdfmake');
      const content = htmlToPdfmake(doc.body.innerHTML, {
        window, tableAutoSize: true,
        defaultStyles: {
          h1: { fontSize: 22, bold: true, marginBottom: 8, marginTop: 12 },
          h2: { fontSize: 17, bold: true, marginBottom: 6, marginTop: 12 },
          h3: { fontSize: 14, bold: true, marginBottom: 5, marginTop: 10 },
          p: { margin: [0, 0, 0, 8] },
          pre: { fontSize: 9.5, background: '#f4f4f6', margin: [0, 2, 0, 8], preserveLeadingSpaces: true },
          code: { fontSize: 9.5, background: '#f4f4f6' },
          blockquote: { italics: true, color: '#555555', margin: [12, 0, 0, 8] },
          a: { color: '#0563c1', decoration: 'underline' },
          th: { bold: true, fillColor: '#f2f2f4' },
        },
      });
      const def = {
        content,
        pageSize: { width: w, height: h },
        pageMargins: margins,
        defaultStyle: { fontSize: 11, lineHeight: 1.2 },
        info: { title: titleOf(doc, item.name), creator: 'Toolbox' },
        footer: (page, pages) => (pages > 1 ? { text: `${page} / ${pages}`, alignment: 'center', fontSize: 8, color: '#888888', margin: [0, 24, 0, 0] } : null),
      };
      try {
        return item.as('pdf', await pdfBlob(pdfMake.createPdf(def)));
      } catch (err) {
        if (!/image/i.test(err?.message)) throw err;
        // One image the PDF writer can't parse shouldn't sink the whole document.
        ctx.warn?.('An image couldn\'t be embedded in the PDF and was left out.');
        doc.querySelectorAll('img').forEach((img) => img.remove());
        def.content = htmlToPdfmake(doc.body.innerHTML, { window, tableAutoSize: true });
        return item.as('pdf', await pdfBlob(pdfMake.createPdf(def)));
      }
    },
  },
  {
    from: 'html', to: 'docx',
    note: LAYOUT_NOTE,
    options: [pageSizeOption],
    async convert(item, o, ctx) {
      const doc = parseHtml(await item.text());
      const dropped = await inlineImages(doc);
      if (dropped) ctx.warn?.(`${dropped} image${dropped > 1 ? 's' : ''} couldn't be loaded and were left out.`);
      const blob = await htmlToDocx(doc, { pageSize: o.pageSize, title: titleOf(doc, item.name) });
      return item.as('docx', await blob.arrayBuffer());
    },
  },
];

/** pdfmake + its Roboto font files (two classic scripts, in order). Shared with images → PDF. */
export async function loadPdfMake() {
  await loadLib('pdfmake');
  await loadLib('pdfmakeFonts');
  return window.pdfMake;
}

/** pdfmake 0.3 returns a Promise from getBlob(); older builds take a callback. */
export function pdfBlob(pdf) {
  return new Promise((resolve, reject) => {
    const r = pdf.getBlob(resolve);
    if (r?.then) r.then(resolve, reject);
  }).then((b) => b.arrayBuffer());
}

const BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|FOOTER|NAV|ASIDE|H[1-6]|UL|OL|TABLE|BLOCKQUOTE|PRE|FIGURE|FIGCAPTION|DL|DT|DD|ADDRESS|FORM|FIELDSET)$/;

/** Readable plain text from HTML: paragraphs, "•"/"1." lists, tab-separated table rows. */
export function htmlToText(root) {
  let s = '';
  const walk = (n, pre, list, depth) => {
    if (n.nodeType === 3) { s += pre ? n.data : n.data.replace(/\s+/g, ' '); return; }
    if (n.nodeType !== 1) return;
    const tag = n.tagName;
    if (tag === 'BR') { s += '\n'; return; }
    if (tag === 'IMG') { const alt = n.getAttribute('alt'); if (alt) s += `[${alt}]`; return; }
    if (tag === 'HR') { s += '\n\n----------\n\n'; return; }
    const isList = tag === 'UL' || tag === 'OL';
    const nested = isList && depth > 0; // a list inside a list item continues on the next line
    if (tag === 'LI') s += `\n${'  '.repeat(Math.max(0, depth - 1))}${list?.ordered ? `${++list.n}. ` : '• '}`;
    else if (tag === 'TR') s += '\n';
    else if (tag === 'TD' || tag === 'TH') { if (n.previousElementSibling) s += '\t'; }
    else if (BLOCK.test(tag) && !nested) s += '\n\n';
    const childList = isList ? { ordered: tag === 'OL', n: (+n.getAttribute('start') || 1) - 1 } : list;
    for (const c of n.childNodes) walk(c, pre || tag === 'PRE', childList, isList ? depth + 1 : depth);
    if (BLOCK.test(tag) && !(isList && depth > 0)) s += '\n\n';
  };
  walk(root, false, null, 0);
  return s.split('\n').map((l) => l.replace(/[ \t]+$/, '').replace(/^ (?=\S)/, '')).join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
