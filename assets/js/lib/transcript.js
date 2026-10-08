/*
 * Transcript model (Auto Captions, Audio Extractor, Waveform Video). Lines of timed words, edits that keep timing, caption pages, SRT/VTT.

 *
 *   line = { id, words: [{ text, start, end }] }     // seconds, in source time
 *
 * A line is the unit the user edits (merge/split). On screen a line is shown as one or more
 * "pages" of at most `maxWords` words (pagesOf). SRT/VTT export one cue per page.
 */

let nextId = 1;
export const newLine = (words) => ({ id: nextId++, words });

/** Group recognized words into lines: break on long pauses, sentence ends and length. */
export function buildLines(
  words,
  { maxGap = 0.7, maxWords = 14, maxDur = 7 } = {},
) {
  const lines = [];
  let cur = [];
  const flush = () => {
    if (cur.length) lines.push(newLine(cur));
    cur = [];
  };
  for (const w of words) {
    const prev = cur[cur.length - 1];
    if (prev) {
      const gap = w.start - prev.end;
      const sentenceEnd = /[.!?…]["')\]]?$/.test(prev.text) && cur.length >= 3;
      if (
        gap > maxGap ||
        sentenceEnd ||
        cur.length >= maxWords ||
        w.end - cur[0].start > maxDur
      )
        flush();
    }
    cur.push({
      text: w.text,
      start: w.start,
      end: Math.max(w.end, w.start + 0.04),
    });
  }
  flush();
  return lines;
}

export const lineText = (line) => line.words.map((w) => w.text).join(" ");
export const lineStart = (line) => line.words[0]?.start ?? 0;
export const lineEnd = (line) => line.words[line.words.length - 1]?.end ?? 0;

const norm = (s) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^\p{L}\p{N}']/gu, "");

/**
 * Replace a line's text and keep timing: words that still match (LCS on normalized text) keep their
 * times; new or changed words share the time of the words they replace (or the gap they sit in),
 * in proportion to their length.
 */
export function retime(words, text) {
  const tokens = text.split(/\s+/).filter(Boolean);
  if (!tokens.length) return [];
  if (!words.length)
    return tokens.map((t) => ({ text: t, start: 0, end: 0.3 }));
  const a = words.map((w) => norm(w.text));
  const b = tokens.map(norm);
  // LCS table
  const n = a.length,
    m = b.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] && a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  const pairs = []; // [i, j] matched
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (a[i] && a[i] === b[j]) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  const out = new Array(m);
  for (const [i, j] of pairs)
    out[j] = { text: tokens[j], start: words[i].start, end: words[i].end };
  // Fill the unmatched runs between anchors.
  const anchors = [[-1, -1], ...pairs, [n, m]];
  for (let k = 0; k + 1 < anchors.length; k++) {
    const [i0, j0] = anchors[k],
      [i1, j1] = anchors[k + 1];
    const run = tokens.slice(j0 + 1, j1);
    if (!run.length) continue;
    let t0, t1;
    if (i1 - i0 > 1) {
      t0 = words[i0 + 1].start;
      t1 = words[i1 - 1].end;
    } // replaced words: take their span
    else {
      t0 = i0 >= 0 ? words[i0].end : words[0].start;
      t1 = i1 < n ? words[i1].start : words[n - 1].end;
      if (t1 - t0 < 0.08 * run.length) {
        // no gap: borrow half of the neighbours' time
        const left = i0 >= 0 ? words[i0] : null,
          right = i1 < n ? words[i1] : null;
        if (left) {
          t0 = (left.start + left.end) / 2;
          if (out[j0]) out[j0].end = t0;
        }
        if (right) {
          t1 = (right.start + right.end) / 2;
          if (out[j1]) out[j1].start = t1;
        }
        if (!left && !right) {
          t0 = words[0].start;
          t1 = t0 + 0.3 * run.length;
        }
      }
    }
    const weights = run.map((t) => Math.max(1, t.length));
    const sum = weights.reduce((x, y) => x + y, 0);
    let t = t0;
    run.forEach((tok, r) => {
      const d = ((t1 - t0) * weights[r]) / sum;
      out[j0 + 1 + r] = { text: tok, start: t, end: t + d };
      t += d;
    });
  }
  return out.map((w) => ({
    text: w.text,
    start: +w.start.toFixed(3),
    end: +Math.max(w.end, w.start + 0.02).toFixed(3),
  }));
}

