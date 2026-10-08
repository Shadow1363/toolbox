/**
 * Field types for the schema builder. Each: label, group, ts/sql type, option specs and gen(f, row, o).
 * `row.person()` gives one first/last name per row, so name, email and username fields agree.
 * Everything goes through the seeded faker instance (no Date.now(), no Math.random), so a seed repeats exactly.
 */
const iso = (d) => d.toISOString();

export const TYPES = {
  id: { label: 'Row number', group: 'IDs', ts: 'number', sql: 'INTEGER', opts: [['start', 'Start', 1]], gen: (f, row, o) => row.index + (+o.start || 0) },
  uuid: { label: 'UUID', group: 'IDs', ts: 'string', sql: 'UUID', gen: (f) => f.string.uuid() },
  alnum: { label: 'Random code', group: 'IDs', ts: 'string', sql: 'VARCHAR(32)', opts: [['length', 'Length', 8]], gen: (f, r, o) => f.string.alphanumeric({ length: clamp(o.length, 1, 64, 8), casing: 'upper' }) },

  firstName: { label: 'First name', group: 'Person', ts: 'string', sql: 'VARCHAR(100)', gen: (f, r) => r.person().firstName },
  lastName: { label: 'Last name', group: 'Person', ts: 'string', sql: 'VARCHAR(100)', gen: (f, r) => r.person().lastName },
  fullName: { label: 'Full name', group: 'Person', ts: 'string', sql: 'VARCHAR(200)', gen: (f, r) => f.person.fullName(r.person()) },
  email: { label: 'Email', group: 'Person', ts: 'string', sql: 'VARCHAR(255)', gen: (f, r) => f.internet.exampleEmail(r.person()).toLowerCase() },
  username: { label: 'Username', group: 'Person', ts: 'string', sql: 'VARCHAR(50)', gen: (f, r) => f.internet.username(r.person()).toLowerCase() },
  phone: { label: 'Phone', group: 'Person', ts: 'string', sql: 'VARCHAR(40)', gen: (f) => f.phone.number() },
  jobTitle: { label: 'Job title', group: 'Person', ts: 'string', sql: 'VARCHAR(120)', gen: (f) => f.person.jobTitle() },
  birthdate: { label: 'Birth date', group: 'Person', ts: 'string', sql: 'DATE', opts: [['min', 'Min age', 18], ['max', 'Max age', 80]],
    gen: (f, r, o) => iso(f.date.birthdate({ mode: 'age', min: clamp(o.min, 0, 120, 18), max: clamp(o.max, 0, 120, 80), refDate: '2025-01-01T00:00:00Z' })).slice(0, 10) },

  street: { label: 'Street address', group: 'Address', ts: 'string', sql: 'VARCHAR(200)', gen: (f) => f.location.streetAddress() },
  city: { label: 'City', group: 'Address', ts: 'string', sql: 'VARCHAR(100)', gen: (f) => f.location.city() },
  state: { label: 'State / region', group: 'Address', ts: 'string', sql: 'VARCHAR(100)', gen: (f) => f.location.state() },
  zip: { label: 'Postal code', group: 'Address', ts: 'string', sql: 'VARCHAR(20)', gen: (f) => f.location.zipCode() },
  country: { label: 'Country', group: 'Address', ts: 'string', sql: 'VARCHAR(100)', gen: (f) => f.location.country() },
  countryCode: { label: 'Country code', group: 'Address', ts: 'string', sql: 'CHAR(2)', gen: (f) => f.location.countryCode() },
  address: { label: 'Full address', group: 'Address', ts: 'string', sql: 'VARCHAR(300)', gen: (f) => `${f.location.streetAddress()}, ${f.location.zipCode()} ${f.location.city()}` },
  latitude: { label: 'Latitude', group: 'Address', ts: 'number', sql: 'DECIMAL(9,6)', gen: (f) => f.location.latitude() },
  longitude: { label: 'Longitude', group: 'Address', ts: 'number', sql: 'DECIMAL(9,6)', gen: (f) => f.location.longitude() },

  company: { label: 'Company', group: 'Business', ts: 'string', sql: 'VARCHAR(200)', gen: (f) => f.company.name() },
  catchPhrase: { label: 'Catch phrase', group: 'Business', ts: 'string', sql: 'VARCHAR(255)', gen: (f) => f.company.catchPhrase() },
  product: { label: 'Product name', group: 'Business', ts: 'string', sql: 'VARCHAR(200)', gen: (f) => f.commerce.productName() },
  department: { label: 'Department', group: 'Business', ts: 'string', sql: 'VARCHAR(100)', gen: (f) => f.commerce.department() },
  price: { label: 'Price', group: 'Business', ts: 'number', sql: 'DECIMAL(10,2)', opts: [['min', 'Min', 1], ['max', 'Max', 500]], gen: (f, r, o) => +f.commerce.price({ min: num(o.min, 1), max: num(o.max, 500) }) },
  currency: { label: 'Currency code', group: 'Business', ts: 'string', sql: 'CHAR(3)', gen: (f) => f.finance.currencyCode() },

  url: { label: 'URL', group: 'Internet', ts: 'string', sql: 'VARCHAR(255)', gen: (f) => f.internet.url() },
  domain: { label: 'Domain', group: 'Internet', ts: 'string', sql: 'VARCHAR(255)', gen: (f) => f.internet.domainName() },
  ipv4: { label: 'IPv4 address', group: 'Internet', ts: 'string', sql: 'VARCHAR(15)', gen: (f) => f.internet.ipv4() },
  color: { label: 'Hex color', group: 'Internet', ts: 'string', sql: 'CHAR(7)', gen: (f) => f.color.rgb() },

  int: { label: 'Integer', group: 'Numbers & dates', ts: 'number', sql: 'INTEGER', opts: [['min', 'Min', 0], ['max', 'Max', 100]], gen: (f, r, o) => f.number.int(range(o, 0, 100)) },
  float: { label: 'Decimal', group: 'Numbers & dates', ts: 'number', sql: 'DECIMAL(12,4)', opts: [['min', 'Min', 0], ['max', 'Max', 1], ['decimals', 'Decimals', 2]],
    gen: (f, r, o) => f.number.float({ ...range(o, 0, 1), fractionDigits: clamp(o.decimals, 0, 8, 2) }) },
  boolean: { label: 'Boolean', group: 'Numbers & dates', ts: 'boolean', sql: 'BOOLEAN', opts: [['prob', 'True %', 50]], gen: (f, r, o) => f.datatype.boolean({ probability: clamp(o.prob, 0, 100, 50) / 100 }) },
  date: { label: 'Date', group: 'Numbers & dates', ts: 'string', sql: 'DATE', opts: [['from', 'From', '2020-01-01'], ['to', 'To', '2025-12-31'], ['format', 'Format', 'date', [['date', 'YYYY-MM-DD'], ['datetime', 'ISO date-time'], ['unix', 'Unix seconds']]]],
    gen: (f, r, o) => {
      const from = validDate(o.from, '2020-01-01');
      const to = validDate(o.to, '2025-12-31');
      const d = f.date.between({ from: from < to ? from : to, to: from < to ? to : from });
      return o.format === 'unix' ? Math.floor(d.getTime() / 1000) : o.format === 'datetime' ? iso(d) : iso(d).slice(0, 10);
    } },

  pick: { label: 'Pick from a list', group: 'Text', ts: 'string', sql: 'VARCHAR(100)', opts: [['list', 'Values (comma-separated)', 'active, paused, archived']],
    gen: (f, r, o) => f.helpers.arrayElement(String(o.list || '').split(',').map((x) => x.trim()).filter(Boolean).concat(String(o.list || '').trim() ? [] : [''])) },
  words: { label: 'Lorem words', group: 'Text', ts: 'string', sql: 'VARCHAR(255)', opts: [['count', 'Words', 3]], gen: (f, r, o) => f.lorem.words(clamp(o.count, 1, 50, 3)) },
  sentence: { label: 'Lorem sentence', group: 'Text', ts: 'string', sql: 'TEXT', gen: (f) => f.lorem.sentence() },
  paragraph: { label: 'Lorem paragraph', group: 'Text', ts: 'string', sql: 'TEXT', gen: (f) => f.lorem.paragraph() },
};

