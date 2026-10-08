/*
 * Waveform view for the Audio tools: zoom, scroll, playhead, click to seek, drag to select a region.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   const wave = createWaveform(root, {
 *     height: 140,
 *     selectable: true,                    // drag to select; drag a selection edge to resize it
 *     onSeek: (t) => player.seek(t),       // click (or tap) without dragging
 *     onSelect: (sel, { done }) => {},     // sel = { start, end } in seconds, or null; done = pointer released
 *     onView: (view) => {},                // { start, span } after zoom/scroll (to sync a second waveform)
 *     overlay: (ctx, g) => {},             // draw extra layers; g = { x(t), t(x), top, bottom, mid, W, H, dpr, view }
 *     markers: () => [{ t, color?, label? }],
 *     color: () => '#…',                   // waveform colour (default: the accent)
 *     selectionTone: () => 'accent' | 'danger',
 *   });
 *   wave.setBuffer(audioBuffer);  wave.setTime(t);  wave.selection = { start, end } | null;
 *   wave.zoom(2) / wave.zoom(0.5) / wave.fit() / wave.zoomToSelection();  wave.setView(start, span);  wave.redraw();
 *
 * Peaks are precomputed once per buffer (min/max of all channels per 256 samples, plus a 4096-sample level);
 * views closer than 256 samples per pixel read the samples directly, so deep zoom stays exact.
 */
import { h, icon, formatTime } from './dom.js';

const BIN = 256;
const BIN2 = 4096;
const RULER = 18;
const EDGE_PX = 7;

/** Min/max peaks of every channel mixed together, at `bin` samples per value. */
export function computePeaks(buffer, bin = BIN) {
  const n = Math.ceil(buffer.length / bin);
  const min = new Float32Array(n), max = new Float32Array(n);
  min.fill(1); max.fill(-1);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const d = buffer.getChannelData(c);
    for (let b = 0; b < n; b++) {
      let lo = min[b], hi = max[b];
      const end = Math.min(d.length, (b + 1) * bin);
      for (let i = b * bin; i < end; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      min[b] = lo; max[b] = hi;
    }
  }
  return { bin, min, max };
}

function coarser(p, factor) {
  const n = Math.ceil(p.min.length / factor);
  const min = new Float32Array(n), max = new Float32Array(n);
  for (let b = 0; b < n; b++) {
    let lo = 1, hi = -1;
    for (let i = b * factor, e = Math.min(p.min.length, i + factor); i < e; i++) { if (p.min[i] < lo) lo = p.min[i]; if (p.max[i] > hi) hi = p.max[i]; }
    min[b] = lo; max[b] = hi;
  }
  return { bin: p.bin * factor, min, max };
}

const STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
const label = (t, step) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  const dec = step < 0.1 ? 2 : step < 1 ? 1 : 0;
  return `${m}:${s.toFixed(dec).padStart(dec ? 3 + dec : 2, '0')}`;
};

