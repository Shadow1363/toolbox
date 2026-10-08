/*
 * Audio Trimmer + Fade: keep or delete a region, fade in/out with a curve, split into parts, ringtone presets.

 *
 * Model (all in source seconds): `sel` (the edit selection), `splits[]` (split points), `off` (Set of excluded part
 * indices). `pieces()` turns the settings into the source ranges that make up the result; `renderResult()` cuts them
 * out (`concatBuffers`, 10 ms crossfades at joins) and applies the fades in an OfflineAudioContext with the same
 * 200 Hz gain curve the live preview schedules (`envelopeCurve`), so the export matches what you hear.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { h, icon, toast, formatTime } from "/assets/js/lib/dom.js";
import { takeFile } from "/assets/js/lib/handoff.js";
import { downloadZip } from "/assets/js/lib/image-io.js";
import {
  createAudioDrop,
  loadAudioWithProgress,
  clock,
  parseTime,
} from "/assets/js/lib/audio-io.js";
import { createWaveform } from "/assets/js/lib/audio-waveform.js";
import { createPlayer, envelopeCurve } from "/assets/js/lib/audio-player.js";
import {
  createAudioExport,
  sliceBuffer,
  concatBuffers,
  renderOffline,
} from "/assets/js/lib/audio-export.js";

const XFADE = 0.01;
const DUCK = 0.2; // gain of removed audio in the Edit preview, so you can hear what goes

let file = null;
let source = null; // decoded AudioBuffer
let sel = null; // { start, end } edit selection
let splits = []; // sorted split points (seconds)
const off = new Set(); // excluded part indices (split mode)
let view = "edit"; // 'edit' | 'result'
let result = null; // { key, buffer, parts: AudioBuffer[] }

/* ---------- Fades ---------- */
const SHAPES = {
  linear: (x) => x,
  exp: (x) => (Math.exp(4 * x) - 1) / (Math.exp(4) - 1),
  s: (x) => 0.5 - 0.5 * Math.cos(Math.PI * x),
};
const CURVES = [
  ["linear", "Linear"],
  ["exp", "Exponential"],
  ["s", "S-curve"],
];

/** Gain at `a` seconds after the start and `b` seconds before the end of a piece of audio. */
function fadeGain(a, b) {
  const fi =
    s.fadeIn > 0
      ? SHAPES[s.fadeInCurve](Math.max(0, Math.min(1, a / s.fadeIn)))
      : 1;
  const fo =
    s.fadeOut > 0
      ? SHAPES[s.fadeOutCurve](Math.max(0, Math.min(1, b / s.fadeOut)))
      : 1;
  return fi * fo;
}

/* ---------- Controls ---------- */
const startIn = h("input", {
  type: "text",
  inputmode: "decimal",
  spellcheck: "false",
  "aria-label": "Start time",
});
const endIn = h("input", {
  type: "text",
  inputmode: "decimal",
  spellcheck: "false",
  "aria-label": "End time",
});
const lenIn = h("input", {
  type: "text",
  inputmode: "decimal",
  spellcheck: "false",
  "aria-label": "Length",
});
const timesEl = h(
  "div",
  {},
  h(
    "div",
    { class: "tr-times" },
    h("label", {}, "Start", startIn),
    h("label", {}, "End", endIn),
    h("label", {}, "Length", lenIn),
  ),
  h(
    "div",
    { class: "tr-time-btns" },
    h(
      "button",
      {
        type: "button",
        class: "btn btn-sm",
        onclick: () => setEdge("start", player.time),
        title: "Shortcut: [",
      },
      "Start at playhead",
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-sm",
        onclick: () => setEdge("end", player.time),
        title: "Shortcut: ]",
      },
      "End at playhead",
    ),
    h(
      "button",
      {
        type: "button",
        class: "btn btn-sm btn-ghost",
        onclick: () => source && setSel({ start: 0, end: source.duration }),
      },
      "All",
    ),
  ),
);

const partsEl = h("div", { class: "tr-parts" });
const splitBtn = h("button", {
  type: "button",
  class: "btn btn-sm",
  html: `${icon("scissors")} Split at playhead`,
  onclick: () => addSplit(player.time),
  title: "Shortcut: S",
});
const clearSplits = h(
  "button",
  {
    type: "button",
    class: "btn btn-sm btn-ghost",
    onclick: () => {
      splits = [];
      off.clear();
      changed();
    },
  },
  "Remove splits",
);

