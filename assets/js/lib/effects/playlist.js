/*
 * Playlist effect: the Scrolling Playlist tool's curved glass music list (video-effects/scrolling-playlist/playlist.js)
 * floating over the video for a time range. Songs come from the params as "Artist – Song" lines; covers are generated
 * gradients (no network in an edit). Scrolling: 'auto' drifts down the list at `speed` rows per second; 'hand' runs
 * MediaPipe's Hand Landmarker on each frame and drags the list with the index fingertip (frames are rendered in order
 * during export; a jump in time restarts the drag). Like the tool, the stroke back to the start of the next swipe
 * doesn't scroll the list back (scroll.js createSwipe: the first stroke sets the direction).
 */
import { drawSheet, drawPlaylist, createCurve, placement, gradientCover, PLAYLIST_DEFAULTS as D } from '/video-effects/scrolling-playlist/playlist.js';
import { parseList } from '/video-effects/scrolling-playlist/songs.js';
import { createSwipe } from '/video-effects/scrolling-playlist/scroll.js';
import { loadHandLandmarker, detectHands } from '../vision.js';
import { ease } from '../easing.js';

let curve;
let hands = null;
const coverCache = new Map();
const drag = new Map(); // slot → { t, swipe, pos }

const SAMPLE = 'Nova Lane – Glass Hours\nThe Quiet Static – Neon Rain\nMira Sol – Paper Planets\nHarbor Kids – Slow Motion Summer\nJuno & The Tides – Coastline\nArlo Vance – Midnight Ferry\nVelvet Era – Afterglow\nPale Comets – Northern Lights';

export default {
  id: 'playlist',
  name: 'Scrolling playlist',
  description: 'A curved, see-through music playlist floating over the video that scrolls on its own or with the speaker’s fingertip.',
  kind: 'overlay',
  params: [
    { id: 'songs', type: 'textarea', label: 'Songs (Artist – Song per line)', value: SAMPLE, ai: 'one "Artist – Song" per line, real songs the speaker mentions' },
    { id: 'title', type: 'text', label: 'Playlist name', value: D.title },
    { id: 'scroll', type: 'segmented', label: 'Scroll', value: 'auto', options: [['auto', 'On its own'], ['hand', 'With the fingertip']], ai: 'hand only when the speaker points at or swipes the list' },
    { id: 'speed', type: 'range', label: 'Speed', min: 0, max: 3, step: 0.05, value: 0.6, unit: 'rows/s' },
    { id: 'playing', type: 'number', label: 'Now playing (song #)', min: 1, max: 99, value: 1 },
    { id: 'accent', type: 'color', label: 'Accent', value: D.accent },
    { id: 'x', type: 'range', label: 'Horizontal', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'y', type: 'range', label: 'Vertical', min: 0, max: 100, value: 45, unit: '%' },
    { id: 'size', type: 'range', label: 'Size', min: 20, max: 100, value: 62, unit: '%' },
    { id: 'curvature', type: 'range', label: 'Curvature', min: 0, max: 1, step: 0.01, value: D.curvature },
    { id: 'turn', type: 'range', label: 'Turn', min: -45, max: 45, value: D.turn, unit: '°' },
    { id: 'showTop', type: 'toggle', label: 'Top bar', value: true },
    { id: 'showBottom', type: 'toggle', label: 'Now-playing bar', value: true },
  ],
  ai: {
    params: ['songs', 'title', 'scroll', 'playing'],
    hint: 'When the speaker talks about songs, music recommendations or a playlist. 3–8 s. Place it beside the face (x 25–75).',
  },
  async prepare(p) {
    curve ??= createCurve();
    if (p.scroll === 'hand') hands ||= await loadHandLandmarker({ numHands: 1 });
  },
  render(ctx, frame, t, p, env) {
    const W = ctx.canvas.width, H = ctx.canvas.height;
    const s = { ...D, ...p, visibleRows: 6, rotation: 0, tilt: 0 };
    const songs = parseList(p.songs);
    const covers = songs.map((sg) => {
      const k = `${sg.title}|${sg.artist}`;
      if (!coverCache.has(k)) coverCache.set(k, gradientCover(sg.title, sg.artist));
      return coverCache.get(k);
    });
    const place = placement(s, W, H);
    const lt = env.local ?? t;
    const len = env.item ? env.item.end - env.item.start : env.duration;
    const maxPos = Math.max(0, songs.length - s.visibleRows);
    let pos;
    if (p.scroll === 'hand' && hands) {
      const slot = env.slot ?? 0;
      let st = drag.get(slot);
      if (!st || Math.abs(lt - st.t) > 0.5) st = { t: lt, swipe: createSwipe(), pos: 0 };
      const hit = detectHands(hands, frame.el)[0];
      st.pos += (-st.swipe.step(hit ? hit.points[8].y : null) * H) / (150 * place.scale);
      st.pos = Math.max(0, Math.min(maxPos, st.pos));
      st.t = lt;
      drag.set(slot, st);
      pos = st.pos;
    } else pos = Math.min(maxPos, lt * p.speed);
    // Fade/scale in and out over 0.3 s.
    const a = Math.min(ease('easeOutCubic', lt / 0.3), ease('easeOutCubic', (len - lt) / 0.3));
    if (a <= 0) return;
    const sheet = drawSheet(songs, s, { pos, playing: p.playing - 1, t: lt, covers, px: Math.min(2, place.scale * 1.3), name: `fx-pl-${env.slot ?? 0}` });
    ctx.save();
    ctx.globalAlpha = a;
    drawPlaylist(ctx, sheet, s, { place: { ...place, scale: place.scale * (0.9 + 0.1 * a) }, backdrop: frame.el, curve });
    ctx.restore();
  },
};
