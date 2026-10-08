/*
 * Audio export for the Audio tools: offline rendering, buffer helpers, WAV / MP3 / OGG / WebM encoding and the export bar.

 *
 *   const out = await renderOffline(buffer, (ctx, src) => src.connect(ctx.createGain()), { start, end });
 *   const { blob, ext } = await encodeAudio(buffer, { format: 'mp3', kbps: 192, onProgress, signal });
 *   createAudioExport(root, { id: 'trimmer', getBuffer: async () => rendered, filename: () => 'clip', extra, actions, hint });
 *
 * Formats:
 *   wav   PCM written directly (16-bit, 24-bit or 32-bit float).
 *   mp3   lamejs in a worker (32/44.1/48 kHz; other rates are resampled to 44.1 kHz), CBR 96–320 kbps.
 *   ogg / webm   Opus. mediabunny + WebCodecs when the browser can encode Opus (fast, any length);
 *         otherwise MediaRecorder records the buffer in real time (slower; WebM in Chromium, OGG in Firefox).
 * Everything the user hears in a tool should come from the same buffer that is encoded, so exports match the preview.
 */
import {
  h,
  icon,
  toast,
  downloadBlob,
  formatBytes,
  formatTime,
  store,
} from "./dom.js";
import { createControls } from "./controls.js";
import { loadLib, LIBS } from "./cdn.js";
import { progressModal } from "./exporter.js";
import { audioContext, resample } from "./audio-io.js";

/* ---------- Buffers ---------- */

export function makeBuffer(channels, length, sampleRate) {
  return new AudioBuffer({
    numberOfChannels: channels,
    length: Math.max(1, Math.round(length)),
    sampleRate,
  });
}

/** Copy of [start, end) seconds. */
export function sliceBuffer(buffer, start = 0, end = buffer.duration) {
  const sr = buffer.sampleRate;
  const a = Math.max(0, Math.min(buffer.length, Math.round(start * sr)));
  const b = Math.max(a + 1, Math.min(buffer.length, Math.round(end * sr)));
  const out = makeBuffer(buffer.numberOfChannels, b - a, sr);
  for (let c = 0; c < buffer.numberOfChannels; c++)
    out.copyToChannel(buffer.getChannelData(c).subarray(a, b), c);
  return out;
}

/**
 * Join buffers (same rate/channels) end to end. `xfade` seconds of equal-power crossfade at each join
 * (shortens the total by that much per join) so cuts don't click.
 */
export function concatBuffers(list, { xfade = 0.01 } = {}) {
  list = list.filter((b) => b && b.length);
  if (!list.length) return null;
  if (list.length === 1) return list[0];
  const { sampleRate: sr, numberOfChannels: chs } = list[0];
  const x = Math.max(0, Math.round(xfade * sr));
  const total = list.reduce((n, b) => n + b.length, 0) - x * (list.length - 1);
  const out = makeBuffer(chs, total, sr);
  for (let c = 0; c < chs; c++) {
    const o = out.getChannelData(c);
    let at = 0;
    list.forEach((b, k) => {
      const d = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
      const fade = k > 0 ? Math.min(x, d.length, at) : 0;
      for (let i = 0; i < fade; i++) {
        const p = (i + 0.5) / fade;
        o[at - fade + i] =
          o[at - fade + i] * Math.cos((p * Math.PI) / 2) +
          d[i] * Math.sin((p * Math.PI) / 2);
      }
      o.set(d.subarray(fade, Math.min(d.length, o.length - at + fade)), at);
      at += d.length - fade;
    });
  }
  return out;
}

/**
 * Render through a Web Audio graph in an OfflineAudioContext (faster than real time, identical every run).
 * `build(ctx, source, { start, end, duration })` connects `source` onward and returns the last node (or nothing).
 */
export async function renderOffline(
  buffer,
  build,
  {
    start = 0,
    end = buffer.duration,
    sampleRate = buffer.sampleRate,
    channels = buffer.numberOfChannels,
  } = {},
) {
  const duration = Math.max(1 / sampleRate, end - start);
  const ctx = new OfflineAudioContext(
    channels,
    Math.max(1, Math.round(duration * sampleRate)),
    sampleRate,
  );
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const out = (await build?.(ctx, src, { start, end, duration })) || src;
  out.connect(ctx.destination);
  src.start(0, start, duration);
  return ctx.startRendering();
}

/* ---------- WAV ---------- */

