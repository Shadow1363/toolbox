/* Shape Crop · Rounded square (a superellipse, the smooth "squircle"). © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { polygonD } from './_geom.js';

export default {
  id: 'rounded-square',
  name: 'Rounded square',
  aspect: 1,
  params: [{ id: 'round', type: 'range', label: 'Roundness', min: 0, max: 100, value: 45, unit: '%' }],
  path(w, h, p) {
    const e = 2 / (2.2 + (1 - p.round / 100) * 14); // superellipse exponent: 16 ≈ square, 2.2 ≈ circle
    const pts = Array.from({ length: 144 }, (_, i) => {
      const a = (i / 144) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      return [w / 2 + (w / 2) * Math.sign(c) * Math.abs(c) ** e, h / 2 + (h / 2) * Math.sign(s) * Math.abs(s) ** e];
    });
    return polygonD(pts);
  },
};