const RINGTONES = [
  {
    label: "Ringtone (30 s)",
    value: "ring30",
    patch: {
      mode: "trim",
      keep: "keep",
      maxLen: "30",
      fadeIn: 0.5,
      fadeOut: 2,
      fadeInCurve: "s",
      fadeOutCurve: "s",
    },
  },
  {
    label: "Phone ringtone (40 s)",
    value: "ring40",
    patch: {
      mode: "trim",
      keep: "keep",
      maxLen: "40",
      fadeIn: 0.5,
      fadeOut: 2,
      fadeInCurve: "s",
      fadeOutCurve: "s",
    },
  },
  {
    label: "Clip (15 s)",
    value: "clip15",
    patch: {
      mode: "trim",
      keep: "keep",
      maxLen: "15",
      fadeIn: 0.2,
      fadeOut: 1,
      fadeInCurve: "linear",
      fadeOutCurve: "exp",
    },
  },
  {
    label: "Story (60 s)",
    value: "clip60",
    patch: {
      mode: "trim",
      keep: "keep",
      maxLen: "60",
      fadeIn: 0.3,
      fadeOut: 1.5,
      fadeInCurve: "s",
      fadeOutCurve: "s",
    },
  },
];

const sec = (v) => (v ? `${v.toFixed(1)}s` : "Off");
const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Edit",
      controls: [
        {
          id: "mode",
          type: "segmented",
          label: "Mode",
          value: "trim",
          options: [
            ["trim", "Trim"],
            ["split", "Split into parts"],
          ],
        },
        {
          id: "keep",
          type: "segmented",
          label: "Selection",
          value: "keep",
          options: [
            ["keep", "Keep it"],
            ["delete", "Delete it"],
          ],
          showIf: (st) => st.mode === "trim",
        },
        { type: "custom", el: timesEl, showIf: (st) => st.mode === "trim" },
        {
          id: "maxLen",
          type: "select",
          label: "Max length",
          value: "0",
          options: [
            ["0", "No limit"],
            ["15", "15 s"],
            ["30", "30 s"],
            ["40", "40 s"],
            ["60", "60 s"],
            ["90", "90 s"],
          ],
          showIf: (st) => st.mode === "trim" && st.keep === "keep",
          hint: "Caps the selection while you drag.",
        },
      ],
    },
    {
      title: "Parts",
      showIf: (st) => st.mode === "split",
      controls: [
        {
          type: "custom",
          el: h("div", { class: "btn-row" }, splitBtn, clearSplits),
        },
        { type: "custom", el: partsEl },
        {
          id: "splitOut",
          type: "segmented",
          label: "Export",
          value: "separate",
          options: [
            ["separate", "Each part (.zip)"],
            ["join", "Join kept parts"],
          ],
        },
      ],
    },
    {
      title: "Fades",
      controls: [
        {
          id: "fadeIn",
          type: "range",
          label: "Fade in",
          min: 0,
          max: 10,
          step: 0.1,
          value: 0,
          format: sec,
        },
        {
          id: "fadeInCurve",
          type: "segmented",
          label: "Fade-in curve",
          value: "s",
          options: CURVES,
          showIf: (st) => st.fadeIn > 0,
        },
        {
          id: "fadeOut",
          type: "range",
          label: "Fade out",
          min: 0,
          max: 10,
          step: 0.1,
          value: 0,
          format: sec,
        },
        {
          id: "fadeOutCurve",
          type: "segmented",
          label: "Fade-out curve",
          value: "s",
          options: CURVES,
          showIf: (st) => st.fadeOut > 0,
        },
      ],
    },
    {
      title: "Ringtone & clip presets",
      controls: [
        {
          id: "preset",
          type: "presets",
          value: "",
          options: RINGTONES,
          hint: "Selects that length from the playhead (or the selection start) and sets gentle fades. MP3 works as a ringtone on most phones.",
        },
      ],
    },
  ],
  {
    onChange: (st, id) => {
      if (id === "preset") applyPreset();
      if (id === "maxLen" && sel) setSel(sel);
      changed();
    },
  },
);
const s = panel.state;

