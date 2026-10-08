/**
 * Site shell: header (home link, breadcrumb, theme toggle), footer,
 * card grids and the tool-page heading. Every page loads this module.
 *
 * Page hints, set on <body>:
 *   data-category="video-effects"  → hub page for a category
 *   data-tool="text-effects"       → tool page
 * Placeholders it fills:
 *   <header id="site-header">, <footer id="site-footer">
 *   <div data-grid="home">  or  <div data-grid="category">
 *   <div data-tool-head>   (title + description from tools.js)
 */
import { categories, tools, getCategory, getTool, toolsIn, standaloneTools, categoryUrl, toolUrl } from './tools.js';
import { h, icon } from './lib/dom.js';

const SITE_NAME = 'Toolbox';
const body = document.body;
const tool = getTool(body.dataset.tool);
const category = getCategory(body.dataset.category || tool?.category);


/* ---------- Header ---------- */
function renderHeader() {
  const header = document.getElementById('site-header');
  if (!header) return;
  header.className = 'site-header';

  const crumbs = [{ name: 'Home', href: '/' }];
  if (category) crumbs.push({ name: category.name, href: categoryUrl(category) });
  if (tool) crumbs.push({ name: tool.name, href: toolUrl(tool) });

  const themeBtn = h('button', {
    class: 'btn btn-ghost icon-btn', type: 'button', 'aria-label': 'Toggle light/dark theme',
    onclick: () => setTheme(currentTheme() === 'dark' ? 'light' : 'dark'),
  });
  const syncThemeIcon = () => {
    themeBtn.innerHTML = icon(currentTheme() === 'dark' ? 'sun' : 'moon');
    themeBtn.title = currentTheme() === 'dark' ? 'Switch to light mode' : 'Switch to dark mode';
  };
  syncThemeIcon();
  document.addEventListener('themechange', syncThemeIcon);

  header.replaceChildren(
    h('div', { class: 'container' },
      h('a', { class: 'brand', href: '/', 'aria-label': `${SITE_NAME} home` },
        h('span', { class: 'brand-mark', html: icon('wrench') }), SITE_NAME),
      crumbs.length > 1 && h('nav', { class: 'breadcrumb', 'aria-label': 'Breadcrumb' },
        h('ol', {}, crumbs.map((c, i) => h('li', {},
          i === crumbs.length - 1 ? h('span', { 'aria-current': 'page' }, c.name) : h('a', { href: c.href }, c.name))))),
      h('div', { class: 'header-actions' }, themeBtn)));
}

function currentTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
function setTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  try { localStorage.setItem('theme', t); } catch { /* ignore */ }
  document.dispatchEvent(new CustomEvent('themechange', { detail: t }));
}

/* ---------- Footer ---------- */
function renderFooter() {
  const footer = document.getElementById('site-footer');
  if (!footer) return;
  footer.className = 'site-footer';
  footer.replaceChildren(h('div', { class: 'container' },
    h('span', {}, `© ${new Date().getFullYear()} ${SITE_NAME}`),
    h('span', {}, 'Everything runs in your browser. Your files never leave your device.')));
}

/* ---------- Tool head ---------- */
function renderToolHead() {
  const el = document.querySelector('[data-tool-head]');
  if (!el || !tool) return;
  el.className = 'tool-head';
  el.replaceChildren(
    h('div', {}, h('h1', {}, tool.name), h('p', {}, tool.description)),
    h('div', { class: 'privacy-note', html: `${icon('lock')} Processed locally, nothing is uploaded` }));
}

/* ---------- Grids ---------- */
function card({ href, name, description, thumbnail, meta, status }) {
  const soon = status === 'soon';
  return h('a', { class: `card${soon ? ' is-disabled' : ''}`, href: soon ? null : href, 'aria-disabled': soon || null },
    h('div', { class: 'card-thumb' },
      thumbnail && h('img', { src: thumbnail, alt: '', loading: 'lazy', width: 320, height: 200 })),
    h('div', { class: 'card-body' },
      h('div', { class: 'card-title' }, name, status && h('span', { class: 'badge' }, soon ? 'Soon' : status)),
      h('p', { class: 'card-desc' }, description),
      meta && h('div', { class: 'card-meta' }, meta)));
}

