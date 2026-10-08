/* Clip-path tab: polygon presets with draggable points, plus circle, ellipse and inset. */
import { createControls } from '/assets/js/lib/controls.js';
import { h } from '/assets/js/lib/dom.js';
import { twArb, tabState, dragger, svgEl, round } from './util.js';

const regular = (n, rot = -90) => Array.from({ length: n }, (_, i) => {
  const a = ((rot + (360 / n) * i) * Math.PI) / 180;
  return [round(50 + 50 * Math.cos(a), 1), round(50 + 50 * Math.sin(a), 1)];
});
const star = (n = 5, inner = 0.4) => Array.from({ length: n * 2 }, (_, i) => {
  const a = ((-90 + (180 / n) * i) * Math.PI) / 180;
  const r = i % 2 ? 50 * inner : 50;
  return [round(50 + r * Math.cos(a), 1), round(50 + r * Math.sin(a), 1)];
});
const POLYS = {
  triangle: ['Triangle', [[50, 0], [100, 100], [0, 100]]],
  trapezoid: ['Trapezoid', [[20, 0], [80, 0], [100, 100], [0, 100]]],
  parallelogram: ['Parallelogram', [[25, 0], [100, 0], [75, 100], [0, 100]]],
  rhombus: ['Rhombus', [[50, 0], [100, 50], [50, 100], [0, 50]]],
  pentagon: ['Pentagon', regular(5)],
  hexagon: ['Hexagon', [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]]],
  octagon: ['Octagon', [[30, 0], [70, 0], [100, 30], [100, 70], [70, 100], [30, 100], [0, 70], [0, 30]]],
  bevel: ['Bevel', [[20, 0], [80, 0], [100, 20], [100, 80], [80, 100], [20, 100], [0, 80], [0, 20]]],
  star: ['Star', star(5, 0.4)],
  cross: ['Cross', [[35, 0], [65, 0], [65, 35], [100, 35], [100, 65], [65, 65], [65, 100], [35, 100], [35, 65], [0, 65], [0, 35], [35, 35]]],
  arrow: ['Arrow', [[0, 30], [60, 30], [60, 10], [100, 50], [60, 90], [60, 70], [0, 70]]],
  chevron: ['Chevron', [[0, 0], [75, 0], [100, 50], [75, 100], [0, 100], [25, 50]]],
  message: ['Message', [[0, 0], [100, 0], [100, 75], [75, 75], [75, 100], [50, 75], [0, 75]]],
};
const OTHER = { circle: 'Circle', ellipse: 'Ellipse', inset: 'Inset' };
const DEFAULTS = {
  preset: 'hexagon', kind: 'polygon', points: POLYS.hexagon[1], snap: true,
  cr: 50, cx: 50, cy: 50, erx: 50, ery: 35, ex: 50, ey: 50, it: 10, ir: 10, ib: 10, il: 10, iround: 0,
};

const pct = (v) => `${round(v, 1)}%`;
function clipCss(s) {
  if (s.kind === 'circle') return `circle(${s.cr}% at ${s.cx}% ${s.cy}%)`;
  if (s.kind === 'ellipse') return `ellipse(${s.erx}% ${s.ery}% at ${s.ex}% ${s.ey}%)`;
  if (s.kind === 'inset') return `inset(${s.it}% ${s.ir}% ${s.ib}% ${s.il}%${s.iround ? ` round ${s.iround}px` : ''})`;
  return `polygon(${s.points.map(([x, y]) => `${pct(x)} ${pct(y)}`).join(', ')})`;
}

