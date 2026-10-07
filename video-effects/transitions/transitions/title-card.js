/* Title card: A fades to a solid color, the title animates in and out, then B fades in. */
import { rgb, smooth, fillAll } from './_common.js';
import { textParams, layoutText, drawGlyphs, maskCanvas } from './_text.js';

function titleState(P, env) {
  const p = env.p;
  const tin = smooth(0.2, 0.42, p), tout = smooth(0.6, 0.8, p);
  const extra = P.anim === 'track' ? (1 - tin) * 60 + tout * 30 : 0;
  const L = layoutText({ ...P, spacing: P.spacing + extra }, env.W, env.H, env.refresh);
  return { L, tin, tout, alpha: tin * (1 - tout) };
}

export default {
  id: 'title-card',
  name: 'Title card',
  category: 'text',
  description: 'Fade to a color, the title animates in and out, then B fades in.',
  duration: 2.4,
  maxDuration: 5,
  easing: 'linear',
  params: [
    ...textParams({ text: 'Part Two', size: 180, font: 'Playfair Display', weight: '700' }),
    { id: 'bg', type: 'color', label: 'Card color', value: '#0b0b0d' },
    { id: 'anim', type: 'segmented', label: 'Text motion', value: 'rise', options: [['fade', 'Fade + scale'], ['rise', 'Rise'], ['track', 'Tracking']] },
  ],
  presets: [
    { label: 'Cinema', params: { text: 'Part Two', font: 'Playfair Display', weight: '700', bg: '#0b0b0d', textColor: '#ffffff', anim: 'rise' } },
    { label: 'Clean white', params: { text: 'CHAPTER 3', font: 'Inter', weight: '600', size: 120, spacing: 24, bg: '#ffffff', textColor: '#111111', anim: 'track' } },
    { label: 'Bold', params: { text: 'LATER…', font: 'Anton', weight: '400', size: 300, bg: '#0071e3', textColor: '#ffffff', anim: 'fade' } },
  ],
  mask(P, env) {
    const { W, H, k } = env;
    const S = titleState(P, env);
    const { c, ctx } = maskCanvas('tc', W, H);
    if (S.alpha <= 0) return c;
    ctx.globalAlpha = S.alpha;
    ctx.fillStyle = '#fff';
    if (P.anim === 'fade') {
      const s = 1.08 - 0.08 * S.tin - 0.05 * S.tout;
      ctx.translate(W / 2, H / 2); ctx.scale(s, s); ctx.translate(-W / 2, -H / 2);
    } else if (P.anim === 'rise') {
      ctx.translate(0, (1 - S.tin) * 60 * k - S.tout * 30 * k);
    }
    drawGlyphs(ctx, S.L);
    return c;
  },
  glsl: `
uniform vec3 uBg, uTextColor;
vec4 transition(vec2 uv) {
  float p = uProgress;
  vec3 base = p < 0.5 ? mix(getA(uv).rgb, uBg, smoothstep(0.0, 0.22, p)) : mix(uBg, getB(uv).rgb, smoothstep(0.78, 1.0, p));
  return vec4(mix(base, uTextColor, getMask(uv).a), 1.0);
}`,
  uniforms: (P) => ({ uBg: rgb(P.bg), uTextColor: rgb(P.textColor) }),
  draw2d(ctx, A, B, p, P, env) {
    if (p < 0.5) { ctx.drawImage(A, 0, 0); fillAll(ctx, P.bg, smooth(0, 0.22, p)); }
    else { fillAll(ctx, P.bg); ctx.globalAlpha = smooth(0.78, 1, p); ctx.drawImage(B, 0, 0); ctx.globalAlpha = 1; }
    const tint = document.createElement('canvas');
    tint.width = env.W; tint.height = env.H;
    const t = tint.getContext('2d');
    t.drawImage(env.mask, 0, 0); t.globalCompositeOperation = 'source-in'; t.fillStyle = P.textColor; t.fillRect(0, 0, env.W, env.H);
    ctx.drawImage(tint, 0, 0);
  },
};
