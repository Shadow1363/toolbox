/*
 * Screenshot effect: an image (comment, tweet, chart, page) on screen for a time range, styled with the
 * Screen Showcase card (lib/showcase-frame.js: frame chrome, radius, border, shadow) and a short entrance/exit.
 *
 * Layouts:
 *   card     the card over the video, placed away from the face (position 'auto') or at top/center/bottom
 *   full-pip the screenshot fills the frame over its own blurred copy; the video (`frame`) shrinks into a corner
 *
 * env.data.images[id] = { el, width, height }; env.data.face = { x, y, w, h } (0..1 of the output) or null;
 * env.data.captionTop = top of the caption area (0..1) or null; env.data.captionBottom = its bottom when the
 * captions sit in the upper half (cards then start below it), else null.
 */
import { buildFrameCard, drawCard, frameChrome } from '../showcase-frame.js';
import { fit, drawBlurred, roundRectPath } from '../canvas.js';
import { ease, clamp } from '../easing.js';

const IN = 0.35, OUT = 0.25;

/** Entrance/exit at local time t of a layer `len` seconds long → { alpha, scale, dy } (dy in fractions of H). */
function motion(kind, t, len) {
  const a = clamp(t / IN), b = clamp((len - t) / OUT);
  const e = Math.min(a, b);
  switch (kind) {
    case 'pop': return { alpha: clamp(e * 2), scale: a < 1 ? 0.6 + 0.4 * ease('easeOutBack', a) : 0.9 + 0.1 * ease('easeOut', b), dy: 0 };
    case 'slide': return { alpha: e, scale: 1, dy: (1 - ease('easeOutQuint', a)) * 0.25 + (1 - ease('easeIn', b)) * 0.25 };
    case 'zoom': return { alpha: e, scale: 0.85 + 0.15 * ease('easeOutQuint', e), dy: 0 };
    default: return { alpha: e, scale: 1, dy: 0 };
  }
}

/** Vertical band [top, bottom] (fractions of H) where the card goes. */
export function cardBand(position, face, captionTop, captionBottom = null) {
  const b = bandFor(position, face, captionTop);
  if (captionBottom == null || b[0] >= captionBottom + 0.01) return b;
  const top = Math.min(0.7, captionBottom + 0.01);
  return [top, Math.max(b[1], top + 0.28)];
}

function bandFor(position, face, captionTop) {
  const capTop = captionTop ?? 0.94;
  if (position === 'top') return [0.05, 0.5];
  if (position === 'bottom') return [0.5, Math.max(0.6, capTop - 0.01)];
  if (position === 'center') return [0.2, 0.8];
  if (!face) return [0.08, Math.max(0.5, capTop - 0.02)];
  const above = [0.04, face.y - 0.02];
  const below = [face.y + face.h + 0.02, capTop - 0.02];
  const room = (b) => b[1] - b[0];
  // Prefer the bigger free band; if both are cramped, use the half away from the face.
  const best = room(above) >= room(below) ? above : below;
  if (room(best) >= 0.28) return best;
  return face.y + face.h / 2 < 0.5 ? [0.5, Math.max(0.62, capTop - 0.01)] : [0.05, 0.5];
}

