/**
 * Sequence model: clip lengths, where each transition overlaps two clips, what is on screen
 * at time t, and how one clip frame is drawn (fit / fill / blurred fill + Ken Burns).
 *
 * Overlap model: a transition of duration d starts d seconds before clip A ends; clip B
 * starts at the same moment. Intro/outro transitions use the first/last d seconds of a clip
 * with a solid color as the other side. Durations are capped at 45% of each neighbouring
 * clip so two transitions never overlap.
 */
import { fit, scratch, drawBlurred } from '/assets/js/lib/canvas.js';

export const MAX_SHARE = 0.45;

export const clipLength = (c) => (c.kind === 'video' ? Math.max(0.2, c.trimOut - c.trimIn) : c.duration);

/** Effective (capped) duration of a slot between clips of length la and lb. */
export const slotDuration = (slot, la, lb = la) =>
  (!slot || slot.type === 'cut' ? 0 : Math.max(0, Math.min(slot.duration, la * MAX_SHARE, lb * MAX_SHARE)));

export function buildTimeline(clips, cuts, intro, outro) {
  const lens = clips.map(clipLength);
  const starts = [];
  const cutD = [];
  let t = 0;
  clips.forEach((c, i) => {
    starts.push(t);
    if (i < clips.length - 1) {
      const d = slotDuration(cuts[i], lens[i], lens[i + 1]);
      cutD.push(d);
      t += lens[i] - d;
    }
  });
  const n = clips.length;
  const total = n ? starts[n - 1] + lens[n - 1] : 0;
  const introD = n ? slotDuration(intro, lens[0]) : 0;
  const outroD = n ? slotDuration(outro, lens[n - 1]) : 0;
  return { lens, starts, cutD, total, introD, outroD };
}

/** Time window of a slot ('intro' | 'outro' | cut index): { start, d }. */
export function slotWindow(tl, slot) {
  if (slot === 'intro') return { start: 0, d: tl.introD };
  if (slot === 'outro') return { start: tl.total - tl.outroD, d: tl.outroD };
  return { start: tl.starts[slot + 1], d: tl.cutD[slot] };
}

/**
 * What to draw at time t:
 *   { kind: 'clip', i, local }
 *   { kind: 'transition', slot, raw, a: { i, local } | { color }, b: … }
 */
export function frameAt(tl, t) {
  const n = tl.lens.length;
  if (!n) return null;
  t = Math.max(0, Math.min(t, tl.total));
  for (let i = 0; i < n - 1; i++) {
    const s = tl.starts[i + 1], d = tl.cutD[i];
    if (d > 0 && t >= s && t < s + d) {
      return { kind: 'transition', slot: i, raw: (t - s) / d, a: { i, local: t - tl.starts[i] }, b: { i: i + 1, local: t - s } };
    }
  }
  let i = n - 1;
  while (i > 0 && t < tl.starts[i]) i--;
  // Inside a cut window both clips are live; outside it, the later clip wins.
  const local = Math.min(t - tl.starts[i], tl.lens[i]);
  if (i === 0 && tl.introD > 0 && t < tl.introD) {
    return { kind: 'transition', slot: 'intro', raw: t / tl.introD, a: { color: true }, b: { i: 0, local } };
  }
  if (i === n - 1 && tl.outroD > 0 && t >= tl.total - tl.outroD) {
    return { kind: 'transition', slot: 'outro', raw: (t - (tl.total - tl.outroD)) / tl.outroD, a: { i, local }, b: { color: true } };
  }
  return { kind: 'clip', i, local };
}

/** Clips that must be playing (or ready) at time t, with their local times. */
export function activeClips(tl, t) {
  const out = [];
  tl.lens.forEach((len, i) => {
    const local = t - tl.starts[i];
    if (local >= -0.001 && local <= len + 0.001) out.push({ i, local: Math.max(0, Math.min(local, len)) });
  });
  return out;
}

/**
 * Draw clip c at local time `local` into ctx (full canvas).
 * mode: 'fit' (letterbox on bg), 'fill' (cover, crop), 'blur' (blurred cover behind a fit).
 */
export function drawClip(ctx, c, local, mode, bg) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const el = c.media.el;
  const sw = c.media.width, sh = c.media.height;
  ctx.save();
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  if (c.kind === 'image' && c.kenBurns !== 'off') {
    const u = Math.min(1, Math.max(0, local / c.duration));
    let s = 1.12, dx = 0;
    if (c.kenBurns === 'in') s = 1 + 0.12 * u;
    else if (c.kenBurns === 'out') s = 1.12 - 0.12 * u;
    else dx = (c.kenBurns === 'left' ? -1 : 1) * (u - 0.5) * 0.08 * W;
    ctx.translate(W / 2 + dx, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
  }
  if (mode === 'blur') {
    const cover = fit(sw, sh, W, H, 'cover');
    const k = Math.min(W, H) / 1080;
    // Blur a small copy: cheaper, and looks the same once blurred.
    const small = scratch(`tr-blurfill-${W}x${H}`, W / 4, H / 4);
    const sc = small.getContext('2d');
    sc.drawImage(el, cover.x / 4, cover.y / 4, cover.w / 4, cover.h / 4);
    drawBlurred(ctx, small, -20 * k, -20 * k, W + 40 * k, H + 40 * k, 12 * k);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(0, 0, W, H);
  }
  const r = fit(sw, sh, W, H, mode === 'fill' ? 'cover' : 'contain');
  ctx.drawImage(el, r.x, r.y, r.w, r.h);
  ctx.restore();
}
