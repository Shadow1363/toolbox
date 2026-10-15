/*
 * Auto Editor: the edit decision list (EDL), its validation, the style presets and the local plan.
 * No DOM (the effect registry is passed in), so it runs in Node for tests.
 *
 * EDL v1, every time in SOURCE seconds (the transcript's clock):
 *   {
 *     version: 1, summary, source: 'local' | 'ai',
 *     cuts:   [{ id, start, end, kind: 'silence'|'filler'|'retake'|'trim'|'other', reason, off? }],
 *     layers: [{ id, effect, start, end, params, reason, off? }       // screenshot, text, zoom
 *              | { id, effect: 'transition', at: '<cut id>', params, reason, off? }],
 *     captions: { enabled, params },        // captions effect params (preset + overrides)
 *     camera:   { reframe: 'face'|'center', punchIn, punchZoom },
 *     audio:    { cleanup, target, nrMix },
 *     progress: { enabled, params },
 *   }
 * `off: true` keeps a decision in the list but doesn't apply it. Layer params store only what differs from
 * the effect's defaults; they're completed when the edit is applied.
 */
import { validateParams } from '../../assets/js/lib/effects/schema.js';
import { sentences, findRepeats, norm } from './analyze.js';

export const CUT_KINDS = ['silence', 'filler', 'retake', 'trim', 'other'];
export const AUDIO_TARGETS = ['podcast', 'youtube', 'broadcast', 'voice', 'off'];

/** Style presets: defaults for the edit panel. The AI and your instructions can override them. */
export const STYLE_PRESETS = {
  clean: { label: 'Clean', keepPause: 0.35, cutFillers: true, punchIn: false, punchZoom: 1.1, zoomEvery: 0, captions: true, captionStyle: 'classic', progress: false, hook: false, shotLayout: 'card', transitions: 'none' },
  energetic: { label: 'Energetic', keepPause: 0.15, cutFillers: true, punchIn: true, punchZoom: 1.12, zoomEvery: 6, captions: true, captionStyle: 'bold', progress: false, hook: true, shotLayout: 'card', transitions: 'some' },
  podcast: { label: 'Podcast clip', keepPause: 0.5, cutFillers: true, punchIn: false, punchZoom: 1.1, zoomEvery: 0, captions: true, captionStyle: 'karaoke', progress: true, hook: false, shotLayout: 'card', transitions: 'none' },
  tutorial: { label: 'Tutorial', keepPause: 0.3, cutFillers: true, punchIn: false, punchZoom: 1.1, zoomEvery: 0, captions: true, captionStyle: 'boxed', progress: false, hook: false, shotLayout: 'full-pip', transitions: 'none' },
};

const r3 = (v) => Math.round(v * 1000) / 1000;
const fmt = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

/* ---------- Validation ---------- */

/**
 * Check an EDL (from the AI, a file or the local plan) and return a clean copy.
 *   ctx = { duration, imageIds: ['img1', …], effects: EFFECTS }
 * Small problems (times slightly outside the video, out-of-range numbers) are fixed with a warning;
 * anything the editor can't apply (unknown effect or screenshot, bad times, unknown params) is an error.
 */
