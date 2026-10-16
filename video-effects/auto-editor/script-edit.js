/*
 * Auto Editor: the editable caption transcript. The words stay in source time; editing a line replaces its words.
 * Words you didn't touch keep Whisper's timing; new or changed words share the time of the words they replace.
 *
 *   replaceLineWords(words, i0, n, text)   // pure: words[i0 .. i0+n) → the words of `text`
 *   renderScript(root, words, { tm, onEdit(i0, n, text), onSeek(outputTime) })
 */
import { h } from '/assets/js/lib/dom.js';
import { buildLines } from '/assets/js/lib/transcript.js';
import { retimeRange } from './timemap.js';

const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

export function replaceLineWords(words, i0, n, text) {
  const old = words.slice(i0, i0 + n);
  const toks = text.trim().split(/\s+/).filter(Boolean);
  let next;
  if (!old.length) return words;
  if (!toks.length) next = [];
  else if (toks.length === old.length) {
    next = old.map((w, j) => (w.text === toks[j] ? w : { ...w, text: toks[j], edited: true }));
  } else {
    // Keep the matching words at both ends with their times; spread the middle over the time it replaces.
    let p = 0, q = 0;
    while (p < toks.length && p < old.length && toks[p] === old[p].text) p++;
    while (q < toks.length - p && q < old.length - p && toks[toks.length - 1 - q] === old[old.length - 1 - q].text) q++;
    if (p + q >= old.length) { if (p > 0) p--; else q--; } // pure insertion: share a neighbour's time
    const mid = old.slice(p, old.length - q), toksMid = toks.slice(p, toks.length - q);
    const a = mid[0].start, b = mid[mid.length - 1].end;
    const weights = toksMid.map((t) => t.length + 1);
    const total = weights.reduce((x, y) => x + y, 0);
    let acc = 0;
    const spread = toksMid.map((t, j) => {
      const start = a + ((b - a) * acc) / total;
      acc += weights[j];
      return { text: t, start, end: a + ((b - a) * acc) / total, edited: true };
    });
    next = [...old.slice(0, p), ...spread, ...old.slice(old.length - q)];
  }
  return [...words.slice(0, i0), ...next, ...words.slice(i0 + n)];
}

export function renderScript(root, words, { tm, onEdit, onSeek }) {
  // Remember the focused line, so tabbing through the lines survives the re-render after an edit.
  const focused = root.contains(document.activeElement) ? document.activeElement.dataset.i : null;
  let i0 = 0;
  const rows = buildLines(words).map((line) => {
    const start = i0, n = line.words.length;
    i0 += n;
    const from = line.words[0].start, to = line.words[n - 1].end;
    const kept = !!retimeRange(from, to, tm, { minLen: 0.05 });
    const edited = words.slice(start, start + n).some((w) => w.edited);
    const text = line.words.map((w) => w.text).join(' ');
    const input = h('input', { type: 'text', value: text, 'data-i': String(start), spellcheck: 'true', 'aria-label': `Caption at ${clock(tm.srcToOut(from))}` });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') input.blur();
      if (e.key === 'Escape') { input.value = text; input.blur(); }
    });
    input.addEventListener('change', () => { if (input.value.trim() !== text) onEdit(start, n, input.value); });
    return h('li', { class: `ae-line${kept ? '' : ' is-cut'}${edited ? ' is-edited' : ''}`, title: kept ? '' : 'This line was cut from the video' },
      h('button', { type: 'button', class: 'ae-time', title: 'Jump there', onclick: () => onSeek(tm.srcToOut(from)) }, kept ? clock(tm.srcToOut(from)) : 'cut'),
      input);
  });
  root.replaceChildren(rows.length ? h('ul', { class: 'ae-lines' }, rows) : h('p', { class: 'ae-empty' }, 'No speech found.'));
  if (focused != null) root.querySelector(`input[data-i="${focused}"]`)?.focus();
}
