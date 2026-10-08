/* Fake Data Generator: schema builder → seeded faker rows → JSON / CSV / SQL / TypeScript; plus lorem ipsum. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, store, formatBytes } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce } from '/assets/js/lib/text-tool.js';
import { LIBS } from '/assets/js/lib/cdn.js';
import { stringifyDelimited } from '/assets/js/lib/codecs.js';
import { TYPES, DEFAULT_SCHEMA, LOCALES } from './fields.js';

const MAX_ROWS = 10000;
const SHOW_CHARS = 1_000_000; // shown in the box; Copy/Download get everything
const FORMATS = [['json', 'JSON'], ['csv', 'CSV'], ['sql', 'SQL'], ['ts', 'TypeScript']];
const EXT = { json: 'json', csv: 'csv', sql: 'sql', ts: 'ts', lorem: 'txt', html: 'html' };

const opts = remember('fake-data', [
  { title: '', controls: [
    { id: 'mode', type: 'segmented', label: 'Generate', value: 'data', options: [['data', 'Data rows'], ['lorem', 'Lorem ipsum']] },
    { id: 'rows', type: 'number', label: 'Rows', min: 1, max: MAX_ROWS, value: 25, showIf: (st) => st.mode === 'data' },
    { id: 'format', type: 'segmented', label: 'Format', value: 'json', options: FORMATS, showIf: (st) => st.mode === 'data' },
    { id: 'locale', type: 'select', label: 'Locale', value: 'en_US', options: LOCALES },
    { id: 'seed', type: 'number', label: 'Seed', min: 0, max: 2147483647, value: 42, hint: 'Same seed, same data.' },
    { id: 'reseed', type: 'button', text: 'New seed', onClick: () => panel.set({ seed: crypto.getRandomValues(new Uint32Array(1))[0] >>> 1 }) },
  ]},
  { title: '', showIf: (st) => st.mode === 'data' && st.format === 'sql', controls: [
    { id: 'table', type: 'text', label: 'Table name', value: 'users' },
    { id: 'createTable', type: 'toggle', label: 'Include CREATE TABLE', value: false },
    { id: 'dialect', type: 'segmented', label: 'Quote names', value: 'ansi', options: [['ansi', '"double"'], ['mysql', '`backtick`']] },
  ]},
  { title: '', showIf: (st) => st.mode === 'data' && st.format === 'ts', controls: [
    { id: 'typeName', type: 'text', label: 'Type name', value: 'User' },
  ]},
  { title: '', showIf: (st) => st.mode === 'data' && st.format === 'json', controls: [
    { id: 'jsonStyle', type: 'segmented', label: 'JSON style', value: 'pretty', options: [['pretty', 'Pretty array'], ['compact', 'Compact'], ['ndjson', 'One per line (NDJSON)']] },
  ]},
]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st) => { opts.save(st); paintMode(); run(); } });
const s = panel.state;

const $ = (id) => document.getElementById(id);
const output = $('output');

/* ---------- Schema builder ---------- */
let schema = store.get('input:fake-data:schema', null);
if (!Array.isArray(schema) || !schema.every((f) => TYPES[f?.type])) schema = structuredClone(DEFAULT_SCHEMA);
const saveSchema = () => store.set('input:fake-data:schema', schema);

const typeSelect = (value) => {
  const groups = [...new Set(Object.values(TYPES).map((t) => t.group))];
  const sel = h('select', { 'aria-label': 'Field type' }, groups.map((g) => h('optgroup', { label: g },
    Object.entries(TYPES).filter(([, t]) => t.group === g).map(([id, t]) => h('option', { value: id }, t.label)))));
  sel.value = value;
  return sel;
};

