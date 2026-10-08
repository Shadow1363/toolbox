/* Encode / Decode: URL, HTML entities, Unicode escapes, hex, binary, and JWT decoding (never verified). */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, toast } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce } from '/assets/js/lib/text-tool.js';

const input = document.getElementById('input');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const extra = document.getElementById('out-extra');

const CODECS = [['url', 'URL'], ['html', 'HTML entities'], ['unicode', 'Unicode escapes'], ['hex', 'Hex'], ['binary', 'Binary'], ['jwt', 'JWT']];
const opts = remember('encode-decode', [
  { title: '', controls: [
    { id: 'codec', type: 'segmented', label: 'Format', value: 'url', options: CODECS },
    { id: 'mode', type: 'segmented', label: 'Direction', value: 'encode', options: [['encode', 'Encode'], ['decode', 'Decode']], showIf: (s) => s.codec !== 'jwt' },
    { id: 'urlScope', type: 'segmented', label: 'Encode', value: 'component', options: [['component', 'A value (encodeURIComponent)'], ['full', 'A whole URL (encodeURI)']], showIf: (s) => s.codec === 'url' && s.mode === 'encode' },
    { id: 'plusSpace', type: 'toggle', label: 'Treat + as space (form data)', value: false, showIf: (s) => s.codec === 'url' && s.mode === 'decode' },
    { id: 'htmlAll', type: 'toggle', label: 'Also escape non-ASCII', value: false, showIf: (s) => s.codec === 'html' && s.mode === 'encode' },
    { id: 'uniStyle', type: 'segmented', label: 'Style', value: 'js', options: [['js', '\\uXXXX'], ['es6', '\\u{X}'], ['plus', 'U+XXXX']], showIf: (s) => s.codec === 'unicode' && s.mode === 'encode' },
    { id: 'uniAll', type: 'toggle', label: 'Escape ASCII too', value: false, showIf: (s) => s.codec === 'unicode' && s.mode === 'encode' },
    { id: 'hexSep', type: 'segmented', label: 'Separator', value: ' ', options: [['', 'None'], [' ', 'Space'], [':', 'Colon']], showIf: (s) => s.codec === 'hex' && s.mode === 'encode' },
    { id: 'hexUpper', type: 'toggle', label: 'Uppercase', value: false, showIf: (s) => s.codec === 'hex' && s.mode === 'encode' },
  ]},
]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st) => { opts.save(st); run(); } });
const s = panel.state;

document.getElementById('in-actions').append(actionButton('Clear', 'trash', () => { input.value = ''; run(); }));
document.getElementById('out-actions').append(
  copyButton(() => output.value),
  downloadButton(() => (output.value ? { text: output.value, name: `${s.codec}-${s.codec === 'jwt' ? 'decoded' : s.mode + 'd'}.txt` } : null)),
  actionButton('Swap', 'swap', () => {
    if (s.codec === 'jwt') return toast('JWT is decode-only.');
    if (!output.value) return toast('Nothing to swap yet.');
    input.value = output.value;
    panel.set({ mode: s.mode === 'encode' ? 'decode' : 'encode' }, { silent: true });
    opts.save(s);
    run();
  }, { title: 'Use the output as input and flip the direction' }));
input.addEventListener('input', debounce(run, 60));

/* ---------- Codecs ---------- */
const utf8 = (t) => new TextEncoder().encode(t);
function fromBytes(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {
    status('These bytes aren\'t valid UTF-8; invalid sequences are shown as �.', 'warn');
    return new TextDecoder().decode(bytes);
  }
}
const cp = (c) => c.codePointAt(0);
const hex4 = (n) => n.toString(16).toUpperCase().padStart(4, '0');

