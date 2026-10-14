/*
 * CPF, CNPJ, CEP, postal code & phone validator. Checks run on the device (validate.js, libphonenumber-js);
 * the only network requests are the optional address lookups: ViaCEP for CEPs, Zippopotam.us for postal codes.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, store, toast } from '/assets/js/lib/dom.js';
import { remember, rememberInput, copyText, downloadButton, actionButton, debounce } from '/assets/js/lib/text-tool.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { cpf, cnpj, cep, postal, POSTAL, compactPostal, randomCpf, randomCnpj } from './validate.js';

const MAX_LINES = 5000;
const SHOW = 300;        // cards drawn; Copy and Download include every line
const MAX_LOOKUPS = 50;  // per run, so a pasted list doesn't flood the free APIs
const $ = (id) => document.getElementById(id);

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
const regionName = (cc) => { try { return regionNames.of(cc); } catch { return cc; } };
const flag = (cc) => (/^[A-Z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc].map((c) => 0x1f1a5 + c.charCodeAt(0))) : '');
const browserRegion = (() => { try { return new Intl.Locale(navigator.language).maximize().region || 'US'; } catch { return 'US'; } })();

/* ---------- Lookups (cached per page) ---------- */
const cache = new Map(); // key → { pending } | { fields, warn? } | { error }
let started = 0;      // lookups started since the last edit
let freshRun = false; // true while a run caused by an edit checks its lines: failed lookups retry
const queue = [];
let active = 0;

function lookup(key, fetcher) {
  const hit = cache.get(key);
  if (hit && !(hit.error && freshRun)) return hit;
  if (started >= MAX_LOOKUPS) return { skipped: true };
  started++;
  const entry = { pending: true };
  cache.set(key, entry);
  queue.push(async () => {
    try { cache.set(key, await fetcher()); }
    catch (err) { console.warn(err); cache.set(key, { error: navigator.onLine ? 'The lookup service didn’t answer. Edit the list to try again.' : 'You’re offline.' }); }
    rerender();
  });
  pump();
  return entry;
}
function pump() {
  while (active < 4 && queue.length) {
    active++;
    queue.shift()().finally(() => { active--; pump(); });
  }
}
async function getJson(url) {
  const r = await fetch(url, { referrerPolicy: 'no-referrer' });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json();
}

async function viaCep(digits) {
  const d = await getJson(`https://viacep.com.br/ws/${digits}/json/`);
  if (!d || d.erro) return { warn: 'Valid format, but ViaCEP has no address for this CEP.', fields: [] };
  const street = [d.logradouro, d.complemento].filter(Boolean).join(', ');
  return { fields: [
    street && ['Street', street],
    d.bairro && ['Neighborhood', d.bairro],
    ['City', `${d.localidade} · ${d.uf}`],
    d.estado && ['State', d.estado],
    d.regiao && ['Region', d.regiao],
    d.ddd && ['Area code (DDD)', d.ddd],
    d.ibge && ['IBGE code', d.ibge],
  ].filter(Boolean) };
}

async function zippopotam(country, code) {
  const d = await getJson(`https://api.zippopotam.us/${country.toLowerCase()}/${encodeURIComponent(code)}`);
  if (!d?.places?.length) return { warn: 'Valid format, but Zippopotam.us has no place for this code.', fields: [] };
  const names = [...new Set(d.places.map((p) => p['place name']))];
  const p = d.places[0];
  return { fields: [
    ['Place', names.slice(0, 4).join(', ') + (names.length > 4 ? ` +${names.length - 4} more` : '')],
    p.state && ['State / region', p.state + (p['state abbreviation'] && p['state abbreviation'] !== p.state ? ` (${p['state abbreviation']})` : '')],
    p.latitude && ['Coordinates', `${(+p.latitude).toFixed(4)}, ${(+p.longitude).toFixed(4)}`],
  ].filter(Boolean) };
}

/** Merge a lookup into a result: pending/skipped/error notes, extra fields, a downgrade to "warn". */
function withLookup(r, entry, label) {
  if (entry.pending) return { ...r, note: `Looking up on ${label}…` };
  if (entry.skipped) return { ...r, note: `Not looked up: only the first ${MAX_LOOKUPS} new codes per edit are.` };
  if (entry.error) return { ...r, note: entry.error };
  return { ...r, level: entry.warn ? 'warn' : r.level, reason: entry.warn || r.reason, fields: [...r.fields, ...entry.fields] };
}

