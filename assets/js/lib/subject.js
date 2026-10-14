/**
 * Any-subject segmentation for photos, in a module worker (transformers.js, WebGPU → WASM):
 *   'auto' = ISNet (DIS, AGPL-3.0 weights): the main subject(s) of a photo, whatever they are.
 *            Chosen over BiRefNet, which can't run on Macs: its WebGPU shaders need 11 storage buffers
 *            (Apple allows 10) and its fixed 1024² fp32 graph runs out of WASM memory.
 *   'pick' = SAM 2.1 tiny (Apache-2.0): click what to keep (and what to drop); several objects at once.
 *
 *   const plan = await subjectPlan('auto');               // { device, bytes, cached } — show the size first
 *   await loadSubjectModel('auto', { onDownload(loaded, total) {} });
 *   const raw = await segmentSubject(img);                // { data: Float32Array 0..1, width, height }
 *
 *   await loadSubjectModel('pick');  await embedPhoto(img); // once per photo (the slow part)
 *   const raw = await pickMask([[{ x, y, keep: true }, …], …]);   // x, y in 0..1; one array per object
 *
 * Results have the shape of vision.js segment results, so they feed lib/still-mask.js directly.
 * Weights come from huggingface.co and stay in the browser's cache ('transformers-cache').
 */
import { gpuSupport } from "./whisper.js";

const MAX_SIDE = 1024; // both models work at 1024 px; larger photos are downscaled before sending

const HF = "https://huggingface.co";
export const SUBJECT_MODELS = {
  auto: {
    repo: "onnx-community/ISNet-ONNX",
    // file stem → MB per dtype
    files: { model: { fp16: 88.1, fp32: 176.1, q8: 44.3 } },
  },
  pick: {
    repo: "onnx-community/sam2.1-hiera-tiny-ONNX",
    files: {
      vision_encoder: { fp16: 67.3, fp32: 134.5, q8: 53 },
      prompt_encoder_mask_decoder: { fp16: 10.7, fp32: 21.2, q8: 9 },
    },
    external: true, // weights live in a separate .onnx_data file
  },
};
const SUFFIX = { fp32: "", fp16: "_fp16", q8: "_quantized" };

async function dtypeFor(kind, device) {
  const { f16 } = await gpuSupport();
  const d = device === "webgpu" ? (f16 ? "fp16" : "fp32") : "q8";
  const stems = Object.keys(SUBJECT_MODELS[kind].files);
  return stems.length === 1 ? d : Object.fromEntries(stems.map((k) => [k, d]));
}
const dtypeOf = (dtype, stem) => (typeof dtype === "string" ? dtype : dtype[stem]);

async function isCached(kind, dtype) {
  try {
    if (!("caches" in window)) return false;
    const cache = await caches.open("transformers-cache");
    const m = SUBJECT_MODELS[kind];
    const urls = Object.keys(m.files).map((stem) => `${HF}/${m.repo}/resolve/main/onnx/${stem}${SUFFIX[dtypeOf(dtype, stem)]}.onnx${m.external ? "_data" : ""}`);
    return (await Promise.all(urls.map((u) => cache.match(u)))).every(Boolean);
  } catch {
    return false;
  }
}

const bestDevice = async () => ((await gpuSupport()).webgpu ? "webgpu" : "wasm");

/** What loading `kind` would cost here: { device, bytes, cached }. */
export async function subjectPlan(kind, device) {
  device ||= await bestDevice();
  const dtype = await dtypeFor(kind, device);
  const bytes = Object.entries(SUBJECT_MODELS[kind].files).reduce((sum, [stem, mb]) => sum + mb[dtypeOf(dtype, stem)] * 1e6, 0);
  return { device, dtype, bytes, cached: await isCached(kind, dtype) };
}

/* ---------- Worker plumbing ---------- */
let worker = null;
const loaded = { auto: "", pick: "" };
let seq = 0;

function getWorker() {
  if (!worker) {
    worker = new Worker(new URL("./subject-worker.js", import.meta.url), { type: "module" });
    loaded.auto = loaded.pick = "";
  }
  return worker;
}

