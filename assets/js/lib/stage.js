/**
 * Stage: the live preview loop + transport bar (play/pause, scrubber, time, mute).
 *
 *   const stage = createStage({
 *     canvas,                       // the preview <canvas>
 *     transport: el,                // where to render the transport bar (optional)
 *     render: (t) => {...},         // draw the frame for time t (seconds)
 *     getDuration: () => 5,         // total length in seconds
 *     getVideo: () => videoOrNull,  // when a video is returned it drives the clock
 *     getVideoOffset: () => 0,      // optional trim: stage t = 0 is this video time (getDuration() = trimmed length)
 *   });
 *   stage.invalidate();             // redraw after a settings change
 *   stage.renderFrame(t);           // draw t right now (frame-by-frame export); stage.release() resumes the loop
 *   stage.videoTime(t);             // the video time for stage time t (adds the trim offset)
 *
 * Without a video the clock is the wall clock, looping over getDuration().
 * Events (stage.events): 'tick' {t}, 'ended'.
 */
import { h, icon, formatTime } from './dom.js';
import { setPreviewMuted, isPreviewMuted } from './media.js';

export function createStage({ canvas, transport, render, getDuration, getVideo = () => null, getVideoOffset = () => 0 }) {
  const events = new EventTarget();
  let playing = false;
  let loop = true;
  let clock = 0;          // seconds, used when there's no video
  let lastWall = 0;
  let dirty = true;
  let rafId = 0;
  let scrubbing = false;
  let held = false;       // true while an exporter draws frames itself

  const ui = transport ? buildTransport(transport) : null;

  const video = () => getVideo();
  const duration = () => Math.max(0.01, getDuration() || 0);
  const offset = () => (video() ? getVideoOffset() || 0 : 0);
  const time = () => (video() ? video().currentTime - offset() : clock);

  function frame(now) {
    rafId = requestAnimationFrame(frame);
    if (held) return;
    const v = video();
    if (playing) {
      if (v) {
        if (v.ended || time() >= duration() - 0.001 || time() < -0.25) onEnd();
      } else {
        clock += (now - lastWall) / 1000;
        if (clock >= duration()) onEnd();
      }
      lastWall = now;
      dirty = true;
    }
    if (!dirty) return;
    dirty = false;
    const t = Math.max(0, Math.min(time(), duration()));
    try { render(t); } catch (err) { console.error(err); }
    ui?.sync(t);
    events.dispatchEvent(new CustomEvent('tick', { detail: { t } }));
  }

  function onEnd() {
    if (loop) {
      seek(0);
      const v = video();
      if (v && v.paused) v.play().catch(() => {});
    } else {
      clock = duration();
      pause();
      events.dispatchEvent(new Event('ended'));
    }
  }

  function play({ loop: shouldLoop = true } = {}) {
    loop = shouldLoop;
    playing = true;
    lastWall = performance.now();
    const v = video();
    if (v) {
      if (time() >= duration() - 0.05 || time() < 0) v.currentTime = offset();
      return v.play().catch((err) => { playing = false; ui?.sync(time()); throw err; });
    }
    if (clock >= duration()) clock = 0;
    ui?.sync(time());
    return Promise.resolve();
  }

  function pause() {
    playing = false;
    video()?.pause();
    dirty = true;
  }

  function seek(t) {
    t = Math.max(0, Math.min(t, duration()));
    clock = t;
    const v = video();
    if (v) v.currentTime = t + offset();
    dirty = true;
  }

  // Redraw when a paused video finishes seeking (new frame becomes available).
  let watched = null;
  function watchVideo() {
    const v = video();
    if (v === watched) return;
    watched?.removeEventListener('seeked', invalidate);
    v?.addEventListener('seeked', invalidate);
    watched = v;
  }

  function invalidate() { dirty = true; }

  function buildTransport(root) {
    const playBtn = h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': 'Play' });
    const restartBtn = h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': 'Restart', html: icon('restart') });
    const muteBtn = h('button', { class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': 'Mute', hidden: true });
    const scrub = h('input', { type: 'range', min: 0, max: 1000, step: 1, value: 0, 'aria-label': 'Seek' });
    const timeEl = h('span', { class: 'time' }, '0:00.0 / 0:00.0');
    root.className = 'transport';
    root.replaceChildren(playBtn, restartBtn, scrub, timeEl, muteBtn);

    playBtn.addEventListener('click', () => (playing ? pause() : play().catch(() => {})));
    restartBtn.addEventListener('click', () => { seek(0); if (!playing) play().catch(() => {}); });
    muteBtn.addEventListener('click', () => {
      const v = video(); if (!v) return;
      setPreviewMuted(v, !isPreviewMuted(v));
      sync(time());
    });
    scrub.addEventListener('pointerdown', () => { scrubbing = true; });
    scrub.addEventListener('pointerup', () => { scrubbing = false; });
    scrub.addEventListener('input', () => seek((scrub.value / 1000) * duration()));

    let lastPlaying, lastMuted;
    function sync(t) {
      const v = video();
      if (lastPlaying !== playing) {
        playBtn.innerHTML = icon(playing ? 'pause' : 'play');
        playBtn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
        lastPlaying = playing;
      }
      muteBtn.hidden = !v;
      if (v) {
        const muted = isPreviewMuted(v);
        if (muted !== lastMuted) { muteBtn.innerHTML = icon(muted ? 'mute' : 'volume'); lastMuted = muted; }
      }
      if (!scrubbing) {
        scrub.value = String(Math.round((t / duration()) * 1000));
        scrub.style.setProperty('--pct', `${(t / duration()) * 100}%`);
      }
      timeEl.textContent = `${formatTime(t)} / ${formatTime(duration())}`;
    }
    return { sync, setDisabled: (d) => [playBtn, restartBtn, scrub].forEach((el) => { el.disabled = d; }) };
  }

  rafId = requestAnimationFrame(frame);

  return {
    events,
    canvas,
    play, pause, seek, invalidate,
    get playing() { return playing; },
    get time() { return time(); },
    get duration() { return duration(); },
    videoTime: (t) => t + offset(),
    /** Call after the media source changes. */
    reset() { pause(); clock = 0; watchVideo(); seek(0); },
    setTransportDisabled(d) { ui?.setDisabled(d); },
    /** Pause the live loop and draw time t synchronously. Seek any video to t first. */
    renderFrame(t) {
      if (playing) pause();
      held = true;
      clock = t;
      render(t);
      ui?.sync(t);
    },
    release() { held = false; dirty = true; },
    destroy() { cancelAnimationFrame(rafId); },
  };
}
