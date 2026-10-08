/**
 * Data formats shared by the converters: CSV/TSV (built in), YAML, XML and TOML
 * (libraries loaded on first use through cdn.js). Parsers throw `CodecError` with a
 * readable message (and a line number when the library gives one).
 *
 *   const rows = parseDelimited(text);                 // string[][] (RFC 4180, auto delimiter)
 *   const data = rowsToObjects(rows, { infer: true }); // [{ name: 'Ada', age: 36 }, …]
 *   const { header, rows } = objectsToRows(data);      // back to a grid (nested keys → "a.b")
 *   const value = await parseYaml(text);  await stringifyYaml(value);
 */
import { loadLib } from './cdn.js';

export class CodecError extends Error {}

/* ---------- CSV / TSV ---------- */

/** Pick the delimiter that splits the first lines into the most consistent column counts. */
export function detectDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of [',', '\t', ';', '|']) {
    const counts = lines.map((l) => splitLine(l, d).length);
    if (!counts.length || counts[0] < 2) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 10 + counts[0];
    if (score > bestScore) { best = d; bestScore = score; }
  }
  return best;
}
const splitLine = (line, d) => {
  try { return parseDelimited(line, { delimiter: d })[0] || []; } catch { return [line]; } // a quoted field spanning lines
};

/** Parse CSV/TSV text (quoted fields, escaped quotes, newlines inside quotes) into rows. */
export function parseDelimited(text, { delimiter = 'auto' } = {}) {
  const d = delimiter === 'auto' ? detectDelimiter(text) : delimiter;
  const rows = [];
  let row = [], field = '', quoted = false, i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1; // byte-order mark
  for (; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (quoted) throw new CodecError('Unclosed quote: a field starts with " but never ends.');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0] !== '');
}

/** Rows → CSV/TSV text, quoting only fields that need it. */
export function stringifyDelimited(rows, delimiter = ',') {
  const needs = new RegExp(`["\\r\\n${delimiter === '\t' ? '\\t' : delimiter.replace(/[|\\]/g, '\\$&')}]|^\\s|\\s$`);
  const cell = (v) => {
    const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
    return needs.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(delimiter)).join('\n') + '\n';
}

/** "42" → 42, "true" → true, "" → null; anything ambiguous stays a string (e.g. "007", "1e5x"). */
export function inferValue(s) {
  const t = s.trim();
  if (t === '') return null;
  if (t === 'true' || t === 'false') return t === 'true';
  if (t === 'null') return null;
  if (/^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?$/.test(t) && Math.abs(+t) <= Number.MAX_SAFE_INTEGER) return +t;
  return s;
}

/** Grid → array of objects. header: first row names the columns; nest: "a.b" headers → { a: { b } }. */
export function rowsToObjects(rows, { header = true, infer = true, nest = false } = {}) {
  if (!rows.length) return [];
  const width = Math.max(...rows.map((r) => r.length));
  const names = header
    ? uniqueNames(Array.from({ length: width }, (_, i) => (rows[0][i] ?? '').trim() || `column${i + 1}`))
    : Array.from({ length: width }, (_, i) => `column${i + 1}`);
  return (header ? rows.slice(1) : rows).map((r) => {
    const o = {};
    names.forEach((n, i) => {
      const raw = r[i] ?? '';
      const v = infer ? inferValue(raw) : raw;
      if (nest && n.includes('.')) setPath(o, n.split('.'), v); else o[n] = v;
    });
    return o;
  });
}

function uniqueNames(names) {
  const seen = new Map();
  return names.map((n) => {
    const k = seen.get(n) || 0;
    seen.set(n, k + 1);
    return k ? `${n}_${k + 1}` : n;
  });
}
function setPath(o, path, v) {
  let cur = o;
  path.slice(0, -1).forEach((p) => { cur = cur[p] = cur[p] && typeof cur[p] === 'object' ? cur[p] : {}; });
  cur[path[path.length - 1]] = v;
}

