/*
 * Zoom effect: Zoom on Click's camera (lib/zoom-camera.js) driven by timed layers instead of clicks.
 * A camera effect: the host calls track(items, env) once per edit to build keyframes, then render() draws
 * the frame through the camera at t. Each layer zooms in by its start, holds, and zooms out by its end.
 * Target 'face' centres on env.data.faceAt(t) ({ x, y } 0..1 of the frame, or null).
 * env.crop ({ x, y, w, h } source pixels) limits the camera to part of the frame (the Auto Editor's reframe).
 */
import { buildKeyframes, cameraAt, drawZoomed } from '../zoom-camera.js';
import { easingOptions } from '../easing.js';

export default {
  id: 'zoom',
  name: 'Zoom',
  description: 'Smooth punch-in on the speaker (or a point) for emphasis, then back out.',
  kind: 'camera',
  params: [
    { id: 'zoom', type: 'range', label: 'Zoom', min: 1.05, max: 3, step: 0.05, value: 1.3, unit: '×' },
    { id: 'dur', type: 'range', label: 'Move time', min: 0.1, max: 2, step: 0.05, value: 0.45, unit: 's' },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeInOut', options: easingOptions.filter(([v]) => !/Elastic|Bounce/.test(v)) },
    { id: 'target', type: 'segmented', label: 'Centre on', value: 'face', options: [['face', 'Face'], ['center', 'Centre'], ['point', 'Point']] },
    { id: 'x', type: 'range', label: 'Point X', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'y', type: 'range', label: 'Point Y', min: 0, max: 100, value: 40, unit: '%' },
    { id: 'motionBlur', type: 'toggle', label: 'Motion blur', value: true },
  ],
  ai: {
    params: ['zoom', 'dur', 'target'],
    hint: 'Emphasis on a key word or punchline. 1.15–1.4 for talking heads; keep zooms at least 3 s apart.',
  },
  /** Keyframes for all zoom layers ([{ start, end, params }] in output seconds). */
  track(items, env) {
    const points = items.map((it, i) => {
      const p = it.params;
      const len = Math.max(0.1, it.end - it.start);
      const dur = Math.min(p.dur, len / 2);
      const at = it.start + dur / 2;
      let x = 0.5, y = 0.5;
      if (p.target === 'point') { x = p.x / 100; y = p.y / 100; }
      else if (p.target === 'face') {
        const f = env.data.faceAt?.(it.start + len / 2);
        if (f) { x = f.x; y = f.y; }
      }
      return { id: i, t: at, x, y, zoom: p.zoom, dur, hold: Math.max(0, len - 1.5 * dur), easing: p.easing };
    });
    return buildKeyframes(points, { follow: 0 }).keys;
  },
  render(ctx, frame, t, p, env) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const keys = env.track || [];
    drawZoomed(ctx, frame, keys, [], cameraAt(keys, t), t, W, H, Math.min(W, H) / 1080, { motionBlur: p.motionBlur, crop: env.crop });
  },
};
