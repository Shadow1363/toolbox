/*
 * Audio Extractor + Transcript: pull audio out of any video or audio file, export it, transcribe it with Whisper.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Queue model: items = [{ id, file, status, progress, probe, track, buffer, method, error, transcript, out }]
 *   status: 'queued' | 'loading' | 'ready' | 'working' | 'done' | 'error'
 *   transcript = { lines, language, languageProb, task, model }   (lines from lib/transcript.js)
 *   out = { audio: { blob, name }, files: [{ name, text }] }       (batch results for the ZIP)
 * Only the selected item keeps its decoded AudioBuffer; batch processing decodes, encodes and releases one at a time.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, toast, formatBytes, formatTime, downloadBlob, store } from '/assets/js/lib/dom.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { progressModal } from '/assets/js/lib/exporter.js';
import { sendFile } from '/assets/js/lib/handoff.js';
import { downloadZip } from '/assets/js/lib/image-io.js';
import { copyText } from '/assets/js/lib/text-tool.js';
import { AUDIO_ACCEPT, AUDIO_HINT, mediaKind, probeAny, loadAudio, resample, codecName, METHOD_LABEL, clock } from '/assets/js/lib/audio-io.js';
import { parseStreams } from '/assets/js/lib/ffmpeg.js';
import { createWaveform } from '/assets/js/lib/audio-waveform.js';
import { createPlayer } from '/assets/js/lib/audio-player.js';
import { createAudioExport, sliceBuffer, encodeWav } from '/assets/js/lib/audio-export.js';
import { WHISPER_MODELS, WHISPER_LANGUAGES, pickDevice, gpuSupport, modelBytes, isCached, transcribe, languageName, SAMPLE_RATE } from '/assets/js/lib/whisper.js';
import { newLine, buildLines, lineText, lineStart, lineEnd, retime } from '/assets/js/lib/transcript.js';
import { copyAudioStream } from './copy.js';
import { transcriptFile, TRANSCRIPT_FORMATS } from './formats.js';

const items = [];
let selected = null;
let seq = 0;
let busy = false; // a transcription or batch run is in progress

/* ---------- Transcription settings (left panel) ---------- */
const modelInfo = h('div', { class: 'ex-model-info', 'aria-live': 'polite' });
const runBtn = h('button', { type: 'button', class: 'btn btn-primary ex-run', disabled: true, html: `${icon('mic')} Transcribe` });
runBtn.addEventListener('click', () => runTranscription(selected));

const panel = createControls(document.getElementById('controls'), [
  { title: 'Audio track', showIf: () => (selected?.probe?.tracks?.length || 0) > 1, controls: [
    { type: 'custom', el: h('select', { id: 'track', 'aria-label': 'Audio track' }) },
  ] },
  { title: 'Transcribe', controls: [
    { id: 'model', type: 'select', label: 'Model', value: store.get('extractor:model', 'base'), options: WHISPER_MODELS },
    { id: 'device', type: 'segmented', label: 'Run on', value: 'auto', options: [['auto', 'Auto'], ['webgpu', 'GPU'], ['wasm', 'CPU']] },
    { id: 'translate', type: 'toggle', label: 'Translate to English', value: false, hint: 'Whisper’s translate mode: any language in, English text out.' },
    { type: 'custom', el: modelInfo },
    { type: 'custom', el: runBtn },
  ] },
  { title: 'Batch', showIf: () => items.length > 1, controls: [
    { id: 'batchTranscribe', type: 'toggle', label: 'Transcribe every file too', value: false },
    { id: 'zipText', type: 'select', label: 'Transcripts in the ZIP', value: 'srt+txt', options: [['srt+txt', 'SRT + TXT'], ['txt', 'TXT'], ['srt', 'SRT'], ['vtt', 'VTT'], ['json', 'JSON (word timings)'], ['md', 'Markdown'], ['all', 'All formats']], showIf: (st) => st.batchTranscribe },
  ] },
], { onChange: (st, id) => {
  if (id === 'model') store.set('extractor:model', st.model);
  if (id === 'model' || id === 'device') updateModelInfo();
} });
const s = panel.state;
const trackSel = document.getElementById('track');
trackSel.addEventListener('change', () => { if (selected) switchTrack(selected, +trackSel.value); });

