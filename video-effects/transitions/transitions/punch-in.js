/* Punch in: a hard cut where B lands scaled up (e.g. 120%) and eases back to 100%. */
import { range, percent, drawFrame } from './_common.js';

export default {
  id: 'punch-in',
  name: 'Punch in',
  category: 'scale',
  description: 'A sharp scale jump on the cut with a quick ease-out.',
  duration: 0.45,
  easing: 'linear',
  params: [
    range('scale', 'Punch', 1.05, 1.6, 1.2, 0.01, '×'),
    percent('pre', 'Push before the cut', 0.3),
    percent('blur', 'Impact blur', 0.4),
    range('cx', 'Center X', 0, 1, 0.5),
    range('cy', 'Center Y', 0, 1, 0.5),
  ],
  pickCenter: true,
  presets: [
    { label: '120%', params: { scale: 1.2, pre: 0.3, blur: 0.4 } },
    { label: 'Hard 140%', params: { scale: 1.4, pre: 0, blur: 0.6 }, duration: 0.35 },
    { label: 'Gentle', params: { scale: 1.08, pre: 0.5, blur: 0 }, duration: 0.6 },
  ],
  glsl: `
uniform float uScale, uPre, uBlur;
uniform vec2 uCenter;
vec4 transition(vec2 uv) {
  float p = uProgress;
  if (p < 0.5) {
    float q = p * 2.0;
    float s = 1.0 + (uScale - 1.0) * 0.25 * uPre * q * q * q;
    return getA(zoomAt(uv, uCenter, s));
  }
  float q = (p - 0.5) * 2.0;
  float e = 1.0 - pow(1.0 - q, 4.0); // quick ease-out
  float s = mix(uScale, 1.0, e);
  float b = uBlur * (1.0 - e) * 0.12;
  return zoomBlur(1.0, zoomAt(uv, uCenter, s), uCenter, b);
}`,
  uniforms: (P) => ({ uScale: P.scale, uPre: P.pre, uBlur: P.blur, uCenter: [P.cx, P.cy] }),
  draw2d(ctx, A, B, p, P, env) {
    if (p < 0.5) {
      const q = p * 2;
      drawFrame(ctx, A, { s: 1 + (P.scale - 1) * 0.25 * P.pre * q ** 3, cx: P.cx, cy: P.cy });
    } else {
      const e = 1 - (1 - (p - 0.5) * 2) ** 4;
      drawFrame(ctx, B, { s: P.scale + (1 - P.scale) * e, cx: P.cx, cy: P.cy, blur: P.blur * (1 - e) * 10 * env.k });
    }
  },
};