function drawSchema() {
  const rows = schema.map((field, i) => {
    const t = TYPES[field.type];
    const name = h('input', { type: 'text', value: field.name, 'aria-label': 'Field name', spellcheck: 'false', class: 'mono' });
    name.addEventListener('input', () => { field.name = name.value; changed(); });
    const type = typeSelect(field.type);
    type.addEventListener('change', () => {
      field.type = type.value;
      field.opts = Object.fromEntries((TYPES[field.type].opts || []).map(([k, , d]) => [k, d]));
      if (!field.name || Object.keys(TYPES).includes(field.name)) field.name = type.value;
      changed(true);
    });
    const optEls = (t.opts || []).map(([k, label, dflt, choices]) => {
      if (field.opts[k] === undefined) field.opts[k] = dflt;
      const input = choices
        ? h('select', {}, choices.map(([v, l]) => h('option', { value: v }, l)))
        : h('input', { type: k === 'from' || k === 'to' ? 'date' : typeof dflt === 'number' ? 'number' : 'text', value: field.opts[k] });
      input.value = field.opts[k];
      input.addEventListener(choices ? 'change' : 'input', () => { field.opts[k] = input.value; changed(); });
      return h('label', { class: `fd-opt${k === 'list' ? ' is-wide' : ''}` }, h('span', {}, label), input);
    });
    const blank = h('input', { type: 'number', min: 0, max: 100, value: field.blank || 0, 'aria-label': 'Percent left empty (null)' });
    blank.addEventListener('input', () => { field.blank = Math.max(0, Math.min(100, +blank.value || 0)); changed(); });
    const move = (d) => { const j = i + d; if (j < 0 || j >= schema.length) return; [schema[i], schema[j]] = [schema[j], schema[i]]; changed(true); };
    return h('li', { class: 'fd-field' },
      h('div', { class: 'fd-main' }, name, type,
        h('div', { class: 'fd-btns' },
          h('button', { type: 'button', class: 'btn btn-ghost icon-btn', title: 'Move up', 'aria-label': 'Move up', disabled: i === 0 || null, html: icon('up'), onclick: () => move(-1) }),
          h('button', { type: 'button', class: 'btn btn-ghost icon-btn', title: 'Move down', 'aria-label': 'Move down', disabled: i === schema.length - 1 || null, html: icon('down'), onclick: () => move(1) }),
          h('button', { type: 'button', class: 'btn btn-ghost icon-btn', title: 'Remove field', 'aria-label': 'Remove field', disabled: schema.length === 1 || null, html: icon('trash'), onclick: () => { schema.splice(i, 1); changed(true); } }))),
      h('div', { class: 'fd-opts' }, optEls, h('label', { class: 'fd-opt' }, h('span', {}, 'Empty %'), blank)));
  });
  $('schema').replaceChildren(h('ol', { class: 'fd-list' }, rows),
    h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('plus')} Add field`, onclick: () => {
      schema.push({ name: `field_${schema.length + 1}`, type: 'words', opts: { count: 3 }, blank: 0 });
      changed(true);
    } }));
}
function changed(redraw = false) {
  saveSchema();
  if (redraw) drawSchema();
  run();
}
$('in-actions').append(actionButton('Reset', 'restart', () => { schema = structuredClone(DEFAULT_SCHEMA); changed(true); }));

/* ---------- Lorem options ---------- */
const lorem = createControls($('lorem'), remember('fake-data-lorem', [{ title: '', controls: [
  { id: 'unit', type: 'segmented', label: 'Unit', value: 'paragraphs', options: [['paragraphs', 'Paragraphs'], ['sentences', 'Sentences'], ['words', 'Words']] },
  { id: 'count', type: 'range', label: 'How many', min: 1, max: 50, value: 3 },
  { id: 'classic', type: 'toggle', label: 'Start with “Lorem ipsum dolor sit amet”', value: true },
  { id: 'html', type: 'toggle', label: 'Wrap paragraphs in <p> tags', value: false },
]}]).sections, { onChange: (st) => { store.set('opts:fake-data-lorem', st); run(); } });

function paintMode() {
  $('schema').hidden = s.mode !== 'data';
  $('lorem').hidden = s.mode !== 'lorem';
  $('in-title').textContent = s.mode === 'data' ? 'Fields' : 'Lorem ipsum';
  $('in-actions').hidden = s.mode !== 'data';
}

/* ---------- Faker (one module per locale, loaded on demand) ---------- */
const fakers = new Map();
function loadFaker(locale) {
  if (!fakers.has(locale)) {
    fakers.set(locale, import(/* webpackIgnore: true */ `${LIBS.faker.url}${locale}.js`).then((m) => m.faker).catch((err) => {
      fakers.delete(locale);
      console.error(err);
      throw new Error('Couldn’t load the fake data library. Check your connection or content blocker and try again.');
    }));
  }
  return fakers.get(locale);
}

/* ---------- Generate ---------- */
let result = { text: '', ext: 'json' };
$('out-actions').append(
  copyButton(() => result.text),
  downloadButton(() => (result.text ? { text: result.text, name: `${s.mode === 'lorem' ? 'lorem' : (s.table || 'data').replace(/\W+/g, '_')}.${result.ext}` } : null)));

function status(kind, text) {
  const el = $('status');
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'error' ? icon('alert') : kind === 'ok' ? icon('check') : '';
  el.append(text);
}

let runId = 0;
const run = debounce(async () => {
  const id = ++runId;
  let f;
  try {
    status('', 'Loading…');
    f = await loadFaker(s.locale);
  } catch (err) { status('error', err.message); return; }
  if (id !== runId) return;
  f.seed(Math.max(0, Math.floor(+s.seed || 0)));
  try {
    if (s.mode === 'lorem') {
      result = { text: makeLorem(f), ext: lorem.state.html ? 'html' : 'txt' };
      const words = result.text.split(/\s+/).filter(Boolean).length;
      show(`${words.toLocaleString()} words · ${formatBytes(new Blob([result.text]).size)}`);
      return;
    }
    const n = Math.max(1, Math.min(MAX_ROWS, Math.floor(+s.rows || 1)));
    const fields = schema.map((x, i) => ({ ...x, name: x.name.trim() || `field_${i + 1}` }));
    const dupes = fields.map((x) => x.name).filter((x, i, all) => all.indexOf(x) !== i);
    const rows = [];
    for (let r = 0; r < n; r++) {
      let person = null;
      const ctx = { index: r, person: () => (person ||= { firstName: f.person.firstName(), lastName: f.person.lastName() }) };
      const row = {};
      for (const fl of fields) {
        // Draw the empty-roll first so changing a field's Empty % doesn't reshuffle other columns' values.
        const empty = fl.blank > 0 && f.number.int({ min: 0, max: 99 }) < fl.blank;
        const v = TYPES[fl.type].gen(f, ctx, fl.opts || {});
        row[fl.name] = empty ? null : v;
      }
      rows.push(row);
    }
    result = { text: format(rows, fields), ext: EXT[s.format] };
    show(`${n.toLocaleString()} row${n === 1 ? '' : 's'} × ${fields.length} field${fields.length === 1 ? '' : 's'} · ${formatBytes(new Blob([result.text]).size)}${dupes.length ? ` · duplicate field name “${dupes[0]}” (later one wins)` : ''}`);
  } catch (err) {
    console.error(err);
    result = { text: '', ext: 'txt' };
    output.value = '';
    status('error', `Couldn’t generate: ${err.message}`);
  }
}, 200);

function show(info) {
  output.value = result.text.length > SHOW_CHARS ? `${result.text.slice(0, SHOW_CHARS)}\n… (truncated here; Copy and Download include everything)` : result.text;
  status('ok', info);
}

function makeLorem(f) {
  const { unit, count, classic, html } = lorem.state;
  const CLASSIC = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.';
  if (unit === 'words') {
    let words = f.lorem.words(count).split(' ');
    if (classic) words = ['lorem', 'ipsum', 'dolor', 'sit', 'amet', ...words].slice(0, Math.max(count, 1));
    const text = words.join(' ');
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}\n`;
  }
  if (unit === 'sentences') {
    const list = Array.from({ length: count }, () => f.lorem.sentence());
    if (classic) list[0] = CLASSIC;
    return `${list.join(' ')}\n`;
  }
  const paras = Array.from({ length: count }, () => f.lorem.paragraph(5));
  if (classic) paras[0] = `${CLASSIC} ${paras[0]}`;
  return `${html ? paras.map((p) => `<p>${p}</p>`).join('\n') : paras.join('\n\n')}\n`;
}

