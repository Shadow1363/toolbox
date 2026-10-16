/*
 * Scrolling Playlist: the overlay's drawing, shared with the registry's playlist effect.
 *
 *   const sheet = drawSheet(songs, s, { pos, playing, t, covers });   // flat glass panel on a canvas (sheet units → px)
 *   const curve = createCurve();                                      // WebGL; null without WebGL
 *   drawPlaylist(ctx, sheet, s, { cx, cy, scale, backdrop, curve });  // bent around a cylinder, faded, blurred backdrop
 *   placement(s, W, H, sheet) → { cx, cy, scale, box }               // where it goes on the canvas (box in 0..1)
 *
 * The sheet is drawn flat (a generic music-app look, no real logos): optional top bar (title, add / mix / edit,
 * shuffle, play button), `visibleRows` song rows scrolled by `pos` (rows), optional now-playing bar. The playing
 * row is tinted with the accent colour and shows animated bars. Then the sheet is bent like a wheel picker: each
 * point at height y from the centre sits on a cylinder (horizontal axis) at angle y / R, so rows near the top
 * and bottom tilt away, shrink and fade. Tilt / turn / roll rotate the whole thing; the perspective is a focal
 * length in px. WebGL draws it with perspective-correct texturing; without WebGL the rows are drawn one by one
 * in 2D with the same per-row scale and fade (no tilt).
 */
import { roundRectPath, scratch, drawBlurred } from '/assets/js/lib/canvas.js';
import { hash } from '/assets/js/lib/random.js';

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
const SHEET_W = 1000;     // sheet units across
const ROW = 150, TOP = 230, BOTTOM = 190, PAD = 34;

export const PLAYLIST_DEFAULTS = {
  title: 'Late night drive', showTop: true, showBottom: true, device: 'Living room speaker',
  accent: '#1ed760', bgColor: '#121212', bgOpacity: 0.55, blur: 24, textOpacity: 1,
  visibleRows: 6, x: 50, y: 50, size: 62, rotation: 0,
  curvature: 0.55, tilt: 0, turn: -14, perspective: 1600, fade: 0.5,
};

/* ---------- Generated covers ---------- */
/** A gradient cover for a song without art: two colours and initials, seeded by the title + artist. */
export function gradientCover(title, artist, size = 160) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const h0 = hash(...[...`${title}|${artist}`].map((ch) => ch.charCodeAt(0)));
  const hue = Math.floor(h0 * 360), hue2 = (hue + 40 + Math.floor(hash(h0 * 97) * 80)) % 360;
  const g = x.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, `hsl(${hue} 70% 55%)`);
  g.addColorStop(1, `hsl(${hue2} 65% 30%)`);
  x.fillStyle = g;
  x.fillRect(0, 0, size, size);
  x.fillStyle = 'rgba(255,255,255,.9)';
  x.font = `800 ${size * 0.34}px ${FONT}`;
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  const initials = `${title || ''}`.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '♪';
  x.fillText(initials, size / 2, size / 2 + size * 0.02);
  return c;
}

/* ---------- Icons (24-unit outlines) ---------- */
const ICONS = {
  plus: 'M12 5v14M5 12h14',
  mix: 'M4 7h10M18 7h2M4 17h4M12 17h8M14 4v6M8 14v6',
  edit: 'M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  dots: '',
  device: 'M4 5h16v11H4zM9 20h6M12 16v4',
  pause: 'M7 4h3v16H7zM14 4h3v16h-3z',
  play: 'M7 4v16l13-8z',
  prev: 'M18 5v14L8 12zM6 5v14',
  next: 'M6 5v14l10-7zM18 5v14',
  heart: 'M12 20.6s-7.6-4.7-9.7-9.3C.8 7.8 3 4 6.7 4c2.2 0 3.7 1.3 5.3 3.2C13.6 5.3 15.1 4 17.3 4 21 4 23.2 7.8 21.7 11.3 19.6 15.9 12 20.6 12 20.6z',
};
const paths = {};
function icon(x, name, cx, cy, size, color, fill = false) {
  if (name === 'dots') {
    x.fillStyle = color;
    for (const d of [-1, 0, 1]) { x.beginPath(); x.arc(cx + d * size * 0.28, cy, size * 0.09, 0, Math.PI * 2); x.fill(); }
    return;
  }
  x.save();
  x.translate(cx - size / 2, cy - size / 2);
  x.scale(size / 24, size / 24);
  x.lineWidth = 2;
  x.lineCap = 'round';
  x.lineJoin = 'round';
  const p = (paths[name] ||= new Path2D(ICONS[name]));
  if (fill) { x.fillStyle = color; x.fill(p); } else { x.strokeStyle = color; x.stroke(p); }
  x.restore();
}

