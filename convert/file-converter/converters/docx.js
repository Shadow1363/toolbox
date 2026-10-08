/** DOCX → HTML and plain text (mammoth). Markdown and PDF chain through HTML. */
import { loadLib } from '/assets/js/lib/cdn.js';
import { ConvertError } from '../registry.js';
import { htmlDocument } from './_util.js';

const BAD = 'This isn\'t a readable .docx file (it may be corrupt, password-protected, or an old .doc).';

export default [
  {
    from: 'docx', to: 'html',
    note: 'Keeps headings, lists, tables, bold/italic, links and images; page layout, headers/footers, columns, text boxes and exact fonts are dropped.',
    async convert(item, o, ctx) {
      const mammoth = await loadLib('mammoth');
      let res;
      try { res = await mammoth.convertToHtml({ arrayBuffer: await item.arrayBuffer() }); } catch { throw new ConvertError(BAD); }
      const unsupported = res.messages.filter((m) => m.type === 'warning').length;
      if (unsupported) ctx.warn?.(`${unsupported} bit${unsupported > 1 ? 's' : ''} of formatting had no HTML equivalent and were simplified.`);
      return item.as('html', htmlDocument(res.value, item.name.replace(/\.docx$/i, '')));
    },
  },
  {
    from: 'docx', to: 'txt',
    async convert(item) {
      const mammoth = await loadLib('mammoth');
      try {
        const res = await mammoth.extractRawText({ arrayBuffer: await item.arrayBuffer() });
        return item.as('txt', `${res.value.replace(/\n{3,}/g, '\n\n').trim()}\n`);
      } catch { throw new ConvertError(BAD); }
    },
  },
];
