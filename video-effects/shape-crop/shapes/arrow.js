/* Shape Crop · Arrow. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { polygonD, roundingParam, roundingPx } from './_geom.js';

export default {
  id: 'arrow',
  name: 'Arrow',
  params: [
    { id: 'dir', type: 'segmented', label: 'Direction', value: 'right', options: [['right', '→'], ['left', '←'], ['up', '↑'], ['down', '↓']] },
    { id: 'shaft', type: 'range', label: 'Shaft thickness', min: 10, max: 90, value: 42, unit: '%' },
    { id: 'head', type: 'range', label: 'Head length', min: 10, max: 90, value: 42, unit: '%' },
    roundingParam(0),
  ],
  path(w, h, p) {
    // Build it pointing right in (along, across) coordinates, then map to the direction.
    const horiz = p.dir === 'right' || p.dir === 'left';
    const L = horiz ? w : h, T = horiz ? h : w;
    const hl = (L * p.head) / 100, st = (T * p.shaft) / 100;
    const local = [[0, (T - st) / 2], [L - hl, (T - st) / 2], [L - hl, 0], [L, T / 2], [L - hl, T], [L - hl, (T + st) / 2], [0, (T + st) / 2]];
    const map = { right: ([u, v]) => [u, v], left: ([u, v]) => [L - u, v], down: ([u, v]) => [v, u], up: ([u, v]) => [v, L - u] }[p.dir];
    return polygonD(local.map(map), roundingPx(p, w, h) * 0.4);
  },
};
