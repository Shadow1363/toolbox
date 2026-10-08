/*
 * Retro Looks: the effects. Each one is a fragment shader (see engine.js HEADER) plus a function
 * that maps panel settings to its uniforms. They run in EFFECTS order when enabled, so styles
 * that redraw the picture (dither, ASCII) come first, then film and tape artifacts, then the CRT screen.

 */

const hex3 = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/* ---------- Palettes (dark → light for the luma ramps) ---------- */
export const PALETTES = {
  bw: {
    label: "1-bit (black & white)",
    mode: "ramp",
    colors: ["#000000", "#ffffff"],
  },
  handheld: {
    label: "Handheld green (4)",
    mode: "ramp",
    colors: ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"],
  },
  gray: {
    label: "Grayscale (4)",
    mode: "ramp",
    colors: ["#000000", "#555555", "#aaaaaa", "#ffffff"],
  },
  sepia: {
    label: "Sepia (4)",
    mode: "ramp",
    colors: ["#2b1d0e", "#6b4a2b", "#b58b5a", "#f1e0c0"],
  },
  pc4: {
    label: "Retro PC (4 colors)",
    mode: "nearest",
    colors: ["#000000", "#55ffff", "#ff55ff", "#ffffff"],
  },
  fantasy16: {
    label: "Fantasy console (16)",
    mode: "nearest",
    colors: [
      "#000000",
      "#1d2b53",
      "#7e2553",
      "#008751",
      "#ab5236",
      "#5f574f",
      "#c2c3c7",
      "#fff1e8",
      "#ff004d",
      "#ffa300",
      "#ffec27",
      "#00e436",
      "#29adff",
      "#83769c",
      "#ff77a8",
      "#ffccaa",
    ],
  },
  duotone: { label: "Custom duotone", mode: "ramp", colors: null },
};