/* ---------- Waveform + player ---------- */
const wave = createWaveform(document.getElementById("wave"), {
  height: 170,
  onSeek: (t) => player.seek(t),
  onSelect: (next, { done }) => {
    if (view === "result") return; // a selection on the result is only a loop region
    if (
      next &&
      s.mode === "trim" &&
      s.keep === "keep" &&
      +s.maxLen > 0 &&
      next.end - next.start > +s.maxLen
    ) {
      next.end = next.start + +s.maxLen;
      wave.selection = next;
    }
    sel = next;
    version++;
    syncTimes();
    if (done) changed();
    else {
      wave.redraw();
    }
  },
  overlay: drawOverlay,
  markers: () =>
    view === "edit" && s.mode === "split"
      ? splits.map((t, i) => ({ t, label: `${i + 2}` }))
      : [],
  selectionTone: () =>
    view === "edit" && s.mode === "trim" && s.keep === "delete"
      ? "danger"
      : "accent",
});
const player = createPlayer(document.getElementById("player"), {
  waveform: wave,
  getBuffer: () => (view === "result" ? result?.buffer : source),
  envelope: editGain,
  useEnvelope: () => view === "edit", // the result buffer already has its fades
});

/* ---------- Pieces of the result ---------- */
/** Part boundaries in split mode: [{ start, end, index }]. */
function parts() {
  if (!source) return [];
  const pts = [
    0,
    ...splits.filter((t) => t > 0.02 && t < source.duration - 0.02),
    source.duration,
  ];
  return pts
    .slice(0, -1)
    .map((a, i) => ({ start: a, end: pts[i + 1], index: i }));
}

/** Source ranges that make up the result, plus how fades apply ('each' piece or the 'whole' join). Memoized per edit. */
let version = 0,
  memo = { v: -1, value: null };
function pieces() {
  if (memo.v !== version) memo = { v: version, value: computePieces() };
  return memo.value;
}
function computePieces() {
  if (!source) return { list: [], fades: "whole" };
  const d = source.duration;
  if (s.mode === "split") {
    const list = parts().filter((p) => !off.has(p.index));
    return { list, fades: s.splitOut === "separate" ? "each" : "whole" };
  }
  if (!sel || sel.end - sel.start < 0.01)
    return { list: [{ start: 0, end: d }], fades: "whole" };
  if (s.keep === "keep")
    return { list: [{ start: sel.start, end: sel.end }], fades: "whole" };
  return {
    list: [
      { start: 0, end: sel.start },
      { start: sel.end, end: d },
    ].filter((p) => p.end - p.start > 0.005),
    fades: "whole",
  };
}

/** Edit-view gain at source time t (what the result will do to that moment). */
function editGain(t) {
  const { list, fades } = pieces();
  const p = list.find((x) => t >= x.start && t <= x.end);
  if (!p) return DUCK;
  if (fades === "each") return fadeGain(t - p.start, p.end - t);
  // Whole: fades at the start of the first piece and the end of the last, measured in result time.
  let before = 0;
  for (const x of list) {
    if (x === p) break;
    before += x.end - x.start;
  }
  const total = list.reduce((n, x) => n + x.end - x.start, 0);
  const at = before + (t - p.start);
  return fadeGain(at, total - at);
}

/* ---------- Render ---------- */
const keyOf = () =>
  JSON.stringify([
    pieces(),
    s.fadeIn,
    s.fadeOut,
    s.fadeInCurve,
    s.fadeOutCurve,
    source?.length,
  ]);

async function fade(buffer) {
  if (!s.fadeIn && !s.fadeOut) return buffer;
  const d = buffer.duration;
  return renderOffline(buffer, (ctx, src) => {
    const g = ctx.createGain();
    g.gain.setValueCurveAtTime(
      envelopeCurve((t) => fadeGain(t, d - t), 0, d),
      0,
      d,
    );
    src.connect(g);
    return g;
  });
}