let infoToken = 0;
async function updateModelInfo() {
  const token = ++infoToken;
  const device = await pickDevice(s.device);
  const [bytes, cached, gpu] = await Promise.all([modelBytes(s.model, device), isCached(s.model, device), gpuSupport()]);
  if (token !== infoToken) return;
  const where = device === 'webgpu' ? 'Runs on your GPU (WebGPU).' : `Runs on the CPU (WebAssembly)${gpu.webgpu ? '' : ': WebGPU isn’t available here'}. Slower, smaller download.`;
  modelInfo.replaceChildren(
    cached ? h('span', { class: 'is-cached' }, `✓ Downloaded (${formatBytes(bytes)}), ready offline.`) : h('span', {}, `Download: ${formatBytes(bytes)}, once. It’s cached in this browser afterwards.`),
    h('span', {}, where));
}

/* ---------- Queue ---------- */
const queueEl = document.getElementById('queue');
const batchEl = document.getElementById('batch');
createFilePicker(document.getElementById('upload'), {
  multiple: true,
  accept: AUDIO_ACCEPT,
  label: 'Drop videos or audio files',
  hint: `${AUDIO_HINT}, MKV, AVI · several at once`,
  onFiles: addFiles,
});

function addFiles(files) {
  const ok = files.filter((f) => mediaKind(f));
  const bad = files.length - ok.length;
  if (bad) toast(`${bad} file${bad > 1 ? 's aren’t' : ' isn’t'} audio or video and ${bad > 1 ? 'were' : 'was'} skipped.`, 'warning');
  for (const file of ok) items.push({ id: ++seq, file, status: 'queued', progress: 0, probe: null, track: 0, buffer: null, method: null, error: '', transcript: null, out: null });
  renderQueue();
  panel.refresh();
  if (ok.length && (!selected || items.length === ok.length)) select(items[items.length - ok.length]);
}

const STATE_LABEL = { queued: 'Queued', loading: 'Reading…', ready: 'Ready', working: 'Working…', done: 'Done', error: 'Error' };
function renderQueue() {
  queueEl.replaceChildren(...items.map((it) => {
    const remove = h('button', { type: 'button', class: 'btn btn-ghost ex-remove', title: 'Remove', 'aria-label': `Remove ${it.file.name}`, html: icon('x') });
    remove.addEventListener('click', (e) => { e.stopPropagation(); removeItem(it); });
    const sub = [formatBytes(it.file.size), it.probe?.duration ? formatTime(it.probe.duration) : null, it.transcript ? `${languageName(it.transcript.language)} transcript` : null, it.error || null].filter(Boolean).join(' · ');
    const row = h('div', { class: 'ex-item', role: 'button', tabindex: '0', 'aria-current': String(it === selected) },
      h('strong', { title: it.file.name }, it.file.name),
      h('span', { style: 'display:flex;align-items:center;gap:4px' },
        h('span', { class: `ex-state${it.status === 'error' ? ' is-error' : it.status === 'done' ? ' is-done' : ''}` }, STATE_LABEL[it.status]), busy ? null : remove),
      h('span', { class: 'ex-item-sub', title: sub }, sub),
      it.status === 'working' || it.status === 'loading' ? h('div', { class: 'progress' }, h('div', { style: `width:${Math.round(it.progress * 100)}%` })) : null);
    row.addEventListener('click', () => { if (it !== selected && !busy) select(it); });
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); select(it); } });
    return row;
  }));
  renderBatch();
}

function renderBatch() {
  batchEl.hidden = items.length < 2;
  if (batchEl.hidden) return;
  const done = items.filter((it) => it.out).length;
  const fmt = exportBar ? exportBar.state.format.toUpperCase() : '';
  batchEl.replaceChildren(
    h('button', { type: 'button', class: 'btn btn-primary', disabled: busy, html: `${icon('wand')} Process all ${items.length} files`, onclick: runBatch }),
    h('button', { type: 'button', class: 'btn', disabled: busy || !done, html: `${icon('archive')} Download all (.zip)${done ? ` · ${done}` : ''}`, onclick: downloadAll }),
    h('p', { class: 'ctrl-hint' }, `Each file is exported with the audio settings on the right (${fmt === 'ORIGINAL' ? 'original stream' : fmt}), one after another.`));
}

