/** Easing functions: t in [0,1] → eased value (may overshoot for back/elastic). */
export const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, x) => { const t = clamp((x - a) / (b - a || 1e-6)); return t * t * (3 - 2 * t); };

export const easings = {
  linear: (t) => t,
  easeIn: (t) => t * t * t,
  easeOut: (t) => 1 - (1 - t) ** 3,
  easeInOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
  easeOutQuint: (t) => 1 - (1 - t) ** 5,
  easeOutBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * (t - 1) ** 3 + c1 * (t - 1) ** 2; },
  easeOutElastic: (t) => (t === 0 || t === 1 ? t : 2 ** (-10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
  easeOutBounce: (t) => {
    const n1 = 7.5625, d1 = 2.75;
    if (t < 1 / d1) return n1 * t * t;
    if (t < 2 / d1) return n1 * (t -= 1.5 / d1) * t + 0.75;
    if (t < 2.5 / d1) return n1 * (t -= 2.25 / d1) * t + 0.9375;
    return n1 * (t -= 2.625 / d1) * t + 0.984375;
  },
};

/** Options for a <select> control. */
export const easingOptions = [
  ['linear', 'Linear'], ['easeIn', 'Ease in'], ['easeOut', 'Ease out'], ['easeInOut', 'Ease in-out'],
  ['easeOutQuint', 'Smooth out'], ['easeOutBack', 'Back (overshoot)'], ['easeOutElastic', 'Elastic'], ['easeOutBounce', 'Bounce'],
];

export const ease = (name, t) => (easings[name] || easings.linear)(clamp(t));