let pending = null;
/** The rendered result for the current settings (cached per settings key; concurrent calls share one render). */
function renderResult() {
  if (!source) return Promise.resolve(null);
  const key = keyOf();
  if (result?.key === key) return Promise.resolve(result);
  if (pending?.key === key) return pending.promise;
  const { list, fades } = pieces();
  const promise = (async () => {
    if (!list.length) return { key, buffer: null, parts: [] };
    const cut = list.map((p) => sliceBuffer(source, p.start, p.end));
    let partsOut, buffer;
    if (fades === "each") {
      partsOut = await Promise.all(cut.map(fade));
      buffer = concatBuffers(partsOut, { xfade: 0 });
    } else {
      buffer = await fade(concatBuffers(cut, { xfade: XFADE }));
      partsOut = [buffer];
    }
    return { key, buffer, parts: partsOut };
  })().then((r) => {
    if (keyOf() === key) result = r;
    return r;
  });
  pending = { key, promise };
  return promise;
}

let renderTimer = 0;
function changed() {
  version++;
  syncTimes();
  renderParts();
  wave.redraw();
  player.refresh();
  exportBar.refresh();
  clearTimeout(renderTimer);
  if (view === "result") renderTimer = setTimeout(showResult, 150);
}

async function showResult() {
  const r = await renderResult();
  if (view !== "result") return;
  wave.setBuffer(r?.buffer || null, { keepView: false });
  player.refresh();
  exportBar.refresh();
}

/* ---------- Overlay: fade curves, removed parts ---------- */
function drawOverlay(g, v) {
  if (!source) return;
  const accent =
    getComputedStyle(document.documentElement)
      .getPropertyValue("--accent")
      .trim() || "#0071e3";
  const shade = (a, b) => {
    g.fillStyle = "rgba(127,127,127,.28)";
    g.fillRect(v.x(a), v.top, v.x(b) - v.x(a), v.bottom - v.top);
  };
  let ranges;
  if (view === "result") {
    if (!result?.buffer) return;
    ranges = [{ start: 0, end: result.buffer.duration }];
  } else {
    const { list } = pieces();
    // Grey out what won't be in the result.
    let t = 0;
    for (const p of list) {
      if (p.start > t) shade(t, p.start);
      t = p.end;
    }
    if (t < source.duration) shade(t, source.duration);
    ranges = list;
  }
  if (!s.fadeIn && !s.fadeOut) return;
  // The gain envelope as a line (top = full volume).
  g.strokeStyle = accent;
  g.lineWidth = 1.5;
  g.beginPath();
  const gain =
    view === "result"
      ? (t) => fadeGain(t, result.buffer.duration - t)
      : editGain;
  for (const p of ranges) {
    const x0 = Math.max(0, v.x(p.start)),
      x1 = Math.min(v.W, v.x(p.end));
    for (let x = x0; x <= x1; x += 2) {
      const y = v.bottom - gain(Math.min(p.end, v.t(x))) * (v.bottom - v.top);
      if (x === x0) g.moveTo(x, y);
      else g.lineTo(x, y);
    }
  }
  g.stroke();
}

/* ---------- Selection & times ---------- */
function setSel(next) {
  if (!source) return;
  if (next) {
    next = {
      start: Math.max(0, Math.min(source.duration, next.start)),
      end: Math.max(0, Math.min(source.duration, next.end)),
    };
    if (next.end < next.start) [next.start, next.end] = [next.end, next.start];
    if (s.mode === "trim" && s.keep === "keep" && +s.maxLen > 0)
      next.end = Math.min(next.end, next.start + +s.maxLen);
    if (next.end - next.start < 0.01) next = null;
  }
  sel = next;
  if (view === "edit") wave.selection = sel;
  changed();
}

function setEdge(edge, t) {
  if (!source) return;
  const cur = sel || { start: 0, end: source.duration };
  setSel(
    edge === "start"
      ? { start: t, end: Math.max(t + 0.05, cur.end) }
      : { start: Math.min(cur.start, t - 0.05), end: t },
  );
}

function syncTimes() {
  const a = sel?.start ?? 0,
    b = sel?.end ?? source?.duration ?? 0;
  for (const [el, v] of [
    [startIn, a],
    [endIn, b],
    [lenIn, b - a],
  ])
    if (document.activeElement !== el) el.value = source ? clock(v) : "";
}

