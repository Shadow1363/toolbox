/* SVG Optimizer: SVGO (browser build) over a batch of files or pasted code, with per-plugin toggles and four output formats. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, toast, store, formatBytes } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce, rememberInput, dropFiles } from '/assets/js/lib/text-tool.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { createEditor } from '/assets/js/lib/editor.js';
import { downloadZip } from '/assets/js/lib/image-io.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { dataUri, toJsx, componentName } from './convert.js';

const SAMPLE = `<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with a vector editor -->
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="128px" height="128px" viewBox="0 0 128 128" version="1.1">
  <title>Leaf badge</title>
  <metadata>Exported by a design app, version 4.2.1</metadata>
  <defs>
    <linearGradient id="leafGradient00001" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#34C759;stop-opacity:1.000000" />
      <stop offset="100%" style="stop-color:#0A84FF;stop-opacity:1.000000" />
    </linearGradient>
  </defs>
  <g id="Page-1" stroke="none" stroke-width="1" fill="none" fill-rule="evenodd">
    <g id="Badge">
      <circle id="Oval" fill="url(#leafGradient00001)" cx="64.000000" cy="64.000000" r="60.000000"></circle>
      <path d="M 40.000000 84.000000 C 40.000000 56.000000 60.000000 40.000000 88.000000 38.000000 C 88.000000 66.000000 72.000000 86.000000 44.000000 88.000000 Z" id="Leaf" fill="#FFFFFF" opacity="0.900000"></path>
      <path d="M 44.000000 86.000000 L 76.000000 52.000000" id="Vein" stroke="#34C759" stroke-width="3.000000" stroke-linecap="round"></path>
    </g>
  </g>
</svg>
`;
const PRESET = ['removeDoctype', 'removeXMLProcInst', 'removeComments', 'removeDeprecatedAttrs', 'removeMetadata', 'removeEditorsNSData', 'cleanupAttrs', 'mergeStyles',
  'inlineStyles', 'minifyStyles', 'cleanupIds', 'removeUselessDefs', 'cleanupNumericValues', 'convertColors', 'removeUnknownsAndDefaults', 'removeNonInheritableGroupAttrs',
  'removeUselessStrokeAndFill', 'cleanupEnableBackground', 'removeHiddenElems', 'removeEmptyText', 'convertShapeToPath', 'convertEllipseToCircle', 'moveElemsAttrsToGroup',
  'moveGroupAttrsToElems', 'collapseGroups', 'convertPathData', 'convertTransform', 'removeEmptyAttrs', 'removeEmptyContainers', 'mergePaths', 'removeUnusedNS', 'sortAttrs',
  'sortDefsChildren', 'removeDesc'];
// Not in SVGO's default preset; [default on?, note]
const EXTRAS = {
  removeScripts: [true, 'scripts and on… event handlers'], removeDimensions: [false, 'width/height (keeps viewBox, so it scales)'], removeTitle: [false, 'hurts accessibility'],
  removeXlink: [false, 'xlink:href → href'], convertStyleToAttrs: [false], convertOneStopGradients: [false], removeOffCanvasPaths: [false], reusePaths: [false],
  removeRasterImages: [false], removeStyleElement: [false], removeXMLNS: [false, 'only for inline SVG in HTML'], removeViewBox: [false, 'stops the SVG from scaling'],
  prefixIds: [false, 'avoids ID clashes when inlining several SVGs'],
};
const LABEL = { cleanupIds: 'Clean up IDs', removeXMLProcInst: 'Remove XML declaration', removeXMLNS: 'Remove xmlns', removeEditorsNSData: 'Remove editor data',
  inlineStyles: 'Inline <style> rules', removeDesc: 'Remove <desc>', removeTitle: 'Remove <title>', removeXlink: 'Use href instead of xlink:href' };
const label = (n) => LABEL[n] || n.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).replace(/ ([A-Z])(?=[a-z])/g, (m) => m.toLowerCase());
const FORMATS = [['min', 'Minified'], ['pretty', 'Readable'], ['uri', 'Data URI'], ['jsx', 'React']];
const MAX = 10 * 1024 * 1024;

const $ = (id) => document.getElementById(id);

/* ---------- Options ---------- */
const opts = remember('svg-optimizer', [{ title: '', controls: [
  { id: 'precision', type: 'range', label: 'Precision (decimals)', min: 0, max: 8, value: 3, hint: 'Lower is smaller; too low can distort shapes.' },
  { id: 'multipass', type: 'toggle', label: 'Multipass', value: true },
  { id: 'base64', type: 'toggle', label: 'Data URI as Base64', value: false },
  { id: 'cssUrl', type: 'toggle', label: 'Wrap data URI in url()', value: false },
]}]);
const panel = createControls($('options'), opts.sections, { onChange: (st, id) => { opts.save(st); if (id === 'base64' || id === 'cssUrl') render(); else optimizeAll(); } });
const s = panel.state;

