/* Diff Checker: line diff (jsdiff) with word/character highlights inside changed lines, side by side or inline; JSON mode; .patch export. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, toast } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce, rememberInput, readText, dropFiles } from '/assets/js/lib/text-tool.js';
import { createEditor } from '/assets/js/lib/editor.js';
import { pickFile } from '/assets/js/lib/image-io.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { parseJson } from '/assets/js/lib/codecs.js';

const CONTEXT = 3;          // unchanged lines kept around each change when collapsing
const MAX_ROWS = 20000;     // rows rendered (Copy/Download patch always cover everything)

const SAMPLES = {
  text: [
    'Fernhollow Garden Club\n\nMeetings are held every second Tuesday at 7 pm\nin the community hall on Willow Lane.\n\nBring your own gloves and a trowel.\nNew members are always welcome.\nQuestions? Ask Mara at the front desk.\n',
    'Fernhollow Garden Club\n\nMeetings are held every first Tuesday at 6:30 pm\nin the community hall on Willow Lane.\n\nBring your own gloves, a trowel and seeds to swap.\nNew members are always welcome.\nQuestions? Ask Mara or Theo at the front desk.\n',
  ],
  json: [
    '{\n  "name": "fernhollow-app",\n  "version": "1.4.0",\n  "private": true,\n  "scripts": { "start": "serve .", "test": "node test.js" },\n  "dependencies": { "marked": "^12.0.0", "dayjs": "^1.11.0" }\n}\n',
    '{\n  "version": "1.5.0",\n  "name": "fernhollow-app",\n  "scripts": { "test": "node --test", "start": "serve ." },\n  "dependencies": { "dayjs": "^1.11.10", "marked": "^12.0.0", "zod": "^3.23.0" },\n  "private": true\n}\n',
  ],
};

const opts = remember('diff', [{ title: '', controls: [
  { id: 'view', type: 'segmented', label: 'View', value: 'split', options: [['split', 'Side by side'], ['inline', 'Inline']] },
  { id: 'detail', type: 'segmented', label: 'Highlight', value: 'words', options: [['words', 'Words'], ['chars', 'Characters'], ['lines', 'Lines only']] },
  { id: 'mode', type: 'segmented', label: 'Compare as', value: 'text', options: [['text', 'Text'], ['json', 'JSON']], hint: '' },
  { id: 'ignoreWs', type: 'toggle', label: 'Ignore whitespace', value: false },
  { id: 'ignoreCase', type: 'toggle', label: 'Ignore case', value: false },
  { id: 'collapse', type: 'toggle', label: 'Hide unchanged lines', value: true },
  { id: 'swap', type: 'button', text: 'Swap sides', onClick: () => swap() },
]}]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st, id) => {
  opts.save(st);
  if (id === 'mode') onModeChange();
  else if (['view', 'collapse'].includes(id)) render();
  else run();
} });
const s = panel.state;

const $ = (id) => document.getElementById(id);
const savedA = rememberInput('diff:a', SAMPLES[s.mode][0]);
const savedB = rememberInput('diff:b', SAMPLES[s.mode][1]);
const names = { a: null, b: null }; // file names, for the patch header

const sides = {};
for (const [key, saved, label] of [['a', savedA, 'Original'], ['b', savedB, 'Changed']]) {
  const ed = createEditor($(`${key}-editor`), {
    value: saved.value, label, lang: s.mode === 'json' ? 'json' : null, placeholder: `Paste the ${label.toLowerCase()} text, or drop a file here`,
    onChange: (t) => { saved.save(t); names[key] = null; run(); },
  });
  const load = async (file) => {
    if (!file) return;
    try { ed.value = await readText(file); names[key] = file.name; saved.save(ed.value); run(); } catch (err) { toast(err.message, 'error'); }
  };
  dropFiles(ed.el, ([f]) => load(f));
  $(`${key}-actions`).append(
    actionButton('Open', 'upload', async () => load(await pickFile(''))),
    actionButton('Clear', 'trash', () => { ed.value = ''; saved.save(''); names[key] = null; run(); }));
  sides[key] = { ed, saved };
}

function swap() {
  const a = sides.a.ed.value;
  sides.a.ed.value = sides.b.ed.value;
  sides.b.ed.value = a;
  [names.a, names.b] = [names.b, names.a];
  sides.a.saved.save(sides.a.ed.value);
  sides.b.saved.save(sides.b.ed.value);
  run();
}

/** Switching Text ↔ JSON: swap the built-in samples if they're untouched, and set the editors' language. */
function onModeChange() {
  const other = s.mode === 'json' ? 'text' : 'json';
  ['a', 'b'].forEach((k, i) => {
    const { ed, saved } = sides[k];
    if (!ed.value.trim() || ed.value === SAMPLES[other][i]) { ed.value = SAMPLES[s.mode][i]; saved.save(ed.value); }
    ed.setLang(s.mode === 'json' ? 'json' : null);
  });
  run();
}

$('out-actions').append(
  copyButton(() => patchText(), 'Copy patch'),
  downloadButton(() => { const p = patchText(); return p ? { text: p, name: 'changes.patch', type: 'text/x-diff' } : null; }, 'Download .patch'));

