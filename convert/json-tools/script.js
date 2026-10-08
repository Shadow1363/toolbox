/* JSON tools: format / minify / validate, convert JSON ↔ YAML ↔ TOML ↔ XML, and JSON → TypeScript types. */
import { createControls } from '/assets/js/lib/controls.js';
import { icon } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce, readText } from '/assets/js/lib/text-tool.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import {
  parseJson, stringifyJson, parseYaml, stringifyYaml, parseToml, stringifyToml, parseXml, stringifyXml,
} from '/assets/js/lib/codecs.js';
import { toTypeScript } from './ts-types.js';

const input = document.getElementById('input');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');

const ACTIONS = [['format', 'Format'], ['minify', 'Minify'], ['yaml', 'YAML'], ['toml', 'TOML'], ['xml', 'XML'], ['ts', 'TypeScript']];
const EXT = { format: 'json', minify: 'json', yaml: 'yaml', toml: 'toml', xml: 'xml', ts: 'ts' };
const opts = remember('json-tools', [{ title: '', controls: [
  { id: 'from', type: 'select', label: 'Input', value: 'auto', options: [['auto', 'Detect'], ['json', 'JSON'], ['yaml', 'YAML'], ['toml', 'TOML'], ['xml', 'XML']] },
  { id: 'action', type: 'segmented', label: 'Output', value: 'format', options: ACTIONS },
  { id: 'indent', type: 'segmented', label: 'Indent', value: '2', options: [['2', '2'], ['4', '4'], ['tab', 'Tab']], showIf: (s) => !['minify', 'toml'].includes(s.action) },
  { id: 'sortKeys', type: 'toggle', label: 'Sort keys', value: false, showIf: (s) => s.action !== 'ts' },
  { id: 'xmlRoot', type: 'text', label: 'Root element', value: 'root', showIf: (s) => s.action === 'xml' },
  { id: 'tsRoot', type: 'text', label: 'Root type name', value: 'Root', showIf: (s) => s.action === 'ts' },
]}]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st) => { opts.save(st); run(); } });
const s = panel.state;

input.placeholder = 'Paste JSON, YAML, TOML or XML…';
input.value = '{\n  "name": "Fern",\n  "tags": ["plant", "green"],\n  "sizes": [{ "cm": 30 }, { "cm": 45, "pot": true }]\n}';
document.getElementById('in-actions').append(
  actionButton('Open', 'upload', () => picker.open()),
  actionButton('Clear', 'trash', () => { input.value = ''; run(); }));
document.getElementById('out-actions').append(
  copyButton(() => output.value),
  downloadButton(() => (output.value ? { text: output.value, name: `data.${EXT[s.action]}` } : null)));
const pickerHost = document.body.appendChild(Object.assign(document.createElement('div'), { hidden: true }));
const picker = createFilePicker(pickerHost, { accept: '.json,.yaml,.yml,.toml,.xml,.txt', onFiles: async ([f]) => {
  try { input.value = await readText(f); run(); } catch (err) { status(err.message, 'error'); }
} });
input.addEventListener('input', debounce(run, 150));

/** Guess the input language: JSON if it parses, XML if it starts with "<", TOML if it has key = value or [table] lines. */
function guess(text) {
  const t = text.trim();
  try { JSON.parse(t); return 'json'; } catch { /* not JSON */ }
  if (t.startsWith('<')) return 'xml';
  if (/^\s*\[[^\]\n]+\]\s*$/m.test(t) || /^\s*[\w"'.-]+\s*=\s*\S/m.test(t)) return 'toml';
  if (/^[[{]/.test(t)) return 'json'; // looks like JSON but doesn't parse: report the JSON error
  return 'yaml';
}
const PARSE = { json: async (t) => parseJson(t), yaml: parseYaml, toml: parseToml, xml: parseXml };
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' && !(v instanceof Date) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);

function describe(v) {
  const depth = (x) => (x && typeof x === 'object' ? 1 + Math.max(0, ...Object.values(x).map(depth)) : 0);
  const what = Array.isArray(v) ? `list of ${v.length}` : v && typeof v === 'object' ? `object with ${Object.keys(v).length} key${Object.keys(v).length === 1 ? '' : 's'}` : typeof v;
  return `${what}, ${depth(v)} level${depth(v) === 1 ? '' : 's'} deep`;
}

let runId = 0;
async function run() {
  const id = ++runId;
  if (!input.value.trim()) { output.value = ''; status(''); return; }
  const from = s.from === 'auto' ? guess(input.value) : s.from;
  try {
    let value = await PARSE[from](input.value);
    if (value === undefined) value = null;
    if (s.sortKeys && s.action !== 'ts') value = sortKeys(value);
    const ind = s.indent;
    const out = {
      format: () => stringifyJson(value, ind),
      minify: () => `${JSON.stringify(value)}\n`,
      yaml: () => stringifyYaml(value, { indent: ind === 'tab' ? 2 : +ind }),
      toml: () => stringifyToml(value),
      xml: () => stringifyXml(value, { root: s.xmlRoot || 'root', indent: ind }),
      ts: () => toTypeScript(value, s.tsRoot || 'Root'),
    }[s.action];
    const text = await out();
    if (id !== runId) return;
    output.value = text;
    status(`Valid ${from.toUpperCase()}${s.from === 'auto' ? ' (detected)' : ''} · ${describe(value)}`, 'ok');
  } catch (err) {
    if (id !== runId) return;
    output.value = '';
    status(err.message, 'error');
  }
}

function status(text, kind = '') {
  statusEl.className = `io-status${kind ? ` is-${kind}` : ''}`;
  statusEl.innerHTML = text ? (kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '') : '';
  if (text) statusEl.append(text);
}

run();
