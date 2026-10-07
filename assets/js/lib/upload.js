/**
 * Drag-and-drop / file-picker zone.
 *
 *   createDropzone(root, {
 *     accept: ['video', 'image'],
 *     label: 'Drop a video or image',
 *     onLoad: (media) => {...},   // media from loadMedia()
 *     onClear: () => {...},
 *   });
 */
import { h, icon, toast, formatBytes } from './dom.js';
import { loadMedia, LIMITS, MediaError } from './media.js';

// Stop the browser from navigating away when a file is dropped outside a zone.
['dragover', 'drop'].forEach((ev) => window.addEventListener(ev, (e) => e.preventDefault()));

export function createDropzone(root, { accept = ['video', 'image'], label, limits = {}, onLoad, onClear } = {}) {
  const mime = accept.map((k) => `${k}/*`).join(',');
  const max = Math.max(...accept.map((k) => limits[k] ?? LIMITS[k]));
  const hint = `${accept.map((k) => (k === 'video' ? 'MP4, WebM, MOV' : 'PNG, JPG, WebP')).join(' · ')} — up to ${formatBytes(max)}`;
  let current = null;

  const input = h('input', { type: 'file', accept: mime, 'aria-label': label || 'Choose file' });
  const zone = h('div', { class: 'dropzone', tabindex: '-1' });
  root.append(zone);
  renderEmpty();

  function renderEmpty() {
    zone.classList.remove('has-file');
    zone.replaceChildren(
      h('span', { html: icon('upload'), style: 'display:contents' }),
      h('strong', {}, label || `Drop a ${accept.join(' or ')} here`),
      h('span', {}, `or click to browse · ${hint}`),
      input);
  }

  function renderFile(media) {
    zone.classList.add('has-file');
    const meta = [
      `${media.width}×${media.height}`,
      media.kind === 'video' ? `${media.duration.toFixed(1)}s` : null,
      formatBytes(media.size),
    ].filter(Boolean).join(' · ');
    zone.replaceChildren(
      h('span', { html: icon(media.kind === 'video' ? 'film' : 'image'), style: 'display:contents' }),
      h('div', { class: 'file-info' }, h('strong', { title: media.name }, media.name), h('span', {}, meta)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm file-clear', onclick: (e) => { e.stopPropagation(); clear(); } }, 'Change'),
      input);
  }

  async function handle(file) {
    if (!file) return;
    zone.setAttribute('aria-busy', 'true');
    try {
      const media = await loadMedia(file, { accept, limits });
      current?.dispose();
      if (current?.kind === 'video') current.el.pause();
      current = media;
      renderFile(media);
      onLoad?.(media);
    } catch (err) {
      if (!(err instanceof MediaError)) console.error(err);
      toast(err.message || 'Could not open that file.', 'error', 7000);
    } finally {
      zone.removeAttribute('aria-busy');
      input.value = '';
    }
  }

  function clear() {
    if (current?.kind === 'video') current.el.pause();
    current?.dispose();
    current = null;
    renderEmpty();
    onClear?.();
  }

  input.addEventListener('change', () => handle(input.files[0]));
  ['dragenter', 'dragover'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add('is-over'); }));
  ['dragleave', 'drop'].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove('is-over'); }));
  zone.addEventListener('drop', (e) => handle(e.dataTransfer.files[0]));

  return { clear, get media() { return current; }, load: handle };
}