/** Flatten nested objects to dotted keys; arrays and deeper structures become JSON text. */
export function flatten(value, prefix = '', out = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const keys = Object.keys(value);
    if (!keys.length && prefix) out[prefix] = '';
    for (const k of keys) flatten(value[k], prefix ? `${prefix}.${k}` : k, out);
  } else out[prefix || 'value'] = Array.isArray(value) ? JSON.stringify(value) : value;
  return out;
}

/**
 * The rows hidden in a document: { catalog: { book: [ … ] } } → the book list. Picks the
 * longest list of objects up to 3 levels down; null when there isn't one.
 */
export function findRecords(data, depth = 0) {
  if (Array.isArray(data)) return data.some((v) => v && typeof v === 'object' && !Array.isArray(v)) ? data : null;
  if (!data || typeof data !== 'object' || depth > 3) return null;
  let best = null;
  for (const v of Object.values(data)) {
    const r = findRecords(v, depth + 1);
    if (r && (!best || r.length > best.length)) best = r;
  }
  return best;
}

/** JSON data → { header, rows }. Accepts a list, an object wrapping a list of records, or one object (one row). */
export function objectsToRows(data) {
  if (data && typeof data === 'object' && !Array.isArray(data)) data = findRecords(data) || [data];
  if (!Array.isArray(data)) data = [data];
  const flat = data.map((v) => (v && typeof v === 'object' && !Array.isArray(v) ? flatten(v) : { value: Array.isArray(v) ? JSON.stringify(v) : v }));
  const header = [];
  const seen = new Set();
  flat.forEach((o) => Object.keys(o).forEach((k) => { if (!seen.has(k)) { seen.add(k); header.push(k); } }));
  return { header, rows: flat.map((o) => header.map((k) => (o[k] === undefined ? '' : o[k]))) };
}

/* ---------- JSON ---------- */
export function parseJson(text) {
  const src = text.replace(/^﻿/, '');
  try { return JSON.parse(src); } catch (err) {
    const at = jsonErrorAt(src);
    const where = at ? ` on line ${at.line}, column ${at.col}` : '';
    throw new CodecError(`Invalid JSON${where}: ${at?.msg || err.message.replace(/^JSON\.parse: /, '')}`);
  }
}

/**
 * Where JSON.parse fails, with a plain-English reason. Browsers no longer agree on (or always
 * include) a position in their messages, so this small scanner walks the grammar itself.
 */
