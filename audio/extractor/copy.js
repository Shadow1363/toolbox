/*
 * Audio Extractor: "Original quality" export, copying the audio stream without re-encoding.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   const { blob, name } = await copyAudioStream(file, { track, start, end, onProgress, onStatus, signal });
 *
 * mediabunny remuxes first (MP4/MOV/WebM/MKV/OGG/MP3/WAV/FLAC in, no extra download): AAC → .m4a, Opus → .opus,
 * Vorbis → .ogg, MP3 → .mp3, FLAC → .flac, PCM → .wav, anything else → .mka. When it can't (AVI, odd codecs),
 * ffmpeg.wasm runs `-map 0:a:N -vn -c:a copy`. Trims land on packet boundaries (a few ms), as with any stream copy.
 */
import { loadLib } from '/assets/js/lib/cdn.js';
import { ffmpegRun, copyExtension } from '/assets/js/lib/ffmpeg.js';

const MIME = { m4a: 'audio/mp4', opus: 'audio/ogg', ogg: 'audio/ogg', mp3: 'audio/mpeg', flac: 'audio/flac', wav: 'audio/wav', mka: 'audio/x-matroska', ac3: 'audio/ac3', eac3: 'audio/eac3' };

function outputFor(mb, codec) {
  const c = String(codec || '');
  if (c === 'aac') return [new mb.Mp4OutputFormat(), 'm4a'];
  if (c === 'opus') return [new mb.OggOutputFormat(), 'opus'];
  if (c === 'vorbis') return [new mb.OggOutputFormat(), 'ogg'];
  if (c === 'mp3') return [new mb.Mp3OutputFormat(), 'mp3'];
  if (c === 'flac') return [new mb.FlacOutputFormat(), 'flac'];
  if (c.startsWith('pcm-') || c === 'ulaw' || c === 'alaw') return [new mb.WavOutputFormat(), 'wav'];
  return [new mb.MkvOutputFormat(), 'mka'];
}

async function viaMediabunny(file, { track, start, end, onProgress, signal }) {
  const mb = await loadLib('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  try {
    if (!(await input.canRead())) throw new Error('unreadable');
    const tracks = await input.getAudioTracks();
    const t = tracks[track];
    if (!t) throw new Error('no such track');
    const [format, ext] = outputFor(mb, t.codec);
    const output = new mb.Output({ format, target: new mb.BufferTarget() });
    const conversion = await mb.Conversion.init({
      input, output,
      video: { discard: true },
      audio: (tr) => (tr.id === t.id ? {} : { discard: true }),
      ...(start != null ? { trim: { start, end } } : {}),
      showWarnings: false,
    });
    if (!conversion.isValid) throw new Error('invalid conversion');
    // Refuse a silent re-encode: "original quality" must be a copy.
    if (conversion.utilizedTracks.length !== 1) throw new Error('track not used');
    conversion.onProgress = (p) => onProgress?.(p);
    const abort = () => conversion.cancel();
    signal?.addEventListener('abort', abort, { once: true });
    try { await conversion.execute(); } finally { signal?.removeEventListener('abort', abort); }
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    return { data: output.target.buffer, ext };
  } finally {
    input.dispose?.();
  }
}

/** Copy one audio track (optionally trimmed) without re-encoding. `codecHint` is the ffmpeg codec name, if known. */
export async function copyAudioStream(file, { track = 0, start = null, end = null, codecHint, onProgress, onStatus, signal } = {}) {
  const base = file.name.replace(/\.[^.]+$/, '');
  const suffix = start != null ? '-clip' : '';
  try {
    onStatus?.('Copying the audio stream (no re-encoding)…');
    const { data, ext } = await viaMediabunny(file, { track, start, end, onProgress, signal });
    return { blob: new Blob([data], { type: MIME[ext] || 'application/octet-stream' }), name: `${base}${suffix}.${ext}` };
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    console.info('mediabunny copy unavailable, using ffmpeg:', err.message);
  }
  const ext = copyExtension(codecHint);
  const trim = start != null ? ['-ss', start.toFixed(3), '-to', end.toFixed(3)] : [];
  const { data } = await ffmpegRun(file, (input) => [...trim, '-i', input, '-map', `0:a:${track}`, '-vn', '-c:a', 'copy'], `out.${ext}`, { onProgress, onStatus, signal });
  return { blob: new Blob([data], { type: MIME[ext] || 'application/octet-stream' }), name: `${base}${suffix}.${ext}` };
}
