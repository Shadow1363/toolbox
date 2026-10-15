/*
 * Scrolling Playlist: getting songs in.
 *
 *   parseList(text, { order })          "Artist – Song" lines (numbered, bulleted, tab- or dash-separated) → songs
 *   lookupCover(song)                   public catalog search (no key, CORS-enabled), then MusicBrainz + Cover Art
 *                                       Archive → image URL or null. Called only when the user turns it on.
 *   loadImageUrl(url)                   <img crossOrigin="anonymous"> so covers stay exportable
 *   service.*                           the user's own music-service developer app, Authorization Code with PKCE
 *   autoBuild(vibe, count)              songs from a description, through lib/ai.js (the user's API key)
 *
 * Music service (Spotify Web API, the only one with a browser-friendly PKCE flow and CORS on its token endpoint):
 * the user creates an app, adds this page as a redirect URI and pastes the client ID. "Connect" opens the consent
 * page in a popup; the popup comes back to this page with ?code=…, posts it to the opener and closes, so the
 * uploaded video stays loaded. The opener exchanges the code (with the PKCE verifier) for a token, kept in memory
 * (or in localStorage when the user opts in). Nothing goes through a server of ours.
 */
import { askJson } from '/assets/js/lib/ai.js';
import { store } from '/assets/js/lib/dom.js';

let nextId = 1;
export const newSong = (o = {}) => ({ id: nextId++, title: '', artist: '', video: false, coverUrl: '', ...o });

/** Parse pasted lines. order: 'artist-title' ("Artist – Song", the default) or 'title-artist'. */
export function parseList(text, { order = 'artist-title' } = {}) {
  const out = [];
  for (let line of String(text || '').split(/\r?\n/)) {
    line = line.replace(/^\s*(?:\d+[.)]|[-*•·])\s+/, '').replace(/^["“]|["”]$/g, '').trim();
    if (!line) continue;
    let a = '', b = '';
    const by = /^(.+?)\s+by\s+(.+)$/i.exec(line);
    const parts = line.split(/\s+[–—-]\s+|\t|\s*\|\s*/);
    if (parts.length >= 2) { a = parts[0]; b = parts.slice(1).join(' - '); }
    else if (by) { out.push(newSong({ title: by[1].trim(), artist: by[2].trim() })); continue; }
    else { out.push(newSong({ title: line })); continue; }
    const [artist, title] = order === 'title-artist' ? [b, a] : [a, b];
    out.push(newSong({ title: title.trim(), artist: artist.trim(), video: /\(official (music )?video\)/i.test(title) }));
  }
  return out;
}

/* ---------- Cover lookup (no key) ---------- */
const coverCache = store.get('scrolling-playlist:covers', {});
const keyOf = (s) => `${s.artist}|${s.title}`.toLowerCase();
let lastMb = 0;

async function itunes(song) {
  const term = encodeURIComponent(`${song.artist} ${song.title}`.trim());
  const r = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=1`, { referrerPolicy: 'no-referrer' });
  if (!r.ok) throw new Error(`search ${r.status}`);
  const hit = (await r.json()).results?.[0];
  return hit?.artworkUrl100 ? hit.artworkUrl100.replace(/\/\d+x\d+bb\./, '/300x300bb.') : null;
}

async function musicbrainz(song) {
  // MusicBrainz asks for at most one request per second.
  const wait = lastMb + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastMb = Date.now();
  const q = encodeURIComponent(`recording:"${song.title}"${song.artist ? ` AND artist:"${song.artist}"` : ''}`);
  const r = await fetch(`https://musicbrainz.org/ws/2/recording?query=${q}&limit=1&fmt=json`, { referrerPolicy: 'no-referrer' });
  if (!r.ok) return null;
  const rel = (await r.json()).recordings?.[0]?.releases?.[0]?.id;
  return rel ? `https://coverartarchive.org/release/${rel}/front-250` : null;
}

/** An artwork URL for the song, or null. Results (including misses) are remembered in localStorage. */
export async function lookupCover(song) {
  const k = keyOf(song);
  if (k in coverCache) return coverCache[k];
  let url = null;
  try { url = await itunes(song); } catch { /* fall through */ }
  if (!url) { try { url = await musicbrainz(song); } catch { /* offline */ } }
  coverCache[k] = url;
  store.set('scrolling-playlist:covers', coverCache);
  return url;
}

