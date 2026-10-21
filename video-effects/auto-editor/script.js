/*
 * Auto Editor: a talking-head video in, a short-form edit out. Everything runs locally.
 *
 * Flow: upload (decode the audio) → Analyze and edit: transcribe (Whisper) → pauses, fillers, retakes (analyze.js)
 * → screenshot text (ocr.js) → face track (head-tracking.js) → local plan (edl.js) → apply: time map, cleaned and
 * cut audio (audio.js), render plan (compose.js). The decision list toggles each cut/effect; the caption text card
 * (script-edit.js) fixes transcript words; the captions can be dragged on the preview. The preview and every
 * export draw through compose.renderFrame. See AGENTS.md (Auto Editor) for the EDL and the pipeline.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone, createFilePicker } from '/assets/js/lib/upload.js';
import { loadMedia, MediaError } from '/assets/js/lib/media.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { h, icon, toast, downloadBlob, formatBytes, formatTime } from '/assets/js/lib/dom.js';
import { fit } from '/assets/js/lib/canvas.js';
import { loadAudio, resample } from '/assets/js/lib/audio-io.js';
import { encodeWav } from '/assets/js/lib/audio-export.js';
import { cleanAudio, CLEAN_DEFAULTS } from '/assets/js/lib/audio-clean.js';
import { transcribe, pickDevice, modelBytes, isCached, WHISPER_MODELS, WHISPER_LANGUAGES, SAMPLE_RATE } from '/assets/js/lib/whisper.js';
import { trackHead, smoothTrack } from '/assets/js/lib/head-tracking.js';
import { buildLines, toSRT, toVTT } from '/assets/js/lib/transcript.js';
import { CAPTION_PRESETS } from '/assets/js/lib/captions.js';
import { canEncode, encodeVideo, openFrames } from '/assets/js/lib/video-encode.js';
import { EFFECTS } from '/assets/js/lib/effects/index.js';
import { captionPages } from '/assets/js/lib/effects/captions.js';
import { transcriptFile } from '/audio/extractor/formats.js';
import { levels, findSilences, findFillers, sentences, findRepeats } from './analyze.js';
import { retimeWords } from './timemap.js';
import { STYLE_PRESETS, localPlan, validateEdl } from './edl.js';
import { cutAudio, silence } from './audio.js';
import { buildPlan, renderFrame, outputDims, captionBand } from './compose.js';
import { createPlayback } from './playback.js';
import { createSteps, cached, fileKey } from './pipeline.js';
import { renderDecisions } from './decisions.js';
import { ocrImage, OCR_BYTES } from './ocr.js';
import { replaceLineWords, renderScript } from './script-edit.js';
import { kvGet, kvSet, kvDel } from '/assets/js/lib/kv.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const overlay = document.getElementById('overlay');
const runBtn = document.getElementById('run');
const cancelBtn = document.getElementById('cancel');
const editMeta = document.getElementById('edit-meta');
const decisionsEl = document.getElementById('decisions');
const decisionsMeta = document.getElementById('decisions-meta');
const scriptEl = document.getElementById('script');
const scriptMeta = document.getElementById('script-meta');
const scriptReset = document.getElementById('script-reset');

let media = null, file = null, playback = null;
let shots = [];          // [{ id, name, note, ocr, el, width, height, key }]
let shotSeq = 0;
let A = null;            // analysis: { buffer, mono, lv, words, language, silences, fillers, repeats, face }
let edited = null;       // caption words after your transcript fixes (source time), or null; saved under editsKey
let editsKey = '';
let capMoved = false;    // you placed the captions yourself: keep that position when the caption style changes
let edl = null, plan = null;
let wet = null, cleanedKey = '', cleaned = null;
let outAudio = null, outKey = '', audioUrl = null;
let busy = false, ctrl = null, applyToken = 0, encodeOk = false, exporting = false;
const audioEl = new Audio();
audioEl.preload = 'auto';

/* ---------- Panel ---------- */
const EDIT_KEYS = ['keepPause', 'cutFillers', 'punchIn', 'punchZoom', 'zoomEvery', 'captions', 'captionStyle', 'progress', 'hook', 'shotLayout'];
const presetPatch = (p) => Object.fromEntries(EDIT_KEYS.map((k) => [k, p[k]]));
function presetPosY(style) { return CAPTION_PRESETS.find((p) => p.value === style)?.patch.posY ?? 82; }
const modelInfo = h('div', { class: 'ae-model-info', 'aria-live': 'polite' });