function commitTime(from) {
  if (!source) return;
  const a = parseTime(startIn.value),
    b = parseTime(endIn.value),
    len = parseTime(lenIn.value);
  if (from === lenIn && isFinite(a) && isFinite(len))
    setSel({ start: a, end: a + len });
  else if (from !== lenIn && isFinite(a) && isFinite(b))
    setSel({ start: a, end: b });
  else {
    toast("Use times like 1:23.5 or 83.5", "warning");
    syncTimes();
  }
}
for (const el of [startIn, endIn, lenIn]) {
  el.addEventListener("change", () => commitTime(el));
  el.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      el.blur();
    }
  });
}

function applyPreset() {
  if (!source) return;
  const len = +s.maxLen || 30;
  const from = sel?.start ?? player.time;
  const start = Math.max(0, Math.min(from, source.duration - len));
  setSel({ start, end: Math.min(source.duration, start + len) });
  wave.zoomToSelection();
}

/* ---------- Splits ---------- */
function addSplit(t) {
  if (!source) return;
  if (t < 0.05 || t > source.duration - 0.05) {
    toast("Move the playhead inside the audio to split there.", "warning");
    return;
  }
  if (splits.some((x) => Math.abs(x - t) < 0.05)) return;
  if (s.mode !== "split") panel.set({ mode: "split" }, { silent: true });
  // Excluded parts are indexed by position, so shift them past the new split.
  const at = parts().findIndex((p) => t > p.start && t < p.end);
  const moved = [...off].map((i) => (i > at ? i + 1 : i));
  off.clear();
  moved.forEach((i) => off.add(i));
  splits = [...splits, t].sort((x, y) => x - y);
  changed();
}

function removeSplit(i) {
  // Removing split i merges parts i and i+1.
  const moved = [...off]
    .filter((k) => k !== i + 1)
    .map((k) => (k > i + 1 ? k - 1 : k));
  off.clear();
  moved.forEach((k) => off.add(k));
  splits.splice(i, 1);
  changed();
}

function renderParts() {
  if (s.mode !== "split") return;
  const list = parts();
  if (list.length < 2) {
    partsEl.replaceChildren(
      h(
        "p",
        { class: "tr-parts-empty" },
        source
          ? "Move the playhead and press Split (or S) to cut the audio into parts."
          : "Load audio first.",
      ),
    );
    return;
  }
  partsEl.replaceChildren(
    ...list.map((p, i) => {
      const box = h("input", {
        type: "checkbox",
        "aria-label": `Keep part ${i + 1}`,
      });
      box.checked = !off.has(i);
      box.addEventListener("change", () => {
        if (box.checked) off.delete(i);
        else off.add(i);
        changed();
      });
      return h(
        "div",
        { class: `tr-part${off.has(i) ? " is-off" : ""}` },
        box,
        h(
          "span",
          { class: "mono", title: `${clock(p.start)} – ${clock(p.end)}` },
          `${i + 1}. ${clock(p.start, 1)} – ${clock(p.end, 1)}`,
        ),
        h("button", {
          type: "button",
          class: "btn btn-ghost",
          title: "Play this part",
          "aria-label": `Play part ${i + 1}`,
          html: icon("play"),
          onclick: () => {
            setView("edit");
            player.seek(p.start);
            player.play();
          },
        }),
        i < list.length - 1
          ? h("button", {
              type: "button",
              class: "btn btn-ghost",
              title: "Remove the split after this part",
              "aria-label": `Merge part ${i + 1} with the next`,
              html: icon("merge"),
              onclick: () => removeSplit(i),
            })
          : h("span"),
      );
    }),
  );
}

/* ---------- View toggle ---------- */
const viewBtns = [...document.querySelectorAll(".tr-view button")];
viewBtns.forEach((b) =>
  b.addEventListener("click", () => setView(b.dataset.v)),
);

async function setView(v) {
  if (view === v) return;
  view = v;
  viewBtns.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.v === v)),
  );
  player.pause();
  if (v === "result") {
    wave.selection = null;
    await showResult();
    player.seek(0);
  } else {
    wave.setBuffer(source);
    wave.selection = sel;
    player.seek(sel?.start ?? 0);
  }
}

/* ---------- Load ---------- */
const emptyEl = document.getElementById("empty");
const drop = createAudioDrop(document.getElementById("upload"), {
  label: "Drop audio or video",
  onFile: (f) => open(f),
  onClear: () => {
    file = null;
    source = null;
    sel = null;
    splits = [];
    off.clear();
    result = null;
    emptyEl.hidden = false;
    wave.setBuffer(null);
    player.stop();
    changed();
  },
});

