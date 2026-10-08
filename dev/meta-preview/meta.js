/**
 * Meta tags: read them from pasted HTML (DOMParser builds an inert document: no scripts run, nothing loads),
 * work out what each platform would show (with their fallbacks), check for problems, and write the full tag set.
 */
export const FIELDS = [
  ['title', 'Title'], ['description', 'Description'], ['url', 'Page URL'], ['image', 'Image URL'], ['imageAlt', 'Image alt text'],
  ['siteName', 'Site name'], ['type', 'Type'], ['card', 'X card'], ['twitterSite', 'X account'], ['themeColor', 'Theme color'],
];
export const EMPTY = { title: '', description: '', url: '', image: '', imageAlt: '', siteName: '', type: 'website', card: 'summary_large_image', twitterSite: '', themeColor: '' };

/** Everything we read from the HTML, keyed by tag. */
export function extract(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (key) => {
    for (const el of doc.querySelectorAll('meta')) {
      const k = (el.getAttribute('property') || el.getAttribute('name') || '').trim().toLowerCase();
      if (k === key) return (el.getAttribute('content') || '').trim();
    }
    return '';
  };
  const link = (rel) => [...doc.querySelectorAll('link[rel]')].find((l) => l.getAttribute('rel').toLowerCase().split(/\s+/).includes(rel))?.getAttribute('href')?.trim() || '';
  return {
    title: doc.querySelector('title')?.textContent.trim().replace(/\s+/g, ' ') || '',
    description: meta('description'),
    canonical: link('canonical'),
    icon: link('icon') || link('shortcut') || link('apple-touch-icon'),
    themeColor: meta('theme-color'),
    lang: doc.documentElement.getAttribute('lang') || '',
    og: { title: meta('og:title'), description: meta('og:description'), image: meta('og:image') || meta('og:image:url') || meta('og:image:secure_url'), imageAlt: meta('og:image:alt'),
      imageWidth: meta('og:image:width'), imageHeight: meta('og:image:height'), url: meta('og:url'), siteName: meta('og:site_name'), type: meta('og:type') },
    tw: { card: meta('twitter:card'), title: meta('twitter:title'), description: meta('twitter:description'), image: meta('twitter:image') || meta('twitter:image:src'), site: meta('twitter:site') },
  };
}

/** Flat field values from an extraction (to prefill the form), with the usual fallbacks. */
export function toFields(x) {
  return {
    title: x.og.title || x.title, description: x.og.description || x.description, url: x.og.url || x.canonical, image: x.og.image || x.tw.image,
    imageAlt: x.og.imageAlt, siteName: x.og.siteName, type: x.og.type || 'website', card: x.tw.card || 'summary_large_image', twitterSite: x.tw.site, themeColor: x.themeColor,
  };
}
/** The same shape `extract` returns, built from the form. */
export function fromFields(f) {
  return {
    title: f.title, description: f.description, canonical: f.url, icon: '', themeColor: f.themeColor, lang: '',
    og: { title: f.title, description: f.description, image: f.image, imageAlt: f.imageAlt, imageWidth: '', imageHeight: '', url: f.url, siteName: f.siteName, type: f.type },
    tw: { card: f.card, title: '', description: '', image: '', site: f.twitterSite },
  };
}

export function absolute(u, base) {
  if (!u) return '';
  try { return new URL(u, base || undefined).href; } catch { return ''; }
}

/** What each surface shows, following the platforms' fallback order. */
export function resolve(x) {
  const base = x.og.url || x.canonical || '';
  const url = absolute(base) || '';
  let host = '';
  try { host = url ? new URL(url).hostname.replace(/^www\./, '') : ''; } catch { /* ignore */ }
  const ogImage = absolute(x.og.image, base);
  return {
    url, host, base,
    siteName: x.og.siteName || host,
    icon: absolute(x.icon, base) || (url ? absolute('/favicon.ico', url) : ''),
    themeColor: x.themeColor,
    google: { title: x.title || x.og.title, description: x.description || x.og.description },
    og: { title: x.og.title || x.title, description: x.og.description || x.description, image: ogImage, alt: x.og.imageAlt },
    x: { card: x.tw.card || (ogImage || x.tw.image ? 'summary' : ''), title: x.tw.title || x.og.title || x.title, description: x.tw.description || x.og.description || x.description,
      image: absolute(x.tw.image, base) || ogImage },
    rawImage: x.og.image || x.tw.image,
  };
}

let ctx;
/** Width in px of `text` in Google's result title font (about 20px Arial). */
export function textWidth(text, font = '20px Arial') {
  ctx ||= document.createElement('canvas').getContext('2d');
  ctx.font = font;
  return ctx.measureText(text).width;
}

/**
 * → [{ level: 'error' | 'warn' | 'ok' | 'info', text }]
 * `img` is { width, height } after the image loaded, { failed: true } if it didn't, or null while loading.
 */