export function jsonErrorAt(t) {
  let i = 0;
  const fail = (msg) => { throw { i, msg }; };
  const ws = () => { while (/\s/.test(t[i] || '')) i++; };
  const value = () => {
    ws();
    const c = t[i];
    if (c === '{') {
      i++; ws();
      if (t[i] === '}') { i++; return; }
      for (;;) {
        ws();
        if (t[i] !== '"') fail(t[i] === '}' ? 'trailing comma before }' : t[i] === "'" ? 'keys need double quotes, not single' : 'expected a "quoted" key');
        string(); ws();
        if (t[i] !== ':') fail('expected : after the key');
        i++; value(); ws();
        if (t[i] === ',') { i++; continue; }
        if (t[i] === '}') { i++; return; }
        fail('expected , or } (missing comma?)');
      }
    }
    if (c === '[') {
      i++; ws();
      if (t[i] === ']') { i++; return; }
      for (;;) {
        ws();
        if (t[i] === ']') fail('trailing comma before ]');
        value(); ws();
        if (t[i] === ',') { i++; continue; }
        if (t[i] === ']') { i++; return; }
        fail('expected , or ] (missing comma?)');
      }
    }
    if (c === '"') return string();
    if (c === "'") fail('strings need double quotes, not single');
    const m = /^-?(0|[1-9]\d*)(\.\d+)?([eE][+-]?\d+)?/.exec(t.slice(i));
    if (m && m[0]) { i += m[0].length; return; }
    for (const w of ['true', 'false', 'null']) if (t.startsWith(w, i)) { i += w.length; return; }
    fail(c == null ? 'unexpected end of input (something isn\'t closed)' : `unexpected “${c}”`);
  };
  const string = () => {
    i++;
    while (i < t.length && t[i] !== '"') {
      if (t[i] === '\\') { if (!/["\\/bfnrtu]/.test(t[i + 1] || '')) fail('invalid escape in a string'); i += 2; continue; }
      if (t[i] === '\n') fail('line break inside a string (use \\n)');
      i++;
    }
    if (t[i] !== '"') fail('unclosed string');
    i++;
  };
  try {
    value(); ws();
    if (i < t.length) fail('extra content after the end of the JSON');
    return null;
  } catch (e) {
    if (e?.i == null) return null;
    const before = t.slice(0, e.i).split('\n');
    return { line: before.length, col: before[before.length - 1].length + 1, msg: e.msg };
  }
}
export const stringifyJson = (v, indent = 2) => JSON.stringify(v, null, indent === 'tab' ? '\t' : +indent) + '\n';

/* ---------- YAML ---------- */
export async function parseYaml(text) {
  const yaml = await loadLib('yaml');
  try { return yaml.load(text); } catch (err) {
    throw new CodecError(`Invalid YAML${err.mark ? ` on line ${err.mark.line + 1}` : ''}: ${err.reason || err.message}`);
  }
}
export async function stringifyYaml(value, { indent = 2 } = {}) {
  const yaml = await loadLib('yaml');
  return yaml.dump(value, { indent: +indent || 2, lineWidth: -1, noRefs: true });
}

/* ---------- XML ---------- */
const ATTR = '@_';
export async function parseXml(text) {
  const { XMLParser, XMLValidator } = await loadLib('xml');
  const ok = XMLValidator.validate(text);
  if (ok !== true) throw new CodecError(`Invalid XML on line ${ok.err.line}: ${ok.err.msg}`);
  return new XMLParser({ ignoreAttributes: false, attributeNamePrefix: ATTR, parseTagValue: true, trimValues: true, ignoreDeclaration: true }).parse(text);
}
/** Value → XML. Wraps it in `root` unless it's already an object with a single key. */
export async function stringifyXml(value, { root = 'root', indent = 2 } = {}) {
  const { XMLBuilder } = await loadLib('xml');
  let doc = value;
  if (Array.isArray(value)) doc = { [root]: { item: value } };
  else if (!value || typeof value !== 'object' || Object.keys(value).length !== 1 || Array.isArray(Object.values(value)[0])) doc = { [root]: value };
  const xml = new XMLBuilder({
    ignoreAttributes: false, attributeNamePrefix: ATTR, format: true,
    indentBy: indent === 'tab' ? '\t' : ' '.repeat(+indent || 2), suppressEmptyNode: true,
  }).build(sanitizeXmlNames(doc));
  return `<?xml version="1.0" encoding="UTF-8"?>\n${xml}`;
}
/** XML element names can't start with a digit or contain spaces: "1st name" → "_1st_name". */
function sanitizeXmlNames(v) {
  if (Array.isArray(v)) return v.map(sanitizeXmlNames);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.entries(v).map(([k, x]) => [
    k.startsWith(ATTR) || k === '#text' ? k : k.replace(/[^\w.-]/g, '_').replace(/^(?=[\d.-])/, '_'), sanitizeXmlNames(x)]));
}

/* ---------- TOML ---------- */
export async function parseToml(text) {
  const toml = await loadLib('toml');
  try { return toml.parse(text); } catch (err) {
    throw new CodecError(`Invalid TOML${err.line ? ` on line ${err.line}` : ''}: ${String(err.message).split('\n')[0]}`);
  }
}
export async function stringifyToml(value) {
  const toml = await loadLib('toml');
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new CodecError('TOML needs an object at the top level (key = value pairs), not a list or a single value.');
  }
  try { return toml.stringify(dropNulls(value)); } catch (err) {
    throw new CodecError(`Can't write this as TOML: ${err.message}`);
  }
}
/** TOML has no null: drop those keys (and null array items). */
function dropNulls(v) {
  if (Array.isArray(v)) return v.filter((x) => x != null).map(dropNulls);
  if (v && typeof v === 'object' && !(v instanceof Date)) {
    return Object.fromEntries(Object.entries(v).filter(([, x]) => x != null).map(([k, x]) => [k, dropNulls(x)]));
  }
  return v;
}