export default {
  id: 'clip-path',
  label: 'Clip-path',
  mount({ controls, preview, output }) {
    const { state: saved, save } = tabState('clip-path', DEFAULTS);
    const shapes = h('div', { class: 'cg-shapes' });
    const panel = createControls(controls, [
      { title: 'Shape', controls: [{ type: 'custom', el: shapes }] },
      { title: 'Polygon', showIf: (st) => st.kind === 'polygon', controls: [
        { id: 'snap', type: 'toggle', label: 'Snap to 5%', value: saved.snap },
        { type: 'custom', el: h('div', { class: 'ctrl-hint' }, 'Drag the points. Click an edge to add a point; double-click a point to remove it.') },
      ]},
      { title: 'Circle', showIf: (st) => st.kind === 'circle', controls: [
        { id: 'cr', type: 'range', label: 'Radius', min: 1, max: 75, value: saved.cr, unit: '%' },
        { id: 'cx', type: 'range', label: 'Center X', min: 0, max: 100, value: saved.cx, unit: '%' },
        { id: 'cy', type: 'range', label: 'Center Y', min: 0, max: 100, value: saved.cy, unit: '%' },
      ]},
      { title: 'Ellipse', showIf: (st) => st.kind === 'ellipse', controls: [
        { id: 'erx', type: 'range', label: 'Radius X', min: 1, max: 100, value: saved.erx, unit: '%' },
        { id: 'ery', type: 'range', label: 'Radius Y', min: 1, max: 100, value: saved.ery, unit: '%' },
        { id: 'ex', type: 'range', label: 'Center X', min: 0, max: 100, value: saved.ex, unit: '%' },
        { id: 'ey', type: 'range', label: 'Center Y', min: 0, max: 100, value: saved.ey, unit: '%' },
      ]},
      { title: 'Inset', showIf: (st) => st.kind === 'inset', controls: [
        { id: 'it', type: 'range', label: 'Top', min: 0, max: 50, value: saved.it, unit: '%' },
        { id: 'ir', type: 'range', label: 'Right', min: 0, max: 50, value: saved.ir, unit: '%' },
        { id: 'ib', type: 'range', label: 'Bottom', min: 0, max: 50, value: saved.ib, unit: '%' },
        { id: 'il', type: 'range', label: 'Left', min: 0, max: 50, value: saved.il, unit: '%' },
        { id: 'iround', type: 'range', label: 'Corner radius', min: 0, max: 100, value: saved.iround, unit: 'px' },
      ]},
    ], { onChange: () => update() });
    const s = panel.state;
    s.kind = saved.kind;
    s.preset = saved.preset;
    s.points = structuredClone(saved.points);
    panel.refresh();

    /* Shape picker: each button is clipped to its own shape. */
    const pick = (id) => {
      s.preset = id;
      if (POLYS[id]) { s.kind = 'polygon'; s.points = structuredClone(POLYS[id][1]); } else s.kind = id;
      panel.refresh();
      update();
    };
    const shapeBtns = [...Object.entries(POLYS).map(([id, [label, pts]]) => [id, label, `polygon(${pts.map(([x, y]) => `${x}% ${y}%`).join(',')})`]),
      ['circle', OTHER.circle, 'circle(50%)'], ['ellipse', OTHER.ellipse, 'ellipse(50% 35%)'], ['inset', OTHER.inset, 'inset(12% round 6px)']]
      .map(([id, label, clip]) => h('button', { type: 'button', class: 'cg-shape', title: label, 'aria-label': label, 'data-id': id, onclick: () => pick(id) },
        h('span', { style: `clip-path:${clip}` })));
    shapes.append(...shapeBtns);

    /* Stage: faint full image, clipped image, and the editing overlay. */
    const ghost = h('div', { class: 'cg-clip-img is-ghost' });
    const img = h('div', { class: 'cg-clip-img' });
    const svg = svgEl('svg', { class: 'cg-clip-svg', viewBox: '0 0 100 100', preserveAspectRatio: 'none' });
    const handles = h('div', { class: 'cg-clip-handles' });
    const stage = h('div', { class: 'cg-clip-stage' }, ghost, img, svg, handles);
    preview.append(h('div', { class: 'cg-stage' }, stage));

    const lastTap = { i: -1, t: 0 };
    const snap = (v) => Math.max(0, Math.min(100, s.snap ? Math.round(v / 5) * 5 : round(v, 1)));
    function drawEditor() {
      svg.replaceChildren();
      handles.replaceChildren();
      if (s.kind !== 'polygon') return;
      const n = s.points.length;
      svg.append(svgEl('polygon', { points: s.points.map((p) => p.join(',')).join(' '), class: 'cg-clip-outline' }));
      s.points.forEach((p, i) => {
        const q = s.points[(i + 1) % n];
        const edge = svgEl('line', { x1: p[0], y1: p[1], x2: q[0], y2: q[1], class: 'cg-clip-edge' });
        edge.addEventListener('pointerdown', (e) => {
          const r = stage.getBoundingClientRect();
          s.points.splice(i + 1, 0, [snap(((e.clientX - r.left) / r.width) * 100), snap(((e.clientY - r.top) / r.height) * 100)]);
          s.preset = null;
          update();
        });
        svg.append(edge);
      });
      s.points.forEach((p, i) => {
        const el = h('button', { type: 'button', class: 'cg-clip-handle', style: `left:${p[0]}%;top:${p[1]}%`, 'aria-label': `Point ${i + 1}: ${p[0]}%, ${p[1]}%`, title: `${p[0]}%, ${p[1]}%` });
        const drag = dragger(stage, (fx, fy) => {
          p[0] = snap(fx * 100);
          p[1] = snap(fy * 100);
          s.preset = null;
          el.style.left = `${p[0]}%`;
          el.style.top = `${p[1]}%`;
          el.title = `${p[0]}%, ${p[1]}%`;
          update(false);
        }, () => update());
        // Double-click/tap removes a point. Detected here because each drag end re-renders the handles.
        el.addEventListener('pointerdown', (e) => {
          const now = performance.now();
          if (lastTap.i === i && now - lastTap.t < 400 && s.points.length > 3) {
            e.preventDefault();
            lastTap.i = -1;
            s.points.splice(i, 1);
            s.preset = null;
            update();
            return;
          }
          lastTap.i = i;
          lastTap.t = now;
          drag(e);
        });
        handles.append(el);
      });
    }

    function update(redraw = true) {
      Object.assign(saved, s);
      save();
      shapeBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.id === s.preset)));
      const css = clipCss(s);
      img.style.clipPath = css;
      if (redraw) drawEditor();
      else {
        svg.querySelector('polygon')?.setAttribute('points', s.points.map((p) => p.join(',')).join(' '));
        [...svg.querySelectorAll('line')].forEach((l, i) => {
          const [p, q] = [s.points[i], s.points[(i + 1) % s.points.length]];
          l.setAttribute('x1', p[0]); l.setAttribute('y1', p[1]); l.setAttribute('x2', q[0]); l.setAttribute('y2', q[1]);
        });
      }
      output({
        css: `clip-path: ${css};`,
        tailwind: `[clip-path:${twArb(css)}]`,
        note: 'Tailwind has no clip-path utilities, so this is an arbitrary property (works in v3 and v4).',
      });
    }
    update();
  },
};