/** RIFF/WAVE file: 16- or 24-bit PCM, or 32-bit float. */
export function encodeWav(buffer, bits = 16) {
  const chs = buffer.numberOfChannels,
    n = buffer.length,
    sr = buffer.sampleRate;
  const float = bits === 32;
  const bps = bits / 8;
  const dataBytes = n * chs * bps;
  const out = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(out);
  const str = (o, s) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  str(8, "WAVE");
  str(12, "fmt ");
  v.setUint32(16, 16, true);
  v.setUint16(20, float ? 3 : 1, true);
  v.setUint16(22, chs, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * chs * bps, true);
  v.setUint16(32, chs * bps, true);
  v.setUint16(34, bits, true);
  str(36, "data");
  v.setUint32(40, dataBytes, true);
  const data = Array.from({ length: chs }, (_, c) => buffer.getChannelData(c));
  if (bits === 16) {
    const pcm = new Int16Array(out, 44, n * chs);
    for (let i = 0, k = 0; i < n; i++)
      for (let c = 0; c < chs; c++, k++) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        pcm[k] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }
  } else if (float) {
    const pcm = new Float32Array(out, 44, n * chs);
    for (let i = 0, k = 0; i < n; i++)
      for (let c = 0; c < chs; c++, k++) pcm[k] = data[c][i];
  } else {
    const bytes = new Uint8Array(out, 44);
    for (let i = 0, k = 0; i < n; i++)
      for (let c = 0; c < chs; c++, k += 3) {
        const s = Math.max(-1, Math.min(1, data[c][i]));
        const x = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        bytes[k] = x & 0xff;
        bytes[k + 1] = (x >> 8) & 0xff;
        bytes[k + 2] = (x >> 16) & 0xff;
      }
  }
  return new Blob([out], { type: "audio/wav" });
}

/* ---------- MP3 (lamejs in a worker) ---------- */

const MP3_RATES = [
  8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000,
];
export const MP3_BITRATES = [96, 128, 160, 192, 256, 320];

const mp3WorkerSource = (url) => `importScripts(${JSON.stringify(url)});
onmessage = (e) => {
  try {
    const { channels, sampleRate, kbps } = e.data;
    const enc = new lamejs.Mp3Encoder(channels.length, sampleRate, kbps);
    const n = channels[0].length, block = 1152 * 32, out = [];
    const toInt = (f, a, b) => { const r = new Int16Array(b - a); for (let i = 0; i < r.length; i++) { let s = f[a + i]; s = s < -1 ? -1 : s > 1 ? 1 : s; r[i] = s < 0 ? s * 32768 : s * 32767; } return r; };
    let k = 0;
    for (let i = 0; i < n; i += block) {
      const j = Math.min(n, i + block);
      const l = toInt(channels[0], i, j);
      const buf = channels.length > 1 ? enc.encodeBuffer(l, toInt(channels[1], i, j)) : enc.encodeBuffer(l);
      if (buf.length) out.push(new Uint8Array(buf));
      if (++k % 8 === 0) postMessage({ type: 'progress', p: j / n });
    }
    const tail = enc.flush();
    if (tail.length) out.push(new Uint8Array(tail));
    postMessage({ type: 'done', chunks: out });
  } catch (err) { postMessage({ type: 'error', message: String(err && err.message || err) }); }
};`;

export async function encodeMp3(
  buffer,
  { kbps = 192, onProgress, signal } = {},
) {
  const url = await loadLib("lamejs");
  let buf = buffer;
  const chs = Math.min(2, buf.numberOfChannels);
  if (!MP3_RATES.includes(buf.sampleRate) || buf.numberOfChannels > 2)
    buf = await resample(
      buf,
      MP3_RATES.includes(buf.sampleRate) ? buf.sampleRate : 44100,
      chs,
    );
  const channels = Array.from({ length: chs }, (_, c) =>
    buf.getChannelData(c).slice(),
  );
  const worker = new Worker(
    URL.createObjectURL(
      new Blob([mp3WorkerSource(url)], { type: "text/javascript" }),
    ),
  );
  try {
    return await new Promise((resolve, reject) => {
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      );
      worker.onerror = (e) =>
        reject(
          new Error(
            e.message ||
              "Couldn’t load the MP3 encoder. Check your connection or content blocker.",
          ),
        );
      worker.onmessage = ({ data }) => {
        if (data.type === "progress") onProgress?.(data.p);
        else if (data.type === "done")
          resolve(new Blob(data.chunks, { type: "audio/mpeg" }));
        else if (data.type === "error")
          reject(new Error(`MP3 encoding failed: ${data.message}`));
      };
      worker.postMessage(
        { channels, sampleRate: buf.sampleRate, kbps },
        channels.map((d) => d.buffer),
      );
    });
  } finally {
    worker.terminate();
  }
}

