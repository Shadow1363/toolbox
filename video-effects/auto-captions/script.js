/*
 * Auto Captions: transcribe speech in the browser (Whisper), edit the transcript, burn in animated captions.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * Flow: upload → Transcribe (decodeAudio → Whisper worker, words stream in) → lines[] (editable)
 *       → timeline(lines, maxWords) → render(t) draws the video + drawCaption(pageAt(t)).
 * The transcript is saved in localStorage per file (name + size), so a reload keeps edits.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, progressModal } from '/assets/js/lib/exporter.js';
import { outputSize } from '/assets/js/lib/canvas.js';
import { fontOptions, weightOptions, ensureFont } from '/assets/js/lib/fonts.js';
import { h, icon, toast, downloadBlob, formatBytes, formatTime, store } from '/assets/js/lib/dom.js';
import { WHISPER_MODELS, WHISPER_LANGUAGES, pickDevice, gpuSupport, modelBytes, isCached, decodeAudio, transcribe } from '/assets/js/lib/whisper.js';
import { newLine, buildLines, lineText, lineStart, lineEnd, retime, splitLine, mergeLines, wordIndexAt, timeline, pageAt, toSRT, toVTT } from '/assets/js/lib/transcript.js';
import { drawCaption } from '/assets/js/lib/captions.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const listEl = document.getElementById('lines');
const metaEl = document.getElementById('transcript-meta');
const clearBtn = document.getElementById('transcript-clear');

let media = null;
let lines = [];
let pages = [];
let busy = false;

/* ---------- Style presets ---------- */
const PRESETS = [
  { label: 'Karaoke', value: 'karaoke', patch: { family: 'Montserrat', weight: '900', size: 64, uppercase: false, color: '#ffffff', hlColor: '#ffd23f', highlight: 'wipe', reveal: 'page', pop: false, stroke: 5, strokeColor: '#000000', shadow: 10, bg: 'none', posY: 82, width: 84, maxWords: 6 } },
  { label: 'Pop-in', value: 'pop', patch: { family: 'Montserrat', weight: '900', size: 78, uppercase: false, color: '#ffffff', hlColor: '#5cf08f', highlight: 'color', reveal: 'word', pop: true, stroke: 6, strokeColor: '#000000', shadow: 14, bg: 'none', posY: 70, width: 80, maxWords: 4 } },
  { label: 'Classic', value: 'classic', patch: { family: 'Inter', weight: '600', size: 44, uppercase: false, color: '#ffffff', hlColor: '#ffd23f', highlight: 'none', reveal: 'page', pop: false, stroke: 0, strokeColor: '#000000', shadow: 0, bg: 'lines', bgColor: '#000000', bgOpacity: 0.7, posY: 88, width: 80, maxWords: 10 } },
  { label: 'Bold short-form', value: 'bold', patch: { family: 'Anton', weight: '400', size: 110, uppercase: true, color: '#ffffff', hlColor: '#ffe14d', highlight: 'color', reveal: 'word', pop: true, stroke: 9, strokeColor: '#000000', shadow: 22, bg: 'none', posY: 64, width: 78, maxWords: 3 } },
  { label: 'Boxed word', value: 'boxed', patch: { family: 'Montserrat', weight: '900', size: 80, uppercase: true, color: '#ffffff', hlColor: '#7c4dff', highlight: 'box', reveal: 'page', pop: true, stroke: 0, strokeColor: '#000000', shadow: 12, bg: 'none', posY: 72, width: 80, maxWords: 3 } },
];

/* ---------- Transcribe controls (custom elements) ---------- */
const modelInfo = h('div', { class: 'ac-model-info', 'aria-live': 'polite' });
const runBtn = h('button', { type: 'button', class: 'btn btn-primary ac-run', disabled: true, html: `${icon('mic')} Transcribe` });
runBtn.addEventListener('click', () => runTranscription());

