/**
 * Transition renderer. Every transition is drawn by one fragment shader that reads
 * frame A, frame B and an optional mask (text), plus `uProgress` (eased 0→1).
 * Falls back to the transition's Canvas 2D `draw2d` when WebGL is missing.
 *
 *   const engine = createEngine();
 *   engine.render(ctx, transition, frameA, frameB, { p, raw, params, duration, refresh });
 *
 * Coordinates: uv (0,0) is the top-left corner, like canvas pixels.
 */

const VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = vec2(aPos.x * 0.5 + 0.5, 0.5 - aPos.y * 0.5); gl_Position = vec4(aPos, 0.0, 1.0); }`;

/** Helpers every transition shader can use. A transition defines `vec4 transition(vec2 uv)`. */
export const GLSL_HEADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uA;
uniform sampler2D uB;
uniform sampler2D uMask;
uniform float uProgress;  // eased
uniform float uRaw;       // linear
uniform vec2 uRes;        // output size in px
uniform float uSeed;
#define PI 3.141592653589793
#define BLUR_N 24

float aspectRatio() { return uRes.x / uRes.y; }
vec2 mirrorUv(vec2 uv) { return 1.0 - abs(1.0 - mod(uv, 2.0)); }
vec4 getA(vec2 uv) { return texture2D(uA, mirrorUv(uv)); }
vec4 getB(vec2 uv) { return texture2D(uB, mirrorUv(uv)); }
vec4 getAB(float which, vec2 uv) { return which < 0.5 ? getA(uv) : getB(uv); }
vec4 getMask(vec2 uv) { return texture2D(uMask, clamp(uv, 0.0, 1.0)); }
float inBounds(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898, 78.233)) + uSeed * 7.13) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rand(i), rand(i + vec2(1.0, 0.0)), u.x), mix(rand(i + vec2(0.0, 1.0)), rand(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s / 0.9375;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec2 zoomAt(vec2 uv, vec2 c, float s) { return c + (uv - c) / s; }
vec2 rotateAt(vec2 uv, vec2 c, float a) {
  vec2 p = (uv - c) * vec2(aspectRatio(), 1.0);
  float cs = cos(a), sn = sin(a);
  p = vec2(cs * p.x - sn * p.y, sn * p.x + cs * p.y);
  return c + p / vec2(aspectRatio(), 1.0);
}
float sdRoundBox(vec2 p, vec2 b, float r) {
  vec2 q = abs(p) - b + r;
  return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}
float jitter() { return rand(vUv * uRes) - 0.5; }
// Blurs sample A (which = 0) or B (which = 1). delta / strength / angle are in uv units / radians.
vec4 dirBlur(float which, vec2 uv, vec2 delta) {
  vec4 acc = vec4(0.0);
  float j = jitter();
  for (int i = 0; i < BLUR_N; i++) { float f = (float(i) + 0.5 + j) / float(BLUR_N) - 0.5; acc += getAB(which, uv + delta * f); }
  return acc / float(BLUR_N);
}
vec4 zoomBlur(float which, vec2 uv, vec2 c, float strength) {
  vec4 acc = vec4(0.0);
  float j = jitter();
  for (int i = 0; i < BLUR_N; i++) { float f = (float(i) + 0.5 + j) / float(BLUR_N); acc += getAB(which, c + (uv - c) * (1.0 - strength * f)); }
  return acc / float(BLUR_N);
}
vec4 spinBlur(float which, vec2 uv, vec2 c, float angle) {
  vec4 acc = vec4(0.0);
  float j = jitter();
  for (int i = 0; i < BLUR_N; i++) { float f = (float(i) + 0.5 + j) / float(BLUR_N) - 0.5; acc += getAB(which, rotateAt(uv, c, angle * f)); }
  return acc / float(BLUR_N);
}
`;

const FOOTER = `
void main() { gl_FragColor = vec4(transition(vUv).rgb, 1.0); }`;

