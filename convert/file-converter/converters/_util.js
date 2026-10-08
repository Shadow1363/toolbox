/** Helpers shared by the converter modules. */

export const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** A complete, readable HTML page around a fragment (used for Markdown, DOCX, text and tables). */
export function htmlDocument(body, title = 'Document') {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { max-width: 760px; margin: 40px auto; padding: 0 20px; font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif; color: #1d1d1f; }
  h1, h2, h3, h4 { line-height: 1.25; margin: 1.6em 0 .5em; }
  img { max-width: 100%; height: auto; }
  pre, code { font: 14px/1.5 ui-monospace, Menlo, Consolas, monospace; background: #f4f4f6; border-radius: 4px; }
  code { padding: .1em .3em; }
  pre { padding: 12px 14px; overflow: auto; }
  pre code { padding: 0; background: none; }
  blockquote { margin: 1em 0; padding: 0 1em; border-left: 4px solid #d0d0d6; color: #555; }
  table { border-collapse: collapse; margin: 1em 0; }
  th, td { border: 1px solid #d0d0d6; padding: 6px 10px; text-align: left; vertical-align: top; }
  th { background: #f4f4f6; }
  @media print { body { margin: 0; max-width: none; } pre { white-space: pre-wrap; } }
</style>
</head>
<body>
${body}
</body>
</html>
`;
}

/** Parse HTML (a page or a fragment) into an inert document. Scripts never run. */
export function parseHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('script, style, noscript, template, iframe, object, embed').forEach((el) => el.remove());
  return doc;
}

export const titleOf = (doc, fallback) => doc.querySelector('title')?.textContent.trim() || doc.querySelector('h1')?.textContent.trim() || fallback;

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Decode any browser-readable image (including SVG) into an <img>. */
export function loadImage(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('The image could not be decoded (corrupt or unsupported).')); };
    img.src = url;
  });
}

export const canvasToBlob = (canvas, type = 'image/png', quality) =>
  new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('The browser could not encode the image.'))), type, quality));

/**
 * Normalise an image for PDF/DOCX writers: JPEG stays as-is, everything else (PNG included,
 * since writers' PNG parsers are stricter than browsers') is redrawn as a clean PNG.
 * Returns { blob, width, height, type }.
 */
export async function toPngOrJpeg(blob) {
  const img = await loadImage(blob);
  const width = img.naturalWidth || 300, height = img.naturalHeight || 150;
  if (blob.type === 'image/jpeg') return { blob, width, height, type: 'jpg' };
  const c = document.createElement('canvas');
  c.width = width; c.height = height;
  c.getContext('2d').drawImage(img, 0, 0, width, height);
  return { blob: await canvasToBlob(c), width, height, type: 'png' };
}

/**
 * Make every <img> in `doc` self-contained PNG/JPEG data (what PDF and DOCX writers accept).
 * Remote images are fetched when the server allows it (CORS); the rest are dropped.
 * Returns how many images couldn't be included.
 */
export async function inlineImages(doc) {
  let dropped = 0;
  await Promise.all([...doc.querySelectorAll('img')].map(async (img) => {
    try {
      const src = img.getAttribute('src') || '';
      if (!src) throw new Error('no src');
      const blob = src.startsWith('data:') ? await (await fetch(src)).blob() : await fetchImage(src);
      const r = await toPngOrJpeg(blob);
      img.setAttribute('src', await blobToDataUrl(r.blob));
      img.dataset.w = r.width;
      img.dataset.h = r.height;
    } catch {
      dropped++;
      img.replaceWith(doc.createTextNode(img.getAttribute('alt') ? `[${img.getAttribute('alt')}]` : ''));
    }
  }));
  return dropped;
}
async function fetchImage(src) {
  const res = await fetch(new URL(src, location.href), { mode: 'cors' });
  if (!res.ok) throw new Error(res.statusText);
  return res.blob();
}

export const PAGE_SIZES = { A4: [595.28, 841.89], LETTER: [612, 792] }; // points
export const pageSizeOption = { id: 'pageSize', type: 'segmented', label: 'Page size', value: 'A4', options: [['A4', 'A4'], ['LETTER', 'Letter']] };
