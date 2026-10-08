/**
 * Audio and video with ffmpeg.wasm (single-threaded core: no special server headers needed).
 * The ~32 MB engine downloads on the first media conversion only, then the browser caches it.
 * Runs entirely in memory, so very large files can fail; the UI warns about size first.
 */
import { loadLib, LIBS, workerUrl } from '/assets/js/lib/cdn.js';
import { ConvertError } from '../registry.js';
import { extOf } from '../formats.js';

const VIDEO_IN = ['mp4', 'webm', 'mov', 'mkv', 'avi', 'gif'];
const VIDEO_OUT = ['mp4', 'webm', 'mov', 'gif'];
const AUDIO_IN = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
const AUDIO_OUT = ['mp3', 'wav', 'ogg'];
export const MEDIA_NOTE = 'Converted by ffmpeg inside your browser: slower than a desktop app (often near real time for video), and very large files can run out of memory.';

let engine = null;
async function ffmpeg(ctx) {
  if (engine) return engine;
  ctx.status?.('Downloading the converter engine (~32 MB, only once)…');
  const { FFmpeg } = await loadLib('ffmpeg');
  const ff = new FFmpeg();
  try {
    await ff.load({ classWorkerURL: workerUrl(LIBS.ffmpegWorker.url), coreURL: LIBS.ffmpegCore.url, wasmURL: LIBS.ffmpegWasm.url });
  } catch (err) {
    console.error(err);
    throw new ConvertError('Couldn\'t start the audio/video engine. Check your connection, then try again.');
  }
  engine = ff;
  return ff;
}

/* ----- options ----- */
const videoQuality = { id: 'videoQuality', type: 'segmented', label: 'Video quality', value: 'balanced', options: [['small', 'Smaller file'], ['balanced', 'Balanced'], ['high', 'High']] };
const maxWidth = { id: 'maxWidth', type: 'select', label: 'Max width', value: '0', options: [['0', 'Original'], ['1920', '1920 px'], ['1280', '1280 px'], ['854', '854 px'], ['640', '640 px']] };
const gifFps = { id: 'gifFps', type: 'segmented', label: 'GIF frame rate', value: '12', options: [['8', '8'], ['12', '12'], ['15', '15'], ['24', '24']] };
const gifWidth = { id: 'gifWidth', type: 'select', label: 'GIF width', value: '480', options: [['320', '320 px'], ['480', '480 px'], ['640', '640 px'], ['800', '800 px']] };
const audioQuality = { id: 'audioQuality', type: 'segmented', label: 'Audio quality', value: 'high', options: [['low', 'Low'], ['medium', 'Medium'], ['high', 'High']] };

const CRF = { small: [32, 40], balanced: [26, 30], high: [21, 22] }; // [x264, vp8]
const scale = (o) => (+o.maxWidth ? ['-vf', `scale='min(${+o.maxWidth},iw)':-2`] : []);

function argsFor(to, o) {
  const [x264, vp8] = CRF[o.videoQuality] || CRF.balanced;
  const mp3q = { low: '6', medium: '4', high: '2' }[o.audioQuality] || '2';
  const vorbisq = { low: '2', medium: '4', high: '6' }[o.audioQuality] || '6';
  switch (to) {
    case 'mp4': case 'mov':
      return [...scale(o), '-c:v', 'libx264', '-preset', 'veryfast', '-crf', String(x264), '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '160k', '-movflags', '+faststart'];
    case 'webm':
      return [...scale(o), '-c:v', 'libvpx', '-deadline', 'realtime', '-cpu-used', '8', '-crf', String(vp8), '-b:v', '8M', '-c:a', 'libvorbis', '-q:a', '5'];
    case 'gif':
      return ['-vf', `fps=${+o.gifFps || 12},scale='min(${+o.gifWidth || 480},iw)':-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`, '-loop', '0'];
    case 'mp3': return ['-vn', '-c:a', 'libmp3lame', '-q:a', mp3q];
    case 'wav': return ['-vn', '-c:a', 'pcm_s16le'];
    case 'ogg': return ['-vn', '-c:a', 'libvorbis', '-q:a', vorbisq];
    default: throw new ConvertError(`No ffmpeg recipe for ${to}.`);
  }
}

function converter(from, to) {
  const video = VIDEO_OUT.includes(to) && to !== 'gif';
  return {
    from, to, heavy: true, note: MEDIA_NOTE,
    options: to === 'gif' ? [gifFps, gifWidth] : video ? [videoQuality, maxWidth] : [audioQuality],
    async convert(item, o, ctx) {
      const ff = await ffmpeg(ctx);
      const input = `in.${extOf(item.name) || from}`;
      const output = `out.${to}`;
      const onProgress = ({ progress }) => { if (progress >= 0 && progress <= 1) ctx.progress?.(progress); };
      const tail = [];
      const onLog = ({ message }) => { tail.push(message); if (tail.length > 30) tail.shift(); };
      ff.on('progress', onProgress);
      ff.on('log', onLog);
      const abort = () => { ff.terminate(); engine = null; };
      ctx.signal?.addEventListener('abort', abort, { once: true });
      try {
        ctx.status?.('Converting…');
        await ff.writeFile(input, new Uint8Array(await item.arrayBuffer()));
        const code = await ff.exec(['-hide_banner', '-i', input, ...argsFor(to, o), '-y', output]);
        if (ctx.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (code !== 0) {
          const why = tail.reverse().find((l) => /error|invalid|does not contain|no such|not supported|unknown/i.test(l));
          throw new ConvertError(why && /does not contain any stream|Output file .* does not contain/i.test(why)
            ? `${item.name} has no ${video || to === 'gif' ? 'video' : 'audio'} track to convert.`
            : `ffmpeg couldn't convert ${item.name}${why ? `: ${why.trim()}` : ' (unsupported codec or corrupt file)'}.`);
        }
        const data = await ff.readFile(output);
        return item.as(to, data);
      } catch (err) {
        if (ctx.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
        if (/memory|OOM|Aborted\(\)/i.test(String(err?.message))) {
          engine = null;
          throw new ConvertError(`${item.name} is too large to convert in the browser (ran out of memory). Try a shorter clip.`);
        }
        throw err;
      } finally {
        ctx.signal?.removeEventListener('abort', abort);
        if (engine) {
          ff.off('progress', onProgress);
          ff.off('log', onLog);
          await Promise.allSettled([ff.deleteFile(input), ff.deleteFile(output)]);
        }
      }
    },
  };
}

export default [
  ...VIDEO_IN.flatMap((from) => [...VIDEO_OUT, ...AUDIO_OUT].filter((to) => to !== from && !(from === 'gif' && AUDIO_OUT.includes(to))).map((to) => converter(from, to))),
  ...AUDIO_IN.flatMap((from) => AUDIO_OUT.filter((to) => to !== from).map((to) => converter(from, to))),
];
