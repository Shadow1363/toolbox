/*
 * Noise Reduction + Volume Normalizer: RNNoise / noise gate / high-pass, EQ and compressor presets, loudness
 * normalization with a peak limiter, A/B compare.

 *
 * Chain (each stage only runs when it does something):
 *   source ─ RNNoise (cached, fully wet) ─ wet/dry mix + gate (dsp.gateMix)
 *          ─ OfflineAudioContext: high-pass → EQ biquads → compressor (+ makeup)
 *          ─ measure LUFS → gain to the target + 5 ms lookahead limiter (dsp.normalizeLimit) ─ processed
 * The player plays `processed` (B) or `source` (A) from the same position, and the export encodes `processed`.
 */
import { createControls } from "/assets/js/lib/controls.js";
import { h, toast, formatTime } from "/assets/js/lib/dom.js";
import { takeFile } from "/assets/js/lib/handoff.js";
import { progressModal } from "/assets/js/lib/exporter.js";
import {
  createAudioDrop,
  loadAudioWithProgress,
} from "/assets/js/lib/audio-io.js";
import { createWaveform } from "/assets/js/lib/audio-waveform.js";
import { createPlayer } from "/assets/js/lib/audio-player.js";
import {
  createAudioExport,
  renderOffline,
} from "/assets/js/lib/audio-export.js";
import { measureLoudness, gateMix, normalizeLimit, rnnoise } from "./dsp.js";

let file = null;
let source = null,
  processed = null;
let wet = null; // RNNoise output for `source` (fully wet)
let before = null,
  after = null,
  appliedGain = 0;
let ab = "b";
let isPlaying = false;

/* ---------- Presets ---------- */
const TARGETS = { podcast: -16, youtube: -14, broadcast: -23, voice: -19 };
const COMP = {
  light: {
    threshold: -18,
    ratio: 2,
    attack: 0.01,
    release: 0.25,
    knee: 8,
    makeup: 2,
  },
  medium: {
    threshold: -24,
    ratio: 3.5,
    attack: 0.006,
    release: 0.18,
    knee: 6,
    makeup: 5,
  },
  heavy: {
    threshold: -30,
    ratio: 6,
    attack: 0.003,
    release: 0.12,
    knee: 4,
    makeup: 9,
  },
};
/** EQ presets as biquad specs: [type, frequency, gain dB, Q]. */
const EQ = {
  flat: [],
  voice: [
    ["peaking", 250, -3, 1],
    ["peaking", 3200, 3, 0.9],
    ["highshelf", 10000, 2, 0.7],
  ],
  bass: [["lowshelf", 110, 6, 0.7]],
  treble: [["highshelf", 6000, 5, 0.7]],
  warm: [
    ["lowshelf", 200, 3, 0.7],
    ["highshelf", 8000, -2.5, 0.7],
  ],
  deess: [["peaking", 6500, -4, 2]],
  phone: [
    ["highpass", 350, 0, 0.7],
    ["lowpass", 3400, 0, 0.7],
    ["peaking", 1500, 4, 1],
  ],
};

