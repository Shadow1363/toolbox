/*
 * Scrolling Playlist: hand samples → scroll position over time. No DOM, so it runs in Node.
 *
 *   const sim = simulateScroll(track, { rowPx, frameH, area, anywhere, strength, smoothing, friction, maxPos, startPos, pinch,
 *                                       returnFilter, direction, cooldown, offRanges, offMode, maxSpeed });
 *   sim.posAt(t)      // scroll offset in rows (0 = first row at the top of the list)
 *   sim.playingAt(t)  // index of the "now playing" row (changed by pinches), or the start value
 *   sim.engagedAt(t)  // was the finger driving the list at t
 *   sim.stateAt(t)    // 'count' | 'return' | 'cooldown' | 'off' | 'outside' | 'still' | 'none' (debug overlay)
 *   sim.strokes       // [{ t0, t1, dir, counts }] for the timeline (dir −1 = finger up = down the list)
 *
 * track = { fps, samples: [{ t, tip: { x, y } | null, thumb: { x, y } | null, size, pinchDist? }] } in 0..1 of the frame;
 * pinchDist (thumb–index distance / hand size, aspect-corrected) wins over the one computed from tip/thumb/size.
 *
 * Like swiping a phone screen: the list follows the fingertip like a touch drag while the finger is inside `area`
 * ({ x, y, w, h } in 0..1, the overlay's box; ignored with `anywhere`), smoothed (exponential, `smoothing` 0..1).
 * A camera can't see the finger lift off the glass, so the path is first split into strokes at its turning points
 * (hysteresis of REVERSE frame heights), and only some strokes count:
 *   - `direction`: 'both' | 'down' (finger moves up, the list goes down, as on a phone) | 'up' (the opposite).
 *   - `returnFilter` (default on): the stroke back to the start of the next swipe doesn't count. With a direction
 *     lock that's every stroke the other way. With 'both', strokes alternate swipe / return: a stroke right after a
 *     swipe is its return unless it's clearly faster (top speed > swipe's / RETURN_RATIO: a change of direction);
 *     a stroke that would push the list past its top or bottom (it couldn't scroll anyway) is the reset unless it
 *     continues the last swipe; the first stroke of a series is also the reset when the next one is clearly faster.
 *   - Strokes shorter than MIN_TRAVEL frame heights never count (landmark jitter).
 *   - `cooldown` s after each counted stroke ends, movement is ignored.
 *   - `offRanges` [{ start, end }] (seconds): detection is off; the list keeps gliding (`offMode` 'coast') or stops ('hold').
 * When a counted stroke ends the list keeps the stroke's top speed (× FLICK) and slows with `friction` (per second),
 * also through return strokes and cooldowns; with no hand at all it holds. `maxSpeed` caps the speed in rows/s.
 * A pinch (thumb tip to index tip under `pinch` × hand size) over a row makes it "now playing".
 * The simulation steps once per sample from the start, so preview, GIF and video see the same positions.
 */

const REVERSE = 0.012;     // turning point: the finger came back this far (frame heights) from its extreme
const MIN_TRAVEL = 0.02;   // shorter strokes never count
const RETURN_RATIO = 0.85; // 'both': "clearly faster" = top speed above the other stroke's / this
const NEIGHBOUR_GAP = 2;   // s: strokes further apart start a new series (leaving the list's box between swipes doesn't)
const FLICK = 0.6;         // share of a counted stroke's top speed kept as momentum when it ends