function removeItem(it) {
  const i = items.indexOf(it);
  if (i < 0) return;
  items.splice(i, 1);
  if (selected === it) { selected = null; showSelected(); if (items.length) select(items[Math.min(i, items.length - 1)]); }
  renderQueue();
  panel.refresh();
}

/* ---------- Loading ---------- */
/** Probe + decode `it` (once). `ui.modal`, read lazily, receives status and progress when it exists. */
async function ensureLoaded(it, ui = {}) {
  if (it.buffer) return it.buffer;
  it.status = 'loading';
  it.progress = 0;
  it.error = '';
  renderQueue();
  try {
    if (!it.probe) it.probe = await probeAny(it.file);
    const res = await loadAudio(it.file, {
      track: it.track,
      fallback: true,
      onStatus: (m) => { ui.modal?.message(m); if (it === selected) setMethod(m); },
      onProgress: (p) => { it.progress = p; ui.modal?.set(p); renderQueueSoon(); },
    });
    it.buffer = res.buffer;
    it.method = res.method;
    if (!it.probe && res.log) it.probe = { container: (it.file.name.split('.').pop() || '').toUpperCase(), ...parseStreams(res.log), via: 'ffmpeg' };
    it.status = it.out ? 'done' : 'ready';
    restoreTranscript(it);
    return it.buffer;
  } catch (err) {
    it.status = 'error';
    it.error = err.name === 'AbortError' ? 'Cancelled' : (err.message || 'Couldn’t read this file.');
    throw err;
  } finally {
    renderQueue();
  }
}

let queueTimer = 0;
const renderQueueSoon = () => { if (!queueTimer) queueTimer = setTimeout(() => { queueTimer = 0; renderQueue(); }, 200); };

async function select(it) {
  if (selected && selected !== it && selected.status !== 'working') selected.buffer = null; // keep memory to one file
  selected = it;
  player.stop();
  showSelected();
  renderQueue();
  if (!it.buffer) {
    const ctrl = new AbortController();
    let modal = null;
    const slow = setTimeout(() => { modal = progressModal('Reading audio…', () => ctrl.abort(), `Decoding ${it.file.name}.`); }, 600);
    try {
      await ensureLoaded(it, { get modal() { return modal; } });
    } catch (err) {
      if (err.name !== 'AbortError') toast(err.message || 'Couldn’t read this file.', 'error', 9000);
    } finally {
      clearTimeout(slow);
      modal?.close();
    }
    if (selected !== it) return;
    showSelected();
  }
}

async function switchTrack(it, track) {
  if (it.track === track) return;
  it.track = track;
  it.buffer = null;
  it.out = null;
  await select(it);
}

/* ---------- Selected file view ---------- */
const emptyEl = document.getElementById('empty');
const loadedEl = document.getElementById('loaded');
const infoEl = document.getElementById('info');
const methodEl = document.getElementById('method');
const titleEl = document.getElementById('audio-title');
const trimBox = document.getElementById('trim');
const trimRange = document.getElementById('trim-range');
const setMethod = (text) => { methodEl.textContent = text; };

function showSelected() {
  const it = selected;
  const ready = !!it?.buffer;
  emptyEl.hidden = !!it;
  loadedEl.hidden = !ready;
  if (it && !ready) {
    emptyEl.hidden = false;
    emptyEl.textContent = it.status === 'error' ? `Couldn’t read ${it.file.name}: ${it.error}` : `Reading ${it.file.name}…`;
  } else if (!it) emptyEl.textContent = 'Drop one or more video or audio files on the left (or here): MP4, MOV, MKV, AVI, WebM, M4A, MP3, WAV, FLAC…';
  titleEl.textContent = it ? it.file.name : 'Audio';
  setMethod(ready ? `Decoded with ${METHOD_LABEL[it.method]}` : '');
  wave.setBuffer(ready ? it.buffer : null);
  wave.selection = null;
  trimBox.checked = false;
  syncTrim();
  renderInfo();
  renderTracks();
  panel.refresh();
  runBtn.disabled = !ready || busy;
  renderTranscript();
  exportBar.refresh();
  renderSend();
  player.seek(0);
}

