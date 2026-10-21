/**
 * Collage mode for Paper Effect: layout presets, the drop-in timeline and the scrapbook
 * extras (tape, paper clips). No DOM beyond the canvas context passed in.
 *
 *   layoutItems(items, opts)  → one settled placement per item: { x, y, rot, long }
 *   collageTimeline(n, opts)  → { total, build } in seconds
 *   placements(items, t, opts) → what's on screen at t, bottom to top:
 *     [{ i, x, y, rot, long, p, rank }] (p = entrance progress 0..1)
 *   entrance(kind, p, place, W, H, k) → { dx, dy, scale, alpha, rot, lift }
 */
import { rng, hash } from '/assets/js/lib/random.js';
import { clamp, ease } from '/assets/js/lib/easing.js';

export const LAYOUTS = [
  ['pile', 'Messy pile'],
  ['scatter', 'Scattered'],
  ['grid', 'Loose grid'],
  ['scrapbook', 'Scrapbook'],
  ['polaroid', 'Polaroids'],
];

export const COLLAGE_ANIMS = [
  ['drop', 'Drop'],
  ['slide', 'Slide'],
  ['pop', 'Pop'],
  ['none', 'None'],
];

/** Per preset: base size (long side, × the frame's short side), max tilt (°) and how far items spread. */
const PRESET = {
  pile: { size: 0.56, tilt: 14 },
  scatter: { size: 0.4, tilt: 18 },
  grid: { size: 0.9, tilt: 4 },
  scrapbook: { size: 0.44, tilt: 8 },
  polaroid: { size: 0.4, tilt: 11 },
};

/**
 * Settled placement of every item (centre in px, rotation in degrees, long side in px).
 * opts: { W, H, layout, size (×), tilt (×), spread (×), seed, cycle }
 * Items with `manual` ({ x, y (0..1), rot, scale }) keep it on cycle 0.
 */
export function layoutItems(items, { W, H, layout, size = 1, tilt = 1, spread = 1, seed = 1, cycle = 0 }) {
  const n = items.length;
  const P = PRESET[layout] || PRESET.pile;
  const S = Math.min(W, H);
  const r = rng(seed * 977 + cycle * 7919 + 3);
  const out = [];
  let cols = 1, rows = 1;
  if (layout === 'grid' || layout === 'scatter' || layout === 'scrapbook' || layout === 'polaroid') {
    // cells shaped like the frame, so items spread over its whole area
    cols = Math.max(1, Math.round(Math.sqrt((n * W) / H)));
    rows = Math.ceil(n / cols);
  }
  const cellW = W / cols, cellH = H / rows;
  // scattered layouts visit the cells in a shuffled order so neighbours aren't in upload order
  const cells = [...Array(cols * rows).keys()];
  if (layout !== 'grid') for (let i = cells.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [cells[i], cells[j]] = [cells[j], cells[i]]; }
  for (let i = 0; i < n; i++) {
    const it = items[i];
    const ir = rng((it.seed || 1) * 131 + seed * 31 + cycle * 17);
    const jx = ir() - 0.5, jy = ir() - 0.5, jr = ir() - 0.5, js = ir();
    let x, y, long;
    if (layout === 'pile') {
      x = W / 2 + jx * S * 0.28 * spread;
      y = H / 2 + jy * S * 0.24 * spread;
      long = S * P.size * (0.88 + js * 0.2);
    } else if (layout === 'grid') {
      const c = cells[i];
      const cx = (c % cols) + 0.5, cy = Math.floor(c / cols) + 0.5;
      // center the last, partly filled row
      const inRow = Math.floor(c / cols) === rows - 1 ? n - (rows - 1) * cols : cols;
      const offX = ((cols - inRow) * cellW) / 2;
      x = cx * cellW + offX + jx * cellW * 0.08 * spread;
      y = cy * cellH + jy * cellH * 0.08 * spread;
      long = Math.min(cellW, cellH) * P.size * (0.94 + js * 0.06);
    } else {
      const c = cells[i];
      const cx = (c % cols) + 0.5, cy = Math.floor(c / cols) + 0.5;
      x = cx * cellW + jx * cellW * 0.5 * spread;
      y = cy * cellH + jy * cellH * 0.5 * spread;
      long = S * P.size * (0.85 + js * 0.25) * Math.min(1.25, Math.sqrt(4 / Math.max(1, n)) * 1.1);
      // keep the middle of each item inside the frame
      x = Math.min(W - long * 0.3, Math.max(long * 0.3, x));
      y = Math.min(H - long * 0.3, Math.max(long * 0.3, y));
    }
    let place = { x, y, rot: jr * 2 * P.tilt * tilt, long: long * size };
    if (cycle === 0 && it.manual) {
      place = { x: it.manual.x * W, y: it.manual.y * H, rot: it.manual.rot, long: place.long * it.manual.scale };
    }
    out.push(place);
  }
  return out;
}

