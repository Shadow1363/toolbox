/*
 * Password, UUID & API key generator. Results live only in this page: options are remembered in
 * localStorage, generated values never are, and nothing is sent anywhere.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, store, toast } from '/assets/js/lib/dom.js';
import { remember, copyText, downloadButton, actionButton } from '/assets/js/lib/text-tool.js';
import { LIBS } from '/assets/js/lib/cdn.js';
import { passwordSets, password, passphrase, uuid4, uuid7, token, ALPHABETS, SYMBOLS, bits, strength } from './random.js';

const SHOW = 200; // rows drawn; Copy all / Download include every result
const $ = (id) => document.getElementById(id);

$('safe').innerHTML = `${icon('lock')} <span>Made on your device with the browser’s secure random generator (<code>crypto.getRandomValues</code>). Nothing is stored or sent anywhere; only your settings are remembered.</span>`;

/* ---------- EFF wordlist (passphrases), loaded on first use ---------- */
let words = null;
let wordsPromise = null;
function loadWords() {
  wordsPromise ||= fetch(LIBS.effWords.url).then((r) => { if (!r.ok) throw new Error(r.statusText); return r.json(); })
    .then((list) => { if (!Array.isArray(list) || list.length < 1000) throw new Error('bad list'); words = list; return list; })
    .catch((err) => { wordsPromise = null; console.error(err); throw new Error('Couldn’t load the word list for passphrases. Check your connection and try again.'); });
  return wordsPromise;
}

/* ---------- Tabs ---------- */
const TABS = {
  password: {
    label: 'Password',
    sections: [{ title: '', controls: [
      { id: 'kind', type: 'segmented', label: 'Type', value: 'password', options: [['password', 'Random characters'], ['passphrase', 'Passphrase (words)']] },
      { id: 'length', type: 'range', label: 'Length', min: 4, max: 128, value: 20, showIf: (s) => s.kind === 'password' },
      { id: 'lower', type: 'toggle', label: 'Lowercase (a–z)', value: true, showIf: (s) => s.kind === 'password' },
      { id: 'upper', type: 'toggle', label: 'Uppercase (A–Z)', value: true, showIf: (s) => s.kind === 'password' },
      { id: 'digits', type: 'toggle', label: 'Numbers (0–9)', value: true, showIf: (s) => s.kind === 'password' },
      { id: 'symbols', type: 'toggle', label: 'Symbols', value: true, showIf: (s) => s.kind === 'password' },
      { id: 'symbolSet', type: 'text', label: 'Symbols to use', value: SYMBOLS, showIf: (s) => s.kind === 'password' && s.symbols },
      { id: 'noSimilar', type: 'toggle', label: 'Exclude look-alikes (i l 1 L o 0 O)', value: false, showIf: (s) => s.kind === 'password' },
      { id: 'noAmbiguous', type: 'toggle', label: 'Exclude brackets, quotes and slashes', value: false, showIf: (s) => s.kind === 'password' },
      { id: 'requireEach', type: 'toggle', label: 'At least one of each type', value: true, showIf: (s) => s.kind === 'password' },
      { id: 'words', type: 'range', label: 'Words', min: 3, max: 12, value: 6, showIf: (s) => s.kind === 'passphrase' },
      { id: 'sep', type: 'segmented', label: 'Separator', value: '-', options: [['-', 'dash'], [' ', 'space'], ['.', 'dot'], ['_', 'underscore'], ['', 'none']], showIf: (s) => s.kind === 'passphrase' },
      { id: 'capitalize', type: 'toggle', label: 'Capitalize words', value: false, showIf: (s) => s.kind === 'passphrase' },
      { id: 'number', type: 'toggle', label: 'Add a digit to one word', value: false, showIf: (s) => s.kind === 'passphrase' },
      { id: 'count', type: 'number', label: 'How many', min: 1, max: 1000, value: 5 },
    ]}],
    async make(s, n) {
      if (s.kind === 'passphrase') {
        const list = words || await loadWords();
        const b = bits(list.length, s.words) + (s.number ? Math.log2(10 * s.words) : 0);
        return { items: Array.from({ length: n }, () => passphrase(s.words, list, s)), bits: b, note: `${s.words} words from the EFF list of ${list.length.toLocaleString()}` };
      }
      const sets = passwordSets(s);
      if (!sets.length) throw new Error('Turn on at least one character type.');
      if (s.requireEach && sets.length > s.length) throw new Error(`A ${s.length}-character password can’t include all ${sets.length} types.`);
      const pool = new Set(sets.join('')).size;
      return { items: Array.from({ length: n }, () => password(s.length, sets, s.requireEach)), bits: bits(pool, s.length), note: `${s.length} characters from a pool of ${pool}` };
    },
  },
  uuid: {
    label: 'UUID',
    sections: [{ title: '', controls: [
      { id: 'version', type: 'segmented', label: 'Version', value: 'v4', options: [['v4', 'v4 (random)'], ['v7', 'v7 (time-ordered)']],
        hint: 'v7 starts with the current time, so new IDs sort after old ones (good for database keys).' },
      { id: 'dashes', type: 'toggle', label: 'Dashes', value: true },
      { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: false },
      { id: 'braces', type: 'toggle', label: 'Wrap in { }', value: false },
      { id: 'count', type: 'number', label: 'How many', min: 1, max: 1000, value: 10 },
    ]}],
    make(s, n) {
      const fmt = (u) => { let v = s.dashes ? u : u.replace(/-/g, ''); if (s.uppercase) v = v.toUpperCase(); return s.braces ? `{${v}}` : v; };
      return { items: Array.from({ length: n }, () => fmt(s.version === 'v7' ? uuid7() : uuid4())), bits: s.version === 'v7' ? 74 : 122, note: s.version === 'v7' ? '48-bit timestamp + 74 random bits' : '122 random bits' };
    },
  },
  apikey: {
    label: 'API key',
    sections: [{ title: '', controls: [
      { id: 'prefix', type: 'text', label: 'Prefix', value: 'sk_live_', placeholder: 'none' },
      { id: 'prefixPreset', type: 'presets', label: 'Prefix ideas', options: ['sk_live_', 'sk_test_', 'pk_live_', 'pk_test_', 'api_', 'tok_', ''].map((p) => ({ label: p || 'none', value: p || 'none', patch: { prefix: p } })) },
      { id: 'format', type: 'segmented', label: 'Characters', value: 'base62', options: [['hex', 'Hex'], ['base62', 'Base62'], ['base64url', 'Base64url']] },
      { id: 'length', type: 'range', label: 'Length (after the prefix)', min: 16, max: 128, value: 32 },
      { id: 'count', type: 'number', label: 'How many', min: 1, max: 1000, value: 5 },
    ]}],
    make(s, n) {
      const alpha = ALPHABETS[s.format];
      return { items: Array.from({ length: n }, () => `${s.prefix || ''}${token(s.length, alpha)}`), bits: bits(alpha.length, s.length), note: `${s.length} ${s.format} characters` };
    },
  },
};