export function createEngine() {
  const glCanvas = document.createElement('canvas');
  let gl = null;
  try {
    gl = glCanvas.getContext('webgl', { alpha: false, antialias: false, premultipliedAlpha: false, preserveDrawingBuffer: false });
  } catch { gl = null; }
  glCanvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); gl = null; });

  let vs, buf, texA, texB, texMask, emptyMask;
  const programs = new Map(); // transition id → { prog, locs } | null (failed)

  if (gl) {
    vs = compile(gl.VERTEX_SHADER, VS);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    texA = makeTexture(); texB = makeTexture(); texMask = makeTexture();
    emptyMask = document.createElement('canvas'); emptyMask.width = emptyMask.height = 1;
  }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error(log);
    }
    return sh;
  }

  function makeTexture() {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  function program(tr) {
    if (programs.has(tr.id)) return programs.get(tr.id);
    let entry = null;
    try {
      const fs = compile(gl.FRAGMENT_SHADER, GLSL_HEADER + tr.glsl + FOOTER);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs); gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      entry = { prog, locs: new Map(), aPos: gl.getAttribLocation(prog, 'aPos') };
    } catch (err) {
      console.error(`Transition "${tr.id}" shader failed; using the 2D fallback.\n${err.message}`);
    }
    programs.set(tr.id, entry);
    return entry;
  }

  function loc(entry, name) {
    if (!entry.locs.has(name)) entry.locs.set(name, gl.getUniformLocation(entry.prog, name));
    return entry.locs.get(name);
  }

  function setUniform(entry, name, v) {
    const l = loc(entry, name);
    if (!l) return;
    if (typeof v === 'number' || typeof v === 'boolean') gl.uniform1f(l, +v);
    else if (v.length === 2) gl.uniform2fv(l, v);
    else if (v.length === 3) gl.uniform3fv(l, v);
    else if (v.length === 4) gl.uniform4fv(l, v);
  }

  function upload(unit, tex, src) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  /**
   * Draw transition `tr` between frames A and B (canvases the size of ctx) into ctx.
   * opts: { p (eased), raw, params, duration (s), refresh (called when an async asset like a font arrives) }
   */
  function render(ctx, tr, A, B, { p, raw, params, duration = 1, refresh, forceCanvas = false }) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const env = { W, H, k: Math.min(W, H) / 1080, p, raw, duration, refresh };
    env.mask = tr.mask ? tr.mask(params, env) : null;
    const entry = gl && !forceCanvas ? program(tr) : null;
    if (!entry) {
      (tr.draw2d || crossfade2d)(ctx, A, B, p, params, env);
      return 'canvas';
    }
    if (glCanvas.width !== W || glCanvas.height !== H) { glCanvas.width = W; glCanvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.useProgram(entry.prog);
    upload(0, texA, A);
    upload(1, texB, B);
    upload(2, texMask, env.mask || emptyMask);
    gl.uniform1i(loc(entry, 'uA'), 0);
    gl.uniform1i(loc(entry, 'uB'), 1);
    gl.uniform1i(loc(entry, 'uMask'), 2);
    setUniform(entry, 'uProgress', p);
    setUniform(entry, 'uRaw', raw);
    setUniform(entry, 'uRes', [W, H]);
    setUniform(entry, 'uSeed', params.seed ?? 1);
    const u = tr.uniforms ? tr.uniforms(params, env) : {};
    for (const [name, v] of Object.entries(u)) setUniform(entry, name, v);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(entry.aPos);
    gl.vertexAttribPointer(entry.aPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    ctx.drawImage(glCanvas, 0, 0);
    return 'webgl';
  }

  return {
    render,
    get webgl() { return !!gl; },
  };
}

function crossfade2d(ctx, A, B, p) {
  ctx.globalAlpha = 1; ctx.drawImage(A, 0, 0);
  ctx.globalAlpha = p; ctx.drawImage(B, 0, 0);
  ctx.globalAlpha = 1;
}
