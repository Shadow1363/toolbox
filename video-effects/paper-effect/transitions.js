/**
 * Paper transitions: fold/unfold along creases and crumple/uncrumple into a ball.
 * Works on the finished paper card (media + torn edges + texture), so the shadow
 * drawn afterwards follows the moving paper.
 *
 *   transformCard(card, 'unfold-letter', p, { persp, paperColor, seed })
 *     p = 1 → the flat card (returned as-is), p = 0 → gone (null), in between → a new canvas,
 *     centred on the same point as the card.
 */
import { clamp, lerp, ease } from '/assets/js/lib/easing.js';
import { hash } from '/assets/js/lib/random.js';
import { scratch } from '/assets/js/lib/canvas.js';

export const ENTRANCES = [
  ['none', 'None'],
  ['unfold', 'Unfold (half)'],
  ['unfold-letter', 'Unfold (letter)'],
  ['uncrumple', 'Uncrumple'],
];

export const EXITS = [
  ['stay', 'None (stay on screen)'],
  ['fold', 'Fold (half)'],
  ['fold-letter', 'Fold (letter)'],
  ['crumple', 'Crumple'],
];

const SHAPE = { unfold: 'half', fold: 'half', 'unfold-letter': 'letter', 'fold-letter': 'letter', uncrumple: 'crumple', crumple: 'crumple' };

export function transformCard(card, anim, p, opts) {
  const shape = SHAPE[anim];
  if (!shape || p >= 1) return card;
  if (p <= 0) return null;
  return shape === 'crumple' ? crumple(card, p, opts) : fold(card, shape, p, opts);
}

/* ---------- Fold ---------- */

/*
 * Timeline (p: 0 → 1): the folded packet fades in during the first 15%, then unfolds.
 * half:   the right half swings over the front of the left half.
 * letter: folded in quarters. Stage 1 opens the side flap (bottom half hidden behind),
 *         stage 2 swings the bottom half down from behind.
 * The packet is kept centred, as if someone is holding it in the middle.
 */
function fold(card, shape, p, o) {
  const cw = card.width, ch = card.height;
  const W = Math.ceil(cw * 1.4), H = Math.ceil(ch * 1.4);
  const out = scratch('paper-fold', W, H);
  const c = out.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  const ox = (W - cw) / 2, oy = (H - ch) / 2;
  const env = { o, W, H, focal: 2.5 * Math.max(cw, ch) };

  const appear = clamp(p / 0.15);
  const u = clamp((p - 0.15) / 0.85); // 0 folded → 1 flat
  const settle = (th) => (1 - Math.cos(th)) / 2; // 1 when folded flat, 0 when open

  if (shape === 'half') {
    const th = Math.PI * (1 - u);
    const dx = (cw / 4) * settle(th);
    c.drawImage(card, 0, 0, cw / 2, ch, ox + dx, oy, cw / 2, ch);
    flap(c, card, [cw / 2, 0, cw / 2, ch], 'v', ox + dx + cw / 2, oy, th, true, env);
  } else if (u < 0.5) {
    const th = Math.PI * (1 - u / 0.5);
    const dx = (cw / 4) * settle(th), dy = ch / 4;
    c.drawImage(card, 0, 0, cw / 2, ch / 2, ox + dx, oy + dy, cw / 2, ch / 2);
    flap(c, card, [cw / 2, 0, cw / 2, ch / 2], 'v', ox + dx + cw / 2, oy + dy, th, true, env);
  } else {
    const th = Math.PI * (1 - (u - 0.5) / 0.5);
    const dy = (ch / 4) * settle(th);
    // bottom half comes from behind: draw it first, then the top half over it
    flap(c, card, [0, ch / 2, cw, ch / 2], 'h', oy + dy + ch / 2, ox, th, false, env);
    c.drawImage(card, 0, 0, cw, ch / 2, ox, oy + dy, cw, ch / 2);
  }
  return fadeWhole(c, W, H, appear);
}

/** Fade the finished composite as one layer, so stacked flaps don't show through each other. */
function fadeWhole(c, W, H, alpha) {
  if (alpha < 1) {
    c.globalCompositeOperation = 'destination-in';
    c.fillStyle = `rgba(0,0,0,${alpha})`;
    c.fillRect(0, 0, W, H);
    c.globalCompositeOperation = 'source-over';
  }
  return c.canvas;
}

/**
 * Draw one flap of the card rotated `th` radians around its crease.
 * rect: source rect in the card. axis 'v' = vertical crease at x=crease (flap extends right),
 * 'h' = horizontal crease at y=crease (flap extends down). `other` is the flap's top (v) or left (h).
 * towardViewer: true = folds over the front, false = folds behind.
 */
