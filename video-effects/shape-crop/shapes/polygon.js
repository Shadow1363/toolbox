/* Shape Crop · Polygon with any number of sides. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { polygonD, fitPoints, circlePoints, roundingParam, roundingPx } from './_geom.js';

export default {
  id: 'polygon',
  name: 'Polygon',
  aspect: 1,
  params: [{ id: 'sides', type: 'range', label: 'Sides', min: 3, max: 16, value: 7 }, roundingParam(0)],
  path: (w, h, p) => polygonD(fitPoints(circlePoints(p.sides), w, h), roundingPx(p, w, h)),
};
