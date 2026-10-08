/**
 * Building blocks for small input → output tools (Convert & Encode): options that persist
 * in localStorage, copy/download buttons, and a debounce for live updates.
 * Layout classes live in styles.css: `.io-options`, `.io-grid`, `.io-panel`, `.io-head`.
 *
 *   const opts = remember('base64', sections);            // restores saved values into the specs
 *   const panel = createControls(el, opts.sections, { onChange: (s) => { opts.save(s); run(); } });
 *   head.append(copyButton(() => output.value), downloadButton(() => ({ text: output.value, name: 'out.txt' })));
 */
import { h, icon, toast, downloadBlob, store } from './dom.js';

/** Restore each control's last value (by id) and return a `save(state)` to call on change. */
export function remember(key, sections) {
  const saved = store.get(`opts:${key}`, {});
  for (const sec of sections) {
    for (const c of sec.controls) {
      if (c.id && c.id in saved && !['button', 'custom', 'presets'].includes(c.type)) c.value = saved[c.id];
    }
  }
  return { sections, save: (state) => store.set(`opts:${key}`, state) };
}

export async function copyText(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(label, 'success', 1500);
  } catch {
    toast('Copy failed: your browser blocked clipboard access.', 'error');
  }
}

/** A small button with an icon. */
export function actionButton(label, iconName, onClick, { primary = false, title } = {}) {
  const b = h('button', { type: 'button', class: `btn btn-sm${primary ? ' btn-primary' : ''}`, title: title || null, html: `${icon(iconName)} ${label}` });
  b.addEventListener('click', () => onClick(b));
  return b;
}

export const copyButton = (getText, label = 'Copy') =>
  actionButton(label, 'copy', () => {
    const t = getText();
    if (t) copyText(t); else toast('Nothing to copy yet.');
  });

/** get() returns { blob } or { text, type? }, plus { name }; or null when there's nothing to save. */
export const downloadButton = (get, label = 'Download') =>
  actionButton(label, 'download', () => {
    const r = get();
    if (!r) return toast('Nothing to download yet.');
    downloadBlob(r.blob || new Blob([r.text], { type: r.type || 'text/plain;charset=utf-8' }), r.name);
  });

export function debounce(fn, ms = 120) {
  let id = 0;
  return (...args) => { clearTimeout(id); id = setTimeout(() => fn(...args), ms); };
}

/** Read a File as text, or throw a readable error for binary files. */
export async function readText(file) {
  const buf = new Uint8Array(await file.slice(0, 4096).arrayBuffer());
  if (buf.includes(0)) throw new Error(`“${file.name}” looks like a binary file, not text.`);
  return file.text();
}

/**
 * Persist a tool's input text (not just its options). `save` is debounced and skips texts over `max`
 * characters, so a huge paste never fills localStorage; the last small input is kept instead.
 *   const saved = rememberInput('regex:text', SAMPLE);   editor.value = saved.value;   saved.save(editor.value);
 */
export function rememberInput(key, fallback = '', max = 200_000) {
  const k = `input:${key}`;
  const value = store.get(k, null);
  const write = debounce((text) => { if (text.length <= max) store.set(k, text); }, 400);
  return { value: typeof value === 'string' ? value : fallback, save: write };
}

/** Make any element a drop target for files (adds `.is-over` while dragging). */
export function dropFiles(el, onFiles) {
  let depth = 0;
  const has = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  el.addEventListener('dragenter', (e) => { if (!has(e)) return; e.preventDefault(); depth++; el.classList.add('is-over'); });
  el.addEventListener('dragover', (e) => { if (has(e)) e.preventDefault(); });
  el.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; el.classList.remove('is-over'); } });
  el.addEventListener('drop', (e) => {
    if (!has(e)) return;
    e.preventDefault();
    depth = 0;
    el.classList.remove('is-over');
    const files = [...e.dataTransfer.files];
    if (files.length) onFiles(files);
  });
}