async function open(f) {
  try {
    const { buffer, method } = await loadAudioWithProgress(f);
    file = f;
    source = buffer;
    sel = null;
    splits = [];
    off.clear();
    result = null;
    emptyEl.hidden = true;
    drop.setFile(
      f,
      `${formatTime(buffer.duration)} · ${buffer.numberOfChannels === 1 ? "mono" : buffer.numberOfChannels === 2 ? "stereo" : `${buffer.numberOfChannels} ch`} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz`,
    );
    if (view === "result") await setView("edit");
    wave.setBuffer(buffer);
    wave.selection = null;
    player.seek(0);
    changed();
    if (method === "ffmpeg")
      toast("Decoded with ffmpeg (your browser couldn’t read this format).");
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    toast(err.message || "Couldn’t open that file.", "error", 8000);
  }
}

// Drop a file anywhere on the waveform panel too.
const panelEl = document.querySelector(".audio-panel");
panelEl.addEventListener("dragover", (e) => e.preventDefault());
panelEl.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) open(f);
});

/* ---------- Keyboard ---------- */
document.addEventListener("keydown", (e) => {
  if (!source || e.ctrlKey || e.metaKey || e.altKey) return;
  const el = e.target;
  if (
    el.isContentEditable ||
    /^(TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el.tagName === "INPUT" && el.type !== "range" && el.type !== "checkbox")
  )
    return;
  if (e.key === "[") setEdge("start", player.time);
  else if (e.key === "]") setEdge("end", player.time);
  else if (e.key === "s" || e.key === "S") {
    if (view === "result") setView("edit");
    addSplit(player.time);
  }
});

/* ---------- Export ---------- */
const baseName = () => (file?.name || "audio").replace(/\.[^.]+$/, "");
const exportBar = createAudioExport(document.getElementById("export"), {
  id: "trimmer",
  getBuffer: async () => (await renderResult())?.buffer,
  filename: () => `${baseName()}-${s.mode === "split" ? "joined" : "trimmed"}`,
  enabled: () => !!source && pieces().list.length > 0,
  info: () => {
    if (!source) return null;
    const { list } = pieces();
    const xf =
      s.mode === "split" && s.splitOut === "separate"
        ? 0
        : XFADE * Math.max(0, list.length - 1);
    return {
      duration: list.reduce((n, p) => n + p.end - p.start, 0) - xf,
      channels: source.numberOfChannels,
      sampleRate: source.sampleRate,
    };
  },
  hint: () =>
    s.mode === "split" && s.splitOut === "separate"
      ? "“Export audio” saves the kept parts joined; “Export parts” saves each as its own file in a ZIP."
      : "",
  actions: [
    {
      label: "Export parts (.zip)",
      icon: "archive",
      show: () =>
        s.mode === "split" &&
        s.splitOut === "separate" &&
        pieces().list.length > 1,
      onClick: (st, btn) => exportParts(btn),
    },
  ],
});

async function exportParts(btn) {
  btn.disabled = true;
  const t = toast("Encoding parts…", "info", 60000);
  try {
    const r = await renderResult();
    const files = [];
    for (let i = 0; i < r.parts.length; i++) {
      t.textContent = `Encoding part ${i + 1} of ${r.parts.length}…`;
      const { blob, ext } = await exportBar.encode(r.parts[i]);
      files.push({
        name: `${baseName()}-part-${String(i + 1).padStart(2, "0")}.${ext}`,
        blob,
      });
    }
    await downloadZip(files, `${baseName()}-parts.zip`);
    toast(`Saved ${files.length} parts in ${baseName()}-parts.zip`, "success");
  } catch (err) {
    console.error(err);
    toast(err.message || "Export failed.", "error", 8000);
  } finally {
    t.remove();
    btn.disabled = false;
  }
}

/* ---------- Start ---------- */
changed();
takeFile("trimmer").then((item) => {
  if (item) {
    toast(
      `Opened ${item.file.name} from ${item.meta?.from || "another tool"}.`,
    );
    open(item.file);
  }
});
