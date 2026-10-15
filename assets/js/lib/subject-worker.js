/*
 * Subject segmentation worker (transformers.js). Started by lib/subject.js; never import it directly.
 *
 * Messages in:  { type: 'load', id, kind: 'auto' | 'pick', repo, device, dtype }
 *               { type: 'auto', id, image: { data, width, height } }        RGBA pixels
 *               { type: 'embed', id, image: { data, width, height } }       SAM: encode once per photo
 *               { type: 'pick', id, groups: [{ points: [[x, y]…], labels: [1 | 0…] }] }   image px
 * Messages out: { type: 'progress', file, loaded, total }   while downloading
 *               { type: 'ready', id, device }
 *               { type: 'mask', id, data: Float32Array (0..1, 1 = keep), width, height, score? }   score: SAM's best IoU estimate (lowest over the groups)
 *               { type: 'embedded', id }
 *               { type: 'error', id, message }
 */
import { LIBS } from "./cdn.js";

let tf = null;
const models = { auto: null, pick: null }; // { key, model, processor }
let embedding = null; // { inputs, emb } for the current photo (SAM)
const groupCache = new Map(); // JSON(group) → { mask: Float32Array, score }, cleared on every new embedding

async function lib() {
  if (!tf) {
    tf = await import(LIBS.transformers.url);
    tf.env.allowLocalModels = false;
    tf.env.useBrowserCache = true;
  }
  return tf;
}

const post = (msg, transfer = []) => self.postMessage(msg, transfer);
const onProgress = (p) => {
  if (p.status === "progress" || p.status === "done")
    post({ type: "progress", file: p.file, loaded: p.loaded ?? p.total ?? 0, total: p.total ?? 0 });
};

async function load({ id, kind, repo, device, dtype }) {
  const key = `${repo}|${device}|${JSON.stringify(dtype)}`;
  if (models[kind]?.key === key) return post({ type: "ready", id, device });
  const { AutoModel, Sam2Model, AutoProcessor } = await lib();
  await models[kind]?.model.dispose?.();
  models[kind] = null;
  const Model = kind === "pick" ? Sam2Model : AutoModel;
  const model = await Model.from_pretrained(repo, { device, dtype, progress_callback: onProgress });
  const processor = await AutoProcessor.from_pretrained(repo);
  models[kind] = { key, model, processor };
  if (kind === "pick") { embedding = null; groupCache.clear(); }
  post({ type: "ready", id, device });
}

async function rawImage({ data, width, height }) {
  const { RawImage } = await lib();
  return new RawImage(new Uint8ClampedArray(data), width, height, 4).rgb();
}

const sigmoid = (v) => 1 / (1 + Math.exp(-v));

/** ISNet: the salient foreground (objects, people, products, logos) as a 0..1 mask at the model's size. */
async function auto({ id, image }) {
  const m = models.auto;
  if (!m) throw new Error("The object model is not loaded.");
  const img = await rawImage(image);
  const { pixel_values } = await m.processor(img);
  const session = m.model.sessions.model;
  const out = await m.model({ [session.inputNames[0]]: pixel_values });
  const t = out[session.outputNames[0]] ?? Object.values(out)[0];
  const [h, w] = t.dims.slice(-2);
  const src = t.data;
  const logits = src.some((v) => v < -1e-5 || v > 1 + 1e-5);
  const data = new Float32Array(w * h);
  for (let i = 0; i < data.length; i++) data[i] = logits ? sigmoid(src[i]) : src[i];
  post({ type: "mask", id, data, width: w, height: h }, [data.buffer]);
}

/** SAM 2.1: encode the photo once; every click only reruns the small prompt decoder. */
async function embed({ id, image }) {
  const m = models.pick;
  if (!m) throw new Error("The selection model is not loaded.");
  embedding = null;
  groupCache.clear();
  const inputs = await m.processor(await rawImage(image));
  const emb = await m.model.get_image_embeddings(inputs);
  embedding = { inputs, emb, width: image.width, height: image.height };
  post({ type: "embedded", id });
}

/** One mask per group of clicks (keep = 1, remove = 0), merged: a pixel stays if any group keeps it. */
async function pick({ id, groups }) {
  const m = models.pick;
  if (!m || !embedding) throw new Error("Select a photo first.");
  const { inputs, emb, width, height } = embedding;
  const ip = m.processor.image_processor;
  const union = new Float32Array(width * height);
  let score = 1;
  for (const g of groups) {
    if (!g.labels.includes(1)) continue; // only "remove" clicks: nothing to keep in this group
    const key = JSON.stringify(g);
    let hit = groupCache.get(key);
    if (!hit) {
      const input_points = ip.reshape_input_points([g.points], inputs.original_sizes, inputs.reshaped_input_sizes);
      const input_labels = ip.add_input_labels([g.labels], input_points);
      const out = await m.model({ ...emb, input_points, input_labels });
      const [masks] = await m.processor.post_process_masks(out.pred_masks, inputs.original_sizes, inputs.reshaped_input_sizes, { binarize: false });
      const iou = out.iou_scores.data;
      let best = 0;
      for (let i = 1; i < iou.length; i++) if (iou[i] > iou[best]) best = i;
      const n = width * height;
      const plane = masks.data.subarray(best * n, (best + 1) * n);
      const mask = new Float32Array(n);
      for (let i = 0; i < n; i++) mask[i] = sigmoid(plane[i]);
      hit = { mask, score: iou[best] };
      groupCache.set(key, hit);
    }
    score = Math.min(score, hit.score);
    const { mask } = hit;
    for (let i = 0; i < union.length; i++) if (mask[i] > union[i]) union[i] = mask[i];
  }
  post({ type: "mask", id, data: union, width, height, score }, [union.buffer]);
}

const handlers = { load, auto, embed, pick };
self.addEventListener("message", async ({ data: msg }) => {
  try {
    await handlers[msg.type](msg);
  } catch (err) {
    console.error(err);
    post({ type: "error", id: msg.id, message: err?.message || String(err) });
  }
});
