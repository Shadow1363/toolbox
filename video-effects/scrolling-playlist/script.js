/*
 * Scrolling Playlist: a curved, see-through music playlist floats in front of the person and scrolls when they
 * move a finger up or down.
 *
 * Flow: upload → "Track hand" pass (Hand Landmarker on every 1/fps s, index fingertip + thumb tip; plus a person
 * masking pass when "Hand in front" is on) → simulateScroll (scroll.js: strokes split at turning points, only swipe
 * strokes count — return strokes, cooldowns and detection-off ranges are ignored — drag with smoothing, flick inertia,
 * pinch to play) → render(t) draws the frame, the blurred backdrop + bent sheet (playlist.js), then the hand cut out
 * on top (person mask ∩ the hand's hull) so the finger touches the list. Manual mode uses scroll keyframes instead.
 * Songs come from the list editor, a pasted list, the user's own music-service app, or Auto-build (lib/ai.js).
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, progressModal } from '/assets/js/lib/exporter.js';
import { outputSize, scratch, supportsCanvasFilter } from '/assets/js/lib/canvas.js';
import { seekVideo } from '/assets/js/lib/media.js';
import { h, icon, toast, store, formatTime } from '/assets/js/lib/dom.js';
import { loadHandLandmarker, detectHands } from '/assets/js/lib/vision.js';
import { createMaskTrack } from '/assets/js/lib/object-mask.js';
import { aiKey, setAiKey, aiKeyRemembered } from '/assets/js/lib/ai.js';
import { drawSheet, drawPlaylist, createCurve, placement, rowAtPoint, gradientCover, PLAYLIST_DEFAULTS as P } from './playlist.js';
import { simulateScroll, keyedScroll } from './scroll.js';
import { parseList, newSong, lookupCover, loadImageUrl, shrinkToDataUrl, service, redirectUri, finishAuthPopup, autoBuild } from './songs.js';

finishAuthPopup(); // in the sign-in popup: hands the code to the page that opened it and closes

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
const marks = document.getElementById('marks');
const mctx = marks.getContext('2d');
const overlay = document.getElementById('overlay');

const DEMO = [
  ['Nova Lane', 'Glass Hours'], ['The Quiet Static', 'Neon Rain'], ['Mira Sol', 'Paper Planets'], ['Harbor Kids', 'Slow Motion Summer'],
  ['Juno & The Tides', 'Coastline'], ['Arlo Vance', 'Midnight Ferry'], ['Velvet Era', 'Afterglow'], ['Pale Comets', 'Northern Lights'],
  ['Kite Season', 'Golden Hour Drive'], ['Lumen', 'Satellite Hearts'],
].map(([artist, title], i) => ({ artist, title, video: i === 2 }));

let media = null;
let songs = (store.get('scrolling-playlist:songs', null) || DEMO).map((x) => newSong(x));
let covers = [];
let hand = null;          // tracking pass result: { fps, samples }
let sim = null, simKey = '';
let keys = store.get('scrolling-playlist:keys', []);
let tracking = false;
let exporting = false;
let offRanges = [];       // [{ start, end }] source seconds where hand detection is ignored (timeline under the preview)
const curve = createCurve();
const person = createMaskTrack('pl');

const isVideo = () => media?.kind === 'video';
const listEl = h('div', { class: 'pl-songs' });
const pasteEl = h('div', { class: 'pl-paste' });
const serviceEl = h('div', { class: 'pl-service' });
const buildEl = h('div', { class: 'pl-build' });
const trackEl = h('div', { class: 'pl-track' });
const keysEl = h('div', { class: 'pl-keys' });
const rangesEl = document.getElementById('ranges');

/* ---------- Panel ---------- */
const panel = createControls(document.getElementById('controls'), [
  { title: 'Songs', controls: [{ type: 'custom', el: listEl }] },
  { title: 'Paste a list', controls: [{ type: 'custom', el: pasteEl }] },
  { title: 'Import from a music service', controls: [{ type: 'custom', el: serviceEl }] },
  { title: 'Auto-build from a vibe', controls: [{ type: 'custom', el: buildEl }] },
  {
    title: 'Scrolling',
    controls: [
      { id: 'mode', type: 'segmented', label: 'Scroll by', value: 'hand', options: [['hand', 'Hand tracking'], ['manual', 'Keyframes']] },
      { type: 'custom', el: trackEl, showIf: (st) => st.mode === 'hand' },
      { id: 'rate', type: 'segmented', label: 'Tracking rate', value: '30', options: [['15', '15 / s'], ['30', '30 / s']], showIf: (st) => st.mode === 'hand' },
      { id: 'strength', type: 'range', label: 'Scroll strength', min: 0.2, max: 4, step: 0.05, value: 1.4, format: (v) => `${v.toFixed(2)}×`, showIf: (st) => st.mode === 'hand', hint: '1× moves the rows exactly with the finger.' },
      { id: 'smoothing', type: 'range', label: 'Smoothing', min: 0, max: 0.9, step: 0.05, value: 0.5, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => st.mode === 'hand' },
      { id: 'returnFilter', type: 'toggle', label: 'Ignore the return stroke', value: true, showIf: (st) => st.mode === 'hand', hint: 'Like a phone: moving the finger back to start the next swipe doesn\'t scroll the list back.' },
      { id: 'direction', type: 'segmented', label: 'Scroll direction', value: 'both', options: [['both', 'Both'], ['down', 'Down only'], ['up', 'Up only']], showIf: (st) => st.mode === 'hand', hint: 'Down = further down the list (swipe up, as on a phone). Both: the faster strokes count.' },
      { id: 'cooldown', type: 'range', label: 'Pause after a swipe', min: 0, max: 2, step: 0.05, value: 0.4, unit: 's', decimals: 2, showIf: (st) => st.mode === 'hand', hint: 'Ignores the hand for this long after each swipe (the list keeps gliding).' },
      { id: 'friction', type: 'range', label: 'Glide after a flick', min: 0, max: 1, step: 0.05, value: 0.6, format: (v) => `${Math.round(v * 100)}%`, showIf: (st) => st.mode === 'hand', hint: 'How long the list keeps moving after a swipe.' },
      { id: 'maxSpeed', type: 'range', label: 'Max scroll speed', min: 2, max: 40, value: 15, format: (v) => `${v} rows/s`, showIf: (st) => st.mode === 'hand' },
      { id: 'offMode', type: 'segmented', label: 'While detection is off', value: 'coast', options: [['coast', 'Keep gliding'], ['hold', 'Hold still']], showIf: (st) => st.mode === 'hand', hint: 'Mark the ranges on the Hand detection timeline under the preview.' },
      { id: 'anywhere', type: 'toggle', label: 'React anywhere in the frame', value: false, showIf: (st) => st.mode === 'hand', hint: 'Off: only while the finger is over the playlist.' },
      { id: 'pinch', type: 'toggle', label: 'Pinch plays the song under the finger', value: true, showIf: (st) => st.mode === 'hand' },
      { id: 'handFront', type: 'toggle', label: 'Hand in front of the playlist', value: true, showIf: (st) => st.mode === 'hand', hint: 'Cuts the hand out (person mask around the tracked hand) and draws it over the list.' },
      { id: 'showHand', type: 'toggle', label: 'Debug overlay (preview only)', value: false, showIf: (st) => st.mode === 'hand', hint: 'The fingertip and whether it\'s counting, ignored (return stroke), in cooldown or off. Never exported.' },
      { id: 'manualPos', type: 'range', label: 'Scroll position', min: 0, max: 30, step: 0.05, value: 0, format: (v) => `row ${v.toFixed(1)}`, showIf: (st) => st.mode === 'manual' },
      { type: 'custom', el: keysEl, showIf: (st) => st.mode === 'manual' },
      { id: 'startPlaying', type: 'number', label: 'Now playing (song #)', min: 1, max: 999, value: 1 },
    ],
  },
  {
    title: 'Look',
    controls: [
      { id: 'title', type: 'text', label: 'Playlist name', value: P.title },
      { id: 'showTop', type: 'toggle', label: 'Top bar (shuffle, play, actions)', value: P.showTop },
      { id: 'showBottom', type: 'toggle', label: 'Now-playing bar', value: P.showBottom },
      { id: 'device', type: 'text', label: 'Device line', value: P.device, showIf: (st) => st.showBottom },
      { id: 'visibleRows', type: 'range', label: 'Rows shown', min: 3, max: 9, value: P.visibleRows },
      { id: 'accent', type: 'color', label: 'Accent', value: P.accent },
      { id: 'bgColor', type: 'color', label: 'Glass color', value: P.bgColor },
      { id: 'bgOpacity', type: 'range', label: 'Glass opacity', min: 0, max: 1, step: 0.05, value: P.bgOpacity, format: (v) => `${Math.round(v * 100)}%` },
      { id: 'blur', type: 'range', label: 'Blur behind', min: 0, max: 60, value: P.blur, unit: 'px', hint: supportsCanvasFilter ? '' : 'Approximate in this browser (no canvas filters).' },
      { id: 'textOpacity', type: 'range', label: 'Text opacity', min: 0.3, max: 1, step: 0.05, value: P.textOpacity, format: (v) => `${Math.round(v * 100)}%` },
    ],
  },
  {
    title: 'Curve',
    controls: [
      { id: 'curvature', type: 'range', label: 'Curvature', min: 0, max: 1, step: 0.01, value: P.curvature, format: (v) => `${Math.round(v * 100)}%`, hint: curve ? 'Rows bend around a cylinder, like a wheel picker.' : 'No WebGL here: a flat approximation is drawn.' },
      { id: 'tilt', type: 'range', label: 'Tilt', min: -40, max: 40, value: P.tilt, unit: '°' },
      { id: 'turn', type: 'range', label: 'Turn', min: -45, max: 45, value: P.turn, unit: '°' },
      { id: 'perspective', type: 'range', label: 'Perspective', min: 500, max: 4000, step: 50, value: P.perspective, format: (v) => (v < 1200 ? 'strong' : v < 2400 ? 'medium' : 'subtle') },
      { id: 'fade', type: 'range', label: 'Fade at the edges', min: 0, max: 1, step: 0.05, value: P.fade, format: (v) => `${Math.round(v * 100)}%` },
    ],
  },
  {
    title: 'Placement',
    controls: [
      { id: 'x', type: 'range', label: 'Horizontal', min: 0, max: 100, step: 0.5, value: P.x, unit: '%', hint: 'Or drag the playlist on the preview.' },
      { id: 'y', type: 'range', label: 'Vertical', min: 0, max: 100, step: 0.5, value: P.y, unit: '%' },
      { id: 'size', type: 'range', label: 'Size', min: 20, max: 100, value: P.size, unit: '%' },
      { id: 'rotation', type: 'range', label: 'Rotation', min: -30, max: 30, value: P.rotation, unit: '°' },
      { id: 'clip', type: 'range', label: 'Clip length (photos)', min: 1, max: 20, step: 0.5, value: 6, unit: 's', decimals: 1, showIf: () => media?.kind === 'image' },
    ],
  },
], {
  onChange: (st, id) => {
    if (id === 'mode' || id === 'handFront') { syncNote(); renderRanges(); }
    if (id === 'rate') { hand = null; renderTrack(); }
    if (id === 'visibleRows') panel.set({ manualPos: Math.min(st.manualPos, maxPos()) }, { silent: true });
    stage.invalidate();
    exportBar.refresh();
  },
});
const s = panel.state;