export function simulateScroll(track, o = {}) {
  const {
    rowPx = 120, frameH = 1080, area = { x: 0, y: 0, w: 1, h: 1 }, anywhere = false, strength = 1,
    smoothing = 0.5, friction = 3, maxPos = 0, startPos = 0, startPlaying = 0, pinch = 0.35,
    returnFilter = true, direction = 'both', cooldown = 0, offRanges = [], offMode = 'coast', maxSpeed = Infinity,
    rowAt = null, // (x, y) → row index under that point (0..1 of the frame), for pinches
  } = o;
  const samples = track?.samples || [];
  const fps = track?.fps || 30;
  const dt = 1 / fps;
  const n = samples.length;
  const pos = new Float32Array(n);
  const state = new Array(n);
  const events = []; // { t, index } pinches
  const alpha = 1 - Math.min(0.95, Math.max(0, smoothing)); // EMA weight of the new sample
  const margin = 0.04;
  const inside = (q) => anywhere || (q.x >= area.x - margin && q.x <= area.x + area.w + margin && q.y >= area.y - margin && q.y <= area.y + area.h + margin);
  const isOff = (t) => offRanges.some((r) => t >= Math.min(r.start, r.end) && t <= Math.max(r.start, r.end));
  const toRows = (dy) => (-dy * frameH * strength) / rowPx; // touch drag: finger up (dy < 0) → further down the list

  /* 1. Where the finger can drive the list, and its smoothed height. */
  const fy = new Float32Array(n).fill(NaN);
  let ema = null;
  samples.forEach((s, i) => {
    const on = !!s.tip && inside(s.tip) && !isOff(s.t);
    if (!on) { ema = null; return; }
    ema = ema == null ? s.tip.y : ema + (s.tip.y - ema) * alpha;
    fy[i] = ema;
  });

  /* 2. Strokes: runs between turning points (zigzag with hysteresis), split wherever the finger can't drive. */
  const strokes = [];
  const strokeOf = new Int32Array(n).fill(-1);
  for (let i = 0; i < n;) {
    if (Number.isNaN(fy[i])) { i++; continue; }
    let j = i;
    while (j + 1 < n && !Number.isNaN(fy[j + 1])) j++;
    // Run i..j: pivots where the path turns back by more than REVERSE.
    const pivots = [i];
    let ext = i, dir = 0;
    for (let k = i + 1; k <= j; k++) {
      if (!dir) {
        if (Math.abs(fy[k] - fy[i]) > REVERSE) { dir = Math.sign(fy[k] - fy[i]); ext = k; }
        continue;
      }
      if ((fy[k] - fy[ext]) * dir >= 0) ext = k; // still going the same way: a new extreme
      else if (Math.abs(fy[k] - fy[ext]) > REVERSE) { pivots.push(ext); dir = -dir; ext = k; }
    }
    pivots.push(j);
    for (let p = 0; p < pivots.length - 1; p++) {
      const a = pivots[p], b = pivots[p + 1];
      if (b <= a && pivots.length > 2) continue;
      let peak = 0;
      for (let k = a + 1; k <= b; k++) peak = Math.max(peak, Math.abs(fy[k] - fy[k - 1]) / dt);
      const id = strokes.length;
      strokes.push({ a, b, t0: samples[a].t, t1: samples[b].t, dir: Math.sign(fy[b] - fy[a]), travel: Math.abs(fy[b] - fy[a]), peak, counts: false });
      for (let k = a + (p ? 1 : 0); k <= b; k++) strokeOf[k] = id;
    }
    i = j + 1;
  }

  /* 3. Which strokes count: decided when the list reaches each stroke (the 'both' rule needs the list position). */
  const lockDir = direction === 'down' ? -1 : direction === 'up' ? 1 : 0; // finger direction allowed
  const real = (q) => q && q.travel >= MIN_TRAVEL && q.dir;
  const adjacent = (a, b) => real(a) && real(b) && b.t0 - a.t1 <= NEIGHBOUR_GAP;
  function decide(k, p) {
    const st = strokes[k];
    if (!real(st) || (lockDir && st.dir !== lockDir)) return false;
    if (!returnFilter || lockDir) return true;
    const prev = adjacent(strokes[k - 1], st) ? strokes[k - 1] : null;
    const next = adjacent(st, strokes[k + 1]) ? strokes[k + 1] : null;
    // At the list's end a stroke can't scroll it. It's a (blocked) swipe only when it continues this series' last
    // swipe, which keeps the swipe / return alternation in step; otherwise it's the reset (as on a phone).
    const listDir = -st.dir;
    if ((listDir < 0 && p <= 1e-3) || (listDir > 0 && p >= maxPos - 1e-3)) {
      for (let j = k - 1; j >= 0 && adjacent(strokes[j], strokes[j + 1]); j--) if (strokes[j].counts) return strokes[j].dir === st.dir;
      return false;
    }
    // First of a series: a swipe, unless the next stroke is clearly faster (then this one is the reset before it).
    if (!prev) return !(next && st.peak < next.peak * RETURN_RATIO);
    // Right after a swipe: the return, unless clearly faster (a deliberate change of direction).
    if (prev.counts) return st.peak * RETURN_RATIO > prev.peak;
    return true; // right after a return: the next swipe
  }

  /* 4. Step the list. */
  const cap = Number.isFinite(maxSpeed) && maxSpeed > 0 ? maxSpeed : Infinity;
  let p = clamp(startPos, 0, maxPos), v = 0, pinched = false, coolUntil = -Infinity, cur = -1, top = 0;
  samples.forEach((s, i) => {
    const tip = s.tip;
    const k = strokeOf[i];
    const st = k >= 0 ? strokes[k] : null;
    // A counted stroke just ended: keep its speed as a flick, start the cooldown.
    if (cur >= 0 && k !== cur) {
      v = clamp(toRows(strokes[cur].dir * top) * FLICK, -cap, cap);
      coolUntil = strokes[cur].t1 + cooldown;
      cur = -1;
    }
    let mode;
    if (!tip) mode = 'none';
    else if (isOff(s.t)) mode = 'off';
    else if (!inside(tip)) mode = 'outside';
    else if (!st || i === st.a) mode = 'still';
    else {
      if (!st.decided) { st.counts = decide(k, p); st.decided = true; }
      mode = s.t < coolUntil ? 'cooldown' : st.counts ? 'count' : st.travel < MIN_TRAVEL ? 'still' : 'return';
    }

    if (mode === 'count') {
      const d = clamp(toRows(fy[i] - fy[i - 1]), -cap * dt, cap * dt);
      p += d;
      v = clamp(v * 0.5 + (d / dt) * 0.5, -cap, cap);
      if (cur !== k) { cur = k; top = 0; }
      top = Math.max(top, Math.abs(fy[i] - fy[i - 1]) / dt);
    } else if (mode === 'none' || (mode === 'off' && offMode === 'hold')) {
      v = 0; // no hand (or detection off, hold): stop
    } else {
      p += v * dt; v *= Math.exp(-friction * dt); // glide: flick momentum through returns, cooldowns, gaps
      if (Math.abs(v) < 0.02) v = 0;
    }

    // Pinch: thumb and index tips close together, relative to the hand's size (not while detection is off).
    if (tip && mode !== 'off' && mode !== 'outside') {
      const dist = s.pinchDist ?? (s.thumb ? Math.hypot(s.thumb.x - tip.x, s.thumb.y - tip.y) / Math.max(1e-3, s.size || 0.1) : Infinity);
      const now = dist < pinch;
      if (now && !pinched && rowAt) {
        const idx = rowAt(tip.x, tip.y, p);
        if (idx != null) events.push({ t: s.t, index: idx });
      }
      pinched = now;
    } else pinched = false;

    if (p < 0) { p = 0; v = 0; }
    if (p > maxPos) { p = maxPos; v = 0; }
    pos[i] = p;
    state[i] = mode;
  });

  const index = (t) => Math.max(0, Math.min(n - 1, (t - (samples[0]?.t || 0)) * fps));
  return {
    events,
    strokes: strokes.map(({ t0, t1, dir, counts }) => ({ t0, t1, dir, counts })),
    posAt(t) {
      if (!n) return clamp(startPos, 0, maxPos);
      const u = index(t), i0 = Math.floor(u), i1 = Math.min(n - 1, i0 + 1), k = u - i0;
      return pos[i0] + (pos[i1] - pos[i0]) * k;
    },
    engagedAt(t) { return state[Math.round(index(t))] === 'count'; },
    stateAt(t) { return n ? state[Math.round(index(t))] : 'none'; },
    playingAt(t) {
      let cur = startPlaying;
      for (const e of events) if (e.t <= t) cur = e.index;
      return cur;
    },
  };
}

