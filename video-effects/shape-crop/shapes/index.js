/*
 * Shape Crop · built-in shape registry. © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 * A shape is one file exporting:
 *   { id, name, aspect?, params: [createControls specs], path(w, h, params) → SVG path data }
 * `path` draws the shape filling a w×h box with (0, 0) at the top-left. The tool turns it into a
 * Path2D for the canvas and reuses the same string for SVG export and the picker icon.
 * `aspect` (w / h) makes picking the shape snap the box to that ratio and lock it.
 */
import rect from './rect.js';
import circle from './circle.js';
import ellipse from './ellipse.js';
import roundedSquare from './rounded-square.js';
import triangle from './triangle.js';
import pentagon from './pentagon.js';
import hexagon from './hexagon.js';
import octagon from './octagon.js';
import star from './star.js';
import heart from './heart.js';
import diamond from './diamond.js';
import arrow from './arrow.js';
import speechBubble from './speech-bubble.js';
import blob from './blob.js';
import polygon from './polygon.js';

export const SHAPES = [rect, circle, ellipse, roundedSquare, triangle, pentagon, hexagon, octagon, star, heart, diamond, arrow, speechBubble, blob, polygon];

export const getShape = (id) => SHAPES.find((s) => s.id === id);