const db = (v) => `${v > 0 ? "+" : ""}${v.toFixed(0)} dB`;
const panel = createControls(
  document.getElementById("controls"),
  [
    {
      title: "Noise reduction",
      controls: [
        {
          id: "nr",
          type: "segmented",
          label: "Method",
          value: "rnnoise",
          options: [
            ["off", "Off"],
            ["rnnoise", "RNNoise (voice)"],
            ["gate", "Noise gate"],
          ],
        },
        {
          id: "nrMix",
          type: "range",
          label: "Strength",
          min: 0,
          max: 1,
          step: 0.05,
          value: 0.85,
          format: (v) => `${Math.round(v * 100)}%`,
          showIf: (st) => st.nr === "rnnoise",
          hint: "Mixes the denoised voice with the original. Lower it if speech sounds watery.",
        },
        {
          id: "gateDb",
          type: "range",
          label: "Gate threshold",
          min: -70,
          max: -20,
          step: 1,
          value: -45,
          format: (v) => `${v} dB`,
          showIf: (st) => st.nr === "gate" || st.gateToo,
          hint: "Audio quieter than this is turned down between phrases.",
        },
        {
          id: "gateDepth",
          type: "range",
          label: "Gate depth",
          min: 6,
          max: 60,
          step: 1,
          value: 24,
          format: (v) => `−${v} dB`,
          showIf: (st) => st.nr === "gate" || st.gateToo,
        },
        {
          id: "gateToo",
          type: "toggle",
          label: "Also gate the pauses",
          value: false,
          showIf: (st) => st.nr === "rnnoise",
        },
        {
          id: "hpf",
          type: "toggle",
          label: "Remove rumble (high-pass)",
          value: true,
        },
        {
          id: "hpfFreq",
          type: "range",
          label: "Cut below",
          min: 40,
          max: 200,
          step: 5,
          value: 80,
          unit: " Hz",
          showIf: (st) => st.hpf,
        },
      ],
    },
    {
      title: "Normalize loudness",
      controls: [
        {
          id: "target",
          type: "select",
          label: "Target",
          value: "podcast",
          options: [
            ["off", "Off"],
            ["podcast", "Podcast (−16 LUFS)"],
            ["youtube", "YouTube / streaming (−14 LUFS)"],
            ["voice", "Audiobook-ish (−19 LUFS)"],
            ["broadcast", "Broadcast (−23 LUFS)"],
            ["custom", "Custom"],
          ],
        },
        {
          id: "custom",
          type: "range",
          label: "Custom target",
          min: -30,
          max: -6,
          step: 0.5,
          value: -16,
          format: (v) => `${v} LUFS`,
          showIf: (st) => st.target === "custom",
        },
        {
          id: "ceiling",
          type: "range",
          label: "Peak limit",
          min: -6,
          max: 0,
          step: 0.1,
          value: -1,
          format: (v) => `${v.toFixed(1)} dBFS`,
          showIf: (st) => st.target !== "off",
          hint: "A limiter keeps peaks under this after the gain, so nothing clips.",
        },
      ],
    },
    {
      title: "Tone",
      controls: [
        {
          id: "comp",
          type: "segmented",
          label: "Compressor",
          value: "light",
          options: [
            ["off", "Off"],
            ["light", "Light"],
            ["medium", "Medium"],
            ["heavy", "Heavy"],
          ],
          hint: "Evens out loud and quiet words.",
        },
        {
          id: "eq",
          type: "select",
          label: "EQ",
          value: "voice",
          options: [
            ["flat", "Flat"],
            ["voice", "Voice clarity"],
            ["bass", "Bass boost"],
            ["treble", "Treble boost"],
            ["warm", "Warm"],
            ["deess", "Tame sibilance (S sounds)"],
            ["phone", "Telephone effect"],
          ],
        },
      ],
    },
  ],
  { onChange: () => schedule() },
);
const s = panel.state;

/* ---------- Waveforms + player ---------- */
const accent2 = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue("--text-faint")
    .trim();
let syncing = false;
const syncView = (other) => (v) => {
  if (syncing) return;
  syncing = true;
  other().setView(v.start, v.span, { silent: true });
  syncing = false;
};
const waveA = createWaveform(document.getElementById("wave-a"), {
  height: 110,
  color: accent2,
  label: "Original waveform",
  onSeek: (t) => player.seek(t),
  onSelect: (sel) => {
    waveB.selection = sel;
  },
  onView: syncView(() => waveB),
});
const waveB = createWaveform(document.getElementById("wave-b"), {
  height: 110,
  label: "Processed waveform",
  onSeek: (t) => player.seek(t),
  onSelect: (sel) => {
    waveA.selection = sel;
  },
  onView: syncView(() => waveA),
});
// The player loops waveA's selection; mirror selections made on B there too (onSelect above), and the playhead on B.
const player = createPlayer(document.getElementById("player"), {
  waveform: waveA,
  getBuffer: () => (ab === "a" || !processed ? source : processed),
  onTime: (t) => waveB.setTime(t, { follow: isPlaying }),
  onState: (p) => {
    isPlaying = p;
  },
});

const abBtns = [...document.querySelectorAll(".cu-ab button")];
function setAB(v) {
  ab = v;
  abBtns.forEach((b) =>
    b.setAttribute("aria-pressed", String(b.dataset.v === v)),
  );
  player.refresh();
}
abBtns.forEach((b) => b.addEventListener("click", () => setAB(b.dataset.v)));
document.addEventListener("keydown", (e) => {
  const el = e.target;
  if (
    e.ctrlKey ||
    e.metaKey ||
    e.altKey ||
    el.isContentEditable ||
    /^(TEXTAREA|SELECT)$/.test(el.tagName) ||
    (el.tagName === "INPUT" && el.type === "text")
  )
    return;
  if (e.key === "b" || e.key === "B") setAB(ab === "a" ? "b" : "a");
});

