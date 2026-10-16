/*
 * Effect params ↔ JSON. Effect params are createControls specs (lib/controls.js); these helpers turn them into
 * defaults, a JSON Schema (for AI providers), a compact text description, and validate incoming values.
 * No DOM, so it runs in Node too.
 *
 *   defaultsOf(params)                    → { id: value }
 *   paramsToSchema(params, { only })      → { type: 'object', properties, additionalProperties: false }
 *   describeParams(params, { only })      → 'zoom: number 1.05–3 (default 1.3); easing: one of …'
 *   validateParams(params, values, { only, partial }) → { params, errors: [], warnings: [] }
 */

const VALUE_TYPES = new Set(['range', 'number', 'select', 'segmented', 'toggle', 'color', 'text', 'textarea']);
const HEX = /^#[0-9a-fA-F]{6}$/;

/** The value-holding controls of a params list (skips buttons, presets, custom elements). */
export const valueParams = (params, only) =>
  params.filter((c) => c && c.id && VALUE_TYPES.has(c.type) && (!only || only.includes(c.id)));

export const defaultsOf = (params) => Object.fromEntries(valueParams(params).map((c) => [c.id, c.value]));

const optionValues = (c) => (c.options || []).map((o) => (Array.isArray(o) ? o[0] : o.value));

/** One control → a JSON Schema property. */
export function controlSchema(c) {
  const description = c.ai || c.label || c.id;
  switch (c.type) {
    case 'range':
    case 'number':
      return { type: 'number', minimum: c.min ?? 0, maximum: c.max ?? 100, description };
    case 'select':
    case 'segmented':
      return { type: 'string', enum: optionValues(c), description };
    case 'toggle':
      return { type: 'boolean', description };
    case 'color':
      return { type: 'string', pattern: HEX.source, description: `${description} (#rrggbb)` };
    default:
      return { type: 'string', description };
  }
}

export function paramsToSchema(params, { only } = {}) {
  const properties = {};
  for (const c of valueParams(params, only)) properties[c.id] = controlSchema(c);
  return { type: 'object', properties, additionalProperties: false };
}

const num = (v) => String(Math.round(v * 1000) / 1000);

/** A one-line description per param, short enough to put many effects in a prompt. */
export function describeParams(params, { only } = {}) {
  return valueParams(params, only).map((c) => {
    const what = c.ai ? ` (${c.ai})` : '';
    switch (c.type) {
      case 'range':
      case 'number':
        return `${c.id}: number ${num(c.min ?? 0)}–${num(c.max ?? 100)}${c.unit ? ` ${c.unit}` : ''}, default ${num(c.value)}${what}`;
      case 'select':
      case 'segmented':
        return `${c.id}: one of ${optionValues(c).map((v) => JSON.stringify(v)).join('|')}, default ${JSON.stringify(c.value)}${what}`;
      case 'toggle':
        return `${c.id}: boolean, default ${c.value}${what}`;
      case 'color':
        return `${c.id}: color #rrggbb, default ${c.value}${what}`;
      default:
        return `${c.id}: text${c.value ? `, default ${JSON.stringify(c.value)}` : ''}${what}`;
    }
  }).join('; ');
}

/**
 * Check `values` against the params. Unknown ids and wrong types are errors; numbers out of range are
 * clamped with a warning; select values are matched case-insensitively. Missing values take defaults
 * (unless `partial`, which returns only the given ids).
 */
export function validateParams(params, values = {}, { only, partial = false } = {}) {
  const errors = [];
  const warnings = [];
  const specs = valueParams(params, only);
  const byId = new Map(specs.map((c) => [c.id, c]));
  const out = partial ? {} : defaultsOf(specs);
  if (values == null || typeof values !== 'object' || Array.isArray(values)) {
    return { params: out, errors: ['params must be an object'], warnings };
  }
  for (const [id, v] of Object.entries(values)) {
    const c = byId.get(id);
    if (!c) { errors.push(`unknown param "${id}"`); continue; }
    switch (c.type) {
      case 'range':
      case 'number': {
        const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
        if (typeof n !== 'number' || !Number.isFinite(n)) { errors.push(`${id} must be a number`); break; }
        const lo = c.min ?? 0, hi = c.max ?? 100;
        if (n < lo || n > hi) warnings.push(`${id} ${n} clamped to ${lo}–${hi}`);
        out[id] = Math.min(hi, Math.max(lo, n));
        break;
      }
      case 'select':
      case 'segmented': {
        const opts = optionValues(c);
        const hit = opts.find((o) => String(o) === String(v)) ?? opts.find((o) => String(o).toLowerCase() === String(v).toLowerCase());
        if (hit === undefined) errors.push(`${id} must be one of ${opts.join(', ')} (got ${JSON.stringify(v)})`);
        else out[id] = hit;
        break;
      }
      case 'toggle':
        if (typeof v !== 'boolean') errors.push(`${id} must be true or false`);
        else out[id] = v;
        break;
      case 'color':
        if (typeof v !== 'string' || !HEX.test(v)) errors.push(`${id} must be a #rrggbb color`);
        else out[id] = v.toLowerCase();
        break;
      default:
        if (typeof v !== 'string') errors.push(`${id} must be text`);
        else out[id] = v;
    }
  }
  return { params: out, errors, warnings };
}
