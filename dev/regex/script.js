/* Regex Tester: live matches (in a worker, with a timeout), capture groups, replace preview, explanation and a pattern library. */
import { h, icon, store } from '/assets/js/lib/dom.js';
import { copyButton, downloadButton, actionButton, copyText, debounce, rememberInput, readText, dropFiles } from '/assets/js/lib/text-tool.js';
import { createEditor } from '/assets/js/lib/editor.js';
import { parse, explain, flagDescriptions } from './explain.js';
import { PATTERNS } from './patterns.js';

const FLAGS = [['g', 'global'], ['i', 'ignore case'], ['m', 'multiline'], ['s', 'dotAll'], ['u', 'unicode'], ['y', 'sticky']];
const LIMIT = 1000;        // matches sent back and listed
const MARK_LIMIT = 3000;  // highlighted ranges in the editor
const TIMEOUT = 1500;     // ms before a run is treated as runaway backtracking

const DEFAULT = PATTERNS.find((p) => p.name === 'Date YYYY-MM-DD');
const opts = { flags: 'g', view: 'matches', ...store.get('opts:regex', {}) };
const saveOpts = () => store.set('opts:regex', opts);
const savedPattern = rememberInput('regex:pattern', DEFAULT.pattern);
const savedReplacement = rememberInput('regex:replacement', '$<day>/$<month>/$<year>');
const savedText = rememberInput('regex:text', DEFAULT.sample);

const $ = (id) => document.getElementById(id);
const patternEl = $('pattern');
const replacementEl = $('replacement');
const out = $('out');
patternEl.value = savedPattern.value;
replacementEl.value = savedReplacement.value;

/* ---------- Flags ---------- */
const flagBtns = FLAGS.map(([f, name]) => {
  const b = h('button', { type: 'button', class: 'chip rx-flag', title: name, 'data-f': f }, h('b', {}, f), ` ${name}`);
  b.addEventListener('click', () => {
    opts.flags = opts.flags.includes(f) ? opts.flags.replace(f, '') : FLAGS.map(([x]) => x).filter((x) => x === f || opts.flags.includes(x)).join('');
    saveOpts();
    paintFlags();
    run();
  });
  return b;
});
$('flags').append(...flagBtns);
function paintFlags() {
  flagBtns.forEach((b) => b.setAttribute('aria-pressed', String(opts.flags.includes(b.dataset.f))));
  $('flags-view').textContent = opts.flags;
}

/* ---------- Library ---------- */
const lib = $('library');
for (const g of [...new Set(PATTERNS.map((p) => p.group))]) {
  lib.append(h('optgroup', { label: g }, PATTERNS.map((p, k) => (p.group === g ? h('option', { value: k }, p.name) : null))));
}
let lastSample = PATTERNS.find((p) => p.sample === savedText.value)?.sample ?? null;
lib.addEventListener('change', () => {
  const p = PATTERNS[lib.value];
  lib.value = '';
  if (!p) return;
  patternEl.value = p.pattern;
  opts.flags = p.flags;
  saveOpts();
  paintFlags();
  savedPattern.save(p.pattern);
  // Swap in the sample text only when the current text is empty or an untouched sample.
  if (!editor.value.trim() || editor.value === lastSample) {
    editor.value = p.sample;
    savedText.save(p.sample);
    lastSample = p.sample;
  }
  run();
});

/* ---------- Editor + inputs ---------- */
const editor = createEditor($('editor'), { value: savedText.value, label: 'Test text', lineNumbers: false, placeholder: 'Paste or type the text to test against…', onChange: (t) => { savedText.save(t); run(); } });
dropFiles(editor.el, async ([f]) => {
  try { editor.value = await readText(f); savedText.save(editor.value); run(); } catch (err) { status('error', err.message); }
});
patternEl.addEventListener('input', () => { savedPattern.save(patternEl.value); run(); });
replacementEl.addEventListener('input', () => { savedReplacement.save(replacementEl.value); run(); });

$('pattern-actions').append(actionButton('Copy as /regex/', 'copy', () => {
  if (patternEl.value) copyText(`/${patternEl.value.replace(/(^|[^\\])\//g, '$1\\/')}/${opts.flags}`);
}));
$('in-actions').append(actionButton('Clear', 'trash', () => { editor.value = ''; savedText.save(''); run(); }));