/**
 * Live version of the return-stroke filter, for frames that arrive one at a time (the registry's playlist effect):
 * the first stroke longer than MIN_TRAVEL sets the swipe direction; afterwards only movement that way scrolls.
 *   const sw = createSwipe(); const dy = sw.step(fingerY | null);  // dy: finger movement to apply (0 when ignored)
 */
export function createSwipe() {
  let last = null, start = null, dir = 0;
  return {
    step(y) {
      if (y == null) { last = null; start = null; return 0; }
      if (last == null) { last = y; start = y; return 0; }
      const d = y - last;
      last = y;
      if (!dir) {
        if (Math.abs(y - start) > MIN_TRAVEL) dir = Math.sign(y - start);
        return dir ? y - start : 0;
      }
      return Math.sign(d) === dir ? d : 0;
    },
    reset() { last = null; start = null; dir = 0; },
  };
}

/** Manual mode: scroll keyframes [{ t, pos }] → position at t (eased between keys, held outside). */
export function keyedScroll(keys, t, fallback = 0) {
  if (!keys.length) return fallback;
  const ks = keys.slice().sort((a, b) => a.t - b.t);
  if (t <= ks[0].t) return ks[0].pos;
  for (let i = 1; i < ks.length; i++) {
    if (t <= ks[i].t) {
      const a = ks[i - 1], b = ks[i];
      const u = (t - a.t) / Math.max(1e-6, b.t - a.t);
      const e = u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2;
      return a.pos + (b.pos - a.pos) * e;
    }
  }
  return ks[ks.length - 1].pos;
}

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
