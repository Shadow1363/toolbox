/* Meta Tag Previewer: pasted HTML (or a form) → platform previews, checks and a generated tag set. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, store } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, actionButton, debounce, rememberInput, readText, dropFiles } from '/assets/js/lib/text-tool.js';
import { createEditor } from '/assets/js/lib/editor.js';
import { extract, toFields, fromFields, resolve, check, generate, EMPTY } from './meta.js';

const SAMPLE_IMAGE = new URL('./sample-og.jpg', import.meta.url).href;
const SAMPLE = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>How to grow ferns indoors without losing your mind · Fernhollow Journal</title>
  <meta name="description" content="Humidity, light and watering, explained simply: a practical guide to keeping ferns green and happy in an ordinary apartment, from a gardener who killed a few first.">
  <link rel="canonical" href="https://fernhollow.example/journal/grow-ferns-indoors">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://fernhollow.example/journal/grow-ferns-indoors">
  <meta property="og:title" content="How to grow ferns indoors without losing your mind">
  <meta property="og:description" content="Humidity, light and watering, explained simply: a practical guide to keeping ferns green and happy in an ordinary apartment.">
  <meta property="og:site_name" content="Fernhollow Journal">
  <meta property="og:image" content="${SAMPLE_IMAGE}">
  <meta name="theme-color" content="#1f6f4a">
</head>
<body>…</body>
</html>
`;

const $ = (id) => document.getElementById(id);
const opts = remember('meta-preview', [{ title: '', controls: [
  { id: 'mode', type: 'segmented', label: 'Input', value: 'html', options: [['html', 'Paste HTML'], ['form', 'Fill in fields']] },
]}]);
const panel = createControls($('options'), opts.sections, { onChange: (st) => { opts.save(st); switchMode(); } });
const s = panel.state;

/* ---------- HTML input ---------- */
const savedHtml = rememberInput('meta:html', SAMPLE);
const editor = createEditor($('editor'), { value: savedHtml.value, lang: 'html', label: 'Page HTML', placeholder: 'Paste the page’s HTML (at least its <head>)…', onChange: (t) => { savedHtml.save(t); run(); } });
dropFiles(editor.el, async ([f]) => { try { editor.value = await readText(f); savedHtml.save(editor.value); run(); } catch (err) { status(err.message); } });

/* ---------- Form input ---------- */
let fields = { ...EMPTY, ...store.get('input:meta:fields', {}) };
const form = $('form');
const input = (key, label, { type = 'text', textarea = false, options, hint, placeholder } = {}) => {
  const el = options ? h('select', { id: `f-${key}` }, options.map(([v, l]) => h('option', { value: v }, l)))
    : textarea ? h('textarea', { id: `f-${key}`, rows: 3, placeholder }) : h('input', { id: `f-${key}`, type, placeholder, spellcheck: type === 'text' ? 'true' : 'false' });
  el.value = fields[key] ?? '';
  el.addEventListener(options ? 'change' : 'input', () => { fields[key] = el.value; store.set('input:meta:fields', fields); run(); });
  return h('div', { class: 'ctrl' }, h('label', { class: 'ctrl-label', for: `f-${key}` }, h('span', {}, label), h('span', { class: 'ctrl-value', id: `n-${key}` })), el, hint && h('div', { class: 'ctrl-hint' }, hint));
};
form.append(
  input('title', 'Title', { placeholder: 'How to grow ferns indoors' }),
  input('description', 'Description', { textarea: true, placeholder: 'One or two sentences about the page.' }),
  input('url', 'Page URL', { type: 'url', placeholder: 'https://example.com/page' }),
  input('image', 'Image URL', { type: 'url', placeholder: 'https://example.com/og.jpg', hint: '1200×630 PNG or JPG works everywhere.' }),
  input('imageAlt', 'Image alt text'),
  h('div', { class: 'ctrl-row' }, input('siteName', 'Site name'), input('twitterSite', 'X account', { placeholder: '@handle' })),
  h('div', { class: 'ctrl-row' },
    input('type', 'Type', { options: [['website', 'website'], ['article', 'article'], ['product', 'product'], ['profile', 'profile'], ['video.other', 'video']] }),
    input('card', 'X card', { options: [['summary_large_image', 'Large image'], ['summary', 'Small image']] })),
  input('themeColor', 'Theme color', { placeholder: '#1f6f4a' }));