function fitText(x, text, max) {
  if (x.measureText(text).width <= max) return text;
  let t = text;
  while (t.length > 1 && x.measureText(`${t}…`).width > max) t = t.slice(0, -1);
  return `${t}…`;
}

/** Sheet size in units for the settings. */
export const sheetUnits = (s) => ({ w: SHEET_W, h: (s.showTop ? TOP : 0) + s.visibleRows * ROW + (s.showBottom ? BOTTOM : 0) + 20 });

/** Where the rows sit in the sheet (units): top y and row height. */
export const rowsArea = (s) => ({ top: (s.showTop ? TOP : 0) + 10, row: ROW, count: s.visibleRows });

/**
 * Draw the flat sheet at `px` px per unit into a scratch canvas and return it.
 * songs: [{ title, artist, video }]; covers: array of drawables (same order) or null; pos: scroll in rows;
 * playing: index of the now-playing song; t: seconds (for the playing bars).
 */
export function drawSheet(songs, s, { pos = 0, playing = 0, t = 0, covers = [], px = 1, name = 'pl-sheet' } = {}) {
  const U = sheetUnits(s);
  const W = Math.round(U.w * px), H = Math.round(U.h * px);
  const c = scratch(`${name}-${W}x${H}`, W, H);
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  x.save();
  x.scale(px, px);
  const accent = s.accent || '#1ed760';
  const text = `rgba(255,255,255,${s.textOpacity})`;
  const sub = `rgba(255,255,255,${0.62 * s.textOpacity})`;

  // Glass panel
  x.beginPath();
  roundRectPath(x, 0, 0, U.w, U.h, 46);
  x.fillStyle = hexA(s.bgColor || '#121212', s.bgOpacity);
  x.fill();
  x.lineWidth = 2;
  x.strokeStyle = 'rgba(255,255,255,.12)';
  x.stroke();

  x.textBaseline = 'middle';
  if (s.showTop) {
    x.fillStyle = text;
    x.font = `800 ${58}px ${FONT}`;
    x.fillText(fitText(x, s.title || 'Playlist', U.w - PAD * 2), PAD, 70);
    x.fillStyle = sub;
    x.font = `500 ${30}px ${FONT}`;
    x.fillText(`${songs.length} songs`, PAD, 122);
    const y = 180;
    icon(x, 'plus', PAD + 26, y, 46, sub);
    icon(x, 'mix', PAD + 106, y, 44, sub);
    icon(x, 'edit', PAD + 186, y, 42, sub);
    icon(x, 'shuffle', U.w - PAD - 170, y, 46, accent);
    x.beginPath(); x.arc(U.w - PAD - 56, y - 6, 56, 0, Math.PI * 2);
    x.fillStyle = accent; x.fill();
    icon(x, 'play', U.w - PAD - 52, y - 6, 52, '#000', true);
  }

  // Rows, clipped to their area.
  const area = rowsArea(s);
  x.save();
  x.beginPath();
  x.rect(0, area.top, U.w, area.count * ROW);
  x.clip();
  const first = Math.max(0, Math.floor(pos) - 1), last = Math.min(songs.length - 1, Math.ceil(pos + area.count) + 1);
  for (let i = first; i <= last; i++) {
    const song = songs[i];
    const y = area.top + (i - pos) * ROW;
    const cy = y + ROW / 2;
    const isPlaying = i === playing;
    if (isPlaying) {
      x.beginPath(); roundRectPath(x, 12, y + 6, U.w - 24, ROW - 12, 24);
      x.fillStyle = hexA(accent, 0.14); x.fill();
    }
    const cov = covers[i];
    x.save();
    x.beginPath(); roundRectPath(x, PAD, cy - 54, 108, 108, 12); x.clip();
    if (cov) x.drawImage(cov, PAD, cy - 54, 108, 108);
    else { x.fillStyle = '#333'; x.fillRect(PAD, cy - 54, 108, 108); }
    x.restore();
    let tx = PAD + 108 + 30;
    const maxW = U.w - tx - 110;
    if (isPlaying) {
      // Animated "now playing" bars before the title.
      x.fillStyle = accent;
      for (let b = 0; b < 3; b++) {
        const hgt = 10 + 22 * (0.5 + 0.5 * Math.sin(t * 7 + b * 1.9));
        x.fillRect(tx + b * 11, cy - 16 - hgt / 2 + 0, 7, hgt);
      }
      tx += 44;
    }
    x.fillStyle = isPlaying ? accent : text;
    x.font = `600 ${40}px ${FONT}`;
    x.fillText(fitText(x, song.title || 'Untitled', maxW - (isPlaying ? 44 : 0)), tx, cy - 20);
    let ax = PAD + 108 + 30;
    if (song.video) {
      x.font = `700 ${22}px ${FONT}`;
      const tw = x.measureText('VIDEO').width + 18;
      x.beginPath(); roundRectPath(x, ax, cy + 6, tw, 34, 6);
      x.fillStyle = 'rgba(255,255,255,.18)'; x.fill();
      x.fillStyle = text;
      x.fillText('VIDEO', ax + 9, cy + 24);
      ax += tw + 12;
    }
    x.fillStyle = sub;
    x.font = `500 ${32}px ${FONT}`;
    x.fillText(fitText(x, song.artist || '', U.w - ax - 110), ax, cy + 24);
    icon(x, 'dots', U.w - PAD - 30, cy, 54, sub);
  }
  if (!songs.length) {
    x.fillStyle = sub;
    x.font = `500 ${34}px ${FONT}`;
    x.textAlign = 'center';
    x.fillText('Add songs on the left', U.w / 2, area.top + (area.count * ROW) / 2);
    x.textAlign = 'left';
  }
  x.restore();

  if (s.showBottom) {
    const top = U.h - BOTTOM;
    x.beginPath(); roundRectPath(x, 16, top, U.w - 32, BOTTOM - 22, 30);
    x.fillStyle = 'rgba(255,255,255,.1)'; x.fill();
    const song = songs[playing] || songs[0];
    const cy = top + (BOTTOM - 22) / 2;
    const cov = covers[songs.indexOf(song)];
    x.save();
    x.beginPath(); roundRectPath(x, 40, cy - 46, 92, 92, 10); x.clip();
    if (cov) x.drawImage(cov, 40, cy - 46, 92, 92); else { x.fillStyle = '#333'; x.fillRect(40, cy - 46, 92, 92); }
    x.restore();
    const tx = 160, maxW = U.w - tx - 220;
    x.fillStyle = text;
    x.font = `700 ${36}px ${FONT}`;
    x.fillText(fitText(x, song ? `${song.title}${song.artist ? ` · ${song.artist}` : ''}` : 'Nothing playing', maxW), tx, cy - 18);
    icon(x, 'device', tx + 16, cy + 26, 30, accent);
    x.fillStyle = accent;
    x.font = `600 ${28}px ${FONT}`;
    x.fillText(fitText(x, s.device || '', maxW - 40), tx + 42, cy + 27);
    icon(x, 'heart', U.w - 170, cy, 46, text);
    icon(x, 'pause', U.w - 84, cy, 50, text, true);
    // Progress line
    const prog = ((t % 30) / 30);
    x.fillStyle = 'rgba(255,255,255,.2)';
    x.fillRect(40, top + BOTTOM - 36, U.w - 80, 5);
    x.fillStyle = text;
    x.fillRect(40, top + BOTTOM - 36, (U.w - 80) * prog, 5);
  }
  x.restore();
  c.px = px;
  return c;
}