/** Appearance order: indexes into items. order: 'bottom' (bottom layer first) | 'top' | 'random'. */
export function appearOrder(n, order, seed) {
  const idx = [...Array(n).keys()];
  if (order === 'top') return idx.reverse();
  if (order === 'random') {
    const r = rng(seed * 53 + 11);
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; }
  }
  return idx;
}

/**
 * Timing. mode 'hold': items arrive `delay` s apart, then the finished collage holds `hold` s.
 * mode 'loop': items keep arriving for `rounds` rounds; each arrival moves that item to the top at a new spot.
 */
export function collageTimeline(n, { delay, dur, mode, hold, rounds }) {
  const anim = Math.max(0.01, dur);
  if (!n) return { total: 4, build: 0 };
  if (mode === 'loop') {
    const total = Math.max(1, rounds * n * delay);
    return { total, build: total };
  }
  const build = (n - 1) * delay + anim;
  return { total: Math.max(0.5, build + hold), build };
}

/**
 * Everything on screen at time t, drawn in the returned order (bottom first).
 * opts: layout options + { delay, dur, mode, order, rounds }.
 */
export function placements(items, t, opts) {
  const n = items.length;
  if (!n) return [];
  const order = appearOrder(n, opts.order, opts.seed);
  const anim = Math.max(0.01, opts.dur);
  const progress = (start) => (opts.anim === 'none' ? (t >= start ? 1 : 0) : clamp((t - start) / anim));
  if (opts.mode !== 'loop') {
    const base = layoutItems(items, { ...opts, cycle: 0 });
    const out = [];
    for (let i = 0; i < n; i++) {
      const rank = order.indexOf(i);
      const start = rank * opts.delay;
      if (t < start) continue;
      out.push({ i, ...base[i], p: progress(start), rank, cycle: 0 });
    }
    return out;
  }
  // loop: arrival a puts item order[a % n] on top; its latest arrival decides where it is
  const arrivals = Math.min(Math.floor(t / opts.delay), opts.rounds * n - 1);
  const latest = new Map();
  for (let a = 0; a <= arrivals; a++) latest.set(order[a % n], a);
  const layouts = new Map();
  const layoutFor = (c) => {
    if (!layouts.has(c)) layouts.set(c, layoutItems(items, { ...opts, cycle: c }));
    return layouts.get(c);
  };
  return [...latest.entries()]
    .sort((a, b) => a[1] - b[1])
    .map(([i, a]) => {
      const c = Math.floor(a / n);
      return { i, ...layoutFor(c)[i], p: progress(a * opts.delay), rank: a, cycle: c };
    });
}

/**
 * How an arriving item is moved at progress p (1 = settled).
 * drop: falls toward the table from above the camera with a small bounce; slide: comes in from
 * the nearest side; pop: scales up with overshoot.
 */
export function entrance(kind, p, place, W, H, k, seed) {
  const none = { dx: 0, dy: 0, scale: 1, alpha: 1, rot: 0, lift: 0 };
  if (p >= 1 || kind === 'none') return none;
  if (kind === 'pop') {
    const q = ease('easeOutBack', p);
    return { ...none, scale: Math.max(0.001, q), alpha: clamp(p * 4), lift: (1 - p) * 0.5 };
  }
  if (kind === 'slide') {
    // from the side nearest to the item's settled spot, with a little extra spin
    const dl = place.x, dr = W - place.x, dt = place.y, db = H - place.y;
    const m = Math.min(dl, dr, dt, db);
    const far = place.long * 1.2;
    const [vx, vy] = m === dl ? [-(dl + far), 0] : m === dr ? [dr + far, 0] : m === dt ? [0, -(dt + far)] : [0, db + far];
    const q = 1 - ease('easeOut', p);
    return { ...none, dx: vx * q, dy: vy * q, rot: (hash(seed, 5) - 0.5) * 30 * q, lift: q * 0.6 };
  }
  // drop: scale from 1.5 down to 1, undershoot to 0.96, settle; shadow is far while it's high
  let sc;
  if (p < 0.7) sc = 1.5 - 0.54 * (p / 0.7) ** 2;
  else sc = 0.96 + 0.04 * (1 - (1 - (p - 0.7) / 0.3) ** 2);
  return { ...none, scale: sc, alpha: clamp(p * 5), rot: (hash(seed, 6) - 0.5) * 8 * (1 - p), lift: Math.max(0, sc - 1) * 2 };
}

