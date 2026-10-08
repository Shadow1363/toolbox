/**
 * Page generator for Text Match Cut.
 *
 * buildPage(template, seed, keyword, contextText) → {
 *   bg, ops: [...draw operations in page units...],
 *   key: { x, y, w, size, ascent, descent },   // where the keyword landed (y = baseline)
 *   surface: 'paper' | 'aged' | 'screen',
 * }
 *
 * Every template lays out real text with ctx.measureText, inserts the keyword exactly once
 * as a single unbreakable token, and records its rectangle. The renderer then moves the
 * page so that rectangle sits in the middle of the frame.
 * All site and publication names are made up.
 */
import { rng } from '/assets/js/lib/random.js';
import { fontString } from '/assets/js/lib/fonts.js';
import { KEY, LANGS } from './lang.js';

export const TEMPLATES = [
  ['newspaper', 'Newspaper'],
  ['wiki', 'Encyclopedia'],
  ['blog', 'Blog post'],
  ['search', 'Search results'],
  ['book', 'Old book'],
  ['magazine', 'Magazine'],
];

/* ---------- Random helpers ---------- */
const pick = (r, list) => list[Math.floor(r() * list.length)];
const between = (r, a, b) => a + r() * (b - a);
const int = (r, a, b) => Math.floor(between(r, a, b + 1));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* ---------- Filler text and page labels come from lang.js (L) ---------- */

/**
 * Text source for one page: user context sentences first (if any), then generated filler.
 * Sentences containing the keyword are used for the keyword sentence.
 */
function textSource(r, keyword, context, L) {
  const userSentences = (context || '').split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter(Boolean);
  const lower = keyword.toLowerCase();
  const withKey = [], without = [];
  for (const s of userSentences) {
    const i = s.toLowerCase().indexOf(lower);
    if (i >= 0) withKey.push(s.slice(0, i) + KEY + s.slice(i + keyword.length));
    else without.push(s);
  }
  return {
    L,
    sentence: () => (without.length && r() < 0.5 ? pick(r, without) : pick(r, L.sentences)(r)),
    keySentence: () => (withKey.length ? pick(r, withKey) : pick(r, L.keySentences)(r)),
    paragraph(n, withKeyword = false) {
      const out = [];
      for (let i = 0; i < n; i++) out.push(this.sentence());
      if (withKeyword) out.splice(Math.floor(r() * (n + 1)), 0, this.keySentence());
      return out.join(' ');
    },
    title: (withKeyword) => (withKeyword ? pick(r, L.keyTitles) : pick(r, L.otherTitles)),
  };
}

/* ---------- Measuring & flowing text ---------- */
const mctx = document.createElement('canvas').getContext('2d');
const widthCache = new Map();
function measure(font, text) {
  const k = `${font}|${text}`;
  let w = widthCache.get(k);
  if (w === undefined) {
    mctx.font = font;
    w = mctx.measureText(text).width;
    if (widthCache.size > 20000) widthCache.clear();
    widthCache.set(k, w);
  }
  return w;
}

/** Call after web fonts load: cached widths were measured with fallback fonts. */
export function resetMeasurements() { widthCache.clear(); }

/** Split a string into tokens; the KEY placeholder becomes one unbreakable keyword token. */
function tokenize(str, keyword) {
  const tokens = [];
  for (const part of str.split(/\s+/).filter(Boolean)) {
    if (!part.includes(KEY)) { tokens.push({ text: part }); continue; }
    const [before, after] = part.split(KEY);
    if (before) tokens.push({ text: before });
    tokens.push({ text: keyword, key: true, glue: !!before });
    if (after) tokens.push({ text: after, glue: true });
  }
  return tokens;
}

/**
 * Flow tokens into lines and push text ops.
 * o: { x, y, width, family, weight, size, lineH, color, justify, indent, align, italic, keyStyle, linkRate, linkColor, inkJitter }
 * Returns { y: next baseline, key: rect|null }.
 */
