/**
 * Converter registry and chaining.
 *
 * A converter is a plain object:
 *   {
 *     from: 'md', to: 'html',
 *     options?: [createControls specs],   // shown when this step is part of the chain
 *     note?: 'What gets lost',            // shown to the user (lossy conversions)
 *     final?: true,                       // may only be the last step (e.g. PDF → page images)
 *     many?: true,                        // convert(items[]) → one Item (e.g. images → one PDF)
 *     heavy?: true,                       // slow (ffmpeg): runs only when the user presses Convert
 *     convert(input: Item, opts, ctx) → Item | Item[]   // ctx: { progress(0..1), signal, status(text) }
 *   }
 * Missing pairs are chained with a breadth-first search (fewest steps, then registration order).
 */
import { FORMATS, outputName } from './formats.js';

export class Item {
  constructor(blob, name, format) {
    Object.assign(this, { blob, name, format });
  }
  static text(text, name, format) {
    return new Item(new Blob([text], { type: `${FORMATS[format].mime};charset=utf-8` }), name, format);
  }
  static bytes(data, name, format) {
    return new Item(new Blob([data], { type: FORMATS[format].mime }), name, format);
  }
  text() { return this.blob.text(); }
  arrayBuffer() { return this.blob.arrayBuffer(); }
  /** An Item of `format` named after this one (report.md → report.pdf). */
  as(format, data) {
    const name = outputName(this.name, format);
    return typeof data === 'string' ? Item.text(data, name, format) : Item.bytes(data, name, format);
  }
}

/** A friendly error for unreadable or corrupt input. */
export class ConvertError extends Error {}

const converters = [];
export const register = (...list) => converters.push(...list.flat());
export const allConverters = () => converters;

const MAX_STEPS = 3;

/** Every format reachable from `from`: Map(to → converter[] path), shortest paths only. */
export function targets(from) {
  const paths = new Map([[from, []]]);
  let frontier = [from];
  for (let depth = 0; depth < MAX_STEPS && frontier.length; depth++) {
    const next = [];
    for (const f of frontier) {
      const path = paths.get(f);
      if (path.length && path[path.length - 1].final) continue;
      for (const c of converters) {
        if (c.from !== f || paths.has(c.to)) continue;
        if (c.many && path.length) continue; // multi-input steps only start a chain
        paths.set(c.to, [...path, c]);
        next.push(c.to);
      }
    }
    frontier = next;
  }
  paths.delete(from);
  return paths;
}

export const pathFor = (from, to) => targets(from).get(to) || null;

/** Run a chain on one item (or, when the first step is `many`, on several). */
export async function run(path, input, opts, ctx) {
  let cur = input;
  for (let i = 0; i < path.length; i++) {
    if (ctx.signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    const step = path[i];
    const sub = {
      ...ctx,
      progress: (p) => ctx.progress?.((i + Math.max(0, Math.min(1, p))) / path.length),
    };
    if (step.many && !Array.isArray(cur)) cur = [cur];
    else if (Array.isArray(cur) && !step.many) {
      if (cur.length !== 1) throw new ConvertError('This step produced several files, so it can only be the last step.');
      cur = cur[0];
    }
    cur = await step.convert(cur, opts, sub);
    sub.progress(1);
  }
  return Array.isArray(cur) ? cur : [cur];
}

/** Option specs used by a chain, de-duplicated by id. */
export function optionsFor(paths) {
  const seen = new Map();
  for (const path of paths) for (const step of path) for (const o of step.options || []) if (!seen.has(o.id)) seen.set(o.id, o);
  return [...seen.values()];
}

export const notesFor = (path) => [...new Set(path.map((s) => s.note).filter(Boolean))];
