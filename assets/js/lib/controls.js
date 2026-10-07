/**
 * Declarative controls panel. Describe the controls, get a live `state` object.
 *
 *   const panel = createControls(root, [
 *     { title: 'Text', controls: [
 *       { id: 'text', type: 'textarea', label: 'Text', value: 'Hello' },
 *       { id: 'size', type: 'range', label: 'Size', min: 10, max: 300, value: 96, unit: 'px' },
 *       { id: 'color', type: 'color', label: 'Color', value: '#ffffff' },
 *       { id: 'bg', type: 'segmented', label: 'Background', value: 'solid',
 *         options: [['solid', 'Solid'], ['gradient', 'Gradient']] },
 *       { id: 'bg2', type: 'color', label: 'Second color', showIf: (s) => s.bg === 'gradient' },
 *     ]},
 *   ], { onChange: (state, changedId) => stage.invalidate() });
 *
 * Control types: range, number, color, select, segmented, toggle, text, textarea,
 *   presets (chips that apply a patch), swatches (color chips), button, custom.
 * Every control accepts: id, label, value, hint, showIf(state).
 * Sections accept: title, controls, showIf(state).
 */
import { h } from './dom.js';

export function createControls(root, sections, { onChange } = {}) {
  const state = {};
  const setters = {};      // id → (value) => update the DOM without emitting
  const conditionals = []; // [{ el, showIf }]

  const emit = (id) => {
    refresh();
    onChange?.(state, id);
  };

  const commit = (id, value) => {
    state[id] = value;
    emit(id);
  };

  for (const section of sections) {
    const sec = h('section', { class: 'ctrl-section' }, section.title && h('h3', {}, section.title));
    if (section.showIf) conditionals.push({ el: sec, showIf: section.showIf });
    for (const c of section.controls) {
      const el = buildControl(c);
      if (!el) continue;
      if (c.showIf) conditionals.push({ el, showIf: c.showIf });
      sec.append(el);
    }
    root.append(sec);
  }
  refresh();

  function refresh() {
    for (const { el, showIf } of conditionals) el.hidden = !showIf(state);
  }

  function wrap(c, input, valueEl) {
    return h('div', { class: 'ctrl' },
      c.label && h('label', { class: 'ctrl-label', for: `c-${c.id}` }, h('span', {}, c.label), valueEl),
      input,
      c.hint && h('div', { class: 'ctrl-hint' }, c.hint));
  }

  function buildControl(c) {
    if (c.id && c.value !== undefined) state[c.id] = c.value;
    switch (c.type) {
      case 'range': {
        const fmt = c.format || ((v) => `${+v.toFixed(c.decimals ?? (c.step < 1 ? 2 : 0))}${c.unit || ''}`);
        const val = h('span', { class: 'ctrl-value' });
        const input = h('input', { type: 'range', id: `c-${c.id}`, min: c.min ?? 0, max: c.max ?? 100, step: c.step ?? 1 });
        const paint = (v) => {
          input.value = v;
          val.textContent = fmt(+v);
          input.style.setProperty('--pct', `${((v - input.min) / (input.max - input.min)) * 100}%`);
        };
        setters[c.id] = paint;
        paint(c.value);
        input.addEventListener('input', () => { paint(+input.value); commit(c.id, +input.value); });
        return wrap(c, input, val);
      }
      case 'number': {
        const input = h('input', { type: 'number', id: `c-${c.id}`, min: c.min, max: c.max, step: c.step ?? 1, value: c.value });
        setters[c.id] = (v) => { input.value = v; };
        input.addEventListener('input', () => { if (input.value !== '') commit(c.id, +input.value); });
        return wrap(c, input);
      }
      case 'color': {
        const picker = h('input', { type: 'color', id: `c-${c.id}`, value: c.value, 'aria-label': c.label });
        const text = h('input', { type: 'text', value: c.value, maxlength: 7, spellcheck: 'false', 'aria-label': `${c.label} hex` });
        setters[c.id] = (v) => { picker.value = v; text.value = v; };
        picker.addEventListener('input', () => { text.value = picker.value; commit(c.id, picker.value); });
        text.addEventListener('change', () => {
          const v = text.value.trim().replace(/^([^#])/, '#$1');
          if (/^#[0-9a-f]{6}$/i.test(v)) { picker.value = v; text.value = v; commit(c.id, v); } else text.value = state[c.id];
        });
        return wrap(c, h('div', { class: 'color-input' }, picker, text));
      }
      case 'select': {
        const input = h('select', { id: `c-${c.id}` }, c.options.map(([v, label]) => h('option', { value: v }, label)));
        input.value = c.value;
        setters[c.id] = (v) => { input.value = v; };
        input.addEventListener('change', () => commit(c.id, input.value));
        return wrap(c, input);
      }
      case 'segmented': {
        const btns = c.options.map(([v, label]) => h('button', { type: 'button', 'data-v': v }, label));
        const paint = (v) => btns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
        setters[c.id] = paint;
        paint(c.value);
        btns.forEach((b) => b.addEventListener('click', () => { paint(b.dataset.v); commit(c.id, b.dataset.v); }));
        return wrap(c, h('div', { class: 'segmented', role: 'group', 'aria-label': c.label }, btns));
      }
      case 'toggle': {
        const input = h('input', { type: 'checkbox', id: `c-${c.id}`, role: 'switch' });
        input.checked = !!c.value;
        setters[c.id] = (v) => { input.checked = !!v; };
        input.addEventListener('change', () => commit(c.id, input.checked));
        return h('div', { class: 'ctrl' },
          h('label', { class: 'toggle' }, h('span', {}, c.label), input),
          c.hint && h('div', { class: 'ctrl-hint' }, c.hint));
      }
      case 'text':
      case 'textarea': {
        const input = c.type === 'text'
          ? h('input', { type: 'text', id: `c-${c.id}`, placeholder: c.placeholder || '' })
          : h('textarea', { id: `c-${c.id}`, rows: c.rows || 3, placeholder: c.placeholder || '' });
        input.value = c.value ?? '';
        setters[c.id] = (v) => { input.value = v; };
        input.addEventListener('input', () => commit(c.id, input.value));
        return wrap(c, input);
      }
      case 'presets': {
        // options: [{ label, value, patch: {...} }] — clicking applies the patch.
        const chips = c.options.map((o) => h('button', { type: 'button', class: 'chip', 'data-v': o.value }, o.label));
        const paint = (v) => chips.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
        if (c.id) setters[c.id] = paint;
        paint(c.value);
        chips.forEach((b, i) => b.addEventListener('click', () => {
          const o = c.options[i];
          if (c.id) { state[c.id] = o.value; paint(o.value); }
          api.set({ ...(o.patch || {}) }, { silent: true });
          emit(c.id);
        }));
        return wrap(c, h('div', { class: 'chips' }, chips));
      }
      case 'swatches': {
        // options: [{ label, value: css-background, patch }]
        const chips = c.options.map((o) => h('button', {
          type: 'button', class: 'swatch-chip', title: o.label, 'aria-label': o.label, style: `background:${o.preview}`, 'data-v': o.value,
        }));
        const paint = (v) => chips.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === String(v))));
        if (c.id) setters[c.id] = paint;
        paint(c.value);
        chips.forEach((b, i) => b.addEventListener('click', () => {
          const o = c.options[i];
          if (c.id) { state[c.id] = o.value; paint(o.value); }
          api.set({ ...(o.patch || {}) }, { silent: true });
          emit(c.id);
        }));
        return wrap(c, h('div', { class: 'chips' }, chips));
      }
      case 'button': {
        const btn = h('button', { type: 'button', class: `btn btn-sm ${c.variant || ''}`, onclick: () => c.onClick?.(state) }, c.text || c.label);
        return h('div', { class: 'ctrl' }, btn);
      }
      case 'custom':
        return h('div', { class: 'ctrl' }, c.label && h('div', { class: 'ctrl-label' }, c.label), c.el);
      default:
        console.warn('Unknown control type', c.type);
        return null;
    }
  }

  const api = {
    state,
    /** Update values (and their inputs). `silent` skips onChange. */
    set(patch, { silent = false } = {}) {
      for (const [k, v] of Object.entries(patch)) {
        state[k] = v;
        setters[k]?.(v);
      }
      refresh();
      if (!silent) onChange?.(state, Object.keys(patch)[0]);
    },
    get: (id) => state[id],
    refresh,
  };
  return api;
}
