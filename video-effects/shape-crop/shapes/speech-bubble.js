/* Shape Crop · Speech bubble. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { n } from './_geom.js';

export default {
  id: 'speech-bubble',
  name: 'Speech bubble',
  params: [
    { id: 'tail', type: 'range', label: 'Tail position', min: 0, max: 100, value: 25, unit: '%' },
    { id: 'tailSize', type: 'range', label: 'Tail length', min: 8, max: 40, value: 20, unit: '%' },
    { id: 'radius', type: 'range', label: 'Corner radius', min: 0, max: 50, value: 30, unit: '%' },
  ],
  path(w, h, p) {
    const bh = h * (1 - p.tailSize / 100);                 // body height; the tail fills the rest
    const r = Math.min((p.radius / 100) * Math.min(w, bh), w / 2, bh / 2);
    const tw = Math.min(w * 0.18, w - 2 * r);              // tail base width
    const bx = Math.max(r + tw / 2, Math.min(w - r - tw / 2, (p.tail / 100) * w));
    const tip = bx + (p.tail < 50 ? -1 : 1) * tw * 0.6;    // lean away from the centre
    const a = `A${n(r)} ${n(r)} 0 0 1`;
    return `M${n(r)} 0H${n(w - r)}${a} ${n(w)} ${n(r)}V${n(bh - r)}${a} ${n(w - r)} ${n(bh)}`
      + `H${n(bx + tw / 2)}L${n(tip)} ${n(h)}L${n(bx - tw / 2)} ${n(bh)}`
      + `H${n(r)}${a} 0 ${n(bh - r)}V${n(r)}${a} ${n(r)} 0Z`;
  },
};