const plugins = { ...Object.fromEntries(PRESET.map((p) => [p, true])), ...Object.fromEntries(Object.entries(EXTRAS).map(([k, [on]]) => [k, on])), ...store.get('opts:svg-plugins', {}) };
const pluginToggle = (name, note) => {
  const input = h('input', { type: 'checkbox', role: 'switch' });
  input.checked = !!plugins[name];
  input.addEventListener('change', () => { plugins[name] = input.checked; store.set('opts:svg-plugins', plugins); countPlugins(); optimizeAll(); });
  return h('label', { class: 'toggle so-plugin', title: name }, h('span', {}, label(name), note ? h('small', {}, note) : null), input);
};
$('plugins').append(
  h('div', { class: 'io-sub' }, 'Default set'), h('div', { class: 'so-plugin-grid' }, PRESET.map((p) => pluginToggle(p))),
  h('div', { class: 'io-sub' }, 'Extras'), h('div', { class: 'so-plugin-grid' }, Object.entries(EXTRAS).map(([p, [, note]]) => pluginToggle(p, note))),
  h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { store.set('opts:svg-plugins', {}); location.reload(); } }, 'Reset to defaults'));
function countPlugins() {
  $('plugin-count').textContent = `(${Object.values(plugins).filter(Boolean).length} on)`;
}

function svgoConfig(pretty) {
  const overrides = Object.fromEntries(PRESET.filter((p) => !plugins[p]).map((p) => [p, false]));
  return {
    multipass: s.multipass,
    floatPrecision: s.precision,
    js2svg: pretty ? { pretty: true, indent: 2 } : { pretty: false },
    plugins: [{ name: 'preset-default', params: { overrides } }, ...Object.keys(EXTRAS).filter((p) => plugins[p])],
  };
}

/* ---------- Items ---------- */
const savedPaste = rememberInput('svg:paste', SAMPLE);
let nextId = 1;
let items = [{ id: nextId++, name: 'pasted.svg', src: savedPaste.value, pasted: true }];
let sel = 0;

const picker = createFilePicker($('drop'), { multiple: true, accept: '.svg,image/svg+xml', label: 'Drop SVG files', hint: 'or paste code below', onFiles: addFiles });
picker.el.classList.add('is-compact');

async function addFiles(files) {
  const added = [];
  for (const f of files) {
    if (!/\.svg$/i.test(f.name) && f.type !== 'image/svg+xml') { toast(`“${f.name}” isn’t an SVG file.`, 'error'); continue; }
    if (f.size > MAX) { toast(`“${f.name}” is over ${formatBytes(MAX)}.`, 'error'); continue; }
    const src = await f.text();
    if (!/<svg[\s>]/i.test(src)) { toast(`“${f.name}” has no <svg> element.`, 'error'); continue; }
    added.push({ id: nextId++, name: f.name, src });
  }
  if (!added.length) return;
  // An untouched sample is just a placeholder: drop it once real files arrive.
  items = items.filter((it) => !(it.pasted && it.src === SAMPLE));
  items.push(...added);
  sel = items.indexOf(added[0]);
  editor.value = items[sel].src;
  await optimizeAll();
}