/** Send one message and wait for its reply (`accept` picks it); every message passes through `onMsg`. */
function request(msg, accept, onMsg, transfer = []) {
  const w = getWorker();
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const off = () => { w.removeEventListener("message", on); w.removeEventListener("error", onErr); };
    const on = ({ data }) => {
      onMsg?.(data);
      if (data.id !== id) return;
      off();
      if (data.type === "error") reject(new Error(data.message));
      else if (accept(data)) resolve(data);
    };
    const onErr = (e) => { off(); reject(new Error(e.message || "The segmentation worker crashed.")); };
    w.addEventListener("message", on);
    w.addEventListener("error", onErr);
    w.postMessage({ ...msg, id }, transfer);
  });
}

let loading = { auto: null, pick: null };
/** Load (or reuse) a model. WebGPU first, WASM if that fails. Resolves the device used. */
export function loadSubjectModel(kind, { onDownload } = {}) {
  loading[kind] ||= (async () => {
    const tryLoad = async (device) => {
      const plan = await subjectPlan(kind, device);
      const key = `${device}|${JSON.stringify(plan.dtype)}`;
      if (loaded[kind] === key) return device;
      const files = new Map();
      const report = (d) => {
        if (d.type !== "progress" || !d.total) return;
        files.set(d.file, [d.loaded, d.total]);
        let l = 0, t = 0;
        for (const [a, b] of files.values()) { l += a; t += b; }
        onDownload?.(l, Math.max(t, plan.bytes));
      };
      await request({ type: "load", kind, repo: SUBJECT_MODELS[kind].repo, device, dtype: plan.dtype }, (d) => d.type === "ready", report);
      loaded[kind] = key;
      return device;
    };
    const first = await bestDevice();
    try {
      return await tryLoad(first);
    } catch (err) {
      if (first !== "webgpu") throw err;
      console.warn(`WebGPU ${kind} model failed, falling back to WASM`, err);
      return tryLoad("wasm");
    }
  })().finally(() => { loading[kind] = null; });
  return loading[kind];
}

/** RGBA pixels of an image/video/canvas, long side ≤ 1024 px. */
function pixels(source) {
  const sw = source.naturalWidth || source.videoWidth || source.width;
  const sh = source.naturalHeight || source.videoHeight || source.height;
  const k = Math.min(1, MAX_SIDE / Math.max(sw, sh));
  const width = Math.max(1, Math.round(sw * k)), height = Math.max(1, Math.round(sh * k));
  const c = document.createElement("canvas");
  c.width = width; c.height = height;
  const x = c.getContext("2d", { willReadFrequently: true });
  x.drawImage(source, 0, 0, width, height);
  const { data } = x.getImageData(0, 0, width, height);
  return { data: data.buffer, width, height };
}

const asMask = ({ data, width, height }) => ({ data, width, height });

/** The main subject(s) of a photo (ISNet). Load the model first. */
export async function segmentSubject(source) {
  const image = pixels(source);
  return asMask(await request({ type: "auto", image }, (d) => d.type === "mask", null, [image.data]));
}

let photoSize = null;
/** Encode a photo for click selection (SAM). Load the model first. */
export async function embedPhoto(source) {
  const image = pixels(source);
  photoSize = { width: image.width, height: image.height };
  await request({ type: "embed", image }, (d) => d.type === "embedded", null, [image.data]);
}

/**
 * Mask for the clicked objects: `groups` is one array of clicks per object, each click
 * { x, y (0..1 of the photo), keep: boolean }. Groups without a "keep" click are ignored.
 * Returns null when nothing is kept.
 */
export async function pickMask(groups) {
  if (!photoSize) throw new Error("Embed a photo first.");
  const { width, height } = photoSize;
  const msg = groups
    .filter((g) => g.some((p) => p.keep))
    .map((g) => ({ points: g.map((p) => [p.x * width, p.y * height]), labels: g.map((p) => (p.keep ? 1 : 0)) }));
  if (!msg.length) return null;
  return asMask(await request({ type: "pick", groups: msg }, (d) => d.type === "mask"));
}