const hexA = (hex, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
  const n = m ? parseInt(m[1], 16) : 0x121212;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};

/* ---------- Placement and the curve ---------- */
/** Canvas placement: centre, px per sheet unit, and the flat box in 0..1 of the canvas (for hand engagement). */
export function placement(s, W, H) {
  const U = sheetUnits(s);
  const scale = (W * (s.size / 100)) / U.w;
  const cx = (W * s.x) / 100, cy = (H * s.y) / 100;
  const w = U.w * scale, h = U.h * scale;
  return { cx, cy, scale, box: { x: (cx - w / 2) / W, y: (cy - h / 2) / H, w: w / W, h: h / H } };
}

/** Project sheet point (u, v in 0..1) → [screenX, screenY, w, fade]. */
function project(u, v, g) {
  const X0 = (u - 0.5) * g.w, Y0 = (v - 0.5) * g.h;
  let X = X0, Y = Y0, Z = 0, th = 0;
  if (g.curvature > 0.001) {
    const arc = g.curvature * Math.PI; // total angle the sheet covers
    const R = g.h / arc;
    th = Y0 / R;
    Y = R * Math.sin(th);
    Z = R * (1 - Math.cos(th));
  }
  const rad = Math.PI / 180;
  let c = Math.cos(g.tilt * rad), s = Math.sin(g.tilt * rad);
  [Y, Z] = [Y * c - Z * s, Y * s + Z * c];
  c = Math.cos(g.turn * rad); s = Math.sin(g.turn * rad);
  [X, Z] = [X * c + Z * s, -X * s + Z * c];
  c = Math.cos(g.rotation * rad); s = Math.sin(g.rotation * rad);
  [X, Y] = [X * c - Y * s, X * s + Y * c];
  const w = Math.max(0.2, (g.focal + Z) / g.focal);
  const edge = g.curvature > 0.001 ? Math.abs(th) / ((g.curvature * Math.PI) / 2) : Math.abs(v - 0.5) * 2;
  const fade = Math.max(0, 1 - g.fade * edge ** 2.2);
  return [g.cx + X / w, g.cy + Y / w, w, fade];
}

