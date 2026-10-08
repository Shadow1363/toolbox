/**
 * A small JavaScript regex parser that turns a pattern into a tree, then into plain-English rows.
 * It never decides validity (the browser's RegExp does); it only describes what it reads, so for any
 * pattern RegExp accepts it returns a tree, and on odd input it degrades to "literal" nodes.
 *
 *   const ast = parse('(?<y>\\d{4})-\\d\\d', 'g');
 *   explain(ast, flags) → [{ start, end, text, children? }]     // start/end index into the pattern
 *   ast.groups → [{ n: 1, name: 'y' }]
 */

const CLASS_ESC = {
  d: 'a digit (0–9)', D: 'any character except a digit', w: 'a word character (letter, digit or _)', W: 'any character except a word character',
  s: 'a whitespace character (space, tab, line break…)', S: 'any character except whitespace',
};
const CHAR_ESC = { t: 'tab', n: 'line feed (new line)', r: 'carriage return', f: 'form feed', v: 'vertical tab', 0: 'null character' };
const PROPS = {
  L: 'letter', Letter: 'letter', Lu: 'uppercase letter', Uppercase_Letter: 'uppercase letter', Ll: 'lowercase letter', Lowercase_Letter: 'lowercase letter',
  Lt: 'titlecase letter', Lm: 'modifier letter', Lo: 'other letter', M: 'combining mark', Mark: 'combining mark', N: 'number', Number: 'number',
  Nd: 'decimal digit', Decimal_Number: 'decimal digit', Nl: 'letter number', No: 'other number', P: 'punctuation', Punctuation: 'punctuation',
  S: 'symbol', Symbol: 'symbol', Sc: 'currency symbol', Sm: 'math symbol', Z: 'separator', Zs: 'space separator', C: 'control or other', Cc: 'control character',
  Emoji: 'emoji', Emoji_Presentation: 'emoji shown as a picture', Extended_Pictographic: 'pictographic symbol (emoji and similar)',
  Alphabetic: 'alphabetic character', White_Space: 'whitespace', Uppercase: 'uppercase character', Lowercase: 'lowercase character', ASCII: 'ASCII character', Any: 'any code point',
};
const FLAG_TEXT = {
  d: 'indices: report where each group starts and ends', g: 'global: find every match, not just the first', i: 'ignore case: A matches a',
  m: 'multiline: ^ and $ match at the start and end of each line', s: 'dotAll: . also matches line breaks',
  u: 'unicode: work with whole code points and allow \\p{…}', v: 'unicode sets: like u, plus set operations in classes',
  y: 'sticky: each match must start exactly where the previous one ended',
};

export const flagDescriptions = (flags) => [...flags].filter((f) => FLAG_TEXT[f]).map((f) => ({ flag: f, text: FLAG_TEXT[f] }));