/* ---------- Views ---------- */
const viewBtns = [...$('views').querySelectorAll('button')];
viewBtns.forEach((b) => b.addEventListener('click', () => { opts.view = b.dataset.v; saveOpts(); paintView(); render(); }));
function paintView() {
  viewBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === opts.view)));
  $('replace-wrap').hidden = opts.view !== 'replace';
}
$('out-actions').append(
  copyButton(() => exportText()),
  downloadButton(() => {
    const text = exportText();
    if (!text) return null;
    return { text, name: { matches: 'matches.json', replace: 'replaced.txt', explain: 'regex-explained.txt' }[opts.view], type: opts.view === 'matches' ? 'application/json' : undefined };
  }));

/* ---------- Matching (worker with a timeout) ---------- */
let worker = null;
let runId = 0;
let timer = 0;
let result = null;   // { matches, total, replaced, text, pattern, flags, ast, error, timeout }

function newWorker() {
  worker?.terminate();
  worker = new Worker(new URL('./worker.js', import.meta.url));
  worker.onmessage = ({ data }) => {
    if (data.id !== runId) return;
    clearTimeout(timer);
    result = { ...pending, ...data };
    render();
  };
}
let pending = null;

const run = debounce(() => {
  const pattern = patternEl.value;
  const flags = opts.flags;
  const text = editor.value;
  let ast = null;
  try { ast = parse(pattern, flags); } catch (err) { console.warn('explain', err); }
  let error = null;
  try { new RegExp(pattern, flags); } catch (err) { error = err.message.replace(`Invalid regular expression: /${pattern}/${flags}: `, '').replace(/^Invalid regular expression: /, ''); }
  pending = { pattern, flags, text, ast };
  const id = ++runId;
  clearTimeout(timer);
  if (error || !pattern) {
    result = { ...pending, error, matches: [], total: 0, replaced: null };
    render();
    return;
  }
  if (!worker) newWorker();
  worker.postMessage({ id, pattern, flags, text, replacement: replacementEl.value, limit: LIMIT });
  timer = setTimeout(() => {
    if (id !== runId) return;
    newWorker();
    result = { ...pending, timeout: true, matches: [], total: 0, replaced: null };
    render();
  }, TIMEOUT);
}, 90);

/* ---------- Rendering ---------- */
const fill = (...nodes) => out.replaceChildren(...nodes.filter(Boolean));

function status(kind, text) {
  const el = $('status');
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '';
  el.append(text || '');
}

const visible = (s) => s.replace(/\n/g, '↵').replace(/\t/g, '→').replace(/\r/g, '␍');

function render() {
  if (!result) return;
  const r = result;
  const ps = $('pattern-status');
  ps.className = `io-status${r.error || r.timeout ? ' is-error' : ''}`;
  ps.hidden = !r.error && !r.timeout;
  ps.innerHTML = r.error || r.timeout ? icon('alert') : '';
  ps.append(r.error || (r.timeout ? `Stopped after ${TIMEOUT / 1000} s: the pattern backtracks too much on this text. Look for nested quantifiers like (a+)+ or (.*)*.` : ''));

  // Editor highlights: alternate match colors so adjacent matches stay distinguishable; groups underlined.
  const marks = [];
  for (const [k, m] of r.matches.entries()) {
    if (marks.length >= MARK_LIMIT) break;
    marks.push({ from: m.index, to: m.end, class: k % 2 ? 'rx-m1' : 'rx-m0' });
    for (const g of m.groups) if (g && g[1] > g[0]) marks.push({ from: g[0], to: g[1], class: 'rx-g' });
  }
  editor.setMarks(marks);

  const groupNames = new Map((r.ast?.groups || []).map((g) => [g.n, g.name]));
  const nGroups = r.ast?.groups.length ?? 0;
  if (!r.pattern) status('', 'Type a pattern to start.');
  else if (r.error || r.timeout) status('error', 'No results: fix the pattern first.');
  else status(r.total ? 'ok' : '', `${r.total.toLocaleString()} match${r.total === 1 ? '' : 'es'}${nGroups ? ` · ${nGroups} group${nGroups === 1 ? '' : 's'}` : ''}${!r.flags.includes('g') && r.total ? ' (first only; turn on g for all)' : ''}`);

  if (opts.view === 'matches') renderMatches(r, groupNames);
  else if (opts.view === 'replace') renderReplace(r);
  else renderExplain(r);
}

