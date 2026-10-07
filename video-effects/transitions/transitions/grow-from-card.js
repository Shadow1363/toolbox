/* Grow from card: the reverse of Shrink to card. B slides in as a card and grows to full screen. */
import { CARD_GLSL, cardParams, cardUniforms, cardDraw2d } from './shrink-to-card.js';

export default {
  id: 'grow-from-card',
  name: 'Grow from card',
  category: 'scale',
  description: 'B slides in as a small card and grows to full screen.',
  duration: 1.1,
  easing: 'easeInOut',
  params: cardParams('right'),
  presets: [
    { label: 'From right', params: { direction: 'right', scale: 0.62 } },
    { label: 'Rise up', params: { direction: 'down', scale: 0.7 } },
    { label: 'Pop', params: { scale: 0.4, radius: 80, shadow: 0.9 }, easing: 'easeInOutBack' },
  ],
  glsl: CARD_GLSL,
  uniforms: cardUniforms(true),
  draw2d: cardDraw2d(true),
};