function renderInfo() {
  const it = selected;
  if (!it?.buffer) { infoEl.replaceChildren(); return; }
  const p = it.probe;
  const tr = p?.tracks?.[it.track];
  const b = it.buffer;
  const rows = [
    ['Duration', formatTime(p?.duration || b.duration)],
    ['File size', formatBytes(it.file.size)],
    ['Container', p?.container || (it.file.type || 'Unknown')],
    ['Audio codec', tr ? codecName(tr.codec) : 'Unknown'],
    ['Sample rate', tr?.sampleRate ? `${(tr.sampleRate / 1000).toFixed(1)} kHz` : '—'],
    ['Channels', tr?.channels ? (tr.channels === 1 ? 'Mono' : tr.channels === 2 ? 'Stereo' : `${tr.channels}`) : String(b.numberOfChannels)],
  ];
  if ((p?.tracks?.length || 0) > 1) rows.push(['Audio tracks', `${p.tracks.length} (using #${it.track + 1})`]);
  if (p?.hasVideo) rows.push(['Video', 'Yes (ignored)']);
  infoEl.replaceChildren(...rows.flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function renderTracks() {
  const tracks = selected?.probe?.tracks || [];
  trackSel.replaceChildren(...tracks.map((t, i) => h('option', { value: i },
    `#${i + 1} · ${codecName(t.codec)} · ${t.channels === 1 ? 'mono' : t.channels === 2 ? 'stereo' : `${t.channels || '?'} ch`}${t.language ? ` · ${languageName(t.language)}` : ''}${t.name ? ` · ${t.name}` : ''}${t.isDefault ? ' (default)' : ''}`)));
  trackSel.value = String(selected?.track || 0);
}

/* ---------- Waveform, player, trim ---------- */
const wave = createWaveform(document.getElementById('wave'), {
  height: 120,
  onSeek: (t) => player.seek(t),
  onSelect: () => syncTrim(),
});
const player = createPlayer(document.getElementById('player'), {
  waveform: wave,
  getBuffer: () => selected?.buffer || null,
  onTime: (t) => syncActive(t),
});

function trimRangeNow() {
  const sel = wave.selection;
  return trimBox.checked && sel && sel.end - sel.start > 0.05 ? sel : null;
}
function syncTrim() {
  const sel = wave.selection;
  trimBox.closest('label').hidden = !sel;
  if (!sel) trimBox.checked = false;
  trimRange.textContent = sel ? `(${clock(sel.start, 1)} – ${clock(sel.end, 1)})` : '';
  exportBar?.refresh();
}
trimBox.addEventListener('change', () => exportBar.refresh());

/* ---------- Audio export ---------- */
const baseName = (it = selected) => (it?.file.name || 'audio').replace(/\.[^.]+$/, '');
const exportBar = createAudioExport(document.getElementById('export'), {
  id: 'extractor',
  getBuffer: async () => {
    const it = selected;
    if (!it?.buffer) return null;
    const r = trimRangeNow();
    return r ? sliceBuffer(it.buffer, r.start, r.end) : it.buffer;
  },
  filename: () => `${baseName()}${trimRangeNow() ? '-clip' : ''}`,
  enabled: () => !!selected?.buffer,
  info: () => {
    const b = selected?.buffer;
    if (!b) return null;
    const r = trimRangeNow();
    return { duration: r ? r.end - r.start : b.duration, channels: b.numberOfChannels, sampleRate: selected.probe?.tracks?.[selected.track]?.sampleRate || b.sampleRate };
  },
  extra: [{
    value: 'original',
    label: 'Original',
    available: () => !!selected?.buffer,
    hint: 'Copies the audio stream as it is (no re-encoding, no quality loss): AAC → .m4a, Opus → .opus, MP3 → .mp3… Files the browser can’t remux use ffmpeg (~32 MB download, once).',
    run: async ({ signal, onProgress, onStatus }) => {
      const it = selected;
      const r = trimRangeNow();
      return copyAudioStream(it.file, { track: it.track, start: r?.start ?? null, end: r?.end ?? null, codecHint: it.probe?.tracks?.[it.track]?.codec, signal, onProgress, onStatus });
    },
  }],
});
document.getElementById('export').addEventListener('click', () => setTimeout(renderBatch)); // keep the batch hint's format current

/* ---------- Send to other tools ---------- */
const sendEl = document.getElementById('send');
const TARGETS = [['trimmer', 'Trimmer', '/audio/trimmer/'], ['cleanup', 'Cleanup', '/audio/cleanup/'], ['waveform-video', 'Waveform Video', '/audio/waveform-video/']];
function renderSend() {
  sendEl.hidden = !selected?.buffer;
  sendEl.replaceChildren(h('span', {}, 'Open in:'), ...TARGETS.map(([id, label, url]) =>
    h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('arrow')} ${label}`, onclick: () => sendTo(id, url) })));
}

async function sendTo(id, url) {
  const it = selected;
  if (!it?.buffer) return;
  const r = trimRangeNow();
  try {
    // The original file when the browser can read it as is; otherwise a WAV of the decoded audio.
    const asIs = it.method === 'browser' && it.track === 0 && !r;
    const file = asIs ? it.file : new File([encodeWav(r ? sliceBuffer(it.buffer, r.start, r.end) : it.buffer)], `${baseName(it)}${r ? '-clip' : ''}.wav`, { type: 'audio/wav' });
    const meta = { from: 'Audio Extractor' };
    if (it.transcript?.lines?.length) {
      const off = r?.start || 0, end = r?.end ?? Infinity;
      meta.words = it.transcript.lines.flatMap((l) => l.words)
        .filter((w) => w.end > off && w.start < end)
        .map((w) => ({ text: w.text, start: +(w.start - off).toFixed(3), end: +(w.end - off).toFixed(3) }));
      meta.language = it.transcript.language;
    }
    await sendFile(id, file, meta);
    location.href = url;
  } catch (err) {
    console.error(err);
    toast(`Couldn’t hand the audio over: ${err.message}`, 'error');
  }
}

/* ---------- Transcript ---------- */
const langSel = document.getElementById('lang');
const detectedEl = document.getElementById('detected');
const linesEl = document.getElementById('lines');
const searchEl = document.getElementById('search');
const countEl = document.getElementById('count');
const txExportEl = document.getElementById('tx-export');

function fillLanguages(extra) {
  const list = [...WHISPER_LANGUAGES];
  if (extra && !list.some(([c]) => c === extra)) list.push([extra, languageName(extra)]);
  langSel.replaceChildren(...list.map(([c, n]) => h('option', { value: c }, n)));
}
fillLanguages();
langSel.addEventListener('change', () => {
  const it = selected;
  if (!it?.buffer || busy) return;
  if (it.transcript && langSel.value && langSel.value !== it.transcript.language) {
    if (confirm(`Transcribe again as ${languageName(langSel.value)}? Your edits to this transcript will be replaced.`)) runTranscription(it, { language: langSel.value, confirmed: true });
    else langSel.value = it.transcript.language;
  }
});

const storeKey = (it) => `extractor:${it.file.name}:${it.file.size}:${it.track}`;
function saveTranscript(it) {
  if (!it?.transcript) return;
  const { lines, language, languageProb, task, model } = it.transcript;
  store.set(storeKey(it), { v: 1, lines: lines.map((l) => l.words), language, languageProb, task, model });
}
function restoreTranscript(it) {
  if (it.transcript) return;
  const saved = store.get(storeKey(it));
  if (saved?.lines?.length) it.transcript = { ...saved, lines: saved.lines.filter((w) => w.length).map(newLine) };
}

const rows = new Map();
function renderTranscript() {
  rows.clear();
  const it = selected;
  const tx = it?.transcript;
  fillLanguages(tx?.language);
  langSel.value = tx?.language || '';
  detectedEl.textContent = tx ? `${tx.languageProb ? `detected, ${Math.round(tx.languageProb * 100)}%` : 'chosen'}${tx.task === 'translate' ? ' · translated to English' : ''}` : '';
  if (!tx?.lines?.length) {
    linesEl.replaceChildren(h('p', { class: 'ex-note', html: it?.buffer ? 'No transcript yet. Press <strong>Transcribe</strong> on the left.' : 'No transcript yet. Load a file, then press <strong>Transcribe</strong>.' }));
    countEl.textContent = '';
  } else {
    linesEl.replaceChildren(...tx.lines.map((l) => buildRow(it, l)));
    applySearch();
  }
  renderTxExport();
}

function buildRow(it, line) {
  const time = h('button', { type: 'button', class: 'ex-time', title: 'Play from here' }, clock(lineStart(line), 0));
  const ta = h('textarea', { rows: 1, spellcheck: 'true', 'aria-label': `Transcript line at ${clock(lineStart(line), 0)}` });
  ta.value = lineText(line);
  let snapshot = null;
  ta.addEventListener('focus', () => { snapshot = line.words.slice(); });
  ta.addEventListener('blur', () => { snapshot = null; });
  ta.addEventListener('input', () => {
    line.words = retime(snapshot || line.words, ta.value);
    autosize(ta);
    saveSoon(it);
  });
  time.addEventListener('click', () => { player.seek(lineStart(line)); player.play(); });
  const row = h('div', { class: 'ex-line', dataset: { id: line.id } }, time, ta);
  rows.set(line.id, { row, ta, line });
  requestAnimationFrame(() => autosize(ta));
  return row;
}
const autosize = (ta) => { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; };
let saveTimer = 0;
const saveSoon = (it) => { clearTimeout(saveTimer); saveTimer = setTimeout(() => saveTranscript(it), 400); };

const norm = (t) => t.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
function applySearch() {
  const q = norm(searchEl.value.trim());
  let n = 0;
  for (const { row, line } of rows.values()) {
    const hit = !q || norm(lineText(line)).includes(q);
    row.hidden = !hit;
    if (hit) n++;
  }
  countEl.textContent = q ? `${n} of ${rows.size} lines` : rows.size ? `${rows.size} lines` : '';
}
searchEl.addEventListener('input', applySearch);

let activeId = null;
function syncActive(t) {
  const lines = selected?.transcript?.lines;
  if (!lines?.length) return;
  const line = lines.find((l) => t >= lineStart(l) - 0.05 && t < lineEnd(l) + 0.3);
  const id = line?.id ?? null;
  if (id === activeId) return;
  rows.get(activeId)?.row.classList.remove('is-active');
  activeId = id;
  const r = rows.get(id);
  if (!r) return;
  r.row.classList.add('is-active');
  if (document.activeElement?.tagName === 'TEXTAREA' && linesEl.contains(document.activeElement)) return;
  const top = r.row.offsetTop - linesEl.offsetTop;
  if (top < linesEl.scrollTop || top + r.row.offsetHeight > linesEl.scrollTop + linesEl.clientHeight) linesEl.scrollTop = top - linesEl.clientHeight / 3;
}

/* Transcript export */
const tsBox = h('input', { type: 'checkbox', role: 'switch', checked: store.get('extractor:timestamps', true) });
tsBox.addEventListener('change', () => store.set('extractor:timestamps', tsBox.checked));
function docFor(it) {
  return { lines: it.transcript.lines, name: it.file.name, language: it.transcript.language, task: it.transcript.task, model: it.transcript.model, duration: it.buffer?.duration ?? it.probe?.duration };
}
function renderTxExport() {
  const it = selected;
  const has = !!it?.transcript?.lines?.length;
  txExportEl.hidden = !has;
  if (!has) return;
  const save = (kind) => {
    const f = transcriptFile(kind, docFor(it), { timestamps: tsBox.checked });
    const name = `${baseName(it)}${it.transcript.task === 'translate' ? '-en' : ''}.${f.ext}`;
    downloadBlob(new Blob([f.text], { type: `${f.mime};charset=utf-8` }), name);
    toast(`Saved ${name}`, 'success');
  };
  txExportEl.replaceChildren(
    ...TRANSCRIPT_FORMATS.map(([k, label]) => h('button', { type: 'button', class: `btn btn-sm${k === 'srt' ? ' btn-primary' : ''}`, html: `${icon('download')} ${label}`, onclick: () => save(k) })),
    h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('copy')} Copy`, onclick: () => copyText(transcriptFile('txt', docFor(it), { timestamps: tsBox.checked }).text, 'Transcript copied') }),
    h('span', { class: 'spacer' }),
    h('label', { class: 'toggle' }, h('span', {}, 'Timestamps in TXT / MD'), tsBox));
}