form.addEventListener('submit', (e) => e.preventDefault());
const syncForm = () => { for (const [k, v] of Object.entries(fields)) { const el = $(`f-${k}`); if (el) el.value = v ?? ''; } };

$('in-actions').append(
  actionButton('Sample', 'restart', () => { editor.value = SAMPLE; savedHtml.save(SAMPLE); fields = toFields(extract(SAMPLE)); store.set('input:meta:fields', fields); syncForm(); run(); }),
  actionButton('Clear', 'trash', () => {
    if (s.mode === 'html') { editor.value = ''; savedHtml.save(''); } else { fields = { ...EMPTY }; store.set('input:meta:fields', fields); syncForm(); }
    run();
  }));

function switchMode() {
  // Moving from HTML to the form carries over what was found, unless the form already has content.
  if (s.mode === 'form' && !fields.title && !fields.description && !fields.image) {
    fields = { ...EMPTY, ...toFields(extract(editor.value)) };
    store.set('input:meta:fields', fields);
    syncForm();
  }
  $('editor').hidden = s.mode !== 'html';
  $('fetch-note').hidden = s.mode !== 'html';
  $('form').hidden = s.mode !== 'form';
  $('found').hidden = s.mode !== 'html';
  $('in-title').textContent = s.mode === 'html' ? 'Page HTML' : 'Tags';
  run();
}

/* ---------- Image probe (size check) ---------- */
const probes = new Map(); // url → { width, height } | { failed } | Promise
function probe(url) {
  if (!url) return null;
  const known = probes.get(url);
  if (known && !(known instanceof Promise)) return known;
  if (!known) {
    probes.set(url, new Promise((resolve) => {
      const img = new Image();
      img.referrerPolicy = 'no-referrer';
      img.onload = () => { probes.set(url, { width: img.naturalWidth, height: img.naturalHeight }); resolve(); run(); };
      img.onerror = () => { probes.set(url, { failed: true }); resolve(); run(); };
      img.src = url;
    }));
  }
  return null;
}

/* ---------- Render ---------- */
let code = '';
$('out-actions').append(copyButton(() => code), downloadButton(() => (code ? { text: code, name: 'meta-tags.html', type: 'text/html' } : null)));
const status = (msg) => { $('found').textContent = msg; };

const run = debounce(() => {
  const x = s.mode === 'html' ? extract(editor.value) : fromFields(fields);
  const r = resolve(x);
  const img = probe(r.og.image || r.x.image);
  const checks = check(x, r, img);
  code = generate(x, r, img);
  $('code').textContent = code;

  const icons = { error: 'alert', warn: 'alert', info: 'eye', ok: 'check' };
  $('checks').replaceChildren(...checks.map((c) => h('li', { class: `is-${c.level}` }, h('span', { html: icon(icons[c.level]) }), c.text)));
  const errs = checks.filter((c) => c.level === 'error').length;
  const warns = checks.filter((c) => c.level === 'warn').length;
  $('score').textContent = errs || warns ? [errs && `${errs} error${errs > 1 ? 's' : ''}`, warns && `${warns} warning${warns > 1 ? 's' : ''}`].filter(Boolean).join(', ') : 'All good';
  $('score').className = `mp-score ${errs ? 'is-error' : warns ? 'is-warn' : 'is-ok'}`;
  if (s.mode === 'form') for (const k of ['title', 'description']) { const n = $(`n-${k}`); if (n) n.textContent = `${(fields[k] || '').length}`; }
  if (s.mode === 'html') {
    const found = [x.title && '<title>', x.description && 'description', x.og.title && 'og:title', x.og.image && 'og:image', x.tw.card && 'twitter:card', x.canonical && 'canonical'].filter(Boolean);
    status(editor.value.trim() ? (found.length ? `Found: ${found.join(', ')}` : 'No meta tags found in this HTML.') : '');
  }
  renderPreviews(r, img);
}, 150);