/* ---------- Scrapbook extras (drawn in the item's local space, centred on the card) ---------- */

const TAPES = ['rgba(238,228,196,0.72)', 'rgba(244,214,214,0.7)', 'rgba(206,229,222,0.7)', 'rgba(236,223,164,0.7)', 'rgba(220,214,240,0.7)'];

function tapeStrip(ctx, x, y, w, h, angle, color, r) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.beginPath();
  // zig-zag torn ends
  const teeth = 5;
  ctx.moveTo(-w / 2, -h / 2);
  ctx.lineTo(w / 2, -h / 2);
  for (let i = 1; i <= teeth; i++) ctx.lineTo(w / 2 + (i % 2 ? h * 0.08 : -h * 0.02) * (0.6 + r()), -h / 2 + (h * i) / teeth);
  ctx.lineTo(-w / 2, h / 2);
  for (let i = teeth - 1; i >= 0; i--) ctx.lineTo(-w / 2 + (i % 2 ? -h * 0.08 : h * 0.02) * (0.6 + r()), -h / 2 + (h * i) / teeth);
  ctx.closePath();
  ctx.shadowColor = 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = h * 0.15;
  ctx.shadowOffsetY = h * 0.05;
  ctx.fillStyle = color;
  ctx.fill();
  ctx.shadowColor = 'transparent';
  // a faint sheen along the strip
  const g = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.25)');
  g.addColorStop(0.5, 'rgba(255,255,255,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.05)');
  ctx.fillStyle = g;
  ctx.fill();
  ctx.restore();
}

/** One or two pieces of tape holding the card (w × h, centred) down. */
export function drawTape(ctx, w, h, k, seed) {
  const r = rng(seed * 401 + 7);
  const color = TAPES[Math.floor(r() * TAPES.length)];
  const th = Math.max(18 * k, Math.min(w, h) * 0.09), tw = Math.max(th * 2.6, w * 0.26);
  if (r() < 0.5) {
    tapeStrip(ctx, (r() - 0.5) * w * 0.2, -h / 2, tw, th, (r() - 0.5) * 0.25, color, r);
  } else {
    tapeStrip(ctx, -w / 2 + tw * 0.18, -h / 2 + tw * 0.18, tw, th, -Math.PI / 4 + (r() - 0.5) * 0.2, color, r);
    tapeStrip(ctx, w / 2 - tw * 0.18, h / 2 - tw * 0.18, tw, th, -Math.PI / 4 + (r() - 0.5) * 0.2, color, r);
  }
}

/** A metal paper clip over the top edge of the card. */
export function drawClip(ctx, w, h, k, seed) {
  const r = rng(seed * 409 + 3);
  const L = Math.max(70 * k, h * 0.22), cw = L * 0.32;
  const x = (r() - 0.5) * w * 0.6, y = -h / 2 + L * 0.22;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate((r() - 0.5) * 0.3);
  const loop = (ox, oy, ww, ll) => {
    ctx.moveTo(ox - ww / 2, oy + ll / 2 - ww / 2);
    ctx.lineTo(ox - ww / 2, oy - ll / 2 + ww / 2);
    ctx.arc(ox, oy - ll / 2 + ww / 2, ww / 2, Math.PI, 0);
    ctx.lineTo(ox + ww / 2, oy + ll / 2 - ww / 2);
  };
  ctx.lineCap = 'round';
  const path = () => {
    ctx.beginPath();
    loop(0, 0, cw, L);
    ctx.arc(cw * 0.1, L / 2 - cw / 2, cw * 0.4, 0, Math.PI);
    ctx.lineTo(-cw * 0.3, -L / 2 + cw * 0.9);
    ctx.arc(-cw * 0.05, -L / 2 + cw * 0.9, cw * 0.25, Math.PI, 0);
    ctx.lineTo(cw * 0.2, L * 0.25);
  };
  ctx.lineWidth = Math.max(2.5, 4 * k);
  ctx.shadowColor = 'rgba(0,0,0,0.35)';
  ctx.shadowBlur = 4 * k;
  ctx.shadowOffsetY = 2 * k;
  ctx.strokeStyle = '#8d939a';
  path();
  ctx.stroke();
  ctx.shadowColor = 'transparent';
  ctx.lineWidth = Math.max(1, 1.5 * k);
  ctx.strokeStyle = 'rgba(255,255,255,0.75)';
  ctx.translate(-0.8 * k, -0.8 * k);
  path();
  ctx.stroke();
  ctx.restore();
}
