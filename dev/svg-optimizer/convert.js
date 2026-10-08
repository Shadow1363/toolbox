/* SVG → data URI and SVG → React (JSX) component. Parsing only (DOMParser on image/svg+xml); nothing is rendered or run. */

/** Compact URL-encoded data URI: single quotes inside, only the characters that must be escaped are escaped. */
export function dataUri(svg, base64 = false) {
  if (base64) {
    const bytes = new TextEncoder().encode(svg);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return `data:image/svg+xml;base64,${btoa(bin)}`;
  }
  const body = svg.trim().replace(/\s+/g, ' ').replace(/"/g, "'")
    .replace(/[\r\n%#()<>?[\\\]^`{|}]/g, encodeURIComponent);
  return `data:image/svg+xml,${body}`;
}

/** "my-icon (2).svg" → "MyIcon2" */
export function componentName(file) {
  const base = file.replace(/\.svg$/i, '').replace(/[^a-z0-9]+/gi, ' ').trim();
  const name = base.split(' ').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('') || 'Icon';
  return /^\d/.test(name) ? `Svg${name}` : name;
}

const RENAME = { class: 'className', for: 'htmlFor', 'xlink:href': 'xlinkHref', 'xml:space': 'xmlSpace', 'xml:lang': 'xmlLang', 'xmlns:xlink': 'xmlnsXlink', tabindex: 'tabIndex' };
const camel = (s) => s.replace(/[-:]([a-z])/g, (_, c) => c.toUpperCase());
const attrName = (n) => RENAME[n] || (/^(data|aria)-/.test(n) ? n : camel(n));

function styleObject(css) {
  const pairs = css.split(';').map((d) => d.trim()).filter(Boolean).map((d) => {
    const i = d.indexOf(':');
    if (i < 0) return null;
    const prop = d.slice(0, i).trim();
    const key = prop.startsWith('--') ? JSON.stringify(prop) : camel(prop.replace(/^-ms-/, 'ms-'));
    return `${key}: ${JSON.stringify(d.slice(i + 1).trim())}`;
  }).filter(Boolean);
  return `{{ ${pairs.join(', ')} }}`;
}

const jsxText = (t) => t.replace(/[{}<>]/g, (c) => `{'${c}'}`);

export function toJsx(svg, name) {
  const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('This SVG isn’t valid XML, so it can’t be turned into JSX.');
  const lines = [];
  const walk = (el, depth, isRoot) => {
    const pad = '  '.repeat(depth);
    const attrs = [...el.attributes]
      .filter((a) => !(isRoot && a.name === 'xmlns:xlink' && !svg.includes('xlink:')))
      .map((a) => (a.name === 'style' ? `style=${styleObject(a.value)}` : `${attrName(a.name)}=${JSON.stringify(a.value)}`));
    if (isRoot) attrs.push('{...props}');
    const open = `${pad}<${el.tagName}${attrs.length ? ` ${attrs.join(' ')}` : ''}`;
    const kids = [...el.childNodes].filter((n) => n.nodeType === 1 || ((n.nodeType === 3 || n.nodeType === 4) && n.textContent.trim()));
    if (!kids.length) { lines.push(`${open} />`); return; }
    if (kids.length === 1 && kids[0].nodeType !== 1 && el.tagName !== 'style') {
      lines.push(`${open}>${jsxText(kids[0].textContent.trim())}</${el.tagName}>`);
      return;
    }
    lines.push(`${open}>`);
    for (const k of kids) {
      if (k.nodeType === 1) walk(k, depth + 1, false);
      else if (el.tagName === 'style') lines.push(`${pad}  {\`${k.textContent.trim().replace(/[`\\]/g, '\\$&').replace(/\$\{/g, '\\${')}\`}`);
      else lines.push(`${pad}  ${jsxText(k.textContent.trim())}`);
    }
    lines.push(`${pad}</${el.tagName}>`);
  };
  walk(doc.documentElement, 1, true);
  return `const ${name} = (props) => (\n${lines.join('\n')}\n);\n\nexport default ${name};\n`;
}
