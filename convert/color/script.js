/* Color converter: any CSS color → HEX, RGB, HSL, OKLCH, with a picker, opacity, preview and WCAG contrast. */
import { h, icon, store } from '/assets/js/lib/dom.js';
import { copyText } from '/assets/js/lib/text-tool.js';

const input = document.getElementById('input');
const picker = document.getElementById('picker');
const alpha = document.getElementById('alpha');
const statusEl = document.getElementById('status');

/* ---------- Colour math (r, g, b in 0..1, sRGB) ---------- */
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

/** sRGB → OKLCH (Björn Ottosson's OKLab matrices). */
function rgbToOklch([r, g, b]) {
  [r, g, b] = [r, g, b].map(toLinear);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360];
}
/** OKLCH → sRGB; `clipped` is true when the colour was outside sRGB and had to be clamped. */
function oklchToRgb([L, C, H]) {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s];
  const rgb = lin.map(toGamma);
  return { rgb: rgb.map(clamp01), clipped: rgb.some((v) => v < -0.0005 || v > 1.0005) };
}
function rgbToHsl([r, g, b]) {
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2, d = max - min;
  if (!d) return [0, 0, l];
  const s = d / (1 - Math.abs(2 * l - 1));
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [(h * 60 + 360) % 360, s, l];
}
function hslToRgb([h, s, l]) {
  const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
  return [0, 8, 4].map((n) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1)));
}
const luminance = (rgb) => { const [r, g, b] = rgb.map(toLinear); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ---------- Parsing ---------- */
const num = (v, scale = 1) => (String(v).trim().endsWith('%') ? parseFloat(v) / 100 : parseFloat(v) / scale);
const parts = (inner) => inner.replace(/,/g, ' ').replace(/\//g, ' / ').trim().split(/\s+/).filter((x) => x && x !== '/');

/** Parse a CSS colour → { rgb: [0..1]×3, a: 0..1, clipped? } or null. */
function parse(text) {
  const t = text.trim().toLowerCase();
  let m = /^#?([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(t);
  if (m) {
    let hx = m[1];
    if (hx.length <= 4) hx = [...hx].map((c) => c + c).join('');
    const v = hx.match(/../g).map((x) => parseInt(x, 16) / 255);
    return { rgb: v.slice(0, 3), a: v[3] ?? 1 };
  }
  m = /^(rgba?|hsla?|oklch)\((.*)\)$/.exec(t);
  if (m) {
    const p = parts(m[2]);
    if (p.length < 3) return null;
    const a = p[3] != null ? clamp01(num(p[3])) : 1;
    if (m[1].startsWith('rgb')) return { rgb: p.slice(0, 3).map((v) => clamp01(num(v, 255))), a };
    if (m[1].startsWith('hsl')) return { rgb: hslToRgb([parseFloat(p[0]), clamp01(num(p[1], 100)), clamp01(num(p[2], 100))]), a };
    const L = p[0].endsWith('%') ? parseFloat(p[0]) / 100 : parseFloat(p[0]);
    const C = p[1].endsWith('%') ? (parseFloat(p[1]) / 100) * 0.4 : parseFloat(p[1]);
    const r = oklchToRgb([L, C, parseFloat(p[2]) || 0]);
    return { rgb: r.rgb, a, clipped: r.clipped };
  }
  // Names and anything else the browser understands (e.g. "rebeccapurple", lab(), color()).
  if (!CSS.supports('color', t)) return null;
  const probe = document.body.appendChild(h('span', { style: `color:${t};display:none` }));
  const computed = getComputedStyle(probe).color;
  probe.remove();
  return computed.startsWith('rgb') ? parse(computed) : null;
}

/* ---------- Formatting ---------- */
const r1 = (v, d = 1) => +v.toFixed(d);
const hex2 = (v) => Math.round(v * 255).toString(16).padStart(2, '0');
function formats({ rgb, a }) {
  const [R, G, B] = rgb.map((v) => Math.round(v * 255));
  const [hh, s, l] = rgbToHsl(rgb);
  const [L, C, H] = rgbToOklch(rgb);
  const al = a < 1 ? ` / ${r1(a * 100, 0)}%` : '';
  const out = [
    ['HEX', `#${rgb.map(hex2).join('')}${a < 1 ? hex2(a) : ''}`],
    ['RGB', `rgb(${R} ${G} ${B}${al})`],
    ['RGB (legacy)', a < 1 ? `rgba(${R}, ${G}, ${B}, ${r1(a, 2)})` : `rgb(${R}, ${G}, ${B})`],
    ['HSL', `hsl(${r1(hh)} ${r1(s * 100)}% ${r1(l * 100)}%${al})`],
    ['OKLCH', `oklch(${r1(L * 100, 2)}% ${r1(C, 4)} ${C < 0.0001 ? 0 : r1(H, 2)}${al})`],
  ];
  return out;
}

/* ---------- UI ---------- */
let current = null;
function update(text, { fromPicker = false } = {}) {
  const c = parse(text);
  if (!c) { status(text.trim() ? 'Not a color this tool understands.' : 'Type a color.', 'error'); return; }
  if (fromPicker) c.a = alpha.value / 100;
  else if (!/[\/,]\s*[\d.]+%?\s*\)$|^#?([0-9a-f]{4}|[0-9a-f]{8})$/i.test(text.trim())) c.a = alpha.value / 100; // keep the slider's opacity
  current = c;
  alpha.value = Math.round(c.a * 100);
  document.getElementById('alpha-value').textContent = `${alpha.value}%`;
  picker.value = `#${c.rgb.map(hex2).join('')}`;
  status(c.clipped ? 'This OKLCH color is outside sRGB; the closest displayable color is shown.' : 'Valid color', c.clipped ? 'error' : 'ok');
  render();
  store.set('color:last', text.trim());
}

function render() {
  const rows = formats(current);
  document.getElementById('swatch').style.background = rows[1][1];
  document.getElementById('rows').replaceChildren(...rows.map(([label, value]) => h('div', { class: 'io-row' },
    h('span', {}, label), h('code', {}, value),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Copy ${label}`, html: icon('copy'), onclick: () => copyText(value, `${label} copied`) }))));
  // Contrast is measured for the opaque colour (opacity depends on what's behind it).
  const box = (bg, fg, label) => {
    const ratio = contrast(current.rgb, bg === 'self' ? fg : bg);
    const grade = ratio >= 7 ? 'AAA' : ratio >= 4.5 ? 'AA' : ratio >= 3 ? 'AA large' : 'Fail';
    const swatch = `#${current.rgb.map(hex2).join('')}`;
    return h('div', { style: bg === 'self' ? `background:${swatch};color:${fg === BLACK ? '#000' : '#fff'}` : `background:${bg === WHITE ? '#fff' : '#000'};color:${swatch}` },
      h('span', {}, label), h('strong', {}, `${ratio.toFixed(2)} : 1`), h('span', { class: 'badge' }, grade));
  };
  const WHITE = [1, 1, 1], BLACK = [0, 0, 0];
  document.getElementById('contrast').replaceChildren(
    box(WHITE, null, 'On white'), box(BLACK, null, 'On black'),
    box('self', WHITE, 'White text'), box('self', BLACK, 'Black text'));
}

function status(text, kind) {
  statusEl.className = `io-status is-${kind}`;
  statusEl.innerHTML = kind === 'ok' ? icon('check') : icon('alert');
  statusEl.append(text);
}

input.addEventListener('input', () => update(input.value));
picker.addEventListener('input', () => { input.value = picker.value; update(picker.value, { fromPicker: true }); });
alpha.addEventListener('input', () => {
  if (!current) return;
  current.a = alpha.value / 100;
  document.getElementById('alpha-value').textContent = `${alpha.value}%`;
  render();
});

input.value = store.get('color:last', '#3366ff');
update(input.value);
