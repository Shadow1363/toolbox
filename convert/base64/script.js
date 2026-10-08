/* Base64: text or files → Base64 / Base64URL / data URI, and back to text or a file (type auto-detected). */
import { createControls } from '/assets/js/lib/controls.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { h, icon, formatBytes, toast } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce } from '/assets/js/lib/text-tool.js';
import { detect, FORMATS } from '/convert/file-converter/formats.js';

const input = document.getElementById('input');
const output = document.getElementById('output');
const statusEl = document.getElementById('status');
const extra = document.getElementById('out-extra');
const inFile = document.getElementById('in-file');
const SHOW_MAX = 1_000_000; // characters shown in the output box; copy/download always get everything

let file = null;       // File being encoded (encode mode)
let result = null;     // { text } or { blob, name } for copy/download
let previewUrl = null;

const opts = remember('base64', [
  { title: '', controls: [
    { id: 'mode', type: 'segmented', label: 'Direction', value: 'encode', options: [['encode', 'Encode'], ['decode', 'Decode']] },
    { id: 'variant', type: 'segmented', label: 'Alphabet', value: 'standard', options: [['standard', 'Base64'], ['url', 'Base64URL']] },
    { id: 'padding', type: 'toggle', label: 'Keep = padding', value: false, showIf: (s) => s.variant === 'url' && s.mode === 'encode' },
    { id: 'dataUri', type: 'toggle', label: 'Data URI prefix', value: false, showIf: (s) => s.mode === 'encode' && s.variant === 'standard' },
    { id: 'wrap', type: 'segmented', label: 'Line length', value: '0', options: [['0', 'One line'], ['76', '76 (MIME)']], showIf: (s) => s.mode === 'encode' },
  ]},
]);
const panel = createControls(document.getElementById('options'), opts.sections, {
  onChange: (s, id) => { opts.save(s); if (id === 'mode') { file = null; input.value = ''; } run(); },
});
const s = panel.state;

createFilePicker(document.getElementById('drop'), {
  label: 'Or drop a file',
  onFiles: async ([f]) => {
    if (s.mode === 'decode') { input.value = await f.text(); file = null; }
    else file = f;
    run();
  },
}).el.classList.add('is-compact');

document.getElementById('in-actions').append(actionButton('Clear', 'trash', () => { input.value = ''; file = null; run(); }));
document.getElementById('out-actions').append(
  copyButton(() => result?.text ?? null),
  downloadButton(() => result && (result.blob ? { blob: result.blob, name: result.name } : { text: result.text, name: 'base64.txt' })),
  actionButton('Swap', 'swap', () => {
    if (result?.text == null) return toast('Nothing to swap yet.');
    const text = result.text;
    panel.set({ mode: s.mode === 'encode' ? 'decode' : 'encode' }, { silent: true });
    opts.save(s);
    file = null;
    input.value = text;
    run();
  }, { title: 'Use the output as the new input and switch direction' }));
input.addEventListener('input', debounce(run, 80));

/* ---------- Base64 core ---------- */
function bytesToBase64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
const fileToBase64 = (f) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
  r.onerror = () => reject(r.error);
  r.readAsDataURL(f);
});

