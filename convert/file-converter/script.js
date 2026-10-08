/* Universal File Converter: drop files → detect → pick a target → (chained) convert → preview → download. */
import { createControls } from '/assets/js/lib/controls.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { h, icon, toast, downloadBlob, formatBytes, store } from '/assets/js/lib/dom.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { FORMATS, KINDS, detect, detectText, DetectError } from './formats.js';
import { Item, ConvertError, targets, pathFor, run, optionsFor, notesFor } from './registry.js';
import { renderPreview } from './preview.js';
import './converters/index.js';

/* Size limits: documents and data parse in memory; ffmpeg needs input + output in wasm memory. */
const LIMIT = { document: 200e6, data: 200e6, image: 100e6, video: 1e9, audio: 1e9 };
const WARN_MEDIA = 250e6;
const AUTO_MAX = 25e6; // light conversions under this size run as soon as they're set up
const TEXT_FORMATS = Object.keys(FORMATS).filter((f) => FORMATS[f].text);
const DEFAULT_TARGET = {
  md: 'pdf', html: 'md', docx: 'pdf', pdf: 'txt', txt: 'pdf', csv: 'json', tsv: 'csv', json: 'csv', yaml: 'json', xml: 'json', xlsx: 'csv',
  png: 'jpg', jpg: 'png', webp: 'png', bmp: 'png', gif: 'mp4', ico: 'png', svg: 'png', avif: 'png', heic: 'jpg',
  mp4: 'webm', webm: 'mp4', mov: 'mp4', mkv: 'mp4', avi: 'mp4', mp3: 'wav', wav: 'mp3', ogg: 'mp3', m4a: 'mp3', flac: 'mp3',
};

const queueEl = document.getElementById('queue');
const queueSection = document.getElementById('queue-section');
const bulkEl = document.getElementById('bulk');
const optionsEl = document.getElementById('options');
const previewHead = document.getElementById('preview-head');
const previewEl = document.getElementById('preview');
const actionsEl = document.getElementById('actions');

let items = [];
let selectedId = null;
let nextId = 1;
let options = store.get('fc-options', {});
let combinePdf = store.get('fc-combine', true);
let busy = null; // AbortController while converting

/* ---------- Adding files ---------- */
createFilePicker(document.getElementById('upload'), {
  multiple: true,
  label: 'Drop files to convert',
  hint: 'documents, spreadsheets, images, audio, video',
  onFiles: addFiles,
});
document.getElementById('paste-add').addEventListener('click', () => {
  const ta = document.getElementById('paste');
  if (!ta.value.trim()) return toast('Paste some text first.');
  const format = detectText(ta.value);
  addItem(new Item(new Blob([ta.value], { type: 'text/plain' }), `pasted.${FORMATS[format].ext[0]}`, format), { pasted: true });
  ta.value = '';
});
// Paste a file (e.g. a screenshot) anywhere on the page.
document.addEventListener('paste', (e) => {
  if (e.target.closest('textarea, input')) return;
  const files = [...(e.clipboardData?.files || [])];
  if (files.length) addFiles(files);
});

async function addFiles(files) {
  for (const file of files) {
    try {
      const format = await detect(file);
      addItem(new Item(file, file.name, format));
    } catch (err) {
      items.push({ id: nextId++, source: new Item(file, file.name, null), status: 'error', error: err instanceof DetectError ? err.message : `Couldn't read “${file.name}”.`, outputs: null, warnings: [] });
    }
  }
  render();
  autoConvert();
}

function addItem(source, { pasted = false } = {}) {
  const kind = FORMATS[source.format].kind;
  const it = { id: nextId++, source, pasted, status: 'idle', outputs: null, warnings: [], error: null };
  if (source.blob.size > LIMIT[kind]) {
    it.status = 'error';
    it.error = `Too large for the browser (${formatBytes(source.blob.size)}; the limit for ${KINDS[kind].toLowerCase()} is ${formatBytes(LIMIT[kind])}).`;
  } else it.target = defaultTarget(source.format);
  if (!it.error && !it.target) { it.status = 'error'; it.error = `No conversions available for ${FORMATS[source.format].label}.`; }
  items.push(it);
  selectedId ??= it.id;
  render();
  autoConvert();
}

function defaultTarget(format) {
  const available = targets(format);
  const saved = store.get(`fc-target:${format}`);
  return [saved, DEFAULT_TARGET[format], ...available.keys()].find((t) => t && available.has(t)) || null;
}

