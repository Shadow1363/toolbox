/*
 * Small key-value store on IndexedDB for autosaving documents (boards, sprites, designs) that can
 * outgrow localStorage's ~5 MB. Falls back to localStorage when IndexedDB is unavailable.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   await kvSet('whiteboard:doc', doc);   // any structured-cloneable value (typed arrays, Blobs ok)
 *   const doc = await kvGet('whiteboard:doc');
 *   const save = autosaver('whiteboard:doc', () => doc, 600);  save();  // debounced
 */
import { store } from './dom.js';

const DB = 'toolbox-kv';
const STORE = 'kv';
let dbp = null;

function open() {
  dbp ||= new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexedDB'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => { dbp = null; throw err; });
  return dbp;
}

function run(mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(req?.result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('aborted'));
  }));
}

export const kvGet = (key) => run('readonly', (s) => s.get(key)).catch(() => store.get(`kv:${key}`));
export const kvSet = (key, value) => run('readwrite', (s) => s.put(value, key)).catch(() => store.set(`kv:${key}`, value));
export const kvDel = (key) => run('readwrite', (s) => s.delete(key)).catch(() => { try { localStorage.removeItem(`kv:${key}`); } catch { /* ignore */ } });

/** Debounced saver: call it after every change; it writes `get()` once things settle. */
export function autosaver(key, get, ms = 600) {
  let id = 0;
  const write = () => { id = 0; return kvSet(key, get()).catch((e) => console.warn('Autosave failed', e)); };
  const save = () => { clearTimeout(id); id = setTimeout(write, ms); };
  save.now = () => { clearTimeout(id); return write(); };
  window.addEventListener('pagehide', () => { if (id) { clearTimeout(id); write(); } });
  return save;
}
