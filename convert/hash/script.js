/* Hash generator: MD5 (hash-wasm) and SHA-1/256/512 (Web Crypto) for text or files, with a verify field. */
import { createControls } from '/assets/js/lib/controls.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { h, icon, formatBytes } from '/assets/js/lib/dom.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { remember, copyText, actionButton, debounce } from '/assets/js/lib/text-tool.js';

const input = document.getElementById('input');
const rowsEl = document.getElementById('rows');
const statusEl = document.getElementById('status');
const matchEl = document.getElementById('match');
const compare = document.getElementById('compare');
const inFile = document.getElementById('in-file');

// Web Crypto needs the whole input in memory; above this, stream through hash-wasm in chunks.
const STREAM_ABOVE = 256 * 1024 * 1024;
const CHUNK = 8 * 1024 * 1024;
const ALGOS = [
  { label: 'MD5', crypto: null, wasm: 'createMD5', note: 'Fine for checksums; broken for security.' },
  { label: 'SHA-1', crypto: 'SHA-1', wasm: 'createSHA1', note: 'Legacy; avoid for security.' },
  { label: 'SHA-256', crypto: 'SHA-256', wasm: 'createSHA256' },
  { label: 'SHA-512', crypto: 'SHA-512', wasm: 'createSHA512' },
];

let file = null;
let digests = null; // label → Uint8Array

const opts = remember('hash', [{ title: '', controls: [
  { id: 'encoding', type: 'segmented', label: 'Output', value: 'hex', options: [['hex', 'Hex'], ['base64', 'Base64']] },
  { id: 'upper', type: 'toggle', label: 'Uppercase hex', value: false, showIf: (s) => s.encoding === 'hex' },
]}]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st) => { opts.save(st); renderRows(); } });
const s = panel.state;

createFilePicker(document.getElementById('drop'), { label: 'Or drop a file to hash', onFiles: ([f]) => { file = f; run(); } }).el.classList.add('is-compact');
document.getElementById('in-actions').append(actionButton('Clear', 'trash', () => { input.value = ''; file = null; run(); }));
input.addEventListener('input', debounce(run, 150));
compare.addEventListener('input', renderMatch);

const toHex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (x) => parseInt(x, 16));
const toB64 = (b) => btoa(String.fromCharCode(...b));
const show = (b) => (s.encoding === 'base64' ? toB64(b) : s.upper ? toHex(b).toUpperCase() : toHex(b));

async function hashBuffer(buf) {
  const { md5 } = await loadLib('hashWasm');
  const out = {};
  await Promise.all(ALGOS.map(async (a) => {
    out[a.label] = a.crypto ? new Uint8Array(await crypto.subtle.digest(a.crypto, buf)) : fromHex(await md5(new Uint8Array(buf)));
  }));
  return out;
}

async function hashStream(f, onProgress, isCurrent) {
  const lib = await loadLib('hashWasm');
  const hashers = await Promise.all(ALGOS.map((a) => lib[a.wasm]()));
  hashers.forEach((x) => x.init());
  for (let pos = 0; pos < f.size; pos += CHUNK) {
    if (!isCurrent()) return null;
    const chunk = new Uint8Array(await f.slice(pos, pos + CHUNK).arrayBuffer());
    hashers.forEach((x) => x.update(chunk));
    onProgress(Math.min(1, (pos + CHUNK) / f.size));
  }
  return Object.fromEntries(ALGOS.map((a, i) => [a.label, hashers[i].digest('binary')]));
}

let runId = 0;
async function run() {
  const id = ++runId;
  input.hidden = !!file;
  document.getElementById('in-title').textContent = file ? 'File' : 'Text';
  inFile.replaceChildren(...(file ? [h('div', { class: 'io-file' }, h('strong', { title: file.name }, file.name), h('span', {}, formatBytes(file.size)),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { file = null; run(); } }, 'Remove'))] : []));
  digests = null;
  if (!file && !input.value) { status('Hashes appear here as you type.'); renderRows(); return; }
  try {
    const t0 = performance.now();
    if (file && file.size > STREAM_ABOVE) {
      status(`Hashing ${formatBytes(file.size)}… 0%`);
      const r = await hashStream(file, (p) => { if (id === runId) status(`Hashing ${formatBytes(file.size)}… ${Math.round(p * 100)}%`); }, () => id === runId);
      if (!r || id !== runId) return;
      digests = r;
    } else {
      const buf = file ? await file.arrayBuffer() : new TextEncoder().encode(input.value).buffer;
      const r = await hashBuffer(buf);
      if (id !== runId) return;
      digests = r;
    }
    const size = file ? file.size : new TextEncoder().encode(input.value).length;
    status(`${formatBytes(size)} hashed in ${Math.max(1, Math.round(performance.now() - t0))} ms`, 'ok');
  } catch (err) {
    if (id !== runId) return;
    console.error(err);
    status(err.message || 'Hashing failed.', 'error');
  }
  renderRows();
}

function renderRows() {
  rowsEl.replaceChildren(...ALGOS.map((a) => {
    const value = digests ? show(digests[a.label]) : '';
    return h('div', { class: 'io-row', dataset: { algo: a.label } },
      h('span', { title: a.note || '' }, a.label),
      h('code', {}, value || '—'),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !value, 'aria-label': `Copy ${a.label}`, html: icon('copy'), onclick: () => copyText(value, `${a.label} copied`) }));
  }));
  renderMatch();
}

function renderMatch() {
  rowsEl.querySelectorAll('.io-row').forEach((r) => r.classList.remove('is-match'));
  matchEl.className = 'io-status';
  matchEl.replaceChildren();
  const want = compare.value.trim().replace(/\s+/g, '');
  if (!want || !digests) return;
  const hit = ALGOS.find((a) => {
    const d = digests[a.label];
    return want.toLowerCase() === toHex(d) || want === toB64(d);
  });
  if (hit) {
    rowsEl.querySelector(`[data-algo="${hit.label}"]`).classList.add('is-match');
    matchEl.className = 'io-status is-ok';
    matchEl.innerHTML = `${icon('check')} Matches ${hit.label}.`;
  } else {
    matchEl.className = 'io-status is-error';
    matchEl.innerHTML = `${icon('alert')} No match with any of these hashes.`;
  }
}

function status(text, kind = '') {
  statusEl.className = `io-status${kind ? ` is-${kind}` : ''}`;
  statusEl.innerHTML = kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '';
  statusEl.append(text);
}

run();