const panel = createControls(document.getElementById('controls'), [
  { title: 'Style', controls: [
    { id: 'style', type: 'presets', label: 'Preset', value: 'energetic', options: Object.entries(STYLE_PRESETS).map(([value, p]) => ({ label: p.label, value, patch: presetPatch(p) })) },
  ] },
  { title: 'Output', controls: [
    { id: 'aspect', type: 'segmented', label: 'Aspect ratio', value: '9:16', options: [['9:16', '9:16'], ['1:1', '1:1'], ['4:5', '4:5'], ['16:9', '16:9'], ['source', 'Source']] },
    { id: 'res', type: 'segmented', label: 'Resolution', value: '1080', options: [['720', '720p'], ['1080', '1080p']] },
  ] },
  { title: 'Cuts', controls: [
    { id: 'keepPause', type: 'range', label: 'Longest pause kept', min: 0.05, max: 1, step: 0.05, value: 0.15, unit: 's', decimals: 2, hint: 'Longer pauses are shortened to this.' },
    { id: 'cutFillers', type: 'toggle', label: 'Cut “um” and “uh”', value: true },
  ] },
  { title: 'Look', controls: [
    { id: 'captions', type: 'toggle', label: 'Captions', value: true },
    { id: 'captionStyle', type: 'select', label: 'Caption style', value: 'bold', options: CAPTION_PRESETS.map((p) => [p.value, p.label]), showIf: (st) => st.captions },
    { id: 'capPos', type: 'range', label: 'Caption position', min: 5, max: 95, step: 1, value: presetPosY('bold'), unit: '%', hint: 'From the top. You can also drag the captions in the preview.', showIf: (st) => st.captions },
    { id: 'capSize', type: 'range', label: 'Caption size', min: 50, max: 160, step: 5, value: 100, unit: '%', showIf: (st) => st.captions },
    { id: 'punchIn', type: 'toggle', label: 'Punch in on every other cut', value: true },
    { id: 'punchZoom', type: 'range', label: 'Punch-in zoom', min: 1.04, max: 1.3, step: 0.01, value: 1.12, decimals: 2, unit: '×', showIf: (st) => st.punchIn },
    { id: 'zoomEvery', type: 'range', label: 'Zoom about every', min: 0, max: 15, step: 1, value: 6, unit: 's', hint: '0 = no zooms.' },
    { id: 'shotLayout', type: 'segmented', label: 'Screenshots', value: 'card', options: [['card', 'Card'], ['full-pip', 'Full + corner']] },
    { id: 'hook', type: 'toggle', label: 'Suggest a hook title', value: true },
    { id: 'progress', type: 'toggle', label: 'Progress bar', value: false },
  ] },
  { title: 'Audio', controls: [
    { id: 'cleanup', type: 'toggle', label: 'Clean up audio', value: true, hint: 'Noise reduction, voice EQ, gentle compression and loudness (Audio Cleanup).' },
    { id: 'nrMix', type: 'range', label: 'Noise reduction', min: 0, max: 1, step: 0.05, value: 0.85, showIf: (st) => st.cleanup, format: (v) => `${Math.round(v * 100)}%` },
    { id: 'target', type: 'select', label: 'Loudness', value: 'youtube', showIf: (st) => st.cleanup, options: [['youtube', 'Social / YouTube (−14 LUFS)'], ['podcast', 'Podcast (−16 LUFS)'], ['voice', 'Voice (−19 LUFS)'], ['broadcast', 'Broadcast (−23 LUFS)'], ['off', 'Leave as is']] },
  ] },
  { title: 'Analysis', controls: [
    { id: 'model', type: 'select', label: 'Speech model', value: 'base', options: WHISPER_MODELS },
    { id: 'language', type: 'select', label: 'Language', value: '', options: WHISPER_LANGUAGES },
    { id: 'device', type: 'segmented', label: 'Run on', value: 'auto', options: [['auto', 'Auto'], ['webgpu', 'GPU'], ['wasm', 'CPU']] },
    { type: 'custom', el: modelInfo },
    { id: 'ocr', type: 'toggle', label: 'Read text in screenshots', value: true, hint: `Helps match screenshots to what you say. First use downloads ~${formatBytes(OCR_BYTES)}.` },
    { id: 'trackFace', type: 'toggle', label: 'Follow my face', value: true, hint: 'Keeps you centred when reframing, and aims zooms at you.' },
  ] },
], { persist: 'auto-editor', onChange });
const s = panel.state;

