/* Shape Crop · Heart. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { n } from './_geom.js';

// Unit-box outline: bottom tip → left lobe → centre dip → right lobe → back to the tip.
const CURVES = [
  [0.38, 0.9, 0, 0.62, 0, 0.3],
  [0, 0.12, 0.13, 0, 0.28, 0],
  [0.4, 0, 0.48, 0.08, 0.5, 0.19],
  [0.52, 0.08, 0.6, 0, 0.72, 0],
  [0.87, 0, 1, 0.12, 1, 0.3],
  [1, 0.62, 0.62, 0.9, 0.5, 1],
];

export default {
  id: 'heart',
  name: 'Heart',
  aspect: 1,
  params: [],
  path: (w, h) => `M${n(w / 2)} ${n(h)}${CURVES.map((c) => `C${c.map((v, i) => n(v * (i % 2 ? h : w))).join(' ')}`).join('')}Z`,
};