const VS = `
attribute vec4 a_pos; attribute vec2 a_uv; attribute float a_alpha;
varying vec2 v_uv; varying float v_alpha;
void main() { gl_Position = a_pos; v_uv = a_uv; v_alpha = a_alpha; }`;
const FS = `
precision mediump float;
uniform sampler2D u_tex; varying vec2 v_uv; varying float v_alpha;
void main() { gl_FragColor = texture2D(u_tex, v_uv) * v_alpha; }`;

/** A WebGL renderer for the bent sheet, or null without WebGL. */
export function createCurve() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl', { premultipliedAlpha: true, preserveDrawingBuffer: true, alpha: true, antialias: true });
  if (!gl) return null;
  const sh = (type, src) => { const o = gl.createShader(type); gl.shaderSource(o, src); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(o)); return o; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FS));
  gl.linkProgram(prog);
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  const F = 4, STRIDE = 7;
  const attr = (n, size, off) => { const l = gl.getAttribLocation(prog, n); gl.enableVertexAttribArray(l); gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * F, off * F); };
  attr('a_pos', 4, 0); attr('a_uv', 2, 4); attr('a_alpha', 1, 6);
  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  const COLS = 12, ROWS = 48;
  return {
    /** Draw `sheet` bent by geometry g; returns the W×H WebGL canvas. */
    draw(sheet, g, W, H) {
      if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
      gl.viewport(0, 0, W, H);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sheet);
      const grid = [];
      for (let j = 0; j <= ROWS; j++) for (let i = 0; i <= COLS; i++) grid.push(project(i / COLS, j / ROWS, g));
      const data = new Float32Array(ROWS * COLS * 6 * STRIDE);
      let o = 0;
      const put = (i, j) => {
        const [x, y, w, a] = grid[j * (COLS + 1) + i];
        data.set([((x / W) * 2 - 1) * w, (1 - (y / H) * 2) * w, 0, w, i / COLS, j / ROWS, a], o);
        o += STRIDE;
      };
      for (let j = 0; j < ROWS; j++) for (let i = 0; i < COLS; i++) {
        put(i, j); put(i + 1, j); put(i + 1, j + 1);
        put(i, j); put(i + 1, j + 1); put(i, j + 1);
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, ROWS * COLS * 6);
      return canvas;
    },
  };
}

