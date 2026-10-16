/*
 * Auto Editor: local analysis of the transcript and audio (no DOM, runs in Node for tests).
 *
 *   levels(samples, sr)                 → { db: Float32Array (one value per 10 ms), hop, floor, speech, threshold }
 *   findSilences(lv, { minLen })        → [{ start, end }] quiet stretches (seconds)
 *   findFillers(words, lv)              → [{ start, end, text, kind: 'token' | 'soft' | 'voiced' }]
 *   sentences(words)                    → [{ start, end, text, words, i0, i1 }]
 *   findRepeats(sentences)              → [{ start, end, text, retry }] earlier takes the speaker redid
 *
 * Whisper drops most "um"/"uh", so besides filler tokens, a gap between words where the audio is
 * clearly above the silence threshold is reported as a 'voiced' filler (a sound that wasn't a word).
 */

const HOP = 0.01; // seconds per level frame
const WIN = 0.03; // RMS window

/** RMS level in dBFS every 10 ms, with an adaptive silence threshold between the noise floor and speech. */
export function levels(samples, sr) {
  const hop = Math.round(HOP * sr), win = Math.round(WIN * sr);
  const n = Math.max(0, Math.floor((samples.length - win) / hop) + 1);
  const db = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    const a = i * hop;
    for (let j = a; j < a + win; j++) s += samples[j] * samples[j];
    db[i] = 10 * Math.log10(s / win + 1e-12);
  }
  const sorted = Float32Array.from(db).sort();
  const pct = (p) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))] : -100);
  const floor = Math.max(-90, pct(0.1));
  const speech = pct(0.9);
  // Above the floor by a third of the speech range (at least 6 dB), but well under typical speech.
  const threshold = Math.min(speech - 12, floor + Math.max(6, (speech - floor) * 0.35));
  return { db, hop: HOP, floor, speech, threshold };
}

/** Mean dB over [start, end) seconds. */
export function levelAt(lv, start, end) {
  const a = Math.max(0, Math.floor(start / lv.hop)), b = Math.min(lv.db.length, Math.ceil(end / lv.hop));
  if (b <= a) return -100;
  let s = 0;
  for (let i = a; i < b; i++) s += lv.db[i];
  return s / (b - a);
}

/** Quiet stretches of at least minLen seconds. Short loud blips (< 60 ms) inside a pause don't split it. */
export function findSilences(lv, { minLen = 0.3 } = {}) {
  const out = [];
  const quiet = (i) => lv.db[i] < lv.threshold;
  let i = 0;
  const n = lv.db.length;
  while (i < n) {
    if (!quiet(i)) { i++; continue; }
    let j = i;
    for (;;) {
      while (j < n && quiet(j)) j++;
      let k = j;
      while (k < n && !quiet(k) && k - j < 6) k++;
      if (k < n && k - j < 6 && quiet(k)) j = k; else break;
    }
    const start = i * lv.hop, end = Math.min(n, j) * lv.hop + (j >= n ? WIN : 0);
    if (end - start >= minLen) out.push({ start: round(start), end: round(end) });
    i = j;
  }
  return out;
}

const round = (v) => Math.round(v * 1000) / 1000;
export const norm = (t) => String(t).toLowerCase().replace(/[^\p{L}\p{N}']+/gu, '');

const FILLER = /^(u+m+|u+h+m*|e+r+m*|a+h+|h+m+|m+h*m+|e+h+)$/;
const SOFT = new Set(['like', 'basically', 'actually', 'literally']);

/** Filler words: tokens (um, uh, erm), soft fillers (like, basically; for the AI to judge) and voiced gaps. */
export function findFillers(words, lv, { minGap = 0.3 } = {}) {
  const out = [];
  words.forEach((w, i) => {
    const t = norm(w.text);
    if (FILLER.test(t)) out.push({ start: w.start, end: w.end, text: w.text.trim(), kind: 'token' });
    else if (SOFT.has(t)) out.push({ start: w.start, end: w.end, text: w.text.trim(), kind: 'soft' });
    const next = words[i + 1];
    if (lv && next && next.start - w.end >= minGap) {
      // Voiced: most of the gap is above the silence threshold.
      const a = Math.floor(w.end / lv.hop), b = Math.floor(next.start / lv.hop);
      let loud = 0;
      for (let k = a; k < b && k < lv.db.length; k++) if (lv.db[k] >= lv.threshold) loud++;
      if (b > a && loud / (b - a) > 0.6) out.push({ start: round(w.end + 0.02), end: round(next.start - 0.02), text: '(sound)', kind: 'voiced' });
    }
  });
  return out;
}

/** Sentences: split on . ! ? or pauses over 0.7 s. */
export function sentences(words, { maxGap = 0.7 } = {}) {
  const out = [];
  let cur = null;
  words.forEach((w, i) => {
    if (cur && w.start - words[i - 1].end > maxGap) { out.push(cur); cur = null; }
    if (!cur) cur = { start: w.start, end: w.end, words: [], i0: i, i1: i };
    cur.words.push(w);
    cur.end = w.end;
    cur.i1 = i;
    if (/[.!?]["')\]]*$/.test(w.text.trim())) { out.push(cur); cur = null; }
  });
  if (cur) out.push(cur);
  for (const s of out) s.text = s.words.map((w) => w.text.trim()).join(' ');
  return out;
}

/** Longest common subsequence length of two token lists. */
function lcs(a, b) {
  const dp = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let prev = 0;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = a[i - 1] === b[j - 1] ? prev + 1 : Math.max(dp[j], dp[j - 1]);
      prev = tmp;
    }
  }
  return dp[b.length];
}

/**
 * Retakes: a sentence (or run of sentences) that the speaker says again soon after. Compares each sentence with
 * the start of the next few sentences within `window` seconds; when most of its words reappear in order, the
 * earlier one is the retake. Returns the range to cut (from the retake's start to the redo's start).
 */
export function findRepeats(sents, { window = 20, minWords = 3, ratio = 0.6 } = {}) {
  const out = [];
  for (let i = 0; i < sents.length; i++) {
    const a = sents[i].words.map((w) => norm(w.text)).filter(Boolean);
    if (a.length < minWords) continue;
    for (let j = i + 1; j < sents.length && sents[j].start - sents[i].end <= window; j++) {
      const b = sents[j].words.map((w) => norm(w.text)).filter(Boolean).slice(0, Math.round(a.length * 1.5) + 2);
      const score = lcs(a, b) / a.length;
      if (score >= ratio) {
        out.push({ start: sents[i].start, end: sents[j].start, text: sents[i].text, retry: sents[j].text, score: round(score) });
        break;
      }
    }
  }
  // Keep the earliest of overlapping ranges merged.
  return out.filter((r, k) => !out.some((o, m) => m < k && o.end > r.start && o.start <= r.start && o.end >= r.end));
}