export function parse(src, flags = '') {
  const unicode = /[uv]/.test(flags);
  let i = 0;
  let groupCount = 0;
  const groups = [];

  const peek = (o = 0) => src[i + o];
  const eat = (s) => (src.startsWith(s, i) ? ((i += s.length), true) : false);

  let depth = 0; // open groups; a ")" at depth 0 is invalid (RegExp reports it) and is read as a literal

  function disjunction() {
    const start = i;
    const options = [sequence()];
    while (peek() === '|') { i++; options.push(sequence()); }
    return options.length === 1 ? options[0] : { type: 'alt', options, start, end: i };
  }

  function sequence() {
    const start = i;
    const items = [];
    while (i < src.length && peek() !== '|' && !(peek() === ')' && depth > 0)) {
      items.push(quantifier(term()));
    }
    return { type: 'seq', items, start, end: i };
  }

  function quantifier(atom) {
    const start = atom.start;
    let min, max;
    const c = peek();
    if (c === '*') { i++; min = 0; max = Infinity; }
    else if (c === '+') { i++; min = 1; max = Infinity; }
    else if (c === '?') { i++; min = 0; max = 1; }
    else if (c === '{') {
      const m = /^\{(\d+)(,(\d*))?\}/.exec(src.slice(i));
      if (!m) return atom;
      i += m[0].length;
      min = +m[1];
      max = m[2] ? (m[3] === '' ? Infinity : +m[3]) : min;
    } else return atom;
    const lazy = eat('?');
    return { type: 'quant', min, max, lazy, target: atom, start, end: i };
  }

  function term() {
    const start = i;
    const c = src[i++];
    if (c === '^' || c === '$') return { type: 'anchor', value: c, start, end: i };
    if (c === '.') return { type: 'dot', start, end: i };
    if (c === '(') return group(start);
    if (c === '[') return charClass(start);
    if (c === '\\') return escape(start, false);
    return { type: 'char', value: c, start, end: i };
  }

  function group(start) {
    let kind = 'capture';
    let name = null;
    let mods = null;
    if (eat('?:')) kind = 'noncap';
    else if (eat('?=')) kind = 'lookahead';
    else if (eat('?!')) kind = 'neglookahead';
    else if (eat('?<=')) kind = 'lookbehind';
    else if (eat('?<!')) kind = 'neglookbehind';
    else if (peek() === '?' && peek(1) === '<') {
      const m = /^\?<([^>]*)>/.exec(src.slice(i));
      if (m) { i += m[0].length; kind = 'named'; name = m[1]; }
    } else if (peek() === '?') {
      const m = /^\?([imsx]*)(?:-([imsx]*))?:/.exec(src.slice(i));
      if (m) { i += m[0].length; kind = 'modifiers'; mods = { on: m[1], off: m[2] || '' }; }
    }
    let n = null;
    if (kind === 'capture' || kind === 'named') { n = ++groupCount; groups.push({ n, name }); }
    depth++;
    const body = disjunction();
    depth--;
    eat(')');
    return { type: 'group', kind, n, name, mods, body, start, end: i };
  }

  function charClass(start) {
    const negated = eat('^');
    const items = [];
    while (i < src.length && peek() !== ']') {
      const a = classAtom();
      if (peek() === '-' && peek(1) !== ']' && peek(1) !== undefined && a.type === 'char') {
        const save = i;
        i++;
        const b = classAtom();
        if (b.type === 'char') { items.push({ type: 'range', from: a, to: b, start: a.start, end: b.end }); continue; }
        i = save;
      }
      items.push(a);
    }
    eat(']');
    return { type: 'class', negated, items, start, end: i };
  }

  function classAtom() {
    const start = i;
    if (src[i] === '\\') { i++; return escape(start, true); }
    if (flags.includes('v') && src[i] === '[') { // nested class in v mode
      i++;
      return charClass(start);
    }
    const ch = codePointAt(i);
    i += ch.length;
    return { type: 'char', value: ch, start, end: i };
  }

  function codePointAt(at) {
    const cp = src.codePointAt(at);
    return cp === undefined ? '' : String.fromCodePoint(cp);
  }

  function escape(start, inClass) {
    const c = src[i++];
    if (c === undefined) return { type: 'char', value: '\\', start, end: i };
    if (CLASS_ESC[c]) return { type: 'esc', kind: c, start, end: i };
    if (!inClass && (c === 'b' || c === 'B')) return { type: 'anchor', value: `\\${c}`, start, end: i };
    if (inClass && c === 'b') return { type: 'char', value: '\b', named: 'backspace', start, end: i };
    if (CHAR_ESC[c] && !(c === '0' && /\d/.test(peek() || ''))) return { type: 'char', value: { t: '\t', n: '\n', r: '\r', f: '\f', v: '\v', 0: '\0' }[c], named: CHAR_ESC[c], start, end: i };
    if (c === 'x' && /^[\da-f]{2}/i.test(src.slice(i))) { const v = String.fromCharCode(parseInt(src.substr(i, 2), 16)); i += 2; return { type: 'char', value: v, code: true, start, end: i }; }
    if (c === 'u') {
      let m = /^\{([\da-f]+)\}/i.exec(src.slice(i));
      if (m && unicode) { i += m[0].length; return { type: 'char', value: safeCp(parseInt(m[1], 16)), code: true, start, end: i }; }
      m = /^[\da-f]{4}/i.exec(src.slice(i));
      if (m) { i += 4; return { type: 'char', value: String.fromCharCode(parseInt(m[0], 16)), code: true, start, end: i }; }
    }
    if (c === 'c' && /[a-z]/i.test(peek() || '')) { const l = src[i++].toUpperCase(); return { type: 'char', value: String.fromCharCode(l.charCodeAt(0) % 32), named: `control character Ctrl+${l}`, start, end: i }; }
    if ((c === 'p' || c === 'P') && peek() === '{' && unicode) {
      const close = src.indexOf('}', i);
      if (close > 0) { const prop = src.slice(i + 1, close); i = close + 1; return { type: 'prop', negated: c === 'P', prop, start, end: i }; }
    }
    if (!inClass && c === 'k' && peek() === '<') {
      const close = src.indexOf('>', i);
      if (close > 0) { const name = src.slice(i + 1, close); i = close + 1; return { type: 'backref', name, start, end: i }; }
    }
    if (!inClass && /[1-9]/.test(c)) {
      const m = /^\d*/.exec(src.slice(i));
      i += m[0].length;
      return { type: 'backref', n: +(c + m[0]), start, end: i };
    }
    // Identity escape: \. \* \/ \\ …
    i--;
    const ch = codePointAt(i);
    i += ch.length;
    return { type: 'char', value: ch, escaped: true, start, end: i };
  }

  const safeCp = (n) => { try { return String.fromCodePoint(n); } catch { return '�'; } };

  const tree = disjunction();
  tree.groups = groups;
  return tree;
}

