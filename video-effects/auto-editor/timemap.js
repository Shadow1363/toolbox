/*
 * Auto Editor: source time ↔ output time after cuts (no DOM, runs in Node for tests).
 *
 *   const tm = buildTimemap(cuts, duration, { clip })   // cuts: [{ start, end }] in source seconds (any order, may overlap)
 *   tm.segments   [{ index, clip, in, out, at }]        // kept source ranges; `at` = where each starts in the output
 *   tm.duration   output length
 *   tm.srcToOut(s)   a source time → output time (a time inside a cut maps to the cut point)
 *   tm.outToSrc(t)   → source time; tm.segmentAt(t) → the segment playing at output t
 *   tm.cutPoints  output times where a cut joins two segments, with the source range removed there
 *
 * Multi-clip ready: each segment carries its clip index (0 for a single video).
 */

const EPS = 1e-6;

/** Sort, clamp to [0, duration] and merge overlapping ranges (gaps under `join` seconds are merged too). */
export function mergeRanges(ranges, duration = Infinity, { join = 0.001 } = {}) {
  const list = ranges
    .map((r) => ({ start: Math.max(0, +r.start), end: Math.min(duration, +r.end) }))
    .filter((r) => Number.isFinite(r.start) && Number.isFinite(r.end) && r.end - r.start > EPS)
    .sort((a, b) => a.start - b.start);
  const out = [];
  for (const r of list) {
    const last = out[out.length - 1];
    if (last && r.start <= last.end + join) last.end = Math.max(last.end, r.end);
    else out.push({ ...r });
  }
  return out;
}

export function buildTimemap(cuts, duration, { clip = 0, minKeep = 0.04 } = {}) {
  const removed = mergeRanges(cuts, duration);
  const segments = [];
  let pos = 0, at = 0;
  for (const r of [...removed, { start: duration, end: duration }]) {
    if (r.start - pos >= minKeep) {
      segments.push({ index: segments.length, clip, in: pos, out: r.start, at });
      at += r.start - pos;
    }
    pos = Math.max(pos, r.end);
  }
  if (!segments.length) segments.push({ index: 0, clip, in: 0, out: Math.min(duration, minKeep), at: 0 });
  const total = at || segments[0].out - segments[0].in;

  const segmentAt = (t) => {
    let lo = 0, hi = segments.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (segments[mid].at <= t + EPS) lo = mid; else hi = mid - 1;
    }
    return segments[lo];
  };

  const outToSrc = (t) => {
    const s = segmentAt(Math.max(0, Math.min(total, t)));
    return Math.min(s.out, s.in + Math.max(0, t - s.at));
  };

  /** Source → output. Inside a cut (or before the first kept range) → the output time of the next kept range. */
  const srcToOut = (x) => {
    for (const s of segments) {
      if (x < s.in) return s.at;
      if (x <= s.out) return s.at + (x - s.in);
    }
    return total;
  };

  const cutPoints = segments.slice(1).map((s, i) => ({ t: s.at, from: segments[i].out, to: s.in, before: segments[i], after: s }));

  return { segments, duration: total, segmentAt, outToSrc, srcToOut, cutPoints, removed };
}

/**
 * Words that survive the cuts, moved to output time. Whisper often stretches a word's end into the pause after
 * it, so a word is kept when it overlaps a kept range by 80 ms or a third of its length, in the range it overlaps most.
 */
export function retimeWords(words, tm) {
  const out = [];
  for (const w of words) {
    let best = null, most = 0;
    for (const g of tm.segments) {
      if (g.in > w.end) break;
      const ov = Math.min(w.end, g.out) - Math.max(w.start, g.in);
      if (ov > most) { most = ov; best = g; }
    }
    if (!best || (most < 0.08 && most < (w.end - w.start) / 3)) continue;
    const start = tm.srcToOut(Math.max(w.start, best.in));
    const end = tm.srcToOut(Math.min(w.end, best.out));
    out.push({ ...w, start, end: Math.max(end, start + 0.04) });
  }
  return out;
}

/** A source range → output range, or null when (almost) all of it was cut. */
export function retimeRange(start, end, tm, { minLen = 0.2 } = {}) {
  const a = tm.srcToOut(start), b = tm.srcToOut(end);
  return b - a >= minLen ? { start: a, end: b } : null;
}
