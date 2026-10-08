/*
 * Pass files (and small JSON metadata) from one tool to another through IndexedDB.
 * © 2026 Tomas Martinez · GPL-3.0-or-later · tm1363-c339e3ad
 *
 *   await sendFile('zoom-on-click', file, { clicks });         // sender, then navigate to the tool
 *   const item = await takeFile('zoom-on-click');              // receiver: { file, meta } or null (removed once read)
 *   const item = await peekFile('zoom-on-click');              // same, without removing it
 *
 * One slot per receiving tool id; a new send replaces the old one. Nothing leaves the device.
 * Slots older than a day are dropped on read so a stale recording never reappears.
 */
const DB = 'toolbox-handoff';
const STORE = 'files';
const MAX_AGE = 24 * 3600 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB is unavailable in this browser.'));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open IndexedDB.'));
  });
}

async function tx(mode, fn) {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(out?.result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('IndexedDB transaction aborted.'));
    });
  } finally { db.close(); }
}

/** Store `file` (a File or Blob) for tool `to`. `meta` must be structured-cloneable. */
export function sendFile(to, file, meta = {}) {
  const name = file.name || 'recording.webm';
  return tx('readwrite', (st) => st.put({ file, name, type: file.type, meta, at: Date.now() }, to));
}

/** Read the slot for tool `to` without removing it. Resolves null when empty, stale or unavailable. */
export async function peekFile(to) {
  try {
    const item = await tx('readonly', (st) => st.get(to));
    if (!item) return null;
    if (Date.now() - item.at > MAX_AGE) { clearFile(to); return null; }
    const file = item.file instanceof File ? item.file : new File([item.file], item.name, { type: item.type });
    return { file, meta: item.meta || {} };
  } catch (err) {
    console.warn('Hand-off unavailable', err);
    return null;
  }
}

/** Read and remove the slot for tool `to`. */
export async function takeFile(to) {
  const item = await peekFile(to);
  if (item) await clearFile(to);
  return item;
}

export function clearFile(to) {
  return tx('readwrite', (st) => st.delete(to)).catch(() => {});
}
