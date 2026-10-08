/**
 * HTML → DOCX writer on top of the `docx` library: headings, paragraphs, bold/italic/
 * underline/strike/code, links, nested bullet and numbered lists, block quotes, code blocks,
 * tables, images and rules. CSS layout (columns, floats, colours, fonts) is not carried over.
 */
import { loadLib } from '/assets/js/lib/cdn.js';

const BLOCK = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'MAIN', 'HEADER', 'FOOTER', 'NAV', 'ASIDE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
  'UL', 'OL', 'LI', 'TABLE', 'BLOCKQUOTE', 'PRE', 'HR', 'FIGURE', 'FIGCAPTION', 'DL', 'DT', 'DD', 'ADDRESS', 'BODY', 'CENTER', 'DETAILS', 'SUMMARY']);
const TWIPS = { A4: [11906, 16838], LETTER: [12240, 15840] };
const MAX_IMG = 600; // px, roughly the text width of an A4/Letter page with 1" margins

export async function htmlToDocx(doc, { pageSize = 'A4', title = 'Document' } = {}) {
  const D = await loadLib('docx');
  let listInstance = 0;

  /* ----- inline content → runs ----- */
  function segments(node, fmt, out = []) {
    for (const n of node.childNodes) {
      if (n.nodeType === 3) {
        const t = fmt.pre ? n.data : n.data.replace(/\s+/g, ' ');
        if (t) out.push({ t, f: fmt });
        continue;
      }
      if (n.nodeType !== 1) continue;
      const tag = n.tagName;
      if (tag === 'BR') out.push({ br: true });
      else if (tag === 'IMG') out.push({ img: n });
      else if (tag === 'UL' || tag === 'OL' || tag === 'TABLE') continue; // handled as blocks by the caller
      else if (tag === 'A' && n.getAttribute('href') && !/^\s*javascript:/i.test(n.getAttribute('href'))) {
        out.push({ link: n.getAttribute('href'), segs: segments(n, { ...fmt, link: true }) });
      } else {
        const f = { ...fmt };
        if (tag === 'STRONG' || tag === 'B') f.bold = true;
        if (tag === 'EM' || tag === 'I' || tag === 'CITE') f.italics = true;
        if (tag === 'U' || tag === 'INS') f.underline = true;
        if (tag === 'S' || tag === 'DEL' || tag === 'STRIKE') f.strike = true;
        if (tag === 'CODE' || tag === 'KBD' || tag === 'SAMP' || tag === 'TT') f.code = true;
        if (tag === 'SUP') f.sup = true;
        if (tag === 'SUB') f.sub = true;
        if (tag === 'MARK') f.mark = true;
        if (/^H[1-6]$/.test(tag) || tag === 'TH' || tag === 'DT') f.bold = f.bold || tag !== 'H1';
        segments(n, f, out);
      }
    }
    return out;
  }

  /** Trim the whitespace HTML would collapse at the start and end of a paragraph. */
  function trimSegs(segs) {
    const texts = segs.flatMap((s) => (s.segs ? s.segs : [s])).filter((s) => s.t != null && !s.f.pre);
    if (texts.length) {
      texts[0].t = texts[0].t.replace(/^\s+/, '');
      texts[texts.length - 1].t = texts[texts.length - 1].t.replace(/\s+$/, '');
    }
    return segs;
  }

  const textRun = (t, f) => new D.TextRun({
    text: t, bold: f.bold, italics: f.italics, strike: f.strike,
    underline: f.underline || f.link ? {} : undefined,
    color: f.link ? '0563C1' : undefined,
    font: f.code ? 'Consolas' : undefined,
    size: f.code ? 20 : undefined,
    superScript: f.sup, subScript: f.sub,
    highlight: f.mark ? 'yellow' : undefined,
  });

  function runs(segs) {
    const out = [];
    for (const s of segs) {
      if (s.br) out.push(new D.TextRun({ break: 1 }));
      else if (s.img) { const r = imageRun(s.img); if (r) out.push(r); }
      else if (s.link) out.push(new D.ExternalHyperlink({ link: s.link, children: runs(s.segs).filter((r) => !(r instanceof D.ExternalHyperlink)) }));
      else if (s.t) out.push(textRun(s.t, s.f));
    }
    return out;
  }

  function imageRun(img) {
    const src = img.getAttribute('src') || '';
    const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(src);
    if (!m) return null;
    const data = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
    let w = +img.dataset.w || +img.getAttribute('width') || 300, h = +img.dataset.h || +img.getAttribute('height') || 200;
    if (w > MAX_IMG) { h = Math.round((h * MAX_IMG) / w); w = MAX_IMG; }
    return new D.ImageRun({ type: m[1] === 'png' ? 'png' : 'jpg', data, transformation: { width: w, height: h } });
  }

  /* ----- block content → paragraphs and tables ----- */
  const para = (children, extra = {}) => new D.Paragraph({ children: children.length ? children : [new D.TextRun('')], spacing: { after: 120 }, ...extra });

  function blocks(node, ctx = {}) {
    const out = [];
    let inline = [];
    const flush = () => {
      const segs = trimSegs(inline.flatMap((n) => (n.nodeType === 3 ? [{ t: n.data.replace(/\s+/g, ' '), f: {} }] : segments({ childNodes: [n] }, {}))));
      inline = [];
      const r = runs(segs);
      if (r.length) out.push(para(r, ctx.quote ? quoteStyle() : {}));
    };
    for (const n of node.childNodes) {
      if (n.nodeType === 3) { if (n.data.trim() || inline.length) inline.push(n); continue; }
      if (n.nodeType !== 1) continue;
      if (!BLOCK.has(n.tagName)) { inline.push(n); continue; }
      flush();
      out.push(...block(n, ctx));
    }
    flush();
    return out;
  }

  const quoteStyle = () => ({ indent: { left: 567 }, border: { left: { style: D.BorderStyle.SINGLE, size: 12, color: 'C8C8D0', space: 10 } } });

  function block(n, ctx) {
    const tag = n.tagName;
    const h = /^H([1-6])$/.exec(tag);
    if (h) return [new D.Paragraph({ heading: D.HeadingLevel[`HEADING_${h[1]}`], children: runs(trimSegs(segments(n, {}))) })];
    if (tag === 'P' || tag === 'DT' || tag === 'FIGCAPTION' || tag === 'SUMMARY' || tag === 'ADDRESS') {
      if ([...n.children].some((c) => BLOCK.has(c.tagName))) return blocks(n, ctx);
      return [para(runs(trimSegs(segments(n, {}))), ctx.quote ? quoteStyle() : tag === 'DD' ? { indent: { left: 567 } } : {})];
    }
    if (tag === 'DD') return blocks(n, ctx).map((p) => p); // indented through DL default spacing
    if (tag === 'UL' || tag === 'OL') return list(n, 0, ctx);
    if (tag === 'BLOCKQUOTE') return blocks(n, { ...ctx, quote: true });
    if (tag === 'PRE') {
      return n.textContent.replace(/\n$/, '').split('\n').map((line) => new D.Paragraph({
        children: [new D.TextRun({ text: line || ' ', font: 'Consolas', size: 19 })],
        shading: { type: D.ShadingType.CLEAR, fill: 'F4F4F6', color: 'auto' }, spacing: { after: 0 },
      })).concat(para([]));
    }
    if (tag === 'HR') return [new D.Paragraph({ children: [], border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'BBBBBB', space: 1 } } })];
    if (tag === 'TABLE') return table(n);
    return blocks(n, ctx);
  }

  function list(n, level, ctx) {
    const ordered = n.tagName === 'OL';
    const instance = ++listInstance;
    const out = [];
    for (const li of n.children) {
      if (li.tagName !== 'LI') continue;
      const own = trimSegs(segments(li, {}));
      const style = ordered ? { numbering: { reference: 'ol', level: Math.min(level, 8), instance } } : { bullet: { level: Math.min(level, 8) } };
      out.push(new D.Paragraph({ children: runs(own), spacing: { after: 60 }, ...style }));
      for (const c of li.children) {
        if (c.tagName === 'UL' || c.tagName === 'OL') out.push(...list(c, level + 1, ctx));
        else if (c.tagName === 'TABLE') out.push(...table(c));
      }
    }
    return out;
  }

  function table(n) {
    const rows = [...n.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')];
    const width = Math.max(0, ...rows.map((r) => [...r.cells].reduce((s, c) => s + (+c.colSpan || 1), 0)));
    if (!rows.length || !width) return [];
    return [new D.Table({
      width: { size: 100, type: D.WidthType.PERCENTAGE },
      rows: rows.map((tr) => new D.TableRow({
        // Only set when true: some readers (mammoth) treat any <w:tblHeader> as a header row, even val="off".
        tableHeader: tr.parentElement.tagName === 'THEAD' || undefined,
        children: [...tr.cells].map((td) => new D.TableCell({
          columnSpan: +td.colSpan > 1 ? +td.colSpan : undefined,
          shading: td.tagName === 'TH' ? { type: D.ShadingType.CLEAR, fill: 'F2F2F4', color: 'auto' } : undefined,
          children: (() => { const b = blocks(td, {}); return b.length ? b : [para([])]; })(),
        })),
      })),
    }), para([])];
  }

  const children = blocks(doc.body);
  const [w, h] = TWIPS[pageSize] || TWIPS.A4;
  const document = new D.Document({
    creator: 'Toolbox',
    title,
    styles: { default: { document: { run: { font: 'Calibri', size: 22 } } } },
    numbering: {
      config: [{
        reference: 'ol',
        levels: Array.from({ length: 9 }, (_, l) => ({
          level: l, format: D.LevelFormat.DECIMAL, text: `%${l + 1}.`, alignment: D.AlignmentType.START,
          style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } },
        })),
      }],
    },
    sections: [{ properties: { page: { size: { width: w, height: h }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
  return D.Packer.toBlob(document);
}