/* ---------- Phone (libphonenumber-js, loaded on first use) ---------- */
let lp = null;
const TYPES = { MOBILE: 'Mobile', FIXED_LINE: 'Landline', FIXED_LINE_OR_MOBILE: 'Landline or mobile', TOLL_FREE: 'Toll-free', PREMIUM_RATE: 'Premium rate', SHARED_COST: 'Shared cost', VOIP: 'VoIP', PERSONAL_NUMBER: 'Personal number', PAGER: 'Pager', UAN: 'Company number (UAN)', VOICEMAIL: 'Voicemail' };
const PHONE_ERRORS = { NOT_A_NUMBER: 'Not a phone number.', INVALID_COUNTRY: 'No country code. Start with + (like +55 or +1) or choose a default country.', TOO_SHORT: 'Too short for any phone number.', TOO_LONG: 'Too long for a phone number.', INVALID_LENGTH: 'Wrong length.' };

function phone(text, s) {
  const value = text.trim();
  const intl = /^(\+|00[1-9])/.test(value);
  let n;
  try {
    n = lp.parsePhoneNumberWithError(value.replace(/^00(?=[1-9])/, '+'), { defaultCountry: s.defaultCountry || undefined });
  } catch (err) {
    return { level: 'bad', value, reason: PHONE_ERRORS[err.message] || err.message, fields: [] };
  }
  const code = n.countryCallingCode;
  const shared = lp.getCountries().filter((c) => lp.getCountryCallingCode(c) === code);
  const sharedText = shared.slice(0, 8).map(regionName).join(', ') + (shared.length > 8 ? ` +${shared.length - 8} more` : '');
  const fields = [];
  if (n.country) fields.push(['Country', `${flag(n.country)} ${regionName(n.country)}${intl ? '' : ' (your default country)'}`]);
  else if (shared.length) fields.push(['Country', `Can’t tell: +${code} is shared by ${sharedText}`]);
  else fields.push(['Country', `International service, not a country (+${code})`]);
  fields.push(['Calling code', `+${code}${shared.length > 1 && n.country ? ` (also ${shared.length - 1} other${shared.length > 2 ? 's' : ''})` : ''}`]);
  const valid = n.isValid();
  const type = valid && n.getType();
  if (type) fields.push(['Type', TYPES[type] || type]);
  fields.push(['E.164', n.number], ['International', n.formatInternational()], ['National', n.formatNational()]);
  if (n.ext) fields.push(['Extension', n.ext]);
  if (valid) return { level: 'ok', value, formatted: n.number, fields };
  return { level: n.isPossible() ? 'warn' : 'bad', value, formatted: n.number,
    reason: n.isPossible() ? `The length fits +${code}, but no number range there starts like this.` : `Wrong length for ${n.country ? regionName(n.country) : `+${code}`}.`, fields };
}

/* ---------- Tabs ---------- */
const asLevel = (r) => ({ ...r, level: r.ok ? 'ok' : 'bad', formatted: r.ok ? r.fields[0]?.[1] : undefined });
const postalCountries = Object.keys(POSTAL).sort((a, b) => regionName(a).localeCompare(regionName(b)));