const ENCODE = {
  url: (t) => (s.urlScope === 'full' ? encodeURI(t) : encodeURIComponent(t)),
  html: (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
    .replace(s.htmlAll ? /[^\x00-\x7f]/gu : /(?!)/g, (c) => `&#x${cp(c).toString(16).toUpperCase()};`),
  unicode: (t) => [...t].map((c) => {
    const n = cp(c);
    if (!s.uniAll && n < 0x80) return c;
    if (s.uniStyle === 'es6') return `\\u{${n.toString(16).toUpperCase()}}`;
    if (s.uniStyle === 'plus') return `U+${hex4(n)} `;
    return n > 0xffff ? c.split('').map((u) => `\\u${hex4(u.charCodeAt(0))}`).join('') : `\\u${hex4(n)}`;
  }).join('').trimEnd(),
  hex: (t) => [...utf8(t)].map((b) => b.toString(16).padStart(2, '0')).join(s.hexSep).replace(/[a-f]/g, (c) => (s.hexUpper ? c.toUpperCase() : c)),
  binary: (t) => [...utf8(t)].map((b) => b.toString(2).padStart(8, '0')).join(' '),
};

const DECODE = {
  url: (t) => {
    try { return decodeURIComponent(s.plusSpace ? t.replace(/\+/g, ' ') : t); } catch {
      throw new Error('Malformed percent-encoding: a % must be followed by two hex digits forming valid UTF-8.');
    }
  },
  html: (t) => { const ta = document.createElement('textarea'); ta.innerHTML = t; return ta.value; }, // RCDATA: nothing runs
  unicode: (t) => t
    .replace(/\\u\{([0-9a-f]{1,6})\}|\\U([0-9a-f]{8})|U\+([0-9a-f]{4,6})\s?/gi, (_, a, b, c) => String.fromCodePoint(parseInt(a || b || c, 16)))
    .replace(/(?:\\u[0-9a-f]{4})+/gi, (m) => String.fromCharCode(...m.match(/[0-9a-f]{4}/gi).map((x) => parseInt(x, 16))))
    .replace(/\\x([0-9a-f]{2})/gi, (_, x) => String.fromCharCode(parseInt(x, 16))),
  hex: (t) => {
    const clean = t.replace(/0x/gi, '').replace(/[\s:,\-]/g, '');
    const bad = clean.search(/[^0-9a-f]/i);
    if (bad >= 0) throw new Error(`Not hex: unexpected “${clean[bad]}”.`);
    if (clean.length % 2) throw new Error('Odd number of hex digits: every byte needs two.');
    return fromBytes(Uint8Array.from(clean.match(/../g) || [], (x) => parseInt(x, 16)));
  },
  binary: (t) => {
    const clean = t.replace(/[\s,]/g, '');
    if (/[^01]/.test(clean)) throw new Error('Binary may only contain 0, 1 and spaces.');
    if (clean.length % 8) throw new Error(`${clean.length} bits isn't a whole number of bytes (needs a multiple of 8).`);
    return fromBytes(Uint8Array.from(clean.match(/.{8}/g) || [], (x) => parseInt(x, 2)));
  },
};

/* ---------- JWT ---------- */
function b64urlJson(part, label) {
  try {
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(part.length / 4) * 4, '=');
    return JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))));
  } catch { throw new Error(`The ${label} isn't valid Base64URL-encoded JSON.`); }
}
function decodeJwt(token) {
  const parts = token.trim().replace(/^Bearer\s+/i, '').split('.');
  if (parts.length !== 3 && parts.length !== 5) throw new Error('A JWT has three parts separated by dots (header.payload.signature).');
  if (parts.length === 5) throw new Error('This is an encrypted JWT (JWE): its payload can\'t be read without the key.');
  const header = b64urlJson(parts[0], 'header');
  const payload = b64urlJson(parts[1], 'payload');
  const claims = [];
  const now = Date.now() / 1000;
  for (const [k, label] of [['iat', 'Issued'], ['nbf', 'Not before'], ['exp', 'Expires']]) {
    if (typeof payload[k] === 'number') {
      const when = new Date(payload[k] * 1000);
      const past = payload[k] < now;
      claims.push(`${label}: ${when.toLocaleString()}${k === 'exp' ? (past ? ' (expired)' : ' (still valid)') : ''}`);
    }
  }
  return { text: `// Header\n${JSON.stringify(header, null, 2)}\n\n// Payload\n${JSON.stringify(payload, null, 2)}\n`, claims, alg: header.alg };
}

/* ---------- Run ---------- */
function run() {
  extra.replaceChildren();
  status('');
  const jwt = s.codec === 'jwt';
  const encode = !jwt && s.mode === 'encode';
  document.getElementById('in-title').textContent = jwt ? 'Token' : encode ? 'Text' : CODECS.find(([k]) => k === s.codec)[1];
  document.getElementById('out-title').textContent = jwt ? 'Header and payload' : encode ? CODECS.find(([k]) => k === s.codec)[1] : 'Text';
  input.placeholder = jwt ? 'Paste a JWT (eyJ…)' : encode ? 'Type or paste text…' : 'Paste encoded text…';
  if (!input.value) { output.value = ''; return; }
  try {
    if (jwt) {
      const r = decodeJwt(input.value);
      output.value = r.text;
      extra.append(h('div', { class: 'io-banner' }, h('strong', {}, 'Not verified. '),
        `Decoding only reads the token; it doesn't check the signature${r.alg ? ` (${r.alg})` : ''}, so anyone could have made it.`));
      if (r.claims.length) extra.append(h('div', { class: 'io-note' }, r.claims.join(' · ')));
      status('Decoded', 'ok');
    } else {
      output.value = (encode ? ENCODE : DECODE)[s.codec](input.value);
      if (!statusEl.textContent) status(`${[...input.value].length.toLocaleString()} → ${[...output.value].length.toLocaleString()} characters`, 'ok');
    }
  } catch (err) {
    output.value = '';
    status(err.message, 'error');
  }
}

function status(text, kind = '') {
  statusEl.className = `io-status${kind ? ` is-${kind === 'warn' ? 'error' : kind}` : ''}`;
  statusEl.innerHTML = text ? (kind === 'ok' ? icon('check') : kind ? icon('alert') : '') : '';
  if (text) statusEl.append(text);
}

run();