export const CHARSETS = {
  classic: { label: "Classic  .:-=+*#%@", chars: " .:-=+*#%@" },
  dense: {
    label: "Dense (70 chars)",
    chars:
      " .'`^\",:;Il!i><~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  blocks: { label: "Blocks ░▒▓█", chars: " ░▒▓█" },
  binary: { label: "Binary 01", chars: " 01" },
  dots: { label: "Dots ·•●", chars: " ·•●" },
};

/** Glyph atlas for the ASCII pass: one row of square-ish cells, sorted from least to most ink. */
export function buildAtlas(chars, family) {
  const cw = 48,
    ch = 64;
  const list = [...new Set([...chars])];
  const c = document.createElement("canvas");
  c.width = cw * list.length;
  c.height = ch;
  const g = c.getContext("2d", { willReadFrequently: true });
  g.font = `700 ${Math.round(ch * 0.82)}px "${family}", ui-monospace, monospace`;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = "#fff";
  // Measure ink per glyph so the brightness ramp is right whatever the font.
  const ink = list.map((chr) => {
    g.clearRect(0, 0, cw, ch);
    g.fillText(chr, cw / 2, ch / 2 + 2);
    const d = g.getImageData(0, 0, cw, ch).data;
    let a = 0;
    for (let i = 3; i < d.length; i += 4) a += d[i];
    return { chr, a };
  });
  ink.sort((x, y) => x.a - y.a);
  g.clearRect(0, 0, c.width, ch);
  g.fillStyle = "#000";
  g.fillRect(0, 0, c.width, ch);
  g.fillStyle = "#fff";
  ink.forEach((x, i) => g.fillText(x.chr, cw * i + cw / 2, ch / 2 + 2));
  return { canvas: c, count: ink.length, aspect: cw / ch };
}

/* ---------- Effects ---------- */
export const EFFECTS = [
  {
    id: "dither",
    name: "Dithering",
    glsl: `
uniform float uPixel, uCount, uMode, uSpread, uContrast, uBright;
uniform vec3 uPal[16];
float bayer2(vec2 a) { a = floor(a); return fract(dot(a, vec2(0.5, a.y * 0.75))); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }
float bayer8(vec2 a) { return bayer4(0.5 * a) * 0.25 + bayer2(a); }
vec4 effect(vec2 uv) {
  float px = max(1.0, uPixel * uK);
  vec2 cell = floor(uv * uRes / px);
  vec3 c = tex((cell + 0.5) * px / uRes);
  c = clamp((c - 0.5) * uContrast + 0.5 + uBright, 0.0, 1.0);
  float d = bayer8(cell) - 0.5;
  vec3 best = uPal[0];
  if (uMode < 0.5) {
    float l = clamp(luma(c) + d * uSpread / max(1.0, uCount - 1.0), 0.0, 0.9999);
    float idx = floor(l * uCount);
    for (int i = 0; i < 16; i++) if (float(i) == idx) best = uPal[i];
  } else {
    vec3 q = c + d * uSpread * 0.35;
    float bd = 1e9;
    for (int i = 0; i < 16; i++) {
      if (float(i) >= uCount) break;
      vec3 e = q - uPal[i];
      float dist = dot(e * vec3(0.30, 0.59, 0.11), e);
      if (dist < bd) { bd = dist; best = uPal[i]; }
    }
  }
  return vec4(best, 1.0);
}`,
    uniforms: (s) => {
      const pal = PALETTES[s.palette];
      const colors = pal.colors || [s.duoDark, s.duoLight];
      const flat = colors.flatMap(hex3);
      while (flat.length < 48) flat.push(0, 0, 0);
      return {
        uPixel: s.ditherPixel,
        uCount: colors.length,
        uMode: pal.mode === "nearest" ? 1 : 0,
        uSpread: s.ditherSpread,
        uContrast: s.ditherContrast,
        uBright: s.ditherBright,
        uPal: flat,
      };
    },
  },
  {
    id: "ascii",
    name: "ASCII art",
    glsl: `
uniform sampler2D uAtlas;
uniform float uCell, uChars, uAspect, uMono, uGamma, uBoost;
uniform vec3 uFg, uBg;
vec4 effect(vec2 uv) {
  vec2 size = vec2(uCell * uK, uCell * uK / uAspect);
  vec2 px = uv * uRes;
  vec2 cell = floor(px / size);
  vec2 local = fract(px / size);
  vec2 cuv = (cell + 0.5) * size / uRes;
  vec2 o = size * 0.25 / uRes;
  vec3 c = (tex(cuv) * 2.0 + tex(cuv + vec2(o.x, 0.0)) + tex(cuv - vec2(o.x, 0.0)) + tex(cuv + vec2(0.0, o.y)) + tex(cuv - vec2(0.0, o.y))) / 6.0;
  float l = pow(clamp(luma(c), 0.0, 1.0), uGamma);
  float idx = floor(clamp(l, 0.0, 0.9999) * uChars);
  float m = texture2D(uAtlas, vec2((idx + local.x) / uChars, local.y)).r;
  vec3 col = uMono > 0.5 ? mix(uBg, uFg, m) : mix(uBg, clamp(c * uBoost, 0.0, 1.0), m);
  return vec4(col, 1.0);
}`,
    uniforms: (s, env) => ({
      uCell: s.asciiCell,
      uChars: env.atlas.count,
      uAspect: env.atlas.aspect,
      uMono: s.asciiColor === "mono" ? 1 : 0,
      uGamma: s.asciiGamma,
      uBoost: s.asciiBoost,
      uFg: hex3(s.asciiFg),
      uBg: hex3(s.asciiBg),
    }),
    textures: (s, env) => ({
      uAtlas: { canvas: env.atlas.canvas, version: env.atlasVersion },
    }),
  },
  {
    id: "film",
    name: "Film grain & dust",
    glsl: `
uniform float uGrain, uDust, uScratch, uFlicker, uVignette, uFade;
vec4 effect(vec2 uv) {
  vec3 c = tex(uv);
  c *= 1.0 + (hash1(uFrame * 1.7) - 0.5) * uFlicker;
  float g = hash(floor(uv * uRes / max(1.0, uK * 1.5)) + uFrame * 17.13) - 0.5;
  c += g * uGrain * (1.0 - 0.5 * luma(c));
  float asp = uRes.x / uRes.y;
  for (int i = 0; i < 16; i++) {
    float fi = float(i);
    if (fi >= uDust * 16.0) break;
    vec2 p = vec2(hash1(uFrame * 3.1 + fi * 7.7), hash1(uFrame * 5.3 + fi * 1.3));
    vec2 sz = vec2(0.8 + hash1(fi * 3.3 + uFrame) * 3.5, 0.6 + hash1(fi * 5.1 + uFrame) * 1.6) * uK / uRes.y;
    vec2 d = (uv - p) * vec2(asp, 1.0);
    float r = length(d / sz);
    float a = smoothstep(1.0, 0.3, r) * 0.85;
    c = mix(c, vec3(hash1(fi * 9.0 + uFrame) > 0.35 ? 0.06 : 0.92), a);
  }
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float seg = floor(uFrame / (5.0 + fi * 4.0));
    float on = step(1.0 - uScratch, hash1(seg * 2.1 + fi * 17.0));
    float x = hash1(seg * 11.3 + fi * 3.7) + sin(uv.y * 9.0 + seg) * 0.003;
    float w = 1.4 * max(1.0, uK) / uRes.x;
    float line = smoothstep(w, 0.0, abs(uv.x - x)) * (0.55 + 0.45 * hash(vec2(floor(uv.y * 160.0), seg)));
    c = mix(c, vec3(hash1(seg + fi) > 0.5 ? 0.92 : 0.1), on * line * 0.7);
  }
  vec2 q = uv - 0.5;
  c *= 1.0 - uVignette * dot(q, q) * 2.4;
  c = mix(c, vec3(luma(c)) * vec3(1.06, 0.98, 0.84), uFade);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
    uniforms: (s) => ({
      uGrain: s.filmGrain,
      uDust: s.filmDust,
      uScratch: s.filmScratch,
      uFlicker: s.filmFlicker,
      uVignette: s.filmVignette,
      uFade: s.filmFade,
    }),
  },
  {
    id: "mm8",
    name: "8mm",
    glsl: `
uniform float uWarm, uVignette, uFlicker, uWeave, uSoft, uGrain, uGate;
vec4 effect(vec2 uv) {
  vec2 weave = (vec2(hash1(uFrame * 1.3), hash1(uFrame * 2.7)) - 0.5) * uWeave * vec2(0.004, 0.007);
  vec2 p = uv + weave;
  vec2 r = vec2(uSoft * uK) / uRes;
  vec3 c = tex(p) * 0.4 + (tex(p + vec2(r.x, 0.0)) + tex(p - vec2(r.x, 0.0)) + tex(p + vec2(0.0, r.y)) + tex(p - vec2(0.0, r.y))) * 0.15;
  c = pow(max(c, 0.0), vec3(0.95, 1.0, 1.14));
  c = mix(c, c * vec3(1.14, 1.0, 0.74) + vec3(0.05, 0.025, 0.0), uWarm);
  c = mix(vec3(0.52, 0.48, 0.42), c, 0.88);
  c *= 1.0 + (hash1(uFrame * 0.77) - 0.5) * uFlicker;
  c += (hash(floor(uv * uRes / max(1.0, uK * 2.0)) + uFrame * 7.7) - 0.5) * uGrain;
  vec2 q = abs(uv - 0.5) * 2.0;
  float rr = pow(pow(q.x, 8.0) + pow(q.y, 8.0), 0.125);
  float gate = smoothstep(1.0, 0.93, rr);
  c *= mix(1.0, gate, uGate);
  vec2 v = uv - 0.5;
  c *= 1.0 - uVignette * dot(v, v) * 3.0;
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
    uniforms: (s) => ({
      uWarm: s.mmWarm,
      uVignette: s.mmVignette,
      uFlicker: s.mmFlicker,
      uWeave: s.mmWeave,
      uSoft: s.mmSoft,
      uGrain: s.mmGrain,
      uGate: s.mmGate ? 1 : 0,
    }),
  },
  {
    id: "vhs",
    name: "VHS",
    glsl: `
uniform sampler2D uOsd;
uniform float uBleed, uTracking, uNoise, uWobble, uSat, uOsdOn;
vec3 rgb2yiq(vec3 c) { return vec3(dot(c, vec3(0.299, 0.587, 0.114)), dot(c, vec3(0.596, -0.274, -0.322)), dot(c, vec3(0.211, -0.523, 0.312))); }
vec3 yiq2rgb(vec3 y) { return vec3(y.x + 0.956 * y.y + 0.621 * y.z, y.x - 0.272 * y.y - 0.647 * y.z, y.x - 1.106 * y.y + 1.703 * y.z); }
vec3 src(vec2 p) {
  vec3 c = tex(p);
  if (uOsdOn > 0.5) { vec4 o = texture2D(uOsd, clamp(p, 0.0, 1.0)); c = mix(c, o.rgb, o.a); }
  return c;
}
vec4 effect(vec2 uv) {
  float lineH = max(1.0, 2.0 * uK);
  float line = floor(uv.y * uRes.y / lineH);
  vec2 p = uv;
  p.x += (hash(vec2(line, uFrame)) - 0.5) * uWobble * 0.0025;
  float bandY = fract(uTime * 0.11 + hash1(floor(uTime * 0.25)) * 0.6);
  float dy = uv.y - bandY;
  float band = exp(-dy * dy * 700.0) * uTracking;
  p.x += band * (hash(vec2(line, uFrame * 1.3)) - 0.35) * 0.04;
  float hs = smoothstep(0.955, 0.985, uv.y) * uTracking;
  p.x += hs * (0.012 + 0.02 * hash(vec2(line, uFrame)));
  float Y = rgb2yiq(src(p)).x;
  vec2 iq = vec2(0.0);
  float bl = uBleed * uK / uRes.x;
  for (int i = 0; i < 6; i++) { iq += rgb2yiq(src(p - vec2(bl * (float(i) + 1.0), 0.0))).yz; }
  iq /= 6.0;
  vec3 c = yiq2rgb(vec3(Y, iq * uSat));
  c += (hash(floor(uv * uRes / max(1.0, uK)) + uFrame * 3.17) - 0.5) * uNoise * 0.35;
  c += band * hash(vec2(floor(uv.x * uRes.x / (6.0 * max(1.0, uK))), line + uFrame)) * 0.7;
  c = mix(c, vec3(luma(c)), 0.12);
  return vec4(clamp(c, 0.0, 1.0), 1.0);
}`,
    uniforms: (s) => ({
      uBleed: s.vhsBleed,
      uTracking: s.vhsTracking,
      uNoise: s.vhsNoise,
      uWobble: s.vhsWobble,
      uSat: s.vhsSat,
      uOsdOn: s.vhsOsd ? 1 : 0,
    }),
    textures: (s, env) => ({
      uOsd: { canvas: env.osd.canvas, version: env.osd.version },
    }),
  },
  {
    id: "crt",
    name: "CRT",
    glsl: `
uniform float uCurve, uScan, uScanSize, uMask, uGlow, uVignette;
vec4 effect(vec2 uv) {
  vec2 q = uv * 2.0 - 1.0;
  q *= 1.0 + uCurve * 0.18 * dot(q.yx, q.yx) - uCurve * 0.06;
  vec2 p = q * 0.5 + 0.5;
  float edge = smoothstep(0.0, 0.006, p.x) * smoothstep(1.0, 0.994, p.x) * smoothstep(0.0, 0.006, p.y) * smoothstep(1.0, 0.994, p.y);
  vec3 c = tex(p);
  if (uGlow > 0.0) {
    vec2 r = vec2(3.0 * uK) / uRes;
    vec3 b = vec3(0.0);
    for (int i = 0; i < 8; i++) { float a = float(i) * PI / 4.0; b += tex(p + vec2(cos(a), sin(a)) * r * 2.0) + tex(p + vec2(cos(a), sin(a)) * r * 4.0); }
    b /= 16.0;
    c += max(b - 0.35, 0.0) * uGlow * 1.6 + b * uGlow * 0.12;
  }
  float period = max(2.0, uScanSize * uK);
  float s = 0.5 + 0.5 * cos(2.0 * PI * p.y * uRes.y / period);
  c *= mix(1.0, 0.45 + 0.55 * s, uScan) * (1.0 + uScan * 0.25);
  float mx = mod(floor(p.x * uRes.x / max(1.0, uK)), 3.0);
  vec3 mask = mx < 1.0 ? vec3(1.0, 0.72, 0.72) : mx < 2.0 ? vec3(0.72, 1.0, 0.72) : vec3(0.72, 0.72, 1.0);
  c *= mix(vec3(1.0), mask * 1.18, uMask);
  vec2 v = p - 0.5;
  c *= 1.0 - uVignette * dot(v, v) * 2.2;
  return vec4(clamp(c, 0.0, 1.0) * edge, 1.0);
}`,
    uniforms: (s) => ({
      uCurve: s.crtCurve,
      uScan: s.crtScan,
      uScanSize: s.crtScanSize,
      uMask: s.crtMask,
      uGlow: s.crtGlow,
      uVignette: s.crtVignette,
    }),
  },
];