/* ---------- Media ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  label: 'Drop a video of someone moving a finger up and down',
  onLoad: (m) => {
    media = m;
    const { w, h: hh } = outputSize(m.width, m.height, 1920);
    canvas.width = w; canvas.height = hh;
    hand = null;
    offRanges = [];
    simKey = '';
    person.setMedia(m);
    if (m.kind === 'image') panel.set({ mode: 'manual' }, { silent: true });
    panel.refresh();
    stage.reset();
    renderTrack();
    renderRanges();
    exportBar.refresh();
    syncNote();
    if (isVideo()) stage.play().catch(() => {});
  },
  onClear: () => { media = null; hand = null; offRanges = []; person.setMedia(null); panel.refresh(); stage.reset(); renderTrack(); renderRanges(); exportBar.refresh(); syncNote(); },
});

/* ---------- Songs ---------- */
function saveSongs() {
  store.set('scrolling-playlist:songs', songs.map(({ title, artist, video, coverUrl, coverData }) => ({ title, artist, video, coverUrl, coverData })));
}
async function loadCovers() {
  const list = songs.slice();
  const out = await Promise.all(list.map(async (sg) => (await loadImageUrl(sg.coverData || sg.coverUrl)) || gradientCover(sg.title, sg.artist)));
  if (list.length === songs.length && list.every((x, i) => x === songs[i])) { covers = out; stage.invalidate(); }
}
function songsChanged({ covers: reload = true } = {}) {
  saveSongs();
  if (reload) loadCovers();
  renderSongs();
  stage.invalidate();
}