/** Geometry for project() from the panel and placement. */
export function geometry(s, sheet, place) {
  return {
    cx: place.cx, cy: place.cy, w: (sheet.width / sheet.px) * place.scale, h: (sheet.height / sheet.px) * place.scale,
    curvature: s.curvature, tilt: s.tilt, turn: s.turn, rotation: s.rotation, focal: s.perspective * (place.scale * 1.6), fade: s.fade,
  };
}

/** The bent sheet's outline as a polygon (for the blurred backdrop). */
export function outline(g, n = 24) {
  const pts = [];
  for (let i = 0; i <= n; i++) pts.push(project(i / n, 0, g));
  for (let j = 0; j <= n; j++) pts.push(project(1, j / n, g));
  for (let i = n; i >= 0; i--) pts.push(project(i / n, 1, g));
  for (let j = n; j >= 0; j--) pts.push(project(0, j / n, g));
  return pts;
}

/**
 * Draw the overlay onto ctx: blurred backdrop inside the bent outline (from `backdrop`, the frame under it),
 * then the bent sheet. `sheet.px` = px per unit the sheet was drawn at.
 */
export function drawPlaylist(ctx, sheet, s, { place, backdrop = null, curve = null }) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const g = geometry(s, sheet, place);
  if (backdrop && s.blur > 0) {
    const poly = outline(g);
    ctx.save();
    ctx.beginPath();
    poly.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    // Same position as the frame, so the blur shows exactly what's behind the glass.
    drawBlurred(ctx, backdrop, 0, 0, W, H, s.blur * place.scale * 2.2);
    ctx.restore();
  }
  if (curve) {
    ctx.drawImage(curve.draw(sheet, g, W, H), 0, 0);
    return;
  }
  // 2D fallback: horizontal strips with the curve's per-strip scale and fade (no tilt or turn).
  const strips = 40;
  const sh = sheet.height / strips;
  for (let j = 0; j < strips; j++) {
    const [x0, , , a] = project(0, (j + 0.5) / strips, { ...g, tilt: 0, turn: 0 });
    const [x1] = project(1, (j + 0.5) / strips, { ...g, tilt: 0, turn: 0 });
    const top = project(0.5, j / strips, { ...g, tilt: 0, turn: 0 })[1];
    const bot = project(0.5, (j + 1) / strips, { ...g, tilt: 0, turn: 0 })[1];
    ctx.globalAlpha = a;
    ctx.drawImage(sheet, 0, j * sh, sheet.width, sh, Math.min(x0, x1), top, Math.abs(x1 - x0), Math.max(0.5, bot - top + 0.5));
  }
  ctx.globalAlpha = 1;
}

/**
 * Which song row is under canvas point (x, y) in 0..1, for a pinch: the flat (un-bent) mapping, good enough near
 * the middle where people pinch. Returns null outside the rows.
 */
export function rowAtPoint(s, place, W, H, pos, x, y, count) {
  const U = sheetUnits(s);
  const area = rowsArea(s);
  const r = (-s.rotation * Math.PI) / 180;
  const dx = x * W - place.cx, dy = y * H - place.cy;
  const ly = (dx * Math.sin(r) + dy * Math.cos(r)) / place.scale + U.h / 2;
  const row = Math.floor(pos + (ly - area.top) / area.row);
  if (ly < area.top || ly > area.top + area.count * area.row || row < 0 || row >= count) return null;
  return row;
}
