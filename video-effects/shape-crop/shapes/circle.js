/* Shape Crop · Circle. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */
import { ellipseD } from './_geom.js';

export default { id: 'circle', name: 'Circle', aspect: 1, params: [], path: (w, h) => ellipseD(w, h) };
