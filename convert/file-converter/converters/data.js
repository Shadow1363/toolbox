/**
 * Data and spreadsheets. JSON is the hub: CSV, TSV, YAML, XML and XLSX convert to and from it,
 * and JSON renders to Markdown and HTML tables (so CSV → PDF chains CSV → JSON → HTML → PDF).
 * CSV ↔ XLSX also have direct converters so spreadsheet values survive as-is.
 */
import { loadLib } from '/assets/js/lib/cdn.js';
import {
  parseDelimited, stringifyDelimited, rowsToObjects, objectsToRows, inferValue,
  parseJson, stringifyJson, parseYaml, stringifyYaml, parseXml, stringifyXml, CodecError,
} from '/assets/js/lib/codecs.js';
import { ConvertError, Item } from '../registry.js';
import { escapeHtml, htmlDocument } from './_util.js';

/* ----- options ----- */
const indent = { id: 'indent', type: 'segmented', label: 'Indent', value: '2', options: [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tab']] };
const header = { id: 'csvHeader', type: 'toggle', label: 'First row is the header', value: true };
const infer = { id: 'csvInfer', type: 'toggle', label: 'Detect numbers and true/false', value: true, hint: 'Off keeps every cell as text (keeps leading zeros like 007).' };
const nest = { id: 'csvNest', type: 'toggle', label: 'Nest dotted columns', value: false, hint: 'A column named "user.name" becomes { "user": { "name": … } }.' };
const inDelimiter = { id: 'delimiter', type: 'select', label: 'Input delimiter', value: 'auto', options: [['auto', 'Detect'], [',', 'Comma'], [';', 'Semicolon'], ['|', 'Pipe']] };
const outDelimiter = { id: 'outDelimiter', type: 'segmented', label: 'CSV separator', value: ',', options: [[',', 'Comma'], [';', 'Semicolon']], hint: 'Semicolon suits Excel in many European locales.' };
const xmlRoot = { id: 'xmlRoot', type: 'text', label: 'XML root element', value: 'root' };
const sheet = { id: 'sheet', type: 'segmented', label: 'Sheets', value: 'first', options: [['first', 'First sheet'], ['all', 'All sheets']] };
const XLSX_NOTE = 'Formulas become their calculated values; formatting, charts and merged cells are dropped.';

/** Run a codec, turning its errors into a ConvertError naming the file. */
async function safely(item, fn) {
  try { return await fn(); } catch (err) {
    if (err instanceof CodecError || err instanceof ConvertError) throw new ConvertError(`${item.name}: ${err.message}`);
    throw err;
  }
}
const readJson = async (item) => safely(item, async () => parseJson(await item.text()));
const readRows = async (item, o, d) => safely(item, async () => parseDelimited(await item.text(), { delimiter: d || o.delimiter || 'auto' }));
const yamlIndent = (o) => (o.indent === 'tab' ? 2 : +o.indent);

/* ----- tables ----- */
const cellText = (v) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
function markdownTable(data) {
  const { header: hd, rows } = objectsToRows(data);
  const esc = (v) => cellText(v).replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return [`| ${hd.map(esc).join(' | ')} |`, `| ${hd.map(() => '---').join(' | ')} |`, ...rows.map((r) => `| ${r.map(esc).join(' | ')} |`)].join('\n') + '\n';
}
function htmlTable(data) {
  const { header: hd, rows } = objectsToRows(data);
  const num = (v) => (typeof v === 'number' ? ' style="text-align:right"' : '');
  return `<table>\n<thead><tr>${hd.map((h) => `<th>${escapeHtml(h)}</th>`).join('')}</tr></thead>\n<tbody>\n${
    rows.map((r) => `<tr>${r.map((v) => `<td${num(v)}>${escapeHtml(cellText(v))}</td>`).join('')}</tr>`).join('\n')}\n</tbody>\n</table>`;
}

/* ----- spreadsheets ----- */
async function readWorkbook(item) {
  const XLSX = await loadLib('xlsx');
  try { return { XLSX, wb: XLSX.read(new Uint8Array(await item.arrayBuffer()), { type: 'array', cellDates: true }) }; } catch {
    throw new ConvertError(`${item.name} isn't a readable spreadsheet (it may be corrupt or password-protected).`);
  }
}
function writeWorkbook(XLSX, sheets) {
  const wb = XLSX.utils.book_new();
  for (const [name, aoa] of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), name.replace(/[[\]*?/\\:]/g, ' ').slice(0, 31) || 'Sheet1');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array', compression: true });
}
const toAoa = (data) => { const { header: hd, rows } = objectsToRows(data); return [hd, ...rows.map((r) => r.map((v) => (v === '' ? null : v)))]; };

export default [
  // Delimited ↔ JSON
  ...['csv', 'tsv'].map((from) => ({
    from, to: 'json', options: [header, infer, nest, ...(from === 'csv' ? [inDelimiter] : []), indent],
    async convert(item, o) {
      const rows = await readRows(item, o, from === 'tsv' ? '\t' : undefined);
      return item.as('json', stringifyJson(rowsToObjects(rows, { header: o.csvHeader, infer: o.csvInfer, nest: o.csvNest }), o.indent));
    },
  })),
  ...['csv', 'tsv'].map((to) => ({
    from: 'json', to, options: to === 'csv' ? [outDelimiter] : [],
    note: 'Uses the list of records inside the data (e.g. catalog → book); nested objects become dotted columns (user.name) and lists become JSON text in a cell.',
    async convert(item, o) {
      const { header: hd, rows } = objectsToRows(await readJson(item));
      return item.as(to, stringifyDelimited([hd, ...rows], to === 'tsv' ? '\t' : o.outDelimiter || ','));
    },
  })),
  { from: 'csv', to: 'tsv', options: [inDelimiter], async convert(item, o) { return item.as('tsv', stringifyDelimited(await readRows(item, o), '\t')); } },
  { from: 'tsv', to: 'csv', options: [outDelimiter], async convert(item, o) { return item.as('csv', stringifyDelimited(await readRows(item, o, '\t'), o.outDelimiter || ',')); } },

  // JSON ↔ YAML / XML
  { from: 'json', to: 'yaml', options: [indent], async convert(item, o) { return item.as('yaml', await stringifyYaml(await readJson(item), { indent: yamlIndent(o) })); } },
  { from: 'yaml', to: 'json', options: [indent], async convert(item, o) { return item.as('json', stringifyJson(await safely(item, async () => parseYaml(await item.text())) ?? null, o.indent)); } },
  {
    from: 'json', to: 'xml', options: [xmlRoot, indent],
    note: 'Keys that aren\'t valid XML names are adjusted (e.g. "1st" → "_1st"); keys starting with @_ become attributes.',
    async convert(item, o) { return item.as('xml', await safely(item, async () => stringifyXml(await readJson(item), { root: o.xmlRoot || 'root', indent: o.indent }))); },
  },
  {
    from: 'xml', to: 'json', options: [indent],
    note: 'Attributes become keys starting with @_; repeated elements become lists.',
    async convert(item, o) { return item.as('json', stringifyJson(await safely(item, async () => parseXml(await item.text())), o.indent)); },
  },

  // Spreadsheets
  {
    from: 'xlsx', to: 'json', options: [sheet, indent], note: XLSX_NOTE,
    async convert(item, o) {
      const { XLSX, wb } = await readWorkbook(item);
      const read = (name) => XLSX.utils.sheet_to_json(wb.Sheets[name], { defval: null, raw: true });
      const data = o.sheet === 'all' ? Object.fromEntries(wb.SheetNames.map((n) => [n, read(n)])) : read(wb.SheetNames[0]);
      return item.as('json', stringifyJson(data, o.indent));
    },
  },
  {
    from: 'json', to: 'xlsx',
    note: 'An object of lists ({ "Sheet A": [...], "Sheet B": [...] }) becomes one sheet per key.',
    async convert(item) {
      const data = await readJson(item);
      const XLSX = await loadLib('xlsx');
      const multi = data && typeof data === 'object' && !Array.isArray(data) && Object.keys(data).length > 1 && Object.values(data).every(Array.isArray);
      return item.as('xlsx', writeWorkbook(XLSX, multi ? Object.entries(data).map(([k, v]) => [k, toAoa(v)]) : [['Sheet1', toAoa(data)]]));
    },
  },
  {
    from: 'xlsx', to: 'csv', options: [sheet, outDelimiter], note: XLSX_NOTE, final: true,
    async convert(item, o) {
      const { XLSX, wb } = await readWorkbook(item);
      const names = o.sheet === 'all' ? wb.SheetNames : wb.SheetNames.slice(0, 1);
      const out = names.map((n) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[n], { FS: o.outDelimiter || ',', blankrows: false });
        const name = names.length > 1 ? item.name.replace(/\.\w+$/, `-${n.replace(/[^\w-]+/g, '_')}.csv`) : item.name.replace(/\.\w+$/, '.csv');
        return Item.text(csv, name, 'csv');
      });
      return out.length === 1 ? out[0] : out;
    },
  },
  {
    from: 'csv', to: 'xlsx', options: [inDelimiter, infer],
    async convert(item, o) {
      const rows = await readRows(item, o);
      const XLSX = await loadLib('xlsx');
      return item.as('xlsx', writeWorkbook(XLSX, [['Sheet1', rows.map((r) => r.map((v) => (o.csvInfer ? inferValue(v) : v)))]]));
    },
  },

  // Tables
  { from: 'json', to: 'md', async convert(item) { return item.as('md', markdownTable(await readJson(item))); } },
  {
    from: 'json', to: 'html',
    async convert(item) { return item.as('html', htmlDocument(htmlTable(await readJson(item)), item.name.replace(/\.\w+$/, ''))); },
  },
];