function flow(page, r, str, o) {
  const font = fontString(o.family, o.weight || 400, o.size, o.italic);
  const keyFont = o.keyStyle?.weight ? fontString(o.family, o.keyStyle.weight, o.size, o.italic) : font;
  const tokens = tokenize(str, page.keyword);
  // Group tokens glued together (keyword + punctuation) so a line never breaks inside them.
  const groups = [];
  for (const t of tokens) {
    t.font = t.key ? keyFont : font;
    t.w = measure(t.font, t.text);
    if (t.glue && groups.length) groups[groups.length - 1].push(t);
    else groups.push([t]);
  }
  const space = measure(font, ' ');
  const gw = (g) => g.reduce((s, t) => s + t.w, 0);

  const lines = [];
  let line = [], lw = 0, avail = o.width - (o.indent || 0);
  for (const g of groups) {
    const w = gw(g);
    if (line.length && lw + space + w > avail) {
      lines.push({ groups: line, w: lw, avail });
      line = []; lw = 0; avail = o.width;
    }
    lw += (line.length ? space : 0) + w;
    line.push(g);
  }
  if (line.length) lines.push({ groups: line, w: lw, avail, last: true });

  let y = o.y, key = null;
  lines.forEach((ln, li) => {
    const startX = o.x + (li === 0 ? o.indent || 0 : 0);
    let extra = 0;
    if (o.justify && !ln.last && ln.groups.length > 1) extra = (ln.avail - ln.w) / (ln.groups.length - 1);
    let x = startX;
    if (o.align === 'center') x = o.x + (o.width - ln.w) / 2;
    if (o.align === 'right') x = o.x + o.width - ln.w;
    for (const g of ln.groups) {
      for (const t of g) {
        const link = !t.key && o.linkRate && r() < o.linkRate;
        const op = { t: 'text', x, y, s: t.text, f: t.font, c: link ? o.linkColor : o.color };
        if (o.inkJitter) { op.a = between(r, 1 - o.inkJitter, 1); op.y += between(r, -0.6, 0.6); }
        page.ops.push(op);
        if (t.key) {
          page.keyOp = op;
          mctx.font = t.font;
          const m = mctx.measureText(t.text);
          key = { x, y, w: t.w, size: o.size, ascent: m.actualBoundingBoxAscent || o.size * 0.72, descent: m.actualBoundingBoxDescent || o.size * 0.2 };
          page.key = key;
        }
        x += t.w;
      }
      x += space + extra;
    }
    y += o.lineH;
  });
  return { y, key };
}

/* ---------- Op helpers ---------- */
const text = (page, x, y, s, family, weight, size, color, extra = {}) =>
  page.ops.push({ t: 'text', x, y, s, f: fontString(family, weight, size, extra.italic), c: color, ...extra });
const rect = (page, x, y, w, h, c, extra = {}) => page.ops.push({ t: 'rect', x, y, w, h, c, ...extra });
const line = (page, x1, y1, x2, y2, c, w = 1) => page.ops.push({ t: 'line', x1, y1, x2, y2, c, w });
const textWidth = (s, family, weight, size, italic) => measure(fontString(family, weight, size, italic), s);

/* ---------- Templates ---------- */
const SERIFS = ['Georgia', 'Times New Roman', 'Libre Baskerville', 'Merriweather', 'Lora'];
const SANS = ['Arial', 'Verdana', 'Inter', 'Montserrat'];