const TABS = {
  cpf: {
    label: 'CPF',
    sample: '529.982.247-25\n111.444.777-35\n123.456.789-00\n111.111.111-11',
    note: 'Brazilian individual taxpayer number. The check digits and the issuing region are worked out on your device.',
    controls: [],
    check: (line) => asLevel(cpf(line)),
    generate: () => randomCpf(),
  },
  cnpj: {
    label: 'CNPJ',
    sample: '11.222.333/0001-81\n12.ABC.345/01DE-35\n11.222.333/0001-82',
    note: 'Brazilian company number, numeric or the new alphanumeric format (issued from July 2026). Checked on your device.',
    controls: [
      { id: 'alnum', type: 'toggle', label: 'Test numbers: alphanumeric', value: false, hint: 'For “Test numbers”. Validation accepts both kinds.' },
    ],
    check: (line) => asLevel(cnpj(line)),
    generate: (s) => randomCnpj(s.alnum),
  },
  cep: {
    label: 'CEP',
    sample: '01001-000\n20040-020\n70150900\n99999-999',
    note: 'Brazilian postal code. The format and state range are checked on your device; with lookup on, each valid CEP is sent to viacep.com.br to fetch its address.',
    controls: [
      { id: 'lookup', type: 'toggle', label: 'Look up addresses on ViaCEP', value: true },
    ],
    check(line, s) {
      const r = asLevel(cep(line));
      if (!r.ok || !s.lookup) return r;
      return withLookup(r, lookup(`cep:${r.digits}`, () => viaCep(r.digits)), 'ViaCEP');
    },
  },
  postal: {
    label: 'Postal code',
    sample: '90210\n10001-0001\n1234',
    note: 'ZIP and postal code formats for 55 countries, checked on your device. With lookup on, valid codes are sent to api.zippopotam.us (Brazil: viacep.com.br) to find the place.',
    controls: [
      { id: 'country', type: 'select', label: 'Country', value: browserRegion in POSTAL ? browserRegion : 'US',
        options: [['ANY', 'Any: which countries match?'], ...postalCountries.map((c) => [c, `${flag(c)} ${regionName(c)}`])] },
      { id: 'lookup', type: 'toggle', label: 'Look up the place', value: true, showIf: (s) => s.country !== 'ANY' },
    ],
    check(line, s) {
      const r = postal(line, s.country, regionName);
      const out = { ...r, level: r.ok ? 'ok' : 'bad', formatted: r.ok && s.country !== 'ANY' ? r.fields[0][1] : undefined };
      if (s.country === 'ANY' && r.ok) out.csv = [['Matches', r.fields.map(([f, list]) => `${f}: ${list}`).join('; ')]];
      if (!r.ok || !s.lookup || s.country === 'ANY') return out;
      const p = POSTAL[s.country];
      if (p.viacep) return withLookup(out, lookup(`cep:${r.compact}`, () => viaCep(r.compact)), 'ViaCEP');
      if (!p.zip) return { ...out, note: 'No lookup available for this country.' };
      const code = p.zip(r.compact);
      return withLookup(out, lookup(`zip:${s.country}:${code}`, () => zippopotam(s.country, code)), 'Zippopotam.us');
    },
  },
  phone: {
    label: 'Phone',
    sample: '+55 11 91234-5678\n+44 20 7946 0958\n+1 416 555 0199\n+351 912 345 678\n+7 701 123 4567',
    note: 'Which country a phone number belongs to, its type and its standard formats, from Google’s numbering data (libphonenumber, about 80 KB, loaded once). Nothing is sent anywhere.',
    controls: [], // filled once the library loads (the country list comes from it)
    check: (line, s) => phone(line, s),
  },
};

/* ---------- UI ---------- */
let tab = TABS[store.get('opts:validators-tab')] ? store.get('opts:validators-tab') : 'cpf';
let panel = null;
let saved = null;
let results = [];

const tabBtns = Object.entries(TABS).map(([id, t]) => h('button', { type: 'button', 'data-v': id, onclick: () => show(id) }, t.label));
$('tabs').append(...tabBtns);

const genBtn = actionButton('Test numbers', 'shuffle', () => {
  const t = TABS[tab];
  $('input').value = Array.from({ length: 10 }, () => t.generate(panel.state)).join('\n');
  saved.save($('input').value);
  run();
}, { title: 'Fill the input with 10 valid, made-up numbers for testing' });
$('in-actions').append(genBtn);

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
function toCsv() {
  const labels = [];
  for (const r of results) for (const [k] of r.csv || r.fields) if (!labels.includes(k)) labels.push(k);
  const rows = [['Input', 'Status', 'Problem', ...labels], ...results.map((r) => {
    const f = Object.fromEntries(r.csv || r.fields);
    return [r.value, STATUS[r.level], r.reason || '', ...labels.map((k) => f[k] ?? '')];
  })];
  return `${rows.map((row) => row.map((v) => csvCell(String(v))).join(',')).join('\n')}\n`;
}
$('out-actions').append(
  actionButton('Copy valid', 'copy', () => {
    const ok = results.filter((r) => r.level === 'ok').map((r) => r.formatted || r.value);
    ok.length ? copyText(ok.join('\n'), `Copied ${ok.length} valid`) : toast('Nothing valid to copy.');
  }, { title: 'Copy the valid ones, formatted, one per line' }),
  downloadButton(() => (results.length ? { text: toCsv(), name: `${tab}-check.csv`, type: 'text/csv' } : null), 'CSV'));

