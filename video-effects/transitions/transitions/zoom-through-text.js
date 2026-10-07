/* Zoom through text: big text filled with B appears over A, then the camera dives into one
   letter until B fills the frame. The mask is redrawn every frame so edges stay sharp. */
import { percent, smooth, drawMasked, drawFrame } from './_common.js';
import { textParams, layoutText, letterFocus, coverScale, drawGlyphs, maskCanvas } from './_text.js';

function zoomState(P, env) {
  const { W, H, p } = env;
  const L = layoutText(P, W, H, env.refresh);
  const F = letterFocus(L, P.letter, P);
  const appear = smooth(0, 0.22, p);
  const z = Math.min(1, Math.max(0, (p - 0.25) / 0.75)) ** 1.5;
  const cover = coverScale(F, W, H);
  const cam = Math.exp(Math.log(cover) * z) * (1 + 0.25 * (1 - appear));
  return { L, F, appear, z, cam, covered: z >= 1 };
}

export default {
  id: 'zoom-through-text',
  name: 'Zoom through text',
  category: 'text',
  description: 'Text filled with B appears over A, then the camera zooms into a letter.',
  duration: 1.8,
  easing: 'easeInOut',
  params: [
    ...textParams({ text: 'CHAPTER 2', size: 300, letter: true }),
    percent('dim', 'Dim A behind text', 0.45),
    percent('blur', 'Zoom blur', 0.5),
  ],
  presets: [
    { label: 'Chapter', params: { text: 'CHAPTER 2', font: 'Inter', weight: '900', size: 300, letter: 0 } },
    { label: 'Big word', params: { text: 'NEXT', font: 'Anton', weight: '400', size: 520, letter: 2 }, duration: 1.6 },
    { label: 'Serif', params: { text: 'Part II', font: 'Playfair Display', weight: '900', size: 360, letter: 1 }, duration: 2 },
  ],
  mask(P, env) {
    const { W, H } = env;
    const S = zoomState(P, env);
    const { c, ctx } = maskCanvas('ztt', W, H);
    ctx.fillStyle = '#fff';
    if (S.covered) { ctx.fillRect(0, 0, W, H); return c; }
    ctx.globalAlpha = S.appear;
    ctx.translate(S.F.x, S.F.y); ctx.scale(S.cam, S.cam); ctx.translate(-S.F.x, -S.F.y);
    drawGlyphs(ctx, S.L);
    return c;
  },
  glsl: `
uniform vec2 uFocus;
uniform float uCam, uAppear, uDim, uBlur, uZ;
vec4 transition(vec2 uv) {
  float m = getMask(uv).a;
  vec2 auv = zoomAt(uv, uFocus, uCam);
  vec4 a = zoomBlur(0.0, auv, uFocus, uBlur * 0.25 * sin(PI * uZ));
  a.rgb *= 1.0 - uDim * uAppear;
  vec4 b = getB(zoomAt(uv, vec2(0.5), mix(1.12, 1.0, uProgress)));
  vec4 c = mix(a, b, m);
  return mix(c, getB(uv), smoothstep(0.97, 1.0, uProgress));
}`,
  uniforms(P, env) {
    const S = zoomState(P, env);
    return { uFocus: [S.F.x / env.W, S.F.y / env.H], uCam: S.cam, uAppear: S.appear, uDim: P.dim, uBlur: P.blur, uZ: S.z };
  },
  draw2d(ctx, A, B, p, P, env) {
    const S = zoomState(P, env);
    drawFrame(ctx, A, { s: S.cam, cx: S.F.x / env.W, cy: S.F.y / env.H });
    ctx.fillStyle = `rgba(0,0,0,${P.dim * S.appear})`; ctx.fillRect(0, 0, env.W, env.H);
    drawMasked(ctx, B, env.mask);
  },
};