function clamp(v, lo, hi, dflt) {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
}
const num = (v, dflt) => (Number.isFinite(+v) && String(v).trim() !== '' ? +v : dflt);
function range(o, lo, hi) {
  const a = num(o.min, lo);
  const b = num(o.max, hi);
  return { min: Math.min(a, b), max: Math.max(a, b) };
}
const validDate = (s, dflt) => (Number.isNaN(Date.parse(s)) ? dflt : s);

export const DEFAULT_SCHEMA = [
  { name: 'id', type: 'id', opts: { start: 1 }, blank: 0 },
  { name: 'name', type: 'fullName', opts: {}, blank: 0 },
  { name: 'email', type: 'email', opts: {}, blank: 0 },
  { name: 'company', type: 'company', opts: {}, blank: 0 },
  { name: 'signed_up', type: 'date', opts: { from: '2023-01-01', to: '2025-12-31', format: 'date' }, blank: 0 },
  { name: 'plan', type: 'pick', opts: { list: 'free, pro, team' }, blank: 0 },
  { name: 'active', type: 'boolean', opts: { prob: 80 }, blank: 0 },
];

export const LOCALES = [
  ['en_US', 'English (US)'], ['en_GB', 'English (UK)'], ['en_AU', 'English (Australia)'], ['en_CA', 'English (Canada)'], ['en_IN', 'English (India)'],
  ['de', 'German'], ['fr', 'French'], ['es', 'Spanish'], ['es_MX', 'Spanish (Mexico)'], ['it', 'Italian'], ['pt_BR', 'Portuguese (Brazil)'], ['pt_PT', 'Portuguese (Portugal)'],
  ['nl', 'Dutch'], ['sv', 'Swedish'], ['nb_NO', 'Norwegian'], ['da', 'Danish'], ['fi', 'Finnish'], ['pl', 'Polish'], ['cs_CZ', 'Czech'], ['ro', 'Romanian'],
  ['tr', 'Turkish'], ['ru', 'Russian'], ['uk', 'Ukrainian'], ['el', 'Greek'], ['he', 'Hebrew'], ['ar', 'Arabic'], ['fa', 'Persian'],
  ['ja', 'Japanese'], ['ko', 'Korean'], ['zh_CN', 'Chinese (Simplified)'], ['zh_TW', 'Chinese (Traditional)'], ['vi', 'Vietnamese'], ['th', 'Thai'], ['id_ID', 'Indonesian'],
];
