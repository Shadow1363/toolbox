/*
 * Magic Mask: the wipe between clip A (wiped away) and clip B (revealed), shared with the registry's magic-mask effect.
 *
 *   const g = wipeGeometry({ kind, angle, p, W, H, subject, follow, shape });   // where the edge is at progress p
 *   drawRemain(ctx, g, feather);   // alpha over the frame: 1 where A still shows, 0 where B is revealed
 *   drawEdgeGlow(ctx, g, { color, width, k });
 *
 * kind 'line': a straight edge at `angle` (degrees, the direction the wipe travels) sweeping across the frame.
 *   With `follow` (0..1) and a subject centre, the edge is pulled onto the subject in the middle of the wipe
 *   (weight follow·sin(πp)), so it starts and ends off-frame but travels with them in between.
 * kind 'iris': a circle growing from the centre (the subject's centre when following).
 * kind 'shape': a Shape Crop shape (Path2D of a 1000×1000 box) growing from the centre until it covers the frame.
 */

export const WIPE_KINDS = [['line', 'Straight edge'], ['iris', 'Circle'], ['shape', 'Shape']];

export function wipeGeometry({ kind = 'line', angle = 45, p = 0, W, H, subject = null, follow = 0, shape = null }) {
  const c = { x: W / 2, y: H / 2 };
  const sub = subject ? { x: subject.x * W, y: subject.y * H } : null;
  const pull = sub ? follow * Math.sin(Math.PI * Math.min(1, Math.max(0, p))) : 0;
  if (kind === 'line') {
    const a = (angle * Math.PI) / 180;
    const n = { x: Math.cos(a), y: Math.sin(a) };
    const R = (Math.abs(W * n.x) + Math.abs(H * n.y)) / 2;
    const lin = -R + 2 * R * p;
    const at = sub ? (sub.x - c.x) * n.x + (sub.y - c.y) * n.y : lin;
    return { kind, c, n, d: lin + (at - lin) * pull, R, W, H };
  }
  const centre = sub ? { x: c.x + (sub.x - c.x) * Math.max(follow, pull), y: c.y + (sub.y - c.y) * Math.max(follow, pull) } : c;
  const far = Math.max(...[[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => Math.hypot(x - centre.x, y - centre.y)));
  if (kind === 'iris' || !shape) return { kind: 'iris', c: centre, r: far * 1.04 * p, W, H };
  // Shapes are drawn in a 1000-unit box; 3.2 × the farthest corner covers the frame even for spiky shapes.
  return { kind, c: centre, scale: (far * 3.2 * p) / 1000, path: shape, W, H };
}

/** Fill ctx (cleared first) with white where A remains, feathered by `feather` px. */
export function drawRemain(ctx, g, feather = 0) {
  const { W, H } = g;
  ctx.save();
  ctx.clearRect(0, 0, W, H);
  const f = Math.max(0.5, feather);
  if (g.kind === 'line') {
    const { c, n, d } = g;
    const gr = ctx.createLinearGradient(c.x + n.x * (d - f / 2), c.y + n.y * (d - f / 2), c.x + n.x * (d + f / 2), c.y + n.y * (d + f / 2));
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, '#fff');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  } else if (g.kind === 'iris') {
    const r0 = Math.max(0, g.r - f / 2), r1 = Math.max(r0 + 0.5, g.r + f / 2);
    const gr = ctx.createRadialGradient(g.c.x, g.c.y, r0, g.c.x, g.c.y, r1);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(1, '#fff');
    ctx.fillStyle = gr;
    ctx.fillRect(0, 0, W, H);
  } else {
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.globalCompositeOperation = 'destination-out';
    if (feather > 0.5) ctx.filter = `blur(${feather / 2}px)`;
    shapeTransform(ctx, g);
    ctx.fill(g.path);
  }
  ctx.restore();
}

function shapeTransform(ctx, g) {
  ctx.translate(g.c.x, g.c.y);
  ctx.scale(g.scale, g.scale);
  ctx.translate(-500, -500);
}

/** A glowing line along the edge. */
export function drawEdgeGlow(ctx, g, { color = '#ffffff', width = 6, k = 1 } = {}) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width * k;
  ctx.shadowColor = color;
  ctx.shadowBlur = 24 * k;
  ctx.lineCap = 'round';
  ctx.beginPath();
  if (g.kind === 'line') {
    const { c, n, d } = g, L = g.W + g.H;
    const px = c.x + n.x * d, py = c.y + n.y * d;
    ctx.moveTo(px - n.y * L, py + n.x * L);
    ctx.lineTo(px + n.y * L, py - n.x * L);
    ctx.stroke();
  } else if (g.kind === 'iris') {
    if (g.r > 1) { ctx.arc(g.c.x, g.c.y, g.r, 0, Math.PI * 2); ctx.stroke(); }
  } else if (g.scale > 0) {
    shapeTransform(ctx, g);
    ctx.lineWidth = (width * k) / g.scale;
    ctx.shadowBlur = 24 * k;
    ctx.stroke(g.path);
  }
  ctx.restore();
}

/** A point on A's side and one on B's side of the edge (for tutorial labels), in px. */
export function sidePoints(g) {
  if (g.kind === 'line') {
    const { c, n, d, R } = g;
    const a = (d + R) / 2, b = (d - R) / 2;
    return { A: { x: c.x + n.x * a, y: c.y + n.y * a }, B: { x: c.x + n.x * b, y: c.y + n.y * b } };
  }
  const r = g.kind === 'iris' ? g.r : g.scale * 300;
  return { A: { x: g.W * 0.12, y: g.H * 0.12 }, B: { x: g.c.x + r * 0.4, y: g.c.y + r * 0.4 } };
}