let dragFrom = -1;
function renderSongs() {
  const btn = (ic, label, onClick) => h('button', { type: 'button', class: 'btn btn-ghost btn-sm pl-icon', 'aria-label': label, title: label, html: icon(ic), onclick: onClick });
  const rows = songs.map((sg, i) => {
    const thumb = h('button', { type: 'button', class: 'pl-thumb', title: 'Upload a cover', 'aria-label': `Cover for ${sg.title || 'song'}` });
    const c = covers[i];
    if (c) { try { thumb.style.backgroundImage = `url(${c.src || c.toDataURL()})`; } catch { /* */ } }
    thumb.addEventListener('click', async () => {
      const input = h('input', { type: 'file', accept: 'image/*' });
      input.onchange = async () => {
        const f = input.files[0]; if (!f) return;
        const img = await loadImageUrl(URL.createObjectURL(f));
        if (!img) return toast('Could not read that image.', 'error');
        sg.coverData = shrinkToDataUrl(img);
        URL.revokeObjectURL(img.src);
        songsChanged();
      };
      input.click();
    });
    const title = h('input', { type: 'text', value: sg.title, placeholder: 'Title', 'aria-label': 'Title' });
    const artist = h('input', { type: 'text', value: sg.artist, placeholder: 'Artist', 'aria-label': 'Artist' });
    title.addEventListener('input', () => { sg.title = title.value; saveSongs(); stage.invalidate(); });
    artist.addEventListener('input', () => { sg.artist = artist.value; saveSongs(); stage.invalidate(); });
    title.addEventListener('change', () => { if (!sg.coverData && !sg.coverUrl) loadCovers(); });
    const video = h('label', { class: 'pl-video', title: 'Show a "Video" tag' }, h('input', { type: 'checkbox', checked: sg.video }), 'Video');
    video.querySelector('input').addEventListener('change', (e) => { sg.video = e.target.checked; saveSongs(); stage.invalidate(); });
    const row = h('div', { class: 'pl-song', draggable: 'true' },
      h('span', { class: 'pl-grip', html: icon('grip'), title: 'Drag to reorder' }), thumb,
      h('div', { class: 'pl-fields' }, title, artist), video,
      btn('x', 'Remove song', () => { songs.splice(i, 1); songsChanged(); }));
    row.addEventListener('dragstart', (e) => { dragFrom = i; row.classList.add('is-dragging'); e.dataTransfer.effectAllowed = 'move'; });
    row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
    row.addEventListener('dragover', (e) => { e.preventDefault(); row.classList.add('is-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('is-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('is-over');
      if (dragFrom < 0 || dragFrom === i) return;
      const [m] = songs.splice(dragFrom, 1);
      songs.splice(i, 0, m);
      dragFrom = -1;
      songsChanged();
    });
    return row;
  });
  listEl.replaceChildren(
    h('div', { class: 'pl-list' }, ...rows),
    h('div', { class: 'pl-row-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('plus')} Add song`, onclick: () => { songs.push(newSong({ title: 'New song', artist: 'Artist' })); songsChanged(); } }),
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('search')} Find covers`, onclick: findCovers, title: 'Look up cover art for songs without one' }),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: `${icon('trash')} Clear`, onclick: () => { if (confirm('Remove every song?')) { songs = []; songsChanged(); } } })),
    h('div', { class: 'ctrl-hint' }, `${songs.length} songs. Drag rows to reorder; click a cover to upload one. Find covers asks a public music catalog for the artwork (title and artist only).`),
  );
}

async function findCovers(list = songs) {
  const todo = list.filter((sg) => !sg.coverData && !sg.coverUrl && sg.title);
  if (!todo.length) return toast('Every song already has a cover.');
  let found = 0;
  const t = toast(`Looking up ${todo.length} covers…`, 'info', 60000);
  for (const sg of todo) {
    const url = await lookupCover(sg);
    if (url) { sg.coverUrl = url; found++; }
  }
  t.remove();
  toast(`Found ${found} of ${todo.length} covers.${found < todo.length ? ' The rest keep a generated cover.' : ''}`, found ? 'success' : 'info');
  songsChanged();
}

/* ---------- Paste ---------- */
(function renderPaste() {
  const ta = h('textarea', { rows: 4, placeholder: 'Artist – Song\nNova Lane – Glass Hours\n2. Mira Sol - Paper Planets', 'aria-label': 'Song list' });
  const order = h('select', { 'aria-label': 'Line order' }, h('option', { value: 'artist-title' }, 'Artist – Song'), h('option', { value: 'title-artist' }, 'Song – Artist'));
  const lookup = h('label', { class: 'toggle' }, h('span', {}, 'Look up covers'), h('input', { type: 'checkbox', role: 'switch', checked: true }));
  const add = (replace) => {
    const parsed = parseList(ta.value, { order: order.value });
    if (!parsed.length) return toast('Paste one song per line first.');
    songs = replace ? parsed : [...songs, ...parsed];
    ta.value = '';
    songsChanged();
    toast(`Added ${parsed.length} songs.`, 'success');
    if (lookup.querySelector('input').checked) findCovers(parsed);
  };
  pasteEl.replaceChildren(ta, h('div', { class: 'pl-row-actions' }, order,
    h('button', { type: 'button', class: 'btn btn-sm btn-primary', onclick: () => add(false) }, 'Add'),
    h('button', { type: 'button', class: 'btn btn-sm', onclick: () => add(true) }, 'Replace list')), lookup);
})();

/* ---------- Music service ---------- */
function renderService() {
  const id = h('input', { type: 'text', value: store.get('scrolling-playlist:client-id', ''), placeholder: 'Client ID', 'aria-label': 'Client ID', spellcheck: 'false' });
  const remember = h('input', { type: 'checkbox', role: 'switch' });
  const uri = redirectUri();
  const steps = h('ol', { class: 'pl-steps' },
    h('li', {}, 'Create an app in the Spotify developer dashboard (Web API). This uses your own app; nothing goes through our servers.'),
    h('li', {}, 'Add this page as a Redirect URI: ', h('code', {}, uri), ' ',
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: icon('copy'), title: 'Copy', 'aria-label': 'Copy redirect URI', onclick: () => navigator.clipboard?.writeText(uri).then(() => toast('Copied')) }),
      /localhost/.test(uri) ? h('div', { class: 'ctrl-hint' }, 'Use http://127.0.0.1 instead of localhost: the service rejects localhost redirect URIs.') : null),
    h('li', {}, 'Paste the app’s Client ID below and press Connect (a sign-in window opens).'));
  if (!service.connected) {
    serviceEl.replaceChildren(
      h('details', {}, h('summary', {}, 'How to set it up'), steps),
      id,
      h('label', { class: 'toggle' }, h('span', {}, 'Stay connected on this device'), remember),
      h('button', {
        type: 'button', class: 'btn btn-sm btn-primary', onclick: async () => {
          store.set('scrolling-playlist:client-id', id.value.trim());
          try { await service.connect(id.value, { remember: remember.checked }); toast('Connected.', 'success'); renderService(); } catch (err) { toast(err.message, 'error', 7000); }
        },
      }, 'Connect'),
      h('div', { class: 'ctrl-hint' }, 'Optional. The access token stays in memory unless you choose to stay connected.'));
    return;
  }
  const pick = h('select', { 'aria-label': 'Playlist' }, h('option', { value: 'liked' }, 'Liked songs'));
  const link = h('input', { type: 'text', placeholder: 'or paste a playlist link', 'aria-label': 'Playlist link' });
  const replace = h('input', { type: 'checkbox', role: 'switch', checked: true });
  service.playlists().then((list) => list.forEach((p) => pick.append(h('option', { value: p.id }, `${p.name} (${p.count})`)))).catch((err) => toast(err.message, 'error'));
  serviceEl.replaceChildren(
    h('div', { class: 'ctrl-hint' }, 'Connected.'),
    pick, link,
    h('label', { class: 'toggle' }, h('span', {}, 'Replace the current list'), replace),
    h('div', { class: 'pl-row-actions' },
      h('button', {
        type: 'button', class: 'btn btn-sm btn-primary', onclick: async () => {
          try {
            const got = await service.tracks(link.value.trim() || pick.value);
            if (!got.length) return toast('That playlist has no songs this app can read.');
            songs = replace.checked ? got : [...songs, ...got];
            const opt = pick.selectedOptions[0];
            if (!link.value.trim() && opt && opt.value !== 'liked') panel.set({ title: opt.textContent.replace(/\s\(\d+\)$/, '') });
            songsChanged();
            toast(`Imported ${got.length} songs.`, 'success');
          } catch (err) { toast(err.message, 'error', 7000); }
        },
      }, 'Import'),
      h('button', { type: 'button', class: 'btn btn-sm', onclick: () => { service.disconnect(); renderService(); } }, 'Disconnect')));
}
renderService();

/* ---------- Auto-build ---------- */
function renderBuild() {
  const vibe = h('textarea', { rows: 2, placeholder: 'chill indie for studying', 'aria-label': 'Describe the vibe' });
  const count = h('input', { type: 'number', min: 4, max: 30, value: 12, 'aria-label': 'How many songs' });
  const key = h('input', { type: 'password', value: aiKey(), placeholder: 'sk-ant-…', 'aria-label': 'Anthropic API key', autocomplete: 'off' });
  const remember = h('input', { type: 'checkbox', role: 'switch', checked: aiKeyRemembered() });
  const verify = h('input', { type: 'checkbox', role: 'switch', checked: true });
  const go = h('button', {
    type: 'button', class: 'btn btn-sm btn-primary', html: `${icon('wand')} Build playlist`, onclick: async () => {
      setAiKey(key.value, { remember: remember.checked });
      if (!vibe.value.trim()) return toast('Describe the vibe first.');
      go.disabled = true;
      const t = toast('Asking for songs…', 'info', 120000);
      try {
        let { title, songs: got } = await autoBuild(vibe.value.trim(), Math.max(4, Math.min(30, +count.value || 12)));
        if (verify.checked && service.connected) {
          const checked = [];
          for (const sg of got) { const hit = await service.find(sg).catch(() => null); if (hit) checked.push(newSong(hit)); }
          if (checked.length < got.length) toast(`${got.length - checked.length} songs weren't found in the catalog and were left out.`);
          got = checked;
        }
        songs = got;
        if (title) panel.set({ title });
        songsChanged();
        toast(`Built ${got.length} songs.`, 'success');
        findCovers(got);
      } catch (err) {
        toast(err.message, 'error', 8000);
      } finally { t.remove(); go.disabled = false; }
    },
  });
  buildEl.replaceChildren(
    vibe,
    h('label', { class: 'ctrl-label' }, h('span', {}, 'Songs'), count),
    h('label', { class: 'ctrl-label', for: 'pl-key' }, h('span', {}, 'Anthropic API key')), key,
    h('label', { class: 'toggle' }, h('span', {}, 'Remember the key on this device'), remember),
    h('label', { class: 'toggle' }, h('span', {}, 'Check songs with the music service (when connected)'), verify),
    go,
    h('div', { class: 'ctrl-hint' }, 'Uses your own key; your browser sends the description straight to api.anthropic.com. Covers are then looked up for each song.'));
}
renderBuild();