const editor = createEditor($('editor'), { value: items[0].src, lang: 'xml', label: 'SVG code', placeholder: 'Paste SVG code here…', onChange: (text) => {
  const it = items[sel];
  if (!it) {
    items.push({ id: nextId++, name: 'pasted.svg', src: text, pasted: true });
    sel = items.length - 1;
  } else it.src = text;
  if (items[sel].pasted) savedPaste.save(text);
  optimizeOne(items[sel]);
} });
dropFiles(editor.el, addFiles);
$('in-actions').append(
  actionButton('New', 'plus', () => {
    items.push({ id: nextId++, name: `pasted-${items.length + 1}.svg`, src: '', pasted: true });
    sel = items.length - 1;
    editor.value = '';
    render();
    editor.focus();
  }),
  actionButton('Clear all', 'trash', () => {
    items = [{ id: nextId++, name: 'pasted.svg', src: '', pasted: true }];
    sel = 0;
    editor.value = '';
    savedPaste.save('');
    render();
  }));

/* ---------- Optimize ---------- */
let svgo = null;
async function getSvgo() {
  try { svgo ||= await loadLib('svgo'); return svgo; } catch (err) { toast(err.message, 'error'); throw err; }
}
const bytes = (t) => new Blob([t]).size;
const size = (n) => (n < 1024 ? `${n} B` : formatBytes(n)); // icons are often under 1 KB

async function optimizeOne(it, { draw = true } = {}) {
  if (!it.src.trim()) { it.out = ''; it.error = null; if (draw) render(); return; }
  const { optimize } = await getSvgo();
  try {
    it.out = optimize(it.src, svgoConfig(false)).data;
    it.error = null;
  } catch (err) {
    it.out = '';
    it.error = (err.message || String(err)).split('\n')[0].replace(/^SvgoParserError: /, '');
  }
  it.pretty = null;
  if (draw) render();
}
const optimizeAll = debounce(async () => {
  for (const it of items) await optimizeOne(it, { draw: false });
  render();
}, 150);

/* ---------- Output ---------- */
let format = FORMATS.some(([f]) => f === store.get('opts:svg-format')) ? store.get('opts:svg-format') : 'min';
const fmtBtns = FORMATS.map(([v, l]) => h('button', { type: 'button', 'data-v': v, onclick: () => { format = v; store.set('opts:svg-format', v); render(); } }, l));
$('formats').append(...fmtBtns);

function outputFor(it) {
  if (!it?.out) return '';
  if (format === 'pretty') {
    try { it.pretty ||= svgo.optimize(it.out, { js2svg: { pretty: true, indent: 2 }, plugins: [] }).data; } catch { it.pretty = it.out; }
    return it.pretty;
  }
  if (format === 'uri') { const u = dataUri(it.out, s.base64); return s.cssUrl ? `url("${u}")` : u; }
  if (format === 'jsx') {
    try { return toJsx(it.out, componentName(it.name)); } catch (err) { return `// ${err.message}`; }
  }
  return it.out;
}
const fileFor = (it) => {
  const base = it.name.replace(/\.svg$/i, '');
  if (format === 'jsx') return { name: `${componentName(it.name)}.jsx`, text: outputFor(it), type: 'text/javascript' };
  if (format === 'uri') return { name: `${base}.datauri.txt`, text: outputFor(it) };
  return { name: `${base}${format === 'min' ? '.min' : ''}.svg`, text: outputFor(it), type: 'image/svg+xml' };
};

