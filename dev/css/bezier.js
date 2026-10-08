/* Cubic-bezier tab: drag the two handles, watch it race a standard easing. */
import { createControls } from '/assets/js/lib/controls.js';
import { h } from '/assets/js/lib/dom.js';
import { tabState, dragger, svgEl, round } from './util.js';

export const EASINGS = {
  linear: [0, 0, 1, 1], ease: [0.25, 0.1, 0.25, 1], 'ease-in': [0.42, 0, 1, 1], 'ease-out': [0, 0, 0.58, 1], 'ease-in-out': [0.42, 0, 0.58, 1],
  easeInSine: [0.12, 0, 0.39, 0], easeOutSine: [0.61, 1, 0.88, 1], easeInOutSine: [0.37, 0, 0.63, 1],
  easeInQuad: [0.11, 0, 0.5, 0], easeOutQuad: [0.5, 1, 0.89, 1], easeInOutQuad: [0.45, 0, 0.55, 1],
  easeInCubic: [0.32, 0, 0.67, 0], easeOutCubic: [0.33, 1, 0.68, 1], easeInOutCubic: [0.65, 0, 0.35, 1],
  easeInQuart: [0.5, 0, 0.75, 0], easeOutQuart: [0.25, 1, 0.5, 1], easeInOutQuart: [0.76, 0, 0.24, 1],
  easeInExpo: [0.7, 0, 0.84, 0], easeOutExpo: [0.16, 1, 0.3, 1], easeInOutExpo: [0.87, 0, 0.13, 1],
  easeInCirc: [0.55, 0, 1, 0.45], easeOutCirc: [0, 0.55, 0.45, 1], easeInOutCirc: [0.85, 0, 0.15, 1],
  easeInBack: [0.36, 0, 0.66, -0.56], easeOutBack: [0.34, 1.56, 0.64, 1], easeInOutBack: [0.68, -0.6, 0.32, 1.6],
};
const TW = { linear: 'ease-linear', '0.4,0,1,1': 'ease-in', '0,0,0.2,1': 'ease-out', '0.4,0,0.2,1': 'ease-in-out' };
const DEFAULTS = { x1: 0.34, y1: 1.56, x2: 0.64, y2: 1, duration: 1000, compare: 'ease', preset: 'easeOutBack' };

// Plot geometry (SVG units): x 0..1 → 70..230, y 0..1 → 270..110, leaving room for y from -0.6 to 1.6.
const X0 = 70;
const X1 = 230;
const Y0 = 270;
const Y1 = 110;
const YMIN = -0.6;
const YMAX = 1.6;
const px = (x) => X0 + x * (X1 - X0);
const py = (y) => Y0 - y * (Y0 - Y1);
const bez = (c) => `cubic-bezier(${c.map((v) => round(v)).join(', ')})`;

