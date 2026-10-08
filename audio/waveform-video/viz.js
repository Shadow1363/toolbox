/*
 * Waveform Video: audio analysis and visualizer drawing.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   const an = createAnalyzer(audioBuffer);          // mono mix + FFT, all computed from the decoded samples
 *   an.bands(t, n, { smoothing, sensitivity })      → Float32Array(n) of 0..1 levels (log-spaced 50 Hz–10 kHz)
 *   an.wave(t, n)                                   → Float32Array(n) of −1..1 samples around t (oscilloscope)
 *   drawViz(ctx, style, levels, box, o)              style: bars | mirror | line | wave | circle | dots
 *
 * Levels are a pure function of t (no state carried between frames), so the preview, PNG, GIF and the
 * real-time video export draw identical frames. "Smoothing" averages the spectra of a few earlier instants.
 */

const FFT = 2048;

function fftMag(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci, ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = nr;
      }
    }
  }
}

export function createAnalyzer(buffer) {
  const sr = buffer.sampleRate, len = buffer.length, chs = buffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < chs; c++) { const d = buffer.getChannelData(c); for (let i = 0; i < len; i++) mono[i] += d[i] / chs; }
  const hann = Float32Array.from({ length: FFT }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FFT - 1)));
  const re = new Float32Array(FFT), im = new Float32Array(FFT);
  const cache = new Map(); // `${frame}` → spectrum (dB), small LRU

  function spectrum(t) {
    const center = Math.round(t * sr);
    const key = center >> 7; // 128-sample buckets: neighbouring frames reuse the FFT
    if (cache.has(key)) return cache.get(key);
    const start = (key << 7) - FFT / 2;
    for (let i = 0; i < FFT; i++) { const j = start + i; re[i] = j >= 0 && j < len ? mono[j] * hann[i] : 0; im[i] = 0; }
    fftMag(re, im);
    const out = new Float32Array(FFT / 2);
    for (let i = 0; i < FFT / 2; i++) out[i] = 20 * Math.log10(Math.hypot(re[i], im[i]) / (FFT / 4) + 1e-9);
    cache.set(key, out);
    if (cache.size > 64) cache.delete(cache.keys().next().value);
    return out;
  }

  let edges = null, edgesN = 0;
  function bandEdges(n) {
    if (edgesN === n) return edges;
    const lo = 50, hi = Math.min(10000, sr / 2 - 1);
    edges = Array.from({ length: n + 1 }, (_, i) => Math.max(1, Math.round(((lo * (hi / lo) ** (i / n)) / sr) * FFT)));
    for (let i = 1; i <= n; i++) edges[i] = Math.max(edges[i], edges[i - 1] + 1);
    edgesN = n;
    return edges;
  }

  return {
    duration: buffer.duration,
    bands(t, n, { smoothing = 0.5, sensitivity = 1 } = {}) {
      const e = bandEdges(n);
      const out = new Float32Array(n);
      const taps = 1 + Math.round(smoothing * 5);
      for (let k = 0; k < taps; k++) {
        const s = spectrum(t - k / 60);
        const w = (taps - k) / ((taps * (taps + 1)) / 2);
        for (let b = 0; b < n; b++) {
          let m = -120;
          for (let i = e[b]; i < e[b + 1] && i < s.length; i++) if (s[i] > m) m = s[i];
          // Tilt: higher bands carry less energy in speech and music; lift them so the display stays even.
          const tilt = (b / n) * 26;
          out[b] += w * Math.max(0, Math.min(1, ((m + tilt + 62) / 52) * sensitivity));
        }
      }
      return out;
    },
    wave(t, n, span = 0.05) {
      const out = new Float32Array(n);
      const a = Math.round((t - span / 2) * sr), step = (span * sr) / n;
      for (let i = 0; i < n; i++) { const j = Math.round(a + i * step); out[i] = j >= 0 && j < len ? mono[j] : 0; }
      return out;
    },
    level(t) {
      const a = Math.max(0, Math.round((t - 0.05) * sr)), b = Math.min(len, Math.round((t + 0.05) * sr));
      let s = 0;
      for (let i = a; i < b; i++) s += mono[i] * mono[i];
      return Math.sqrt(s / Math.max(1, b - a));
    },
  };
}

