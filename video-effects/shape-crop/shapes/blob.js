/* Shape Crop · Blob (organic, randomizable). © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { smoothClosedD, fitPoints, circlePoints } from './_geom.js';
import { hash } from '/assets/js/lib/random.js';

export default {
  id: 'blob',
  name: 'Blob',
  params: [
    { id: 'seed', type: 'range', label: 'Variation', min: 1, max: 999, value: 7, seed: true },
    { id: 'lobes', type: 'range', label: 'Bumps', min: 3, max: 12, value: 6 },
    { id: 'wobble', type: 'range', label: 'Wobble', min: 0, max: 100, value: 45, unit: '%' },
  ],
  path(w, h, p) {
    const pts = circlePoints(p.lobes, (i) => 1 - (p.wobble / 100) * 0.55 * hash(p.seed, i));
    return smoothClosedD(fitPoints(pts, w, h));
  },
};
