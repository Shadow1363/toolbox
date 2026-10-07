/* Light leak / film burn: a generated warm light that swells over the cut while A dissolves into B. */
import { range, percent, seed, smooth } from './_common.js';
import { rng } from '/assets/js/lib/random.js';

const PALETTES = {
  warm: [[1.0, 0.45, 0.12], [1.0, 0.78, 0.35], [0.95, 0.2, 0.15]],
  golden: [[1.0, 0.7, 0.25], [1.0, 0.9, 0.55], [0.9, 0.5, 0.1]],
  rose: [[1.0, 0.35, 0.45], [1.0, 0.65, 0.55], [0.75, 0.2, 0.5]],
  cool: [[0.3, 0.6, 1.0], [0.6, 0.9, 1.0], [0.55, 0.35, 1.0]],
};

export default {
  id: 'light-leak',
  name: 'Light leak',
  category: 'motion',
  description: 'Warm generated light that peaks on the cut.',
  duration: 1.2,
  easing: 'easeInOut',
  params: [
    { id: 'style', type: 'segmented', label: 'Style', value: 'leak', options: [['leak', 'Light leak'], ['burn', 'Film burn']] },
    { id: 'palette', type: 'segmented', label: 'Color', value: 'warm', options: [['warm', 'Warm'], ['golden', 'Golden'], ['rose', 'Rose'], ['cool', 'Cool']] },
    range('intensity', 'Intensity', 0.2, 2, 1.1, 0.05, '×'),
    percent('flash', 'Overexposure', 0.4),
    seed(),
  ],
  presets: [
    { label: 'Sunset leak', params: { style: 'leak', palette: 'warm', intensity: 1.1 } },
    { label: 'Golden hour', params: { style: 'leak', palette: 'golden', intensity: 1.4, flash: 0.6 } },
    { label: 'Film burn', params: { style: 'burn', palette: 'warm', intensity: 1.3 }, duration: 1.4 },
  ],
  glsl: `
uniform float uIntensity, uFlash, uBurn;
uniform vec3 uC1, uC2, uC3;
uniform vec4 uBlob1, uBlob2;
vec3 screen(vec3 a, vec3 b) { return 1.0 - (1.0 - a) * (1.0 - b); }
vec4 transition(vec2 uv) {
  float p = uProgress;
  float env = pow(sin(PI * clamp(p, 0.0, 1.0)), 1.4);
  vec4 base = mix(getA(uv), getB(uv), smoothstep(0.38, 0.62, p));
  vec2 asp = vec2(aspectRatio(), 1.0);
  float t = uRaw * 1.6;
  vec3 light;
  if (uBurn < 0.5) {
    vec2 b1 = uBlob1.xy + vec2(t * 0.25, -t * 0.1);
    vec2 b2 = uBlob2.xy + vec2(-t * 0.2, t * 0.15);
    float g1 = exp(-pow(length((uv - b1) * asp) / uBlob1.z, 2.0));
    float g2 = exp(-pow(length((uv - b2) * asp) / uBlob2.z, 2.0));
    float streak = exp(-pow((uv.x + uv.y * 0.35 - 0.2 - t * 0.5) / 0.18, 2.0));
    float n = fbm(uv * 2.2 + vec2(t, -t * 0.5) + uSeed);
    light = uC1 * g1 * 1.2 + uC2 * g2 + uC3 * streak * 0.6;
    light *= 0.6 + 0.8 * n;
  } else {
    float n = fbm(uv * vec2(2.5, 1.6) + uSeed * 1.3 + vec2(t * 0.3, 0.0));
    float edge = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float field = n + (0.5 - edge) * 0.9;
    float front = 1.25 - env * 0.9;
    float hot = smoothstep(front, front + 0.25, field);
    float core = smoothstep(front + 0.18, front + 0.45, field);
    light = mix(uC3 * 0.9, uC2, hot) * hot * 1.6 + vec3(core);
  }
  vec3 col = base.rgb * (1.0 + env * uFlash * 0.6);
  col = screen(col, clamp(light * env * uIntensity, 0.0, 1.0));
  return vec4(col, 1.0);
}`,
  uniforms(P) {
    const r = rng(P.seed * 7919);
    const [c1, c2, c3] = PALETTES[P.palette] || PALETTES.warm;
    return {
      uIntensity: P.intensity, uFlash: P.flash, uBurn: P.style === 'burn' ? 1 : 0, uC1: c1, uC2: c2, uC3: c3,
      uBlob1: [r() * 0.4 - 0.1, r() * 0.6 + 0.2, 0.55 + r() * 0.3, 0],
      uBlob2: [r() * 0.4 + 0.7, r() * 0.6, 0.45 + r() * 0.3, 0],
    };
  },
  draw2d(ctx, A, B, p, P, env) {
    const { W, H } = env;
    const e = Math.sin(Math.PI * p) ** 1.4;
    ctx.drawImage(A, 0, 0);
    ctx.globalAlpha = smooth(0.38, 0.62, p); ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1;
    const [c1, c2] = PALETTES[P.palette] || PALETTES.warm;
    const css = (c) => `rgb(${c.map((v) => Math.round(v * 255)).join(',')})`;
    const g = ctx.createRadialGradient(W * (0.1 + 0.4 * p), H * 0.4, 0, W * (0.1 + 0.4 * p), H * 0.4, Math.max(W, H) * 0.7);
    g.addColorStop(0, css(c2)); g.addColorStop(0.4, css(c1)); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.save(); ctx.globalCompositeOperation = 'screen'; ctx.globalAlpha = Math.min(1, e * P.intensity);
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H); ctx.restore();
  },
};
