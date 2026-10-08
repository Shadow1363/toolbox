/** Markdown → HTML (marked, GitHub-flavoured). Other targets chain through HTML. */
import { loadLib } from '/assets/js/lib/cdn.js';
import { htmlDocument, titleOf, parseHtml } from './_util.js';

export default [
  {
    from: 'md', to: 'html',
    options: [{ id: 'standalone', type: 'toggle', label: 'Full HTML page (with styles)', value: true, hint: 'Off gives just the HTML fragment.' }],
    async convert(item, o) {
      const { marked } = await loadLib('marked');
      const body = await marked.parse(await item.text(), { gfm: true });
      return item.as('html', o.standalone ? htmlDocument(body, titleOf(parseHtml(body), item.name)) : body);
    },
  },
];