function onChange(st, id) {
  if (['model', 'device', 'language'].includes(id)) return updateModelInfo();
  if (['ocr', 'trackFace'].includes(id)) return;
  if (id === 'style' || id === 'captionStyle') {
    // A new caption style brings its own position, unless you placed the captions yourself.
    if (!capMoved) panel.set({ capPos: presetPosY(s.captionStyle) }, { silent: true });
  }
  if (id === 'capPos') capMoved = true;
  if (!edl) { resize(); stage.invalidate(); return; }
  if (id === 'style' || ['keepPause', 'cutFillers', 'zoomEvery', 'hook', 'shotLayout'].includes(id)) {
    if (A?.words) regenerate();
    return;
  }
  if (id === 'punchIn' || id === 'punchZoom') edl.camera = { ...edl.camera, punchIn: s.punchIn, punchZoom: s.punchZoom };
  if (['captions', 'captionStyle', 'capPos', 'capSize'].includes(id)) edl.captions = { enabled: s.captions, params: { ...edl.captions.params, ...captionParams() } };
  if (id === 'progress') edl.progress = { ...edl.progress, enabled: s.progress };
  if (['cleanup', 'nrMix', 'target'].includes(id)) edl.audio = { cleanup: s.cleanup, nrMix: s.nrMix, target: s.target };
  apply();
}

/** Caption params from the panel: the style, plus your position and size on top of it. */
function captionParams() {
  const size = CAPTION_PRESETS.find((p) => p.value === s.captionStyle)?.patch.size ?? 64;
  return { preset: s.captionStyle, posY: s.capPos, size: Math.max(20, Math.min(180, Math.round((size * s.capSize) / 100))) };
}

let infoToken = 0;
async function updateModelInfo() {
  const token = ++infoToken;
  try {
    const device = await pickDevice(s.device);
    const [bytes, isIn] = await Promise.all([modelBytes(s.model, device), isCached(s.model, device)]);
    if (token !== infoToken) return;
    modelInfo.replaceChildren(
      h('span', { class: isIn ? 'is-cached' : '' }, isIn ? `✓ Downloaded (${formatBytes(bytes)}), works offline` : `Download: ${formatBytes(bytes)}, once`),
      h('span', {}, device === 'webgpu' ? 'Runs on your GPU (WebGPU).' : 'Runs on your CPU (WebAssembly).'));
  } catch { modelInfo.textContent = ''; }
}

/* ---------- Steps ---------- */
const steps = createSteps(document.getElementById('steps'), [
  { id: 'decode', label: 'Read the audio' },
  { id: 'transcribe', label: 'Transcribe' },
  { id: 'analyze', label: 'Find pauses, fillers and retakes' },
  { id: 'ocr', label: 'Read the screenshots' },
  { id: 'face', label: 'Follow your face' },
  { id: 'plan', label: 'Plan the edit' },
  { id: 'audio', label: 'Clean up and cut the audio' },
]);

