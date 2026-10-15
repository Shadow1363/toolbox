/*
 * Auto Editor: the decision list. One row per cut and per effect, with its reason, a switch and its time.
 *
 *   renderDecisions(root, edl, { tm, onToggle(item, on), onSeek(outputTime) })
 */
import { h } from '/assets/js/lib/dom.js';
import { getEffect } from '/assets/js/lib/effects/index.js';

const clock = (s) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const KIND = { silence: 'Pause', filler: 'Filler', retake: 'Retake', trim: 'Trim', other: 'Cut' };

export function renderDecisions(root, edl, { tm, onToggle, onSeek }) {
  if (!edl) return;
  const row = (item, tag, title, where, seekTo) => {
    const box = h('input', { type: 'checkbox', checked: !item.off, 'aria-label': `Apply: ${title}` });
    box.addEventListener('change', () => onToggle(item, box.checked));
    return h('li', { class: `ae-dec${item.off ? ' is-off' : ''}` },
      box,
      h('span', { class: `ae-tag ae-tag-${tag.toLowerCase()}` }, tag),
      h('div', { class: 'ae-dec-body' },
        h('span', { class: 'ae-dec-title' }, title),
        item.reason && h('span', { class: 'ae-dec-reason' }, item.reason)),
      h('button', { type: 'button', class: 'ae-time', title: 'Jump there', onclick: () => onSeek(seekTo) }, where));
  };
  const cuts = edl.cuts.map((c) => row(c, KIND[c.kind] || 'Cut', `Remove ${(c.end - c.start).toFixed(2)} s`, clock(c.start), tm.srcToOut(c.start)));
  const layers = edl.layers.map((l) => {
    const e = getEffect(l.effect);
    if (l.at) {
      const c = edl.cuts.find((x) => x.id === l.at);
      return row(l, 'Transition', `${l.params?.type || 'Transition'} at a cut`, c ? clock(c.start) : '–', c ? tm.srcToOut(c.start) : 0);
    }
    const what = l.effect === 'screenshot' ? `Show ${l.params?.image}` : l.effect === 'text' ? `“${l.params?.text || ''}”` : l.effect === 'zoom' ? `Zoom ${l.params?.zoom ?? ''}×` : e?.name || l.effect;
    return row(l, e?.name || l.effect, `${what} for ${(l.end - l.start).toFixed(1)} s`, clock(l.start), tm.srcToOut(l.start));
  });
  root.replaceChildren(
    edl.summary ? h('p', { class: 'ae-summary' }, edl.summary) : '',
    layers.length ? h('h3', { class: 'ae-group' }, `Effects (${layers.length})`) : '',
    layers.length ? h('ul', { class: 'ae-decs' }, layers) : '',
    h('h3', { class: 'ae-group' }, `Cuts (${cuts.length})`),
    cuts.length ? h('ul', { class: 'ae-decs' }, cuts) : h('p', { class: 'ae-empty' }, 'No cuts.'),
  );
}
