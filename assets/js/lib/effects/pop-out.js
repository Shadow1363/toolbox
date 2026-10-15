/*
 * Pop out effect: the frame so far plays inside a social media post (Pop Out tool's post.js) and the person breaks
 * out of the post's media over its header and buttons. People only (MediaPipe segmentation on each frame): the
 * Auto Editor has no clicks, so object masks stay in the Pop Out tool.
 *
 * It replaces the whole picture, so it draws first among overlays (captions, text and screenshots go on top).
 * Pop timing: the subject pops out over `popIn` s from the layer's start; the post itself is there from the start.
 */
import { layoutPost, drawPost, drawPopped, popRect, mediaRect, POST_DEFAULTS, THEMES } from '/video-effects/pop-out/post.js';
import { loadSegmenter } from '../vision.js';
import { createPersonMask } from '../person-mask.js';
import { fit, scratch } from '../canvas.js';
import { ease } from '../easing.js';

const D = POST_DEFAULTS;
let segmenter = null;
const mask = createPersonMask('fx-pop');
const MODEL = 'landscape';

export default {
  id: 'pop-out',
  name: 'Pop out of a post',
  description: 'Show the video inside a social media post (header, buttons, counts, comments) with the person breaking out of the frame over the UI.',
  kind: 'overlay',
  params: [
    { id: 'theme', type: 'segmented', label: 'Theme', value: D.theme, options: [['dark', 'Dark'], ['light', 'Light']] },
    { id: 'aspect', type: 'segmented', label: 'Media shape', value: D.aspect, options: [['4:5', '4:5'], ['1:1', '1:1'], ['9:16', '9:16'], ['16:9', '16:9']] },
    { id: 'postType', type: 'segmented', label: 'Post type', value: D.postType, options: [['regular', 'Regular'], ['boosted', 'Boosted'], ['sponsored', 'Sponsored']] },
    { id: 'ctaText', type: 'text', label: 'Button text', value: D.ctaText },
    { id: 'username', type: 'text', label: 'Username', value: D.username, ai: 'a made-up handle, never a real account' },
    { id: 'audio', type: 'text', label: 'Audio line', value: D.audio },
    { id: 'caption', type: 'text', label: 'Caption', value: D.caption },
    { id: 'likes', type: 'number', label: 'Likes', min: 0, max: 1e10, value: D.likes },
    { id: 'comments', type: 'number', label: 'Comments', min: 0, max: 1e10, value: D.comments },
    { id: 'reposts', type: 'number', label: 'Reposts', min: 0, max: 1e10, value: D.reposts },
    { id: 'shares', type: 'number', label: 'Shares', min: 0, max: 1e10, value: D.shares },
    { id: 'zoom', type: 'range', label: 'Zoom', min: 1, max: 2.5, step: 0.01, value: 1.15 },
    { id: 'popIn', type: 'range', label: 'Pop duration', min: 0, max: 3, step: 0.05, value: 0.6, unit: 's', ai: '0 = popped out from the first frame' },
    { id: 'popScale', type: 'range', label: 'Grow while popped', min: 100, max: 160, value: 112, unit: '%' },
    { id: 'edgeTop', type: 'toggle', label: 'Break through the top', value: true },
    { id: 'edgeBottom', type: 'toggle', label: 'Break through the bottom', value: false },
    { id: 'edgeSides', type: 'toggle', label: 'Break through the sides', value: false },
  ],
  ai: {
    params: ['theme', 'postType', 'username', 'caption', 'likes', 'comments', 'popIn'],
    hint: 'A short attention moment (2–6 s), e.g. when the speaker holds something up to the camera or says "look at this post". It replaces the whole frame while it lasts.',
  },
  async prepare() {
    segmenter ||= await loadSegmenter(MODEL);
  },
  render(ctx, frame, t, p, env) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const k = Math.min(W, H) / 1080;
    const lt = env.local ?? t;
    // The picture so far (video + transitions) becomes the post's media.
    const src = scratch(`fx-pop-src-${W}x${H}`, W, H);
    const sx = src.getContext('2d');
    sx.clearRect(0, 0, W, H);
    sx.drawImage(ctx.canvas, 0, 0);
    const s = { ...D, ...p, showAppBar: true, pageTitle: 'Posts', showHeader: true, showDots: true, captionPos: 'below', captionLines: 2, showCounts: true, showComments: false, showDate: true };
    const L1 = layoutPost(ctx, s, 1);
    const u = Math.min((W * 0.96) / 1080, (H * 0.96) / L1.total);
    const L = layoutPost(ctx, s, u);
    const x = (W - 1080 * u) / 2, y = (H - L.total * u) / 2;
    const r = mediaRect(L, x, y, u);
    const f = fit(W, H, r.w, r.h, 'cover');
    const dw = f.w * p.zoom, dh = f.h * p.zoom;
    const rest = { x: r.x + (r.w - dw) / 2, y: r.y + (r.h - dh) / 2, w: dw, h: dh };
    const pop = p.popIn > 0 ? ease('easeOutBack', lt / p.popIn) : 1;
    const masked = pop > 0.001 && segmenter && mask.update(segmenter, src, t, { model: MODEL });
    // The media and the cut-out share one rect, so the person never shows twice.
    const draw = masked ? popRect({ r, src: rest, box: null, p: pop, k, scale: p.popScale / 100, lift: 30 }) : rest;

    ctx.save();
    ctx.fillStyle = (THEMES[s.theme] || THEMES.dark).bg;
    ctx.fillRect(0, 0, W, H);
    drawPost(ctx, L, s, x, y, u, {});
    ctx.beginPath(); ctx.rect(r.x, r.y, r.w, r.h); ctx.clip();
    ctx.drawImage(src, draw.x, draw.y, draw.w, draw.h);
    ctx.restore();

    if (!masked) return;
    const alpha = mask.full(Math.round(draw.w / 2), Math.round(draw.h / 2), { threshold: 0.5, softness: 0.2, polarity: 'auto', feather: 2 * k });
    drawPopped(ctx, {
      source: src, alpha, r, src: draw, p: pop, k, reach: 420, fade: 0.35,
      edges: { top: p.edgeTop, bottom: p.edgeBottom, sides: p.edgeSides },
      shadow: { blur: 28, offset: 18, opacity: 0.5 }, name: `fx-pop-${env.slot ?? 0}`,
    });
  },
};
