/*
 * Pass files (and small JSON metadata) from one tool to another through IndexedDB.
 *
 *   await sendFile('zoom-on-click', file, { clicks });         // sender, then navigate to the tool
 *   const item = await takeFile('zoom-on-click');              // receiver: { file, meta } or null (removed once read)
 *   const item = await peekFile('zoom-on-click');              // same, without removing it
 *
 * The "Open in…" menu (export bars) and its receiving side:
 *   const openIn = createOpenIn({ kind: 'video', getFile: () => lastFile });   // lists tools whose registry
 *   bar.append(openIn.el);                                                     //   `accepts` has that kind
 *   receiveHandoff('auto-captions', (file) => drop.load(file));                // receiver, once on load
 *
 * One slot per receiving tool id; a new send replaces the old one. Nothing leaves the device.
 * Slots older than a day are dropped on read so a stale recording never reappears.
 */
import { getTool, toolUrl, toolsAccepting } from "../tools.js";
import { h, icon, toast } from "./dom.js";

const DB = "toolbox-handoff";
const STORE = "files";
const MAX_AGE = 24 * 3600 * 1000;

function open() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window))
      return reject(new Error("IndexedDB is unavailable in this browser."));
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(req.error || new Error("Could not open IndexedDB."));
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
      t.onabort = () =>
        reject(t.error || new Error("IndexedDB transaction aborted."));
    });
  } finally {
    db.close();
  }
}

/** Store `file` (a File or Blob) for tool `to`. `meta` must be structured-cloneable. */
export function sendFile(to, file, meta = {}) {
  const name = file.name || "recording.webm";
  return tx("readwrite", (st) =>
    st.put({ file, name, type: file.type, meta, at: Date.now() }, to),
  );
}

/** Read the slot for tool `to` without removing it. Resolves null when empty, stale or unavailable. */
export async function peekFile(to) {
  try {
    const item = await tx("readonly", (st) => st.get(to));
    if (!item) return null;
    if (Date.now() - item.at > MAX_AGE) {
      clearFile(to);
      return null;
    }
    const file =
      item.file instanceof File
        ? item.file
        : new File([item.file], item.name, { type: item.type });
    return { file, meta: item.meta || {} };
  } catch (err) {
    console.warn("Hand-off unavailable", err);
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
  return tx("readwrite", (st) => st.delete(to)).catch(() => {});
}

/**
 * "Open in…" button + menu: sends the file from `getFile()` (File, Blob or a promise of one; null = nothing
 * yet) to the chosen tool and navigates there. `kind` ('image' | 'video' | 'audio', or a function returning
 * one) picks the tools from the registry's `accepts`. `refresh()` hides the button when there is no target.
 */
export function createOpenIn({ kind, getFile, label = "Open in…" }) {
  const here = document.body.dataset.tool;
  const want = () => (typeof kind === "function" ? kind() : kind);
  const targets = () => toolsAccepting(want()).filter((t) => t.id !== here);
  const list = h("div", { class: "open-in-list", role: "menu" });
  const el = h(
    "details",
    { class: "open-in" },
    h("summary", { class: "btn", html: `${icon("arrow")} ${label}` }),
    list,
  );
  el.addEventListener("toggle", () => {
    if (!el.open) return;
    list.replaceChildren(
      ...targets().map((t) =>
        h("button", { type: "button", class: "btn btn-ghost btn-sm", role: "menuitem", onclick: () => go(t) }, t.name),
      ),
    );
  });
  document.addEventListener("click", (e) => {
    if (el.open && !el.contains(e.target)) el.open = false;
  });
  el.addEventListener("keydown", (e) => {
    if (e.key === "Escape") el.open = false;
  });

  async function go(t) {
    el.open = false;
    try {
      let file = await getFile();
      if (!file) return toast("Export something first.");
      if (!(file instanceof File)) file = new File([file], `export.${(file.type.split("/")[1] || "bin").split(";")[0]}`, { type: file.type });
      await sendFile(t.id, file, { from: getTool(here)?.name });
      location.href = toolUrl(t);
    } catch (err) {
      console.error(err);
      toast(`Couldn’t open it in ${t.name}: ${err.message}`, "error");
    }
  }

  const refresh = () => {
    el.hidden = !want() || !targets().length;
  };
  refresh();
  return { el, refresh };
}

/** Receiver side: if a file was sent to `toolId`, pass it to `load(file, meta)` and say where it came from. */
export async function receiveHandoff(toolId, load) {
  const item = await takeFile(toolId);
  if (!item) return null;
  toast(`Opened ${item.file.name} from ${item.meta?.from || "another tool"}.`);
  await load(item.file, item.meta);
  return item;
}
