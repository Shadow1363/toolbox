/* Iris / shape reveal: B appears through a growing circle, rectangle or rounded rectangle.
   Click the preview to move the center (pickCenter). */
import { range, percent, rgb, drawMasked, DIRS } from './_common.js';
import { roundRectPath, scratch } from '/assets/js/lib/canvas.js';

const SHAPES = { circle: 0, rect: 1, rounded: 2 };

export default {
  id: 'iris',
  name: 'Iris reveal',
  category: 'scale',
  description: 'B is revealed through a growing circle or rectangle.',
  duration: 0.9,
  easing: 'easeInOut',
  pickCenter: true,
  params: [
    { id: 'shape', type: 'segmented', label: 'Shape', value: 'circle', options: [['circle', 'Circle'], ['rect', 'Rect'], ['rounded', 'Rounded']] },
    percent('feather', 'Edge softness', 0.08),
    percent('ring', 'Ring', 0),
    { id: 'ringColor', type: 'color', label: 'Ring color', value: '#ffffff', showIf: (s) => s.ring > 0 },
    range('cx', 'Center X', 0, 1, 0.5),
    range('cy', 'Center Y', 0, 1, 0.5),
  ],
  presets: [
    { label: 'Classic circle', params: { shape: 'circle', feather: 0.02, ring: 0 } },
    { label: 'Soft', params: { shape: 'circle', feather: 0.4 } },
    { label: 'Box', params: { shape: 'rounded', feather: 0.02, ring: 0.3 } },
  ],
  glsl: `
uniform float uShape, uFeather, uRing;
uniform vec2 uCenter;
uniform vec3 uRingColor;
vec4 transition(vec2 uv) {
  vec2 px = uv * uRes, c = uCenter * uRes;
  float k = min(uRes.x, uRes.y) / 1080.0;
  float far = max(max(length(c), length(c - vec2(uRes.x, 0.0))), max(length(c - vec2(0.0, uRes.y)), length(c - uRes)));
  float feather = uFeather * 200.0 * k + 1.0;
  float p = uProgress;
  float d;
  if (uShape < 0.5) {
    d = length(px - c) - (far + feather) * p;
  } else {
    vec2 ext = max(c, uRes - c);
    vec2 hb = (ext + feather) * p * 1.02;
    float r = uShape > 1.5 ? min(hb.x, hb.y) * 0.3 : 0.0;
    d = sdRoundBox(px - c, hb, r);
  }
  float m = 1.0 - smoothstep(-feather, feather, d);
  vec4 col = mix(getA(uv), getB(uv), m);
  float ringW = uRing * 40.0 * k;
  float ring = (1.0 - smoothstep(0.0, 2.0, abs(d - ringW * 0.5) - ringW * 0.5)) * step(0.001, uRing) * (1.0 - smoothstep(0.85, 1.0, p));
  return mix(col, vec4(uRingColor, 1.0), ring);
}`,
  uniforms: (P) => ({ uShape: SHAPES[P.shape] ?? 0, uFeather: P.feather, uRing: P.ring, uRingColor: rgb(P.ringColor), uCenter: [P.cx, P.cy] }),
  draw2d(ctx, A, B, p, P, env) {
    const { W, H } = env;
    const cx = P.cx * W, cy = P.cy * H;
    ctx.drawImage(A, 0, 0);
    const m = scratch(`tr-iris-${W}x${H}`, W, H), mc = m.getContext('2d');
    mc.clearRect(0, 0, W, H);
    mc.fillStyle = '#fff';
    mc.beginPath();
    if (P.shape === 'circle') {
      const far = Math.max(Math.hypot(cx, cy), Math.hypot(W - cx, cy), Math.hypot(cx, H - cy), Math.hypot(W - cx, H - cy));
      mc.arc(cx, cy, far * p, 0, Math.PI * 2);
    } else {
      const hw = Math.max(cx, W - cx) * p * 1.02, hh = Math.max(cy, H - cy) * p * 1.02;
      roundRectPath(mc, cx - hw, cy - hh, hw * 2, hh * 2, P.shape === 'rounded' ? Math.min(hw, hh) * 0.3 : 0);
    }
    mc.fill();
    drawMasked(ctx, B, m);
  },
};
