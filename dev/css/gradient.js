/* Gradient tab: linear / radial / conic with draggable color stops. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon } from '/assets/js/lib/dom.js';
import { color, hexToRgb, twColor, twArb, tabState, dragger, round } from './util.js';

const stop = (c, pos, alpha = 1) => ({ color: c, alpha, pos });
const PRESETS = [
  { label: 'Sky', type: 'linear', angle: 135, stops: [stop('#a1c4fd', 0), stop('#c2e9fb', 100)] },
  { label: 'Sunset', type: 'linear', angle: 90, stops: [stop('#ff7e5f', 0), stop('#feb47b', 100)] },
  { label: 'Ocean', type: 'linear', angle: 160, stops: [stop('#0f2027', 0), stop('#203a43', 50), stop('#2c5364', 100)] },
  { label: 'Candy', type: 'linear', angle: 45, stops: [stop('#f093fb', 0), stop('#f5576c', 100)] },
  { label: 'Lime', type: 'linear', angle: 120, stops: [stop('#d4fc79', 0), stop('#96e6a1', 100)] },
  { label: 'Violet', type: 'linear', angle: 135, stops: [stop('#667eea', 0), stop('#764ba2', 100)] },
  { label: 'Spotlight', type: 'radial', shape: 'circle', x: 30, y: 30, stops: [stop('#fdfbfb', 0), stop('#a18cd1', 60), stop('#3b2667', 100)] },
  { label: 'Spectrum', type: 'conic', from: 0, x: 50, y: 50, stops: [stop('#ff0000', 0), stop('#ffff00', 17), stop('#00ff00', 33), stop('#00ffff', 50), stop('#0000ff', 67), stop('#ff00ff', 83), stop('#ff0000', 100)] },
  { label: 'Fade out', type: 'linear', angle: 180, stops: [stop('#000000', 0, 0), stop('#000000', 100, 0.8)] },
];
const DEFAULTS = { type: 'linear', angle: 135, shape: 'ellipse', x: 50, y: 50, from: 0, repeating: false, stops: PRESETS[5].stops, sel: 0 };
const DIRS = { 0: 't', 45: 'tr', 90: 'r', 135: 'br', 180: 'b', 225: 'bl', 270: 'l', 315: 'tl' };

const sorted = (stops) => [...stops].sort((a, b) => a.pos - b.pos);
const stopList = (stops) => sorted(stops).map((s) => `${color(s.color, s.alpha)} ${s.pos}%`).join(', ');

export function gradientCss(s) {
  const pre = s.repeating ? 'repeating-' : '';
  const at = `at ${s.x}% ${s.y}%`;
  if (s.type === 'radial') return `${pre}radial-gradient(${s.shape} ${at}, ${stopList(s.stops)})`;
  if (s.type === 'conic') return `${pre}conic-gradient(from ${s.from}deg ${at}, ${stopList(s.stops)})`;
  return `${pre}linear-gradient(${s.angle}deg, ${stopList(s.stops)})`;
}

function tailwind(s) {
  const st = sorted(s.stops);
  const arb = () => ({ tailwind: `bg-[${twArb(gradientCss(s))}]`, note: 'Arbitrary value: Tailwind’s gradient utilities take at most three stops and no repeating gradients.' });
  if (s.repeating || st.length > 3 || st.length < 2) return arb();
  const [first, ...rest] = st;
  const last = rest.pop();
  const mid = rest[0];
  const cls = [];
  if (s.type === 'linear') cls.push(DIRS[s.angle] ? `bg-linear-to-${DIRS[s.angle]}` : `bg-linear-${s.angle}`);
  else if (s.type === 'radial') cls.push(s.shape === 'ellipse' && s.x === 50 && s.y === 50 ? 'bg-radial' : `bg-radial-[${s.shape === 'circle' ? 'circle_' : ''}at_${s.x}%_${s.y}%]`);
  else {
    if (s.x !== 50 || s.y !== 50) return arb();
    cls.push(`bg-conic-${s.from}`);
  }
  cls.push(`from-${twColor(first.color, first.alpha)}`);
  if (first.pos !== 0) cls.push(`from-${first.pos}%`);
  if (mid) { cls.push(`via-${twColor(mid.color, mid.alpha)}`); if (mid.pos !== 50) cls.push(`via-${mid.pos}%`); }
  cls.push(`to-${twColor(last.color, last.alpha)}`);
  if (last.pos !== 100) cls.push(`to-${last.pos}%`);
  return { tailwind: cls.join(' '), note: 'Tailwind CSS v4 classes.' };
}

/** Color at `pos` between the surrounding stops, for new stops added on the bar. */
function colorAt(stops, pos) {
  const st = sorted(stops);
  const b = st.find((s) => s.pos >= pos) || st[st.length - 1];
  const a = [...st].reverse().find((s) => s.pos <= pos) || st[0];
  const t = b.pos === a.pos ? 0 : (pos - a.pos) / (b.pos - a.pos);
  const [ca, cb] = [hexToRgb(a.color), hexToRgb(b.color)];
  const hex = `#${ca.map((v, i) => Math.round(v + (cb[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
  return { color: hex, alpha: round(a.alpha + (b.alpha - a.alpha) * t) };
}

export default {
  id: 'gradient',
  label: 'Gradient',
  mount({ controls, preview, output }) {
    const { state: saved, save } = tabState('gradient', DEFAULTS);
    const stopsEl = h('div', { class: 'cg-stops' });
    const panel = createControls(controls, [
      { title: 'Presets', controls: [
        { type: 'swatches', options: PRESETS.map((p, i) => ({ label: p.label, value: i, preview: gradientCss({ ...DEFAULTS, ...p }), patch: { ...DEFAULTS, ...structuredClone(p), sel: 0 } })) },
      ]},
      { title: 'Gradient', controls: [
        { id: 'type', type: 'segmented', label: 'Type', value: saved.type, options: [['linear', 'Linear'], ['radial', 'Radial'], ['conic', 'Conic']] },
        { id: 'angle', type: 'range', label: 'Angle', min: 0, max: 359, value: saved.angle, unit: '°', showIf: (st) => st.type === 'linear' },
        { id: 'shape', type: 'segmented', label: 'Shape', value: saved.shape, options: [['ellipse', 'Ellipse'], ['circle', 'Circle']], showIf: (st) => st.type === 'radial' },
        { id: 'from', type: 'range', label: 'Start angle', min: 0, max: 359, value: saved.from, unit: '°', showIf: (st) => st.type === 'conic' },
        { id: 'x', type: 'range', label: 'Center X', min: 0, max: 100, value: saved.x, unit: '%', showIf: (st) => st.type !== 'linear' },
        { id: 'y', type: 'range', label: 'Center Y', min: 0, max: 100, value: saved.y, unit: '%', showIf: (st) => st.type !== 'linear' },
        { id: 'repeating', type: 'toggle', label: 'Repeating', value: saved.repeating },
      ]},
      { title: 'Color stops', controls: [{ type: 'custom', el: stopsEl }] },
    ], { onChange: () => { s.stops = structuredClone(s.stops); s.sel = Math.min(s.sel, s.stops.length - 1); update(true); } });
    const s = panel.state;
    s.stops = saved.stops;
    s.sel = Math.min(saved.sel, s.stops.length - 1);

    const box = h('div', { class: 'cg-gradient-box checker' }, h('div', { class: 'cg-fill' }));
    preview.append(box);

    function update(redrawStops) {
      Object.assign(saved, s);
      save();
      const css = gradientCss(s);
      box.firstChild.style.background = css;
      if (redrawStops) drawStops();
      else paintBar();
      const fallback = sorted(s.stops)[0];
      output({ css: `background: ${color(fallback.color, fallback.alpha)};\nbackground: ${css};`, ...tailwind(s) });
    }

    /* Stops editor: a bar with draggable handles, plus fields for the selected stop. */
    const bar = h('div', { class: 'cg-bar checker', title: 'Click to add a stop' }, h('div', { class: 'cg-bar-fill' }));
    const handles = h('div', { class: 'cg-handles' });
    bar.append(handles);
    bar.addEventListener('pointerdown', (e) => {
      if (e.target !== bar && e.target !== bar.firstChild) return;
      const r = bar.getBoundingClientRect();
      const pos = Math.max(0, Math.min(100, Math.round(((e.clientX - r.left) / r.width) * 100)));
      s.stops.push({ ...colorAt(s.stops, pos), pos });
      s.sel = s.stops.length - 1;
      update(true);
    });
    function paintBar() {
      bar.firstChild.style.background = `linear-gradient(90deg, ${stopList(s.stops)})`;
      [...handles.children].forEach((el, i) => { el.style.left = `${s.stops[i].pos}%`; el.style.background = color(s.stops[i].color, s.stops[i].alpha); });
    }
    function drawStops() {
      handles.replaceChildren(...s.stops.map((st, i) => {
        const el = h('button', { type: 'button', class: `cg-handle${i === s.sel ? ' is-sel' : ''}`, 'aria-label': `Stop ${i + 1} at ${st.pos}%` });
        el.addEventListener('pointerdown', (e) => {
          e.stopPropagation();
          if (s.sel !== i) { s.sel = i; update(true); return; }
          dragger(bar, (fx) => { st.pos = Math.max(0, Math.min(100, Math.round(fx * 100))); posInput.value = st.pos; update(false); })(e);
        });
        return el;
      }));
      const st = s.stops[s.sel];
      picker.value = st.color;
      hexInput.value = st.color;
      alpha.value = Math.round(st.alpha * 100);
      alphaVal.textContent = `${alpha.value}%`;
      posInput.value = st.pos;
      remove.disabled = s.stops.length <= 2;
      paintBar();
    }
    const sel = () => s.stops[s.sel];
    const picker = h('input', { type: 'color', 'aria-label': 'Stop color' });
    const hexInput = h('input', { type: 'text', maxlength: 7, spellcheck: 'false', 'aria-label': 'Stop color hex', class: 'mono' });
    const alpha = h('input', { type: 'range', min: 0, max: 100, 'aria-label': 'Stop opacity' });
    const alphaVal = h('span', { class: 'ctrl-value' });
    const posInput = h('input', { type: 'number', min: 0, max: 100, 'aria-label': 'Stop position (%)' });
    const remove = h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('trash')} Remove` });
    picker.addEventListener('input', () => { sel().color = picker.value; hexInput.value = picker.value; update(false); });
    hexInput.addEventListener('change', () => {
      const v = hexInput.value.trim().replace(/^([^#])/, '#$1');
      if (/^#[\da-f]{6}$/i.test(v)) { sel().color = v.toLowerCase(); picker.value = v; update(false); } else hexInput.value = sel().color;
    });
    alpha.addEventListener('input', () => { sel().alpha = alpha.value / 100; alphaVal.textContent = `${alpha.value}%`; alpha.style.setProperty('--pct', `${alpha.value}%`); update(false); });
    posInput.addEventListener('input', () => { if (posInput.value !== '') { sel().pos = Math.max(0, Math.min(100, +posInput.value)); update(false); } });
    remove.addEventListener('click', () => { s.stops.splice(s.sel, 1); s.sel = 0; update(true); });
    const reverse = h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('swap')} Reverse`, onclick: () => { s.stops.forEach((st) => { st.pos = 100 - st.pos; }); update(true); } });
    const even = h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { sorted(s.stops).forEach((st, i, all) => { st.pos = Math.round((i / (all.length - 1)) * 100); }); update(true); } }, 'Space evenly');
    stopsEl.append(bar,
      h('div', { class: 'cg-stop-edit' },
        h('div', { class: 'color-input' }, picker, hexInput),
        h('label', { class: 'cg-mini' }, h('span', {}, 'Position %'), posInput)),
      h('label', { class: 'cg-mini cg-alpha' }, h('span', {}, 'Opacity'), alpha, alphaVal),
      h('div', { class: 'btn-row' }, remove, reverse, even),
      h('div', { class: 'ctrl-hint' }, 'Click the bar to add a stop; drag a selected stop to move it.'));
    update(true);
  },
};
