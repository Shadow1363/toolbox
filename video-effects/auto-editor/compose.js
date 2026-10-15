/*
 * Auto Editor: turns an EDL into a render plan and draws output frames. Preview, PNG, GIF and the video export all
 * call render(), so the export is what you reviewed.
 *
 *   const plan = await buildPlan({ edl, duration, size: { width, height }, out: { W, H }, words, face, images, effects });
 *   renderFrame(ctx, plan, t, { main, next })
 *     main = the source frame at plan.tm.outToSrc(t) (a <video> or a decoded canvas)
 *     next = the first frame of the next segment (only used during a transition's first half)
 *
 * Per frame: base (reframe crop → punch-in → zoom camera, through the registry's zoom effect)
 *            → transition at a cut (registry transition effect) → screenshots → text → captions → progress.
 */
import { scratch } from '/assets/js/lib/canvas.js';
import { buildLines } from '/assets/js/lib/transcript.js';
import { sampleTrack } from '/assets/js/lib/head-tracking.js';
import { getEffect, effectParams, createGpu } from '/assets/js/lib/effects/index.js';
import { captionPages } from '/assets/js/lib/effects/captions.js';
import { buildTimemap, retimeWords, retimeRange } from './timemap.js';

const OVERLAY_ORDER = ['screenshot', 'text'];

/** Output size for an aspect setting ('9:16', '1:1', '4:5', '16:9' or 'source') and short side. */
export function outputDims(aspect, short, src) {
  const [aw, ah] = aspect === 'source' ? [src.width, src.height] : aspect.split(':').map(Number);
  const even = (v) => Math.max(2, Math.round(v / 2) * 2);
  if (aspect === 'source') {
    const sc = short / Math.min(aw, ah);
    return { W: even(aw * sc), H: even(ah * sc) };
  }
  return aw <= ah ? { W: even(short), H: even((short * ah) / aw) } : { W: even((short * aw) / ah), H: even(short) };
}

export async function buildPlan({ edl, duration, size, out, words = [], face = null, images = {} }) {
  const { W, H } = out;
  const k = Math.min(W, H) / 1080;
  const sw = size.width, sh = size.height;
  const tm = buildTimemap(edl.cuts.filter((c) => !c.off), duration);
  const cam = edl.camera || {};

  /* Camera: an aspect-locked crop that follows the face, tighter on every other segment (jump-cut punch-in). */
  const headAt = (srcT) => (cam.reframe === 'center' ? null : sampleTrack(face, srcT));
  const crop = (seg, srcT) => {
    const a = W / H;
    let cw = sw / sh > a ? sh * a : sw;
    let ch = sw / sh > a ? sh : sw / a;
    const z = cam.punchIn && seg.index % 2 === 1 ? cam.punchZoom || 1.12 : 1;
    cw /= z;
    ch /= z;
    const f = headAt(srcT);
    let cx = sw / 2, cy = sh / 2;
    if (f && f.alpha > 0.2) {
      cx = f.x * sw;
      cy = (f.y + f.size * 0.8) * sh + ch * 0.12; // face about 38% from the top of the crop
    }
    return {
      x: Math.min(sw - cw, Math.max(0, cx - cw / 2)),
      y: Math.min(sh - ch, Math.max(0, cy - ch / 2)),
      w: cw,
      h: ch,
    };
  };
  /** The face box in output fractions (camera zooms ignored), for keeping screenshots off it. */
  const faceOut = (t) => {
    const srcT = tm.outToSrc(t);
    const f = headAt(srcT);
    if (!f || f.alpha < 0.2) return null;
    const c = crop(tm.segmentAt(t), srcT);
    const hw = f.size * sh;
    return { x: (f.x * sw - hw / 2 - c.x) / c.w, y: (f.y * sh - c.y) / c.h, w: hw / c.w, h: (hw * 1.4) / c.h };
  };
  /** Face centre in crop fractions, for zooms. */
  const faceAt = (t) => {
    const srcT = tm.outToSrc(t);
    const f = headAt(srcT);
    if (!f) return null;
    const c = crop(tm.segmentAt(t), srcT);
    return { x: (f.x * sw - c.x) / c.w, y: ((f.y + f.size * 0.6) * sh - c.y) / c.h };
  };

  /* Layers in output time */
  const layers = edl.layers.filter((l) => !l.off);
  const timed = [];
  layers.forEach((l, i) => {
    const e = getEffect(l.effect);
    if (!e || e.kind === 'transition') return;
    const r = retimeRange(l.start, l.end, tm);
    if (!r) return;
    timed.push({ id: l.id, effect: e, start: r.start, end: r.end, params: effectParams(e, l.params).params, slot: i });
  });
  const zoomFx = getEffect('zoom');
  const zoomKeys = zoomFx.track(timed.filter((l) => l.effect.id === 'zoom'), { data: { faceAt } });
  const overlays = timed
    .filter((l) => l.effect.kind === 'overlay')
    .sort((a, b) => OVERLAY_ORDER.indexOf(a.effect.id) - OVERLAY_ORDER.indexOf(b.effect.id) || a.start - b.start);

  const transitions = [];
  for (const l of layers.filter((x) => getEffect(x.effect)?.kind === 'transition')) {
    const c = edl.cuts.find((x) => x.id === l.at && !x.off);
    const cp = c && tm.cutPoints.find((p) => p.from <= c.start + 1e-3 && p.to >= c.end - 1e-3);
    if (!cp) continue;
    const params = effectParams(getEffect('transition'), l.params).params;
    const room = 2 * 0.45 * Math.min(cp.before.out - cp.before.in, cp.after.out - cp.after.in);
    const d = Math.min(params.duration, room);
    if (d < 0.08) continue;
    transitions.push({ id: l.id, t: cp.t, d, params: { ...params, duration: d }, extra: l.extra, after: cp.after });
  }

  const capFx = getEffect('captions');
  let captions = null, band = {};
  if (edl.captions?.enabled) {
    const params = effectParams(capFx, edl.captions.params).params;
    const outWords = retimeWords(words, tm);
    captions = { params, pages: captionPages(buildLines(outWords), params) };
    band = captionBand(params, k, H);
  }
  const progress = edl.progress?.enabled ? effectParams(getEffect('progress'), edl.progress.params).params : null;

  // Fonts and GPU before the first frame.
  await Promise.all([
    captions && capFx.prepare(captions.params),
    progress && getEffect('progress').prepare(progress),
    ...overlays.map((o) => o.effect.prepare?.(o.params)),
  ]);
  const gpu = transitions.length ? await createGpu() : null;

  return { W, H, k, sw, sh, tm, edl, crop, faceOut, faceAt, zoomKeys, overlays, transitions, captions, ...band, progress, images, gpu, held: { id: null } };
}