/* ---------- Transcription ---------- */
async function whisperInput(it) {
  const mono = await resample(it.buffer, SAMPLE_RATE, 1);
  return mono.getChannelData(0).slice();
}

/**
 * Transcribe one item. `modal` (optional) is reused by the batch; otherwise one is opened here.
 * Resolves true on success.
 */
async function transcribeItem(it, { language = null, modal: shared = null, onProgress } = {}) {
  const ctrl = shared?.ctrl || new AbortController();
  const modal = shared?.modal || progressModal('Preparing audio…', () => ctrl.abort(), 'Converting the audio for Whisper.');
  const collected = [];
  try {
    await ensureLoaded(it);
    const audio = await whisperInput(it);
    if (audio.length < SAMPLE_RATE * 0.2) throw new Error('The audio is too short to transcribe.');
    const device = await pickDevice(s.device);
    const total = await modelBytes(s.model, device);
    const cached = await isCached(s.model, device);
    modal.phase(cached ? 'Loading model…' : 'Downloading model…', cached ? 'Loading Whisper from your browser cache.' : `Whisper ${s.model}: ${formatBytes(total)}. This happens once; next time it loads from the cache.`);
    let phase = 'download';
    const task = s.translate ? 'translate' : 'transcribe';
    const res = await transcribe(audio, {
      model: s.model, device, language, task, signal: ctrl.signal,
      onDownload: (loaded, tot) => {
        if (phase !== 'download') return;
        modal.set(loaded / tot);
        if (!cached) modal.message(`Whisper ${s.model}: ${formatBytes(loaded)} of ${formatBytes(tot)}. This happens once.`);
      },
      onLanguage: (code, p) => {
        phase = 'run';
        modal.phase(task === 'translate' ? 'Translating to English…' : 'Transcribing…', `${it.file.name}: ${formatTime(audio.length / SAMPLE_RATE)} of ${languageName(code)}${language ? '' : ` (detected${p ? `, ${Math.round(p * 100)}%` : ''})`}.`);
      },
      onProgress: (p) => { if (phase === 'run') { modal.set(p); onProgress?.(p); } },
      onWords: (words) => {
        collected.push(...words);
        if (it === selected) { it.transcript = { lines: buildLines(collected), language: it.transcript?.language, task }; renderTranscript(); }
      },
    });
    // A forced language that matches the earlier detection keeps its confidence.
    const prob = !language ? res.languageProb : it.transcript?.language === language ? it.transcript.languageProb || 0 : 0;
    it.transcript = { lines: buildLines(res.words), language: res.language, languageProb: prob, task, model: s.model };
    saveTranscript(it);
    updateModelInfo();
    if (!res.words.length) toast(`No speech found in ${it.file.name}.`, 'warning', 6000);
    return true;
  } catch (err) {
    if (err.name === 'AbortError') {
      if (collected.length) { it.transcript = { lines: buildLines(collected), language: it.transcript?.language || language, task: s.translate ? 'translate' : 'transcribe', model: s.model }; saveTranscript(it); }
      throw err;
    }
    console.error(err);
    throw new Error(/fetch|network|load/i.test(err.message) ? `Couldn’t download the speech model. Check your connection or content blocker. (${err.message})` : err.message || 'Transcription failed.');
  } finally {
    if (!shared) modal.close();
    if (it === selected) renderTranscript();
    renderQueue();
  }
}

