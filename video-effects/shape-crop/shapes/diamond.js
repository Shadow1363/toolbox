/* Shape Crop · Diamond. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { polygonD, roundingParam, roundingPx } from './_geom.js';

export default {
  id: 'diamond',
  name: 'Diamond',
  params: [roundingParam(0)],
  path: (w, h, p) => polygonD([[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]], roundingPx(p, w, h)),
};