$('out-actions').append(
  copyButton(() => outputFor(items[sel])),
  downloadButton(() => (items[sel]?.out ? fileFor(items[sel]) : null)),
  actionButton('All (.zip)', 'archive', async () => {
    const ready = items.filter((it) => it.out);
    if (!ready.length) return toast('Nothing to download yet.');
    const seen = new Map();
    const files = ready.map((it) => {
      const f = fileFor(it);
      const n = seen.get(f.name) || 0;
      seen.set(f.name, n + 1);
      return { name: n ? f.name.replace(/(\.[^.]+(?:\.[^.]+)?)$/, `-${n + 1}$1`) : f.name, text: f.text };
    });
    try { await downloadZip(files, 'optimized-svgs.zip'); } catch (err) { toast(err.message, 'error'); }
  }, { title: 'Download every file in the current format' }));

const urls = { before: null, after: null };
function setImg(key, svg) {
  if (urls[key]) URL.revokeObjectURL(urls[key]);
  urls[key] = svg ? URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' })) : null;
  $(key).src = urls[key] || '';
  $(key).hidden = !svg;
}
for (const key of ['before', 'after']) $(key).addEventListener('error', () => { $(key).hidden = true; });

function status(kind, text) {
  const el = $('status');
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'error' ? icon('alert') : kind === 'ok' ? icon('check') : '';
  el.append(text);
}

let gzipId = 0;
function render() {
  fmtBtns.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === format)));
  const it = items[sel];
  // File list
  $('files').hidden = items.length < 2 && !!items[0]?.pasted;
  $('files').replaceChildren(...items.map((x, i) => {
    const a = bytes(x.src);
    const b = x.out ? bytes(x.out) : 0;
    return h('li', { class: i === sel ? 'is-sel' : '' },
      h('button', { type: 'button', class: 'so-file', onclick: () => { sel = i; editor.value = x.src; render(); } },
        h('span', { class: 'so-name' }, x.name),
        h('span', { class: 'so-size' }, x.error ? 'error' : x.out ? `${size(a)} → ${size(b)}` : '—'),
        x.out ? h('b', { class: 'so-save' }, `−${Math.max(0, Math.round((1 - b / a) * 100))}%`) : null),
      h('button', { type: 'button', class: 'btn btn-ghost icon-btn', 'aria-label': `Remove ${x.name}`, html: icon('x'), onclick: () => {
        items.splice(i, 1);
        if (!items.length) items.push({ id: nextId++, name: 'pasted.svg', src: '', pasted: true });
        sel = Math.min(sel, items.length - 1);
        editor.value = items[sel].src;
        render();
      } }));
  }));
  $('src-title').textContent = it ? `SVG code · ${it.name}` : 'SVG code';
  // Previews (as <img>, which never runs scripts inside the SVG)
  setImg('before', it?.src.trim() ? it.src : null);
  setImg('after', it?.out || null);
  const a = it ? bytes(it.src) : 0;
  const b = it?.out ? bytes(it.out) : 0;
  $('before-size').textContent = a ? size(a) : '';
  $('after-size').textContent = b ? size(b) : '';
  $('output').value = outputFor(it);
  if (!it?.src.trim()) status('', 'Paste SVG code or drop files to start.');
  else if (it.error) status('error', `Couldn’t parse this SVG: ${it.error}`);
  else if (it.out) {
    const total = items.filter((x) => x.out);
    const ta = total.reduce((n, x) => n + bytes(x.src), 0);
    const tb = total.reduce((n, x) => n + bytes(x.out), 0);
    const line = `Saved ${size(a - b)} (${Math.round((1 - b / a) * 100)}%)${total.length > 1 ? ` · all ${total.length} files: ${size(ta)} → ${size(tb)}` : ''}`;
    status('ok', line);
    // Gzipped size, as served by most web servers.
    const id = ++gzipId;
    if ('CompressionStream' in window) {
      new Response(new Blob([it.out]).stream().pipeThrough(new CompressionStream('gzip'))).blob().then((z) => {
        if (id === gzipId) $('status').append(` · ${size(z.size)} gzipped`);
      }).catch(() => {});
    }
  }
}

countPlugins();
optimizeAll();
