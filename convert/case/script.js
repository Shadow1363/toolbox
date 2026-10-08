/* Case converter: every case at once, live, with one-click copy. Splits words at spaces, punctuation and camelCase humps. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, store } from '/assets/js/lib/dom.js';
import { remember, copyText, actionButton, debounce } from '/assets/js/lib/text-tool.js';

const input = document.getElementById('input');
const rowsEl = document.getElementById('rows');

const opts = remember('case', [{ title: '', controls: [
  { id: 'perLine', type: 'toggle', label: 'Convert each line separately', value: true },
  { id: 'smallWords', type: 'toggle', label: 'Title Case keeps small words lowercase', value: true, hint: 'a, an, the, and, of, in, on…' },
]}]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st) => { opts.save(st); run(); } });
const s = panel.state;

/** "XMLHttpRequest v2_final-file" → ["XML", "Http", "Request", "v2", "final", "file"]. */
export function words(text) {
  return text
    .replace(/(\p{Ll}|\d)(\p{Lu})/gu, '$1 $2')
    .replace(/(\p{Lu}+)(\p{Lu}\p{Ll})/gu, '$1 $2')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}
const cap = (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'in', 'nor', 'of', 'on', 'or', 'per', 'so', 'the', 'to', 'up', 'via', 'vs', 'yet']);

function titleCase(text) {
  const all = [...text.matchAll(/\p{L}[\p{L}\p{N}'’]*/gu)];
  let i = 0;
  return text.replace(/\p{L}[\p{L}\p{N}'’]*/gu, (w) => {
    const first = i === 0, last = i === all.length - 1;
    i++;
    const lower = w.toLowerCase();
    if (s.smallWords && !first && !last && SMALL.has(lower)) return lower;
    // Mixed-case words (iPhone, XMLHttpRequest) keep their inner capitals.
    return /\p{Lu}/u.test(w.slice(1)) && /\p{Ll}/u.test(w) ? w.charAt(0).toUpperCase() + w.slice(1) : cap(w);
  });
}
const sentenceCase = (text) => text.toLowerCase().replace(/(^\s*|[.!?]\s+)(\p{L})/gu, (_, pre, c) => pre + c.toUpperCase());

const CASES = [
  ['camelCase', (t) => words(t).map((w, i) => (i ? cap(w) : w.toLowerCase())).join('')],
  ['PascalCase', (t) => words(t).map(cap).join('')],
  ['snake_case', (t) => words(t).map((w) => w.toLowerCase()).join('_')],
  ['CONSTANT_CASE', (t) => words(t).map((w) => w.toUpperCase()).join('_')],
  ['kebab-case', (t) => words(t).map((w) => w.toLowerCase()).join('-')],
  ['dot.case', (t) => words(t).map((w) => w.toLowerCase()).join('.')],
  ['Title Case', titleCase],
  ['Sentence case', sentenceCase],
  ['UPPER CASE', (t) => t.toUpperCase()],
  ['lower case', (t) => t.toLowerCase()],
];

function run() {
  store.set('case:last', input.value.slice(0, 5000));
  const apply = (fn) => (s.perLine ? input.value.split('\n').map(fn).join('\n') : fn(input.value));
  rowsEl.replaceChildren(...CASES.map(([label, fn]) => {
    const value = input.value ? apply(fn) : '';
    return h('div', { class: 'io-row' },
      h('span', {}, label),
      h('code', { style: 'white-space:pre-wrap' }, value || '—'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !value, 'aria-label': `Copy ${label}`, html: icon('copy'), onclick: () => copyText(value, `${label} copied`) }));
  }));
}

document.getElementById('in-actions').append(actionButton('Clear', 'trash', () => { input.value = ''; run(); }));
input.addEventListener('input', debounce(run, 40));
input.value = store.get('case:last', 'XMLHttpRequest for the user_profile page');
run();