export function check(x, r, img) {
  const out = [];
  const add = (level, text) => out.push({ level, text });
  const title = r.google.title;
  if (!x.title) add(x.og.title ? 'warn' : 'error', x.og.title ? 'No <title> tag. Search engines may use og:title, but add a real <title>.' : 'No title. Add a <title> and og:title.');
  else {
    const w = textWidth(title);
    if (w > 580) add('warn', `The title is about ${Math.round(w)} px wide; Google cuts it at roughly 580 px (${title.length} characters). Aim for 50–60 characters.`);
    else if (title.length < 15) add('warn', `The title is very short (${title.length} characters). Describe the page in 30–60 characters.`);
    else add('ok', `Title length is good (${title.length} characters).`);
  }
  const desc = r.google.description;
  if (!x.description) add('warn', 'No meta description. Google will pick text from the page instead.');
  else if (desc.length > 160) add('warn', `The description is ${desc.length} characters; Google shows about 155–160 and X about 200.`);
  else if (desc.length < 50) add('warn', `The description is short (${desc.length} characters). 120–160 characters works best.`);
  else add('ok', `Description length is good (${desc.length} characters).`);
  if (!x.og.title) add('warn', 'No og:title. Social platforms fall back to <title>.');
  if (!x.og.description) add('warn', 'No og:description. Social platforms fall back to the meta description.');
  if (!x.og.url && !x.canonical) add('warn', 'No og:url or canonical link, so shares can’t be tied to one URL (and relative image paths can’t be resolved).');
  else if (!x.canonical) add('info', 'No <link rel="canonical">. Add one so search engines know the preferred URL.');
  if (!x.og.siteName) add('info', 'No og:site_name. Some platforms show the domain instead.');
  if (!x.og.type) add('info', 'No og:type. "website" is assumed; use "article" for posts.');
  if (!x.tw.card) add('warn', 'No twitter:card. X shows a small card at best; add "summary_large_image" for a big image.');
  else if (!['summary', 'summary_large_image', 'app', 'player'].includes(x.tw.card)) add('error', `twitter:card “${x.tw.card}” isn’t a valid card type.`);

  // Image
  if (!r.rawImage) add('error', 'No og:image. Most platforms will show a plain text link without a picture.');
  else if (!r.og.image && !r.x.image) add('error', `The image path “${r.rawImage}” is relative and there’s no og:url to resolve it. Use an absolute https:// URL.`);
  else {
    const src = r.og.image || r.x.image;
    if (/^data:/i.test(r.rawImage)) add('error', 'The image is a data: URI. Crawlers need a real https:// URL.');
    if (!/^[a-z]+:/i.test(r.rawImage)) add('warn', 'The image URL is relative. Some crawlers only accept absolute URLs.');
    if (/^http:/i.test(src)) add('warn', 'The image uses http://. Use https:// or some platforms won’t load it.');
    if (/\.svg(\?|#|$)/i.test(src)) add('error', 'SVG images aren’t supported for link previews. Use PNG, JPG or WebP.');
    if (!x.og.imageAlt) add('info', 'No og:image:alt. Describe the image for screen reader users.');
    if (img?.failed) add('warn', 'The image couldn’t be loaded from here, so its size can’t be checked. Make sure the URL is public.');
    else if (img) {
      const { width: w, height: h } = img;
      const ratio = w / h;
      if (w < 200 || h < 200) add('error', `The image is ${w}×${h}. Facebook needs at least 200×200; use 1200×630.`);
      else if (w < 600 || h < 315) add('warn', `The image is ${w}×${h}. Large previews need at least 600×315; 1200×630 is recommended.`);
      if (Math.abs(ratio - 1.91) / 1.91 > 0.12 && w >= 200) add('warn', `The image ratio is ${ratio.toFixed(2)}:1. Large cards are about 1.91:1 (1200×630), so it will be cropped.`);
      if (w >= 600 && Math.abs(ratio - 1.91) / 1.91 <= 0.12) add('ok', `Image size is good (${w}×${h}).`);
    }
  }
  const order = { error: 0, warn: 1, info: 2, ok: 3 };
  return out.sort((a, b) => order[a.level] - order[b.level]);
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The recommended full set of tags. */
export function generate(x, r, img) {
  const t = r.og.title || x.title;
  const d = r.og.description || x.description;
  const lines = [];
  const add = (s) => lines.push(s);
  const meta = (attr, key, val) => val && add(`<meta ${attr}="${key}" content="${esc(val)}">`);
  add('<!-- Primary -->');
  if (x.title || t) add(`<title>${esc(x.title || t)}</title>`);
  meta('name', 'description', x.description || d);
  if (r.url) add(`<link rel="canonical" href="${esc(absolute(x.canonical, r.base) || r.url)}">`);
  meta('name', 'theme-color', x.themeColor);
  add('', '<!-- Open Graph (Facebook, LinkedIn, Slack, Discord…) -->');
  meta('property', 'og:type', x.og.type || 'website');
  meta('property', 'og:url', r.url);
  meta('property', 'og:title', t);
  meta('property', 'og:description', d);
  meta('property', 'og:site_name', x.og.siteName);
  meta('property', 'og:image', r.og.image || r.rawImage);
  if (img?.width) { meta('property', 'og:image:width', String(img.width)); meta('property', 'og:image:height', String(img.height)); }
  meta('property', 'og:image:alt', x.og.imageAlt);
  add('', '<!-- X (Twitter) -->');
  meta('name', 'twitter:card', x.tw.card || ((r.og.image || r.rawImage) ? 'summary_large_image' : 'summary'));
  meta('name', 'twitter:site', x.tw.site && (x.tw.site.startsWith('@') ? x.tw.site : `@${x.tw.site}`));
  meta('name', 'twitter:title', x.tw.title || t);
  meta('name', 'twitter:description', x.tw.description || d);
  meta('name', 'twitter:image', r.x.image || r.rawImage);
  meta('name', 'twitter:image:alt', x.og.imageAlt);
  return `${lines.join('\n')}\n`;
}