/**
 * The screen area the captions keep for themselves, so screenshot cards stay clear of them: captions in the lower
 * half give `captionTop` (cards end above it), in the upper half `captionBottom` (cards start below it).
 * `half` is half the height of a two-line caption, in fractions of H.
 */
export function captionBand(params, k, H) {
  const half = (params.size * k * 1.2) / H;
  const y = params.posY / 100;
  return y >= 0.5 ? { captionTop: y - half, captionBottom: null, captionHalf: half } : { captionTop: null, captionBottom: y + half, captionHalf: half };
}

const ZOOM_BASE = { motionBlur: true };

function drawBase(c, plan, el, seg, srcT, t) {
  if (!el) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, plan.W, plan.H);
    return;
  }
  getEffect('zoom').render(c, { el, width: plan.sw, height: plan.sh }, t, ZOOM_BASE, {
    crop: plan.crop(seg, srcT),
    track: plan.zoomKeys,
    data: {},
  });
}

export function renderFrame(ctx, plan, t, frames = {}) {
  const { W, H, tm } = plan;
  const seg = tm.segmentAt(t);
  const srcT = tm.outToSrc(t);
  const base = scratch(`ae-base-${W}x${H}`, W, H);
  const bc = base.getContext('2d');
  drawBase(bc, plan, frames.main, seg, srcT, t);

  const tr = plan.transitions.find((x) => Math.abs(t - x.t) < x.d / 2);
  if (tr) {
    const local = t - (tr.t - tr.d / 2);
    let A, B;
    if (t < tr.t) {
      A = base;
      B = scratch(`ae-B-${W}x${H}`, W, H);
      drawBase(B.getContext('2d'), plan, frames.next || frames.main, tr.after, tr.after.in, tr.t);
      // Keep the last outgoing frame for the second half.
      const held = scratch(`ae-held-${W}x${H}`, W, H);
      held.getContext('2d').drawImage(base, 0, 0);
      plan.held.id = tr.id;
    } else {
      A = plan.held.id === tr.id ? scratch(`ae-held-${W}x${H}`, W, H) : base;
      B = base;
    }
    getEffect('transition').render(ctx, null, t, tr.params, { gpu: plan.gpu, A, B, local, item: { extra: tr.extra }, data: {} });
  } else {
    ctx.drawImage(base, 0, 0);
  }

  const env = (item) => ({
    W, H, k: plan.k, duration: tm.duration, item, local: t - item.start, slot: item.slot,
    gpu: plan.gpu,
    data: { images: plan.images, face: plan.faceOut(t), captionTop: plan.captionTop, captionBottom: plan.captionBottom, pages: plan.captions?.pages },
  });
  const frame = { el: base, width: W, height: H };
  for (const o of plan.overlays) {
    if (t < o.start || t >= o.end) continue;
    o.effect.render(ctx, frame, t, o.params, env(o));
  }
  if (plan.captions) getEffect('captions').render(ctx, frame, t, plan.captions.params, env({ start: 0, end: tm.duration, slot: 0 }));
  if (plan.progress) getEffect('progress').render(ctx, frame, t, plan.progress, env({ start: 0, end: tm.duration, slot: 0 }));
}
