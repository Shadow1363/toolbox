/*
 * Audio Extractor: transcript files (TXT, SRT, VTT, JSON, Markdown) from timed lines.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   transcriptFile('srt', { lines, name, language, task, model, duration }, { timestamps }) → { text, ext, mime }
 *   lines = [{ id, words: [{ text, start, end }] }]   (lib/transcript.js)
 */
import { lineText, lineStart, lineEnd, timeline, toSRT, toVTT } from '/assets/js/lib/transcript.js';
import { languageName } from '/assets/js/lib/whisper.js';

/** [hh:]mm:ss for plain-text timestamps. */
export function stampShort(t) {
  t = Math.max(0, Math.floor(t));
  const hh = Math.floor(t / 3600), mm = Math.floor(t / 60) % 60, ss = t % 60;
  const p = (n) => String(n).padStart(2, '0');
  return hh ? `${hh}:${p(mm)}:${p(ss)}` : `${p(mm)}:${p(ss)}`;
}

/** One cue per transcript line, ending when the line ends (or just before the next). */
const cues = (lines) => timeline(lines, 9999, { linger: 0.3, bridge: 0.3 });

export const TRANSCRIPT_FORMATS = [['txt', 'TXT'], ['srt', 'SRT'], ['vtt', 'VTT'], ['json', 'JSON'], ['md', 'Markdown']];

export function transcriptFile(kind, doc, { timestamps = true } = {}) {
  const { lines } = doc;
  switch (kind) {
    case 'txt':
      return {
        ext: 'txt', mime: 'text/plain',
        text: timestamps
          ? lines.map((l) => `[${stampShort(lineStart(l))}] ${lineText(l)}`).join('\n')
          : paragraphs(lines),
      };
    case 'srt': return { ext: 'srt', mime: 'application/x-subrip', text: toSRT(cues(lines)) };
    case 'vtt': return { ext: 'vtt', mime: 'text/vtt', text: toVTT(cues(lines)) };
    case 'json':
      return {
        ext: 'json', mime: 'application/json',
        text: JSON.stringify({
          file: doc.name, language: doc.language, task: doc.task, model: doc.model ? `whisper-${doc.model}` : undefined,
          duration: doc.duration != null ? +doc.duration.toFixed(3) : undefined,
          segments: lines.map((l) => ({ start: lineStart(l), end: lineEnd(l), text: lineText(l), words: l.words.map((w) => ({ text: w.text, start: w.start, end: w.end })) })),
        }, null, 2),
      };
    case 'md': {
      const head = [`# ${doc.name ? doc.name.replace(/\.[^.]+$/, '') : 'Transcript'}`, ''];
      const meta = [doc.language && `Language: ${languageName(doc.language)}${doc.task === 'translate' ? ' (translated to English)' : ''}`, doc.duration && `Length: ${stampShort(doc.duration)}`].filter(Boolean);
      if (meta.length) head.push(`_${meta.join(' · ')}_`, '');
      const body = timestamps
        ? lines.map((l) => `**[${stampShort(lineStart(l))}]** ${lineText(l)}`).join('\n\n')
        : paragraphs(lines).replace(/\n/g, '\n\n');
      return { ext: 'md', mime: 'text/markdown', text: `${head.join('\n')}\n${body}\n` };
    }
    default: throw new Error(`Unknown transcript format ${kind}`);
  }
}

/** Plain prose: lines joined into paragraphs, breaking where the speaker paused for over 1.5 s. */
function paragraphs(lines) {
  const out = [];
  let cur = [];
  lines.forEach((l, i) => {
    if (i && lineStart(l) - lineEnd(lines[i - 1]) > 1.5 && cur.length) { out.push(cur.join(' ')); cur = []; }
    cur.push(lineText(l));
  });
  if (cur.length) out.push(cur.join(' '));
  return out.join('\n');
}