/* ---------- Opus (OGG / WebM) ---------- */

export const OPUS_BITRATES = [64, 96, 128, 160, 192, 256];

/** Can this browser encode Opus with WebCodecs (fast path)? */
export async function canEncodeOpus(channels = 2) {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const mb = await loadLib("mediabunny");
    return await mb.canEncodeAudio("opus", {
      numberOfChannels: Math.min(2, channels),
      sampleRate: 48000,
      bitrate: 128e3,
    });
  } catch {
    return false;
  }
}

async function encodeOpusWebCodecs(
  buffer,
  { container, kbps, onProgress, signal },
) {
  const mb = await loadLib("mediabunny");
  const chs = Math.min(2, buffer.numberOfChannels);
  const buf = await resample(buffer, 48000, chs);
  const output = new mb.Output({
    format:
      container === "ogg"
        ? new mb.OggOutputFormat()
        : new mb.WebMOutputFormat(),
    target: new mb.BufferTarget(),
  });
  const source = new mb.AudioBufferSource({
    codec: "opus",
    bitrate: kbps * 1000,
  });
  output.addAudioTrack(source);
  await output.start();
  const step = 48000 * 5;
  for (let i = 0; i < buf.length; i += step) {
    if (signal?.aborted) {
      await output.cancel?.();
      throw new DOMException("Cancelled", "AbortError");
    }
    const n = Math.min(step, buf.length - i);
    const part = makeBuffer(chs, n, 48000);
    for (let c = 0; c < chs; c++)
      part.copyToChannel(buf.getChannelData(c).subarray(i, i + n), c);
    await source.add(part);
    onProgress?.((i + n) / buf.length);
  }
  await output.finalize();
  return new Blob([output.target.buffer], {
    type: container === "ogg" ? "audio/ogg" : "audio/webm",
  });
}

const REC_TYPES = {
  ogg: ["audio/ogg;codecs=opus", "audio/ogg"],
  webm: ["audio/webm;codecs=opus", "audio/webm"],
};

/** Real-time fallback: play the buffer into a MediaRecorder. Resolves { blob, container }. */
async function recordBuffer(buffer, { container, kbps, onProgress, signal }) {
  if (typeof MediaRecorder === "undefined")
    throw new Error(
      "This browser can’t encode OGG/WebM audio. Export WAV or MP3 instead.",
    );
  const order =
    container === "ogg"
      ? [...REC_TYPES.ogg, ...REC_TYPES.webm]
      : [...REC_TYPES.webm, ...REC_TYPES.ogg];
  const mimeType = order.find((t) => MediaRecorder.isTypeSupported(t));
  if (!mimeType)
    throw new Error(
      "This browser can’t record OGG or WebM audio. Export WAV or MP3 instead.",
    );
  const ctx = audioContext();
  await ctx.resume();
  const dest = ctx.createMediaStreamDestination();
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(dest);
  const rec = new MediaRecorder(dest.stream, {
    mimeType,
    audioBitsPerSecond: kbps * 1000,
  });
  const chunks = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const stopped = new Promise((r) => {
    rec.onstop = r;
  });
  let t0 = ctx.currentTime;
  const timer = setInterval(
    () => onProgress?.(Math.min(1, (ctx.currentTime - t0) / buffer.duration)),
    250,
  );
  try {
    await new Promise((resolve, reject) => {
      src.onended = resolve;
      signal?.addEventListener(
        "abort",
        () => reject(new DOMException("Cancelled", "AbortError")),
        { once: true },
      );
      rec.start(500);
      t0 = ctx.currentTime;
      src.start();
    });
    await new Promise((r) => setTimeout(r, 150));
  } finally {
    clearInterval(timer);
    try {
      src.stop();
    } catch {
      /* ended */
    }
    src.disconnect();
    if (rec.state !== "inactive") rec.stop();
  }
  await stopped;
  const type = rec.mimeType || mimeType;
  return {
    blob: new Blob(chunks, { type }),
    container: type.includes("ogg") ? "ogg" : "webm",
  };
}

/* ---------- Any format ---------- */