/* ---------- Conversion ---------- */
const imageGroup = () => (combinePdf ? items.filter((i) => !i.error && i.target === 'pdf' && FORMATS[i.source.format].kind === 'image') : []);
const isGrouped = (it) => { const g = imageGroup(); return g.length > 1 && g.includes(it); };
const pathOf = (it) => (it.target ? pathFor(it.source.format, it.target) : null);
const keyOf = (it, path) => JSON.stringify([it.target, it.source.format, Object.fromEntries(optionsFor([path]).map((o) => [o.id, options[o.id]])), isGrouped(it) && imageGroup().map((i) => i.id)]);
const isHeavy = (path) => path.some((s) => s.heavy);
/** Needs converting with the current settings. Failed/cancelled attempts at these settings don't count (no auto-retry loops). */
const stale = (it) => !it.error && it.target && (!['done', 'failed', 'cancelled'].includes(it.status) || it.key !== keyOf(it, pathOf(it)));
const retryable = (it) => stale(it) || (!it.error && ['failed', 'cancelled'].includes(it.status));

let autoTimer = 0;
function autoConvert() {
  clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    const light = items.filter((it) => stale(it) && it.status !== 'working' && !isHeavy(pathOf(it)) && it.source.blob.size <= AUTO_MAX);
    if (light.length && !busy) convert(light);
  }, 250);
}

async function convert(list = items.filter(retryable)) {
  if (busy) return;
  if (!list.length) return toast('Everything is already converted.');
  busy = new AbortController();
  const { signal } = busy;
  renderActions();
  const group = imageGroup();
  const done = new Set();
  for (const it of list) {
    if (signal.aborted) break;
    if (done.has(it.id)) continue;
    const grouped = group.length > 1 && group.includes(it);
    const members = grouped ? group : [it];
    members.forEach((m) => done.add(m.id));
    const path = pathOf(it);
    const key = keyOf(it, path);
    members.forEach((m) => Object.assign(m, { status: 'working', progress: 0, statusText: '', warnings: [], error: null, outputs: null }));
    render();
    const ctx = {
      signal,
      progress: (p) => { it.progress = p; renderStatus(it); },
      status: (t) => { it.statusText = t; renderStatus(it); },
      warn: (m) => { if (!it.warnings.includes(m)) it.warnings.push(m); },
    };
    try {
      const outputs = await run(path, grouped ? members.map((m) => m.source) : it.source, options, ctx);
      Object.assign(it, { status: 'done', outputs, key });
      members.slice(1).forEach((m) => Object.assign(m, { status: 'done', outputs: [], key: keyOf(m, path), mergedInto: it.id }));
      if (!grouped) it.mergedInto = null;
    } catch (err) {
      if (err?.name === 'AbortError' || signal.aborted) members.forEach((m) => Object.assign(m, { status: 'cancelled', key, statusText: 'Cancelled. Press Convert to try again.' }));
      else {
        console.error(err);
        const msg = err instanceof ConvertError ? err.message : `Conversion failed: ${err?.message || err}`;
        members.forEach((m) => Object.assign(m, { status: 'failed', key, failure: msg }));
      }
    }
    render();
  }
  busy = null;
  render();
  autoConvert();
}

/* ---------- Downloads ---------- */
const allOutputs = () => items.flatMap((it) => it.outputs || []);

async function downloadItems(list, zipName) {
  if (!list.length) return;
  if (list.length === 1) return downloadBlob(list[0].blob, list[0].name);
  try {
    const JSZip = await loadLib('jszip');
    const zip = new JSZip();
    const used = new Map();
    for (const o of list) {
      let name = o.name;
      const n = used.get(name) || 0;
      used.set(name, n + 1);
      if (n) name = name.replace(/(\.\w+)?$/, `-${n + 1}$1`);
      zip.file(name, o.blob);
    }
    downloadBlob(await zip.generateAsync({ type: 'blob' }), zipName);
  } catch (err) {
    toast(err.message || 'Could not create the ZIP file.', 'error', 7000);
  }
}

/* ---------- Rendering ---------- */
const selected = () => items.find((i) => i.id === selectedId) || null;

function render() {
  queueSection.hidden = !items.length;
  queueEl.replaceChildren(...items.map(row));
  renderBulk();
  renderOptions();
  renderActions();
  renderSelection();
}

