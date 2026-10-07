/* Luma fade / dip to color: dissolve, a brightness-ordered fade, or a dip through a solid color. */
import { percent, rgb, smooth } from './_common.js';

const MODES = { dissolve: 0, luma: 1, dip: 2 };

export default {
  id: 'luma-fade',
  name: 'Luma fade / dip',
  category: 'motion',
  description: 'Cross-fade by brightness, or fade through black or white.',
  duration: 0.8,
  easing: 'easeInOut',
  params: [
    { id: 'mode', type: 'segmented', label: 'Mode', value: 'luma', options: [['dissolve', 'Dissolve'], ['luma', 'Luma'], ['dip', 'Dip to color']] },
    { id: 'color', type: 'color', label: 'Color', value: '#000000', showIf: (s) => s.mode === 'dip' },
    percent('softness', 'Softness', 0.25),
    { id: 'invert', type: 'toggle', label: 'Darks first', value: false, showIf: (s) => s.mode === 'luma' },
  ],
  presets: [
    { label: 'Dip to black', params: { mode: 'dip', color: '#000000' } },
    { label: 'Dip to white', params: { mode: 'dip', color: '#ffffff' } },
    { label: 'Luma (highlights)', params: { mode: 'luma', invert: false, softness: 0.25 } },
    { label: 'Dissolve', params: { mode: 'dissolve' } },
  ],
  glsl: `
uniform float uMode, uSoft, uInvert;
uniform vec3 uColor;
vec4 transition(vec2 uv) {
  float p = uProgress;
  vec4 a = getA(uv), b = getB(uv);
  if (uMode < 0.5) return mix(a, b, p);
  if (uMode < 1.5) {
    float l = luma(a.rgb);
    if (uInvert < 0.5) l = 1.0 - l;
    float s = max(0.01, uSoft);
    float m = smoothstep(l - s, l + s, p * (1.0 + 2.0 * s) - s);
    return mix(a, b, m);
  }
  // Dip: hold the color briefly in the middle (softness controls the hold).
  float hold = uSoft * 0.3;
  float down = smoothstep(0.0, 0.5 - hold, p);
  float up = smoothstep(0.5 + hold, 1.0, p);
  vec4 c = vec4(uColor, 1.0);
  return p < 0.5 ? mix(a, c, down) : mix(c, b, up);
}`,
  uniforms: (P) => ({ uMode: MODES[P.mode] ?? 0, uSoft: P.softness, uInvert: P.invert ? 1 : 0, uColor: rgb(P.color) }),
  draw2d(ctx, A, B, p, P, env) {
    if (P.mode === 'dip') {
      const hold = P.softness * 0.3;
      if (p < 0.5) { ctx.drawImage(A, 0, 0); ctx.globalAlpha = smooth(0, 0.5 - hold, p); }
      else { ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1 - smooth(0.5 + hold, 1, p); }
      ctx.fillStyle = P.color; ctx.fillRect(0, 0, env.W, env.H); ctx.globalAlpha = 1;
      return;
    }
    ctx.drawImage(A, 0, 0); ctx.globalAlpha = p; ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1;
  },
};
