/*
 * Captions effect: Auto Captions' renderer (lib/captions.js) over caption pages from lib/transcript.js.
 * One per edit (not a timed layer): the host builds env.data.pages = captionPages(lines, params) from
 * transcript lines already in output time.
 */
import { drawCaption, CAPTION_PRESETS } from '../captions.js';
import { pageAt, timeline } from '../transcript.js';
import { fontOptions, weightOptions, ensureFont } from '../fonts.js';

export const captionPages = (lines, p) => timeline(lines, p.maxWords);

export default {
  id: 'captions',
  name: 'Captions',
  description: 'Word-timed captions from the transcript, with karaoke, pop-in or highlighted-word styles.',
  kind: 'overlay',
  single: true,
  presets: Object.fromEntries(CAPTION_PRESETS.map((p) => [p.value, p.patch])),
  params: [
    { id: 'preset', type: 'select', label: 'Style', value: 'karaoke', options: CAPTION_PRESETS.map((p) => [p.value, p.label]), ai: 'sets every style param; other params override it' },
    { id: 'maxWords', type: 'range', label: 'Words per caption', min: 1, max: 16, value: 6 },
    { id: 'highlight', type: 'segmented', label: 'Highlight', value: 'wipe', options: [['none', 'None'], ['color', 'Color'], ['box', 'Box'], ['wipe', 'Wipe']] },
    { id: 'reveal', type: 'segmented', label: 'Reveal', value: 'page', options: [['page', 'Whole caption'], ['word', 'Word by word']] },
    { id: 'pop', type: 'toggle', label: 'Pop words in', value: false },
    { id: 'family', type: 'select', label: 'Font', value: 'Montserrat', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Weight', value: '900', options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 20, max: 180, value: 64, unit: 'px' },
    { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: false },
    { id: 'color', type: 'color', label: 'Text color', value: '#ffffff' },
    { id: 'hlColor', type: 'color', label: 'Highlight color', value: '#ffd23f' },
    { id: 'stroke', type: 'range', label: 'Outline', min: 0, max: 20, value: 5, unit: 'px' },
    { id: 'strokeColor', type: 'color', label: 'Outline color', value: '#000000' },
    { id: 'shadow', type: 'range', label: 'Shadow', min: 0, max: 40, value: 10, unit: 'px' },
    { id: 'bg', type: 'segmented', label: 'Background', value: 'none', options: [['none', 'None'], ['box', 'Box'], ['lines', 'Per line']] },
    { id: 'bgColor', type: 'color', label: 'Background color', value: '#000000' },
    { id: 'bgOpacity', type: 'range', label: 'Background opacity', min: 0.1, max: 1, step: 0.05, value: 0.7 },
    { id: 'posY', type: 'range', label: 'Vertical position', min: 5, max: 95, value: 82, unit: '%' },
    { id: 'width', type: 'range', label: 'Max width', min: 30, max: 98, value: 84, unit: '%' },
  ],
  ai: {
    params: ['preset', 'maxWords', 'highlight', 'reveal', 'pop', 'uppercase', 'color', 'hlColor', 'posY'],
    hint: 'Captions for the whole video; set once under "captions", not as a layer.',
  },
  prepare: (p) => ensureFont(p.family, p.weight),
  render(ctx, frame, t, p, env) {
    drawCaption(ctx, pageAt(env.data.pages || [], t), t, p);
  },
};
