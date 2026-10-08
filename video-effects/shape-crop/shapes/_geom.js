/* Shape Crop · geometry helpers for built-in shapes. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad */

/** Round to 2 decimals for compact SVG path data. */
export const n = (v) => +v.toFixed(2);

/** Closed polygon through [x, y] points; corners rounded by r (px, clamped to half of each edge). */
export function polygonD(pts, r = 0) {
  if (r <= 0) return `M${pts.map(([x, y]) => `${n(x)} ${n(y)}`).join('L')}Z`;
  const L = pts.length;
  let d = '';
  for (let i = 0; i < L; i++) {
    const p = pts[(i - 1 + L) % L], c = pts[i], q = pts[(i + 1) % L];
    const d1 = Math.hypot(p[0] - c[0], p[1] - c[1]) || 1, d2 = Math.hypot(q[0] - c[0], q[1] - c[1]) || 1;
    const rr = Math.min(r, d1 / 2, d2 / 2);
    const a = [c[0] + ((p[0] - c[0]) / d1) * rr, c[1] + ((p[1] - c[1]) / d1) * rr];
    const b = [c[0] + ((q[0] - c[0]) / d2) * rr, c[1] + ((q[1] - c[1]) / d2) * rr];
    d += `${i ? 'L' : 'M'}${n(a[0])} ${n(a[1])}Q${n(c[0])} ${n(c[1])} ${n(b[0])} ${n(b[1])}`;
  }
  return `${d}Z`;
}

/** Smooth closed curve through points (Catmull-Rom as cubic Béziers). */
export function smoothClosedD(pts) {
  const L = pts.length, P = (i) => pts[(i + L) % L];
  let d = `M${n(P(0)[0])} ${n(P(0)[1])}`;
  for (let i = 0; i < L; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    d += `C${n(p1[0] + (p2[0] - p0[0]) / 6)} ${n(p1[1] + (p2[1] - p0[1]) / 6)} ${n(p2[0] - (p3[0] - p1[0]) / 6)} ${n(p2[1] - (p3[1] - p1[1]) / 6)} ${n(p2[0])} ${n(p2[1])}`;
  }
  return `${d}Z`;
}

/** Stretch points so their bounding box fills the w×h box. */
export function fitPoints(pts, w, h) {
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), y0 = Math.min(...ys);
  const sx = w / (Math.max(...xs) - x0 || 1), sy = h / (Math.max(...ys) - y0 || 1);
  return pts.map(([x, y]) => [(x - x0) * sx, (y - y0) * sy]);
}

/** Points on a circle, first one at the top (even counts get a flat top edge). */
export function circlePoints(count, radius = (i) => 1) {
  const start = -Math.PI / 2 + (count % 2 ? 0 : Math.PI / count);
  return Array.from({ length: count }, (_, i) => {
    const a = start + (i * 2 * Math.PI) / count, r = radius(i);
    return [Math.cos(a) * r, Math.sin(a) * r];
  });
}

export const ellipseD = (w, h) =>
  `M0 ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 ${n(w)} ${n(h / 2)}A${n(w / 2)} ${n(h / 2)} 0 1 0 0 ${n(h / 2)}Z`;

export function roundRectD(x, y, w, h, r) {
  r = Math.max(0, Math.min(r, w / 2, h / 2));
  if (!r) return `M${n(x)} ${n(y)}H${n(x + w)}V${n(y + h)}H${n(x)}Z`;
  const a = `A${n(r)} ${n(r)} 0 0 1`;
  return `M${n(x + r)} ${n(y)}H${n(x + w - r)}${a} ${n(x + w)} ${n(y + r)}V${n(y + h - r)}${a} ${n(x + w - r)} ${n(y + h)}`
    + `H${n(x + r)}${a} ${n(x)} ${n(y + h - r)}V${n(y + r)}${a} ${n(x + r)} ${n(y)}Z`;
}

/** The shared "Corner rounding" param (percent of half the short side). */
export const roundingParam = (value = 0) => ({ id: 'round', type: 'range', label: 'Corner rounding', min: 0, max: 100, value, unit: '%' });
export const roundingPx = (p, w, h) => ((p.round || 0) / 100) * Math.min(w, h) * 0.5;

/** A regular polygon shape (pentagon, hexagon, …) filling its box. */
export const regularShape = (id, name, sides) => ({
  id, name, aspect: 1,
  params: [roundingParam(0)],
  path: (w, h, p) => polygonD(fitPoints(circlePoints(sides), w, h), roundingPx(p, w, h)),
});
