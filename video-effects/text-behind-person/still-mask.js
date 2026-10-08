/**
 * Person mask for a still photo: segmented once, then refined by hand.
 *
 *   const sm = createStillMask('tbp');
 *   sm.setSource(img, segmentImage(seg, img, 'quality'));   // raw model mask (e.g. 256×256)
 *   sm.update({ threshold, softness, polarity, edgeSnap }); // cheap; rerun on slider changes
 *   sm.beginStroke('add' | 'erase', radius, softness); sm.strokeTo(x, y); sm.endStroke();  // mask px
 *   sm.undo(); sm.redo(); sm.clearEdits();
 *   const alpha = sm.full(W, H, feather);                  // full-size alpha canvas (cached)
 *
 * Everything works at a working size (long side ≤ 1536 px):
 *   raw mask → bilinear upscale → guided filter against the photo (edges snap to hair and outlines)
 *   → threshold/softness → base alpha; then brush layers: out = (base ∪ add) − erase.
 * Strokes are stored, so undo/redo rebuild the add/erase layers by replaying them.
 */
import { looksLikePerson } from '/assets/js/lib/vision.js';
import { smoothstep } from '/assets/js/lib/easing.js';
import { scratch, supportsCanvasFilter } from '/assets/js/lib/canvas.js';

const WORK_SIDE = 1536;

export function createStillMask(prefix) {
  let w = 0, h = 0;
  let guide = null;      // photo luminance 0..1 at the working size
  let up = null;         // raw mask upscaled to the working size
  let snapped = null;    // guided-filtered `up` (cached until the source changes)
  let autoPolarity = null;
  let strokes = [], redoStack = [], current = null;
  let fullKey = '';
  const canvas = (name) => { const c = document.createElement('canvas'); c.dataset.name = `${prefix}-${name}`; return c; };
  const base = canvas('base'), add = canvas('add'), erase = canvas('erase'), out = canvas('out');

  const sm = {
    ready: false,
    version: 0,
    get width() { return w; },
    get height() { return h; },
    get canvas() { return out; },
    get canUndo() { return strokes.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get edited() { return strokes.length > 0; },

    reset() {
      sm.ready = false; guide = up = snapped = null; strokes = []; redoStack = []; current = null;
      sm.version++;
    },

    /** New photo + its raw model mask ({ data, width, height }, person probability). */
    setSource(img, raw) {
      const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
      const sc = Math.min(1, WORK_SIDE / Math.max(iw, ih));
      w = Math.max(1, Math.round(iw * sc)); h = Math.max(1, Math.round(ih * sc));
      for (const c of [base, add, erase, out]) { c.width = w; c.height = h; }

      const g = scratch(`${prefix}-guide`, w, h);
      const gx = g.getContext('2d', { willReadFrequently: true });
      gx.clearRect(0, 0, w, h);
      gx.drawImage(img, 0, 0, w, h);
      const px = gx.getImageData(0, 0, w, h).data;
      guide = new Float32Array(w * h);
      for (let i = 0, j = 0; i < guide.length; i++, j += 4) guide[i] = (0.299 * px[j] + 0.587 * px[j + 1] + 0.114 * px[j + 2]) / 255;

      up = bilinear(raw.data, raw.width, raw.height, w, h);
      snapped = null;
      autoPolarity = looksLikePerson(raw);
      strokes = []; redoStack = []; current = null;
      sm.ready = true;
    },

    /** Rebuild the base alpha from the edge settings, then re-apply the brush layers. */
    update({ threshold = 0.5, softness = 0.2, polarity = 'auto', edgeSnap = true } = {}) {
      if (!sm.ready) return;
      let prob = up;
      if (edgeSnap) {
        // Radius ≈ 1.5 model pixels at the working size; eps keeps flat areas flat.
        snapped ||= guidedFilter(guide, up, w, h, Math.max(2, Math.round((Math.max(w, h) / 256) * 1.5)), 2e-3);
        prob = snapped;
      }
      const invert = polarity === 'invert' || (polarity === 'auto' && autoPolarity === false);
      const lo = threshold - softness / 2, hi = threshold + softness / 2;
      const bx = base.getContext('2d');
      const img = bx.createImageData(w, h);
      for (let i = 0, j = 0; i < prob.length; i++, j += 4) {
        const v = invert ? 1 - prob[i] : prob[i];
        img.data[j] = img.data[j + 1] = img.data[j + 2] = 255;
        img.data[j + 3] = smoothstep(lo, hi, v) * 255;
      }
      bx.putImageData(img, 0, 0);
      composite();
    },

    /** Start a brush stroke. mode 'add' | 'erase'; radius in working-size px; softness 0..1. */
    beginStroke(mode, radius, softness) {
      current = { mode, radius: Math.max(0.5, radius), softness, points: [] };
      strokes.push(current);
      redoStack = [];
    },
    strokeTo(x, y) {
      if (!current) return;
      const pts = current.points;
      const prev = pts[pts.length - 1];
      pts.push({ x, y });
      paint(current, prev, { x, y });
      composite();
    },
    endStroke() {
      if (current && !current.points.length) strokes.pop();
      current = null;
    },
    undo() { if (strokes.length) { redoStack.push(strokes.pop()); replay(); } },
    redo() { if (redoStack.length) { strokes.push(redoStack.pop()); replay(); } },
    clearEdits() { if (strokes.length) { redoStack = []; strokes = []; replay(); } },

    /** The mask at W×H with an optional feather (px). Cached until the mask or size changes. */
    full(W, H, feather = 0) {
      const c = scratch(`${prefix}-still-full`, W, H);
      const key = `${sm.version}|${W}|${H}|${feather}`;
      if (key === fullKey) return c;
      fullKey = key;
      const fx = c.getContext('2d');
      fx.clearRect(0, 0, W, H);
      fx.imageSmoothingEnabled = true;
      fx.imageSmoothingQuality = 'high';
      if (feather > 0 && supportsCanvasFilter) fx.filter = `blur(${feather}px)`;
      fx.drawImage(out, 0, 0, W, H);
      fx.filter = 'none';
      return c;
    },
  };

  /** One brush dab per quarter radius between two points, on its layer, and cleared from the other. */
  function paint(stroke, from, to) {
    const own = (stroke.mode === 'add' ? add : erase).getContext('2d');
    const other = (stroke.mode === 'add' ? erase : add).getContext('2d');
    const r = stroke.radius;
    const step = Math.max(0.5, r / 4);
    const dist = from ? Math.hypot(to.x - from.x, to.y - from.y) : 0;
    const n = from ? Math.max(1, Math.ceil(dist / step)) : 1;
    for (let i = from ? 1 : 0; i <= (from ? n : 0); i++) {
      const u = from ? i / n : 0;
      const x = from ? from.x + (to.x - from.x) * u : to.x;
      const y = from ? from.y + (to.y - from.y) * u : to.y;
      const grad = own.createRadialGradient(x, y, r * (1 - stroke.softness) * 0.999, x, y, r);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      own.globalCompositeOperation = 'source-over';
      own.fillStyle = grad;
      own.beginPath(); own.arc(x, y, r, 0, Math.PI * 2); own.fill();
      other.globalCompositeOperation = 'destination-out';
      other.fillStyle = grad;
      other.beginPath(); other.arc(x, y, r, 0, Math.PI * 2); other.fill();
      other.globalCompositeOperation = 'source-over';
    }
  }

  function replay() {
    add.getContext('2d').clearRect(0, 0, w, h);
    erase.getContext('2d').clearRect(0, 0, w, h);
    for (const st of strokes) st.points.forEach((p, i) => paint(st, i ? st.points[i - 1] : null, p));
    composite();
  }

  function composite() {
    const ox = out.getContext('2d');
    ox.globalCompositeOperation = 'source-over';
    ox.clearRect(0, 0, w, h);
    ox.drawImage(base, 0, 0);
    ox.drawImage(add, 0, 0);
    ox.globalCompositeOperation = 'destination-out';
    ox.drawImage(erase, 0, 0);
    ox.globalCompositeOperation = 'source-over';
    sm.version++;
  }

  return sm;
}

/** Bilinear resize of a float image (pixel centres aligned). */
function bilinear(src, sw, sh, dw, dh) {
  const dst = new Float32Array(dw * dh);
  const sx = sw / dw, sy = sh / dh;
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, (y + 0.5) * sy - 0.5));
    const y0 = Math.floor(fy), y1 = Math.min(sh - 1, y0 + 1), v = fy - y0;
    for (let x = 0; x < dw; x++) {
      const fx = Math.min(sw - 1, Math.max(0, (x + 0.5) * sx - 0.5));
      const x0 = Math.floor(fx), x1 = Math.min(sw - 1, x0 + 1), u = fx - x0;
      const a = src[y0 * sw + x0], b = src[y0 * sw + x1], c = src[y1 * sw + x0], d = src[y1 * sw + x1];
      dst[y * dw + x] = (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    }
  }
  return dst;
}