/* ---------- Processing ---------- */
const statusEl = document.getElementById("status");
const setStatus = (text, spin = false) =>
  statusEl.replaceChildren(
    ...(spin ? [h("span", { class: "spinner" })] : []),
    text || "",
  );

let timer = 0,
  run = 0,
  current = Promise.resolve(),
  waiting = false;
function schedule() {
  clearTimeout(timer);
  if (!source) return;
  setStatus("Processing…", true);
  waiting = true;
  timer = setTimeout(() => {
    waiting = false;
    current = processAll();
  }, 250);
}

async function ensureWet() {
  if (wet) return wet;
  const ctrl = new AbortController();
  const modal = progressModal(
    "Removing noise…",
    () => ctrl.abort(),
    `RNNoise is cleaning ${formatTime(source.duration)} of audio. The first run downloads a small engine (~120 KB).`,
  );
  try {
    wet = await rnnoise(source, { onProgress: modal.set, signal: ctrl.signal });
    return wet;
  } finally {
    modal.close();
  }
}

async function processAll() {
  const id = ++run;
  const stale = () => id !== run;
  try {
    let buf = source;
    // 1. Noise reduction (RNNoise mix and/or gate)
    const gate =
      s.nr === "gate" || (s.nr === "rnnoise" && s.gateToo)
        ? { thresholdDb: s.gateDb, depthDb: s.gateDepth }
        : null;
    let w = null;
    if (s.nr === "rnnoise") {
      try {
        w = await ensureWet();
      } catch (err) {
        if (err.name === "AbortError") {
          panel.set({ nr: "off" }, { silent: true });
          toast("Noise reduction cancelled; turned it off.");
        } else {
          toast(err.message, "error", 8000);
          panel.set({ nr: "off" }, { silent: true });
        }
        w = null;
      }
      if (stale()) return;
    }
    if (w || gate) buf = await gateMix(source, w, s.nrMix, gate);
    if (stale()) return;

    // 2. Filters and compressor (offline Web Audio)
    const eq = EQ[s.eq] || [];
    const comp = COMP[s.comp];
    if (s.hpf || eq.length || comp) {
      buf = await renderOffline(buf, (ctx, src) => {
        let node = src;
        const chain = (n) => {
          node.connect(n);
          node = n;
        };
        if (s.hpf)
          chain(
            new BiquadFilterNode(ctx, {
              type: "highpass",
              frequency: s.hpfFreq,
              Q: 0.707,
            }),
          );
        for (const [type, frequency, gain, Q] of eq)
          chain(new BiquadFilterNode(ctx, { type, frequency, gain, Q }));
        if (comp) {
          chain(
            new DynamicsCompressorNode(ctx, {
              threshold: comp.threshold,
              ratio: comp.ratio,
              attack: comp.attack,
              release: comp.release,
              knee: comp.knee,
            }),
          );
          chain(new GainNode(ctx, { gain: 10 ** (comp.makeup / 20) }));
        }
        return node;
      });
      if (stale()) return;
    }

    // 3. Loudness: gain to the target, then the limiter.
    const target = s.target === "custom" ? s.custom : TARGETS[s.target];
    appliedGain = 0;
    if (target != null) {
      const mid = measureLoudness(buf);
      appliedGain = isFinite(mid.lufs)
        ? Math.max(-30, Math.min(30, target - mid.lufs))
        : 0;
      // Reuse the intermediate buffer as the output when it's ours (saves one copy of the audio).
      buf = await normalizeLimit(buf, appliedGain, s.ceiling, {
        target: buf !== source && buf !== w ? buf : null,
      });
      if (stale()) return;
    }
    processed = buf === source ? source : buf;
    after = measureLoudness(processed);
    waveB.setBuffer(processed, { keepView: true });
    waveB.setView(waveA.view.start, waveA.view.span, { silent: true });
    waveB.selection = waveA.selection;
    player.refresh();
    renderStats();
    exportBar.refresh();
    setStatus(processed === source ? "Nothing to do: every stage is off." : "");
  } catch (err) {
    if (stale()) return;
    console.error(err);
    setStatus("");
    toast(err.message || "Processing failed.", "error", 8000);
  }
}

