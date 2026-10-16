/*
 * Auto Editor: preview playback across cuts. The stage clock is an <audio> element playing the cut soundtrack;
 * two muted <video> elements of the same file take turns (even segments on one, odd on the other). While one plays,
 * the other waits on the next segment's first frame, so a cut is a switch, not a seek. Small drift is absorbed by
 * nudging playbackRate (±15%); more than 0.25 s re-seeks.
 *
 *   const pb = createPlayback(media, { onSeeked })
 *   pb.sync(tm, t, playing)   // call every frame
 *   pb.frames(tm, t)          // { main, next } for renderFrame
 *   await pb.exact(tm, t)     // seek the right video exactly (GIF export, PNG)
 *   pb.dispose()
 */
import { seekVideo } from '/assets/js/lib/media.js';

export function createPlayback(media, { onSeeked } = {}) {
  const b = document.createElement('video');
  Object.assign(b, { muted: true, playsInline: true, preload: 'auto', src: media.url });
  const videos = [media.el, b];
  for (const v of videos) {
    v.muted = true;
    v.addEventListener('seeked', () => onSeeked?.());
  }
  let parked = false;

  const pick = (tm, t) => {
    const seg = tm.segmentAt(t);
    return { seg, v: videos[seg.index % 2], other: videos[(seg.index + 1) % 2], next: tm.segments[seg.index + 1] };
  };

  return {
    videos,
    sync(tm, t, playing) {
      if (parked) return;
      const { v, other, next } = pick(tm, t);
      const want = tm.outToSrc(t);
      const err = v.currentTime - want; // > 0: the video is ahead of the sound
      const drift = Math.abs(err);
      if (playing) {
        if (v.paused) {
          if (drift > 0.04) v.currentTime = want;
          v.play().catch(() => {});
        } else if (drift > 0.25 && !v.seeking) v.currentTime = want;
        // Small drift: speed up or slow down by up to 15% until the picture catches the sound.
        else v.playbackRate = drift < 0.012 ? 1 : 1 - Math.max(-0.15, Math.min(0.15, err * 2.5));
      } else {
        if (!v.paused) v.pause();
        v.playbackRate = 1;
        if (drift > 0.03 && !v.seeking) v.currentTime = want;
      }
      // Pre-roll: start the next segment's video just before the cut, so it's already running when we switch.
      const preroll = playing && next && next.at - t < 0.06 && Math.abs(other.currentTime - next.in) < 0.08;
      if (preroll) { if (other.paused) other.play().catch(() => {}); return; }
      if (!other.paused) other.pause();
      if (next && Math.abs(other.currentTime - next.in) > 0.03 && !other.seeking) other.currentTime = next.in;
    },
    frames(tm, t) {
      const { v, other, next } = pick(tm, t);
      return { main: v.readyState >= 2 ? v : null, next: next && other.readyState >= 2 ? other : null };
    },
    /** Seek exactly (frame-accurate exports); sync() leaves the videos alone until release(). */
    async exact(tm, t) {
      parked = true;
      const { v, other, next } = pick(tm, t);
      v.pause();
      other.pause();
      await Promise.all([seekVideo(v, tm.outToSrc(t)), next ? seekVideo(other, next.in) : null]);
    },
    release() { parked = false; },
    pause() { videos.forEach((v) => v.pause()); },
    dispose() {
      b.pause();
      b.removeAttribute('src');
      b.load();
    },
  };
}
