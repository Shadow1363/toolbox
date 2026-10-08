/* Glassmorphism tab: frosted card (backdrop-filter) over a choice of sample backgrounds. */
import { createControls } from '/assets/js/lib/controls.js';
import { h } from '/assets/js/lib/dom.js';
import { color, twColor, twArb, twScale, tabState } from './util.js';

const DEFAULTS = { blur: 16, alpha: 0.18, tint: '#ffffff', saturate: 180, border: 0.35, radius: 24, shadow: true, scene: 'blobs' };
const BLUR = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, '2xl': 40, '3xl': 64, none: 0 };
const RADIUS = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, '4xl': 32, none: 0 };
const SHADOW = '0 8px 32px rgba(0, 0, 0, 0.18)';

export default {
  id: 'glass',
  label: 'Glassmorphism',
  mount({ controls, preview, output }) {
    const { state: saved, save } = tabState('glass', DEFAULTS);
    const panel = createControls(controls, [
      { title: 'Glass', controls: [
        { id: 'blur', type: 'range', label: 'Blur', min: 0, max: 64, value: saved.blur, unit: 'px' },
        { id: 'alpha', type: 'range', label: 'Fill opacity', min: 0, max: 1, step: 0.01, value: saved.alpha, format: (v) => `${Math.round(v * 100)}%` },
        { id: 'tint', type: 'color', label: 'Tint', value: saved.tint },
        { id: 'saturate', type: 'range', label: 'Saturation', min: 100, max: 250, step: 5, value: saved.saturate, unit: '%' },
        { id: 'border', type: 'range', label: 'Border opacity', min: 0, max: 1, step: 0.01, value: saved.border, format: (v) => `${Math.round(v * 100)}%` },
        { id: 'radius', type: 'range', label: 'Corner radius', min: 0, max: 48, value: saved.radius, unit: 'px' },
        { id: 'shadow', type: 'toggle', label: 'Drop shadow', value: saved.shadow },
      ]},
      { title: 'Sample background', controls: [
        { id: 'scene', type: 'segmented', value: saved.scene, options: [['blobs', 'Blobs'], ['sunset', 'Sunset'], ['grid', 'Pattern'], ['night', 'Night']] },
      ]},
    ], { onChange: () => update() });
    const s = panel.state;

    const card = h('div', { class: 'cg-glass-card' },
      h('div', { class: 'cg-glass-chip' }), h('strong', {}, 'Frosted glass'), h('p', {}, 'Content behind this card is blurred and tinted.'));
    const stage = h('div', { class: 'cg-glass-stage' }, h('div', { class: 'cg-orb a' }), h('div', { class: 'cg-orb b' }), h('div', { class: 'cg-orb c' }), card);
    preview.append(stage);

    function update() {
      Object.assign(saved, s);
      save();
      const filter = `blur(${s.blur}px)${s.saturate !== 100 ? ` saturate(${s.saturate}%)` : ''}`;
      const props = [
        ['background', color(s.tint, s.alpha)],
        ['backdrop-filter', filter],
        ['-webkit-backdrop-filter', filter],
        ['border', `1px solid ${color(s.tint, s.border)}`],
        ['border-radius', `${s.radius}px`],
        s.shadow && ['box-shadow', SHADOW],
      ].filter(Boolean);
      stage.dataset.scene = s.scene;
      for (const [k, v] of props) card.style.setProperty(k, v);
      if (!s.shadow) card.style.removeProperty('box-shadow');
      card.classList.toggle('is-dark-text', s.tint !== '#000000' && s.scene !== 'night' && s.alpha > 0.45);
      output({
        css: props.map(([k, v]) => `${k}: ${v};`).join('\n'),
        tailwind: [
          `bg-${twColor(s.tint, s.alpha)}`,
          twScale('backdrop-blur', s.blur, BLUR),
          s.saturate !== 100 && `backdrop-saturate-${s.saturate}`,
          'border', `border-${twColor(s.tint, s.border)}`,
          twScale('rounded', s.radius, RADIUS),
          s.shadow && `shadow-[${twArb(SHADOW)}]`,
        ].filter(Boolean).join(' '),
        note: 'Tailwind CSS v4 classes. Tailwind adds the -webkit- prefix for Safari itself.',
      });
    }
    update();
  },
};
