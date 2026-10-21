/**
 * Logo surfaces for Text Match Cut's Logo and Mixed modes. One module per surface:
 *
 *   export default {
 *     id: 'concrete', name: 'Concrete wall',
 *     render(ctx, env) → { bg, surface }   // draw the whole W×H frame with the logo applied
 *   }
 *
 * env = { W, H, k, r, seed, box, u, logo, logoColor, ink(palette) }
 *   box: where the logo goes ({ x, y, w, h } in frame px, identical on every frame; never move it)
 *   u: the logo's long side in px (size effects by it), k: frame scale (min(W, H) / 1080)
 *   r: the frame's seeded rng (all randomness comes from it, so preview and export match)
 *   logo: the prepared logo canvas; logoColor: its average colour ('#rrggbb')
 *   ink(palette): picks a colour from the palette, or returns null when the user keeps the
 *     logo's own colours (always consumes one r(), so both choices share the same layout)
 * bg: the frame's dominant colour (fills the edges under the handheld jitter);
 * surface: 'paper' | 'aged' | 'screen', how strongly the shared paper texture applies.
 * Helpers for textures, the logo layer and applied looks are in _common.js.
 */
import concrete from './concrete.js';
import brick from './brick.js';
import fabric from './fabric.js';
import patch from './patch.js';
import neon from './neon.js';
import metal from './metal.js';
import wood from './wood.js';
import stamp from './stamp.js';
import sticker from './sticker.js';
import chalk from './chalk.js';
import poster from './poster.js';

export const SURFACES = [concrete, brick, fabric, patch, neon, metal, wood, stamp, sticker, chalk, poster];

export const getSurface = (id) => SURFACES.find((s) => s.id === id) || SURFACES[0];
export { renderPhoto } from './photo.js';
