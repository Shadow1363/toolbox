/* Stretch: A stretches along an axis with blur and snaps into B, which unstretches. */
import { range, percent, axis } from './_common.js';

export default {
  id: 'stretch',
  name: 'Stretch',
  category: 'scale',
  description: 'A stretches with blur and snaps into B.',
  duration: 0.6,
  easing: 'easeInOutExpo',
  params: [
    axis('horizontal'),
    range('amount', 'Stretch', 1.5, 8, 4, 0.1, '×'),
    percent('blur', 'Blur', 0.6),
  ],
  presets: [
    { label: 'Snap', params: { axis: 'horizontal', amount: 4, blur: 0.6 } },
    { label: 'Elastic tall', params: { axis: 'vertical', amount: 3 }, easing: 'easeInOutBack' },
    { label: 'Extreme', params: { amount: 8, blur: 1 }, duration: 0.45 },
  ],
  glsl: `
uniform float uAmount, uBlur, uVertical;
vec4 side(float which, vec2 uv, float q) {
  float s = 1.0 + (uAmount - 1.0) * q * q;
  vec2 d = uVertical > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  vec2 suv = uv;
  if (uVertical > 0.5) suv.y = 0.5 + (uv.y - 0.5) / s; else suv.x = 0.5 + (uv.x - 0.5) / s;
  return dirBlur(which, suv, d * uBlur * q * 0.12);
}
vec4 transition(vec2 uv) {
  float p = uProgress;
  vec4 a = side(0.0, uv, clamp(p * 2.0, 0.0, 1.0));
  vec4 b = side(1.0, uv, clamp((1.0 - p) * 2.0, 0.0, 1.0));
  return mix(a, b, smoothstep(0.46, 0.54, p));
}`,
  uniforms: (P) => ({ uAmount: P.amount, uBlur: P.blur, uVertical: P.axis === 'vertical' ? 1 : 0 }),
  draw2d(ctx, A, B, p, P, env) {
    const { W, H } = env;
    const src = p < 0.5 ? A : B;
    const q = p < 0.5 ? p * 2 : (1 - p) * 2;
    const s = 1 + (P.amount - 1) * q * q;
    ctx.save();
    ctx.translate(W / 2, H / 2);
    if (P.axis === 'vertical') ctx.scale(1, s); else ctx.scale(s, 1);
    ctx.translate(-W / 2, -H / 2);
    if (P.blur * q > 0.05) ctx.filter = `blur(${P.blur * q * 8 * env.k}px)`;
    ctx.drawImage(src, 0, 0);
    ctx.restore();
  },
};