export default {
  id: 'screenshot',
  name: 'Screenshot',
  description: 'Show one of the uploaded screenshots for a time range, as a styled card or full screen with the speaker in a corner.',
  kind: 'overlay',
  params: [
    { id: 'image', type: 'text', label: 'Screenshot', value: '', ai: 'screenshot id, e.g. "img1"' },
    { id: 'layout', type: 'segmented', label: 'Layout', value: 'card', options: [['card', 'Card'], ['full-pip', 'Full + corner']], ai: 'full-pip for detailed images that need the whole screen' },
    { id: 'position', type: 'segmented', label: 'Position', value: 'auto', options: [['auto', 'Auto'], ['top', 'Top'], ['center', 'Center'], ['bottom', 'Bottom']], ai: 'auto keeps it off the face' },
    { id: 'width', type: 'range', label: 'Width', min: 40, max: 96, value: 86, unit: '%' },
    { id: 'entrance', type: 'segmented', label: 'Entrance', value: 'pop', options: [['pop', 'Pop'], ['slide', 'Slide'], ['zoom', 'Zoom'], ['fade', 'Fade']] },
    { id: 'frame', type: 'select', label: 'Frame', value: 'none', options: [['none', 'None'], ['browser-light', 'Browser (light)'], ['browser-dark', 'Browser (dark)'], ['phone', 'Phone']] },
    { id: 'url', type: 'text', label: 'Address bar', value: '' },
    { id: 'radius', type: 'range', label: 'Corner radius', min: 0, max: 60, value: 24, unit: 'px' },
    { id: 'border', type: 'range', label: 'Border', min: 0, max: 20, value: 0, unit: 'px' },
    { id: 'borderColor', type: 'color', label: 'Border color', value: '#ffffff' },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 150, value: 60, unit: 'px' },
    { id: 'shadowOpacity', type: 'range', label: 'Shadow strength', min: 0, max: 1, step: 0.01, value: 0.45 },
    { id: 'pipSize', type: 'range', label: 'Corner video size', min: 20, max: 50, value: 32, unit: '%' },
  ],
  ai: {
    params: ['image', 'layout', 'position', 'entrance'],
    hint: 'Start it when the speaker refers to the image ("look at this comment") and keep it 2–6 s, at least until they finish talking about it.',
  },
  render(ctx, frame, t, p, env) {
    const img = env.data.images?.[p.image];
    if (!img) return;
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = Math.min(W, H) / 1080;
    const len = env.item ? env.item.end - env.item.start : env.duration;
    const lt = env.local ?? t;
    const mo = motion(p.entrance, lt, len);
    if (mo.alpha <= 0) return;
    const style = { ...p, padding: 0 };

    if (p.layout === 'full-pip') {
      // Background: the screenshot blurred to fill, then the screenshot, then the speaker in a corner.
      ctx.save();
      ctx.globalAlpha = mo.alpha;
      const cover = fit(img.width, img.height, W, H, 'cover');
      const pad = 60 * k;
      drawBlurred(ctx, img.el, cover.x - pad, cover.y - pad, cover.w + pad * 2, cover.h + pad * 2, 40 * k);
      ctx.fillStyle = 'rgba(0,0,0,.35)';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
      const pipW = (W * p.pipSize) / 100, pipH = pipW * 1.25;
      const ch = frameChrome(p.frame, k);
      const area = { w: W * 0.92 - ch.side * 2, h: (H - pipH - 90 * k) * 0.96 - ch.top - ch.bottom };
      const box = fit(img.width, img.height, area.w, area.h);
      const { card, r } = buildFrameCard(img.el, box.w, box.h, k, style, `fx-shot-card-${env.slot ?? 0}`);
      const tf = { rx: 0, ry: 0, scale: mo.scale, x: W / 2, y: 40 * k + (H - pipH - 90 * k) / 2 + mo.dy * H, focal: Math.max(W, H) * 1.6 };
      drawCard(ctx, card, r, tf, style, k, null, mo.alpha);
      // Speaker window: crop the frame around the face.
      const face = env.data.face;
      const fx = face ? face.x + face.w / 2 : 0.5;
      const sw = Math.min(frame.width, (frame.height * pipW) / pipH), sh = (sw * pipH) / pipW;
      const sx = clamp(fx * frame.width - sw / 2, 0, frame.width - sw);
      const sy = clamp((face ? face.y + face.h / 2 : 0.4) * frame.height - sh * 0.42, 0, frame.height - sh);
      const x = W - pipW - 40 * k, y = H - pipH - 40 * k;
      ctx.save();
      ctx.globalAlpha = mo.alpha;
      ctx.shadowColor = 'rgba(0,0,0,.45)';
      ctx.shadowBlur = 30 * k;
      ctx.beginPath();
      roundRectPath(ctx, x, y, pipW, pipH, 28 * k);
      ctx.fillStyle = '#000';
      ctx.fill();
      ctx.shadowColor = 'transparent';
      ctx.clip();
      ctx.drawImage(frame.el, sx, sy, sw, sh, x, y, pipW, pipH);
      ctx.restore();
      return;
    }

    const [top, bottom] = cardBand(p.position, env.data.face, env.data.captionTop, env.data.captionBottom);
    const ch = frameChrome(p.frame, k);
    const box = fit(img.width, img.height, (W * p.width) / 100 - ch.side * 2, Math.max(0.15, bottom - top) * H - ch.top - ch.bottom);
    const { card, r } = buildFrameCard(img.el, box.w, box.h, k, style, `fx-shot-card-${env.slot ?? 0}`);
    const tf = { rx: 0, ry: 0, scale: mo.scale, x: W / 2, y: ((top + bottom) / 2 + mo.dy) * H, focal: Math.max(W, H) * 1.6 };
    drawCard(ctx, card, r, tf, style, k, null, mo.alpha);
  },
};