async function runTranscription(it, { language, confirmed = false } = {}) {
  if (!it?.buffer || busy) return;
  if (!confirmed && it.transcript?.lines?.length && !confirm('Replace the current transcript with a new one?')) return;
  const lang = language ?? (langSel.value || null);
  busy = true;
  runBtn.disabled = true;
  player.pause();
  renderQueue();
  try {
    await transcribeItem(it, { language: lang });
    const tx = it.transcript;
    toast(`Transcribed ${tx.lines.reduce((n, l) => n + l.words.length, 0)} words (${languageName(tx.language)}${tx.task === 'translate' ? ' → English' : ''}).`, 'success');
  } catch (err) {
    if (err.name === 'AbortError') toast(it.transcript?.lines?.length ? 'Stopped. Kept the words recognized so far.' : 'Transcription cancelled.');
    else toast(err.message, 'error', 9000);
  } finally {
    busy = false;
    runBtn.disabled = !selected?.buffer;
    renderQueue();
  }
}

/* ---------- Batch ---------- */
async function runBatch() {
  if (busy || !items.length) return;
  busy = true;
  runBtn.disabled = true;
  player.stop();
  const ctrl = new AbortController();
  const modal = progressModal('Processing files…', () => ctrl.abort(), '');
  const settings = { ...exportBar.settings(), format: exportBar.state.format };
  let ok = 0, failed = 0;
  try {
    for (let i = 0; i < items.length; i++) {
      if (ctrl.signal.aborted) break;
      const it = items[i];
      it.status = 'working'; it.progress = 0; it.error = ''; it.out = null;
      renderQueue();
      const step = (p) => { it.progress = p; renderQueueSoon(); };
      try {
        modal.phase(`File ${i + 1} of ${items.length}: reading`, it.file.name);
        if (settings.format === 'original') {
          if (!it.probe) it.probe = await probeAny(it.file);
          modal.phase(`File ${i + 1} of ${items.length}: copying audio`, it.file.name);
          const res = await copyAudioStream(it.file, { track: it.track, codecHint: it.probe?.tracks?.[it.track]?.codec, signal: ctrl.signal, onProgress: (p) => { modal.set(p); step(p * 0.3); }, onStatus: (m) => modal.message(`${it.file.name}: ${m}`) });
          it.out = { audio: res, files: [] };
          if (s.batchTranscribe) await ensureLoaded(it);
        } else {
          await ensureLoaded(it);
          modal.phase(`File ${i + 1} of ${items.length}: encoding ${settings.format.toUpperCase()}`, it.file.name);
          const { blob, ext } = await exportBar.encode(it.buffer, settings, { signal: ctrl.signal, onProgress: (p) => { modal.set(p); step(p * 0.3); }, onStatus: (m) => modal.message(m) });
          it.out = { audio: { blob, name: `${baseName(it)}.${ext}` }, files: [] };
        }
        it.status = 'working';
        if (s.batchTranscribe) {
          if (!it.transcript?.lines?.length) {
            modal.phase(`File ${i + 1} of ${items.length}: transcribing`, it.file.name);
            await transcribeItem(it, { modal: { modal, ctrl }, onProgress: (p) => step(0.3 + p * 0.7) });
          }
          it.out.files = transcriptFiles(it);
        }
        it.status = 'done';
        it.progress = 1;
        ok++;
      } catch (err) {
        if (err.name === 'AbortError') { it.status = it.out ? 'done' : 'ready'; break; }
        console.error(err);
        it.status = 'error';
        it.error = err.message || 'Failed';
        failed++;
      } finally {
        if (it !== selected) it.buffer = null; // free memory
        renderQueue();
      }
    }
  } finally {
    modal.close();
    busy = false;
    renderQueue();
    showSelected();
  }
  if (ctrl.signal.aborted) toast(`Stopped after ${ok} file${ok === 1 ? '' : 's'}.`);
  else toast(`Processed ${ok} file${ok === 1 ? '' : 's'}${failed ? `, ${failed} failed` : ''}. Download them as a ZIP.`, failed ? 'warning' : 'success', 7000);
}