const toolCard = (t) => card({ ...t, href: toolUrl(t), meta: t.category && t.category !== category?.id ? getCategory(t.category)?.name : null });

function renderGrids() {
  document.querySelectorAll('[data-grid]').forEach((el) => {
    const kind = el.dataset.grid;
    if (kind === 'category') {
      renderCategory(el);
    } else if (kind === 'home') {
      renderHome(el);
    }
  });
}

/** Search words must all appear in a tool's name, description, tags or category (so "pdf" finds every PDF tool). */
const matches = (t, q) => {
  const text = [t.name, t.description, t.section, ...(t.tags || []), getCategory(t.category)?.name || ''].join(' ').toLowerCase();
  return q.split(/\s+/).every((w) => text.includes(w));
};

function searchInput(placeholder, onQuery) {
  const input = h('input', { type: 'search', placeholder, 'aria-label': 'Search tools' });
  input.addEventListener('input', () => onQuery(input.value.trim().toLowerCase(), input.value));
  const search = document.querySelector('[data-search]');
  if (search) search.replaceChildren(h('div', { class: 'search', html: icon('search') }, input));
}

/**
 * Hub page: one grid, or one per section when the category lists `sections`; plus a search box.
 * `related` tool ids (from other categories) get their own section at the end and are searchable too.
 */
function renderCategory(el) {
  const list = category ? toolsIn(category.id) : [];
  const related = (category?.related || []).map(getTool).filter(Boolean);
  if (!list.length) return el.replaceChildren(h('p', { class: 'empty' }, 'No tools here yet.'));
  const sections = category.sections || [];
  const browse = sections.length
    ? h('div', {}, [...sections, null].map((name) => {
      const items = list.filter((t) => (name ? t.section === name : !sections.includes(t.section)));
      return items.length > 0 && h('section', { class: 'hub-section' },
        h('h2', { class: 'section-title' }, name || 'More'), h('div', { class: 'card-grid' }, items.map(toolCard)));
    }))
    : h('div', {}, h('div', { class: 'card-grid' }, list.map(toolCard)));
  if (related.length) {
    const homes = [...new Set(related.map((t) => getCategory(t.category)?.name).filter(Boolean))];
    browse.append(h('section', { class: 'hub-section hub-related' },
      h('h2', { class: 'section-title' }, `Also useful${homes.length === 1 ? ` (in ${homes[0]})` : ''}`),
      h('div', { class: 'card-grid' }, related.map(toolCard))));
  }
  const results = h('div', { class: 'card-grid' });
  const resultsWrap = h('div', { hidden: true }, h('h2', { class: 'section-title' }, 'Matching tools'), results);
  searchInput(`Search ${list.length} tools or formats (pdf, base64…)`, (q, raw) => {
    browse.hidden = !!q;
    resultsWrap.hidden = !q;
    if (!q) return;
    const hits = [...list, ...related].filter((t) => matches(t, q));
    results.replaceChildren(...(hits.length ? hits.map(toolCard) : [h('p', { class: 'empty' }, `No tools match “${raw}”.`)]));
  });
  el.replaceChildren(browse, resultsWrap);
}

function renderHome(el) {
  const catGrid = h('div', { class: 'card-grid' }, categories.map((c) =>
    card({ ...c, href: categoryUrl(c), meta: `${toolsIn(c.id).length} tools` })));
  const loose = standaloneTools();
  const results = h('div', { class: 'card-grid' });
  const resultsWrap = h('div', { hidden: true }, h('h2', { class: 'section-title' }, 'Matching tools'), results);
  const browse = h('div', {},
    h('h2', { class: 'section-title' }, 'Categories'), catGrid,
    loose.length > 0 && h('h2', { class: 'section-title' }, 'Tools'),
    loose.length > 0 && h('div', { class: 'card-grid' }, loose.map(toolCard)));

  searchInput(`Search ${tools.length} tools…`, (q, raw) => {
    browse.hidden = !!q;
    resultsWrap.hidden = !q;
    if (!q) return;
    const hits = tools.filter((t) => matches(t, q));
    results.replaceChildren(...(hits.length ? hits.map(toolCard) : [h('p', { class: 'empty' }, `No tools match “${raw}”.`)]));
  });
  el.replaceChildren(browse, resultsWrap);
}

/* ---------- Init ---------- */
renderHeader();
renderFooter();
renderToolHead();
renderGrids();