function newspaper(r, page, txt) {
  const serif = pick(r, SERIFS);
  const PW = 1400, M = 60;
  page.bg = pick(r, ['#f4f1e8', '#efeadd', '#f2eee3', '#e9e4d6', '#f6f3ea']);
  page.surface = 'paper';
  const ink = '#1b1b1b';
  const L = txt.L;
  const name = L.newspaper.name(r);
  const mastFont = pick(r, ['Playfair Display', 'DM Serif Display', 'Libre Baskerville']);
  const mastSize = between(r, 70, 96);
  text(page, (PW - textWidth(name, mastFont, 900, mastSize)) / 2, 130, name, mastFont, 900, mastSize, ink);
  line(page, M, 160, PW - M, 160, ink, 3);
  const dateLine = L.newspaper.dateLine(r);
  text(page, M, 184, dateLine, serif, 400, 15, ink, { ls: 1.5 });
  line(page, M, 196, PW - M, 196, ink, 1);

  const keyInHeadline = r() < 0.3;
  const headSize = between(r, 48, 66);
  let y = flow(page, r, txt.title(keyInHeadline), { x: M, y: 196 + headSize * 1.15, width: PW - M * 2, family: serif, weight: 700, size: headSize, lineH: headSize * 1.08, color: ink }).y;
  y = flow(page, r, txt.sentence(), { x: M, y: y + 6, width: PW - M * 2, family: serif, italic: true, size: 24, lineH: 30, color: '#333' }).y + 10;
  line(page, M, y, PW - M, y, ink, 1);

  const cols = int(r, 3, 5), gap = 26;
  const colW = (PW - M * 2 - gap * (cols - 1)) / cols;
  const size = between(r, 17, 21), lineH = size * between(r, 1.28, 1.42);
  const bottom = 2100;
  const keyCol = Math.floor(cols / 2), keyY = between(r, 700, 1150);
  const top = y + size * 1.6;
  for (let c = 0; c < cols; c++) {
    const x = M + c * (colW + gap);
    if (c) line(page, x - gap / 2, top - size, x - gap / 2, bottom, '#999', 1);
    let cy = top;
    if (c > 0 && r() < 0.5) cy = flow(page, r, txt.title(false), { x, y: cy + 8, width: colW, family: serif, weight: 700, size: 26, lineH: 29, color: ink }).y + 8;
    while (cy < bottom) {
      const needKey = !page.key && !keyInHeadline && c === keyCol && cy >= keyY;
      cy = flow(page, r, txt.paragraph(int(r, 2, 4), needKey), { x, y: cy, width: colW, family: serif, size, lineH, color: ink, justify: true, indent: size * 1.2 }).y;
    }
  }
}

function wiki(r, page, txt) {
  const PW = 1300, M = 70;
  const dark = r() < 0.15;
  page.bg = dark ? '#101418' : pick(r, ['#ffffff', '#fbfbfa', '#f8f9fa']);
  page.surface = 'screen';
  const ink = dark ? '#e6e6e6' : '#202122', muted = dark ? '#9aa0a6' : '#54595d', link = dark ? '#88a9ff' : '#3366cc', rule = dark ? '#3a3f45' : '#a2a9b1';
  const W = txt.L.wiki, L = txt.L;
  const site = pick(r, W.sites);
  const sans = pick(r, ['Arial', 'Verdana', 'Inter']), serif = pick(r, ['Georgia', 'Libre Baskerville', 'Times New Roman']);
  text(page, M, 70, site, serif, 400, 30, ink);
  rect(page, PW - M - 420, 40, 420, 42, dark ? '#1e252c' : '#ffffff', { stroke: rule, r: 4 });
  text(page, PW - M - 405, 68, W.search(site), sans, 400, 16, muted);
  line(page, M, 104, PW - M, 104, rule, 1);
  const keyInTitle = r() < 0.4;
  const crumb = `${W.home} / ${pick(r, W.crumbs)} / ${pick(r, W.subCrumbs)}`;
  text(page, M, 138, crumb, sans, 400, 15, link);
  let y = flow(page, r, keyInTitle ? KEY : txt.title(false), { x: M, y: 196, width: PW - M * 2, family: serif, size: between(r, 38, 48), lineH: 52, color: ink }).y - 30;
  line(page, M, y, PW - M, y, rule, 1);
  text(page, M, y + 26, W.from(site), sans, 400, 14, muted, { italic: true });

  // infobox
  const ibW = 320, ibX = PW - M - ibW, ibY = y + 50;
  const rows = int(r, 5, 8);
  rect(page, ibX, ibY, ibW, 60 + rows * 34, dark ? '#171c21' : '#f8f9fa', { stroke: rule });
  text(page, ibX + 16, ibY + 36, pick(r, W.boxTitles), sans, 700, 18, ink);
  for (let i = 0; i < rows; i++) {
    const ry = ibY + 72 + i * 34;
    text(page, ibX + 16, ry, pick(r, W.boxLabels), sans, 700, 14, ink);
    text(page, ibX + 130, ry, pick(r, L.places) + (r() < 0.5 ? ` (${int(r, 1950, 2023)})` : ''), sans, 400, 14, link);
  }

  const size = between(r, 16, 18.5), lineH = size * between(r, 1.5, 1.7);
  const bodyW = PW - M * 2 - ibW - 30;
  const keyY = between(r, y + 300, y + 700);
  let cy = y + 70;
  const sections = W.sections;
  while (cy < 2100) {
    const w = cy < ibY + 60 + rows * 34 + 20 ? bodyW : PW - M * 2;
    const needKey = !page.key && !keyInTitle && cy >= keyY;
    cy = flow(page, r, txt.paragraph(int(r, 3, 5), needKey), { x: M, y: cy, width: w, family: sans, size, lineH, color: ink, linkRate: 0.07, linkColor: link }).y + size * 0.8;
    if (r() < 0.35) {
      cy += 20;
      text(page, M, cy, pick(r, sections), serif, 400, 28, ink);
      line(page, M, cy + 12, PW - M, cy + 12, rule, 1);
      cy += 50;
    }
  }
}