function renderMatches(r, groupNames) {
  if (!r.matches.length) return fill(h('p', { class: 'muted' }, r.pattern && !r.error && !r.timeout ? 'No matches.' : ''));
  const items = r.matches.slice(0, 300).map((m, k) => h('li', { class: 'rx-match' },
    h('button', { type: 'button', class: 'rx-match-head', title: 'Select in the text', onclick: () => editor.select(m.index, m.end) },
      h('span', { class: 'rx-match-n' }, `Match ${k + 1}`),
      h('code', { class: `rx-match-text ${k % 2 ? 'rx-m1' : 'rx-m0'}` }, m.end > m.index ? visible(r.text.slice(m.index, m.end)) : '(empty)'),
      h('span', { class: 'rx-pos' }, `${m.index}–${m.end}`)),
    m.groups.length > 0 && h('dl', { class: 'rx-groups' }, m.groups.flatMap((g, i) => [
      h('dt', {}, `#${i + 1}`, groupNames.get(i + 1) ? h('span', {}, groupNames.get(i + 1)) : null),
      h('dd', {}, g ? h('code', {}, g[2] === '' ? '(empty)' : visible(g[2])) : h('span', { class: 'muted' }, 'no match')),
      h('dd', { class: 'rx-pos' }, g ? `${g[0]}–${g[1]}` : ''),
    ]))));
  const more = r.total > 300 ? h('p', { class: 'io-note' }, `Showing the first 300 of ${r.total.toLocaleString()} matches${r.total > LIMIT ? ` (Copy and Download include the first ${LIMIT})` : ' (Copy and Download include all)'}.`) : null;
  fill(h('ol', { class: 'rx-matches' }, items), more);
}

function renderReplace(r) {
  if (r.replaced == null) return fill();
  fill(
    h('pre', { class: 'io-out rx-replaced' }, r.replaced),
    !r.flags.includes('g') && r.total ? h('p', { class: 'io-note' }, 'Only the first match is replaced. Turn on the g flag to replace all.') : null);
}

function renderExplain(r) {
  if (!r.pattern) return fill();
  const rows = r.ast ? explain(r.ast, r.flags) : [];
  const flags = flagDescriptions(r.flags);
  const tree = (list) => h('ul', {}, list.map((row) => h('li', {},
    h('button', { type: 'button', class: 'rx-x-row', title: 'Select in the pattern', onclick: () => { patternEl.focus(); patternEl.setSelectionRange(row.start, row.end); } },
      h('code', {}, r.pattern.slice(row.start, row.end) || 'ε'), h('span', {}, row.text)),
    row.children?.length ? tree(row.children) : null)));
  fill(
    r.error ? h('p', { class: 'io-note' }, 'The pattern is invalid, so this explanation is a best guess.') : null,
    rows.length ? h('div', { class: 'rx-explain' }, tree(rows)) : h('p', { class: 'muted' }, 'Nothing to explain.'),
    flags.length ? h('div', { class: 'rx-flags-x' }, h('div', { class: 'io-sub' }, 'Flags'),
      h('ul', {}, flags.map((f) => h('li', {}, h('code', {}, f.flag), ` ${f.text}`)))) : null);
}

function exportText() {
  const r = result;
  if (!r) return '';
  if (opts.view === 'matches') {
    if (!r.matches.length) return '';
    const names = new Map((r.ast?.groups || []).map((g) => [g.n, g.name]));
    return `${JSON.stringify(r.matches.map((m) => ({
      match: r.text.slice(m.index, m.end), index: m.index, end: m.end,
      groups: Object.fromEntries(m.groups.map((g, i) => [names.get(i + 1) || String(i + 1), g ? g[2] : null])),
    })), null, 2)}\n`;
  }
  if (opts.view === 'replace') return r.replaced ?? '';
  if (!r.ast || !r.pattern) return '';
  const lines = [`/${r.pattern}/${r.flags}`, ''];
  const walk = (rows, d) => rows.forEach((row) => { lines.push(`${'  '.repeat(d)}${r.pattern.slice(row.start, row.end)}  →  ${row.text}`); if (row.children) walk(row.children, d + 1); });
  walk(explain(r.ast, r.flags), 0);
  const fl = flagDescriptions(r.flags);
  if (fl.length) lines.push('', 'Flags:', ...fl.map((f) => `  ${f.flag}  ${f.text}`));
  return `${lines.join('\n')}\n`;
}

paintFlags();
paintView();
run();
