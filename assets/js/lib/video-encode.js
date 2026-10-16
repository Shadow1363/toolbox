/*
 * Frame-by-frame video export with WebCodecs (mediabunny): faster than real time, frame exact, keeps working
 * in a background tab. MP4 (H.264 + AAC, or Opus where AAC can't be encoded) when the browser can encode H.264,
 * otherwise WebM (VP9 + Opus). Tools fall back to exporter.js's real-time recordStage when canEncode() is false.
 *
 *   if (await canEncode(W, H)) {
 *     const { blob, ext } = await encodeVideo({
 *       width, height, fps: 30, duration,
 *       drawFrame: async (t, i) => canvas,  // draw frame i (time t) and return the canvas to encode (width × height)
 *       audio: audioBuffer,                 // optional AudioBuffer, starting at t = 0
 *       onProgress, signal,
 *     });
 *   }
 *
 *   const frames = await openFrames(file);  // decode a video file's frames for drawFrame
 *   for await (const c of frames.at(times)) …  // times: monotonic seconds → canvases (null before the first frame)
 *   await frames.get(t)                     // one frame (random access; slower)
 */
import { loadLib } from './cdn.js';

let support = null;

/** The output container/codecs this browser can encode at this size, or null. */
export async function pickFormat(width, height) {
  if (typeof VideoEncoder === 'undefined') return null;
  const mb = await loadLib('mediabunny');
  const video = await mb.getFirstEncodableVideoCodec(['avc', 'vp9', 'av1', 'vp8'], { width, height });
  if (!video) return null;
  const mp4 = video === 'avc';
  const audio = await mb.getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus', 'vorbis'], { numberOfChannels: 2, sampleRate: 48000 });
  return { container: mp4 ? 'mp4' : 'webm', video, audio };
}

/** Can this browser export frame by frame? (Cached per size class.) */
export async function canEncode(width = 1080, height = 1920) {
  const key = `${width}x${height}`;
  if (support?.key === key) return !!support.format;
  let format = null;
  try { format = await pickFormat(width, height); } catch { format = null; }
  support = { key, format };
  return !!format;
}

/** Target bitrate: ~0.1 bits per pixel per frame, 4–24 Mbps. */
export const bitrateFor = (w, h, fps) => Math.round(Math.min(24e6, Math.max(4e6, w * h * fps * 0.1)));

export async function encodeVideo({ width, height, fps = 30, duration, drawFrame, audio = null, onProgress, signal }) {
  const mb = await loadLib('mediabunny');
  const format = await pickFormat(width, height);
  if (!format) throw new Error('This browser can’t encode video with WebCodecs.');
  const target = new mb.BufferTarget();
  const output = new mb.Output({
    format: format.container === 'mp4' ? new mb.Mp4OutputFormat({ fastStart: 'in-memory' }) : new mb.WebMOutputFormat(),
    target,
  });
  const n = Math.max(1, Math.round(duration * fps));
  let canvas = null, source = null, audioSource = null;
  const cancel = async () => { try { await output.cancel(); } catch { /* already done */ } };
  try {
    for (let i = 0; i < n; i++) {
      if (signal?.aborted) { await cancel(); return null; }
      const t = i / fps;
      const c = await drawFrame(t, i);
      if (!source) {
        canvas = c;
        source = new mb.CanvasSource(canvas, { codec: format.video, bitrate: bitrateFor(width, height, fps), keyFrameInterval: 2 });
        output.addVideoTrack(source, { frameRate: fps });
        if (audio && format.audio) {
          audioSource = new mb.AudioBufferSource({ codec: format.audio, quality: mb.QUALITY_HIGH });
          output.addAudioTrack(audioSource);
        }
        await output.start();
        if (audioSource) await audioSource.add(audio);
      } else if (c !== canvas) throw new Error('drawFrame must return the same canvas every frame.');
      await source.add(t, 1 / fps);
      onProgress?.((i + 1) / n);
      if (i % 8 === 7) await new Promise((r) => setTimeout(r)); // let the progress bar paint
    }
    await output.finalize();
  } catch (err) {
    await cancel();
    throw err;
  }
  const mime = format.container === 'mp4' ? 'video/mp4' : 'video/webm';
  return { blob: new Blob([target.buffer], { type: mime }), ext: format.container, format };
}

/**
 * Decoded frames of a video file. `at(times)` iterates canvases for monotonic times (each packet decoded once);
 * `get(t)` fetches one frame. Times are in the file's presentation seconds, as <video>.currentTime counts them.
 */
export async function openFrames(file, { width } = {}) {
  const mb = await loadLib('mediabunny');
  const input = new mb.Input({ source: new mb.BlobSource(file), formats: mb.ALL_FORMATS });
  const track = await input.getPrimaryVideoTrack();
  if (!track) throw new Error('No video track found in this file.');
  if (!(await track.canDecode())) throw new Error('This browser can’t decode the video’s codec.');
  const first = Math.max(0, await track.getFirstTimestamp());
  const opts = { poolSize: 3, ...(width ? { width } : {}) };
  const seq = new mb.CanvasSink(track, opts);
  const rand = new mb.CanvasSink(track, opts);
  return {
    async *at(times) {
      const shifted = (function* () { for (const t of times) yield t + first; })();
      for await (const w of seq.canvasesAtTimestamps(shifted)) yield w?.canvas || null;
    },
    async get(t) {
      return (await rand.getCanvas(t + first))?.canvas || null;
    },
    dispose() { input.dispose?.(); },
  };
}
