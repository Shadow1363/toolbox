/* Shape Crop · Triangle. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { polygonD, roundingParam, roundingPx } from './_geom.js';

export default {
  id: 'triangle',
  name: 'Triangle',
  params: [
    { id: 'apex', type: 'range', label: 'Top point', min: 0, max: 100, value: 50, unit: '%', hint: '0% and 100% give a right triangle.' },
    roundingParam(0),
  ],
  path: (w, h, p) => polygonD([[(p.apex / 100) * w, 0], [w, h], [0, h]], roundingPx(p, w, h)),
};
