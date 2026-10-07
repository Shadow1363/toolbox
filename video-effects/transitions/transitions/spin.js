/* Spin: A spins and grows with a rotational blur, B spins in from the other side and settles. */
import { range, percent, drawFrame } from './_common.js';

export default {
  id: 'spin',
  name: 'Spin',
  category: 'motion',
  description: 'Rotation with blur and scale.',
  duration: 0.7,
  easing: 'easeInOutExpo',
  params: [
    range('angle', 'Rotation', 90, 720, 360, 15, '°'),
    range('zoom', 'Zoom', 1, 3, 1.6, 0.05, '×'),
    percent('blur', 'Spin blur', 0.7),
    { id: 'clockwise', type: 'toggle', label: 'Clockwise', value: true },
  ],
  presets: [
    { label: 'Full turn', params: { angle: 360, zoom: 1.6 } },
    { label: 'Quarter snap', params: { angle: 90, zoom: 1.2, blur: 0.4 }, duration: 0.45 },
    { label: 'Vortex', params: { angle: 720, zoom: 2.6, blur: 1 }, duration: 1 },
  ],
  glsl: `
uniform float uAngle, uZoom, uBlur;
vec4 side(float which, vec2 uv, float q, float sgn) {
  float a = sgn * uAngle * 0.5 * q * q;
  float s = mix(1.0, uZoom, q * q);
  vec2 suv = zoomAt(rotateAt(uv, vec2(0.5), -a), vec2(0.5), s);
  // Blur follows angular speed, which peaks at the cut.
  return spinBlur(which, suv, vec2(0.5), uBlur * q * uAngle * 0.18);
}
vec4 transition(vec2 uv) {
  float p = uProgress;
  vec4 a = side(0.0, uv, clamp(p * 2.0, 0.0, 1.0), 1.0);
  vec4 b = side(1.0, uv, clamp((1.0 - p) * 2.0, 0.0, 1.0), -1.0);
  return mix(a, b, smoothstep(0.47, 0.53, p));
}`,
  uniforms: (P) => ({ uAngle: (P.angle * Math.PI / 180) * (P.clockwise ? 1 : -1), uZoom: P.zoom, uBlur: P.blur }),
  draw2d(ctx, A, B, p, P, env) {
    const sgn = P.clockwise ? 1 : -1;
    const ang = (P.angle * Math.PI) / 180;
    const first = p < 0.5;
    const q = first ? p * 2 : (1 - p) * 2;
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, env.W, env.H);
    drawFrame(ctx, first ? A : B, {
      s: 1 + (P.zoom - 1) * q * q, rot: (first ? 1 : -1) * sgn * ang * 0.5 * q * q, blur: P.blur * q * 10 * env.k,
    });
  },
};