export default {
  id: 'bezier',
  label: 'Cubic-bezier',
  mount({ controls, preview, output }) {
    const { state: saved, save } = tabState('bezier', DEFAULTS);
    const presetSel = h('select', { 'aria-label': 'Preset' }, h('option', { value: '' }, 'Custom'), Object.keys(EASINGS).map((k) => h('option', { value: k }, k)));
    const paste = h('input', { type: 'text', class: 'mono', placeholder: 'cubic-bezier(0.4, 0, 0.2, 1)', 'aria-label': 'Paste a cubic-bezier value' });
    const panel = createControls(controls, [
      { title: 'Curve', controls: [
        { type: 'custom', label: 'Preset', el: presetSel },
        { type: 'custom', label: 'Paste a value', el: paste },
        { id: 'x1', type: 'number', label: 'x1', min: 0, max: 1, step: 0.01, value: saved.x1 },
        { id: 'y1', type: 'number', label: 'y1', min: YMIN, max: YMAX, step: 0.01, value: saved.y1 },
        { id: 'x2', type: 'number', label: 'x2', min: 0, max: 1, step: 0.01, value: saved.x2 },
        { id: 'y2', type: 'number', label: 'y2', min: YMIN, max: YMAX, step: 0.01, value: saved.y2 },
      ]},
      { title: 'Preview', controls: [
        { id: 'duration', type: 'range', label: 'Duration', min: 200, max: 3000, step: 50, value: saved.duration, unit: 'ms' },
        { id: 'compare', type: 'select', label: 'Compare with', value: saved.compare, options: Object.keys(EASINGS).map((k) => [k, k]) },
      ]},
    ], { onChange: (st, id) => {
      if (['x1', 'x2'].includes(id)) st[id] = Math.max(0, Math.min(1, st[id]));
      if (['x1', 'y1', 'x2', 'y2'].includes(id)) s.preset = '';
      update();
    } });
    const s = panel.state;
    s.preset = saved.preset;
    presetSel.addEventListener('change', () => {
      if (!presetSel.value) return;
      const [x1, y1, x2, y2] = EASINGS[presetSel.value];
      s.preset = presetSel.value;
      panel.set({ x1, y1, x2, y2 });
    });
    paste.addEventListener('change', () => {
      const n = (paste.value.match(/-?\d*\.?\d+/g) || []).map(Number);
      if (n.length === 4 && n[0] >= 0 && n[0] <= 1 && n[2] >= 0 && n[2] <= 1) {
        s.preset = '';
        panel.set({ x1: n[0], y1: n[1], x2: n[2], y2: n[3] });
        paste.value = '';
      } else {
        paste.setCustomValidity('Expected four numbers; x1 and x2 must be between 0 and 1.');
        paste.reportValidity();
      }
    });
    paste.addEventListener('input', () => paste.setCustomValidity(''));

    /* Graph */
    const svg = svgEl('svg', { class: 'cg-bez', viewBox: '0 0 300 390', role: 'img', 'aria-label': 'Easing curve' });
    svg.append(
      svgEl('rect', { x: X0, y: Y1, width: X1 - X0, height: Y0 - Y1, class: 'cg-bez-box' }),
      svgEl('text', { x: X0, y: Y0 + 18, class: 'cg-bez-label' }), svgEl('text', { x: X1, y: Y0 + 18, class: 'cg-bez-label', 'text-anchor': 'end' }));
    svg.children[1].textContent = 'time →';
    svg.children[2].textContent = '1';
    const cmp = svgEl('path', { class: 'cg-bez-cmp' });
    const l1 = svgEl('line', { class: 'cg-bez-arm' });
    const l2 = svgEl('line', { class: 'cg-bez-arm' });
    const curve = svgEl('path', { class: 'cg-bez-curve' });
    const h1 = svgEl('circle', { r: 9, class: 'cg-bez-handle a', tabindex: 0 });
    const h2 = svgEl('circle', { r: 9, class: 'cg-bez-handle b', tabindex: 0 });
    svg.append(cmp, l1, l2, curve, h1, h2);
    const toVal = (fx, fy) => {
      const vx = (fx * 300 - X0) / (X1 - X0);
      const vy = (Y0 - fy * 390) / (Y0 - Y1);
      return [round(Math.max(0, Math.min(1, vx))), round(Math.max(YMIN, Math.min(YMAX, vy)))];
    };
    h1.addEventListener('pointerdown', dragger(svg, (fx, fy) => { const [x, y] = toVal(fx, fy); s.preset = ''; panel.set({ x1: x, y1: y }, { silent: true }); update(); }));
    h2.addEventListener('pointerdown', dragger(svg, (fx, fy) => { const [x, y] = toVal(fx, fy); s.preset = ''; panel.set({ x2: x, y2: y }, { silent: true }); update(); }));

    /* Race */
    const dot = (cls, label) => h('div', { class: 'cg-track' }, h('span', { class: 'cg-track-label' }, label), h('div', { class: 'cg-rail' }, h('div', { class: `cg-dot ${cls}` })));
    const mine = dot('a', 'Yours');
    const theirs = dot('b', '');
    const replay = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => restart() }, 'Replay');
    preview.append(h('div', { class: 'cg-bez-wrap' }, svg, h('div', { class: 'cg-race' }, mine, theirs, replay)));

    let restartTimer = 0;
    function restart() {
      for (const el of preview.querySelectorAll('.cg-dot')) { el.style.animation = 'none'; void el.offsetWidth; el.style.animation = ''; }
    }

    function update() {
      const c = [s.x1, s.y1, s.x2, s.y2];
      Object.assign(saved, s);
      save();
      presetSel.value = s.preset && EASINGS[s.preset] ? s.preset : '';
      curve.setAttribute('d', `M${px(0)},${py(0)} C${px(c[0])},${py(c[1])} ${px(c[2])},${py(c[3])} ${px(1)},${py(1)}`);
      const k = EASINGS[s.compare];
      cmp.setAttribute('d', `M${px(0)},${py(0)} C${px(k[0])},${py(k[1])} ${px(k[2])},${py(k[3])} ${px(1)},${py(1)}`);
      for (const [l, x0, y0, x, y] of [[l1, 0, 0, c[0], c[1]], [l2, 1, 1, c[2], c[3]]]) {
        l.setAttribute('x1', px(x0)); l.setAttribute('y1', py(y0)); l.setAttribute('x2', px(x)); l.setAttribute('y2', py(y));
      }
      h1.setAttribute('cx', px(c[0])); h1.setAttribute('cy', py(c[1]));
      h2.setAttribute('cx', px(c[2])); h2.setAttribute('cy', py(c[3]));
      preview.style.setProperty('--dur', `${s.duration}ms`);
      preview.style.setProperty('--ease-a', bez(c));
      preview.style.setProperty('--ease-b', bez(k));
      theirs.firstChild.textContent = s.compare;
      clearTimeout(restartTimer);
      restartTimer = setTimeout(restart, 250);
      const key = c.map((v) => round(v)).join(',');
      const named = key === '0,0,1,1' ? TW.linear : TW[key];
      output({
        css: `transition-timing-function: ${bez(c)};\n/* or */\nanimation-timing-function: ${bez(c)};\n/* shorthand */\ntransition: all ${s.duration}ms ${bez(c)};`,
        tailwind: `${named || `ease-[${bez(c).replace(/\s+/g, '')}]`} duration-${s.duration}`,
        note: named ? 'Matches a built-in Tailwind easing.' : 'Arbitrary value: Tailwind’s built-in easings are linear, in, out and in-out.',
      });
    }
    update();
    return () => clearTimeout(restartTimer);
  },
};