/* ---------- Output formats ---------- */
function format(rows, fields) {
  if (s.format === 'csv') return stringifyDelimited([fields.map((x) => x.name), ...rows.map((r) => fields.map((x) => r[x.name]))]);
  if (s.format === 'sql') return toSql(rows, fields);
  if (s.format === 'ts') return toTs(rows, fields);
  if (s.jsonStyle === 'ndjson') return `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
  return `${JSON.stringify(rows, null, s.jsonStyle === 'compact' ? 0 : 2)}\n`;
}

function toSql(rows, fields) {
  const q = s.dialect === 'mysql' ? '`' : '"';
  const ident = (name) => (/^[a-z_][a-z0-9_]*$/i.test(name) ? name : `${q}${name.replaceAll(q, q + q)}${q}`);
  const table = ident(s.table?.trim() || 'data');
  const val = (v) => (v === null || v === undefined ? 'NULL' : typeof v === 'boolean' ? (v ? 'TRUE' : 'FALSE') : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`);
  const cols = fields.map((x) => ident(x.name)).join(', ');
  const out = [];
  if (s.createTable) {
    out.push(`CREATE TABLE ${table} (\n${fields.map((x) => {
      const t = x.type === 'date' && x.opts?.format === 'datetime' ? 'TIMESTAMP' : x.type === 'date' && x.opts?.format === 'unix' ? 'BIGINT' : TYPES[x.type].sql;
      return `  ${ident(x.name)} ${t}${x.blank ? '' : ' NOT NULL'}${x.type === 'id' ? ' PRIMARY KEY' : ''}`;
    }).join(',\n')}\n);\n`);
  }
  // One INSERT per 500 rows keeps statements under common size limits.
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    out.push(`INSERT INTO ${table} (${cols}) VALUES\n${chunk.map((r) => `  (${fields.map((x) => val(r[x.name])).join(', ')})`).join(',\n')};\n`);
  }
  return out.join('\n');
}

function toTs(rows, fields) {
  const name = (s.typeName || 'Row').replace(/[^\w$]/g, '') || 'Row';
  const key = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));
  const tsType = (x) => (x.type === 'date' && x.opts?.format === 'unix' ? 'number' : TYPES[x.type].ts);
  const iface = `export interface ${name} {\n${fields.map((x) => `  ${key(x.name)}: ${tsType(x)}${x.blank ? ' | null' : ''};`).join('\n')}\n}\n`;
  const body = rows.map((r) => `  { ${fields.map((x) => `${key(x.name)}: ${JSON.stringify(r[x.name])}`).join(', ')} },`).join('\n');
  const varName = `${name.charAt(0).toLowerCase()}${name.slice(1)}s`;
  return `${iface}\nexport const ${varName}: ${name}[] = [\n${body}\n];\n`;
}

drawSchema();
paintMode();
run();
