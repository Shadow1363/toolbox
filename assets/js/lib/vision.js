/**
 * MediaPipe Tasks Vision, loaded from jsDelivr on first use. One WASM fileset is shared
 * by every task; each model loads once and is cached. GPU delegate first, CPU fallback.
 *
 *   const seg = await loadSegmenter('general');   const m = segmentFrame(seg, video, 'general');
 *   const face = await loadFaceLandmarker();      const lm = detectFace(face, video);   // 478 points or null
 *   const pose = await loadPoseLandmarker();      const lm = detectPose(pose, video);   // 33 points or null
 *   const faces = await loadFaceLandmarker({ numFaces: 5 });  detectFaces(faces, video);  // array, one per face
 *   const still = await loadSegmenter('quality', { mode: 'IMAGE' });  segmentImage(still, img, 'quality');
 *
 * Landmarks are normalized (x, y in 0..1 of the source frame). Tasks run in VIDEO mode unless
 * created with { mode: 'IMAGE' } (one-off stills: no timestamps, no frame-to-frame tracking).
 * VIDEO mode needs strictly increasing timestamps; `nextTimestamp()` guarantees that even when
 * the caller seeks backwards.
 */
const VERSION = '1.1.0';
const BUNDLE = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/vision_bundle.mjs`;
const WASM = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}/wasm`;
const MODELS = 'https://storage.googleapis.com/mediapipe-models';

export const SEGMENT_MODELS = {
  general: { label: 'Fast (square)', url: `${MODELS}/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite`, multiclass: false },
  landscape: { label: 'Fast (landscape)', url: `${MODELS}/image_segmenter/selfie_segmenter_landscape/float16/latest/selfie_segmenter_landscape.tflite`, multiclass: false },
  quality: { label: 'High quality (16 MB)', url: `${MODELS}/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite`, multiclass: true },
};
const FACE_MODEL = `${MODELS}/face_landmarker/face_landmarker/float16/1/face_landmarker.task`;
const POSE_MODEL = `${MODELS}/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task`;

let visionPromise;
const tasks = new Map(); // cache key → Promise<task>
let lastTs = 0;

function vision() {
  visionPromise ||= (async () => {
    const mp = await import(/* webpackIgnore: true */ BUNDLE);
    const fileset = await mp.FilesetResolver.forVisionTasks(WASM);
    return { mp, fileset };
  })().catch((err) => { visionPromise = null; throw err; });
  return visionPromise;
}

/** Create a task once per key, trying the GPU delegate first. mode: 'VIDEO' | 'IMAGE'. */
function loadTask(key, className, options, mode = 'VIDEO') {
  if (!tasks.has(key)) {
    const p = (async () => {
      const { mp, fileset } = await vision();
      const opts = (delegate) => ({ ...options, baseOptions: { ...options.baseOptions, delegate }, runningMode: mode });
      try {
        return await mp[className].createFromOptions(fileset, opts('GPU'));
      } catch (err) {
        console.warn(`${className}: GPU delegate failed, falling back to CPU`, err);
        return mp[className].createFromOptions(fileset, opts('CPU'));
      }
    })();
    p.catch(() => tasks.delete(key)); // allow a retry after a failure
    tasks.set(key, p);
  }
  return tasks.get(key);
}

/** Strictly increasing timestamp (ms) for VIDEO-mode calls. */
export function nextTimestamp() {
  lastTs = Math.max(performance.now(), lastTs + 1);
  return lastTs;
}

/* ---------- Person segmentation ---------- */
export const loadSegmenter = (key = 'general', { mode = 'VIDEO' } = {}) => loadTask(`seg:${key}:${mode}`, 'ImageSegmenter', {
  baseOptions: { modelAssetPath: SEGMENT_MODELS[key].url },
  outputConfidenceMasks: true,
  outputCategoryMask: false,
}, mode);

/** Copy the person probability out of a segmenter result (valid only inside the callback). */
function personMask(result, key) {
  const masks = result.confidenceMasks;
  if (!masks?.length) return null;
  const m = masks[0];
  const data = m.getAsFloat32Array().slice();
  if (SEGMENT_MODELS[key].multiclass) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
  return { data, width: m.width, height: m.height };
}

/**
 * Segment one frame. Returns { data: Float32Array, width, height } where data is
 * the person probability (for multiclass models: 1 − background).
 */
export function segmentFrame(segmenter, source, key) {
  let out = null;
  segmenter.segmentForVideo(source, nextTimestamp(), (result) => { out = personMask(result, key); });
  return out;
}

/** Segment a still with a segmenter loaded in IMAGE mode. Same result shape as segmentFrame. */
export function segmentImage(segmenter, source, key) {
  let out = null;
  segmenter.segment(source, (result) => { out = personMask(result, key); });
  return out;
}

/**
 * Guess whether a mask marks the person (true) or the background (false):
 * the person is usually nearer the centre than the frame edges. Returns null when the frame
 * gives no clear answer (no person yet, e.g. a title card), so callers can ask again later.
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
  const c = centre / centreN, e = edge / edgeN;
  if (Math.abs(c - e) < 0.15) return null;
  return c > e;
}

/* ---------- Landmarks ---------- */
export const loadFaceLandmarker = ({ numFaces = 1 } = {}) => loadTask(`face:${numFaces}`, 'FaceLandmarker', {
  baseOptions: { modelAssetPath: FACE_MODEL },
  numFaces,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

export const loadPoseLandmarker = ({ numPoses = 1 } = {}) => loadTask(`pose:${numPoses}`, 'PoseLandmarker', {
  baseOptions: { modelAssetPath: POSE_MODEL },
  numPoses,
  minPoseDetectionConfidence: 0.5,
  minPosePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

/** The first face's 478 landmarks, or null. */
export function detectFace(landmarker, source) {
  return landmarker.detectForVideo(source, nextTimestamp()).faceLandmarks?.[0] || null;
}

/** The first body's 33 landmarks (with `visibility`), or null. */
export function detectPose(landmarker, source) {
  const lm = landmarker.detectForVideo(source, nextTimestamp()).landmarks?.[0];
  return lm ? lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })) : null;
}

/** Every face's 478 landmarks (empty array when none). */
export function detectFaces(landmarker, source) {
  return landmarker.detectForVideo(source, nextTimestamp()).faceLandmarks || [];
}

/** Every body's 33 landmarks with `visibility` (empty array when none). */
export function detectPoses(landmarker, source) {
  return (landmarker.detectForVideo(source, nextTimestamp()).landmarks || [])
    .map((lm) => lm.map((p) => ({ x: p.x, y: p.y, visibility: p.visibility ?? 1 })));
}