/* ---------- Video upload ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video'],
  label: 'Drop your talking-head video',
  onLoad: (m) => setVideo(m),
  onClear: () => setVideo(null),
});

async function setVideo(m) {
  ctrl?.abort();
  playback?.dispose();
  media = m;
  playback = null;
  A = null; edited = null; editsKey = ''; edl = null; plan = null; wet = null; cleaned = null; cleanedKey = ''; outAudio = null; outKey = '';
  steps.reset();
  renderDecisionsNow();
  renderScriptNow();
  runBtn.disabled = !m;
  editMeta.textContent = '';
  if (!m) {
    setAudio(null);
    showNote();
    exportBar.refresh();
    return;
  }
  overlay.hidden = true;
  const blob = await (await fetch(m.url)).blob();
  file = new File([blob], m.name, { type: blob.type, lastModified: 0 }); // stable key for the analysis cache
  if (m.duration > 600) toast('This video is over 10 minutes. Analysis and export will be slow and use a lot of memory.', 'warning', 9000);
  else if (m.duration > 180) toast('Short-form edits work best under 3 minutes; longer videos take a while to analyze.', 'warning', 7000);
  playback = createPlayback(m, { onSeeked: () => stage.invalidate() });
  // Show the uncut video right away (centre crop, no captions), then decode the audio for the clock.
  edl = { version: 1, source: 'local', summary: '', cuts: [], layers: [], captions: { enabled: false, params: {} }, camera: { reframe: 'center', punchIn: false, punchZoom: 1.12 }, audio: { cleanup: false, target: 'off', nrMix: 0.85 }, progress: { enabled: false, params: {} } };
  await decode();
  await apply();
  stage.reset();
}

async function decode() {
  if (A?.buffer) return;
  steps.set('decode', { status: 'run', detail: '' });
  let buffer;
  try {
    ({ buffer } = await loadAudio(file, { fallback: true }));
  } catch (err) {
    console.warn(err);
    buffer = silence(media.duration);
    toast('This video has no sound we could read, so it will be edited silently.', 'warning', 7000);
  }
  const mono = (await resample(buffer, SAMPLE_RATE, 1)).getChannelData(0).slice();
  A = { buffer, mono, lv: levels(mono, SAMPLE_RATE) };
  steps.set('decode', { status: 'done', detail: `${formatTime(buffer.duration)}, ${buffer.numberOfChannels === 1 ? 'mono' : 'stereo'}` });
}

/* ---------- Screenshots ---------- */
const shotList = document.getElementById('shots');
createFilePicker(document.getElementById('shots-drop'), {
  multiple: true,
  accept: 'image/*,.heic,.heif',
  label: 'Drop screenshots',
  hint: 'PNG, JPG, WebP',
  onFiles: async (files) => {
    for (const f of files) {
      try {
        const m = await loadMedia(f, { accept: ['image'] });
        shots.push({ id: `img${++shotSeq}`, name: f.name, note: '', ocr: null, el: m.el, width: m.width, height: m.height, key: fileKey(f), url: m.url, dispose: m.dispose });
      } catch (err) {
        toast(err instanceof MediaError ? err.message : `Couldn’t read ${f.name}.`, 'error');
      }
    }
    renderShots();
    if (edl && A?.words) regenerate();
  },
});

