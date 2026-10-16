/*
 * Transition effect: the Transitions tool's engine (WebGL, with Canvas 2D fallbacks) between two frames.
 * The host passes env.A / env.B (canvases the size of the output: outgoing and incoming frame) and
 * env.local = seconds into the transition; env.gpu.engine is one shared createEngine().
 * env.item.extra holds the chosen transition's own params (defaults from its file fill the rest).
 */
import { TRANSITIONS, getTransition } from '/video-effects/transitions/transitions/index.js';
import { defaultsOf } from '/video-effects/transitions/transitions/_common.js';
import { easeWith, clamp } from '../easing.js';

/** The transition definition and its full params (its defaults + `extra`). */
export function transitionParams(p, extra = {}) {
  const tr = getTransition(p.type) || getTransition('punch-in');
  return { tr, params: { ...defaultsOf(tr.params), ...extra } };
}

const TEXT = new Set(TRANSITIONS.filter((t) => t.category === 'text').map((t) => t.id));

export default {
  id: 'transition',
  name: 'Transition',
  description: 'A transition across a cut (whip pan, punch-in, glitch, light leak…).',
  kind: 'transition',
  params: [
    { id: 'type', type: 'select', label: 'Transition', value: 'punch-in', options: TRANSITIONS.filter((t) => !TEXT.has(t.id)).map((t) => [t.id, t.name]) },
    { id: 'duration', type: 'range', label: 'Duration', min: 0.15, max: 1.5, step: 0.05, value: 0.4, unit: 's' },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeInOut', options: [['linear', 'Linear'], ['easeInOut', 'Ease in-out'], ['easeInOutExpo', 'Expo in-out'], ['easeInOutBack', 'Back in-out']] },
  ],
  ai: {
    params: ['type', 'duration'],
    hint: 'Use sparingly on cuts between topics, not on every jump cut. 0.25–0.5 s.',
  },
  transitionParams,
  render(ctx, frame, t, p, env) {
    const { tr, params } = transitionParams(p, env.item?.extra);
    const raw = clamp((env.local ?? 0) / p.duration);
    env.gpu.engine.render(ctx, tr, env.A, env.B, { p: easeWith(p.easing, '', raw), raw, params, duration: p.duration, refresh: env.refresh });
  },
};