/* ---------- Hand tracking pass ---------- */
function renderTrack() {
  const n = hand?.samples.length || 0;
  const found = hand ? hand.samples.filter((x) => x.tip).length : 0;
  trackEl.replaceChildren(
    h('button', { type: 'button', class: 'btn btn-sm btn-primary', html: `${icon('target')} ${hand ? 'Track again' : 'Track hand'}`, disabled: !isVideo() || tracking, onclick: trackHand }),
    h('div', { class: 'ctrl-hint' }, !media ? 'Upload a video first.' : !isVideo() ? 'Photos use keyframes.' : hand
      ? `Fingertip found in ${found} of ${n} frames (${Math.round((found / Math.max(1, n)) * 100)}%).${found < n * 0.5 ? ' Keep the hand in view and well lit.' : ''}`
      : 'Finds the index fingertip on every frame once, then the list follows it.'),
  );
}

async function trackHand() {
  if (!isVideo() || tracking) return;
  tracking = true;
  renderTrack();
  stage.pause();
  const ctrl = new AbortController();
  const modal = progressModal('Tracking the hand…', () => ctrl.abort(), 'Loading the hand model (about 8 MB, once).');
  const el = media.el, resume = el.currentTime;
  try {
    const lm = await loadHandLandmarker({ numHands: 2 });
    const fps = +s.rate;
    const n = Math.max(1, Math.floor(media.duration * fps));
    const aspect = media.width / media.height;
    const samples = [];
    let prev = null;
    modal.phase('Tracking the hand…', `${n} frames at ${fps} / s.`);
    el.pause();
    for (let i = 0; i < n; i++) {
      if (ctrl.signal.aborted) break;
      const t = Math.min(media.duration - 0.001, i / fps);
      await seekVideo(el, t);
      const hands = detectHands(lm, el);
      // Keep following the same hand: nearest fingertip to the last one, else the most confident.
      let best = null;
      for (const hd of hands) {
        const tip = hd.points[8];
        const d = prev ? Math.hypot((tip.x - prev.x) * aspect, tip.y - prev.y) : -hd.score;
        if (!best || d < best.d) best = { hd, d };
      }
      if (best) {
        const p = best.hd.points;
        const size = Math.hypot((p[0].x - p[9].x) * aspect, p[0].y - p[9].y);
        const pinchDist = Math.hypot((p[4].x - p[8].x) * aspect, p[4].y - p[8].y) / Math.max(1e-3, size);
        samples.push({ t, tip: { x: p[8].x, y: p[8].y }, thumb: { x: p[4].x, y: p[4].y }, size, pinchDist, pts: p.map((q) => ({ x: q.x, y: q.y })) });
        prev = p[8];
      } else { samples.push({ t, tip: null }); prev = null; }
      modal.set((i + 1) / n * (s.handFront ? 0.6 : 1));
      if (i % 3 === 2) await new Promise((r) => setTimeout(r));
    }
    if (!ctrl.signal.aborted) {
      hand = { fps, samples };
      simKey = '';
      if (s.handFront) {
        modal.phase('Masking the hand…', 'Person segmentation, so the hand can sit in front of the list.');
        person.mode = 'person';
        person.setGrid(0, media.duration, fps);
        await person.ensure();
        await person.run({ onProgress: modal.set, signal: ctrl.signal });
      }
    } else toast('Tracking cancelled.');
  } catch (err) {
    console.error(err);
    toast(`Hand tracking failed: ${err.message || err}`, 'error', 7000);
  } finally {
    modal.close();
    await seekVideo(el, resume);
    tracking = false;
    renderTrack();
    syncNote();
    exportBar.refresh();
    stage.invalidate();
  }
}

