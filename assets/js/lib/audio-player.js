/*
 * Audio player for the Audio tools: play/pause, loop the selection, position display, Space to play.

 *
 *   const player = createPlayer(root, {
 *     waveform,                         // keeps its playhead in sync, loops its selection, seeks on click
 *     getBuffer: () => audioBuffer,     // what to play (re-read on every start; call player.refresh() after it changes)
 *     envelope: (t) => gain,            // optional: gain 0..1 at buffer time t (live fades); call refresh() when it changes
 *     useEnvelope: () => bool,          // optional: apply the envelope right now (default true)
 *     onTime: (t) => {},  onState: (playing) => {},
 *   });
 *   player.play(); player.pause(); player.toggle(); player.seek(t); player.time; player.playing;
 *   player.refresh();                   // the buffer or envelope changed: keep playing from the same position
 *
 * Plays an AudioBufferSourceNode on the shared AudioContext (lib/audio-io.js). The envelope is sampled at 200 Hz
 * into a gain curve (setValueCurveAtTime), the same curve shape the offline export renders.
 */
import { h, icon, formatTime } from "./dom.js";
import { audioContext } from "./audio-io.js";

const CURVE_RATE = 200;
const LOOP_AHEAD = 300; // seconds of looped envelope scheduled at once

/** Sample `envelope` from t0 to t1 into a Float32Array (≥ 2 points). */
export function envelopeCurve(envelope, t0, t1, rate = CURVE_RATE) {
  const n = Math.max(2, Math.ceil((t1 - t0) * rate) + 1);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = envelope(t0 + ((t1 - t0) * i) / (n - 1));
  return out;
}

let active = null; // the player that owns the Space key (last one used)

