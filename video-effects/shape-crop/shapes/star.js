/* Shape Crop · Star. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { polygonD, fitPoints, roundingParam, roundingPx } from './_geom.js';

export default {
  id: 'star',
  name: 'Star',
  aspect: 1,
  params: [
    { id: 'points', type: 'range', label: 'Points', min: 3, max: 24, value: 5 },
    { id: 'inner', type: 'range', label: 'Inner radius', min: 10, max: 95, value: 45, unit: '%' },
    roundingParam(0),
  ],
  path(w, h, p) {
    // Outer and inner vertices alternate; start half a step back so a point sits on top.
    const k = p.points * 2, start = -Math.PI / 2;
    const pts = Array.from({ length: k }, (_, i) => {
      const a = start + (i * Math.PI) / p.points, r = i % 2 ? p.inner / 100 : 1;
      return [Math.cos(a) * r, Math.sin(a) * r];
    });
    return polygonD(fitPoints(pts, w, h), roundingPx(p, w, h) * 0.5);
  },
};