/** Split a line before word index `at`. Returns the two new lines. */
export function splitLine(line, at) {
  at = Math.max(1, Math.min(line.words.length - 1, at));
  return [newLine(line.words.slice(0, at)), newLine(line.words.slice(at))];
}

export const mergeLines = (a, b) => newLine([...a.words, ...b.words]);

/** Index of the word that holds character offset `pos` in lineText(line). */
export function wordIndexAt(line, pos) {
  let c = 0;
  for (let i = 0; i < line.words.length; i++) {
    c += line.words[i].text.length + 1;
    if (pos < c) return i + (pos >= c - 1 ? 1 : 0);
  }
  return line.words.length;
}

/** A line cut into pages of at most maxWords words (each page: { words, start, end }). */
export function pagesOf(line, maxWords) {
  const pages = [];
  const n = Math.max(1, maxWords | 0);
  // Balance the pages (e.g. 7 words at max 3 → 3, 2, 2 rather than 3, 3, 1).
  const count = Math.ceil(line.words.length / n);
  const size = Math.ceil(line.words.length / count);
  for (let i = 0; i < line.words.length; i += size) {
    const words = line.words.slice(i, i + size);
    pages.push({
      words,
      start: words[0].start,
      end: words[words.length - 1].end,
    });
  }
  return pages;
}

/** Every page of every line, in time order, with `until` = when it should disappear. */
export function timeline(
  lines,
  maxWords,
  { linger = 0.6, bridge = 0.35 } = {},
) {
  const pages = lines
    .flatMap((l) => pagesOf(l, maxWords))
    .sort((p, q) => p.start - q.start);
  pages.forEach((p, i) => {
    const next = pages[i + 1];
    // Stay up until the next page starts when the gap is short (no flicker), else linger a little.
    p.until =
      next && next.start - p.end < bridge
        ? next.start
        : Math.min(p.end + linger, next ? next.start : Infinity);
  });
  return pages;
}

/** The page on screen at time t (binary search), or null. */
export function pageAt(pages, t) {
  let lo = 0,
    hi = pages.length - 1,
    found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (pages[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  const p = pages[found];
  return p && t < p.until ? p : null;
}

/* ---------- Subtitle files ---------- */
const stamp = (t, sep) => {
  t = Math.max(0, t);
  const ms = Math.round(t * 1000);
  const hh = Math.floor(ms / 3600000),
    mm = Math.floor(ms / 60000) % 60,
    ss = Math.floor(ms / 1000) % 60;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}${sep}${String(ms % 1000).padStart(3, "0")}`;
};

const pageText = (p, upper) => {
  const s = p.words.map((w) => w.text).join(" ");
  return upper ? s.toUpperCase() : s;
};

export function toSRT(pages, { offset = 0, upper = false } = {}) {
  return pages
    .map(
      (p, i) =>
        `${i + 1}\n${stamp(p.start + offset, ",")} --> ${stamp(p.until + offset, ",")}\n${pageText(p, upper)}\n`,
    )
    .join("\n");
}

/** WebVTT with inline word timestamps (<00:00:01.200>), which players use for karaoke-style display. */
export function toVTT(pages, { offset = 0, upper = false } = {}) {
  const cues = pages.map((p) => {
    const body = p.words
      .map((w, i) => {
        const txt = (upper ? w.text.toUpperCase() : w.text)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;");
        return i === 0 ? txt : `<${stamp(w.start + offset, ".")}>${txt}`;
      })
      .join(" ");
    return `${stamp(p.start + offset, ".")} --> ${stamp(p.until + offset, ".")}\n${body}\n`;
  });
  return `WEBVTT\n\n${cues.join("\n")}`;
}