export function createPlayer(
  root,
  {
    waveform,
    getBuffer,
    envelope,
    useEnvelope,
    onTime,
    onState,
    loop: loopDefault = false,
  } = {},
) {
  let src = null,
    gain = null;
  let playing = false;
  let pos = 0; // paused position (seconds of buffer time)
  let startedAt = 0,
    startedPos = 0,
    envUntil = Infinity;
  let loopOn = loopDefault;
  let raf = 0;

  const playBtn = h("button", {
    type: "button",
    class: "btn btn-ghost icon-btn",
    "aria-label": "Play (Space)",
    title: "Play (Space)",
  });
  const backBtn = h("button", {
    type: "button",
    class: "btn btn-ghost icon-btn",
    "aria-label": "Back to start",
    title: "Back to start (Home)",
    html: icon("restart"),
  });
  const timeEl = h("span", { class: "time" }, "0:00.0 / 0:00.0");
  const loopBox = h("input", { type: "checkbox", role: "switch" });
  loopBox.checked = loopOn;
  const loopLabel = h(
    "label",
    { class: "toggle audio-loop" },
    h("span", {}, "Loop selection"),
    loopBox,
  );
  root.classList.add("transport", "audio-player");
  root.replaceChildren(
    playBtn,
    backBtn,
    timeEl,
    h("span", { class: "spacer" }),
    loopLabel,
  );

  const buffer = () => getBuffer?.() || null;
  const dur = () => buffer()?.duration || 0;

  function current() {
    if (!playing) return pos;
    const c = audioContext();
    let p = startedPos + Math.max(0, c.currentTime - startedAt);
    if (src?.loop) {
      const a = src.loopStart,
        b = src.loopEnd;
      if (p >= b) p = a + ((p - a) % (b - a));
    }
    return Math.min(p, dur());
  }

  function stopSource() {
    if (src) {
      src.onended = null;
      try {
        src.stop();
      } catch {
        /* not started */
      }
      src.disconnect();
    }
    gain?.disconnect();
    src = null;
    gain = null;
  }

  function loopRange() {
    const sel = waveform?.selection;
    return loopOn && sel && sel.end - sel.start > 0.05 ? sel : null;
  }

  function start(at) {
    const buf = buffer();
    if (!buf) return;
    const c = audioContext();
    c.resume();
    stopSource();
    const range = loopRange();
    if (range && (at < range.start || at >= range.end - 0.01)) at = range.start;
    if (!range && at >= buf.duration - 0.01) at = 0;
    const s = c.createBufferSource();
    s.buffer = buf;
    if (range) {
      s.loop = true;
      s.loopStart = range.start;
      s.loopEnd = range.end;
    }
    const when = c.currentTime + 0.03;
    let out = s;
    envUntil = Infinity;
    if (envelope && (useEnvelope?.() ?? true)) {
      gain = c.createGain();
      // Schedule the envelope for the stretch that will play: to the end, or several loop passes ahead.
      let curve;
      if (range) {
        const first = envelopeCurve(envelope, at, range.end);
        const pass = envelopeCurve(envelope, range.start, range.end);
        const passes = Math.max(
          1,
          Math.ceil(LOOP_AHEAD / (range.end - range.start)),
        );
        curve = new Float32Array(first.length + pass.length * passes);
        curve.set(first);
        for (let i = 0; i < passes; i++)
          curve.set(pass, first.length + i * pass.length);
        const span = range.end - at + (range.end - range.start) * passes;
        gain.gain.setValueCurveAtTime(curve, when, span);
        envUntil = when + span - 0.05;
      } else {
        curve = envelopeCurve(envelope, at, buf.duration);
        gain.gain.setValueCurveAtTime(
          curve,
          when,
          Math.max(0.01, buf.duration - at),
        );
      }
      s.connect(gain);
      out = gain;
    }
    out.connect(c.destination);
    s.start(when, at);
    s.onended = () => {
      if (src === s) {
        playing = false;
        pos = range ? range.start : buf.duration;
        stopSource();
        sync();
        onState?.(false);
      }
    };
    src = s;
    startedAt = when;
    startedPos = at;
    if (!playing) {
      playing = true;
      onState?.(true);
    }
    active = api;
    tick();
  }

  function tick() {
    cancelAnimationFrame(raf);
    const loopFn = () => {
      if (!playing) return;
      if (audioContext().currentTime > envUntil) {
        start(current());
        return;
      }
      sync();
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
  }

  let lastPlaying = null;
  function sync() {
    const t = current();
    if (lastPlaying !== playing) {
      playBtn.innerHTML = icon(playing ? "pause" : "play");
      playBtn.setAttribute(
        "aria-label",
        playing ? "Pause (Space)" : "Play (Space)",
      );
      lastPlaying = playing;
    }
    timeEl.textContent = `${formatTime(t)} / ${formatTime(dur())}`;
    waveform?.setTime(t, { follow: playing });
    onTime?.(t);
  }

  function play() {
    if (!playing) start(pos);
  }
  function pause() {
    if (!playing) return;
    pos = current();
    playing = false;
    stopSource();
    cancelAnimationFrame(raf);
    sync();
    onState?.(false);
  }
  function toggle() {
    (playing ? pause : play)();
  }
  function seek(t) {
    t = Math.max(0, Math.min(dur(), t || 0));
    active = api;
    if (playing) start(t);
    else {
      pos = t;
      sync();
    }
  }

  playBtn.addEventListener("click", () => {
    active = api;
    toggle();
  });
  backBtn.addEventListener("click", () => seek(loopRange()?.start ?? 0));
  loopBox.addEventListener("change", () => {
    loopOn = loopBox.checked;
    if (playing) start(current());
  });

  const api = {
    play,
    pause,
    toggle,
    seek,
    get time() {
      return current();
    },
    get playing() {
      return playing;
    },
    get loop() {
      return loopOn;
    },
    set loop(v) {
      loopOn = !!v;
      loopBox.checked = loopOn;
      if (playing) start(current());
    },
    /** Restart from the same position after the buffer, envelope or loop range changed. */
    refresh() {
      if (playing) start(Math.min(current(), dur()));
      else {
        pos = Math.min(pos, dur());
        sync();
      }
    },
    stop() {
      pause();
      pos = 0;
      sync();
    },
    el: root,
  };
  active ||= api;
  sync();
  return api;
}

// Space toggles the last-used player (unless typing); Home jumps to the start.
document.addEventListener("keydown", (e) => {
  if (!active || !active.el.isConnected || e.altKey || e.ctrlKey || e.metaKey)
    return;
  const el = e.target;
  const typing =
    el.isContentEditable ||
    /^(TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el.tagName === "INPUT" &&
      !/^(range|checkbox|radio|button)$/.test(el.type));
  if (typing) return;
  if (e.code === "Space" || e.key === " ") {
    e.preventDefault();
    active.toggle();
  } else if (e.key === "Home") {
    e.preventDefault();
    active.seek(0);
  }
});