function row(it) {
  const f = it.source.format && FORMATS[it.source.format];
  const kind = f?.kind;
  const ic = kind === 'image' ? 'image' : kind === 'video' ? 'film' : kind === 'audio' ? 'volume' : 'file';
  const li = h('li', { class: `fc-item${it.id === selectedId ? ' is-selected' : ''}`, dataset: { id: it.id } });
  li.addEventListener('click', (e) => { if (!e.target.closest('select, button')) { selectedId = it.id; render(); } });

  const head = h('div', { class: 'fc-item-head' },
    h('span', { class: 'fc-item-icon', html: icon(ic) }),
    h('div', { class: 'fc-item-name' }, h('strong', { title: it.source.name }, it.source.name),
      h('span', {}, [formatBytes(it.source.blob.size), f && (it.pasted ? 'pasted text' : null)].filter(Boolean).join(' · '))),
    h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': `Remove ${it.source.name}`, html: icon('x'), onclick: () => removeItem(it) }));
  li.append(head);

  if (it.error) {
    li.append(h('p', { class: 'fc-item-error' }, it.error));
    return li;
  }
  // Source format: fixed for binary files, adjustable for text (detection can be ambiguous).
  const fromEl = f.text
    ? h('select', { 'aria-label': 'Source format', onchange: (e) => setSource(it, e.target.value) },
      TEXT_FORMATS.map((id) => h('option', { value: id, selected: id === it.source.format }, FORMATS[id].label)))
    : h('span', { class: 'fc-format' }, f.label);
  const avail = targets(it.source.format);
  const byKind = {};
  for (const to of avail.keys()) (byKind[FORMATS[to].kind] ||= []).push(to);
  const toEl = h('select', { 'aria-label': 'Convert to', onchange: (e) => setTarget(it, e.target.value) },
    Object.entries(KINDS).filter(([k]) => byKind[k]).map(([k, label]) => h('optgroup', { label },
      byKind[k].map((to) => h('option', { value: to, selected: to === it.target }, FORMATS[to].label)))));
  li.append(h('div', { class: 'fc-item-convert' }, fromEl, h('span', { class: 'fc-arrow', html: icon('arrow') }), toEl));
  li.append(h('div', { class: 'fc-item-status', dataset: { status: it.id } }));
  fillStatus(li.lastChild, it);
  return li;
}

function fillStatus(el, it) {
  const path = pathOf(it);
  const parts = [];
  if (it.status === 'working') {
    parts.push(h('div', { class: 'fc-progress' }, h('div', { style: `width:${Math.round((it.progress || 0) * 100)}%` })),
      h('span', {}, it.statusText || 'Converting…'));
  } else if (it.status === 'failed') parts.push(h('span', { class: 'fc-item-error' }, it.failure));
  else if (it.status === 'done' && !stale(it)) {
    if (it.mergedInto) parts.push(h('span', {}, 'Combined into the PDF above.'));
    else {
      const outs = it.outputs || [];
      parts.push(h('span', { class: 'fc-done', html: `${icon('check')} ${outs.length > 1 ? `${outs.length} files` : outs[0]?.name || 'Done'} · ${formatBytes(outs.reduce((n, o) => n + o.blob.size, 0))}` }),
        h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('download')} Download`, onclick: () => downloadItems(outs, `${it.source.name.replace(/\.[^.]+$/, '')}.zip`) }));
    }
  } else if (path && isHeavy(path)) {
    parts.push(h('span', { class: 'fc-hint' }, it.source.blob.size > WARN_MEDIA
      ? `Large file (${formatBytes(it.source.blob.size)}): this may be slow or run out of memory. Press Convert to start.`
      : 'Press Convert to start (audio/video takes a while).'));
  } else if (it.statusText) parts.push(h('span', { class: 'fc-hint' }, it.statusText));
  el.replaceChildren(...parts);
}

function renderStatus(it) {
  const el = queueEl.querySelector(`[data-status="${it.id}"]`);
  if (el) fillStatus(el, it);
}

function renderBulk() {
  const live = items.filter((i) => !i.error);
  const parts = [];
  if (live.length > 1) {
    // Targets every file can reach.
    const common = live.map((i) => new Set(targets(i.source.format).keys())).reduce((a, b) => new Set([...a].filter((x) => b.has(x))));
    if (common.size) {
      parts.push(h('label', { class: 'fc-bulk-row' }, h('span', {}, 'Convert all to'),
        h('select', { onchange: (e) => { if (e.target.value) live.forEach((i) => setTarget(i, e.target.value, false)); render(); autoConvert(); } },
          h('option', { value: '' }, 'Choose…'), [...common].map((to) => h('option', { value: to }, FORMATS[to].label)))));
    }
  }
  if (items.filter((i) => !i.error && i.target === 'pdf' && FORMATS[i.source.format].kind === 'image').length > 1) {
    const cb = h('input', { type: 'checkbox', role: 'switch', checked: combinePdf, onchange: (e) => { combinePdf = e.target.checked; store.set('fc-combine', combinePdf); render(); autoConvert(); } });
    parts.push(h('label', { class: 'toggle' }, h('span', {}, 'Combine images into one PDF'), cb));
  }
  if (items.length) parts.push(h('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: `${icon('trash')} Clear all`, onclick: clearAll }));
  bulkEl.replaceChildren(...parts);
}

let optionIds = '';
function renderOptions() {
  const paths = items.filter((i) => !i.error && i.target).map(pathOf).filter(Boolean);
  const specs = optionsFor(paths);
  const ids = specs.map((s) => s.id).join(',');
  if (ids === optionIds) return;
  optionIds = ids;
  optionsEl.replaceChildren();
  if (!specs.length) return;
  const controls = specs.map((s) => ({ ...s, value: options[s.id] ?? s.value }));
  controls.forEach((c) => { options[c.id] = c.value; });
  createControls(optionsEl, [{ title: 'Options', controls }], {
    onChange: (state) => {
      Object.assign(options, state);
      store.set('fc-options', options);
      render();
      autoConvert();
    },
  });
}

function renderActions() {
  const pending = items.filter(retryable);
  const outs = allOutputs();
  const sel = selected();
  actionsEl.replaceChildren(...[
    busy
      ? h('button', { type: 'button', class: 'btn', html: `${icon('x')} Cancel`, onclick: () => busy?.abort() })
      : h('button', { type: 'button', class: 'btn btn-primary', disabled: !pending.length, html: `${icon('arrow')} Convert${pending.length > 1 ? ` ${pending.length} files` : ''}`, onclick: () => convert() }),
    h('button', { type: 'button', class: 'btn', disabled: !sel?.outputs?.length || stale(sel), html: `${icon('download')} Download`, onclick: () => downloadItems(sel.outputs, `${sel.source.name.replace(/\.[^.]+$/, '')}.zip`) }),
    outs.length > 1 && h('button', { type: 'button', class: 'btn', disabled: !!busy, html: `${icon('archive')} Download all (.zip)`, onclick: () => downloadItems(outs, 'converted.zip') }),
    h('span', { class: 'spacer' }),
    h('span', { class: 'hint' }, items.length ? `${items.length} file${items.length > 1 ? 's' : ''}` : ''),
  ].filter(Boolean));
}

let shown = null;
function renderSelection() {
  const it = selected();
  if (!it) {
    previewHead.replaceChildren(h('h2', {}, 'Preview'));
    shown = null;
    return renderPreview(previewEl, null);
  }
  const path = !it.error ? pathOf(it) : null;
  const result = it.status === 'done' && !stale(it) && !it.mergedInto ? it.outputs : null;
  const chain = path ? [it.source.format, ...path.map((s) => s.to)] : [];
  const notes = path ? notesFor(path) : [];
  previewHead.replaceChildren(
    h('div', { class: 'fc-preview-title' },
      h('h2', {}, result ? 'Result' : 'Original'),
      chain.length > 0 && h('ol', { class: 'fc-chain', 'aria-label': 'Conversion steps' }, chain.map((f) => h('li', {}, FORMATS[f].label)))),
    ...notes.map((n) => h('p', { class: 'fc-note', html: `${icon('alert')} ` }, n)),
    ...(result ? it.warnings : []).map((w) => h('p', { class: 'fc-note is-warn', html: `${icon('alert')} ` }, w)));
  // Only re-render the preview when what it shows changed (keeps PDFs and videos from reloading).
  const what = result || it.source;
  if (shown === what) return;
  shown = what;
  renderPreview(previewEl, what);
}

/* ---------- Item changes ---------- */
function setTarget(it, to, rerender = true) {
  if (!targets(it.source.format).has(to)) return;
  it.target = to;
  store.set(`fc-target:${it.source.format}`, to);
  if (rerender) { render(); autoConvert(); }
}

function setSource(it, format) {
  it.source = new Item(it.source.blob, it.pasted ? `pasted.${FORMATS[format].ext[0]}` : it.source.name, format);
  it.target = defaultTarget(format);
  it.status = 'idle';
  it.outputs = null;
  shown = null;
  render();
  autoConvert();
}

function removeItem(it) {
  if (it.status === 'working') return toast('Wait for this file to finish, or press Cancel.');
  items = items.filter((i) => i !== it);
  if (selectedId === it.id) selectedId = items[0]?.id ?? null;
  shown = null;
  render();
}

function clearAll() {
  if (busy) busy.abort();
  items = [];
  selectedId = null;
  shown = null;
  render();
}

render();
