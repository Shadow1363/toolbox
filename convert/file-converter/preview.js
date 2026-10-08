/**
 * Preview of a source file or a conversion result. HTML (and DOCX, rendered to HTML) goes in
 * a sandboxed iframe with scripts disabled; tables show their first rows; PDFs use the
 * browser's own viewer. Object URLs from the previous preview are revoked on each render.
 */
import { h, formatBytes } from '/assets/js/lib/dom.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { parseDelimited } from '/assets/js/lib/codecs.js';
import { FORMATS } from './formats.js';

const MAX_TEXT = 200_000;
const MAX_ROWS = 200;
let urls = [];
let token = 0;

const url = (blob) => { const u = URL.createObjectURL(blob); urls.push(u); return u; };
/** Untrusted HTML: scripts stripped (they couldn't run in the sandbox anyway) and no plugins or frames. */
function sandboxed(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, iframe, object, embed, base, meta[http-equiv]').forEach((el) => el.remove());
  doc.querySelectorAll('*').forEach((el) => [...el.attributes].forEach((a) => { if (/^on/i.test(a.name)) el.removeAttribute(a.name); }));
  return h('iframe', { class: 'fc-frame', sandbox: '', title: 'Preview', srcdoc: `<!doctype html>${doc.documentElement.outerHTML}` });
}
const note = (text) => h('p', { class: 'fc-preview-note' }, text);

/** Render `items` (one Item, or several, e.g. PDF pages) into `root`. */
export async function renderPreview(root, items) {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  const mine = ++token;
  const list = [items].flat().filter(Boolean);
  if (!list.length) return root.replaceChildren(note('Nothing to preview yet.'));
  root.replaceChildren(h('div', { class: 'fc-preview-loading' }, h('div', { class: 'spinner' })));
  let el;
  try {
    el = list.length > 1 ? gallery(list) : await single(list[0]);
  } catch (err) {
    console.error(err);
    el = note(`No preview available (${err.message || 'unreadable file'}). You can still download it.`);
  }
  if (mine === token) root.replaceChildren(el);
}

function gallery(list) {
  const images = list.every((i) => FORMATS[i.format].kind === 'image');
  return h('div', { class: images ? 'fc-gallery' : 'fc-filelist' }, list.slice(0, 60).map((i) => (images
    ? h('figure', {}, h('img', { src: url(i.blob), alt: i.name, loading: 'lazy' }), h('figcaption', {}, i.name))
    : h('div', {}, h('strong', {}, i.name), ` · ${formatBytes(i.blob.size)}`))),
  list.length > 60 && note(`…and ${list.length - 60} more.`));
}

async function single(item) {
  const f = FORMATS[item.format];
  switch (item.format) {
    case 'html': return item.blob.size > 5e6 ? textBlock(await item.text()) : sandboxed(await item.text());
    case 'pdf': return h('iframe', { class: 'fc-frame', src: url(item.blob), title: 'PDF preview' });
    case 'docx': {
      const mammoth = await loadLib('mammoth');
      const res = await mammoth.convertToHtml({ arrayBuffer: await item.arrayBuffer() });
      return wrap(sandboxed(`<!doctype html><meta charset="utf-8"><style>body{font:15px/1.55 system-ui,sans-serif;max-width:720px;margin:24px auto;padding:0 16px}img{max-width:100%}table{border-collapse:collapse}td,th{border:1px solid #ccc;padding:4px 8px}</style>${res.value}`),
        'Preview of the document content; Word layout is approximate here.');
    }
    case 'csv': case 'tsv':
      return table(parseDelimited((await item.blob.slice(0, 2e6).text()), { delimiter: item.format === 'tsv' ? '\t' : 'auto' }));
    case 'xlsx': {
      const XLSX = await loadLib('xlsx');
      const wb = XLSX.read(new Uint8Array(await item.arrayBuffer()), { type: 'array', sheetRows: MAX_ROWS + 1 });
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
      return wrap(table(rows), wb.SheetNames.length > 1 ? `Showing “${wb.SheetNames[0]}” (1 of ${wb.SheetNames.length} sheets).` : null);
    }
    case 'heic': return note('Browsers can\'t display HEIC directly. Convert it to see a preview.');
    default: break;
  }
  if (f.kind === 'image') {
    const img = h('img', { class: 'fc-image checker', src: url(item.blob), alt: item.name });
    const info = h('p', { class: 'fc-preview-note' }, formatBytes(item.blob.size));
    img.onload = () => { info.textContent = `${img.naturalWidth} × ${img.naturalHeight} px · ${formatBytes(item.blob.size)}`; };
    img.onerror = () => { info.textContent = 'This browser can\'t display this image, but the file can still be downloaded.'; };
    return h('div', { class: 'fc-image-wrap' }, img, info);
  }
  if (f.kind === 'video' || f.kind === 'audio') {
    const media = h(f.kind, { class: `fc-${f.kind}`, controls: true, src: url(item.blob), preload: 'metadata' });
    const msg = note(formatBytes(item.blob.size));
    media.onerror = () => { msg.textContent = `This browser can't play ${f.label} files, but the converted file is fine to download.`; };
    return h('div', { class: 'fc-media-wrap' }, media, msg);
  }
  if (f.text) return textBlock(await item.blob.slice(0, MAX_TEXT).text(), item.blob.size > MAX_TEXT);
  return note(`${f.label} · ${formatBytes(item.blob.size)}. No preview for this format.`);
}

function textBlock(text, cut = false) {
  return wrap(h('pre', { class: 'fc-text' }, text), cut ? `Showing the first ${formatBytes(MAX_TEXT)}.` : null);
}

function table(rows) {
  if (!rows.length) return note('The table is empty.');
  const width = Math.max(...rows.slice(0, MAX_ROWS + 1).map((r) => r.length));
  const cells = (r, tag) => Array.from({ length: width }, (_, i) => h(tag, {}, r[i] == null ? '' : String(r[i])));
  return wrap(h('div', { class: 'fc-table-wrap' }, h('table', { class: 'fc-table' },
    h('thead', {}, h('tr', {}, cells(rows[0], 'th'))),
    h('tbody', {}, rows.slice(1, MAX_ROWS + 1).map((r) => h('tr', {}, cells(r, 'td')))))),
  rows.length > MAX_ROWS + 1 ? `Showing the first ${MAX_ROWS} rows.` : null);
}

const wrap = (el, text) => (text ? h('div', { class: 'fc-stack' }, el, note(text)) : el);
