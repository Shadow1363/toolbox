/*
 * Retro Looks: multi-pass WebGL renderer. The source frame is uploaded once, then each enabled effect
 * runs as a full-screen fragment shader, ping-ponging between two framebuffers; the last pass draws to
 * the GL canvas, which the caller copies onto the 2D preview.

 *
 *   const engine = createRetroEngine();             // null when WebGL is unavailable
 *   const out = engine.render(source, W, H, passes, { time, frame, k });
 *   // passes: [{ id, glsl, uniforms: { name: number | [..] }, textures?: { uName: { canvas, version } } }]
 *   ctx.drawImage(out, 0, 0);
 *
 * Shaders get the HEADER below and define `vec4 effect(vec2 uv)`. uv (0,0) is the top-left corner.
 */

const VS = `
attribute vec2 aPos;
uniform float uFlip;
varying vec2 vUv;
void main() {
  vUv = vec2(aPos.x * 0.5 + 0.5, uFlip > 0.5 ? 0.5 - aPos.y * 0.5 : 0.5 + aPos.y * 0.5);
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

export const HEADER = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uTex;   // the previous pass (or the source frame)
uniform vec2 uRes;        // output size in px
uniform float uTime;      // seconds
uniform float uFrame;     // frame index at 24 fps: seeds all noise, so preview and export match
uniform float uK;         // min(W, H) / 1080: scale for pixel-sized parameters
#define PI 3.141592653589793
float hash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float hash1(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
vec3 tex(vec2 uv) { return texture2D(uTex, clamp(uv, 0.0, 1.0)).rgb; }
`;

const FOOTER = `
void main() { gl_FragColor = effect(vUv); }`;

export function createRetroEngine() {
  const canvas = document.createElement("canvas");
  let gl = null;
  try {
    gl = canvas.getContext("webgl", {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      preserveDrawingBuffer: false,
    });
  } catch {
    gl = null;
  }
  if (!gl) return null;
  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault();
    lost = true;
  });
  canvas.addEventListener("webglcontextrestored", () => {
    lost = false;
    init();
  });
  let lost = false;

  let vs, buf, srcTex, fbos, programs, extra;
  function init() {
    vs = compile(gl.VERTEX_SHADER, VS);
    buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW,
    );
    srcTex = makeTexture();
    fbos = [null, null];
    programs = new Map();
    extra = new Map(); // uniform name → { tex, version, canvas }
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

  function fbo(i, W, H) {
    let f = fbos[i];
    if (f && f.w === W && f.h === H) return f;
    if (f) {
      gl.deleteFramebuffer(f.fb);
      gl.deleteTexture(f.tex);
    }
    const tex = makeTexture();
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      W,
      H,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      tex,
      0,
    );
    f = { fb, tex, w: W, h: H };
    fbos[i] = f;
    return f;
  }

  function program(pass) {
    const key = pass.key || pass.id;
    if (programs.has(key)) return programs.get(key);
    let entry = null;
    try {
      const fs = compile(gl.FRAGMENT_SHADER, HEADER + pass.glsl + FOOTER);
      const prog = gl.createProgram();
      gl.attachShader(prog, vs);
      gl.attachShader(prog, fs);
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
        throw new Error(gl.getProgramInfoLog(prog));
      entry = {
        prog,
        locs: new Map(),
        aPos: gl.getAttribLocation(prog, "aPos"),
      };
    } catch (err) {
      console.error(
        `Retro effect "${key}" failed to compile; skipping it.\n${err.message}`,
      );
    }
    programs.set(key, entry);
    return entry;
  }

  const loc = (e, name) => {
    if (!e.locs.has(name))
      e.locs.set(name, gl.getUniformLocation(e.prog, name));
    return e.locs.get(name);
  };

  function setUniform(e, name, v) {
    const l = loc(e, name);
    if (l == null) return;
    if (typeof v === "number") gl.uniform1f(l, v);
    else if (v.length === 2) gl.uniform2fv(l, v);
    else if (v.length === 3) gl.uniform3fv(l, v);
    else if (v.length === 4) gl.uniform4fv(l, v);
    else gl.uniform3fv(l, v); // vec3 arrays (palettes): flat list, length a multiple of 3
  }

  /** Upload an extra texture (e.g. glyph atlas, VHS on-screen text) only when its version changes. */
  function bindExtra(e, name, { canvas: c, version }, unit) {
    // Select the unit first: makeTexture() binds to the active unit, and unit 0 holds the pass input.
    gl.activeTexture(gl.TEXTURE0 + unit);
    let x = extra.get(name);
    if (!x) {
      x = { tex: makeTexture(), version: -1 };
      extra.set(name, x);
    }
    gl.bindTexture(gl.TEXTURE_2D, x.tex);
    if (x.version !== version) {
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, c);
      x.version = version;
    }
    const l = loc(e, name);
    if (l != null) gl.uniform1i(l, unit);
  }

  init();

  return {
    canvas,
    get lost() {
      return lost;
    },
    render(source, W, H, passes, { time = 0, frame = 0, k = 1 } = {}) {
      if (lost) return null;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      gl.viewport(0, 0, W, H);
      gl.disable(gl.BLEND);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, srcTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        source,
      );
      const list = passes.map((p) => ({ p, e: program(p) })).filter((x) => x.e);
      if (!list.length)
        list.push({
          p: { id: "copy" },
          e: program({
            id: "copy",
            glsl: "vec4 effect(vec2 uv) { return texture2D(uTex, uv); }",
          }),
        });
      let input = srcTex;
      list.forEach(({ p, e }, i) => {
        const last = i === list.length - 1;
        const target = last ? null : fbo(i % 2, W, H);
        gl.bindFramebuffer(gl.FRAMEBUFFER, target ? target.fb : null);
        gl.useProgram(e.prog);
        gl.bindBuffer(gl.ARRAY_BUFFER, buf);
        gl.enableVertexAttribArray(e.aPos);
        gl.vertexAttribPointer(e.aPos, 2, gl.FLOAT, false, 0, 0);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, input);
        gl.uniform1i(loc(e, "uTex"), 0);
        setUniform(e, "uFlip", last ? 1 : 0);
        setUniform(e, "uRes", [W, H]);
        setUniform(e, "uTime", time);
        setUniform(e, "uFrame", frame);
        setUniform(e, "uK", k);
        for (const [name, v] of Object.entries(p.uniforms || {}))
          setUniform(e, name, v);
        let unit = 1;
        for (const [name, t] of Object.entries(p.textures || {}))
          bindExtra(e, name, t, unit++);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
        if (target) input = target.tex;
      });
      return canvas;
    },
  };
}