function blog(r, page, txt) {
  const PW = 1200, colW = 760, X = (PW - colW) / 2;
  page.bg = pick(r, ['#ffffff', '#fffdf9', '#fafafa', '#f7f5f0']);
  page.surface = 'screen';
  const ink = pick(r, ['#1d1d1f', '#222222', '#2b2b2b']), muted = '#6e6e73';
  const sans = pick(r, ['Inter', 'Montserrat', 'Arial']), titleFont = pick(r, ['Montserrat', 'Inter', 'Archivo Black', 'Playfair Display']);
  const bodyFont = pick(r, ['Georgia', 'Inter', 'Merriweather', 'Lora']);
  const L = txt.L;
  const blogName = pick(r, L.blog.names);
  text(page, 60, 70, blogName, sans, 800, 22, ink);
  L.blog.nav.forEach((m, i) => text(page, PW - 540 + i * 100, 70, m, sans, 500, 16, muted));
  line(page, 0, 110, PW, 110, '#e5e5ea', 1);
  text(page, X, 190, pick(r, L.blog.kickers), sans, 700, 14, pick(r, ['#0071e3', '#d6336c', '#2b8a3e', '#e8590c']), { ls: 2 });
  const keyInTitle = r() < 0.4;
  const ts = between(r, 46, 60);
  let y = flow(page, r, txt.title(keyInTitle), { x: X, y: 190 + ts * 1.2, width: colW, family: titleFont, weight: 800, size: ts, lineH: ts * 1.12, color: ink }).y;
  text(page, X, y + 8, L.blog.byline(pick(r, L.names), L.longDate(r), int(r, 3, 14)), sans, 400, 16, muted);
  y += 50;
  const heroH = between(r, 220, 360);
  rect(page, X, y, colW, heroH, pick(r, ['#dfe7f1', '#f1e3d3', '#e3efe6', '#ece4f3', '#f3e9d2']), { r: 10 });
  y += heroH + 60;
  const size = between(r, 19, 21), lineH = size * between(r, 1.65, 1.85);
  const keyY = between(r, y + 150, y + 600);
  while (y < 2100) {
    if (r() < 0.18) { // blockquote
      rect(page, X, y - size, 4, lineH * 3, '#c7c7cc');
      y = flow(page, r, txt.paragraph(2), { x: X + 28, y, width: colW - 28, family: bodyFont, italic: true, size: size * 1.1, lineH: lineH * 1.05, color: '#444' }).y + size;
      continue;
    }
    const needKey = !page.key && !keyInTitle && y >= keyY;
    y = flow(page, r, txt.paragraph(int(r, 2, 4), needKey), { x: X, y, width: colW, family: bodyFont, size, lineH, color: ink }).y + size * 0.9;
  }
}