/* ---------- Stats ---------- */
const statsEl = document.getElementById("stats");
const fmtL = (v) => (isFinite(v) ? `${v.toFixed(1)} LUFS` : "silent");
const fmtP = (v) => (isFinite(v) ? `${v.toFixed(1)} dBFS` : "−∞");
function renderStats() {
  statsEl.hidden = !before;
  if (!before) return;
  const target = s.target === "custom" ? s.custom : TARGETS[s.target];
  const stat = (label, value, extra, cls = "") =>
    h(
      "div",
      { class: "audio-stat" },
      h("span", {}, label),
      h("strong", { class: cls }, value),
      extra ? h("em", {}, extra) : null,
    );
  statsEl.replaceChildren(
    stat("Loudness before", fmtL(before.lufs)),
    stat(
      "Peak before",
      fmtP(before.peakDb),
      "",
      before.peakDb > -0.1 ? "is-warn" : "",
    ),
    stat(
      "Loudness after",
      fmtL(after?.lufs),
      target != null && after && isFinite(after.lufs) ? `target ${target}` : "",
      "is-up",
    ),
    stat("Peak after", fmtP(after?.peakDb)),
    stat(
      "Gain applied",
      `${appliedGain >= 0 ? "+" : ""}${appliedGain.toFixed(1)} dB`,
    ),
  );
  document.getElementById("meta-a").textContent =
    `${fmtL(before.lufs)} · peak ${fmtP(before.peakDb)}`;
  document.getElementById("meta-b").textContent = after
    ? `${fmtL(after.lufs)} · peak ${fmtP(after.peakDb)}`
    : "";
}

/* ---------- Load ---------- */
const emptyEl = document.getElementById("empty");
const labels = ["label-a", "label-b"].map((id) => document.getElementById(id));
function showEmpty(empty) {
  emptyEl.hidden = !empty;
  labels.forEach((l) => {
    l.hidden = empty;
  });
  document.getElementById("wave-a").hidden = empty;
  document.getElementById("wave-b").hidden = empty;
}
showEmpty(true);

const drop = createAudioDrop(document.getElementById("upload"), {
  label: "Drop a recording",
  onFile: (f) => open(f),
  onClear: () => {
    run++;
    file = source = processed = wet = before = after = null;
    waveA.setBuffer(null);
    waveB.setBuffer(null);
    player.stop();
    statsEl.hidden = true;
    showEmpty(true);
    setStatus("");
    exportBar.refresh();
  },
});

async function open(f) {
  try {
    const { buffer } = await loadAudioWithProgress(f);
    run++;
    file = f;
    source = buffer;
    processed = null;
    wet = null;
    after = null;
    drop.setFile(
      f,
      `${formatTime(buffer.duration)} · ${buffer.numberOfChannels === 1 ? "mono" : `${buffer.numberOfChannels} ch`} · ${(buffer.sampleRate / 1000).toFixed(1)} kHz`,
    );
    showEmpty(false);
    waveA.setBuffer(buffer);
    waveB.setBuffer(null);
    before = measureLoudness(buffer);
    renderStats();
    player.seek(0);
    if (buffer.duration > 45 * 60)
      toast(
        "Long recording: processing keeps several copies in memory. If the tab struggles, split it with the Audio Trimmer first.",
        "warning",
        9000,
      );
    schedule();
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error(err);
    toast(err.message || "Couldn’t open that file.", "error", 8000);
  }
}

const panelEl = document.querySelector(".audio-panel");
panelEl.addEventListener("dragover", (e) => e.preventDefault());
panelEl.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f) open(f);
});

/* ---------- Export ---------- */
const exportBar = createAudioExport(document.getElementById("export"), {
  id: "cleanup",
  getBuffer: async () => {
    if (waiting) {
      clearTimeout(timer);
      waiting = false;
      current = processAll();
    }
    await current;
    return processed;
  },
  filename: () => `${(file?.name || "audio").replace(/\.[^.]+$/, "")}-clean`,
  enabled: () => !!source,
  info: () =>
    source
      ? {
          duration: source.duration,
          channels: source.numberOfChannels,
          sampleRate: source.sampleRate,
        }
      : null,
});

takeFile("cleanup").then((item) => {
  if (item) {
    toast(
      `Opened ${item.file.name} from ${item.meta?.from || "another tool"}.`,
    );
    open(item.file);
  }
});
