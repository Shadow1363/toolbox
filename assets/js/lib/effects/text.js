/*
 * Text effect: an animated title (lib/text-anim.js, as in Text Effects) shown for a layer's time range.
 * Used for hooks and emphasis words. Time is local to the layer; the fade-out ends at the layer's end.
 */
import { drawAnimatedText, textOptions, ANIMATIONS, DEFAULT_EASING } from '../text-anim.js';
import { easingOptions } from '../easing.js';
import { fontOptions, weightOptions, ensureFont } from '../fonts.js';

export default {
  id: 'text',
  name: 'Text',
  description: 'An animated title or emphasis word on screen for a time range (hooks, key points, numbers).',
  kind: 'overlay',
  params: [
    { id: 'text', type: 'textarea', label: 'Text', value: 'Your hook here', rows: 2 },
    { id: 'anim', type: 'select', label: 'Animation', value: 'pop', options: ANIMATIONS },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeOutBack', options: easingOptions },
    { id: 'duration', type: 'range', label: 'Entrance', min: 0.1, max: 3, step: 0.1, value: 0.5, unit: 's' },
    { id: 'outDuration', type: 'range', label: 'Fade out', min: 0, max: 2, step: 0.1, value: 0.3, unit: 's' },
    { id: 'family', type: 'select', label: 'Font', value: 'Montserrat', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Weight', value: '900', options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 16, max: 400, value: 110, unit: 'px' },
    { id: 'color', type: 'color', label: 'Color', value: '#ffffff' },
    { id: 'glowColor', type: 'color', label: 'Glow color', value: '#ff2fd1' },
    { id: 'align', type: 'segmented', label: 'Align', value: 'center', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
    { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: true },
    { id: 'letterSpacing', type: 'range', label: 'Letter spacing', min: -10, max: 40, value: 0, unit: 'px' },
    { id: 'lineHeight', type: 'range', label: 'Line height', min: 0.8, max: 2, step: 0.05, value: 1.05 },
    { id: 'strokeWidth', type: 'range', label: 'Outline', min: 0, max: 20, value: 8, unit: 'px' },
    { id: 'strokeColor', type: 'color', label: 'Outline color', value: '#000000' },
    { id: 'shadow', type: 'toggle', label: 'Drop shadow', value: true },
    { id: 'shadowBlur', type: 'range', label: 'Shadow blur', min: 0, max: 80, value: 24, unit: 'px' },
    { id: 'shadowY', type: 'range', label: 'Shadow offset', min: 0, max: 40, value: 6, unit: 'px' },
    { id: 'shadowColor', type: 'color', label: 'Shadow color', value: '#000000' },
    { id: 'posX', type: 'range', label: 'Horizontal', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'posY', type: 'range', label: 'Vertical', min: 0, max: 100, value: 20, unit: '%' },
  ],
  ai: {
    params: ['text', 'anim', 'size', 'color', 'uppercase', 'posY'],
    hint: 'Keep it short (2–7 words). Place it away from the face and the captions; posY is % from the top.',
  },
  /** Picking an animation also picks its easing (as in Text Effects). */
  normalize(p, given = {}) {
    if (given.anim && !given.easing) p.easing = DEFAULT_EASING[p.anim] || p.easing;
    return p;
  },
  prepare: (p) => ensureFont(p.family, p.weight),
  render(ctx, frame, t, p, env) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const len = env.item ? env.item.end - env.item.start : env.duration;
    drawAnimatedText(ctx, textOptions({ ...p, delay: 0 }, W, H, len), env.local ?? t);
  },
};