function search(r, page, txt) {
  const PW = 1300, X = 200, colW = 680;
  const dark = r() < 0.3;
  page.bg = dark ? '#202124' : '#ffffff';
  page.surface = 'screen';
  const ink = dark ? '#e8eaed' : '#202124', muted = dark ? '#9aa0a6' : '#5f6368', titleC = dark ? '#8ab4f8' : '#1a0dab', urlC = dark ? '#bdc1c6' : '#4d5156';
  const sans = pick(r, ['Arial', 'Inter', 'Verdana']);
  const S = txt.L.search, L = txt.L;
  const logo = pick(r, S.logos);
  const colors = ['#4f7cff', '#ff5a5f', '#ffb400', '#4f7cff', '#2bb673', '#ff5a5f', '#ffb400', '#2bb673'];
  let lx = 40;
  for (const [i, ch] of [...logo].entries()) { text(page, lx, 82, ch, sans, 700, 30, colors[i % colors.length]); lx += textWidth(ch, sans, 700, 30); }
  rect(page, X, 44, colW, 52, dark ? '#303134' : '#ffffff', { stroke: dark ? '#5f6368' : '#dfe1e5', r: 26 });
  const keyInBox = r() < 0.2;
  if (keyInBox) flow(page, r, KEY, { x: X + 26, y: 78, width: colW - 60, family: sans, size: 18, lineH: 20, color: ink });
  else text(page, X + 26, 78, page.keyword.toLowerCase() + pick(r, S.querySuffixes), sans, 400, 18, ink);
  S.tabs.forEach((t, i) => text(page, X + i * 90, 140, t, sans, i ? 400 : 700, 15, i ? muted : (dark ? '#8ab4f8' : '#1a73e8')));
  line(page, 0, 160, PW, 160, dark ? '#3c4043' : '#ebebeb', 1);
  text(page, X, 196, S.results(r), sans, 400, 14, muted);
  const domains = S.domains;
  let y = 250;
  const keyResult = keyInBox ? -1 : int(r, 2, 4);
  for (let i = 0; y < 2100; i++) {
    const dom = pick(r, domains);
    text(page, X, y, `www.${dom}${S.tld} › ${pick(r, S.paths)} › ${pick(r, S.subPaths)}`, sans, 400, 14, urlC);
    const inTitle = i === keyResult && r() < 0.45;
    y = flow(page, r, inTitle ? `${KEY} - ${cap(dom.replace(/-/g, ' '))}` : `${txt.title(false)} - ${cap(dom.replace(/-/g, ' '))}`, { x: X, y: y + 34, width: colW, family: sans, size: 21, lineH: 27, color: titleC }).y;
    const snippet = `${L.shortDate(r)} — ${txt.paragraph(1, i === keyResult && !inTitle)} ${txt.sentence()}`;
    y = flow(page, r, snippet, { x: X, y: y + 2, width: colW, family: sans, size: 15, lineH: 23, color: muted, keyStyle: { weight: 700 } }).y + 34;
  }
}

function book(r, page, txt) {
  const PW = 1000, M = 110;
  page.bg = pick(r, ['#efe2c4', '#e9dbb8', '#f1e6cc', '#e6d5b0', '#ede0c6']);
  page.surface = 'aged';
  const ink = pick(r, ['#2b2118', '#231c14', '#33281d']);
  const typewriter = r() < 0.35;
  const family = typewriter ? pick(r, ['Special Elite', 'Courier New']) : pick(r, ['Libre Baskerville', 'Lora', 'Georgia', 'Merriweather']);
  const romans = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const head = r() < 0.5 ? `${txt.L.book.chapter} ${pick(r, romans)}` : pick(r, txt.L.otherTitles).toUpperCase();
  text(page, (PW - textWidth(head, family, 400, 16) - head.length * 3) / 2, 100, head, family, 400, 16, ink, { ls: 3 });
  text(page, PW / 2 - 12, 2150, String(int(r, 12, 340)), family, 400, 16, ink);
  // stains / foxing
  for (let i = 0; i < int(r, 2, 6); i++) page.ops.push({ t: 'stain', x: between(r, 0, PW), y: between(r, 0, 2200), r: between(r, 60, 260), c: 'rgba(120,80,30,0.09)' });
  const size = typewriter ? between(r, 20, 23) : between(r, 22, 26);
  const lineH = size * between(r, 1.45, 1.6);
  let y = 180;
  if (r() < 0.35) y = flow(page, r, txt.title(false), { x: M, y: 210, width: PW - M * 2, family, size: size * 1.6, lineH: size * 2, color: ink, align: 'center' }).y + 30;
  const keyY = between(r, 600, 1200);
  while (y < 2100) {
    const needKey = !page.key && y >= keyY;
    y = flow(page, r, txt.paragraph(int(r, 3, 6), needKey), { x: M, y, width: PW - M * 2, family, size, lineH, color: ink, justify: !typewriter, indent: size * 1.6, inkJitter: typewriter ? 0.35 : 0.18 }).y;
  }
}

