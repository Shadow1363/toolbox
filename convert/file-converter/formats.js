/**
 * Every format the converter knows, and detection: file signature ("magic bytes") first,
 * then extension, then a content sniff for text. Add a format here before registering
 * converters for it.
 */
export const FORMATS = {
  // Documents
  md: { label: 'Markdown', ext: ['md', 'markdown'], mime: 'text/markdown', kind: 'document', text: true },
  html: { label: 'HTML', ext: ['html', 'htm'], mime: 'text/html', kind: 'document', text: true },
  docx: { label: 'Word (DOCX)', ext: ['docx'], mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', kind: 'document' },
  pdf: { label: 'PDF', ext: ['pdf'], mime: 'application/pdf', kind: 'document' },
  txt: { label: 'Plain text', ext: ['txt', 'text', 'log'], mime: 'text/plain', kind: 'document', text: true },
  // Data
  csv: { label: 'CSV', ext: ['csv'], mime: 'text/csv', kind: 'data', text: true },
  tsv: { label: 'TSV', ext: ['tsv', 'tab'], mime: 'text/tab-separated-values', kind: 'data', text: true },
  json: { label: 'JSON', ext: ['json'], mime: 'application/json', kind: 'data', text: true },
  yaml: { label: 'YAML', ext: ['yaml', 'yml'], mime: 'application/yaml', kind: 'data', text: true },
  xml: { label: 'XML', ext: ['xml'], mime: 'application/xml', kind: 'data', text: true },
  xlsx: { label: 'Excel (XLSX)', ext: ['xlsx', 'xls', 'ods'], mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', kind: 'data' },
  // Images
  png: { label: 'PNG', ext: ['png'], mime: 'image/png', kind: 'image' },
  jpg: { label: 'JPG', ext: ['jpg', 'jpeg', 'jfif'], mime: 'image/jpeg', kind: 'image' },
  webp: { label: 'WebP', ext: ['webp'], mime: 'image/webp', kind: 'image' },
  bmp: { label: 'BMP', ext: ['bmp'], mime: 'image/bmp', kind: 'image' },
  gif: { label: 'GIF', ext: ['gif'], mime: 'image/gif', kind: 'image' },
  ico: { label: 'ICO (icon)', ext: ['ico'], mime: 'image/x-icon', kind: 'image' },
  svg: { label: 'SVG', ext: ['svg'], mime: 'image/svg+xml', kind: 'image', text: true },
  avif: { label: 'AVIF', ext: ['avif'], mime: 'image/avif', kind: 'image' },
  heic: { label: 'HEIC', ext: ['heic', 'heif'], mime: 'image/heic', kind: 'image' },
  // Audio / video
  mp4: { label: 'MP4', ext: ['mp4', 'm4v'], mime: 'video/mp4', kind: 'video' },
  webm: { label: 'WebM', ext: ['webm'], mime: 'video/webm', kind: 'video' },
  mov: { label: 'MOV', ext: ['mov', 'qt'], mime: 'video/quicktime', kind: 'video' },
  mkv: { label: 'MKV', ext: ['mkv'], mime: 'video/x-matroska', kind: 'video' },
  avi: { label: 'AVI', ext: ['avi'], mime: 'video/x-msvideo', kind: 'video' },
  mp3: { label: 'MP3', ext: ['mp3'], mime: 'audio/mpeg', kind: 'audio' },
  wav: { label: 'WAV', ext: ['wav'], mime: 'audio/wav', kind: 'audio' },
  ogg: { label: 'OGG', ext: ['ogg', 'oga'], mime: 'audio/ogg', kind: 'audio' },
  m4a: { label: 'M4A', ext: ['m4a', 'aac'], mime: 'audio/mp4', kind: 'audio' },
  flac: { label: 'FLAC', ext: ['flac'], mime: 'audio/flac', kind: 'audio' },
};

export const KINDS = { document: 'Documents', data: 'Data', image: 'Images', video: 'Video', audio: 'Audio' };

const BY_EXT = new Map(Object.entries(FORMATS).flatMap(([id, f]) => f.ext.map((e) => [e, id])));
export const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(name)?.[1] || '').toLowerCase();
export const formatFromName = (name) => BY_EXT.get(extOf(name)) || null;
export const outputName = (name, format) => `${name.replace(/\.[^./]+$/, '') || 'converted'}.${FORMATS[format].ext[0]}`;

export class DetectError extends Error {}

const ascii = (b, from, to) => String.fromCharCode(...b.subarray(from, to));
const starts = (b, ...bytes) => bytes.every((v, i) => b[i] === v);

/** Detect a File's format. Throws DetectError with a helpful message for known-unsupported files. */
export async function detect(file) {
  const head = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  const byExt = formatFromName(file.name);
  const sig = fromSignature(head, byExt);
  if (sig === 'zip') return zipKind(file, byExt);
  if (sig === 'ole') {
    if (byExt === 'xlsx') return 'xlsx'; // old .xls: SheetJS reads it
    throw new DetectError('Old Office files (.doc, .ppt) aren\'t supported. Re-save it as .docx and try again.');
  }
  if (sig) return sig;
  if (!head.includes(0) && head.length) {
    if (byExt && FORMATS[byExt].text) return byExt;
    return detectText(await file.slice(0, 64 * 1024).text());
  }
  if (byExt) return byExt;
  throw new DetectError(`Couldn't tell what kind of file “${file.name}” is.`);
}

function fromSignature(b, byExt) {
  if (starts(b, 0x25, 0x50, 0x44, 0x46)) return 'pdf';
  if (starts(b, 0x89, 0x50, 0x4e, 0x47)) return 'png';
  if (starts(b, 0xff, 0xd8, 0xff)) return 'jpg';
  if (ascii(b, 0, 4) === 'GIF8') return 'gif';
  if (ascii(b, 0, 4) === 'RIFF') {
    const t = ascii(b, 8, 12);
    if (t === 'WEBP') return 'webp';
    if (t === 'WAVE') return 'wav';
    if (t === 'AVI ') return 'avi';
  }
  if (starts(b, 0x42, 0x4d) && byExt === 'bmp') return 'bmp';
  if (starts(b, 0, 0, 1, 0) && (byExt === 'ico' || b[4] > 0)) return 'ico';
  if (ascii(b, 4, 8) === 'ftyp') {
    const brand = ascii(b, 8, 12);
    if (/^(heic|heix|hevc|heim|heis|mif1|msf1)$/.test(brand)) return 'heic';
    if (/^avi[fs]$/.test(brand)) return 'avif';
    if (brand === 'qt  ') return 'mov';
    if (/^M4A|^M4B/.test(brand)) return 'm4a';
    return byExt && FORMATS[byExt].kind === 'video' ? byExt : 'mp4';
  }
  if (starts(b, 0x1a, 0x45, 0xdf, 0xa3)) return ascii(b, 0, 64).includes('webm') ? 'webm' : 'mkv';
  if (ascii(b, 0, 4) === 'OggS') return 'ogg';
  if (ascii(b, 0, 4) === 'fLaC') return 'flac';
  if (ascii(b, 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0 && byExt === 'mp3')) return 'mp3';
  if (starts(b, 0x50, 0x4b, 0x03, 0x04)) return 'zip';
  if (starts(b, 0xd0, 0xcf, 0x11, 0xe0)) return 'ole';
  return null;
}

/** DOCX and XLSX are both ZIPs: look for their folder names near the start, then trust the extension. */
async function zipKind(file, byExt) {
  const text = new TextDecoder('latin1').decode(await file.slice(0, 256 * 1024).arrayBuffer());
  if (text.includes('word/')) return 'docx';
  if (text.includes('xl/')) return 'xlsx';
  if (byExt === 'docx' || byExt === 'xlsx') return byExt;
  throw new DetectError(`“${file.name}” is a ZIP archive. Unzip it first and drop the files inside.`);
}

/** Guess the format of plain text (pasted, or a file without a useful extension). */
export function detectText(text) {
  const t = text.replace(/^﻿/, '').trimStart();
  if (!t) return 'txt';
  if (/^[[{]/.test(t)) {
    try { JSON.parse(text); return 'json'; } catch { /* not JSON after all */ }
  }
  if (t.startsWith('<')) {
    const lead = t.slice(0, 2000).toLowerCase();
    if (/<svg[\s>]/.test(lead) && !/<html[\s>]/.test(lead)) return 'svg';
    if (/^<!doctype html|<html[\s>]|<(body|head|div|p|h[1-6]|table|ul|ol|span|a|br|img)[\s>/]/.test(lead)) return 'html';
    return 'xml';
  }
  const lines = t.split(/\r?\n/).filter((l) => l.trim()).slice(0, 30);
  const consistent = (ch) => {
    const n = lines.map((l) => l.split(ch).length - 1);
    return lines.length >= 2 && n[0] > 0 && n.filter((c) => c === n[0]).length >= lines.length * 0.8;
  };
  if (consistent('\t')) return 'tsv';
  if (/^(#{1,6}\s|[-*+]\s|\d+\.\s|>\s|```)|\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*/m.test(t)) return 'md';
  if (consistent(',')) return 'csv';
  const yamlish = lines.filter((l) => /^(---|\s*-\s|\s*[\w"' .-]+:(\s|$))/.test(l)).length;
  if (lines.length >= 2 && yamlish >= lines.length * 0.8 && /:\s|:$/m.test(t)) return 'yaml';
  return 'txt';
}