/* ---------- Plain English ---------- */

const show = (ch) => {
  if (ch === ' ') return 'a space';
  const cp = ch.codePointAt(0);
  if (cp < 32 || cp === 127) return `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`;
  return `“${ch}”`;
};
const charText = (n) => (n.named ? `a ${n.named}`.replace(/^a ([aeiou])/, 'an $1') : n.code ? `the character ${show(n.value)} (U+${n.value.codePointAt(0).toString(16).toUpperCase().padStart(4, '0')})` : show(n.value));

function times({ min, max, lazy }) {
  let t;
  if (min === 0 && max === Infinity) t = 'zero or more times';
  else if (min === 1 && max === Infinity) t = 'one or more times';
  else if (min === 0 && max === 1) t = 'optionally (zero or one time)';
  else if (min === max) t = `exactly ${min} time${min === 1 ? '' : 's'}`;
  else if (max === Infinity) t = `${min} or more times`;
  else t = `between ${min} and ${max} times`;
  if (min === max) return t;
  return `${t}, ${lazy ? 'as few as possible (lazy)' : 'as many as possible'}`;
}

function classItemText(n) {
  if (n.type === 'range') return `${short(n.from)}–${short(n.to)}`;
  if (n.type === 'esc') return CLASS_ESC[n.kind];
  if (n.type === 'prop') return propText(n);
  if (n.type === 'class') return `[${n.negated ? 'not ' : ''}${n.items.map(classItemText).join(', ')}]`;
  return charText(n);
}
const short = (n) => (n.named || n.code || n.value.codePointAt(0) < 33 ? charText(n) : n.value);

function propText(n) {
  const [k, v] = n.prop.split('=');
  const what = v ? `${k === 'Script' || k === 'sc' || k === 'Script_Extensions' || k === 'scx' ? 'in the' : `with ${k} =`} ${v.replace(/_/g, ' ')}${k.startsWith('Script') || k === 'sc' || k === 'scx' ? ' script' : ''}` : PROPS[k] ? `a ${PROPS[k]}` : `with the Unicode property ${k}`;
  return `${n.negated ? 'any character that is not ' : ''}${v ? `a character ${what}` : what.startsWith('a ') ? what : `a character ${what}`}`;
}