function magazine(r, page, txt) {
  const PW = 1300, M = 80;
  page.bg = pick(r, ['#ffffff', '#fdf6ec', '#f3f5ff', '#fff3f3', '#f4f1ea']);
  page.surface = 'paper';
  const accent = pick(r, ['#e63946', '#1d3557', '#2a9d8f', '#e76f51', '#6a4c93', '#0071e3']);
  const ink = '#141414';
  const display = pick(r, ['Anton', 'Archivo Black', 'Bebas Neue', 'Oswald', 'Playfair Display']);
  const serif = pick(r, ['Lora', 'Georgia', 'Libre Baskerville']);
  rect(page, M, 70, 120, 8, accent);
  text(page, M, 120, pick(r, txt.L.magazine.kickers), 'Inter', 800, 18, accent, { ls: 4 });
  const keyIn = r() < 0.5 ? 'title' : r() < 0.4 ? 'quote' : 'body';
  const ts = between(r, 84, 118);
  let y = flow(page, r, txt.title(keyIn === 'title'), { x: M, y: 130 + ts, width: PW - M * 2, family: display, weight: 900, size: ts, lineH: ts * 0.98, color: ink }).y;
  y = flow(page, r, txt.paragraph(1), { x: M, y: y + 10, width: PW * 0.7, family: serif, italic: true, size: 28, lineH: 38, color: '#3a3a3a' }).y + 30;
  text(page, M, y, txt.L.magazine.credits(pick(r, txt.L.names), pick(r, txt.L.names)), 'Inter', 600, 14, '#666', { ls: 1 });
  y += 50;
  const gap = 50, colW = (PW - M * 2 - gap) / 2, size = between(r, 18, 20), lineH = size * 1.55;
  // drop cap
  text(page, M, y + size * 2.6, String.fromCharCode(65 + int(r, 0, 25)), display, 900, size * 4.2, accent);
  const keyY = between(r, y + 300, y + 800);
  for (let c = 0; c < 2; c++) {
    const x = M + c * (colW + gap);
    let cy = y + size;
    while (cy < 2100) {
      if (c === 1 && cy > y + 250 && r() < 0.25 && !page.quoteDone) { // pull quote
        page.quoteDone = true;
        line(page, x, cy - 20, x + colW, cy - 20, accent, 3);
        cy = flow(page, r, `“${keyIn === 'quote' ? txt.keySentence() : txt.sentence()}”`, { x, y: cy + 40, width: colW, family: serif, italic: true, weight: 700, size: 36, lineH: 46, color: accent }).y + 10;
        line(page, x, cy, x + colW, cy, accent, 3);
        cy += 60;
        continue;
      }
      const needKey = !page.key && keyIn === 'body' && c === 0 && cy >= keyY;
      const indentFirst = c === 0 && cy === y + size ? size * 3.2 : 0;
      cy = flow(page, r, txt.paragraph(int(r, 2, 4), needKey), { x, y: cy, width: colW, family: serif, size, lineH, color: ink, indent: indentFirst }).y + size * 0.6;
    }
  }
}

const BUILDERS = { newspaper, wiki, blog, search, book, magazine };

/** Build one page. Deterministic for the same inputs. */
export function buildPage(template, seed, keyword, context, lang = 'en') {
  const r = rng(seed);
  const page = { keyword, ops: [], key: null, bg: '#ffffff', surface: 'paper', template };
  const txt = textSource(r, keyword, context, LANGS[lang] || LANGS.en);
  BUILDERS[template](r, page, txt);
  if (!page.key) {
    // Safety net: if the layout never reached the planned keyword spot, add it at the top.
    flow(page, r, txt.keySentence(), { x: 80, y: 260, width: 900, family: 'Georgia', size: 24, lineH: 34, color: '#1b1b1b' });
  }
  delete page.quoteDone;
  return page;
}

/** Families the templates use, so the page can wait for them to load. */
export const PAGE_FONTS = ['Playfair Display', 'DM Serif Display', 'Libre Baskerville', 'Merriweather', 'Lora', 'Inter', 'Montserrat',
  'Archivo Black', 'Anton', 'Bebas Neue', 'Oswald', 'Special Elite'];