export const AUDIO_FORMATS = [
  ["wav", "WAV"],
  ["mp3", "MP3"],
  ["ogg", "OGG"],
  ["webm", "WebM"],
];

/**
 * Encode an AudioBuffer. Resolves { blob, ext, note? }.
 * opts: { format: 'wav'|'mp3'|'ogg'|'webm', kbps, bits (WAV: 16|24|32), onProgress, onStatus, signal }
 */
export async function encodeAudio(
  buffer,
  { format = "wav", kbps = 192, bits = 16, onProgress, onStatus, signal } = {},
) {
  if (format === "wav") {
    onProgress?.(1);
    return { blob: encodeWav(buffer, +bits), ext: "wav" };
  }
  if (format === "mp3")
    return {
      blob: await encodeMp3(buffer, { kbps: +kbps, onProgress, signal }),
      ext: "mp3",
    };
  if (format === "ogg" || format === "webm") {
    if (await canEncodeOpus(buffer.numberOfChannels)) {
      return {
        blob: await encodeOpusWebCodecs(buffer, {
          container: format,
          kbps: +kbps,
          onProgress,
          signal,
        }),
        ext: format,
      };
    }
    onStatus?.(
      `Recording in real time (${formatTime(buffer.duration)}): this browser has no fast Opus encoder. Keep this tab open.`,
    );
    const { blob, container } = await recordBuffer(buffer, {
      container: format,
      kbps: +kbps,
      onProgress,
      signal,
    });
    return {
      blob,
      ext: container,
      note:
        container !== format
          ? `This browser records ${container.toUpperCase()} only, so the file is .${container}.`
          : "",
    };
  }
  throw new Error(`Unknown audio format “${format}”.`);
}

/** Rough output size in bytes. */
export function estimateBytes(
  duration,
  { format, kbps = 192, bits = 16, channels = 2, sampleRate = 48000 },
) {
  if (format === "wav")
    return 44 + duration * sampleRate * channels * (bits / 8);
  return (duration * kbps * 1000) / 8;
}

/* ---------- Export bar ---------- */

/**
 * The standard export panel: Format (WAV / MP3 / OGG / WebM, plus `extra` formats), bitrate or bit depth, a size
 * estimate and an Export button. Choices persist per `id`.
 *
 *   createAudioExport(root, {
 *     id: 'trimmer',
 *     getBuffer: async () => audioBuffer,   // the final audio (render it here); null disables the export
 *     filename: () => 'my-clip',            // without extension
 *     info: () => ({ duration, channels, sampleRate }),   // for the size estimate (default: read from getBuffer's last result)
 *     extra: [{ value: 'original', label: 'Original', available: () => bool, hint: 'text', run: async ({ signal, onProgress, onStatus, state }) => ({ blob, name }) }],
 *     actions: [{ label, icon, onClick: (state) => {}, show? }],
 *     enabled: () => bool,
 *     hint: () => 'text',
 *   })
 *   → { refresh(), state, encode(buffer, overrides?) }
 */
