/* Glitch: RGB split, slice displacement and noise for a few frames around the cut. */
import { range, percent, seed } from './_common.js';
import { hash } from '/assets/js/lib/random.js';

export default {
  id: 'glitch',
  name: 'Glitch',
  category: 'motion',
  description: 'RGB split, slice displacement and noise.',
  duration: 0.5,
  easing: 'linear',
  params: [
    percent('strength', 'Strength', 0.7),
    range('slices', 'Slices', 4, 40, 16, 1),
    percent('rgb', 'RGB split', 0.6),
    percent('noise', 'Noise', 0.35),
    range('fps', 'Glitch rate', 6, 30, 15, 1, ' fps'),
    seed(),
  ],
  presets: [
    { label: 'Digital', params: { strength: 0.7, slices: 16, rgb: 0.6, noise: 0.35 } },
    { label: 'Datamosh', params: { strength: 1, slices: 34, rgb: 0.9, noise: 0.6, fps: 24 }, duration: 0.7 },
    { label: 'Subtle', params: { strength: 0.35, slices: 8, rgb: 0.4, noise: 0.15, fps: 10 } },
  ],
  glsl: `
uniform float uStrength, uSlices, uRgb, uNoise, uStep, uDuration;
vec4 frame(vec2 uv, float useB) { return useB > 0.5 ? getB(uv) : getA(uv); }
vec4 transition(vec2 uv) {
  float p = uRaw;
  float g = uStrength * pow(1.0 - abs(p * 2.0 - 1.0), 0.6);
  float st = uStep;
  // Flicker between A and B around the cut.
  float r = rand(vec2(st, 3.7));
  float useB = step(0.5, p);
  if (abs(p - 0.5) < 0.18) useB = step(r, (p - 0.32) / 0.36);
  // Slice displacement.
  float row = floor(uv.y * uSlices + rand(vec2(st, 9.1)) * 3.0);
  float on = step(0.55, rand(vec2(row, st)));
  float shift = (rand(vec2(row * 1.7, st + 2.0)) - 0.5) * 0.25 * g * on;
  // A few displaced blocks.
  vec2 cell = floor(uv * vec2(6.0, 9.0));
  float blk = step(0.93, rand(cell + st)) * g;
  vec2 duv = uv + vec2(shift + blk * (rand(cell * 3.1 + st) - 0.5) * 0.3, 0.0);
  float split = uRgb * g * 0.025;
  vec4 c;
  c.r = frame(duv + vec2(split, 0.0), useB).r;
  c.g = frame(duv, useB).g;
  c.b = frame(duv - vec2(split, 0.0), useB).b;
  c.a = 1.0;
  float n = rand(uv * uRes + st) - 0.5;
  c.rgb += n * uNoise * g * 0.6;
  // Scanline darkening.
  c.rgb *= 1.0 - 0.15 * g * step(0.5, fract(uv.y * uRes.y / 3.0));
  return c;
}`,
  uniforms: (P, env) => ({
    uStrength: P.strength, uSlices: P.slices, uRgb: P.rgb, uNoise: P.noise,
    uStep: Math.floor(env.raw * (env.duration || 0.5) * P.fps) + 1,
  }),
  draw2d(ctx, A, B, p0, P, env) {
    const { W, H } = env;
    const p = env.raw;
    const st = Math.floor(p * (env.duration || 0.5) * P.fps) + 1;
    const g = P.strength * (1 - Math.abs(p * 2 - 1)) ** 0.6;
    let src = p < 0.5 ? A : B;
    if (Math.abs(p - 0.5) < 0.18) src = hash(st, P.seed) < (p - 0.32) / 0.36 ? B : A;
    ctx.drawImage(src, 0, 0);
    const n = P.slices;
    for (let i = 0; i < n; i++) {
      if (hash(i, st, P.seed) < 0.55) continue;
      const y = (i / n) * H, h = H / n;
      const dx = (hash(i * 7, st, P.seed) - 0.5) * 0.25 * g * W;
      ctx.drawImage(src, 0, y, W, h, dx, y, W, h);
    }
    if (P.rgb * g > 0.05) {
      ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = 0.35 * g;
      ctx.drawImage(src, P.rgb * g * 0.025 * W, 0); ctx.restore();
    }
  },
};
