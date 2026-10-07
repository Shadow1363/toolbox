/* Split: the frame breaks into 2–4 panels that slide away to reveal B. */
import { range, percent } from './_common.js';

export default {
  id: 'split',
  name: 'Split',
  category: 'scale',
  description: 'The frame splits into panels that slide away to reveal B.',
  duration: 0.9,
  easing: 'easeInOutExpo',
  params: [
    range('panels', 'Panels', 2, 4, 2, 1),
    { id: 'orient', type: 'segmented', label: 'Panels are', value: 'columns', options: [['columns', 'Columns'], ['rows', 'Rows']] },
    { id: 'motion', type: 'segmented', label: 'Motion', value: 'outward', options: [['outward', 'Apart'], ['alternate', 'Alternate']] },
    percent('stagger', 'Stagger', 0.25),
    percent('shade', 'Edge shadow', 0.5),
  ],
  presets: [
    { label: 'Barn doors', params: { panels: 2, orient: 'columns', motion: 'outward', stagger: 0 } },
    { label: 'Blinds', params: { panels: 4, orient: 'columns', motion: 'alternate', stagger: 0.3 } },
    { label: 'Top / bottom', params: { panels: 2, orient: 'rows', motion: 'outward', stagger: 0 } },
  ],
  glsl: `
uniform float uPanels, uRows, uAlternate, uStagger, uShade;
float panelProgress(float i) {
  float span = 1.0 - uStagger;
  float start = uStagger * i / max(1.0, uPanels - 1.0);
  return clamp((uProgress - start) / span, 0.0, 1.0);
}
vec4 transition(vec2 uv) {
  // Work in (along, across): "along" runs across the panels, "across" along each panel.
  vec2 q = uRows > 0.5 ? uv.yx : uv;
  vec4 behind = getB(zoomAt(uv, vec2(0.5), mix(1.1, 1.0, uProgress)));
  behind.rgb *= mix(0.55, 1.0, uProgress);
  for (int j = 0; j < 4; j++) {
    float i = float(j);
    if (i >= uPanels) break;
    float t = panelProgress(i);
    float lo = i / uPanels, hi = (i + 1.0) / uPanels;
    vec2 src = q;
    if (uAlternate > 0.5) {
      float sgn = mod(i, 2.0) < 0.5 ? -1.0 : 1.0;
      src.y -= sgn * t * 1.02;
    } else {
      float centre = (lo + hi) * 0.5;
      float sgn = centre < 0.5 ? -1.0 : (centre > 0.5 ? 1.0 : (mod(i, 2.0) < 0.5 ? -1.0 : 1.0));
      src.x -= sgn * t * (0.52 + 0.5);
    }
    if (src.x >= lo && src.x < hi && src.y >= 0.0 && src.y <= 1.0) {
      vec2 suv = uRows > 0.5 ? src.yx : src;
      vec4 c = getA(suv);
      float edge = min(src.x - lo, hi - src.x) * uRes.x;
      c.rgb *= 1.0 - uShade * 0.5 * t * (1.0 - smoothstep(0.0, 40.0, edge));
      return c;
    }
  }
  return behind;
}`,
  uniforms: (P) => ({ uPanels: P.panels, uRows: P.orient === 'rows' ? 1 : 0, uAlternate: P.motion === 'alternate' ? 1 : 0, uStagger: P.stagger, uShade: P.shade }),
  draw2d(ctx, A, B, p, P, env) {
    const { W, H } = env;
    const rows = P.orient === 'rows';
    const n = P.panels;
    ctx.save();
    const s = 1.1 - 0.1 * p;
    ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    ctx.fillStyle = `rgba(0,0,0,${0.45 * (1 - p)})`; ctx.fillRect(0, 0, W, H);
    for (let i = 0; i < n; i++) {
      const start = (P.stagger * i) / Math.max(1, n - 1);
      const t = Math.min(1, Math.max(0, (p - start) / (1 - P.stagger)));
      const L = (rows ? H : W) * i / n, S = (rows ? H : W) / n;
      let dx = 0, dy = 0;
      if (P.motion === 'alternate') { const sg = i % 2 ? 1 : -1; if (rows) dx = sg * t * W * 1.02; else dy = sg * t * H * 1.02; }
      else {
        const c = (i + 0.5) / n; const sg = c < 0.5 ? -1 : c > 0.5 ? 1 : (i % 2 ? 1 : -1);
        if (rows) dy = sg * t * H * 1.02; else dx = sg * t * W * 1.02;
      }
      if (rows) ctx.drawImage(A, 0, L, W, S, dx, L + dy, W, S);
      else ctx.drawImage(A, L, 0, S, H, L + dx, dy, S, H);
    }
  },
};
