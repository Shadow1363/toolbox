/*
 * Progress effect: Progress Overlay's bar/timer (lib/progress-bar.js) across the whole output.
 * One per edit. Runs from 0 to env.duration; env.data.chapters = [{ t, label }] (optional).
 */
import { drawProgressOverlay } from '../progress-bar.js';
import { ensureFont } from '../fonts.js';

/** Progress Overlay's panel defaults (the keys drawProgressOverlay reads). */
const BASE = {
  mode: 'bar', style: 'line', place: 'bottom', corner: 'tr', circleSize: 150, thickness: 8, margin: 0,
  segments: 4, gap: 10, color: '#ff3d71', track: '#ffffff', trackOpacity: 0.18, reverse: false, glow: 0,
  timerType: 'down', format: 'm:ss', timerLabel: '', timerPos: 'tr', family: 'Space Mono', weight: '700',
  timerSize: 64, timerColor: '#ffffff', pill: true, pillColor: '#000000', pillOpacity: 0.55,
  labels: 'current', labelSize: 30, opacity: 1,
};

export default {
  id: 'progress',
  name: 'Progress bar',
  description: 'A bar that fills as the video plays, so viewers see how much is left.',
  kind: 'overlay',
  single: true,
  params: [
    { id: 'style', type: 'segmented', label: 'Style', value: 'rounded', options: [['line', 'Line'], ['rounded', 'Rounded'], ['segments', 'Segments']] },
    { id: 'place', type: 'segmented', label: 'Place', value: 'top', options: [['top', 'Top'], ['bottom', 'Bottom'], ['edges', 'Edges']] },
    { id: 'thickness', type: 'range', label: 'Thickness', min: 2, max: 40, value: 10, unit: 'px' },
    { id: 'margin', type: 'range', label: 'Margin', min: 0, max: 200, value: 24, unit: 'px' },
    { id: 'color', type: 'color', label: 'Fill', value: '#ffd23f' },
    { id: 'track', type: 'color', label: 'Track', value: '#ffffff' },
    { id: 'trackOpacity', type: 'range', label: 'Track opacity', min: 0, max: 1, step: 0.01, value: 0.25 },
    { id: 'segments', type: 'range', label: 'Segments', min: 2, max: 20, value: 4 },
    { id: 'glow', type: 'range', label: 'Glow', min: 0, max: 40, value: 0, unit: 'px' },
  ],
  ai: { params: ['style', 'place', 'color'], hint: 'Optional; set once under "progress".' },
  prepare: () => ensureFont('Inter', 700),
  render(ctx, frame, t, p, env) {
    drawProgressOverlay(ctx, t, { ...BASE, ...p, start: 0, end: env.duration }, env.data.chapters || []);
  },
};
