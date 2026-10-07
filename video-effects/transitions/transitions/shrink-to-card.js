/* Shrink to card: A shrinks into a rounded card with a shadow, then slides away to reveal B.
   Grow from card reuses this shader with uReverse = 1 (B grows from a card over A). */
import { range, percent, direction, dirVec, drawFrame, DIRS } from './_common.js';
import { roundRectPath } from '/assets/js/lib/canvas.js';

export const cardParams = (dir) => [
  range('scale', 'Card size', 0.3, 0.9, 0.62, 0.01, '×'),
  range('radius', 'Corner radius', 0, 120, 48, 1, 'px'),
  percent('shadow', 'Shadow', 0.6),
  percent('dim', 'Dim behind', 0.35),
  direction(dir),
];

export const CARD_GLSL = `
uniform float uScale, uRadius, uShadow, uDim, uReverse;
uniform vec2 uDir;
vec4 transition(vec2 uv) {
  float p = uReverse > 0.5 ? 1.0 - uProgress : uProgress;
  float shrink = smoothstep(0.0, 0.55, p);
  float slide = smoothstep(0.42, 1.0, p);
  slide = slide * slide;
  float sc = mix(1.0, uScale, shrink);
  float k = min(uRes.x, uRes.y) / 1080.0;
  float rad = uRadius * k * shrink;
  vec2 travel = uRes * (0.5 + 0.5 * sc) + 120.0 * k;
  vec2 px = (uv - 0.5) * uRes;
  vec2 off = uDir * travel * slide;
  vec2 hb = 0.5 * uRes * sc;
  float sd = sdRoundBox(px - off, hb, rad);
  vec2 fuv = (px - off) / (uRes * sc) + 0.5;
  vec4 front = uReverse > 0.5 ? getB(fuv) : getA(fuv);
  float behindZoom = mix(1.08, 1.0, slide);
  vec4 back = uReverse > 0.5 ? getA(zoomAt(uv, vec2(0.5), behindZoom)) : getB(zoomAt(uv, vec2(0.5), behindZoom));
  back.rgb *= 1.0 - uDim * shrink * (1.0 - slide);
  float blur = 70.0 * k * shrink + 1.0;
  float sdS = sdRoundBox(px - off - vec2(0.0, 26.0 * k * shrink), hb, rad);
  float shadow = uShadow * 0.75 * (1.0 - smoothstep(-blur * 0.6, blur, sdS)) * shrink;
  vec4 col = vec4(back.rgb * (1.0 - shadow), 1.0);
  return mix(col, front, 1.0 - smoothstep(-0.75, 0.75, sd));
}`;

export const cardUniforms = (reverse) => (P) => ({
  uScale: P.scale, uRadius: P.radius, uShadow: P.shadow, uDim: P.dim, uReverse: reverse ? 1 : 0, uDir: dirVec(P.direction),
});

export const cardDraw2d = (reverse) => (ctx, A, B, p0, P, env) => {
  const { W, H, k } = env;
  const p = reverse ? 1 - p0 : p0;
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const shrink = sm(0, 0.55, p), slide = sm(0.42, 1, p) ** 2;
  const sc = 1 + (P.scale - 1) * shrink;
  const [dx, dy] = DIRS[P.direction] || DIRS.left;
  const ox = dx * (W * (0.5 + 0.5 * sc) + 120 * k) * slide, oy = dy * (H * (0.5 + 0.5 * sc) + 120 * k) * slide;
  const front = reverse ? B : A, back = reverse ? A : B;
  drawFrame(ctx, back, { s: 1.08 - 0.08 * slide });
  ctx.fillStyle = `rgba(0,0,0,${P.dim * shrink * (1 - slide)})`;
  ctx.fillRect(0, 0, W, H);
  const w = W * sc, h = H * sc, x = W / 2 - w / 2 + ox, y = H / 2 - h / 2 + oy;
  ctx.save();
  ctx.shadowColor = `rgba(0,0,0,${0.6 * P.shadow * shrink})`;
  ctx.shadowBlur = 60 * k * shrink; ctx.shadowOffsetY = 24 * k * shrink;
  ctx.beginPath(); roundRectPath(ctx, x, y, w, h, P.radius * k * shrink);
  ctx.fillStyle = '#000'; ctx.fill();
  ctx.shadowColor = 'transparent';
  ctx.clip(); ctx.drawImage(front, x, y, w, h);
  ctx.restore();
};

export default {
  id: 'shrink-to-card',
  name: 'Shrink to card',
  category: 'scale',
  description: 'A shrinks into a rounded card and slides away, revealing B.',
  duration: 1.1,
  easing: 'easeInOut',
  params: cardParams('left'),
  presets: [
    { label: 'Slide left', params: { direction: 'left', scale: 0.62 } },
    { label: 'Drop down', params: { direction: 'down', scale: 0.7, radius: 64 } },
    { label: 'Tiny card', params: { scale: 0.38, radius: 30, shadow: 0.9 }, duration: 1.4 },
  ],
  glsl: CARD_GLSL,
  uniforms: cardUniforms(false),
  draw2d: cardDraw2d(false),
};
