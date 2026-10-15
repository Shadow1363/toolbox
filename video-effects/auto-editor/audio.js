/*
 * Auto Editor: the output soundtrack. The (cleaned) source audio is cut into the kept segments and joined with short
 * equal-power crossfades, so cuts don't click. Each piece is padded by half a crossfade on both sides (taken from
 * the audio around the cut), so the joined audio lines up with the video's time map to the sample.
 *
 *   cutAudio(buffer, timemap, { xfade }) → AudioBuffer exactly timemap.duration long
 */
import { sliceBuffer, concatBuffers, makeBuffer } from '/assets/js/lib/audio-export.js';

export function cutAudio(buffer, tm, { xfade = 0.01 } = {}) {
  const sr = buffer.sampleRate, D = buffer.duration;
  const half = xfade / 2;
  const pieces = tm.segments.map((s) => {
    const a = Math.max(0, s.in - half), b = Math.min(D, s.out + half);
    return { buf: sliceBuffer(buffer, a, Math.max(a + 1 / sr, b)), lead: s.in - a };
  });
  let out = concatBuffers(pieces.map((p) => p.buf), { xfade });
  // The first piece's lead-in shifts everything; drop it, then pad/trim to the exact output length.
  const skip = Math.round(pieces[0].lead * sr);
  const len = Math.max(1, Math.round(tm.duration * sr));
  const exact = makeBuffer(buffer.numberOfChannels, len, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++)
    exact.copyToChannel(out.getChannelData(c).subarray(skip, skip + len), c);
  out = null;
  return exact;
}

/** A silent buffer (videos without sound still get a track, so the clock and exports work the same). */
export const silence = (seconds, sr = 48000) => makeBuffer(2, Math.max(1, Math.round(seconds * sr)), sr);
