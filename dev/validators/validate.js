/*
 * Pure validators (no DOM, no network), so they can be tested in Node.
 *   cpf(text)    → { ok, value, reason?, fields: [[label, value]…] }
 *   cnpj(text)   → same; accepts the alphanumeric CNPJ (Receita Federal, from July 2026)
 *   cep(text)    → same; the state comes from the Correios range table, not a lookup
 *   postal(text, country)  → same; country 'ANY' lists every format that matches
 *   randomCpf(), randomCnpj(alnum)   valid test numbers (crypto random)
 */

const onlyDigits = (s) => s.replace(/\D/g, '');
const rand = (n) => crypto.getRandomValues(new Uint32Array(1))[0] % n; // a tiny bias is fine for test data

/* ---------- CPF ---------- */
// The 9th digit is the fiscal region that issued it.
const CPF_REGION = ['RS', 'DF, GO, MS, MT, TO', 'AC, AM, AP, PA, RO, RR', 'CE, MA, PI', 'AL, PB, PE, RN', 'BA, SE', 'MG', 'ES, RJ', 'SP', 'PR, SC'];

function cpfDigits(base) {
  const dv = (len) => {
    let sum = 0;
    for (let i = 0; i < len; i++) sum += base[i] * (len + 1 - i);
    const r = sum % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(9);
  base[9] = d1;
  return [d1, dv(10)];
}

const fmtCpf = (d) => `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;

export function cpf(text) {
  const value = text.trim();
  if (/[a-z]/i.test(value)) return { ok: false, value, reason: 'A CPF has only digits.', fields: [] };
  const d = onlyDigits(value);
  if (d.length !== 11) return { ok: false, value, reason: `Has ${d.length} digit${d.length === 1 ? '' : 's'}; a CPF has 11.`, fields: [] };
  const fields = [['Formatted', fmtCpf(d)], ['Digits only', d]];
  if (/^(\d)\1{10}$/.test(d)) return { ok: false, value, reason: 'All digits are the same. The check digits match, but the Receita Federal never issues these.', fields };
  const [a, b] = cpfDigits(d.slice(0, 9).split('').map(Number));
  fields.push(['Issued in', CPF_REGION[+d[8]]]);
  if (`${a}${b}` !== d.slice(9)) return { ok: false, value, reason: `Wrong check digits: expected ${a}${b}, found ${d.slice(9)}.`, fields };
  return { ok: true, value, fields };
}

export function randomCpf() {
  let base;
  do base = Array.from({ length: 9 }, () => rand(10)); while (base.every((n) => n === base[0]));
  const [a, b] = cpfDigits(base.slice());
  return fmtCpf(`${base.join('')}${a}${b}`);
}

/* ---------- CNPJ ---------- */
// From July 2026 the first 12 characters may be letters; each counts as its char code minus 48 (A = 17).
const W1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const W2 = [6, ...W1];
const cnpjVal = (c) => c.charCodeAt(0) - 48;

function cnpjDigits(base) {
  const dv = (chars, w) => {
    const r = chars.reduce((s, c, i) => s + cnpjVal(c) * w[i], 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const chars = base.split('');
  const d1 = dv(chars, W1);
  return [d1, dv([...chars, String(d1)], W2)];
}

const fmtCnpj = (c) => `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;

export function cnpj(text) {
  const value = text.trim();
  const c = value.toUpperCase().replace(/[\s./\-]/g, '');
  if (/[^0-9A-Z]/.test(c)) return { ok: false, value, reason: 'Only digits, letters and the separators . / - are allowed.', fields: [] };
  if (c.length !== 14) return { ok: false, value, reason: `Has ${c.length} character${c.length === 1 ? '' : 's'}; a CNPJ has 14.`, fields: [] };
  if (!/^\d{2}$/.test(c.slice(12))) return { ok: false, value, reason: 'The last two characters (check digits) must be numbers.', fields: [] };
  const alnum = /[A-Z]/.test(c);
  const order = c.slice(8, 12);
  const fields = [
    ['Formatted', fmtCnpj(c)],
    ['Compact', c],
    ['Kind', alnum ? 'Alphanumeric (issued from July 2026)' : 'Numeric'],
    ['Root (company)', c.slice(0, 8)],
    ['Establishment', order === '0001' ? '0001 · head office (matriz)' : `${order} · branch (filial)`],
  ];
  if (/^(\d)\1{13}$/.test(c)) return { ok: false, value, reason: 'All digits are the same; this is not a real CNPJ.', fields };
  const [a, b] = cnpjDigits(c.slice(0, 12));
  if (`${a}${b}` !== c.slice(12)) return { ok: false, value, reason: `Wrong check digits: expected ${a}${b}, found ${c.slice(12)}.`, fields };
  return { ok: true, value, fields };
}

export function randomCnpj(alnum = false) {
  const pool = alnum ? '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ' : '0123456789';
  const root = Array.from({ length: 8 }, () => pool[rand(pool.length)]).join('');
  const branch = rand(4) ? '0001' : String(rand(9998) + 2).padStart(4, '0');
  const base = root + branch;
  const [a, b] = cnpjDigits(base);
  return fmtCnpj(`${base}${a}${b}`);
}

/* ---------- CEP ---------- */
// Correios ranges by state (first five digits, inclusive).
const CEP_RANGES = [
  [1000, 19999, 'SP', 'São Paulo'], [20000, 28999, 'RJ', 'Rio de Janeiro'], [29000, 29999, 'ES', 'Espírito Santo'],
  [30000, 39999, 'MG', 'Minas Gerais'], [40000, 48999, 'BA', 'Bahia'], [49000, 49999, 'SE', 'Sergipe'],
  [50000, 56999, 'PE', 'Pernambuco'], [57000, 57999, 'AL', 'Alagoas'], [58000, 58999, 'PB', 'Paraíba'],
  [59000, 59999, 'RN', 'Rio Grande do Norte'], [60000, 63999, 'CE', 'Ceará'], [64000, 64999, 'PI', 'Piauí'],
  [65000, 65999, 'MA', 'Maranhão'], [66000, 68899, 'PA', 'Pará'], [68900, 68999, 'AP', 'Amapá'],
  [69000, 69299, 'AM', 'Amazonas'], [69300, 69399, 'RR', 'Roraima'], [69400, 69899, 'AM', 'Amazonas'],
  [69900, 69999, 'AC', 'Acre'], [70000, 72799, 'DF', 'Distrito Federal'], [72800, 72999, 'GO', 'Goiás'],
  [73000, 73699, 'DF', 'Distrito Federal'], [73700, 76799, 'GO', 'Goiás'], [76800, 76999, 'RO', 'Rondônia'],
  [77000, 77999, 'TO', 'Tocantins'], [78000, 78899, 'MT', 'Mato Grosso'], [79000, 79999, 'MS', 'Mato Grosso do Sul'],
  [80000, 87999, 'PR', 'Paraná'], [88000, 89999, 'SC', 'Santa Catarina'], [90000, 99999, 'RS', 'Rio Grande do Sul'],
];

export function cepState(d) {
  const n = +d.slice(0, 5);
  const r = CEP_RANGES.find(([a, b]) => n >= a && n <= b);
  return r ? { uf: r[2], name: r[3] } : null;
}

export function cep(text) {
  const value = text.trim();
  if (/[a-z]/i.test(value)) return { ok: false, value, reason: 'A CEP has only digits.', fields: [] };
  const d = onlyDigits(value);
  if (d.length !== 8) return { ok: false, value, reason: `Has ${d.length} digit${d.length === 1 ? '' : 's'}; a CEP has 8.`, fields: [] };
  const fields = [['Formatted', `${d.slice(0, 5)}-${d.slice(5)}`], ['Digits only', d]];
  const st = cepState(d);
  if (!st) return { ok: false, value, reason: 'No state uses CEPs starting with 00.', fields };
  fields.push(['State (by range)', `${st.name} (${st.uf})`]);
  return { ok: true, value, digits: d, uf: st.uf, fields };
}

/* ---------- Postal codes ---------- */
// Matched against the compact form (uppercase, no spaces or dashes); `f` turns it back into the usual spelling.
// `zip(compact)` is the code Zippopotam.us expects (countries without it have no lookup); BR uses ViaCEP.
const split = (...at) => (c) => { let out = '', i = 0; for (const [n, sep] of at) { out += c.slice(i, i + n) + sep; i += n; } return out + c.slice(i); };
const sp = (n) => split([n, ' ']);
const dash = (n) => split([n, '-']);
const tail3 = (c) => `${c.slice(0, -3)} ${c.slice(-3)}`;

export const POSTAL = {
  US: { re: /^\d{5}(\d{4})?$/, f: (c) => (c.length > 5 ? dash(5)(c) : c), ex: '90210, 90210-1234', zip: (c) => c.slice(0, 5) },
  CA: { re: /^[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z]\d[ABCEGHJ-NPRSTV-Z]\d$/, f: sp(3), ex: 'K1A 0B1', zip: (c) => c.slice(0, 3) },
  GB: { re: /^(GIR0AA|[A-PR-UWYZ]([0-9]{1,2}|[A-HK-Y][0-9]{1,2}|[0-9][A-HJKPS-UW]|[A-HK-Y][0-9][ABEHMNPRV-Y])[0-9][ABD-HJLNP-UW-Z]{2})$/, f: tail3, ex: 'SW1A 1AA', zip: (c) => c.slice(0, -3) },
  IE: { re: /^([AC-FHKNPRTV-Y]\d{2}|D6W)[0-9AC-FHKNPRTV-Y]{4}$/, f: sp(3), ex: 'D02 X285 (Eircode)' },
  BR: { re: /^\d{8}$/, f: dash(5), ex: '01001-000 (looked up on ViaCEP)', viacep: true },
  MX: { re: /^\d{5}$/, ex: '06600', zip: (c) => c },
  AR: { re: /^([A-HJ-NP-Z]\d{4}[A-Z]{3}|\d{4})$/, ex: 'C1425DKF, 1425' },
  CL: { re: /^\d{7}$/, ex: '8320000' },
  CO: { re: /^\d{6}$/, ex: '110111' },
  PE: { re: /^\d{5}$/, ex: '15001' },
  UY: { re: /^\d{5}$/, ex: '11000' },
  PY: { re: /^\d{4}$/, ex: '1209' },
  DE: { re: /^\d{5}$/, ex: '10115', zip: (c) => c },
  FR: { re: /^\d{5}$/, ex: '75008', zip: (c) => c },
  IT: { re: /^\d{5}$/, ex: '00184', zip: (c) => c },
  ES: { re: /^(0[1-9]|[1-4]\d|5[0-2])\d{3}$/, ex: '28013', zip: (c) => c },
  PT: { re: /^\d{7}$/, f: dash(4), ex: '1000-001', zip: dash(4) },
  NL: { re: /^[1-9]\d{3}(?!SA|SD|SS)[A-Z]{2}$/, f: sp(4), ex: '1012 AB', zip: (c) => c.slice(0, 4) },
  BE: { re: /^[1-9]\d{3}$/, ex: '1000', zip: (c) => c },
  LU: { re: /^\d{4}$/, ex: '1009 (or L-1009)', zip: (c) => `L-${c}` },
  CH: { re: /^[1-9]\d{3}$/, ex: '8001', zip: (c) => c },
  AT: { re: /^[1-9]\d{3}$/, ex: '1010', zip: (c) => c },
  DK: { re: /^\d{4}$/, ex: '1050', zip: (c) => c },
  NO: { re: /^\d{4}$/, ex: '0150', zip: (c) => c },
  SE: { re: /^[1-9]\d{4}$/, f: sp(3), ex: '111 22', zip: (c) => c },
  FI: { re: /^\d{5}$/, ex: '00100', zip: (c) => c },
  IS: { re: /^\d{3}$/, ex: '101', zip: (c) => c },
  PL: { re: /^\d{5}$/, f: dash(2), ex: '00-950', zip: dash(2) },
  CZ: { re: /^[1-7]\d{4}$/, f: sp(3), ex: '110 00', zip: sp(3) },
  SK: { re: /^[089]\d{4}$/, f: sp(3), ex: '811 01' },
  HU: { re: /^[1-9]\d{3}$/, ex: '1051', zip: (c) => c },
  RO: { re: /^\d{6}$/, ex: '010011' },
  GR: { re: /^\d{5}$/, f: sp(3), ex: '105 57' },
  HR: { re: /^[1-5]\d{4}$/, ex: '10000', zip: (c) => c },
  SI: { re: /^[1-9]\d{3}$/, ex: '1000', zip: (c) => c },
  BG: { re: /^\d{4}$/, ex: '1000', zip: (c) => c },
  LT: { re: /^\d{5}$/, ex: 'LT-01100' },
  UA: { re: /^\d{5}$/, ex: '01001' },
  RU: { re: /^\d{6}$/, ex: '101000', zip: (c) => c },
  TR: { re: /^(0[1-9]|[1-7]\d|8[01])\d{3}$/, ex: '34000', zip: (c) => c },
  IL: { re: /^\d{7}$/, ex: '6100000' },
  IN: { re: /^[1-9]\d{5}$/, ex: '110001', zip: (c) => c },
  PK: { re: /^\d{5}$/, ex: '44000', zip: (c) => c },
  CN: { re: /^\d{6}$/, ex: '100000' },
  JP: { re: /^\d{7}$/, f: dash(3), ex: '100-0001', zip: dash(3) },
  KR: { re: /^\d{5}$/, ex: '03187' },
  TH: { re: /^[1-9]\d{4}$/, ex: '10200', zip: (c) => c },
  VN: { re: /^\d{6}$/, ex: '100000' },
  MY: { re: /^\d{5}$/, ex: '50050', zip: (c) => c },
  ID: { re: /^[1-9]\d{4}$/, ex: '10110' },
  PH: { re: /^\d{4}$/, ex: '1000', zip: (c) => c },
  SG: { re: /^\d{6}$/, ex: '018956' },
  AU: { re: /^\d{4}$/, ex: '2000', zip: (c) => c },
  NZ: { re: /^\d{4}$/, ex: '6011', zip: (c) => c },
  ZA: { re: /^\d{4}$/, ex: '8001', zip: (c) => c },
};

const PREFIX = /^(L|LT|LV|CH|D|F|A|B|NL|PL|SE|S|DK|N|FI|FIN)-/; // "L-1009", "D-10115": old European country prefixes
export const compactPostal = (text) => text.trim().toUpperCase().replace(PREFIX, '').replace(/[\s\-.]/g, '');

export function postal(text, country, regionName = (c) => c) {
  const value = text.trim();
  const c = compactPostal(value);
  if (!c) return { ok: false, value, reason: 'Empty.', fields: [] };
  if (country === 'ANY') {
    const hits = Object.entries(POSTAL).filter(([, p]) => p.re.test(c));
    if (!hits.length) return { ok: false, value, reason: 'Doesn’t match the format of any country in the list.', fields: [] };
    const groups = new Map(); // formatted → [countries]
    for (const [cc, p] of hits) {
      const f = p.f ? p.f(c) : c;
      groups.set(f, [...(groups.get(f) || []), regionName(cc)]);
    }
    return { ok: true, value, fields: [...groups].map(([f, list]) => [f, list.join(', ')]), matches: hits.map(([cc]) => cc) };
  }
  const p = POSTAL[country];
  if (!p) return { ok: false, value, reason: 'Unknown country.', fields: [] };
  if (!p.re.test(c)) return { ok: false, value, reason: `Not a ${regionName(country)} postal code. Expected something like ${p.ex}.`, fields: [] };
  return { ok: true, value, fields: [['Formatted', p.f ? p.f(c) : c]], compact: c };
}