export function validateEdl(raw, { duration, imageIds = [], effects = [] }) {
  const errors = [];
  const warnings = [];
  const fx = new Map(effects.map((e) => [e.id, e]));
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { edl: null, errors: ['The edit must be a JSON object.'], warnings };
  const out = {
    version: 1,
    summary: typeof raw.summary === 'string' ? raw.summary : '',
    source: raw.source === 'ai' ? 'ai' : raw.source || 'local',
    cuts: [],
    layers: [],
  };
  const ids = new Set();
  const uid = (want, prefix) => {
    let id = typeof want === 'string' && want ? want : `${prefix}1`;
    let n = 1;
    while (ids.has(id)) id = `${prefix}${++n}`;
    ids.add(id);
    return id;
  };
  const time = (v, what) => {
    const n = typeof v === 'string' ? Number(v) : v;
    if (typeof n !== 'number' || !Number.isFinite(n)) { errors.push(`${what} must be a number of seconds`); return null; }
    if (n < -0.05 || n > duration + 0.05) warnings.push(`${what} ${n} is outside the video (0–${r3(duration)} s); clamped`);
    return r3(Math.min(duration, Math.max(0, n)));
  };
  const range = (item, what) => {
    const a = time(item.start, `${what} start`), b = time(item.end, `${what} end`);
    if (a == null || b == null) return null;
    if (b - a < 0.02) { errors.push(`${what} ends before it starts (${a}–${b})`); return null; }
    return [a, b];
  };
  const text = (v) => (typeof v === 'string' ? v : '');

  // Cuts
  if (raw.cuts != null && !Array.isArray(raw.cuts)) errors.push('cuts must be a list');
  for (const [i, c] of (Array.isArray(raw.cuts) ? raw.cuts : []).entries()) {
    const what = `cuts[${i}]${c?.id ? ` (${c.id})` : ''}`;
    if (!c || typeof c !== 'object') { errors.push(`${what} must be an object`); continue; }
    const rg = range(c, what);
    if (!rg) continue;
    let kind = c.kind;
    if (!CUT_KINDS.includes(kind)) { if (kind != null) warnings.push(`${what}: unknown kind "${kind}", using "other"`); kind = 'other'; }
    out.cuts.push({ id: uid(c.id, 'c'), start: rg[0], end: rg[1], kind, reason: text(c.reason), ...(c.off ? { off: true } : {}) });
  }
  const kept = duration - mergedLength(out.cuts.filter((c) => !c.off));
  if (kept < Math.min(1, duration * 0.5)) errors.push(`The cuts remove almost everything (${r3(kept)} s left).`);

  // Layers
  if (raw.layers != null && !Array.isArray(raw.layers)) errors.push('layers must be a list');
  for (const [i, l] of (Array.isArray(raw.layers) ? raw.layers : []).entries()) {
    const what = `layers[${i}]${l?.id ? ` (${l.id})` : ''}`;
    if (!l || typeof l !== 'object') { errors.push(`${what} must be an object`); continue; }
    const e = fx.get(l.effect);
    if (!e) { errors.push(`${what}: unknown effect "${l.effect}". Use one of: ${effects.filter((x) => !x.single).map((x) => x.id).join(', ')}`); continue; }
    if (e.single) { errors.push(`${what}: "${e.id}" is set once under "${e.id}", not as a layer`); continue; }
    const p = validateParams(e.params, l.params || {}, { partial: true });
    p.errors.forEach((m) => errors.push(`${what}: ${m}`));
    p.warnings.forEach((m) => warnings.push(`${what}: ${m}`));
    const base = { id: uid(l.id, e.id === 'transition' ? 'x' : e.id[0]), effect: e.id, params: p.params, reason: text(l.reason), ...(l.off ? { off: true } : {}) };
    if (e.kind === 'transition') {
      const cut = out.cuts.find((c) => c.id === l.at);
      if (!cut) { errors.push(`${what}: "at" must be the id of a cut (got ${JSON.stringify(l.at)})`); continue; }
      if (l.extra && typeof l.extra === 'object') base.extra = l.extra;
      out.layers.push({ ...base, at: cut.id });
      continue;
    }
    const rg = range(l, what);
    if (!rg) continue;
    if (e.id === 'screenshot' && !imageIds.includes(p.params.image)) {
      errors.push(`${what}: unknown screenshot "${p.params.image ?? ''}"${imageIds.length ? `. Use one of: ${imageIds.join(', ')}` : ' (no screenshots were uploaded)'}`);
      continue;
    }
    out.layers.push({ ...base, start: rg[0], end: rg[1] });
  }

  // Captions, progress: one each
  for (const key of ['captions', 'progress']) {
    const e = fx.get(key);
    const v = raw[key] || {};
    const p = e ? validateParams(e.params, v.params || {}, { partial: true }) : { params: {}, errors: [], warnings: [] };
    p.errors.forEach((m) => errors.push(`${key}: ${m}`));
    p.warnings.forEach((m) => warnings.push(`${key}: ${m}`));
    out[key] = { enabled: v.enabled ?? key === 'captions', params: p.params };
  }

  // Camera, audio
  const cam = raw.camera || {};
  out.camera = {
    reframe: cam.reframe === 'center' ? 'center' : 'face',
    punchIn: !!cam.punchIn,
    punchZoom: clampNum(cam.punchZoom, 1, 1.5, 1.12),
  };
  const au = raw.audio || {};
  if (au.target != null && !AUDIO_TARGETS.includes(au.target)) warnings.push(`audio.target "${au.target}" unknown, using "youtube"`);
  out.audio = {
    cleanup: au.cleanup ?? true,
    target: AUDIO_TARGETS.includes(au.target) ? au.target : 'youtube',
    nrMix: clampNum(au.nrMix, 0, 1, 0.85),
  };
  return { edl: errors.length ? null : out, draft: out, errors, warnings };
}