/* ---------- Drawing ---------- */

function paint(ctx, box, o) {
  if (!o.gradient) return o.color;
  const g = ctx.createLinearGradient(box.x, box.y + box.h, box.x + box.w, box.y);
  g.addColorStop(0, o.color);
  g.addColorStop(1, o.color2);
  return g;
}

function bar(ctx, x, y, w, h, r) {
  if (h <= 0) return;
  if (r > 0 && ctx.roundRect) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); ctx.fill(); }
  else ctx.fillRect(x, y, w, h);
}

/**
 * Draw `levels` (0..1) into `box` = { x, y, w, h, cx, cy, r } (the centre/radius are for 'circle').
 * o = { color, color2, gradient, rounded, gap (0..0.9), thickness (px), glow (px) }
 */
export function drawViz(ctx, style, levels, box, o) {
  const n = levels.length;
  ctx.save();
  ctx.fillStyle = ctx.strokeStyle = paint(ctx, box, o);
  if (o.glow) { ctx.shadowColor = o.color; ctx.shadowBlur = o.glow; }
  const slot = box.w / n;
  const bw = Math.max(1, slot * (1 - o.gap));
  const rr = o.rounded ? bw / 2 : 0;
  const minH = Math.max(2, bw * 0.25);
  if (style === 'bars') {
    for (let i = 0; i < n; i++) {
      const hh = Math.max(minH, levels[i] * box.h);
      bar(ctx, box.x + i * slot + (slot - bw) / 2, box.y + box.h - hh, bw, hh, rr);
    }
  } else if (style === 'mirror') {
    const mid = box.y + box.h / 2;
    for (let i = 0; i < n; i++) {
      const hh = Math.max(minH, levels[i] * box.h);
      bar(ctx, box.x + i * slot + (slot - bw) / 2, mid - hh / 2, bw, hh, rr);
    }
  } else if (style === 'dots') {
    const d = bw;
    const rows = Math.max(3, Math.floor(box.h / (d * 1.35)));
    for (let i = 0; i < n; i++) {
      const lit = Math.max(1, Math.round(levels[i] * rows));
      const x = box.x + i * slot + slot / 2;
      for (let r = 0; r < lit; r++) {
        ctx.beginPath();
        ctx.arc(x, box.y + box.h - d / 2 - r * d * 1.35, d / 2, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (style === 'line') {
    // Smooth spectrum curve with a soft fill under it.
    const pts = Array.from(levels, (v, i) => [box.x + (i + 0.5) * slot, box.y + box.h - v * box.h]);
    ctx.beginPath();
    ctx.moveTo(box.x, box.y + box.h);
    ctx.lineTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    ctx.lineTo(box.x + box.w, box.y + box.h);
    ctx.globalAlpha = 0.25;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.lineWidth = o.thickness;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < n; i++) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
      ctx.quadraticCurveTo(x0, y0, (x0 + x1) / 2, (y0 + y1) / 2);
    }
    ctx.lineTo(pts[n - 1][0], pts[n - 1][1]);
    ctx.stroke();
  } else if (style === 'wave') {
    // `levels` holds −1..1 samples here.
    const mid = box.y + box.h / 2;
    ctx.lineWidth = o.thickness;
    ctx.lineJoin = ctx.lineCap = 'round';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const x = box.x + (i / (n - 1)) * box.w, y = mid - Math.max(-1, Math.min(1, levels[i])) * (box.h / 2);
      if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
    }
    ctx.stroke();
  } else if (style === 'circle') {
    const { cx, cy, r } = box;
    const len = box.h; // max bar length
    const step = (Math.PI * 2) / n;
    const w = Math.max(1, ((Math.PI * 2 * r) / n) * (1 - o.gap));
    ctx.lineWidth = w;
    ctx.lineCap = o.rounded ? 'round' : 'butt';
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + i * step;
      const l = Math.max(w * 0.5, levels[i] * len);
      ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      ctx.lineTo(cx + Math.cos(a) * (r + l), cy + Math.sin(a) * (r + l));
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** Mirror levels so a circle is symmetric left/right (low frequencies at the top). */
export function symmetric(levels) {
  const n = levels.length;
  const out = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) { out[i] = levels[i]; out[n * 2 - 1 - i] = levels[i]; }
  return out;
}