export function createWaveform(root, opts = {}) {
  const { height = 140, selectable = true, onSeek, onSelect, onView, overlay, markers, color, selectionTone } = opts;
  let buffer = null, peaks = null, peaks2 = null;
  let view = { start: 0, span: 1 };
  let time = 0;
  let selection = null;
  let W = 0, H = height, dpr = 1;
  let raf = 0;
  let hoverEdge = null;

  const canvas = h('canvas', { class: 'waveform-canvas', tabindex: '0', role: 'slider', 'aria-label': opts.label || 'Waveform: click to seek, drag to select', 'aria-valuemin': 0, 'aria-valuenow': 0 });
  const btn = (ic, label2, fn) => h('button', { type: 'button', class: 'btn btn-ghost icon-btn', title: label2, 'aria-label': label2, html: ic, onclick: fn });
  const zoomIn = btn(icon('plus'), 'Zoom in (Ctrl + wheel)', () => zoom(2));
  const zoomOut = btn('<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M5 12h14"/></svg>', 'Zoom out', () => zoom(0.5));
  const fitBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => fit() }, 'Fit');
  const selBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => zoomToSelection(), hidden: true }, 'Zoom to selection');
  const info = h('span', { class: 'waveform-info' });
  const thumb = h('div', { class: 'waveform-thumb' });
  const scroll = h('div', { class: 'waveform-scroll', hidden: true }, thumb);
  const wrap = h('div', { class: 'waveform-view', style: `height:${height}px` }, canvas);
  root.classList.add('waveform');
  root.replaceChildren(h('div', { class: 'waveform-bar' }, zoomOut, zoomIn, fitBtn, selBtn, info), wrap, scroll);

  const duration = () => (buffer ? buffer.duration : 0);
  const minSpan = () => (buffer ? Math.max(0.005, (W / buffer.sampleRate) / 4) : 0.01); // at most 4 px per sample
  const pps = () => W / view.span;
  const tToX = (t) => (t - view.start) * pps();
  const xToT = (x) => view.start + x / pps();

  function clampView() {
    const d = duration() || 1;
    view.span = Math.min(d, Math.max(minSpan(), view.span));
    view.start = Math.max(0, Math.min(d - view.span, view.start));
  }

  function setView(start, span, { silent = false } = {}) {
    view = { start, span };
    clampView();
    syncScroll();
    schedule();
    if (!silent) onView?.({ ...view });
  }

  function zoom(factor, centerT) {
    if (!buffer) return;
    const c = centerT ?? (time >= view.start && time <= view.start + view.span ? time : view.start + view.span / 2);
    const span = view.span / factor;
    const rel = (c - view.start) / view.span;
    setView(c - rel * Math.min(duration(), Math.max(minSpan(), span)), span);
  }
  function fit() { setView(0, duration() || 1); }
  function zoomToSelection() {
    if (!selection) return;
    const pad = (selection.end - selection.start) * 0.08;
    setView(selection.start - pad, selection.end - selection.start + pad * 2);
  }

  function syncScroll() {
    const d = duration();
    const show = !!buffer && view.span < d - 1e-6;
    scroll.hidden = !show;
    if (show) {
      thumb.style.left = `${(view.start / d) * 100}%`;
      thumb.style.width = `${Math.max(2, (view.span / d) * 100)}%`;
    }
    selBtn.hidden = !selection;
    info.textContent = buffer ? (selection ? `Selection ${formatTime(selection.start)} – ${formatTime(selection.end)} (${(selection.end - selection.start).toFixed(2)}s)` : `${formatTime(view.start)} – ${formatTime(view.start + view.span)}`) : '';
  }

  function resize() {
    const r = wrap.getBoundingClientRect();
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = Math.max(50, Math.round(r.width));
    H = Math.max(40, Math.round(r.height));
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    canvas.style.width = `${W}px`;
    canvas.style.height = `${H}px`;
    clampView();
    draw();
  }
  const ro = new ResizeObserver(resize);
  ro.observe(wrap);

  function schedule() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; draw(); });
  }

  const css = (name, fallback) => getComputedStyle(root).getPropertyValue(name).trim() || fallback;

  function draw() {
    const g = canvas.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const accent = css('--accent', '#0071e3');
    const muted = css('--text-faint', '#86868b');
    const text = css('--text', '#1d1d1f');
    const line = css('--border', 'rgba(0,0,0,.1)');
    const top = RULER, bottom = H - 2, mid = (top + bottom) / 2, amp = (bottom - top) / 2;

    // Ruler
    g.fillStyle = muted;
    g.font = `10px ${css('--font-mono', 'monospace')}`;
    g.textBaseline = 'top';
    const step = STEPS.find((s) => s * pps() >= 72) || 3600;
    const first = Math.ceil(view.start / step) * step;
    for (let t = first; t <= view.start + view.span + 1e-9; t += step) {
      const x = Math.round(tToX(t)) + 0.5;
      g.fillRect(x, 0, 1, 6);
      g.fillText(label(t, step), x + 3, 2);
    }
    g.fillStyle = line;
    g.fillRect(0, mid, W, 1);
    g.fillRect(0, RULER - 1, W, 1);
    if (!buffer) return;

    // Selection (behind the wave)
    const tone = selectionTone?.() === 'danger' ? css('--danger', '#ff3b30') : accent;
    if (selection) {
      const x0 = tToX(selection.start), x1 = tToX(selection.end);
      g.globalAlpha = 0.16;
      g.fillStyle = tone;
      g.fillRect(x0, top, x1 - x0, bottom - top);
      g.globalAlpha = 1;
    }

    // Wave: one column per pixel
    g.fillStyle = color?.() || accent;
    const sr = buffer.sampleRate;
    const spp = sr / pps(); // samples per pixel
    const chs = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    for (let x = 0; x < W; x++) {
      const s0 = Math.floor(xToT(x) * sr), s1 = Math.max(s0 + 1, Math.floor(xToT(x + 1) * sr));
      if (s0 >= buffer.length || s1 <= 0) continue;
      let lo = 1, hi = -1;
      if (spp < BIN) {
        for (const d of chs) for (let i = Math.max(0, s0), e = Math.min(d.length, s1); i < e; i++) { const v = d[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
        if (spp < 1 && lo > hi) continue;
      } else {
        const p = spp >= BIN2 * 2 && peaks2 ? peaks2 : peaks;
        for (let b = Math.floor(Math.max(0, s0) / p.bin), e = Math.min(p.min.length, Math.ceil(s1 / p.bin)); b < e; b++) {
          if (p.min[b] < lo) lo = p.min[b];
          if (p.max[b] > hi) hi = p.max[b];
        }
      }
      if (lo > hi) continue;
      const y0 = mid - Math.min(1, hi) * amp, y1 = mid - Math.max(-1, lo) * amp;
      g.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }

    // Selection edges
    if (selection) {
      g.fillStyle = tone;
      for (const t of [selection.start, selection.end]) {
        const x = Math.round(tToX(t));
        g.fillRect(x - 1, top, 2, bottom - top);
        g.fillRect(x - 4, top, 8, 4);
      }
    }

    overlay?.(g, { x: tToX, t: xToT, top, bottom, mid, amp, W, H, dpr, view: { ...view } });

    for (const m of markers?.() || []) {
      const x = Math.round(tToX(m.t)) + 0.5;
      if (x < -1 || x > W + 1) continue;
      g.strokeStyle = m.color || text;
      g.setLineDash([4, 3]);
      g.beginPath(); g.moveTo(x, top); g.lineTo(x, bottom); g.stroke();
      g.setLineDash([]);
      if (m.label) { g.fillStyle = m.color || text; g.fillText(m.label, x + 3, top + 2); }
    }

    // Playhead
    const px = Math.round(tToX(time));
    if (px >= -1 && px <= W + 1) {
      g.fillStyle = text;
      g.fillRect(px - 0.5, top - 4, 1.5, bottom - top + 4);
      g.beginPath(); g.moveTo(px - 5, top - 6); g.lineTo(px + 5.5, top - 6); g.lineTo(px + 0.25, top); g.fill();
    }
  }

  /* ---------- Pointer ---------- */
  let drag = null; // { mode: 'pending'|'select'|'edge'|'pan', x0, t0, edge }
  const localX = (e) => e.clientX - canvas.getBoundingClientRect().left;
  const edgeAt = (x) => {
    if (!selection || !selectable) return null;
    if (Math.abs(x - tToX(selection.start)) <= EDGE_PX) return 'start';
    if (Math.abs(x - tToX(selection.end)) <= EDGE_PX) return 'end';
    return null;
  };
  const clampT = (t) => Math.max(0, Math.min(duration(), t));

  canvas.addEventListener('pointerdown', (e) => {
    if (!buffer || e.button > 0) return;
    canvas.focus({ preventScroll: true });
    const x = localX(e);
    const edge = edgeAt(x);
    drag = edge ? { mode: 'edge', edge, x0: x } : { mode: 'pending', x0: x, t0: clampT(xToT(x)) };
    canvas.setPointerCapture(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    const x = localX(e);
    if (!drag) {
      const edge = edgeAt(x);
      if (edge !== hoverEdge) { hoverEdge = edge; canvas.style.cursor = edge ? 'ew-resize' : ''; }
      return;
    }
    // Auto-scroll while dragging past the edges.
    if ((drag.mode === 'select' || drag.mode === 'edge') && (x < 0 || x > W)) setView(view.start + (x < 0 ? x : x - W) / pps(), view.span);
    const t = clampT(xToT(Math.max(0, Math.min(W, x))));
    if (drag.mode === 'pending' && Math.abs(x - drag.x0) > 3 && selectable) drag.mode = 'select';
    if (drag.mode === 'select') setSelection({ start: Math.min(drag.t0, t), end: Math.max(drag.t0, t) }, { done: false });
    else if (drag.mode === 'edge') {
      let { start, end } = selection;
      if (drag.edge === 'start') start = t; else end = t;
      if (start > end) { [start, end] = [end, start]; drag.edge = drag.edge === 'start' ? 'end' : 'start'; }
      setSelection({ start, end }, { done: false });
    }
  });
  const finish = (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (d.mode === 'pending') {
      const t = clampT(xToT(localX(e)));
      if (selection && selectable && (t < selection.start || t > selection.end)) setSelection(null);
      onSeek?.(t);
    } else if (selection) {
      if (selection.end - selection.start < 0.01) setSelection(null);
      else setSelection(selection, { done: true });
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', () => { drag = null; });

  wrap.addEventListener('wheel', (e) => {
    if (!buffer) return;
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      zoom(Math.exp(-e.deltaY * 0.01), xToT(localX(e)));
    } else if (e.shiftKey || Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      e.preventDefault();
      const d = e.shiftKey && !e.deltaX ? e.deltaY : e.deltaX;
      setView(view.start + d / pps(), view.span);
    }
  }, { passive: false });

  canvas.addEventListener('keydown', (e) => {
    if (!buffer) return;
    const stepT = e.shiftKey ? 5 : 1;
    if (e.key === 'ArrowLeft') { e.preventDefault(); onSeek?.(clampT(time - stepT)); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); onSeek?.(clampT(time + stepT)); }
    else if (e.key === '+' || e.key === '=') zoom(2);
    else if (e.key === '-') zoom(0.5);
    else if (e.key === 'Escape' && selection && selectable) setSelection(null);
  });

  // Scrollbar: drag the thumb, click the track to jump.
  let sdrag = null;
  scroll.addEventListener('pointerdown', (e) => {
    const r = scroll.getBoundingClientRect();
    const d = duration();
    if (e.target !== thumb) setView(((e.clientX - r.left) / r.width) * d - view.span / 2, view.span);
    sdrag = { x: e.clientX, start: view.start, w: r.width };
    scroll.setPointerCapture(e.pointerId);
  });
  scroll.addEventListener('pointermove', (e) => { if (sdrag) setView(sdrag.start + ((e.clientX - sdrag.x) / sdrag.w) * duration(), view.span); });
  scroll.addEventListener('pointerup', () => { sdrag = null; });

  function setSelection(sel, { silent = false, done = true } = {}) {
    if (sel) {
      const d = duration();
      sel = { start: Math.max(0, Math.min(d, sel.start)), end: Math.max(0, Math.min(d, sel.end)) };
      if (sel.end < sel.start) [sel.start, sel.end] = [sel.end, sel.start];
    }
    selection = sel;
    syncScroll();
    schedule();
    if (!silent) onSelect?.(sel ? { ...sel } : null, { done });
  }

  return {
    el: root,
    setBuffer(buf, { keepView = false } = {}) {
      buffer = buf;
      peaks = buf ? computePeaks(buf) : null;
      peaks2 = peaks ? coarser(peaks, BIN2 / BIN) : null;
      if (selection && buf && selection.start >= buf.duration) selection = null;
      if (!keepView) view = { start: 0, span: buf ? buf.duration : 1 };
      clampView();
      syncScroll();
      draw();
    },
    get buffer() { return buffer; },
    setTime(t, { follow = false } = {}) {
      time = t;
      canvas.setAttribute('aria-valuenow', t.toFixed(1));
      if (follow && buffer && (t < view.start || t > view.start + view.span)) setView(t - view.span * 0.05, view.span);
      schedule();
    },
    get time() { return time; },
    get selection() { return selection ? { ...selection } : null; },
    set selection(sel) { setSelection(sel, { silent: true }); },
    setSelection,
    get view() { return { ...view }; },
    setView,
    zoom, fit, zoomToSelection,
    redraw: schedule,
    destroy() { ro.disconnect(); cancelAnimationFrame(raf); },
  };
}
