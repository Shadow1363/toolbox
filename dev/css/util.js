/* Helpers shared by the CSS generator tabs. */
import { store } from '/assets/js/lib/dom.js';

export const round = (n, d = 2) => +(+n).toFixed(d);

export function hexToRgb(hex) {
  const m = /^#?([\da-f]{6})$/i.exec(hex) || [null, 'ffffff'];
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** "#rrggbb" with opacity → "#rrggbb" when opaque, else "rgba(r, g, b, a)". */
export function color(hex, alpha = 1) {
  if (alpha >= 1) return hex.toLowerCase();
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${round(alpha)})`;
}

/** Tailwind color token: white/black by name, else an arbitrary hex; opacity as /NN. */
export function twColor(hex, alpha = 1) {
  const h = hex.toLowerCase();
  const base = h === '#ffffff' ? 'white' : h === '#000000' ? 'black' : `[${h}]`;
  return alpha >= 1 ? base : `${base}/${Math.round(alpha * 100)}`;
}

/** A CSS value inside a Tailwind arbitrary class: spaces become underscores. */
export const twArb = (v) => v.replace(/,\s+/g, ',').replace(/\s+/g, '_');

/** Pick the named Tailwind step for an exact px value, else an arbitrary [Npx]. */
export const twScale = (prefix, px, scale) => {
  const hit = Object.entries(scale).find(([, v]) => v === px);
  return hit ? (hit[0] ? `${prefix}-${hit[0]}` : prefix) : `${prefix}-[${px}px]`;
};

/** Per-tab state in localStorage, merged over defaults. */
export function tabState(id, defaults) {
  const saved = store.get(`css-gen:${id}`, null);
  const state = structuredClone(defaults);
  if (saved && typeof saved === 'object') Object.assign(state, saved);
  return { state, save: () => store.set(`css-gen:${id}`, state) };
}

/**
 * Pointer dragging inside `area`: calls move(fx, fy, e) with the position as fractions of the
 * area's box (not clamped). Returns a function that starts a drag from a pointerdown event.
 */
export function dragger(area, move, end) {
  return (down) => {
    down.preventDefault();
    const target = down.currentTarget;
    target.setPointerCapture?.(down.pointerId);
    const at = (e) => {
      const r = area.getBoundingClientRect();
      move((e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height, e);
    };
    const up = () => {
      target.removeEventListener('pointermove', at);
      target.removeEventListener('pointerup', up);
      target.removeEventListener('pointercancel', up);
      end?.();
    };
    target.addEventListener('pointermove', at);
    target.addEventListener('pointerup', up);
    target.addEventListener('pointercancel', up);
  };
}

export const svgEl = (tag, attrs = {}) => {
  const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) el.setAttribute(k, v);
  return el;
};
