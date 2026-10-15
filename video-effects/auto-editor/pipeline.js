/*
 * Auto Editor: the step list (status, detail, progress per step) and a cache for step results.
 *
 *   const steps = createSteps(root, [{ id, label }])
 *   steps.set(id, { status: 'idle'|'run'|'done'|'skip'|'error', detail, progress })
 *   const res = await cached(key, () => compute())   // IndexedDB (lib/kv.js); `key` includes the file and options
 */
import { h, icon } from '/assets/js/lib/dom.js';
import { kvGet, kvSet } from '/assets/js/lib/kv.js';

export function createSteps(root, defs) {
  const rows = new Map();
  root.replaceChildren(...defs.map((d) => {
    const bar = h('span', { class: 'ae-step-bar' }, h('span'));
    const detail = h('span', { class: 'ae-step-detail' });
    const mark = h('span', { class: 'ae-step-mark', 'aria-hidden': 'true' });
    const li = h('li', { class: 'ae-step', 'data-status': 'idle' }, mark, h('span', { class: 'ae-step-label' }, d.label), detail, bar);
    rows.set(d.id, { li, detail, bar, mark });
    return li;
  }));
  const MARK = { done: icon('check'), error: icon('alert'), skip: '–' };
  return {
    set(id, { status, detail, progress } = {}) {
      const r = rows.get(id);
      if (!r) return;
      if (status) {
        r.li.dataset.status = status;
        r.mark.innerHTML = MARK[status] || '';
      }
      if (detail != null) r.detail.textContent = detail;
      const p = status && status !== 'run' ? null : progress;
      r.bar.hidden = p == null;
      if (p != null) r.bar.firstChild.style.width = `${Math.round(Math.max(0, Math.min(1, p)) * 100)}%`;
    },
    reset() { for (const id of rows.keys()) this.set(id, { status: 'idle', detail: '' }); },
  };
}

/** Run `compute` once per key; results live in IndexedDB so a reload (or a re-run) skips finished work. */
export async function cached(key, compute) {
  const hit = await kvGet(`auto-editor:${key}`).catch(() => null);
  if (hit != null) return { value: hit, hit: true };
  const value = await compute();
  if (value != null) await kvSet(`auto-editor:${key}`, value).catch(() => {});
  return { value, hit: false };
}

export const fileKey = (f) => `${f.name}:${f.size}:${f.lastModified}`;