let active = TABS[store.get('opts:generators-tab')] ? store.get('opts:generators-tab') : 'password';
let panel = null;
let items = [];

const tabBtns = Object.entries(TABS).map(([id, t]) => h('button', { type: 'button', 'data-v': id, onclick: () => show(id) }, t.label));
$('tabs').append(...tabBtns);

$('out-actions').append(
  actionButton('Regenerate', 'shuffle', () => generate(), { primary: true }),
  actionButton('Copy all', 'copy', () => (items.length ? copyText(items.join('\n'), `Copied ${items.length}`) : toast('Nothing to copy yet.'))),
  downloadButton(() => (items.length ? { text: `${items.join('\n')}\n`, name: `${active}s.txt` } : null)));

function show(id) {
  active = id;
  store.set('opts:generators-tab', id);
  tabBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === id)));
  // Fresh copies of the specs: remember() writes saved values into them.
  const opts = remember(`generators-${id}`, TABS[id].sections.map((sec) => ({ ...sec, controls: sec.controls.map((c) => ({ ...c })) })));
  $('controls').replaceChildren();
  panel = createControls($('controls'), opts.sections, { onChange: (st) => { opts.save(st); generate(); } });
  $('out-title').textContent = id === 'password' ? 'Passwords' : id === 'uuid' ? 'UUIDs' : 'API keys';
  generate();
}

function status(kind, text) {
  const el = $('status');
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'error' ? icon('alert') : '';
  el.append(text);
}

let genId = 0;
async function generate() {
  const id = ++genId;
  const s = panel.state;
  const n = Math.max(1, Math.min(1000, Math.floor(+s.count || 1)));
  let res;
  try {
    if (s.kind === 'passphrase' && !words) status('', 'Loading word list…');
    res = await TABS[active].make(s, n);
  } catch (err) {
    if (id !== genId) return;
    items = [];
    $('list').replaceChildren();
    $('meter').hidden = true;
    status('error', err.message);
    return;
  }
  if (id !== genId) return;
  items = res.items;
  status('', `${n.toLocaleString()} generated · ${res.note}`);
  const st = strength(res.bits);
  $('meter').hidden = false;
  $('meter-fill').style.width = `${Math.min(100, (res.bits / 128) * 100)}%`;
  $('meter-fill').dataset.level = st.level;
  $('meter-text').replaceChildren(h('b', {}, st.label), ` · ${Math.round(res.bits)} bits of entropy${active === 'password' ? ` · about ${st.crack} to guess at 100 billion tries per second` : ''}`);
  $('list').replaceChildren(...items.slice(0, SHOW).map((v) => h('li', {},
    h('code', {}, v),
    h('button', { type: 'button', class: 'btn btn-ghost icon-btn', title: 'Copy', 'aria-label': 'Copy', html: icon('copy'), onclick: () => copyText(v) }))),
  ...(items.length > SHOW ? [h('li', { class: 'gn-more' }, `+ ${(items.length - SHOW).toLocaleString()} more in Copy all and Download`)] : []));
}

show(active);
