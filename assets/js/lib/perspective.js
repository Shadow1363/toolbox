/**
 * 3D perspective for flat layers. Canvas 2D can only do affine transforms, so a
 * tiny WebGL renderer draws a texture onto a projected quad with
 * perspective-correct mapping.
 *
 *   const persp = createPerspective();
 *   const quad = projectRect(w, h, { rx: 10, ry: -20, scale: 1, x: cx, y: cy });
 *   if (persp) ctx.drawImage(persp.draw(cardCanvas, quad, W, H), 0, 0);
 */

/** Rotate a local point (x,y,0) and project it. Returns [screenX, screenY, w]. */
export function projectPoint(px, py, { rx = 0, ry = 0, rz = 0, scale = 1, x = 0, y = 0, focal = 2000 }) {
  const toRad = Math.PI / 180;
  let X = px * scale, Y = py * scale, Z = 0;
  // rotate Z
  let c = Math.cos(rz * toRad), s = Math.sin(rz * toRad);
  [X, Y] = [X * c - Y * s, X * s + Y * c];
  // rotate X (tilt forward/back)
  c = Math.cos(rx * toRad); s = Math.sin(rx * toRad);
  [Y, Z] = [Y * c - Z * s, Y * s + Z * c];
  // rotate Y (turn left/right)
  c = Math.cos(ry * toRad); s = Math.sin(ry * toRad);
  [X, Z] = [X * c + Z * s, -X * s + Z * c];
  const w = (focal + Z) / focal;
  return [x + X / w, y + Y / w, w];
}

/** Corners TL, TR, BR, BL of a w×h rect centred on the origin. */
export function projectRect(w, h, t) {
  return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]].map(([px, py]) => projectPoint(px, py, t));
}

const VS = `
attribute vec4 a_pos;
attribute vec2 a_uv;
attribute float a_shade;
varying vec2 v_uv;
varying float v_shade;
void main() { gl_Position = a_pos; v_uv = a_uv; v_shade = a_shade; }`;
const FS = `
precision mediump float;
uniform sampler2D u_tex;
uniform float u_alpha;
varying vec2 v_uv;
varying float v_shade;
void main() {
  vec4 c = texture2D(u_tex, v_uv);
  gl_FragColor = vec4(c.rgb * v_shade, c.a) * u_alpha;
}`;

const STRIDE = 7; // x, y, z, w, u, v, shade

export function createPerspective() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: true, depth: true });
  if (!gl) return null;

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
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const F = Float32Array.BYTES_PER_ELEMENT;
  const attr = (name, size, offset) => {
    const loc = gl.getAttribLocation(prog, name);
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * F, offset * F);
  };
  attr('a_pos', 4, 0);
  attr('a_uv', 2, 4);
  attr('a_shade', 1, 6);
  const uAlpha = gl.getUniformLocation(prog, 'u_alpha');

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

  function begin(src, W, H, depth) {
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (depth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); } else gl.disable(gl.DEPTH_TEST);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  }

  return {
    /**
     * Draw `src` onto `quad` (4 corners TL, TR, BR, BL as [x, y, w] in pixels, e.g. from projectRect)
     * and return the WebGL canvas (W×H). `shade` darkens (<1) or brightens (>1) the colours.
     */
    draw(src, quad, W, H, alpha = 1, shade = 1) {
      begin(src, W, H, false);
      const v = quad.map(([x, y, w]) => [((x / W) * 2 - 1) * w, (1 - (y / H) * 2) * w, 0, w]);
      const uv = [[0, 0], [1, 0], [1, 1], [0, 1]];
      const data = [];
      for (const i of [0, 1, 2, 0, 2, 3]) data.push(...v[i], ...uv[i], shade);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.DYNAMIC_DRAW);
      gl.uniform1f(uAlpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      return canvas;
    },

    /**
     * Draw a textured triangle mesh. `verts` is a flat array of
     * [x, y, z, u, v, shade] per vertex (pixels, z in -1..1 for depth sorting, uv 0..1),
     * three vertices per triangle. No perspective; returns the WebGL canvas (W×H).
     */
    drawMesh(src, verts, W, H, alpha = 1) {
      begin(src, W, H, true);
      const n = verts.length / 6;
      const data = new Float32Array(n * STRIDE);
      for (let i = 0; i < n; i++) {
        const a = i * 6, b = i * STRIDE;
        data[b] = (verts[a] / W) * 2 - 1;
        data[b + 1] = 1 - (verts[a + 1] / H) * 2;
        data[b + 2] = verts[a + 2];
        data[b + 3] = 1;
        data[b + 4] = verts[a + 3];
        data[b + 5] = verts[a + 4];
        data[b + 6] = verts[a + 5];
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.uniform1f(uAlpha, alpha);
      gl.drawArrays(gl.TRIANGLES, 0, n);
      return canvas;
    },
  };
}
