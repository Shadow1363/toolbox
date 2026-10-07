/* Text mask reveal: B shows only through the text, then the letters swell until B fills the frame. */
import { percent, rgb, smooth, drawMasked, fillAll } from './_common.js';
import { textParams, layoutText, drawGlyphs, maskCanvas } from './_text.js';

export default {
  id: 'text-mask-reveal',
  name: 'Text mask reveal',
  category: 'text',
  description: 'B shows through the text, then the text grows until B is fully visible.',
  duration: 1.6,
  easing: 'easeInOut',
  params: [
    ...textParams({ text: 'REVEAL', size: 340 }),
    { id: 'outside', type: 'segmented', label: 'Around the text', value: 'color', options: [['dim', 'Dimmed A'], ['color', 'Solid color']] },
    { id: 'bg', type: 'color', label: 'Background', value: '#0b0b0d', showIf: (s) => s.outside === 'color' },
    percent('dim', 'Dim', 0.6),
  ],
  presets: [
    { label: 'Black card', params: { outside: 'color', bg: '#0b0b0d', text: 'REVEAL' } },
    { label: 'Over A', params: { outside: 'dim', dim: 0.5, text: 'NOW' , size: 480 } },
    { label: 'Paper', params: { outside: 'color', bg: '#f2eee3', text: 'Act One', font: 'DM Serif Display', weight: '400' } },
  ],
  mask(P, env) {
    const { W, H, p } = env;
    const L = layoutText(P, W, H, env.refresh);
    const a = smooth(0, 0.25, p);
    const z = Math.min(1, Math.max(0, (p - 0.3) / 0.7));
    const s = (1 + 0.15 * (1 - a)) * (1 + 4 * z * z);
    const { c, ctx } = maskCanvas('tmr', W, H);
    ctx.fillStyle = '#fff';
    ctx.globalAlpha = a;
    ctx.translate(L.cx, L.cy); ctx.scale(s, s); ctx.translate(-L.cx, -L.cy);
    drawGlyphs(ctx, L, { stroke: z * z * L.size * 1.1 });
    return c;
  },
  glsl: `
uniform float uAppear, uDim, uSolid;
uniform vec3 uBg;
vec4 transition(vec2 uv) {
  float m = getMask(uv).a;
  vec3 a = getA(uv).rgb;
  vec3 around = uSolid > 0.5 ? mix(a, uBg, uAppear) : a * (1.0 - uDim * uAppear);
  vec3 b = getB(zoomAt(uv, vec2(0.5), mix(1.15, 1.0, uProgress))).rgb;
  vec3 c = mix(around, b, m);
  return vec4(mix(c, getB(uv).rgb, smoothstep(0.88, 1.0, uProgress)), 1.0);
}`,
  uniforms: (P, env) => ({ uAppear: smooth(0, 0.25, env.p), uDim: P.dim, uSolid: P.outside === 'color' ? 1 : 0, uBg: rgb(P.bg) }),
  draw2d(ctx, A, B, p, P, env) {
    const a = smooth(0, 0.25, p);
    ctx.drawImage(A, 0, 0);
    if (P.outside === 'color') fillAll(ctx, P.bg, a); else fillAll(ctx, '#000', P.dim * a);
    drawMasked(ctx, B, env.mask);
    if (p > 0.88) { ctx.globalAlpha = smooth(0.88, 1, p); ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1; }
  },
};