function transcriptFiles(it) {
  if (!it.transcript?.lines?.length) return [];
  const kinds = s.zipText === 'all' ? TRANSCRIPT_FORMATS.map(([k]) => k) : s.zipText.split('+');
  return kinds.map((k) => {
    const f = transcriptFile(k, docFor(it), { timestamps: tsBox.checked });
    return { name: `${baseName(it)}.${f.ext}`, text: f.text };
  });
}

async function downloadAll() {
  const files = [];
  const used = new Set();
  const unique = (name) => { let n = name, i = 2; while (used.has(n)) n = name.replace(/(\.[^.]+)$/, `-${i++}$1`); used.add(n); return n; };
  for (const it of items) {
    if (!it.out) continue;
    files.push({ name: unique(it.out.audio.name), blob: it.out.audio.blob });
    for (const f of it.out.files) files.push({ name: unique(f.name), text: f.text });
  }
  if (!files.length) return;
  try {
    await downloadZip(files, 'extracted-audio.zip');
    toast(`Saved extracted-audio.zip (${files.length} files)`, 'success');
  } catch (err) {
    toast(err.message || 'Couldn’t build the ZIP.', 'error');
  }
}

/* ---------- Drop anywhere on the main column ---------- */
const mainEl = document.querySelector('.audio-main');
mainEl.addEventListener('dragover', (e) => e.preventDefault());
mainEl.addEventListener('drop', (e) => { e.preventDefault(); if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files]); });

/* ---------- Start ---------- */
showSelected();
renderQueue();
updateModelInfo();
