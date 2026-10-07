/**
 * MediaPipe Image Segmenter, loaded from CDN on first use.
 * Produces a per-frame "person" confidence mask (Float32Array, 0..1).
 */
const VERSION = '1.1.0';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODEL_BASE = 'https://storage.googleapis.com/mediapipe-models/image_segmenter';

export const MODELS = {
  general: { label: 'Fast (square)', url: `${MODEL_BASE}/selfie_segmenter/float16/latest/selfie_segmenter.tflite`, multiclass: false },
  landscape: { label: 'Fast (landscape)', url: `${MODEL_BASE}/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`, multiclass: false },
  quality: { label: 'High quality (16 MB)', url: `${MODEL_BASE}/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`, multiclass: true },
};

let visionPromise;
const segmenters = new Map(); // model key → Promise<ImageSegmenter>
let lastTs = 0;

async function vision() {
  visionPromise ||= (async () => {
    const mp = await import(/* webpackIgnore: true */ BUNDLE);
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM);
    return { mp, fileset };
  })();
  return visionPromise;
}

/** Load (once) and return a segmenter for the given model key. */
export function loadSegmenter(key = 'general') {
  if (!segmenters.has(key)) {
    const p = (async () => {
      const { mp, fileset } = await vision();
      const opts = (delegate) => ({
        baseOptions: { modelAssetPath: MODELS[key].url, delegate },
        runningMode: 'VIDEO',
        outputConfidenceMasks: true,
        outputCategoryMask: false,
      });
      try {
        return await mp.ImageSegmenter.createFromOptions(fileset, opts('GPU'));
      } catch (err) {
        console.warn('GPU delegate failed, falling back to CPU', err);
        return mp.ImageSegmenter.createFromOptions(fileset, opts('CPU'));
      }
    })();
    p.catch(() => segmenters.delete(key)); // allow retry after a failure
    segmenters.set(key, p);
  }
  return segmenters.get(key);
}

/**
 * Segment one frame. Returns { data: Float32Array, width, height } where data is
 * the person probability (for multiclass models: 1 − background).
 */
export function segmentFrame(segmenter, source, key) {
  // VIDEO mode needs strictly increasing timestamps, even when the user seeks backwards.
  const ts = Math.max(performance.now(), lastTs + 1);
  lastTs = ts;
  let out = null;
  segmenter.segmentForVideo(source, ts, (result) => {
    const masks = result.confidenceMasks;
    if (!masks?.length) return;
    const m = masks[0];
    const data = m.getAsFloat32Array().slice(); // copy: the mask is only valid inside this callback
    if (MODELS[key].multiclass) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
    out = { data, width: m.width, height: m.height };
  });
  return out;
}

/**
 * Guess whether a mask marks the person (true) or the background (false):
 * the person is usually nearer the centre than the frame edges.
 */
export function looksLikePerson({ data, width, height }) {
  let edge = 0, edgeN = 0, centre = 0, centreN = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = data[y * width + x];
      const nx = x / width, ny = y / height;
      if (nx < 0.06 || nx > 0.94 || ny < 0.06) { edge += v; edgeN++; }
      else if (nx > 0.35 && nx < 0.65 && ny > 0.3) { centre += v; centreN++; }
    }
  }
  return centre / centreN >= edge / edgeN;
}
