/**
 * Transition picker: a modal grid of live, looping thumbnails rendered between the
 * built-in sample frames with the same engine and shaders as the preview.
 */
import { h, icon } from '/assets/js/lib/dom.js';
import { createEngine } from './engine.js';
import { sampleFrame } from './samples.js';
import { TRANSITIONS, CATEGORIES } from './transitions/index.js';
import { defaultsOf } from './transitions/_common.js';

const TW = 224, TH = 126;
const CYCLE = 2.6, HOLD = 0.5;
let engine;

/** opts: { current: id, ease: (name, t) => t, onPick: (id) => void } */
export function openGallery({ current, ease, onPick }) {
  engine ||= createEngine();
  const A = sampleFrame('A', TW, TH), B = sampleFrame('B', TW, TH);
  const cards = [];

  const card = (id, name, description) => {
    const canvas = h('canvas', { width: TW, height: TH, 'aria-hidden': 'true' });
    const btn = h('button', { type: 'button', class: 'tr-gallery-card', 'aria-pressed': String(id === current), title: description },
      canvas, h('span', {}, name));
    btn.addEventListener('click', () => { close(); onPick(id); });
    return { btn, ctx: canvas.getContext('2d'), id };
  };

  const sections = [
    h('section', {}, h('h3', {}, 'Basic'), h('div', { class: 'tr-gallery-grid' }, (() => {
      const c = card('cut', 'Hard cut', 'No transition: A cuts straight to B.');
      cards.push(c); return c.btn;
    })())),
    ...CATEGORIES.map(([cat, label]) => h('section', {}, h('h3', {}, label), h('div', { class: 'tr-gallery-grid' },
      TRANSITIONS.filter((t) => t.category === cat).map((t) => {
        const c = card(t.id, t.name, t.description);
        c.tr = t; c.params = defaultsOf(t.params);
        cards.push(c);
        return c.btn;
      })))),
  ];

  const backdrop = h('div', { class: 'modal-backdrop', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose a transition' },
    h('div', { class: 'modal tr-gallery' },
      h('div', { class: 'tr-gallery-head' },
        h('h2', {}, 'Choose a transition'),
        h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': 'Close', html: icon('x'), onclick: () => close() })),
      h('div', { class: 'tr-gallery-body' }, sections)));
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  document.body.append(backdrop);
  (cards.find((c) => c.id === current) || cards[0]).btn.focus();

  const t0 = performance.now();
  let raf = requestAnimationFrame(function loop(now) {
    raf = requestAnimationFrame(loop);
    const t = ((now - t0) / 1000) % CYCLE;
    const raw = Math.min(1, Math.max(0, (t - HOLD) / (CYCLE - 2 * HOLD)));
    for (const c of cards) {
      if (!c.tr) { c.ctx.drawImage(raw < 0.5 ? A : B, 0, 0); continue; }
      engine.render(c.ctx, c.tr, A, B, { p: ease(c.tr.easing, raw), raw, params: c.params, duration: c.tr.duration });
    }
  });

  function close() {
    cancelAnimationFrame(raf);
    document.removeEventListener('keydown', onKey);
    backdrop.remove();
  }
}