const STATUS = { ok: 'Valid', warn: 'Check', bad: 'Invalid' };

async function show(id) {
  tab = id;
  store.set('opts:validators-tab', id);
  tabBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === id)));
  const t = TABS[id];
  $('note').innerHTML = `${icon(id === 'cep' || id === 'postal' ? 'search' : 'lock')} <span></span>`;
  $('note').lastChild.textContent = t.note;
  genBtn.hidden = !t.generate;
  saved = rememberInput(`validators:${id}`, t.sample, 100_000);
  $('input').value = saved.value;
  $('input').placeholder = t.sample;
  $('controls').replaceChildren();
  results = [];
  $('list').replaceChildren();

  if (id === 'phone' && !lp) {
    status('', 'Loading phone numbering data…');
    try { lp = await loadLib('phone'); }
    catch (err) { if (tab === id) status('error', err.message); return; }
    if (tab !== id) return;
  }
  const specs = id === 'phone' ? phoneControls() : t.controls;
  const opts = remember(`validators-${id}`, [{ title: '', controls: specs.map((c) => ({ ...c })) }]);
  panel = createControls($('controls'), opts.sections, { onChange: (st) => { opts.save(st); run(); } });
  $('controls').hidden = !specs.length;
  run();
}

function phoneControls() {
  const countries = lp.getCountries().sort((a, b) => regionName(a).localeCompare(regionName(b)));
  return [{ id: 'defaultCountry', type: 'select', label: 'Numbers without + are from', value: '',
    options: [['', 'Nowhere: require a + country code'], ...countries.map((c) => [c, `${flag(c)} ${regionName(c)} (+${lp.getCountryCallingCode(c)})`])],
    hint: 'Numbers that start with + or 00 always use their own country code.' }];
}

function status(kind, text) {
  const el = $('status');
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'error' ? icon('alert') : '';
  el.append(text);
}

/** `edit`: the input or options changed (resets the lookup budget); false when a finished lookup redraws. */
function run(edit = true) {
  if (!panel) return;
  const lines = $('input').value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (edit) started = 0;
  freshRun = edit;
  results = lines.slice(0, MAX_LINES).map((line) => TABS[tab].check(line, panel.state));
  freshRun = false;
  render(lines.length);
}

function render(total) {
  if (!total) {
    status('', 'Paste or type values on the left, one per line.');
    $('list').replaceChildren();
    return;
  }
  const n = { ok: 0, warn: 0, bad: 0 };
  for (const r of results) n[r.level]++;
  status('', [`${results.length.toLocaleString()} checked`, n.ok && `${n.ok} valid`, n.warn && `${n.warn} to check`, n.bad && `${n.bad} invalid`,
    total > MAX_LINES && `only the first ${MAX_LINES.toLocaleString()} lines`].filter(Boolean).join(' · '));
  $('list').replaceChildren(...results.slice(0, SHOW).map(card),
    ...(results.length > SHOW ? [h('li', { class: 'vd-more' }, `+ ${(results.length - SHOW).toLocaleString()} more in the CSV`)] : []));
}

const rerender = (() => {
  let queued = false;
  return () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; run(false); });
  };
})();

function card(r) {
  const shown = r.formatted || r.value;
  return h('li', { class: `vd-item is-${r.level}` },
    h('div', { class: 'vd-top' },
      h('span', { class: 'vd-badge', html: `${icon(r.level === 'ok' ? 'check' : 'alert')} ${STATUS[r.level]}` }),
      h('code', {}, shown),
      h('button', { type: 'button', class: 'btn btn-ghost icon-btn', title: 'Copy', 'aria-label': `Copy ${shown}`, html: icon('copy'), onclick: () => copyText(shown) })),
    r.formatted && r.formatted !== r.value ? h('div', { class: 'vd-input' }, `Input: ${r.value}`) : null,
    r.reason ? h('p', { class: 'vd-reason' }, r.reason) : null,
    r.fields.length ? h('dl', { class: 'vd-kv' }, ...r.fields.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)])) : null,
    r.note ? h('p', { class: 'vd-wait' }, r.note) : null);
}

const runSoon = debounce(run, 250);
$('input').addEventListener('input', () => { saved.save($('input').value); runSoon(); });

show(tab);