function styleOutput(b64, mime) {
  let out = b64;
  if (s.variant === 'url') {
    out = out.replace(/\+/g, '-').replace(/\//g, '_');
    if (!s.padding) out = out.replace(/=+$/, '');
  } else if (s.dataUri) return `data:${mime};base64,${out}`;
  if (+s.wrap) out = out.replace(new RegExp(`(.{${+s.wrap}})`, 'g'), '$1\n').trimEnd();
  return out;
}

/** Accept standard or URL-safe Base64, with whitespace, missing padding or a data: prefix. */
function parseBase64(text) {
  let t = text.trim();
  let mime = null;
  const m = /^data:([^;,]*)(?:;[^,]*)?,/i.exec(t);
  if (m) { mime = m[1] || null; t = t.slice(m[0].length); }
  t = t.replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const bad = t.replace(/=+$/, '').search(/[^A-Za-z0-9+/]/);
  if (bad >= 0) throw new Error(`Not valid Base64: unexpected “${t[bad]}” at character ${bad + 1}.`);
  if (t.length % 4 === 1) throw new Error('Not valid Base64: the length is off by one character (truncated?).');
  t = t.replace(/=+$/, '');
  t += '='.repeat((4 - (t.length % 4)) % 4);
  const bin = atob(t);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

function asText(bytes) {
  try {
    const t = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return /[\x00-\x08\x0e-\x1f\x7f]/.test(t) ? null : t;
  } catch { return null; }
}

/* ---------- Run ---------- */
let runId = 0;
async function run() {
  const id = ++runId;
  if (previewUrl) { URL.revokeObjectURL(previewUrl); previewUrl = null; }
  extra.replaceChildren();
  status('');
  result = null;
  const encode = s.mode === 'encode';
  document.getElementById('in-title').textContent = encode ? (file ? 'File' : 'Text') : 'Base64';
  document.getElementById('out-title').textContent = encode ? 'Base64' : 'Decoded';
  input.placeholder = encode ? 'Type or paste text…' : 'Paste Base64, Base64URL or a data: URI…';
  input.hidden = !!file;
  inFile.replaceChildren(...(file ? [h('div', { class: 'io-file' }, h('strong', { title: file.name }, file.name),
    h('span', {}, `${formatBytes(file.size)}${file.type ? ` · ${file.type}` : ''}`),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { file = null; run(); } }, 'Remove'))] : []));

  try {
    if (encode) {
      if (!file && !input.value) return show('');
      const b64 = file ? await fileToBase64(file) : bytesToBase64(new TextEncoder().encode(input.value));
      if (id !== runId) return;
      const text = styleOutput(b64, file ? file.type || 'application/octet-stream' : 'text/plain;charset=utf-8');
      result = { text };
      status(`${formatBytes(file ? file.size : new TextEncoder().encode(input.value).length)} → ${text.length.toLocaleString()} characters`, 'ok');
      show(text);
      if (file?.type.startsWith('image/')) {
        previewUrl = URL.createObjectURL(file);
        extra.append(h('img', { class: 'io-preview-img checker', src: previewUrl, alt: file.name }));
      }
    } else {
      if (!input.value.trim()) return show('');
      const { bytes, mime } = parseBase64(input.value);
      const text = asText(bytes);
      if (text != null && !(mime && !mime.startsWith('text/'))) {
        result = { text };
        status(`Valid Base64 · ${formatBytes(bytes.length)} of UTF-8 text`, 'ok');
        show(text);
        return;
      }
      // Binary: detect the type from its signature.
      let fmt = null;
      try { fmt = await detect(new File([bytes], 'decoded')); } catch { /* unknown */ }
      if (id !== runId) return;
      const f = fmt && FORMATS[fmt];
      const type = f?.mime || mime || 'application/octet-stream';
      const blob = new Blob([bytes], { type });
      const name = `decoded.${f?.ext[0] || 'bin'}`;
      result = { blob, name };
      show(`[${formatBytes(bytes.length)} of binary data${f ? `: ${f.label}` : ''}. Use Download to save it as ${name}.]`);
      status(`Valid Base64 · ${f ? f.label : 'unknown binary type'} · ${formatBytes(bytes.length)}`, 'ok');
      if (f?.kind === 'image' && fmt !== 'heic') {
        previewUrl = URL.createObjectURL(blob);
        extra.append(h('img', { class: 'io-preview-img checker', src: previewUrl, alt: 'Decoded image' }));
      }
    }
  } catch (err) {
    if (id !== runId) return;
    show('');
    status(err.message, 'error');
  }
}

function show(text) {
  output.value = text.length > SHOW_MAX ? `${text.slice(0, SHOW_MAX)}\n…` : text;
  if (text.length > SHOW_MAX) status(`Showing the first ${SHOW_MAX.toLocaleString()} characters; Copy and Download get all ${text.length.toLocaleString()}.`);
}

function status(text, kind = '') {
  statusEl.className = `io-status${kind ? ` is-${kind}` : ''}`;
  statusEl.innerHTML = text ? `${kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : ''}` : '';
  if (text) statusEl.append(text);
}

run();