const GROUP_TEXT = {
  capture: (n) => `Capturing group #${n.n}`,
  named: (n) => `Named group “${n.name}” (#${n.n})`,
  noncap: () => 'Group (not captured)',
  lookahead: () => 'Lookahead: must be followed by (not included in the match)',
  neglookahead: () => 'Negative lookahead: must NOT be followed by',
  lookbehind: () => 'Lookbehind: must be preceded by (not included in the match)',
  neglookbehind: () => 'Negative lookbehind: must NOT be preceded by',
  modifiers: (n) => `Group with flags ${[n.mods.on && `on: ${n.mods.on}`, n.mods.off && `off: ${n.mods.off}`].filter(Boolean).join(', ')}`,
};

/** → [{ start, end, text, children? }] */
export function explain(node, flags = '') {
  const multiline = flags.includes('m');
  const dotAll = flags.includes('s');
  const groupNames = new Map((node.groups || []).map((g) => [g.n, g.name]));

  function seqRows(seq) {
    const rows = [];
    let run = null; // merge consecutive plain characters into one literal row
    for (const item of seq.items) {
      if (item.type === 'char' && !item.named && !item.code) {
        if (run) { run.chars += item.value; run.end = item.end; continue; }
        run = { start: item.start, end: item.end, chars: item.value };
        rows.push(run);
        continue;
      }
      run = null;
      rows.push(one(item));
    }
    return rows.map((r) => ('chars' in r ? { start: r.start, end: r.end, text: r.chars.length === 1 ? `The character ${show(r.chars)}` : `The text “${r.chars}”` } : r));
  }

  function one(n) {
    switch (n.type) {
      case 'seq': return n.items.length ? { start: n.start, end: n.end, text: 'In order:', children: seqRows(n) } : { start: n.start, end: n.end, text: 'Nothing (matches an empty string)' };
      case 'alt': return {
        start: n.start, end: n.end, text: `Either of ${n.options.length} alternatives:`,
        children: n.options.map((o, k) => {
          const rows = seqRows(o);
          return rows.length === 1 ? { ...rows[0], text: `Option ${k + 1}: ${lower(rows[0].text)}`, start: o.start, end: o.end }
            : { start: o.start, end: o.end, text: rows.length ? `Option ${k + 1}:` : `Option ${k + 1}: nothing (empty)`, children: rows };
        }),
      };
      case 'quant': {
        const inner = one(n.target);
        return { ...inner, start: n.start, end: n.end, text: `${inner.text.replace(/:$/, '')}, ${times(n)}${inner.children ? ':' : ''}` };
      }
      case 'char': return { start: n.start, end: n.end, text: cap(charText(n)) };
      case 'dot': return { start: n.start, end: n.end, text: dotAll ? 'Any character, including line breaks' : 'Any character except a line break' };
      case 'anchor': return {
        start: n.start, end: n.end,
        text: { '^': multiline ? 'Start of a line' : 'Start of the text', $: multiline ? 'End of a line' : 'End of the text', '\\b': 'Word boundary (between a word character and a non-word character)', '\\B': 'Not at a word boundary' }[n.value],
      };
      case 'esc': return { start: n.start, end: n.end, text: cap(CLASS_ESC[n.kind]) };
      case 'prop': return { start: n.start, end: n.end, text: cap(propText(n)) };
      case 'backref': return { start: n.start, end: n.end, text: n.name ? `The same text that group “${n.name}” matched` : `The same text that group #${n.n}${groupNames.get(n.n) ? ` (“${groupNames.get(n.n)}”)` : ''} matched` };
      case 'class': {
        const parts = n.items.map(classItemText);
        return { start: n.start, end: n.end, text: n.items.length ? `${n.negated ? 'Any one character except' : 'One character from'}: ${parts.join(', ')}` : n.negated ? 'Any character (empty negated class)' : 'Nothing (an empty class never matches)' };
      }
      case 'group': {
        const body = n.body.type === 'seq' ? seqRows(n.body) : [one(n.body)];
        return { start: n.start, end: n.end, text: `${GROUP_TEXT[n.kind](n)}:`, children: body.length ? body : [{ start: n.body.start, end: n.body.end, text: 'Nothing (empty)' }] };
      }
      default: return { start: n.start, end: n.end, text: 'Unknown token' };
    }
  }
  if (node.type === 'seq') return seqRows(node);
  return [one(node)];
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const lower = (s) => (/^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s);
