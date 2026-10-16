/*
 * Auto Editor: text in screenshots with tesseract.js (lazy, pinned in lib/cdn.js). One worker, reused.
 *
 *   await ocrImage(img, { lang: 'en', onProgress, signal }) → 'recognized text'
 *   OCR_BYTES                                           ≈ first-run download (engine + English data)
 */
import { loadLib, LIBS } from '/assets/js/lib/cdn.js';

/** Whisper language code → Tesseract traineddata name (the common ones; anything else falls back to English). */
const LANGS = { en: 'eng', es: 'spa', pt: 'por', fr: 'fra', de: 'deu', it: 'ita', nl: 'nld', pl: 'pol', ru: 'rus', uk: 'ukr', tr: 'tur', ar: 'ara', hi: 'hin', ja: 'jpn', ko: 'kor', zh: 'chi_sim' };
export const OCR_BYTES = 7.5e6;

let worker = null, workerLang = '', progress = null;

/** One pinned language per worker: the speech language when Tesseract has it, else English. */
async function getWorker(lang) {
  const code = LANGS[lang] || 'eng';
  if (worker && workerLang === code) return worker;
  await worker?.terminate();
  worker = null;
  const Tesseract = await loadLib('tesseract');
  worker = await Tesseract.createWorker(code, 1, {
    workerPath: LIBS.tesseractWorker.url,
    corePath: LIBS.tesseractCore.url,
    langPath: `${LIBS.tesseractLang.url}/${code}@1.0.0/4.0.0_best_int`,
    logger: (m) => progress?.(m),
  });
  workerLang = code;
  return worker;
}

/** Downscale very large screenshots (OCR time grows with pixels; text stays legible at 2000 px). */
function toCanvas(img) {
  const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
  const sc = Math.min(1, 2000 / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.round(w * sc);
  c.height = Math.round(h * sc);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export async function ocrImage(img, { lang = 'en', onProgress, signal } = {}) {
  const w = await getWorker(lang);
  if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
  progress = (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); };
  try {
    const { data } = await w.recognize(toCanvas(img));
    return data.text.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  } finally {
    progress = null;
  }
}