function clampNum(v, lo, hi, dflt) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
}

function mergedLength(cuts) {
  const list = cuts.map((c) => [c.start, c.end]).sort((a, b) => a[0] - b[0]);
  let total = 0, end = -Infinity;
  for (const [a, b] of list) {
    if (b <= end) continue;
    total += b - Math.max(a, end);
    end = b;
  }
  return total;
}

/* ---------- Local plan (no AI) ---------- */

const STOP = new Set('a an and are as at be but by for from has have i i\'m im in is it it\'s its just me my of on or our so that the this these those to was we what when with you your yeah okay ok look see here there check out comment post tweet chart page one'.split(' '));
const CUE = /\b(look at|check (this|out)|here'?s|this (comment|tweet|post|chart|graph|screenshot|message|review|page|article|reply|one)|someone (said|wrote|commented)|on screen|you can see)\b/i;

/**
 * Where each screenshot is mentioned: score every sentence by the distinctive words it shares with the screenshot's
 * note and OCR text, plus a bonus for pointing phrases ("look at this comment"). Returns [{ id, sentence, score }].
 */
export function matchScreenshots(shots, sents) {
  const out = [];
  const used = new Set();
  for (const shot of shots) {
    const bag = new Set(`${shot.note || ''} ${shot.ocr || ''}`.split(/\s+/).map(norm).filter((w) => w.length > 2 && !STOP.has(w)));
    let best = null;
    sents.forEach((s, i) => {
      if (used.has(i)) return;
      const toks = s.words.map((w) => norm(w.text)).filter((w) => w.length > 2 && !STOP.has(w));
      const shared = toks.filter((w) => bag.has(w)).length;
      const score = shared + (CUE.test(s.text) ? 1.5 : 0);
      if (score > (best?.score ?? 0)) best = { id: shot.id, index: i, sentence: s, score };
    });
    if (best && best.score >= 1.5) { used.add(best.index); out.push(best); }
  }
  return out;
}

/**
 * The edit the tool makes on its own: cut pauses (keeping `keepPause` of each) and filler tokens, captions,
 * audio cleanup, punch-ins and zooms from the preset, and screenshots where the transcript mentions them.
 * Riskier ideas (retakes, untranscribed sounds, a hook title) are added switched off, for you to review.
 *   a = { duration, words, silences, fillers, shots: [{ id, note, ocr }] }
 *   o = edit settings (STYLE_PRESETS fields + cleanup, target, nrMix)
 */
export function localPlan(a, o) {
  const D = a.duration;
  const cuts = [];
  let n = 0;
  const cut = (start, end, kind, reason, off = false) => {
    if (end - start >= 0.08) cuts.push({ id: `c${++n}`, start: r3(start), end: r3(end), kind, reason, ...(off ? { off: true } : {}) });
  };

  for (const s of a.silences || []) {
    const len = s.end - s.start;
    if (s.start <= 0.05) cut(0, s.end - 0.08, 'silence', `Silence at the start (${len.toFixed(1)} s)`);
    else if (s.end >= D - 0.05) cut(s.start + 0.15, D, 'silence', `Silence at the end (${len.toFixed(1)} s)`);
    else if (len > o.keepPause + 0.08) cut(s.start + o.keepPause / 2, s.end - o.keepPause / 2, 'silence', `Pause of ${len.toFixed(1)} s at ${fmt(s.start)}, shortened to ${o.keepPause.toFixed(2)} s`);
  }
  for (const f of a.fillers || []) {
    if (f.kind === 'token') cut(f.start - 0.02, f.end + 0.02, 'filler', `Filler word "${f.text}" at ${fmt(f.start)}`, !o.cutFillers);
    if (f.kind === 'voiced') cut(f.start, f.end, 'filler', `A sound between words at ${fmt(f.start)} that wasn't transcribed (often an "um"). Check it before cutting.`, true);
  }
  const sents = sentences(a.words || []);
  for (const r of findRepeats(sents)) cut(r.start, r.end, 'retake', `Possible retake: "${r.text}" is said again as "${r.retry}"`, true);

  const layers = [];
  let ln = 0;
  // Screenshots where they're mentioned.
  for (const m of matchScreenshots(a.shots || [], sents)) {
    const s = m.sentence;
    const end = Math.min(D, Math.max(s.end + 0.4, s.start + 3.5));
    layers.push({ id: `s${++ln}`, effect: 'screenshot', start: r3(Math.max(0, s.start - 0.1)), end: r3(end), params: { image: m.id, layout: o.shotLayout }, reason: `Mentioned in "${s.text.slice(0, 80)}"${m.score >= 2.5 ? '' : ' (weak match: check it)'}`, ...(m.score < 2.5 ? { off: true } : {}) });
  }
  // Zooms on sentence starts, about every `zoomEvery` seconds.
  if (o.zoomEvery > 0) {
    let last = -Infinity;
    for (const s of sents) {
      if (s.start - last < o.zoomEvery || s.end - s.start < 1.2) continue;
      if (layers.some((l) => l.effect === 'screenshot' && l.start < s.end && l.end > s.start)) continue;
      layers.push({ id: `z${++ln}`, effect: 'zoom', start: r3(s.start), end: r3(Math.min(s.end, s.start + 2.2)), params: { zoom: 1.25 }, reason: `Emphasis on "${s.text.slice(0, 60)}"` });
      last = s.start;
    }
  }
  // A hook title from the first sentence (off: the AI writes better hooks).
  if (o.hook && sents.length) {
    const first = sents[0];
    const words = first.text.split(/\s+/).slice(0, 7).join(' ').replace(/[.,!?]+$/, '');
    layers.push({ id: `t${++ln}`, effect: 'text', start: r3(first.start), end: r3(Math.min(first.start + 3, D)), params: { text: words }, reason: 'Hook title from your first sentence. Edit the text or let the AI write one.', off: true });
  }

  return {
    version: 1,
    source: 'local',
    summary: `Local edit: ${cuts.filter((c) => !c.off).length} cuts, ${layers.filter((l) => !l.off).length} effects.`,
    cuts,
    layers,
    captions: { enabled: o.captions, params: { preset: o.captionStyle } },
    camera: { reframe: 'face', punchIn: o.punchIn, punchZoom: o.punchZoom },
    audio: { cleanup: o.cleanup, target: o.target, nrMix: o.nrMix },
    progress: { enabled: o.progress, params: {} },
  };
}
