/*
 * Effect registry: the effects the Auto Editor can apply (and the AI can ask for), each wrapping the drawing
 * code of an existing tool. Tool pages import the underlying lib functions directly; the registry adds a
 * common interface on top:
 *
 *   {
 *     id, name, description,
 *     kind: 'overlay' | 'camera' | 'transition',
 *     single?: true,                 // one per edit (captions, progress), not a timed layer
 *     params: [createControls specs], // local ids; also the AI schema and the edit panel
 *     ai: { params: [ids the AI may set], hint },
 *     presets?: { name: patch },
 *     normalize?(params, given),     // fix-ups after validation (e.g. anim → easing)
 *     prepare?(params, env) → Promise, // fonts, images
 *     track?(items, env),            // camera effects: precompute once per edit → env.track
 *     render(ctx, frame, t, params, env),
 *   }
 *
 * frame = { el, width, height } (the video frame so far); t = output seconds.
 * env = { W, H, k, duration, item: { start, end, extra }, local (t − item.start), slot (layer index),
 *         gpu: { engine, persp }, data: { pages, images, face, faceAt, captionTop, captionBottom, chapters }, track, A, B, refresh }.
 * Sizes are authored for a 1080px short side; each effect scales by k itself.
 *
 * Adding an effect: write effects/<id>.js with this shape and add it to EFFECTS. The Auto Editor's
 * "available actions" prompt and its validation come from the params, so the AI can use it right away.
 */
import captions from './captions.js';
import text from './text.js';
import screenshot from './screenshot.js';
import zoom from './zoom.js';
import transition from './transition.js';
import progress from './progress.js';
import { validateParams, describeParams, paramsToSchema, defaultsOf } from './schema.js';

export const EFFECTS = [captions, text, screenshot, zoom, transition, progress];

export const getEffect = (id) => EFFECTS.find((e) => e.id === id);

/** Validate and complete an effect's params: defaults, then a preset patch (if any), then the given values. */
export function effectParams(effect, given = {}, { partial = false } = {}) {
  const base = given?.preset && effect.presets?.[given.preset] ? { ...given, ...effect.presets[given.preset], ...given } : given;
  const res = validateParams(effect.params, base, { partial });
  if (effect.normalize) effect.normalize(res.params, given || {});
  return res;
}

/** Defaults for an effect (with its default preset applied). */
export function effectDefaults(effect) {
  return effectParams(effect, {}).params;
}

/** The "available actions" block for an AI prompt: one entry per effect with the params it may set. */
export function describeEffectsForAI() {
  return EFFECTS.map((e) => [
    `- ${e.id}${e.single ? ' (one per video)' : ''}: ${e.description}`,
    e.ai?.hint ? `  When: ${e.ai.hint}` : '',
    `  params: ${describeParams(e.params, { only: e.ai?.params })}`,
  ].filter(Boolean).join('\n')).join('\n');
}

/** JSON Schema of the params the AI may set for an effect. */
export const effectSchema = (effect) => paramsToSchema(effect.params, { only: effect.ai?.params });

/** One transitions engine + one perspective renderer per page (each holds a WebGL context). Lazy. */
let gpu = null;
export async function createGpu() {
  if (gpu) return gpu;
  const [{ createEngine }, { createPerspective }] = await Promise.all([
    import('/video-effects/transitions/engine.js'),
    import('../perspective.js'),
  ]);
  gpu = { engine: createEngine(), persp: createPerspective() };
  return gpu;
}

export { defaultsOf };
