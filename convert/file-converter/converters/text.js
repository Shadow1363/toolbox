/** Plain text → HTML (paragraphs at blank lines, line breaks kept). PDF and DOCX chain from here. */
import { escapeHtml, htmlDocument } from './_util.js';

export default [
  {
    from: 'txt', to: 'html',
    async convert(item) {
      const text = (await item.text()).replace(/\r\n?/g, '\n');
      const body = text.split(/\n{2,}/).filter((p) => p.trim())
        .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br>\n')}</p>`).join('\n');
      return item.as('html', htmlDocument(body, item.name));
    },
  },
];
