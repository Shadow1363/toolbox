/* Zoom through: A rushes toward the camera with a zoom blur, B arrives from a close-up and settles. */
import { range, percent, drawFrame } from './_common.js';

export default {
  id: 'zoom-through',
  name: 'Zoom through',
  category: 'scale',
  description: 'A zooms in fast with motion blur, B zooms out from a close-up.',
  duration: 0.7,
  easing: 'easeInOutExpo',
  params: [
    range('zoom', 'Zoom amount', 1.2, 5, 2.6, 0.1, '×'),
    percent('blur', 'Motion blur', 0.7),
    range('cx', 'Center X', 0, 1, 0.5),
    range('cy', 'Center Y', 0, 1, 0.5),
  ],
  pickCenter: true,
  presets: [
    { label: 'Subtle', params: { zoom: 1.6, blur: 0.35 } },
    { label: 'Punchy', params: { zoom: 2.6, blur: 0.7 } },
    { label: 'Warp', params: { zoom: 4.5, blur: 1 }, duration: 0.9 },
  ],
  glsl: `
uniform float uZoom, uBlur;
uniform vec2 uCenter;
vec4 side(float which, vec2 uv, float q) {
  float s = mix(1.0, uZoom, q * q);
  return zoomBlur(which, zoomAt(uv, uCenter, s), uCenter, uBlur * q * 0.45);
}
vec4 transition(vec2 uv) {
  float p = uProgress;
  vec4 a = side(0.0, uv, clamp(p * 2.0, 0.0, 1.0));
  vec4 b = side(1.0, uv, clamp((1.0 - p) * 2.0, 0.0, 1.0));
  vec4 c = mix(a, b, smoothstep(0.42, 0.58, p));
  return c + vec4(vec3(0.18 * uBlur * (1.0 - abs(p - 0.5) * 2.0)), 0.0); // a small flash at the cut
}`,
  uniforms: (P) => ({ uZoom: P.zoom, uBlur: P.blur, uCenter: [P.cx, P.cy] }),
  draw2d(ctx, A, B, p, P, env) {
    const qa = Math.min(1, p * 2), qb = Math.min(1, (1 - p) * 2);
    const mixB = Math.min(1, Math.max(0, (p - 0.42) / 0.16));
    drawFrame(ctx, A, { s: 1 + (P.zoom - 1) * qa * qa, cx: P.cx, cy: P.cy, blur: P.blur * qa * 14 * env.k });
    if (mixB > 0) drawFrame(ctx, B, { s: 1 + (P.zoom - 1) * qb * qb, cx: P.cx, cy: P.cy, blur: P.blur * qb * 14 * env.k, alpha: mixB });
  },
};