/* ---------- Diff ---------- */
let Diff = null;
let result = null;   // { A, B, rows, added, removed } or { error }
const expanded = new Set();

const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

function sideStatus(key, msg) {
  const el = $(`${key}-status`);
  el.hidden = !msg;
  el.className = 'io-status is-error';
  el.innerHTML = msg ? icon('alert') : '';
  if (msg) el.append(msg);
}

const splitLines = (t) => { const l = t.split('\n'); if (l[l.length - 1] === '') l.pop(); return l; };

let runId = 0;
const run = debounce(async () => {
  const id = ++runId;
  let A = sides.a.ed.value;
  let B = sides.b.ed.value;
  let bad = false;
  if (s.mode === 'json') {
    for (const [k, t] of [['a', A], ['b', B]]) {
      try {
        const v = t.trim() ? sortKeys(parseJson(t)) : null;
        const out = v === null && !t.trim() ? '' : `${JSON.stringify(v, null, 2)}\n`;
        if (k === 'a') A = out; else B = out;
        sideStatus(k, '');
      } catch (err) { sideStatus(k, err.message); bad = true; }
    }
  } else { sideStatus('a', ''); sideStatus('b', ''); }
  if (bad) { result = { error: 'Fix the JSON errors above to compare.' }; return render(); }
  try { Diff ||= await loadLib('diff'); } catch (err) { result = { error: err.message }; return render(); }
  if (id !== runId) return;

  const norm = (x) => {
    let v = x.replace(/\r?\n$/, '');
    if (s.ignoreWs) v = v.replace(/\s+/g, ' ').trim();
    if (s.ignoreCase) v = v.toLowerCase();
    return v;
  };
  const changes = Diff.diffLines(A, B, { comparator: (l, r) => norm(l) === norm(r), timeout: 5000 });
  if (!changes) { result = { error: 'These texts are too different to compare quickly. Try smaller pieces.' }; return render(); }

  // Rebuild both sides from the original lines (equal blocks may differ in whitespace/case when those are ignored).
  const la = splitLines(A);
  const lb = splitLines(B);
  let ia = 0;
  let ib = 0;
  const rows = [];
  let added = 0;
  let removed = 0;
  for (let k = 0; k < changes.length; k++) {
    const c = changes[k];
    const n = c.count ?? splitLines(c.value).length;
    if (!c.added && !c.removed) {
      for (let j = 0; j < n; j++) rows.push({ type: 'eq', a: la[ia], b: lb[ib], na: ++ia, nb: ++ib });
      continue;
    }
    // Pair a removed block with the added block right after it, so changed lines sit side by side.
    let rem = 0;
    let add = 0;
    if (c.removed) { rem = n; const nx = changes[k + 1]; if (nx?.added) { add = nx.count ?? splitLines(nx.value).length; k++; } }
    else add = n;
    removed += rem;
    added += add;
    for (let j = 0; j < Math.max(rem, add); j++) {
      const hasA = j < rem;
      const hasB = j < add;
      rows.push({ type: hasA && hasB ? 'mod' : hasA ? 'del' : 'add', a: hasA ? la[ia] : null, b: hasB ? lb[ib] : null, na: hasA ? ++ia : null, nb: hasB ? ++ib : null });
    }
  }
  if (id !== runId) return;
  expanded.clear();
  result = { A, B, rows, added, removed };
  render();
}, 150);

/** Character/word segments for a changed pair: [{ text, kind: 'eq' | 'del' | 'add' }] for each side. */
function inlineParts(a, b) {
  if (s.detail === 'lines' || a.length + b.length > 4000) return [[{ text: a, kind: 'del' }], [{ text: b, kind: 'add' }]];
  const parts = s.detail === 'chars' ? Diff.diffChars(a, b, { ignoreCase: s.ignoreCase }) : Diff.diffWordsWithSpace(a, b, { ignoreCase: s.ignoreCase });
  const left = [];
  const right = [];
  for (const p of parts) {
    if (p.added) right.push({ text: p.value, kind: 'add' });
    else if (p.removed) left.push({ text: p.value, kind: 'del' });
    else { left.push({ text: p.value, kind: 'eq' }); right.push({ text: p.value, kind: 'eq' }); }
  }
  return [left, right];
}

/* ---------- Render ---------- */
const out = $('out');