/** Mean over a (2r+1)² window, edges normalized by the pixels actually covered. Separable running sums. */
function boxMean(src, w, h, r) {
  const tmp = new Float32Array(w * h), dst = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, w - 1); x++) sum += src[row + x];
    for (let x = 0; x < w; x++) {
      const lo = Math.max(0, x - r), hi = Math.min(w - 1, x + r);
      tmp[row + x] = sum / (hi - lo + 1);
      if (x + r + 1 < w) sum += src[row + x + r + 1];
      if (x - r >= 0) sum -= src[row + x - r];
    }
  }
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, h - 1); y++) sum += tmp[y * w + x];
    for (let y = 0; y < h; y++) {
      const lo = Math.max(0, y - r), hi = Math.min(h - 1, y + r);
      dst[y * w + x] = sum / (hi - lo + 1);
      if (y + r + 1 < h) sum += tmp[(y + r + 1) * w + x];
      if (y - r >= 0) sum -= tmp[(y - r) * w + x];
    }
  }
  return dst;
}

/** Grey guided filter (He et al.): smooths p while keeping the edges of guide I. */
export function guidedFilter(I, p, w, h, r, eps) {
  const n = w * h;
  const II = new Float32Array(n), Ip = new Float32Array(n);
  for (let i = 0; i < n; i++) { II[i] = I[i] * I[i]; Ip[i] = I[i] * p[i]; }
  const mI = boxMean(I, w, h, r), mp = boxMean(p, w, h, r), mII = boxMean(II, w, h, r), mIp = boxMean(Ip, w, h, r);
  const a = II, b = Ip; // reuse buffers
  for (let i = 0; i < n; i++) {
    const varI = mII[i] - mI[i] * mI[i];
    a[i] = (mIp[i] - mI[i] * mp[i]) / (varI + eps);
    b[i] = mp[i] - a[i] * mI[i];
  }
  const ma = boxMean(a, w, h, r), mb = boxMean(b, w, h, r);
  const q = new Float32Array(n);
  for (let i = 0; i < n; i++) q[i] = Math.min(1, Math.max(0, ma[i] * I[i] + mb[i]));
  return q;
}
