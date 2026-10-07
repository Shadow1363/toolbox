/**
 * Transition registry. To add one: create a file next to this one (copy luma-fade.js for a
 * small example), import it below and add it to TRANSITIONS. Order here = order in the gallery.
 */
import zoomThrough from './zoom-through.js';
import punchIn from './punch-in.js';
import shrinkToCard from './shrink-to-card.js';
import growFromCard from './grow-from-card.js';
import iris from './iris.js';
import split from './split.js';
import stretch from './stretch.js';
import zoomThroughText from './zoom-through-text.js';
import textMaskReveal from './text-mask-reveal.js';
import kineticWipe from './kinetic-wipe.js';
import titleCard from './title-card.js';
import whipPan from './whip-pan.js';
import spin from './spin.js';
import glitch from './glitch.js';
import lightLeak from './light-leak.js';
import lumaFade from './luma-fade.js';
import push from './push.js';

export const TRANSITIONS = [
  zoomThrough, punchIn, shrinkToCard, growFromCard, iris, split, stretch,
  zoomThroughText, textMaskReveal, kineticWipe, titleCard,
  whipPan, spin, glitch, lightLeak, lumaFade, push,
];

export const CATEGORIES = [
  ['scale', 'Scale & size'],
  ['text', 'Text'],
  ['motion', 'Motion & stylized'],
];

export const getTransition = (id) => TRANSITIONS.find((t) => t.id === id);