export function createAudioExport(root, opts) {
  const {
    id,
    getBuffer,
    filename = () => "audio",
    extra = [],
    actions = [],
    enabled = () => true,
    info,
  } = opts;
  const saved = store.get(`audio-export:${id}`, {});
  const formatOptions = [
    ...AUDIO_FORMATS,
    ...extra.map((x) => [x.value, x.label]),
  ];
  const ctrlRoot = h("div", { class: "audio-export-controls" });
  const estimate = h("span", { class: "audio-export-estimate" });
  const note = h("p", { class: "ctrl-hint audio-export-note" });
  const go = h("button", {
    type: "button",
    class: "btn btn-primary",
    html: `${icon("download")} Export audio`,
  });
  const extraBtns = actions.map((a) => {
    const b = h("button", {
      type: "button",
      class: "btn",
      html: `${icon(a.icon || "download")} ${a.label}`,
    });
    b.addEventListener("click", () => a.onClick(panel.state, b));
    return b;
  });
  root.classList.add("audio-export");
  root.replaceChildren(
    ctrlRoot,
    h(
      "div",
      { class: "audio-export-row" },
      go,
      ...extraBtns,
      h("span", { class: "spacer" }),
      estimate,
    ),
    note,
  );

  const isExtra = (s) => extra.find((x) => x.value === s.format);
  const panel = createControls(
    ctrlRoot,
    [
      {
        controls: [
          {
            id: "format",
            type: "segmented",
            label: "Format",
            value: formatOptions.some(([v]) => v === saved.format)
              ? saved.format
              : "mp3",
            options: formatOptions,
          },
          {
            id: "kbps",
            type: "select",
            label: "Bitrate",
            value: String(saved.kbps || 192),
            options: MP3_BITRATES.map((k) => [
              String(k),
              `${k} kbps${k === 192 ? " (good)" : k === 320 ? " (best)" : k === 128 ? " (small)" : ""}`,
            ]),
            showIf: (s) => s.format === "mp3",
          },
          {
            id: "okbps",
            type: "select",
            label: "Bitrate",
            value: String(saved.okbps || 128),
            options: OPUS_BITRATES.map((k) => [
              String(k),
              `${k} kbps${k === 64 ? " (voice)" : k === 128 ? " (music)" : ""}`,
            ]),
            showIf: (s) => s.format === "ogg" || s.format === "webm",
          },
          {
            id: "bits",
            type: "segmented",
            label: "Bit depth",
            value: String(saved.bits || 16),
            options: [
              ["16", "16-bit"],
              ["24", "24-bit"],
              ["32", "32-bit float"],
            ],
            showIf: (s) => s.format === "wav",
          },
        ],
      },
    ],
    {
      onChange: (s) => {
        store.set(`audio-export:${id}`, {
          format: s.format,
          kbps: s.kbps,
          okbps: s.okbps,
          bits: s.bits,
        });
        refresh();
      },
    },
  );
  const s = panel.state;

  const settings = (o = {}) => {
    const st = { ...s, ...o };
    return {
      format: st.format,
      kbps: st.format === "mp3" ? +st.kbps : +st.okbps,
      bits: +st.bits,
    };
  };

  async function encode(buffer, overrides = {}, hooks = {}) {
    return encodeAudio(buffer, { ...settings(overrides), ...hooks });
  }

  let busy = false;
  go.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    refresh();
    const ctrl = new AbortController();
    const modal = progressModal(
      "Preparing audio…",
      () => ctrl.abort(),
      "Rendering the final audio.",
    );
    const hooks = {
      signal: ctrl.signal,
      onProgress: modal.set,
      onStatus: (m) => modal.message(m),
    };
    try {
      const x = isExtra(s);
      let blob,
        name,
        extraNote = "";
      if (x) {
        modal.phase(`Exporting ${x.label.toLowerCase()}…`, x.hint || "");
        ({ blob, name } = await x.run({ ...hooks, state: { ...s } }));
      } else {
        const buffer = await getBuffer();
        if (!buffer) throw new Error("Nothing to export yet.");
        modal.phase(
          `Encoding ${s.format.toUpperCase()}…`,
          `${formatTime(buffer.duration)} of audio.`,
        );
        const res = await encode(buffer, {}, hooks);
        blob = res.blob;
        name = `${filename()}.${res.ext}`;
        extraNote = res.note || "";
      }
      if (ctrl.signal.aborted) {
        toast("Export cancelled.");
        return;
      }
      downloadBlob(blob, name);
      toast(
        `Saved ${name} (${formatBytes(blob.size)})${extraNote ? `. ${extraNote}` : ""}`,
        "success",
        6000,
      );
    } catch (err) {
      if (err.name === "AbortError") toast("Export cancelled.");
      else {
        console.error(err);
        toast(err.message || "Export failed.", "error", 8000);
      }
    } finally {
      modal.close();
      busy = false;
      refresh();
    }
  });

  function refresh() {
    const on = enabled();
    const x = isExtra(s);
    go.disabled = busy || !on || (x && !x.available());
    extraBtns.forEach((b, i) => {
      b.disabled = busy || !on;
      b.hidden = !(
        (typeof actions[i].show === "function"
          ? actions[i].show()
          : actions[i].show) ?? true
      );
    });
    const i = on ? info?.() : null;
    estimate.textContent =
      i && !x
        ? `≈ ${formatBytes(estimateBytes(i.duration, { ...settings(), channels: s.format === "wav" ? i.channels : Math.min(2, i.channels), sampleRate: i.sampleRate }))} · ${formatTime(i.duration)}`
        : "";
    const hint = x
      ? x.available()
        ? x.hint || ""
        : x.unavailable || ""
      : (typeof opts.hint === "function" ? opts.hint() : opts.hint) || "";
    note.textContent = hint;
    note.hidden = !hint;
  }
  refresh();
  return { refresh, state: s, settings, encode };
}
