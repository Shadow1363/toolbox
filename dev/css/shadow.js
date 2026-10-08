/* Box shadow tab: stacked layers (outer or inset) on a sample box. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon } from '/assets/js/lib/dom.js';
import { color, twArb, twScale, tabState } from './util.js';

const L = (x, y, blur, spread, c, alpha, inset = false) => ({ x, y, blur, spread, color: c, alpha, inset });
const PRESETS = [
  { label: 'Soft', value: 'soft', patch: { layers: [L(0, 10, 30, -5, '#0f172a', 0.15)], bg: '#f1f5f9', boxColor: '#ffffff' } },
  { label: 'Layered', value: 'layered', patch: { layers: [L(0, 1, 2, 0, '#000000', 0.07), L(0, 2, 4, 0, '#000000', 0.07), L(0, 4, 8, 0, '#000000', 0.07), L(0, 8, 16, 0, '#000000', 0.07), L(0, 16, 32, 0, '#000000', 0.07)], bg: '#f1f5f9', boxColor: '#ffffff' } },
  { label: 'Hard', value: 'hard', patch: { layers: [L(8, 8, 0, 0, '#111111', 1)], bg: '#fde68a', boxColor: '#ffffff' } },
  { label: 'Neumorphic', value: 'neu', patch: { layers: [L(9, 9, 16, 0, '#a3b1c6', 0.6), L(-9, -9, 16, 0, '#ffffff', 0.5)], bg: '#e0e5ec', boxColor: '#e0e5ec' } },
  { label: 'Pressed', value: 'pressed', patch: { layers: [L(6, 6, 12, 0, '#a3b1c6', 0.6, true), L(-6, -6, 12, 0, '#ffffff', 0.6, true)], bg: '#e0e5ec', boxColor: '#e0e5ec' } },
  { label: 'Glow', value: 'glow', patch: { layers: [L(0, 0, 24, 4, '#7c3aed', 0.55)], bg: '#0f0f1a', boxColor: '#1e1b4b' } },
  { label: 'Outline', value: 'outline', patch: { layers: [L(0, 0, 0, 3, '#0071e3', 1), L(0, 0, 0, 6, '#0071e3', 0.25)], bg: '#ffffff', boxColor: '#ffffff' } },
];
const DEFAULTS = { ...structuredClone(PRESETS[0].patch), sel: 0, radius: 16, preset: 'soft' };
const LAYER_IDS = ['x', 'y', 'blur', 'spread', 'color', 'alpha', 'inset'];
const RADIUS = { xs: 2, sm: 4, md: 6, lg: 8, xl: 12, '2xl': 16, '3xl': 24, '4xl': 32, none: 0 };

const layerCss = (l) => `${l.inset ? 'inset ' : ''}${l.x}px ${l.y}px ${l.blur}px ${l.spread}px ${color(l.color, l.alpha)}`;
const shadowCss = (s) => s.layers.map(layerCss).join(',\n    ');

export default {
  id: 'shadow',
  label: 'Box shadow',
  mount({ controls, preview, output }) {
    const { state: saved, save } = tabState('shadow', DEFAULTS);
    const layersEl = h('div', { class: 'cg-layers' });
    const cur = saved.layers[Math.min(saved.sel, saved.layers.length - 1)];
    const panel = createControls(controls, [
      { title: 'Presets', controls: [{ id: 'preset', type: 'presets', value: saved.preset, options: PRESETS }] },
      { title: 'Layers', controls: [{ type: 'custom', el: layersEl }] },
      { title: 'Selected layer', controls: [
        { id: 'x', type: 'range', label: 'Offset X', min: -100, max: 100, value: cur.x, unit: 'px' },
        { id: 'y', type: 'range', label: 'Offset Y', min: -100, max: 100, value: cur.y, unit: 'px' },
        { id: 'blur', type: 'range', label: 'Blur', min: 0, max: 150, value: cur.blur, unit: 'px' },
        { id: 'spread', type: 'range', label: 'Spread', min: -50, max: 50, value: cur.spread, unit: 'px' },
        { id: 'color', type: 'color', label: 'Color', value: cur.color },
        { id: 'alpha', type: 'range', label: 'Opacity', min: 0, max: 1, step: 0.01, value: cur.alpha, format: (v) => `${Math.round(v * 100)}%` },
        { id: 'inset', type: 'toggle', label: 'Inset (inner shadow)', value: cur.inset },
      ]},
      { title: 'Preview', controls: [
        { id: 'radius', type: 'range', label: 'Corner radius', min: 0, max: 100, value: saved.radius, unit: 'px' },
        { id: 'boxColor', type: 'color', label: 'Box color', value: saved.boxColor },
        { id: 'bg', type: 'color', label: 'Background', value: saved.bg },
      ]},
    ], { onChange: (st, id) => {
      if (id === 'preset') { s.layers = structuredClone(st.layers); s.sel = 0; loadLayer(); }
      else if (LAYER_IDS.includes(id)) { s.layers[s.sel][id] = st[id]; s.preset = null; panel.set({ preset: null }, { silent: true }); }
      update();
    } });
    const s = panel.state;
    s.layers = structuredClone(saved.layers);
    s.sel = Math.min(saved.sel, s.layers.length - 1);

    const box = h('div', { class: 'cg-shadow-box' }, h('span', {}, 'Box'));
    const stage = h('div', { class: 'cg-stage' }, box);
    preview.append(stage);

    function loadLayer() {
      const l = s.layers[s.sel];
      panel.set(Object.fromEntries(LAYER_IDS.map((k) => [k, l[k]])), { silent: true });
    }
    function drawLayers() {
      const chips = s.layers.map((l, i) => h('button', {
        type: 'button', class: 'chip', 'aria-pressed': String(i === s.sel),
        onclick: () => { s.sel = i; loadLayer(); update(); },
      }, `${l.inset ? 'Inset ' : ''}${i + 1}`));
      const add = h('button', { type: 'button', class: 'chip', title: 'Add a layer', html: `${icon('plus')}`, onclick: () => {
        s.layers.push({ ...s.layers[s.sel], y: s.layers[s.sel].y * 2 || 8, blur: s.layers[s.sel].blur * 2 || 16 });
        s.sel = s.layers.length - 1;
        loadLayer();
        update();
      } });
      const del = h('button', { type: 'button', class: 'chip', title: 'Remove the selected layer', disabled: s.layers.length <= 1 || null, html: icon('trash'), onclick: () => {
        s.layers.splice(s.sel, 1);
        s.sel = Math.max(0, s.sel - 1);
        loadLayer();
        update();
      } });
      layersEl.replaceChildren(h('div', { class: 'chips' }, chips, add, del));
    }

    function update() {
      Object.assign(saved, { layers: s.layers, sel: s.sel, radius: s.radius, boxColor: s.boxColor, bg: s.bg, preset: s.preset });
      save();
      drawLayers();
      stage.style.background = s.bg;
      box.style.background = s.boxColor;
      box.style.borderRadius = `${s.radius}px`;
      box.style.boxShadow = s.layers.map(layerCss).join(', ');
      const needsBg = s.preset === 'neu' || s.preset === 'pressed';
      output({
        css: `box-shadow: ${shadowCss(s)};\nborder-radius: ${s.radius}px;${needsBg ? `\nbackground: ${s.boxColor}; /* same as the page behind it */` : ''}`,
        tailwind: [`shadow-[${twArb(s.layers.map(layerCss).join(', '))}]`, twScale('rounded', s.radius, RADIUS), needsBg ? `bg-[${s.boxColor}]` : null].filter(Boolean).join(' '),
        note: 'Tailwind’s named shadows (shadow-md…) use fixed values, so this is an arbitrary value.',
      });
    }
    update();
  },
};
