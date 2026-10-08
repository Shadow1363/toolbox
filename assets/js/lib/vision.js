/**
 * MediaPipe Tasks Vision, loaded from jsDelivr on first use. One WASM fileset is shared
 * by every task; each model loads once and is cached. GPU delegate first, CPU fallback.
 *
 *   const seg = await loadSegmenter('general');   const m = segmentFrame(seg, video, 'general');
 *   const face = await loadFaceLandmarker();      const lm = detectFace(face, video);   // 478 points or null
 *   const pose = await loadPoseLandmarker();      const lm = detectPose(pose, video);   // 33 points or null
 *
 * Landmarks are normalized (x, y in 0..1 of the source frame). All tasks run in VIDEO mode,
 * which needs strictly increasing timestamps; `nextTimestamp()` guarantees that even when
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

/** Create a task once per key, trying the GPU delegate first. */
function loadTask(key, className, options) {
  if (!tasks.has(key)) {
    const p = (async () => {
      const { mp, fileset } = await vision();
      const opts = (delegate) => ({ ...options, baseOptions: { ...options.baseOptions, delegate }, runningMode: 'VIDEO' });
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
export const loadSegmenter = (key = 'general') => loadTask(`seg:${key}`, 'ImageSegmenter', {
  baseOptions: { modelAssetPath: SEGMENT_MODELS[key].url },
  outputConfidenceMasks: true,
  outputCategoryMask: false,
});

/**
 * Segment one frame. Returns { data: Float32Array, width, height } where data is
 * the person probability (for multiclass models: 1 − background).
 */
export function segmentFrame(segmenter, source, key) {
  let out = null;
  segmenter.segmentForVideo(source, nextTimestamp(), (result) => {
    const masks = result.confidenceMasks;
    if (!masks?.length) return;
    const m = masks[0];
    const data = m.getAsFloat32Array().slice(); // copy: the mask is only valid inside this callback
    if (SEGMENT_MODELS[key].multiclass) for (let i = 0; i < data.length; i++) data[i] = 1 - data[i];
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

/* ---------- Landmarks ---------- */
export const loadFaceLandmarker = () => loadTask('face', 'FaceLandmarker', {
  baseOptions: { modelAssetPath: FACE_MODEL },
  numFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5,
});

export const loadPoseLandmarker = () => loadTask('pose', 'PoseLandmarker', {
  baseOptions: { modelAssetPath: POSE_MODEL },
  numPoses: 1,
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