function flap(c, card, [sx, sy, sw, sh], axis, crease, other, th, towardViewer, { o, W, H, focal }) {
  const piece = scratch('fold-piece', sw, sh);
  const pc = piece.getContext('2d');
  pc.globalCompositeOperation = 'source-over';
  pc.clearRect(0, 0, sw, sh);
  pc.drawImage(card, sx, sy, sw, sh, 0, 0, sw, sh);

  // Past 90° we see the back of the paper: same silhouette, plain paper colour.
  const back = th > Math.PI / 2;
  if (back) {
    pc.globalCompositeOperation = 'source-in';
    pc.fillStyle = o.paperColor;
    pc.fillRect(0, 0, sw, sh);
    pc.globalCompositeOperation = 'source-over';
  }
  const shade = (0.62 + 0.38 * Math.abs(Math.cos(th))) * (back ? 0.94 : 1);
  const cos = Math.cos(th), sin = Math.sin(th) * (towardViewer ? -1 : 1);

  if (!o.persp) { // affine fallback: squash along the fold axis (no perspective)
    c.save();
    if (axis === 'v') { c.translate(crease, other); c.scale(cos, 1); }
    else { c.translate(other, crease); c.scale(1, cos); }
    c.drawImage(piece, 0, 0);
    c.restore();
    return;
  }

  const cx = W / 2, cy = H / 2;
  const project = (x, y, z) => { const w = (focal + z) / focal; return [cx + (x - cx) / w, cy + (y - cy) / w, w]; };
  const corner = (a, b) => (axis === 'v'
    ? project(crease + a * cos, other + b, a * sin)
    : project(other + a, crease + b * cos, b * sin));
  const quad = [corner(0, 0), corner(sw, 0), corner(sw, sh), corner(0, sh)];
  c.drawImage(o.persp.draw(piece, quad, W, H, 1, shade), 0, 0);
}

/* ---------- Crumple ---------- */

/*
 * Timeline (p: 0 → 1): a small ball pops in during the first 25%, then uncrumples.
 * The card is a grid mesh; each vertex moves from its flat position to a spot inside
 * a ball, with random depth (for overlapping folds) and per-facet shading.
 */
function crumple(card, p, o) {
  const cw = card.width, ch = card.height;
  const W = Math.ceil(cw * 1.2), H = Math.ceil(ch * 1.2);
  const appear = clamp(p / 0.25);
  const amt = 1 - clamp((p - 0.25) / 0.75); // 1 = fully crumpled
  const ballScale = 0.2 + 0.8 * ease('easeOutBack', appear);
  const seed = o.seed || 1;

  if (!o.persp) { // fallback: shrink and spin
    const out = scratch('paper-crumple', W, H);
    const c = out.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, W, H);
    c.globalAlpha = appear;
    c.translate(W / 2, H / 2);
    c.rotate(amt * 0.8);
    c.scale((1 - 0.75 * amt) * ballScale, (1 - 0.75 * amt) * ballScale);
    c.drawImage(card, -cw / 2, -ch / 2);
    return out;
  }

  const NX = 18, NY = Math.max(6, Math.min(28, Math.round((18 * ch) / cw)));
  const S = Math.min(cw, ch);
  const R = Math.sqrt(cw * ch) * 0.24;
  const spin = amt * 0.9;
  const cosS = Math.cos(spin), sinS = Math.sin(spin);
  const wrinkle = S * 0.06 * Math.sin(Math.PI * Math.min(1, amt * 1.4));

  // vertex positions
  const pos = [];
  for (let j = 0; j <= NY; j++) {
    for (let i = 0; i <= NX; i++) {
      const u = i / NX, v = j / NY;
      const nx = 2 * u - 1, ny = 2 * v - 1;
      const r1 = hash(i, j, seed, 1) - 0.5, r2 = hash(i, j, seed, 2) - 0.5, r3 = hash(i, j, seed, 3) - 0.5;
      // square → roughly round ball, with lumps
      const bx = R * (nx * Math.sqrt(1 - (ny * ny) / 2) + r1 * 0.7);
      const by = R * (ny * Math.sqrt(1 - (nx * nx) / 2) + r2 * 0.7);
      let x = lerp(nx * cw / 2, bx, amt) + r1 * wrinkle;
      let y = lerp(ny * ch / 2, by, amt) + r2 * wrinkle;
      [x, y] = [x * cosS - y * sinS, x * sinS + y * cosS];
      pos.push([W / 2 + x * ballScale, H / 2 + y * ballScale, r3 * amt * 0.9, u, v]);
    }
  }

  const verts = [];
  const at = (i, j) => pos[j * (NX + 1) + i];
  for (let j = 0; j < NY; j++) {
    for (let i = 0; i < NX; i++) {
      const tris = hash(i, j, seed, 9) > 0.5
        ? [[at(i, j), at(i + 1, j), at(i + 1, j + 1)], [at(i, j), at(i + 1, j + 1), at(i, j + 1)]]
        : [[at(i, j), at(i + 1, j), at(i, j + 1)], [at(i + 1, j), at(i + 1, j + 1), at(i, j + 1)]];
      tris.forEach((tri, k) => {
        const h1 = hash(i, j, k, seed, 4), h2 = hash(i, j, k, seed, 5);
        const shade = 1 - amt * (0.08 + 0.42 * h1) + (h2 > 0.82 ? amt * 0.22 : 0);
        for (const [x, y, z, u, v] of tri) verts.push(x, y, z, u, v, shade);
      });
    }
  }
  const out = scratch('paper-crumple', W, H);
  const c = out.getContext('2d');
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.clearRect(0, 0, W, H);
  c.drawImage(o.persp.drawMesh(card, verts, W, H), 0, 0);
  return fadeWhole(c, W, H, appear);
}
