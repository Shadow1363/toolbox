/**
 * JSON value → TypeScript declarations. Arrays of objects merge into one interface (keys
 * missing from some items become optional), mixed arrays become unions, and nested objects get
 * their own interface named after their key ("addresses" → Address).
 */
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const pascal = (s) => (String(s).replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : '')).replace(/^./, (c) => c.toUpperCase()).replace(/^(?=\d)/, '_')) || 'Item';
const singular = (s) => String(s).replace(/ies$/i, 'y').replace(/(ss)$/i, '$1').replace(/([^s])s$/i, '$1');
const safeKey = (k) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

export function toTypeScript(value, rootName = 'Root') {
  const decls = new Map();
  const unique = (base) => { let n = base, i = 2; while (decls.has(n)) n = `${base}${i++}`; return n; };

  function union(values, hint) {
    const types = new Set();
    const objs = values.filter(isObj);
    const arrays = values.filter(Array.isArray);
    for (const v of values) {
      if (v === null) types.add('null');
      else if (!isObj(v) && !Array.isArray(v)) types.add(typeof v);
    }
    if (objs.length) types.add(objectType(objs, hint));
    if (arrays.length) types.add(arrayType(arrays.flat(), hint));
    return [...types].join(' | ') || 'unknown';
  }

  function arrayType(items, hint) {
    if (!items.length) return 'unknown[]';
    const t = union(items, singular(hint));
    return t.includes(' | ') ? `(${t})[]` : `${t}[]`;
  }

  function objectType(objs, hint) {
    const name = unique(pascal(hint));
    decls.set(name, null); // reserve the name (and its place in the output order)
    const order = [];
    const values = new Map();
    for (const o of objs) {
      for (const [k, v] of Object.entries(o)) {
        if (!values.has(k)) { values.set(k, []); order.push(k); }
        values.get(k).push(v);
      }
    }
    const lines = order.map((k) => `  ${safeKey(k)}${values.get(k).length < objs.length ? '?' : ''}: ${union(values.get(k), k)};`);
    decls.set(name, `export interface ${name} {\n${lines.join('\n')}${lines.length ? '\n' : ''}}`);
    return name;
  }

  const root = pascal(rootName);
  if (isObj(value)) objectType([value], root);
  else {
    decls.set(root, null);
    const t = Array.isArray(value) ? arrayType(value, `${root}Item`) : union([value], root);
    decls.set(root, `export type ${root} = ${t};`);
  }
  return `${[...decls.values()].join('\n\n')}\n`;
}
