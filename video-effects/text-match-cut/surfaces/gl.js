/**
 * WebGL pass for logo surfaces: bend a logo layer along a height map (folds, bricks,
 * wrinkles) and light it from the same map. One shared context, created on first use.
 *
 *   glDisplace(art, height, { strength, shade, light }) → canvas (art's size) or null without WebGL
 *
 * art: the logo layer (any canvas, transparent around the logo).
 * height: a grey canvas the same size (white = high). The logo is pushed along the slope
 * by `strength` px per unit of slope and shaded by `shade` (0 = flat) with light from `light` [x, y].
 */

const VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = vec2(a_pos.x * 0.5 + 0.5, 0.5 - a_pos.y * 0.5);
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform sampler2D u_art;
uniform sampler2D u_height;
uniform vec2 u_texel;
uniform float u_strength;
uniform float u_shade;
uniform vec2 u_light;
varying vec2 v_uv;
float hgt(vec2 p) { return texture2D(u_height, p).r; }
void main() {
  vec2 dx = vec2(u_texel.x * 3.0, 0.0), dy = vec2(0.0, u_texel.y * 3.0);
  // slope in height units per pixel
  vec2 g = vec2(hgt(v_uv + dx) - hgt(v_uv - dx), hgt(v_uv + dy) - hgt(v_uv - dy)) / 6.0;
  vec4 c = texture2D(u_art, v_uv - g * u_strength * u_texel);
  vec3 n = normalize(vec3(-g * 60.0, 1.0));
  vec3 l = normalize(vec3(u_light, 0.8));
  float lit = dot(n, l) / l.z;
  gl_FragColor = vec4(clamp(c.rgb * mix(1.0, lit, u_shade), 0.0, 1.0) * step(0.0, c.a), c.a);
}`;

let state = null; // { canvas, gl, locs, texArt, texHeight } | false when WebGL is unavailable

function init() {
  if (state !== null) return state;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true });
    if (!gl) return (state = false);
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
      return sh;
    };
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
    const pos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(pos);
    gl.vertexAttribPointer(pos, 2, gl.FLOAT, false, 0, 0);
    const texture = (unit) => {
      gl.activeTexture(gl.TEXTURE0 + unit);
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      return t;
    };
    const texArt = texture(0);
    const texHeight = texture(1);
    const u = (name) => gl.getUniformLocation(prog, name);
    gl.uniform1i(u('u_art'), 0);
    gl.uniform1i(u('u_height'), 1);
    const locs = { texel: u('u_texel'), strength: u('u_strength'), shade: u('u_shade'), light: u('u_light') };
    canvas.addEventListener('webglcontextlost', () => { state = null; });
    state = { canvas, gl, locs, texArt, texHeight };
  } catch (err) {
    console.warn('Logo surfaces: WebGL displacement unavailable', err);
    state = false;
  }
  return state;
}

export function glDisplace(art, height, { strength = 0, shade = 0, light = [-0.6, -0.8] } = {}) {
  const st = init();
  if (!st) return null;
  const { canvas, gl, locs } = st;
  const W = art.width, H = art.height;
  if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
  gl.viewport(0, 0, W, H);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, st.texArt);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, art);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, st.texHeight);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, height);
  gl.uniform2f(locs.texel, 1 / W, 1 / H);
  gl.uniform1f(locs.strength, strength);
  gl.uniform1f(locs.shade, shade);
  gl.uniform2f(locs.light, light[0], light[1]);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  return canvas;
}
