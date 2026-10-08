/*
 * CSS Generators: one page, five tabs. Each tab module exports { id, label, mount(ctx) } and draws its
 * own controls and preview; it calls ctx.output({ css, tailwind, note }) whenever its result changes.
 * mount may return a cleanup function (stops animations, listeners) that runs when the tab is left.
 */
import { h, store } from '/assets/js/lib/dom.js';
import { copyButton, downloadButton } from '/assets/js/lib/text-tool.js';
import gradient from './gradient.js';
import shadow from './shadow.js';
import glass from './glass.js';
import clipPath from './clip-path.js';
import bezier from './bezier.js';

const TABS = [gradient, shadow, glass, clipPath, bezier];
const $ = (id) => document.getElementById(id);
const controls = $('controls');
const preview = $('preview');
let current = { css: '', tailwind: '', note: '' };
let active = TABS.find((t) => t.id === store.get('css-gen:tab'))?.id || TABS[0].id;
let cleanup = null;

const tabBtns = TABS.map((t) => h('button', { type: 'button', 'data-v': t.id, onclick: () => show(t.id) }, t.label));
$('tabs').append(...tabBtns);

$('css-actions').append(
  copyButton(() => current.css),
  downloadButton(() => (current.css ? { text: `${current.css}\n`, name: `${active}.css`, type: 'text/css' } : null)));
$('tw-actions').append(copyButton(() => current.tailwind));

function output(result) {
  current = { note: '', ...result };
  $('css-out').textContent = current.css;
  $('tw-out').textContent = current.tailwind || '—';
  $('tw-note').textContent = current.note || '';
  $('tw-note').hidden = !current.note;
}

function show(id) {
  active = id;
  store.set('css-gen:tab', id);
  tabBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === id)));
  cleanup?.();
  controls.replaceChildren();
  preview.replaceChildren();
  preview.className = `cg-preview cg-${id}`;
  cleanup = TABS.find((t) => t.id === id).mount({ controls, preview, output }) || null;
}

show(active);