function render() {
  const note = $('note');
  const stats = $('stats');
  if (!result || result.error) {
    stats.replaceChildren();
    note.hidden = true;
    out.replaceChildren(h('p', { class: 'io-error' }, result?.error || ''));
    return;
  }
  const { rows, added, removed } = result;
  stats.replaceChildren(h('span', { class: 'df-plus' }, `+${added}`), ' ', h('span', { class: 'df-minus' }, `−${removed}`));
  const ignoring = [s.ignoreWs && 'whitespace', s.ignoreCase && 'case'].filter(Boolean);
  note.hidden = !ignoring.length && s.mode !== 'json';
  note.textContent = [
    s.mode === 'json' && 'Both sides are formatted with sorted keys, so key order and spacing don’t count as changes.',
    ignoring.length && `Ignoring ${ignoring.join(' and ')} differences; the .patch still records them.`,
  ].filter(Boolean).join(' ');
  if (!added && !removed) {
    out.replaceChildren(h('p', { class: 'df-same' }, h('span', { html: icon('check') }), result.A || result.B
      ? (result.A === result.B ? 'The two texts are identical.' : 'No differences with the current options.') : 'Paste text on both sides to compare.'));
    return;
  }
  const blocks = collapse(rows);
  const split = s.view === 'split';
  const table = h('table', { class: `df-table ${split ? 'is-split' : 'is-inline'}` });
  const body = h('tbody');
  let count = 0;
  for (const b of blocks) {
    if (count > MAX_ROWS) { body.append(h('tr', {}, h('td', { colspan: 4, class: 'df-fold' }, `Stopped rendering after ${MAX_ROWS.toLocaleString()} rows. The .patch includes everything.`))); break; }
    if (b.fold) {
      const btn = h('button', { type: 'button', class: 'df-fold-btn', onclick: () => { expanded.add(b.key); render(); } }, `⋯ ${b.count} unchanged line${b.count === 1 ? '' : 's'}`);
      body.append(h('tr', { class: 'df-fold' }, h('td', { colspan: 4 }, btn)));
      continue;
    }
    for (const r of b.rows) { count++; body.append(...(split ? splitRow(r) : inlineRows(r))); }
  }
  table.append(split ? h('colgroup', {}, h('col', { class: 'df-col-n' }), h('col'), h('col', { class: 'df-col-n' }), h('col')) : h('colgroup', {}, h('col', { class: 'df-col-n' }), h('col', { class: 'df-col-n' }), h('col', { class: 'df-col-sign' }), h('col')), body);
  out.replaceChildren(table);
}

/** Group rows into visible runs and folded runs of unchanged lines (keeping CONTEXT lines around changes). */
function collapse(rows) {
  if (!s.collapse) return [{ rows }];
  const blocks = [];
  let i = 0;
  while (i < rows.length) {
    if (rows[i].type !== 'eq') { let j = i; while (j < rows.length && rows[j].type !== 'eq') j++; blocks.push({ rows: rows.slice(i, j) }); i = j; continue; }
    let j = i;
    while (j < rows.length && rows[j].type === 'eq') j++;
    const head = i === 0 ? 0 : CONTEXT;
    const tail = j === rows.length ? 0 : CONTEXT;
    const key = `${i}`;
    if (j - i > head + tail + 1 && !expanded.has(key)) {
      blocks.push({ rows: rows.slice(i, i + head) });
      blocks.push({ fold: true, count: j - i - head - tail, key });
      blocks.push({ rows: rows.slice(j - tail, j) });
    } else blocks.push({ rows: rows.slice(i, j) });
    i = j;
  }
  return blocks;
}

const cell = (parts, cls) => h('td', { class: `df-code ${cls}` }, parts.map((p) => (p.kind === 'eq' ? p.text : h('span', { class: `df-${p.kind}` }, p.text))), '​');
const num = (n) => h('td', { class: 'df-n' }, n ?? '');

function splitRow(r) {
  if (r.type === 'eq') return [h('tr', {}, num(r.na), cell([{ text: r.a, kind: 'eq' }], ''), num(r.nb), cell([{ text: r.b, kind: 'eq' }], ''))];
  if (r.type === 'mod') {
    const [l, rr] = inlineParts(r.a, r.b);
    return [h('tr', {}, num(r.na), cell(l, 'is-del'), num(r.nb), cell(rr, 'is-add'))];
  }
  return [h('tr', {},
    num(r.na), r.a == null ? h('td', { class: 'df-code is-empty' }) : cell([{ text: r.a, kind: 'eq' }], 'is-del'),
    num(r.nb), r.b == null ? h('td', { class: 'df-code is-empty' }) : cell([{ text: r.b, kind: 'eq' }], 'is-add'))];
}

function inlineRows(r) {
  const row = (na, nb, sign, parts, cls) => h('tr', { class: cls }, num(na), num(nb), h('td', { class: 'df-sign' }, sign), cell(parts, cls));
  if (r.type === 'eq') return [row(r.na, r.nb, '', [{ text: r.b, kind: 'eq' }], '')];
  if (r.type === 'mod') {
    const [l, rr] = inlineParts(r.a, r.b);
    return [row(r.na, null, '−', l, 'is-del'), row(null, r.nb, '+', rr, 'is-add')];
  }
  return r.type === 'del' ? [row(r.na, null, '−', [{ text: r.a, kind: 'eq' }], 'is-del')] : [row(null, r.nb, '+', [{ text: r.b, kind: 'eq' }], 'is-add')];
}

function patchText() {
  if (!result || result.error || !Diff || (!result.added && !result.removed && result.A === result.B)) return '';
  const ext = s.mode === 'json' ? '.json' : '.txt';
  return Diff.createTwoFilesPatch(`a/${names.a || `original${ext}`}`, `b/${names.b || `changed${ext}`}`, result.A, result.B, '', '', { context: CONTEXT });
}

run();