function renderShots() {
  shotList.replaceChildren(...shots.map((sh) => {
    const note = h('input', { type: 'text', value: sh.note, placeholder: 'Note (optional)', 'aria-label': `Note for ${sh.id}` });
    note.addEventListener('change', () => { sh.note = note.value; if (A?.words) regenerate(); });
    const remove = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Remove ${sh.id}`, html: icon('x') });
    remove.addEventListener('click', () => {
      shots = shots.filter((x) => x !== sh);
      sh.dispose();
      if (edl) edl.layers = edl.layers.filter((l) => !(l.effect === 'screenshot' && l.params?.image === sh.id));
      renderShots();
      if (edl) apply();
    });
    return h('li', { class: 'ae-shot' },
      h('img', { src: sh.url, alt: '' }),
      h('div', { class: 'ae-shot-body' },
        h('div', { class: 'ae-shot-head' }, h('strong', {}, sh.id), h('span', { title: sh.name }, sh.name)),
        note,
        sh.ocr ? h('details', {}, h('summary', {}, 'Text found'), h('p', {}, sh.ocr)) : ''),
      remove);
  }));
}

/* ---------- Analyze and edit ---------- */
runBtn.addEventListener('click', () => run());
cancelBtn.addEventListener('click', () => ctrl?.abort());

async function run() {
  if (!media || busy) return;
  busy = true;
  ctrl = new AbortController();
  const { signal } = ctrl;
  runBtn.disabled = true;
  cancelBtn.hidden = false;
  stage.pause();
  const fk = fileKey(file);
  let step = 'decode';
  try {
    await decode();

    step = 'transcribe';
    const device = await pickDevice(s.device);
    const tkey = `words:${fk}:${s.model}:${s.language || 'auto'}`;
    steps.set('transcribe', { status: 'run', detail: 'Loading the speech model…', progress: 0 });
    const total = await modelBytes(s.model, device);
    const res = await cached(tkey, async () => {
      let transcribing = false;
      const r = await transcribe(A.mono.slice(), {
        model: s.model, device, language: s.language || null, signal,
        onDownload: (loaded, tot) => { if (!transcribing) steps.set('transcribe', { detail: `Downloading Whisper ${s.model}: ${formatBytes(loaded)} of ${formatBytes(tot || total)}`, progress: loaded / (tot || total) }); },
        onProgress: (p) => { transcribing = true; steps.set('transcribe', { detail: 'Listening…', progress: p }); },
      });
      return { words: r.words, language: r.language || s.language || 'en' };
    });
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    A.words = res.value.words;
    A.language = res.value.language;
    editsKey = `auto-editor:edits:${tkey}`;
    edited = (await kvGet(editsKey).catch(() => null)) || null;
    steps.set('transcribe', { status: 'done', detail: `${A.words.length} words${res.hit ? ' (saved earlier)' : ''}` });
    updateModelInfo();

    step = 'analyze';
    A.silences = findSilences(A.lv, { minLen: 0.25 });
    A.fillers = findFillers(A.words, A.lv);
    A.repeats = findRepeats(sentences(A.words));
    steps.set('analyze', { status: 'done', detail: `${A.silences.length} pauses, ${A.fillers.filter((f) => f.kind === 'token').length} filler words, ${A.repeats.length} possible retakes` });

    step = 'ocr';
    const todo = s.ocr ? shots.filter((x) => x.ocr == null) : [];
    if (!todo.length) steps.set('ocr', { status: 'skip', detail: !shots.length ? 'No screenshots' : s.ocr ? 'Already read' : 'Off' });
    else {
      steps.set('ocr', { status: 'run', detail: 'Loading the text reader…', progress: 0 });
      for (const [i, sh] of todo.entries()) {
        const r = await cached(`ocr:${sh.key}:${A.language}`, () => ocrImage(sh.el, {
          lang: A.language, signal,
          onProgress: (p) => steps.set('ocr', { detail: `Reading ${sh.id}`, progress: (i + p) / todo.length }),
        }));
        sh.ocr = r.value || '';
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      }
      renderShots();
      steps.set('ocr', { status: 'done', detail: `${todo.length} screenshot${todo.length > 1 ? 's' : ''} read` });
    }

    step = 'face';
    if (!s.trackFace) { A.face = null; steps.set('face', { status: 'skip', detail: 'Off' }); }
    else {
      steps.set('face', { status: 'run', detail: 'Loading the face model…', progress: 0 });
      const r = await cached(`face:${fk}:5`, async () => {
        const v = document.createElement('video');
        Object.assign(v, { muted: true, playsInline: true, preload: 'auto', src: media.url });
        await new Promise((ok, no) => { v.onloadeddata = ok; v.onerror = () => no(new Error('Couldn’t read the video for face tracking.')); });
        try {
          return await trackHead({ el: v, kind: 'video', width: media.width, height: media.height, duration: media.duration }, {
            fps: 5, signal, onProgress: (p) => steps.set('face', { detail: 'Watching…', progress: p }),
          });
        } finally { v.removeAttribute('src'); v.load(); }
      });
      if (signal.aborted || !r.value) throw new DOMException('Cancelled', 'AbortError');
      A.face = smoothTrack(r.value, { strength: 0.9, hold: 1, fadeOut: 0.6, fadeIn: 0.3 });
      steps.set('face', { status: 'done', detail: A.face.found ? `Found in ${Math.round((A.face.found / A.face.total) * 100)}% of the video` : 'No face found; using the centre' });
    }

    step = 'plan';
    regenerate({ fromRun: true });
    await applyDone;
  } catch (err) {
    if (err.name === 'AbortError') {
      steps.set(step, { status: 'error', detail: 'Cancelled' });
      toast('Stopped.');
    } else {
      console.error(err);
      steps.set(step, { status: 'error', detail: err.message || 'Failed' });
      toast(/fetch|network|load/i.test(err.message) ? `Couldn’t download a model. Check your connection or content blocker. (${err.message})` : err.message || 'Analysis failed.', 'error', 9000);
    }
  } finally {
    busy = false;
    ctrl = null;
    runBtn.disabled = !media;
    runBtn.textContent = A?.words ? 'Analyze again' : 'Analyze and edit';
    cancelBtn.hidden = true;
  }
}

/** Build the local plan from the analysis and the current settings. */
let applyDone = Promise.resolve();
function regenerate() {
  if (!A?.words) return;
  const raw = localPlan(
    { duration: media.duration, words: A.words, silences: A.silences, fillers: A.fillers, shots },
    { ...s, cleanup: s.cleanup, target: s.target, nrMix: s.nrMix },
  );
  const v = validateEdl(raw, { duration: media.duration, imageIds: shots.map((x) => x.id), effects: EFFECTS });
  if (!v.edl) {
    console.error(v.errors);
    toast('The automatic edit came out invalid; showing the video uncut.', 'error');
    return;
  }
  edl = v.edl;
  edl.captions = { ...edl.captions, params: { ...edl.captions.params, ...captionParams() } };
  steps.set('plan', { status: 'done', detail: edl.summary });
  applyDone = apply();
}

/* ---------- Apply the EDL ---------- */
async function apply() {
  if (!media || !edl) return;
  const token = ++applyToken;
  const dims = outputDims(s.aspect, +s.res, media);
  const images = Object.fromEntries(shots.map((x) => [x.id, { el: x.el, width: x.width, height: x.height }]));
  const next = await buildPlan({ edl, duration: media.duration, size: media, out: dims, words: capWords(), face: A?.face || null, images });
  if (token !== applyToken) return;
  plan = next;
  resize();
  renderDecisionsNow();
  renderScriptNow();
  encodeOk = await canEncode(plan.W, plan.H);
  await updateAudio(token);
  if (token !== applyToken) return;
  const removed = media.duration - plan.tm.duration;
  editMeta.textContent = `${formatTime(media.duration)} → ${formatTime(plan.tm.duration)}${removed > 0.05 ? ` (−${removed.toFixed(1)} s)` : ''}`;
  stage.invalidate();
  exportBar.refresh();
}

/** Clean the full source once per setting (cached), then cut it to the time map. */
async function updateAudio(token) {
  const a = edl.audio;
  const ckey = a.cleanup ? `${a.nrMix}:${a.target}` : 'raw';
  if (ckey !== cleanedKey) {
    if (a.cleanup) {
      steps.set('audio', { status: 'run', detail: wet ? 'Processing…' : 'Removing noise (first time downloads ~120 KB)…', progress: 0 });
      try {
        const res = await cleanAudio(A.buffer, { ...CLEAN_DEFAULTS, nr: 'rnnoise', nrMix: a.nrMix, target: a.target }, {
          wet: wet ?? undefined, onProgress: (p) => steps.set('audio', { progress: p }),
        });
        wet = res.wet;
        cleaned = res.buffer;
      } catch (err) {
        console.error(err);
        toast(`Audio cleanup failed, using the original sound. (${err.message})`, 'warning', 7000);
        cleaned = A.buffer;
      }
    } else cleaned = A.buffer;
    cleanedKey = ckey;
  }
  if (token !== applyToken) return;
  const key = `${ckey}|${plan.tm.segments.map((g) => `${g.in.toFixed(3)}-${g.out.toFixed(3)}`).join(',')}`;
  if (key !== outKey) {
    outAudio = cutAudio(cleaned, plan.tm);
    outKey = key;
    setAudio(outAudio);
  }
  steps.set('audio', { status: 'done', detail: a.cleanup ? `Cleaned (${a.target === 'off' ? 'level unchanged' : a.target}), ${plan.tm.segments.length} pieces joined` : `${plan.tm.segments.length} pieces joined` });
}

/** Swap the clock's soundtrack, keeping the playhead. */
function setAudio(buffer) {
  const t = Math.min(audioEl.currentTime || 0, buffer ? buffer.duration - 0.05 : 0);
  const wasPlaying = stage?.playing;
  if (audioUrl) URL.revokeObjectURL(audioUrl);
  audioUrl = buffer ? URL.createObjectURL(encodeWav(buffer, 16)) : null;
  if (!audioUrl) { audioEl.removeAttribute('src'); audioEl.load(); return; }
  audioEl.src = audioUrl;
  audioEl.addEventListener('loadedmetadata', () => {
    audioEl.currentTime = Math.max(0, t);
    if (wasPlaying) audioEl.play().catch(() => {});
    stage.invalidate();
  }, { once: true });
}

function renderDecisionsNow() {
  if (!edl || !plan || !A?.words) {
    decisionsEl.replaceChildren(h('p', { class: 'ae-empty' }, media ? 'Press Analyze and edit to plan the cuts and effects.' : 'Drop a video, then press Analyze and edit.'));
    decisionsMeta.textContent = '';
    return;
  }
  renderDecisions(decisionsEl, edl, {
    tm: plan.tm,
    onToggle: (item, on) => {
      if (on) delete item.off; else item.off = true;
      apply();
    },
    onSeek: (t) => { stage.pause(); stage.seek(Math.max(0, t - 0.5)); },
  });
  decisionsMeta.textContent = `${edl.cuts.filter((c) => !c.off).length} cuts · ${edl.layers.filter((l) => !l.off).length} effects`;
}

/* ---------- Caption text ---------- */
/** The words the captions and caption files use: the transcript with your fixes. */
function capWords() { return edited || A?.words || []; }

function renderScriptNow() {
  const has = !!(plan && A?.words);
  scriptReset.hidden = !edited;
  scriptMeta.textContent = has ? `${capWords().length} words${edited ? ', edited' : ''}` : '';
  if (!has) {
    scriptEl.replaceChildren(h('p', { class: 'ae-empty' }, 'The transcript appears here after Analyze and edit.'));
    return;
  }
  renderScript(scriptEl, capWords(), {
    tm: plan.tm,
    onEdit: (i0, n, text) => setEdited(replaceLineWords(capWords(), i0, n, text)),
    onSeek: (t) => { stage.pause(); stage.seek(Math.max(0, t)); },
  });
}

function setEdited(words) {
  edited = words;
  if (editsKey) (words ? kvSet(editsKey, words) : kvDel(editsKey)).catch(() => {});
  apply();
}

scriptReset.addEventListener('click', () => setEdited(null));

/* ---------- Drag the captions on the preview ---------- */
let drag = null;
const canvasY = (e) => {
  const r = canvas.getBoundingClientRect();
  return ((e.clientY - r.top) / r.height) * canvas.height;
};
function onCaption(y) {
  const c = plan?.captions;
  if (!c || !A?.words) return false;
  return Math.abs(y - (c.params.posY / 100) * plan.H) < Math.max(plan.captionHalf * plan.H * 1.15, plan.H * 0.04);
}
function moveCaptions(posY) {
  plan.captions.params.posY = posY;
  Object.assign(plan, captionBand(plan.captions.params, plan.k, plan.H));
  stage.invalidate();
}
canvas.addEventListener('pointerdown', (e) => {
  const y = canvasY(e);
  if (!onCaption(y) || exporting) return;
  e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  drag = { id: e.pointerId, offset: (plan.captions.params.posY / 100) * plan.H - y, from: plan.captions.params.posY };
  canvas.classList.add('is-cap-drag');
});
canvas.addEventListener('pointermove', (e) => {
  const y = canvasY(e);
  if (!drag) { canvas.classList.toggle('is-cap-hover', onCaption(y)); return; }
  if (e.pointerId !== drag.id || !plan?.captions) return;
  moveCaptions(Math.round(Math.max(5, Math.min(95, ((y + drag.offset) / plan.H) * 100)) * 2) / 2);
});
const endDrag = (e) => {
  if (!drag || e.pointerId !== drag.id) return;
  const posY = plan?.captions?.params.posY;
  canvas.classList.remove('is-cap-drag');
  drag = null;
  if (posY == null) return;
  capMoved = true;
  panel.set({ capPos: Math.round(posY) }, { silent: true });
  edl.captions = { ...edl.captions, params: { ...edl.captions.params, posY: s.capPos } };
  apply();
};
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('pointerleave', () => { if (!drag) canvas.classList.remove('is-cap-hover'); });

/* ---------- Render ---------- */
function resize() {
  const d = plan ? { W: plan.W, H: plan.H } : media ? outputDims(s.aspect, +s.res, media) : outputDims(s.aspect, 1080, { width: 1080, height: 1920 });
  if (canvas.width !== d.W || canvas.height !== d.H) { canvas.width = d.W; canvas.height = d.H; }
}

function render(t) {
  if (exporting) return; // the export shares the render scratch canvases
  if (!plan || !playback) {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (media) {
      const f = fit(media.width, media.height, canvas.width, canvas.height, 'cover');
      ctx.drawImage(media.el, f.x, f.y, f.w, f.h);
    }
    return;
  }
  playback.sync(plan.tm, t, stage.playing);
  renderFrame(ctx, plan, t, playback.frames(plan.tm, t));
}

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: () => plan?.tm.duration || media?.duration || 1,
  getVideo: () => (audioEl.src ? audioEl : null),
});

/* ---------- Export ---------- */
const baseName = () => (media?.name || 'edit').replace(/\.[^.]+$/, '');
const FPS = 30;

async function exportFrames({ signal, onProgress, includeAudio }) {
  const frames = await openFrames(file);
  const out = document.createElement('canvas');
  out.width = plan.W;
  out.height = plan.H;
  const octx = out.getContext('2d');
  const n = Math.max(1, Math.round(plan.tm.duration * FPS));
  const times = (function* () { for (let i = 0; i < n; i++) yield plan.tm.outToSrc(i / FPS); })();
  const it = frames.at(times)[Symbol.asyncIterator]();
  const firsts = new Map(); // transition id → first frame of the incoming segment
  exporting = true;
  try {
    return await encodeVideo({
      width: plan.W, height: plan.H, fps: FPS, duration: plan.tm.duration, signal, onProgress,
      audio: includeAudio ? outAudio : null,
      drawFrame: async (t) => {
        const { value: main } = await it.next();
        let next = null;
        const tr = plan.transitions.find((x) => t < x.t && x.t - t < x.d / 2);
        if (tr) {
          if (!firsts.has(tr.id)) {
            const c = await frames.get(tr.after.in);
            const copy = c && Object.assign(document.createElement('canvas'), { width: c.width, height: c.height });
            copy?.getContext('2d').drawImage(c, 0, 0);
            firsts.set(tr.id, copy);
          }
          next = firsts.get(tr.id);
        }
        renderFrame(octx, plan, t, { main, next });
        return out;
      },
    });
  } finally {
    exporting = false;
    frames.dispose();
  }
}

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `${baseName()}-edit`,
  getVideo: () => (audioEl.src ? audioEl : null),
  hasAudio: () => !!outAudio,
  video: () => !!plan,
  gif: () => !!plan,
  png: () => !!plan,
  hint: () => (plan && !encodeOk ? 'This browser can’t encode video frame by frame, so video export records in real time (WebM). Keep the tab visible.' : ''),
  renderVideo: {
    supported: () => encodeOk,
    message: () => `Rendering ${Math.round(plan.tm.duration * FPS)} frames at ${plan.W}×${plan.H} (${formatTime(plan.tm.duration)}). This runs faster than real time.`,
    run: exportFrames,
  },
  beforeExport: (kind) => { if (kind === 'video' && !encodeOk) playback?.release(); },
  prepareFrame: (t) => playback.exact(plan.tm, t),
  afterExport: () => { playback?.release(); stage.invalidate(); },
  actions: [
    { label: 'Captions (.srt)', icon: 'download', show: () => !!A?.words?.length && !!plan, onClick: () => saveCaptions('srt') },
    { label: '.vtt', icon: 'download', show: () => !!A?.words?.length && !!plan, onClick: () => saveCaptions('vtt') },
    { label: 'Transcript', icon: 'file', show: () => !!A?.words?.length && !!plan, onClick: saveTranscript },
    { label: 'Edit (.json)', icon: 'file', show: () => !!edl && !!A?.words, onClick: saveEdl },
  ],
});

function outPages() {
  if (plan.captions) return plan.captions.pages;
  return captionPages(buildLines(retimeWords(capWords(), plan.tm)), { maxWords: 6 });
}

function saveCaptions(kind) {
  const upper = !!plan.captions?.params.uppercase;
  const text = kind === 'srt' ? toSRT(outPages(), { upper }) : toVTT(outPages(), { upper });
  downloadBlob(new Blob([text], { type: kind === 'srt' ? 'application/x-subrip' : 'text/vtt' }), `${baseName()}-edit.${kind}`);
}

function saveTranscript() {
  const lines = buildLines(retimeWords(capWords(), plan.tm));
  const f = transcriptFile('txt', { lines, name: `${baseName()}-edit`, language: A.language, task: 'transcribe', model: s.model, duration: plan.tm.duration }, { timestamps: true });
  downloadBlob(new Blob([f.text], { type: f.mime }), `${baseName()}-edit.${f.ext}`);
}

function saveEdl() {
  const doc = {
    ...edl,
    video: { name: media.name, duration: media.duration, width: media.width, height: media.height },
    output: { aspect: s.aspect, height: plan.H, width: plan.W, duration: plan.tm.duration },
    screenshots: shots.map((x) => ({ id: x.id, name: x.name, note: x.note })),
    ...(edited ? { transcript: edited.map((w) => ({ text: w.text, start: +w.start.toFixed(3), end: +w.end.toFixed(3) })) } : {}),
  };
  downloadBlob(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }), `${baseName()}-edit.json`);
}

/* ---------- Start ---------- */
function showNote() {
  overlay.hidden = false;
  overlay.classList.add('is-note');
  overlay.innerHTML = '<div><strong>Drop a talking-head video on the left.</strong> Add screenshots you mention, then press <em>Analyze and edit</em>. Everything stays on your device.</div>';
}

showNote();
resize();
renderDecisionsNow();
renderScriptNow();
updateModelInfo();
