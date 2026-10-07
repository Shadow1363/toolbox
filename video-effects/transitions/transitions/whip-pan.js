/* Whip pan: both shots fly past in one direction under strong motion blur. */
import { percent, direction, dirVec, drawFrame } from './_common.js';

export const SLIDE_GLSL = `
uniform vec2 uDir;
uniform float uBlur, uParallax;
// The A/B "film strip": A sits at 0, B one frame-width behind it, opposite the motion.
vec4 strip(vec2 uv) {
  float p = uProgress;
  vec2 ua = uv - uDir * p * (1.0 - uParallax * 0.5);
  vec2 ub = uv - uDir * (p - 1.0);
  float inB = inBounds(ub);
  return inB > 0.5 ? getB(ub) : getA(ua);
}
`;

export default {
  id: 'whip-pan',
  name: 'Whip pan',
  category: 'motion',
  description: 'A fast directional slide with strong motion blur.',
  duration: 0.45,
  easing: 'easeInOutExpo',
  params: [direction('left'), percent('blur', 'Motion blur', 0.8)],
  presets: [
    { label: 'Whip left', params: { direction: 'left', blur: 0.8 } },
    { label: 'Whip up', params: { direction: 'up', blur: 0.9 } },
    { label: 'Light', params: { blur: 0.4 }, duration: 0.6 },
  ],
  glsl: SLIDE_GLSL + `
vec4 transition(vec2 uv) {
  float amt = uBlur * 0.45 * sin(PI * clamp(uProgress, 0.0, 1.0));
  vec4 acc = vec4(0.0);
  float j = jitter();
  for (int i = 0; i < BLUR_N; i++) {
    float f = (float(i) + 0.5 + j) / float(BLUR_N) - 0.5;
    acc += strip(uv + uDir * amt * f);
  }
  return acc / float(BLUR_N);
}`,
  uniforms: (P) => ({ uDir: dirVec(P.direction), uBlur: P.blur, uParallax: 0 }),
  draw2d(ctx, A, B, p, P, env) {
    const [dx, dy] = dirVec(P.direction);
    const blur = P.blur * 30 * env.k * Math.sin(Math.PI * p);
    drawFrame(ctx, A, { dx: dx * p, dy: dy * p, blur });
    drawFrame(ctx, B, { dx: dx * (p - 1), dy: dy * (p - 1), blur });
  },
};