const panel = createControls(document.getElementById('controls'), [
  { title: 'Transcribe', controls: [
    { id: 'model', type: 'select', label: 'Model', value: 'base', options: WHISPER_MODELS },
    { id: 'language', type: 'select', label: 'Language', value: '', options: WHISPER_LANGUAGES, hint: 'Picking the language is faster and more accurate than auto-detect.' },
    { id: 'device', type: 'segmented', label: 'Run on', value: 'auto', options: [['auto', 'Auto'], ['webgpu', 'GPU'], ['wasm', 'CPU']] },
    { type: 'custom', el: modelInfo },
    { type: 'custom', el: runBtn },
  ]},
  { title: 'Caption style', controls: [
    { id: 'preset', type: 'presets', label: 'Presets', value: 'karaoke', options: PRESETS },
    { id: 'highlight', type: 'segmented', label: 'Highlight', value: 'wipe', options: [['none', 'None'], ['color', 'Color'], ['box', 'Box'], ['wipe', 'Karaoke']] },
    { id: 'reveal', type: 'segmented', label: 'Words appear', value: 'page', options: [['page', 'All at once'], ['word', 'As spoken']] },
    { id: 'pop', type: 'toggle', label: 'Pop animation', value: false },
    { id: 'maxWords', type: 'range', label: 'Max words per caption', min: 1, max: 16, value: 6 },
  ]},
  { title: 'Text', controls: [
    { id: 'family', type: 'select', label: 'Font', value: 'Montserrat', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Weight', value: '900', options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 20, max: 180, value: 64, unit: 'px', hint: 'Relative to a 1080px frame.' },
    { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: false },
    { id: 'color', type: 'color', label: 'Text color', value: '#ffffff' },
    { id: 'hlColor', type: 'color', label: 'Highlight color', value: '#ffd23f', showIf: (s) => s.highlight !== 'none' },
    { id: 'stroke', type: 'range', label: 'Outline', min: 0, max: 20, value: 5, unit: 'px' },
    { id: 'strokeColor', type: 'color', label: 'Outline color', value: '#000000', showIf: (s) => s.stroke > 0 },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 40, value: 10, unit: 'px' },
    { id: 'bg', type: 'segmented', label: 'Background', value: 'none', options: [['none', 'None'], ['box', 'Box'], ['lines', 'Per line']] },
    { id: 'bgColor', type: 'color', label: 'Background color', value: '#000000', showIf: (s) => s.bg !== 'none' },
    { id: 'bgOpacity', type: 'range', label: 'Background opacity', min: 0.1, max: 1, step: 0.05, value: 0.7, format: (v) => `${Math.round(v * 100)}%`, showIf: (s) => s.bg !== 'none' },
  ]},
  { title: 'Position & timing', controls: [
    { id: 'posY', type: 'range', label: 'Vertical position', min: 5, max: 95, value: 82, unit: '%' },
    { id: 'width', type: 'range', label: 'Max width', min: 30, max: 98, value: 84, unit: '%' },
    { id: 'offset', type: 'range', label: 'Timing offset', min: -1, max: 1, step: 0.05, value: 0, format: (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)}s`, hint: 'Shift every caption earlier (−) or later (+).' },
  ]},
], { onChange: (s, id) => {
  if (['model', 'device'].includes(id)) updateModelInfo();
  if (['family', 'weight', 'preset'].includes(id)) ensureFont(s.family, s.weight, () => stage.invalidate());
  if (id === 'maxWords' || id === 'preset') rebuildPages();
  stage.invalidate();
} });
const s = panel.state;

/* ---------- Model info ---------- */
let infoToken = 0;
async function updateModelInfo() {
  const token = ++infoToken;
  const device = await pickDevice(s.device);
  const [bytes, cached, gpu] = await Promise.all([modelBytes(s.model, device), isCached(s.model, device), gpuSupport()]);
  if (token !== infoToken) return;
  const where = device === 'webgpu' ? 'Runs on your GPU (WebGPU).' : `Runs on the CPU (WebAssembly)${gpu.webgpu ? '' : ': WebGPU isn’t available here'}. Slower, smaller download.`;
  modelInfo.replaceChildren(
    cached
      ? h('span', { class: 'is-cached' }, `✓ Downloaded (${formatBytes(bytes)}), ready offline.`)
      : h('span', {}, `Download: ${formatBytes(bytes)}, once. It’s cached in this browser afterwards.`),
    h('span', {}, where),
  );
}

/* ---------- Upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video'],
  label: 'Drop a video with speech',
  onLoad: (m) => {
    media = m;
    const { w, h: hh } = outputSize(m.width, m.height, 1920);
    canvas.width = w; canvas.height = hh;
    restoreTranscript();
    stage.reset();
    exportBar.refresh();
    runBtn.disabled = busy;
    showHint();
    stage.play().catch(() => {});
  },
  onClear: () => {
    media = null;
    setLines([]);
    runBtn.disabled = true;
    stage.reset();
    exportBar.refresh();
    showHint();
  },
});

/* ---------- Transcript state ---------- */
const storeKey = () => (media ? `auto-captions:${media.name}:${media.size}` : null);
let saveTimer = 0;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const key = storeKey();
    if (!key) return;
    store.set(key, lines.length ? { v: 1, lines: lines.map((l) => l.words) } : null);
  }, 400);
}

function restoreTranscript() {
  const saved = store.get(storeKey());
  if (saved?.lines?.length) {
    setLines(saved.lines.filter((w) => w.length).map(newLine), { save: false });
    toast('Restored your saved transcript for this video.');
  } else setLines([], { save: false });
}

function setLines(next, { save: doSave = true, render = true } = {}) {
  lines = next;
  rebuildPages();
  if (render) renderList();
  updateMeta();
  if (doSave) save();
  exportBar?.refresh();
  showHint();
}

function rebuildPages() {
  pages = timeline(lines, s.maxWords);
  stage?.invalidate();
}

function updateMeta() {
  const words = lines.reduce((n, l) => n + l.words.length, 0);
  metaEl.textContent = lines.length ? `${lines.length} lines · ${words} words` : '';
  clearBtn.hidden = !lines.length || busy;
}

clearBtn.addEventListener('click', () => {
  if (!confirm('Delete the transcript for this video? This can’t be undone.')) return;
  setLines([]);
});

/* ---------- Transcript editor ---------- */
const rows = new Map(); // line id → { row, ta, time }

function renderList() {
  rows.clear();
  if (!lines.length) {
    listEl.replaceChildren(h('p', { class: 'ac-empty', html: media ? 'No transcript yet. Press <strong>Transcribe</strong>.' : 'No transcript yet. Drop a video, then press <strong>Transcribe</strong>.' }));
    return;
  }
  listEl.replaceChildren(...lines.map(buildRow));
  syncActive(stage?.time ?? 0, true);
}

function buildRow(line) {
  const time = h('button', { type: 'button', class: 'ac-time', title: 'Jump here' }, formatTime(lineStart(line)));
  const ta = h('textarea', { rows: 1, spellcheck: 'true', 'aria-label': `Caption line at ${formatTime(lineStart(line))}` });
  ta.value = lineText(line);
  let snapshot = null; // the line's words when editing began; every keystroke re-times against it
  ta.addEventListener('focus', () => { snapshot = line.words.slice(); });
  ta.addEventListener('blur', () => { snapshot = null; if (!line.words.length) removeLine(line); });
  ta.addEventListener('input', () => {
    line.words = retime(snapshot || line.words, ta.value);
    time.textContent = formatTime(lineStart(line));
    autosize(ta);
    rebuildPages();
    updateMeta();
    save();
  });
  ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      splitAtCursor(line, ta);
    } else if (e.key === 'Backspace' && ta.selectionStart === 0 && ta.selectionEnd === 0) {
      const i = lines.indexOf(line);
      if (i > 0) { e.preventDefault(); mergeWithPrevious(line); }
    }
  });
  time.addEventListener('click', () => { stage.seek(Math.max(0, lineStart(line) - s.offset + 0.01)); });
  const act = (ic, label, fn) => h('button', { type: 'button', class: 'btn btn-ghost', title: label, 'aria-label': label, html: icon(ic), onclick: fn });
  const row = h('div', { class: 'ac-line', dataset: { id: line.id } }, time, ta,
    h('div', { class: 'ac-line-actions' },
      act('scissors', 'Split at cursor (Enter)', () => splitAtCursor(line, ta)),
      act('merge', 'Merge with next line', () => { const i = lines.indexOf(line); if (lines[i + 1]) mergeWithPrevious(lines[i + 1]); }),
      act('trash', 'Delete line', () => removeLine(line))));
  rows.set(line.id, { row, ta, time });
  requestAnimationFrame(() => autosize(ta));
  return row;
}

function autosize(ta) { ta.style.height = 'auto'; ta.style.height = `${ta.scrollHeight + 2}px`; }

function splitAtCursor(line, ta) {
  if (line.words.length < 2) return;
  const caret = document.activeElement === ta ? ta.selectionStart : Math.floor(ta.value.length / 2);
  let at = wordIndexAt(line, caret);
  if (at <= 0 || at >= line.words.length) at = Math.ceil(line.words.length / 2);
  const [a, b] = splitLine(line, at);
  const i = lines.indexOf(line);
  setLines([...lines.slice(0, i), a, b, ...lines.slice(i + 1)]);
  focusLine(b, 0);
}

function mergeWithPrevious(line) {
  const i = lines.indexOf(line);
  if (i <= 0) return;
  const prev = lines[i - 1];
  const caret = lineText(prev).length + 1;
  const merged = mergeLines(prev, line);
  setLines([...lines.slice(0, i - 1), merged, ...lines.slice(i + 1)]);
  focusLine(merged, caret);
}

function removeLine(line) {
  const i = lines.indexOf(line);
  if (i < 0) return;
  setLines(lines.filter((l) => l !== line));
}

function focusLine(line, caret) {
  const r = rows.get(line.id);
  if (!r) return;
  r.ta.focus();
  r.ta.setSelectionRange(caret, caret);
}

let activeId = null;
function syncActive(t, force = false) {
  const st = t + 1e-3 - s.offset;
  const line = lines.find((l) => st >= lineStart(l) && st < lineEnd(l) + 0.3);
  const id = line?.id ?? null;
  if (id === activeId && !force) return;
  rows.get(activeId)?.row.classList.remove('is-active');
  activeId = id;
  const r = rows.get(id);
  if (!r) return;
  r.row.classList.add('is-active');
  // Keep the active line visible inside the list without scrolling the page, unless the user is typing.
  if (listEl.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;
  const top = r.row.offsetTop - listEl.offsetTop;
  if (top < listEl.scrollTop || top + r.row.offsetHeight > listEl.scrollTop + listEl.clientHeight) {
    listEl.scrollTop = top - listEl.clientHeight / 3;
  }
}

/* ---------- Transcription ---------- */
async function runTranscription() {
  if (!media || busy) return;
  if (lines.length && !confirm('Replace the current transcript with a new one?')) return;
  busy = true;
  runBtn.disabled = true;
  stage.pause();
  const ctrl = new AbortController();
  const modal = progressModal('Preparing audio…', () => ctrl.abort(), 'Reading the audio track from your video.');
  const collected = [];
  try {
    const blob = await (await fetch(media.url)).blob();
    const audio = await decodeAudio(blob);
    if (ctrl.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (audio.length < 1600) throw new Error('The audio track is too short to transcribe.');
    const device = await pickDevice(s.device);
    const total = await modelBytes(s.model, device);
    const cached = await isCached(s.model, device);
    modal.phase(cached ? 'Loading model…' : 'Downloading model…',
      cached ? 'Loading Whisper from your browser cache.' : `Whisper ${s.model}: ${formatBytes(total)}. This happens once; next time it loads from the cache.`);
    let transcribing = false;
    setLines([], { save: false });
    const res = await transcribe(audio, {
      model: s.model, device, language: s.language || null, signal: ctrl.signal,
      onDownload: (loaded, tot) => {
        if (transcribing) return;
        modal.set(loaded / tot);
        if (!cached) modal.message(`Whisper ${s.model}: ${formatBytes(loaded)} of ${formatBytes(tot)}. This happens once; next time it loads from the cache.`);
      },
      onProgress: (p) => {
        if (!transcribing) {
          transcribing = true;
          modal.phase('Transcribing…', `Listening to ${formatTime(audio.length / 16000)} of audio. Words appear in the transcript as they’re recognized.`);
        }
        modal.set(p);
      },
      onWords: (words) => {
        collected.push(...words);
        setLines(buildLines(collected), { save: false });
      },
    });
    setLines(buildLines(res.words));
    updateModelInfo();
    if (!res.words.length) toast('No speech was found in this video.', 'warning', 6000);
    else toast(`Transcribed ${res.words.length} words${res.device === 'wasm' && device === 'webgpu' ? ' (WebGPU failed, so it ran on the CPU)' : ''}.`, 'success');
  } catch (err) {
    if (err.name === 'AbortError') {
      toast(collected.length ? 'Transcription stopped. Kept the words recognized so far.' : 'Transcription cancelled.');
      setLines(buildLines(collected));
    } else {
      console.error(err);
      toast(/fetch|network|load/i.test(err.message) ? `Couldn’t download the speech model. Check your connection or content blocker. (${err.message})` : err.message || 'Transcription failed.', 'error', 9000);
      if (collected.length) setLines(buildLines(collected));
    }
  } finally {
    modal.close();
    busy = false;
    runBtn.disabled = !media;
    updateMeta();
  }
}

/* ---------- Rendering ---------- */
function render(t) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!media) { ctx.fillStyle = '#111318'; ctx.fillRect(0, 0, W, H); return; }
  ctx.drawImage(media.el, 0, 0, W, H);
  const st = t - s.offset; // source time of the captions
  drawCaption(ctx, pageAt(pages, st), st, s);
  syncActive(t);
}

function showHint() {
  if (!media) {
    overlay.className = 'preview-overlay';
    overlay.hidden = false;
    overlay.innerHTML = '<div><strong>Drop a video with speech on the left.</strong><br>It’s transcribed on your device: nothing is uploaded.</div>';
  } else if (!lines.length && !busy) {
    overlay.className = 'preview-overlay is-note';
    overlay.hidden = false;
    overlay.innerHTML = '<div>Press <strong>Transcribe</strong> to generate captions.</div>';
  } else overlay.hidden = true;
}

const isVideo = () => media?.kind === 'video';

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: () => (isVideo() ? media.duration : 5),
  getVideo: () => (isVideo() ? media.el : null),
});

const baseName = () => (media?.name || 'captions').replace(/\.[^.]+$/, '');
const subtitleFile = (kind) => {
  const text = kind === 'srt' ? toSRT(pages, { offset: s.offset, upper: s.uppercase }) : toVTT(pages, { offset: s.offset, upper: s.uppercase });
  downloadBlob(new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }), `${baseName()}.${kind}`);
  toast(`Saved ${baseName()}.${kind}`, 'success');
};

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `${baseName()}-captions`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  actions: [
    { label: 'SRT', icon: 'file', onClick: () => subtitleFile('srt'), show: () => lines.length > 0 },
    { label: 'VTT', icon: 'file', onClick: () => subtitleFile('vtt'), show: () => lines.length > 0 },
  ],
  hint: () => (media && !lines.length ? 'Transcribe first to burn captions in.' : ''),
});

canvas.width = 1280; canvas.height = 720;
showHint();
updateModelInfo();
ensureFont(s.family, s.weight, () => stage.invalidate());
