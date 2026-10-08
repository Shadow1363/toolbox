/** Web fonts for text tools, loaded on demand from Google Fonts. */

export const FONTS = [
  { family: 'Inter', spec: 'Inter:wght@400;600;800;900' },
  { family: 'Montserrat', spec: 'Montserrat:wght@400;700;900' },
  { family: 'Anton', spec: 'Anton' },
  { family: 'Bebas Neue', spec: 'Bebas+Neue' },
  { family: 'Archivo Black', spec: 'Archivo+Black' },
  { family: 'Oswald', spec: 'Oswald:wght@400;700' },
  { family: 'Playfair Display', spec: 'Playfair+Display:wght@400;700;900' },
  { family: 'DM Serif Display', spec: 'DM+Serif+Display' },
  { family: 'Merriweather', spec: 'Merriweather:wght@400;700;900' },
  { family: 'Lora', spec: 'Lora:ital,wght@0,400;0,700;1,400' },
  { family: 'Libre Baskerville', spec: 'Libre+Baskerville:wght@400;700' },
  { family: 'Special Elite', spec: 'Special+Elite' },
  { family: 'Permanent Marker', spec: 'Permanent+Marker' },
  { family: 'Pacifico', spec: 'Pacifico' },
  { family: 'Space Mono', spec: 'Space+Mono:wght@400;700' },
  { family: 'Press Start 2P', spec: 'Press+Start+2P' },
  { family: 'VT323', spec: 'VT323' },
  { family: 'Arial', system: true },
  { family: 'Georgia', system: true },
  { family: 'Courier New', system: true },
  { family: 'Impact', system: true },
  { family: 'Times New Roman', system: true },
  { family: 'Verdana', system: true },
];

export const fontOptions = FONTS.map((f) => [f.family, f.family]);
export const weightOptions = [['400', 'Regular'], ['600', 'Semibold'], ['700', 'Bold'], ['900', 'Black']];

let linked = false;
export function loadFontStylesheet() {
  if (linked) return;
  linked = true;
  const families = FONTS.filter((f) => !f.system).map((f) => `family=${f.spec}`).join('&');
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${families}&display=swap`;
  document.head.append(link);
}

export const fontStack = (family) => `"${family}", system-ui, sans-serif`;
export const fontString = (family, weight, size, italic = false) =>
  `${italic ? 'italic ' : ''}${weight} ${Math.round(size)}px ${fontStack(family)}`;

const ready = new Map();
/** Resolves once the font face is usable on canvas. Calls `onLoad` the first time it becomes ready. */
export function ensureFont(family, weight = 400, onLoad) {
  const key = `${family}|${weight}`;
  if (ready.get(key) === true) return Promise.resolve();
  if (!ready.has(key)) {
    loadFontStylesheet();
    const p = document.fonts
      ? document.fonts.load(fontString(family, weight, 48)).then(() => ready.set(key, true)).catch(() => ready.set(key, true))
      : Promise.resolve(ready.set(key, true));
    ready.set(key, p);
  }
  const p = ready.get(key);
  if (onLoad && p instanceof Promise) p.then(onLoad);
  return p instanceof Promise ? p : Promise.resolve();
}