/** Load an image that stays exportable (CORS). Resolves null when it fails. */
export function loadImageUrl(url) {
  return new Promise((resolve) => {
    if (!url) return resolve(null);
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/** A small data URL of an uploaded cover (stored with the playlist). */
export function shrinkToDataUrl(img, size = 200) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const sc = Math.max(size / iw, size / ih);
  x.drawImage(img, (size - iw * sc) / 2, (size - ih * sc) / 2, iw * sc, ih * sc);
  return c.toDataURL('image/jpeg', 0.85);
}

/* ---------- Music service: Authorization Code with PKCE ---------- */
const AUTH = 'https://accounts.spotify.com/authorize';
const TOKEN = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';
const SCOPES = 'playlist-read-private playlist-read-collaborative user-library-read';
const TOKEN_KEY = 'scrolling-playlist:service-token';

export const redirectUri = () => `${location.origin}${location.pathname}`;

const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const service = {
  token: store.get(TOKEN_KEY, null),
  get connected() { return !!this.token && this.token.expires > Date.now(); },

  /** Open the consent page in a popup; resolves once the token is in. remember: keep the token in localStorage. */
  async connect(clientId, { remember = false } = {}) {
    clientId = (clientId || '').trim();
    if (!clientId) throw new Error('Paste your app’s Client ID first.');
    const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const state = b64url(crypto.getRandomValues(new Uint8Array(12)));
    const url = `${AUTH}?${new URLSearchParams({ response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: redirectUri(), code_challenge_method: 'S256', code_challenge: challenge, state })}`;
    const popup = window.open(url, 'music-service-auth', 'width=480,height=720');
    if (!popup) throw new Error('The sign-in window was blocked. Allow pop-ups for this page and try again.');
    const code = await new Promise((resolve, reject) => {
      const onMsg = (e) => {
        if (e.origin !== location.origin || e.data?.type !== 'music-auth') return;
        cleanup();
        if (e.data.state !== state) return reject(new Error('Sign-in answer didn’t match. Try again.'));
        if (e.data.error) return reject(new Error(`Sign-in failed: ${e.data.error}`));
        resolve(e.data.code);
      };
      const timer = setInterval(() => { if (popup.closed) { cleanup(); reject(new Error('The sign-in window was closed.')); } }, 600);
      const cleanup = () => { clearInterval(timer); window.removeEventListener('message', onMsg); };
      window.addEventListener('message', onMsg);
    });
    const r = await fetch(TOKEN, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: redirectUri(), client_id: clientId, code_verifier: verifier }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error_description || j.error || `Token request failed (${r.status}).`);
    this.token = { access: j.access_token, expires: Date.now() + (j.expires_in - 60) * 1000 };
    if (remember) store.set(TOKEN_KEY, this.token); else { try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } }
    return this.token;
  },

  disconnect() { this.token = null; try { localStorage.removeItem(TOKEN_KEY); } catch { /* */ } },

  async get(path) {
    if (!this.connected) throw new Error('Connect the music service first (the session may have expired).');
    const r = await fetch(path.startsWith('http') ? path : `${API}${path}`, { headers: { Authorization: `Bearer ${this.token.access}` } });
    if (r.status === 401) { this.disconnect(); throw new Error('The music service session expired. Connect again.'); }
    if (!r.ok) throw new Error(`Music service error ${r.status}${r.status === 403 ? ' (development-mode apps only see your own playlists)' : ''}.`);
    return r.json();
  },

  /** The user's playlists: [{ id, name, count }]. */
  async playlists() {
    const j = await this.get('/me/playlists?limit=50');
    return (j.items || []).filter(Boolean).map((p) => ({ id: p.id, name: p.name, count: p.tracks?.total ?? p.items?.total ?? 0 }));
  },

  /** Songs of a playlist id, 'liked', or a playlist link. Up to `max`. */
  async tracks(which, max = 60) {
    const id = /playlist[/:]([A-Za-z0-9]+)/.exec(which)?.[1] || which;
    let url = id === 'liked' ? `/me/tracks?limit=50` : `/playlists/${encodeURIComponent(id)}/tracks?limit=50`;
    const out = [];
    while (url && out.length < max) {
      const j = await this.get(url);
      for (const it of j.items || []) {
        const t = it.track || it.item;
        if (!t || !t.name) continue;
        out.push(newSong({
          title: t.name,
          artist: (t.artists || []).map((a) => a.name).join(', '),
          video: t.type === 'episode' ? false : !!t.is_video,
          coverUrl: t.album?.images?.slice(-2)[0]?.url || t.album?.images?.[0]?.url || '',
        }));
      }
      url = j.next;
    }
    return out.slice(0, max);
  },

  /** Find a song in the catalog: { title, artist, coverUrl } or null. */
  async find(song) {
    const q = encodeURIComponent(`track:${song.title}${song.artist ? ` artist:${song.artist}` : ''}`);
    const j = await this.get(`/search?type=track&limit=1&q=${q}`);
    const t = j.tracks?.items?.[0];
    return t ? { title: t.name, artist: t.artists.map((a) => a.name).join(', '), coverUrl: t.album?.images?.slice(-2)[0]?.url || '' } : null;
  },
};

/** In the sign-in popup: hand the code to the page that opened it, then close. Returns true when handled. */
export function finishAuthPopup() {
  const q = new URLSearchParams(location.search);
  if (!(q.has('code') || q.has('error')) || !q.has('state')) return false;
  let sameOrigin = false;
  try { sameOrigin = !!window.opener && window.opener.location.origin === location.origin; } catch { /* another site opened us */ }
  if (sameOrigin) {
    window.opener.postMessage({ type: 'music-auth', code: q.get('code'), state: q.get('state'), error: q.get('error') }, location.origin);
    window.close();
    return true;
  }
  history.replaceState(null, '', location.pathname); // opened without a popup: just clean the URL
  return false;
}

/* ---------- Auto-build ---------- */
const SONGS_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string', description: 'A short playlist name' },
    songs: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, artist: { type: 'string' } },
        required: ['title', 'artist'],
        additionalProperties: false,
      },
    },
  },
  required: ['title', 'songs'],
  additionalProperties: false,
};

/** Songs for a vibe description through the user's AI key: { title, songs }. */
export async function autoBuild(vibe, count = 12, { signal } = {}) {
  const res = await askJson({
    system: 'You build music playlists. Only list real, released songs that exist on major streaming services, with the main artist credited as released. No duplicates, no made-up titles.',
    prompt: `Make a playlist of ${count} songs for: ${vibe}\nReturn a short playlist name and the songs in a good listening order.`,
    schema: SONGS_SCHEMA,
    maxTokens: 4000,
    signal,
  });
  return { title: res.title || '', songs: (res.songs || []).slice(0, count).map((s) => newSong({ title: s.title, artist: s.artist })) };
}
