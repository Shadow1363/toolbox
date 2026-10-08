/* Shape Crop · Rectangle (the default crop). © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { roundRectD } from './_geom.js';

export default {
  id: 'rect',
  name: 'Rectangle',
  params: [{ id: 'radius', type: 'range', label: 'Corner radius', min: 0, max: 50, value: 0, unit: '%', hint: '0 = sharp corners, 50% = pill.' }],
  path: (w, h, p) => roundRectD(0, 0, w, h, (p.radius / 100) * Math.min(w, h)),
};
