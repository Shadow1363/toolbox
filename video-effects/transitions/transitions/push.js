/* Push / slide: B pushes A off screen, or slides in over it. */
import { percent, direction, dirVec, drawFrame } from './_common.js';
import { SLIDE_GLSL } from './whip-pan.js';

export default {
  id: 'push',
  name: 'Push / slide',
  category: 'motion',
  description: 'B pushes A off the screen in the chosen direction.',
  duration: 0.7,
  easing: 'easeInOut',
  params: [
    direction('left'),
    { id: 'mode', type: 'segmented', label: 'Mode', value: 'push', options: [['push', 'Push'], ['over', 'Slide over']] },
    percent('blur', 'Motion blur', 0.15),
  ],
  presets: [
    { label: 'Push left', params: { direction: 'left', mode: 'push' } },
    { label: 'Cover up', params: { direction: 'up', mode: 'over', blur: 0 } },
    { label: 'Snappy', params: { blur: 0.35 }, easing: 'easeInOutExpo', duration: 0.5 },
  ],
  glsl: SLIDE_GLSL + `
vec4 transition(vec2 uv) {
  float amt = uBlur * 0.2 * sin(PI * clamp(uProgress, 0.0, 1.0));
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 12; i++) {
    float f = (float(i) + 0.5) / 12.0 - 0.5;
    acc += strip(uv + uDir * amt * f);
  }
  vec4 c = acc / 12.0;
  // Slide over: darken A a little as it is covered.
  vec2 ub = uv - uDir * (uProgress - 1.0);
  if (uParallax > 1.5 && inBounds(ub) < 0.5) c.rgb *= 1.0 - 0.35 * uProgress;
  return c;
}`,
  uniforms: (P) => ({ uDir: dirVec(P.direction), uBlur: P.blur, uParallax: P.mode === 'over' ? 2 : 0 }),
  draw2d(ctx, A, B, p, P, env) {
    const [dx, dy] = dirVec(P.direction);
    const blur = P.blur * 12 * env.k * Math.sin(Math.PI * p);
    if (P.mode === 'over') {
      drawFrame(ctx, A, {});
      ctx.fillStyle = `rgba(0,0,0,${0.35 * p})`; ctx.fillRect(0, 0, env.W, env.H);
    } else drawFrame(ctx, A, { dx: dx * p, dy: dy * p, blur });
    drawFrame(ctx, B, { dx: dx * (p - 1), dy: dy * (p - 1), blur });
  },
};