/* ---------- Manual keyframes ---------- */
function renderKeys() {
  keys.sort((a, b) => a.t - b.t);
  store.set('scrolling-playlist:keys', keys);
  keysEl.replaceChildren(
    h('div', { class: 'pl-row-actions' },
      h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('plus')} Keyframe at playhead`, onclick: () => {
        const t = stage.time;
        keys = keys.filter((k) => Math.abs(k.t - t) > 0.05);
        keys.push({ t, pos: s.manualPos });
        renderKeys(); stage.invalidate();
      } }),
      keys.length ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', html: `${icon('trash')} Clear`, onclick: () => { keys = []; renderKeys(); stage.invalidate(); } }) : null),
    ...keys.map((k) => h('div', { class: 'pl-key' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onclick: () => { stage.seek(k.t); panel.set({ manualPos: k.pos }, { silent: true }); } }, `${formatTime(k.t)} → row ${k.pos.toFixed(1)}`),
      h('button', { type: 'button', class: 'btn btn-ghost btn-sm pl-icon', html: icon('x'), 'aria-label': 'Remove keyframe', onclick: () => { keys = keys.filter((x) => x !== k); renderKeys(); stage.invalidate(); } }))),
    h('div', { class: 'ctrl-hint' }, keys.length ? 'The list eases between keyframes.' : 'Set the scroll position, then add keyframes at different times.'),
  );
}
renderKeys();

/* ---------- Rendering ---------- */
const maxPos = () => Math.max(0, songs.length - s.visibleRows);

function getSim(place, W, H) {
  const key = JSON.stringify([hand?.samples.length, hand?.fps, s.strength, s.smoothing, s.friction, s.anywhere, s.pinch, s.startPlaying, songs.length, s.visibleRows, s.showTop, s.showBottom, s.x, s.y, s.size, s.rotation, W, H,
    s.returnFilter, s.direction, s.cooldown, s.maxSpeed, s.offMode, offRanges]);
  if (key !== simKey) {
    simKey = key;
    sim = hand ? simulateScroll(hand, {
      rowPx: 150 * place.scale, frameH: H, area: place.box, anywhere: s.anywhere, strength: s.strength,
      smoothing: s.smoothing, friction: 1 + (1 - s.friction) * 9, maxPos: maxPos(), startPlaying: s.startPlaying - 1,
      pinch: s.pinch ? 0.35 : -1,
      returnFilter: s.returnFilter, direction: s.direction, cooldown: s.cooldown, maxSpeed: s.maxSpeed,
      offRanges, offMode: s.offMode,
      rowAt: (x, y, p) => rowAtPoint(s, place, W, H, p, x, y, songs.length),
    }) : null;
    drawStrokes();
  }
  return sim;
}

function sampleAt(t) {
  if (!hand) return null;
  const i = Math.round(t * hand.fps);
  return hand.samples[Math.max(0, Math.min(hand.samples.length - 1, i))] || null;
}

/** The hand's outline, grown around its centre and feathered, as an alpha canvas. */
function handRegion(sm, W, H, k) {
  const c = scratch(`pl-hand-${W}x${H}`, W, H);
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  const pts = hull(sm.pts.map((p) => [p.x * W, p.y * H]));
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const grow = 1.35;
  x.beginPath();
  pts.forEach(([px, py], i) => { const X = cx + (px - cx) * grow, Y = cy + (py - cy) * grow; if (i) x.lineTo(X, Y); else x.moveTo(X, Y); });
  x.closePath();
  x.fillStyle = '#fff';
  if (supportsCanvasFilter) x.filter = `blur(${6 * k}px)`;
  x.fill();
  x.filter = 'none';
  return c;
}

function hull(points) {
  const p = points.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080;
  ctx.clearRect(0, 0, W, H);
  if (media) ctx.drawImage(media.el, 0, 0, W, H);
  else {
    const g = ctx.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#2b2546'); g.addColorStop(1, '#0e3b47');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  const place = placement(s, W, H);
  let pos, playing = s.startPlaying - 1;
  if (s.mode === 'hand' && hand && isVideo()) {
    const sm = getSim(place, W, H);
    pos = sm.posAt(t);
    playing = sm.playingAt(t);
  } else if (s.mode === 'manual') pos = keyedScroll(keys, t, s.manualPos);
  else pos = 0;
  pos = Math.max(0, Math.min(maxPos(), pos));
  const px = Math.min(2, place.scale * 1.3);
  const sheet = drawSheet(songs, s, { pos, playing, t, covers, px });
  drawPlaylist(ctx, sheet, s, { place, backdrop: media ? media.el : canvas, curve });

  const sm = s.mode === 'hand' && isVideo() ? sampleAt(t) : null;
  if (s.handFront && sm?.pts && media) {
    const alpha = person.alpha(media.el.currentTime, W, H, { threshold: 0.5, softness: 0.25, feather: 2 * k, smooth: 0.3 });
    if (alpha) {
      const layer = scratch(`pl-front-${W}x${H}`, W, H);
      const lx = layer.getContext('2d');
      lx.globalCompositeOperation = 'source-over';
      lx.clearRect(0, 0, W, H);
      lx.drawImage(handRegion(sm, W, H, k), 0, 0);
      lx.globalCompositeOperation = 'destination-in';
      lx.drawImage(alpha, 0, 0);
      lx.globalCompositeOperation = 'source-in';
      lx.drawImage(media.el, 0, 0, W, H);
      lx.globalCompositeOperation = 'source-over';
      ctx.drawImage(layer, 0, 0);
    }
  }
  drawDebug(sm, place, W, H);
}

function drawDebug(sm, place, W, H) {
  if (marks.width !== W || marks.height !== H) { marks.width = W; marks.height = H; }
  mctx.clearRect(0, 0, W, H);
  if (exporting) return;
  const q = W / (canvas.getBoundingClientRect().width || W);
  if (dragging) {
    const b = place.box;
    mctx.setLineDash([6 * q, 6 * q]);
    mctx.strokeStyle = 'rgba(255,255,255,.8)';
    mctx.lineWidth = 2 * q;
    mctx.strokeRect(b.x * W, b.y * H, b.w * W, b.h * H);
    mctx.setLineDash([]);
  }
  if (!s.showHand || s.mode !== 'hand' || !isVideo()) return;
  // Debug overlay (marks canvas, never exported): the fingertip, coloured by what the scroll is doing with it.
  const st = sim ? sim.stateAt(stage.time) : 'none';
  const look = DEBUG_STATES[st] || DEBUG_STATES.none;
  const label = !hand ? 'not tracked yet' : look.label;
  mctx.font = `600 ${15 * q}px ${getComputedStyle(document.body).fontFamily}`;
  const tw = mctx.measureText(label).width;
  const tip = sm?.tip;
  const lx = tip ? Math.min(W - tw - 30 * q, tip.x * W + 16 * q) : 14 * q, ly = tip ? Math.max(20 * q, tip.y * H - 18 * q) : 14 * q;
  mctx.fillStyle = 'rgba(0,0,0,.65)';
  mctx.beginPath(); mctx.roundRect(lx, ly, tw + 20 * q, 26 * q, 13 * q); mctx.fill();
  mctx.fillStyle = look.color;
  mctx.beginPath(); mctx.arc(lx + 10 * q, ly + 13 * q, 4 * q, 0, Math.PI * 2); mctx.fill();
  mctx.fillStyle = '#fff';
  mctx.textBaseline = 'middle';
  mctx.fillText(label, lx + 18 * q, ly + 13.5 * q);
  if (!tip) return;
  mctx.fillStyle = look.color;
  mctx.strokeStyle = '#fff';
  mctx.lineWidth = 2 * q;
  mctx.beginPath(); mctx.arc(tip.x * W, tip.y * H, 9 * q, 0, Math.PI * 2); mctx.fill(); mctx.stroke();
}

const DEBUG_STATES = {
  count: { color: '#2fbf71', label: 'counting' },
  return: { color: '#9ca3af', label: 'ignored: return stroke' },
  cooldown: { color: '#f5a524', label: 'cooldown' },
  off: { color: '#a78bfa', label: 'detection off' },
  outside: { color: '#60a5fa', label: 'outside the playlist' },
  still: { color: '#60a5fa', label: 'holding still' },
  none: { color: '#e5484d', label: 'no hand' },
};

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render: (t) => { render(t); moveHead(t); },
  getDuration: () => (isVideo() ? media.duration : s.clip),
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `${(media?.name || 'playlist').replace(/\.[^.]+$/, '')}-playlist`,
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  gif: () => !!media,
  png: () => !!media,
  hint: () => (isVideo() && s.mode === 'hand' && !hand ? 'Track the hand first, or switch Scroll by to Keyframes.' : ''),
  beforeExport: () => {
    if (isVideo() && s.mode === 'hand' && !hand) throw new Error('Press Track hand first (Scrolling section).');
    exporting = true;
  },
  afterExport: () => { exporting = false; stage.invalidate(); },
});

/* ---------- Drag the playlist ---------- */
let dragging = null;
const toCanvas = (e) => {
  const r = canvas.getBoundingClientRect();
  return { x: ((e.clientX - r.left) / r.width) * canvas.width, y: ((e.clientY - r.top) / r.height) * canvas.height };
};
canvas.addEventListener('pointerdown', (e) => {
  const p = toCanvas(e);
  const b = placement(s, canvas.width, canvas.height).box;
  const W = canvas.width, H = canvas.height;
  if (p.x < b.x * W || p.x > (b.x + b.w) * W || p.y < b.y * H || p.y > (b.y + b.h) * H) return;
  canvas.setPointerCapture(e.pointerId);
  dragging = { p, x: s.x, y: s.y };
  canvas.classList.add('pl-dragging');
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const p = toCanvas(e);
  panel.set({
    x: Math.round(Math.max(0, Math.min(100, dragging.x + ((p.x - dragging.p.x) / canvas.width) * 100)) * 2) / 2,
    y: Math.round(Math.max(0, Math.min(100, dragging.y + ((p.y - dragging.p.y) / canvas.height) * 100)) * 2) / 2,
  }, { silent: true });
  stage.invalidate();
});
const endDrag = () => { if (dragging) { dragging = null; canvas.classList.remove('pl-dragging'); stage.invalidate(); } };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
new ResizeObserver(() => Object.assign(marks.style, { left: `${canvas.offsetLeft}px`, top: `${canvas.offsetTop}px`, width: `${canvas.offsetWidth}px`, height: `${canvas.offsetHeight}px` })).observe(canvas);

function syncNote() {
  overlay.classList.add('is-note');
  let text = '';
  if (!media) text = 'Drop a video on the left: someone moving a finger up and down in front of the camera.';
  else if (isVideo() && s.mode === 'hand' && !hand) text = 'Press Track hand (Scrolling section) so the list follows the finger.';
  overlay.hidden = !text;
  overlay.replaceChildren(h('div', {}, text));
}

/* ---------- Hand detection timeline: detection-off ranges + which strokes counted ---------- */
const tl = {
  track: h('div', { class: 'pl-tl', role: 'group', 'aria-label': 'Hand detection timeline' }),
  strokes: h('canvas', { class: 'pl-tl-strokes', 'aria-hidden': 'true' }),
  head: h('div', { class: 'pl-tl-head' }),
  ranges: h('div', { class: 'pl-tl-ranges' }),
};
tl.track.append(tl.strokes, tl.ranges, tl.head);
const dur = () => (isVideo() ? media.duration : 0);
const tAt = (e) => Math.max(0, Math.min(dur(), ((e.clientX - tl.track.getBoundingClientRect().left) / tl.track.clientWidth) * dur()));
const rangesChanged = () => { simKey = ''; renderRangeEls(); stage.invalidate(); };

function renderRanges() {
  rangesEl.hidden = !(isVideo() && s.mode === 'hand');
  if (rangesEl.hidden) return;
  const add = h('button', { type: 'button', class: 'btn btn-sm', html: `${icon('plus')} Detection-off range`, onclick: () => {
    const t = stage.time, D = dur();
    const start = Math.min(t, Math.max(0, D - 1));
    offRanges.push({ start, end: Math.min(D, start + 1) });
    rangesChanged();
  } });
  rangesEl.replaceChildren(
    h('div', { class: 'pl-tl-bar' },
      h('span', { class: 'pl-tl-title' }, 'Hand detection'),
      h('span', { class: 'pl-tl-legend' }, h('i', { class: 'is-count' }), 'swipe', h('i', { class: 'is-return' }), 'ignored', h('i', { class: 'is-off' }), 'off'),
      add),
    tl.track,
    h('div', { class: 'ctrl-hint' }, offRanges.length
      ? 'Drag a range to move it, drag its edges to resize. × or Delete removes it. Click the strip to jump there.'
      : 'Add a range where the hand should be ignored (e.g. when it waves or leaves). Click the strip to jump there.'));
  renderRangeEls();
  drawStrokes();
}

function renderRangeEls() {
  const D = dur() || 1;
  tl.ranges.replaceChildren(...offRanges.map((r, i) => {
    const del = h('button', { type: 'button', class: 'pl-tl-del', 'aria-label': 'Remove range', html: icon('x'), onclick: (e) => { e.stopPropagation(); offRanges.splice(i, 1); rangesChanged(); renderRanges(); } });
    const el = h('div', {
      class: 'pl-tl-range', tabindex: 0, role: 'button', 'data-i': i,
      'aria-label': `Detection off from ${formatTime(r.start)} to ${formatTime(r.end)}`,
      style: `left:${(r.start / D) * 100}%;width:${((r.end - r.start) / D) * 100}%`,
    }, h('span', { class: 'pl-tl-edge is-start', 'data-edge': 'start' }), h('span', { class: 'pl-tl-edge is-end', 'data-edge': 'end' }), del);
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); offRanges.splice(i, 1); rangesChanged(); renderRanges(); }
    });
    return el;
  }));
}

let tlDrag = null;
tl.track.addEventListener('pointerdown', (e) => {
  if (!isVideo() || e.button !== 0 || e.target.closest('.pl-tl-del')) return;
  const rangeEl = e.target.closest('.pl-tl-range');
  e.preventDefault();
  tl.track.setPointerCapture(e.pointerId);
  if (!rangeEl) { stage.seek(tAt(e)); tlDrag = { seek: true }; return; }
  const i = +rangeEl.dataset.i;
  tlDrag = { i, edge: e.target.dataset.edge || null, t: tAt(e), r: { ...offRanges[i] } };
  rangeEl.focus();
});
tl.track.addEventListener('pointermove', (e) => {
  if (!tlDrag) return;
  if (tlDrag.seek) { stage.seek(tAt(e)); return; }
  const D = dur(), r = offRanges[tlDrag.i], d = tAt(e) - tlDrag.t, min = 0.1;
  if (tlDrag.edge === 'start') r.start = Math.max(0, Math.min(r.end - min, tlDrag.r.start + d));
  else if (tlDrag.edge === 'end') r.end = Math.min(D, Math.max(r.start + min, tlDrag.r.end + d));
  else {
    const len = tlDrag.r.end - tlDrag.r.start;
    r.start = Math.max(0, Math.min(D - len, tlDrag.r.start + d));
    r.end = r.start + len;
  }
  rangesChanged();
  tl.ranges.querySelector(`[data-i="${tlDrag.i}"]`)?.focus();
});
const endTl = () => { if (tlDrag && !tlDrag.seek) renderRanges(); tlDrag = null; };
tl.track.addEventListener('pointerup', endTl);
tl.track.addEventListener('pointercancel', endTl);

/** Which strokes counted (green) and which were ignored (grey), from the last simulation. */
function drawStrokes() {
  if (rangesEl.hidden) return;
  const c = tl.strokes, W = Math.max(60, Math.round(tl.track.clientWidth || 300)) * 2, H = 40;
  if (c.width !== W) { c.width = W; c.height = H; }
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  const D = dur();
  if (!sim || !D) return;
  for (const st of sim.strokes) {
    x.fillStyle = st.counts ? '#2fbf71' : 'rgba(150,150,160,.55)';
    const a = (st.t0 / D) * W, b = (st.t1 / D) * W;
    x.fillRect(a, st.counts ? 8 : 14, Math.max(2, b - a - 1), st.counts ? 24 : 12);
  }
}
new ResizeObserver(() => drawStrokes()).observe(tl.track);

function moveHead(t) {
  if (!rangesEl.hidden && dur()) tl.head.style.left = `${(Math.max(0, Math.min(dur(), t)) / dur()) * 100}%`;
}

canvas.width = 1080; canvas.height = 1920;
renderSongs();
loadCovers();
renderTrack();
renderRanges();
syncNote();
