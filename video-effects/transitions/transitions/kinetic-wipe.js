/* Kinetic text wipe: a line of bold text sweeps across; everything behind its trailing edge is B.
   The mask packs three layers into RGB: R = text, G = revealed area (B), B = optional band. */
import { percent, range, rgb } from './_common.js';
import { textParams, layoutText, drawGlyphs, maskCanvas } from './_text.js';

function geom(P, env) {
  const { W, H, p } = env;
  const L = layoutText(P, W, H, env.refresh);
  const tw = L.width + L.size * 0.4; // a little padding so the edge trails the last letter
  const toLeft = P.direction !== 'right';
  const lead = toLeft ? W - (W + tw) * p : -tw + (W + tw) * p; // left edge of the text block
  const dx = lead + L.size * 0.2 - (W / 2 - L.width / 2);
  const edge = toLeft ? lead + tw : lead; // the trailing edge
  const skew = P.skew;
  return { L, tw, dx, edge, toLeft, skew };
}

function drawLayers(ctx, P, env, G, colors) {
  const { W, H } = env;
  const { L } = G;
  const top = L.cy - L.height / 2 - L.size * 0.25, bandH = L.height + L.size * 0.5;
  ctx.save();
  ctx.transform(1, 0, -G.skew, 1, G.skew * H / 2, 0);
  ctx.fillStyle = colors.region;
  if (G.toLeft) ctx.fillRect(G.edge, -H, W * 3, H * 3); else ctx.fillRect(-W * 2, -H, G.edge + W * 2, H * 3);
  if (P.band) { ctx.fillStyle = colors.band; ctx.fillRect(G.edge - (G.toLeft ? G.tw : 0), top, G.tw, bandH); }
  ctx.fillStyle = colors.text;
  ctx.translate(G.dx, 0);
  drawGlyphs(ctx, L);
  ctx.restore();
}

export default {
  id: 'kinetic-wipe',
  name: 'Kinetic text wipe',
  category: 'text',
  description: 'A line of bold text sweeps across; its trailing edge reveals B.',
  duration: 1.2,
  easing: 'easeInOut',
  params: [
    ...textParams({ text: 'NEXT UP →', size: 260, multiline: false, color: '#ffffff' }),
    { id: 'direction', type: 'segmented', label: 'Direction', value: 'left', options: [['left', '← Left'], ['right', 'Right →']] },
    { id: 'band', type: 'toggle', label: 'Color band behind text', value: true },
    { id: 'bandColor', type: 'color', label: 'Band color', value: '#0071e3', showIf: (s) => s.band },
    range('skew', 'Slant', -0.5, 0.5, 0.18, 0.01),
    percent('blur', 'Motion blur', 0.5),
  ],
  presets: [
    { label: 'Blue band', params: { band: true, bandColor: '#0071e3', textColor: '#ffffff', skew: 0.18 } },
    { label: 'Clean', params: { band: false, textColor: '#ffffff', skew: 0, size: 320 } },
    { label: 'Loud', params: { text: 'BREAKING', band: true, bandColor: '#ffd60a', textColor: '#111111', font: 'Anton', weight: '400', size: 300 } },
  ],
  mask(P, env) {
    const { W, H } = env;
    const G = geom(P, env);
    const { c, ctx } = maskCanvas('kw', W, H);
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'lighter';
    drawLayers(ctx, P, env, G, { region: '#00ff00', band: '#0000ff', text: '#ff0000' });
    return c;
  },
  glsl: `
uniform vec3 uTextColor, uBandColor;
uniform float uBlur;
vec4 transition(vec2 uv) {
  float w = uBlur * 0.05 * sin(PI * clamp(uRaw, 0.0, 1.0));
  vec3 m = vec3(0.0);
  for (int i = 0; i < 12; i++) { float f = (float(i) + 0.5) / 12.0 - 0.5; m += getMask(uv + vec2(w * f, 0.0)).rgb; }
  m /= 12.0;
  vec4 c = mix(getA(uv), getB(uv), m.g);
  c.rgb = mix(c.rgb, uBandColor, m.b);
  c.rgb = mix(c.rgb, uTextColor, m.r);
  return c;
}`,
  uniforms: (P) => ({ uTextColor: rgb(P.textColor), uBandColor: rgb(P.bandColor), uBlur: P.blur }),
  draw2d(ctx, A, B, p, P, env) {
    const G = geom(P, env);
    ctx.drawImage(A, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.transform(1, 0, -G.skew, 1, G.skew * env.H / 2, 0);
    if (G.toLeft) ctx.rect(G.edge, -env.H, env.W * 3, env.H * 3); else ctx.rect(-env.W * 2, -env.H, G.edge + env.W * 2, env.H * 3);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clip();
    ctx.drawImage(B, 0, 0);
    ctx.restore();
    drawLayers(ctx, P, env, G, { region: 'rgba(0,0,0,0)', band: P.bandColor, text: P.textColor });
  },
};