const picture = (src, cls, ratio = '1.91 / 1') => {
  if (!src) return h('div', { class: `mp-img is-empty ${cls}`, style: `aspect-ratio:${ratio}` }, 'No image');
  const im = h('img', { src, alt: '', class: `mp-img ${cls}`, referrerpolicy: 'no-referrer', loading: 'lazy', style: `aspect-ratio:${ratio}` });
  im.addEventListener('error', () => im.replaceWith(h('div', { class: `mp-img is-empty ${cls}`, style: `aspect-ratio:${ratio}` }, 'Image didn’t load')));
  return im;
};
const letter = (r) => h('span', { class: 'mp-fav' }, (r.siteName || r.host || '?').charAt(0).toUpperCase());

function renderPreviews(r) {
  const host = r.host || 'example.com';
  const crumbs = r.url ? (() => { try { const u = new URL(r.url); return [u.hostname, ...u.pathname.split('/').filter(Boolean)].join(' › '); } catch { return host; } })() : host;
  const big = r.x.card === 'summary_large_image';
  const cards = [
    ['Google search', h('div', { class: 'mp-google' },
      h('div', { class: 'mp-g-site' }, letter(r), h('div', {}, h('div', { class: 'mp-g-name' }, r.siteName || host), h('div', { class: 'mp-g-url' }, crumbs))),
      h('div', { class: 'mp-g-title' }, r.google.title || 'Untitled page'),
      h('div', { class: 'mp-g-desc' }, r.google.description || 'No description: Google will show a snippet of the page text here.'))],
    ['X', big
      ? h('div', { class: 'mp-x is-large' }, h('div', { class: 'mp-x-media' }, picture(r.x.image, '', '2 / 1'), h('span', { class: 'mp-x-pill' }, r.x.title || host)), h('div', { class: 'mp-x-from' }, `From ${host}`))
      : h('div', { class: 'mp-x is-small' }, picture(r.x.image, 'mp-x-thumb', '1 / 1'), h('div', { class: 'mp-x-text' }, h('div', { class: 'mp-x-host' }, host), h('div', { class: 'mp-x-title' }, r.x.title || host), h('div', { class: 'mp-x-desc' }, r.x.description)))],
    ['LinkedIn', h('div', { class: 'mp-li' }, picture(r.og.image, ''), h('div', { class: 'mp-li-text' }, h('div', { class: 'mp-li-title' }, r.og.title || host), h('div', { class: 'mp-li-host' }, host)))],
    ['Facebook', h('div', { class: 'mp-fb' }, picture(r.og.image, ''), h('div', { class: 'mp-fb-text' }, h('div', { class: 'mp-fb-host' }, host.toUpperCase()), h('div', { class: 'mp-fb-title' }, r.og.title || host), h('div', { class: 'mp-fb-desc' }, r.og.description)))],
    ['Slack', h('div', { class: 'mp-slack' }, h('div', { class: 'mp-slack-site' }, letter(r), r.siteName || host), h('div', { class: 'mp-slack-title' }, r.og.title || host), h('div', { class: 'mp-slack-desc' }, r.og.description), r.og.image ? picture(r.og.image, 'mp-slack-img') : null)],
    ['Discord', h('div', { class: 'mp-discord', style: r.themeColor ? `--embed:${r.themeColor}` : null }, h('div', { class: 'mp-d-site' }, r.siteName || host), h('div', { class: 'mp-d-title' }, r.og.title || host), h('div', { class: 'mp-d-desc' }, r.og.description), r.og.image ? picture(r.og.image, 'mp-d-img') : null)],
  ];
  $('previews').replaceChildren(...cards.map(([name, card]) => h('figure', { class: 'mp-card' }, h('figcaption', {}, name), card)));
}

switchMode();
