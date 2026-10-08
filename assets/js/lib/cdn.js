/**
 * Every third-party library the site loads, pinned to an exact version and fetched
 * only when a tool first needs it. Each library loads once; failures reset so a retry works.
 *
 *   const { marked } = await loadLib('marked');     // ES module namespace
 *   const mammoth = await loadLib('mammoth');        // classic script → its global
 *
 * kind 'esm' → dynamic import(); kind 'script' → <script> tag, resolves to window[global].
 * jsDelivr's `/+esm` endpoint serves npm packages that only ship CommonJS as ES modules.
 */
const NPM = 'https://cdn.jsdelivr.net/npm';
const CM_DEPS = '@codemirror/state@6.7.6,@codemirror/view@6.43.14,@codemirror/language@6.13.1,@lezer/common@1.5.3,@lezer/highlight@1.2.5,@lezer/lr@1.4.11';
const cm = (pkg, deps = CM_DEPS) => `https://esm.sh/${pkg}${deps ? `?deps=${deps}` : ''}`;

export const LIBS = {
  // Documents
  marked: { kind: 'esm', url: `${NPM}/marked@18.1.0/lib/marked.esm.js` },
  turndown: { kind: 'esm', url: `${NPM}/turndown@7.2.4/+esm` },
  turndownGfm: { kind: 'esm', url: `${NPM}/@joplin/turndown-plugin-gfm@1.0.68/+esm` },
  mammoth: { kind: 'script', url: `${NPM}/mammoth@1.13.0/mammoth.browser.min.js`, global: 'mammoth' },
  docx: { kind: 'esm', url: `${NPM}/docx@9.9.0/+esm` },
  pdfmake: { kind: 'script', url: `${NPM}/pdfmake@0.3.11/build/pdfmake.min.js`, global: 'pdfMake' },
  pdfmakeFonts: { kind: 'script', url: `${NPM}/pdfmake@0.3.11/build/vfs_fonts.js`, global: 'pdfMake' },
  htmlToPdfmake: { kind: 'esm', url: `${NPM}/html-to-pdfmake@2.5.35/+esm` },
  jspdf: { kind: 'esm', url: `${NPM}/jspdf@4.2.1/+esm` },
  pdfjs: { kind: 'esm', url: `${NPM}/pdfjs-dist@6.4.299/build/pdf.min.mjs` },
  pdfjsWorker: { kind: 'url', url: `${NPM}/pdfjs-dist@6.4.299/build/pdf.worker.min.mjs` },
  // Data
  xlsx: { kind: 'esm', url: 'https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs' },
  yaml: { kind: 'esm', url: `${NPM}/js-yaml@5.4.3/+esm` },
  xml: { kind: 'esm', url: `${NPM}/fast-xml-parser@5.11.2/+esm` },
  toml: { kind: 'esm', url: `${NPM}/smol-toml@1.9.0/+esm` },
  jszip: { kind: 'script', url: `${NPM}/jszip@3.10.1/dist/jszip.min.js`, global: 'JSZip' },
  // Images, media, encoding
  heic: { kind: 'esm', url: `${NPM}/heic-to@1.6.5/+esm` },
  ffmpeg: { kind: 'esm', url: `${NPM}/@ffmpeg/ffmpeg@0.12.15/dist/esm/index.js` },
  ffmpegWorker: { kind: 'url', url: `${NPM}/@ffmpeg/ffmpeg@0.12.15/dist/esm/worker.js` },
  ffmpegCore: { kind: 'url', url: `${NPM}/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.js` },
  ffmpegWasm: { kind: 'url', url: `${NPM}/@ffmpeg/core@0.12.10/dist/esm/ffmpeg-core.wasm` },
  qrcode: { kind: 'esm', url: `${NPM}/qrcode-generator@2.0.4/+esm` },
  jsqr: { kind: 'esm', url: `${NPM}/jsqr@1.4.0/+esm` },
  hashWasm: { kind: 'esm', url: `${NPM}/hash-wasm@4.12.0/+esm` },
  // Image category. Set `window.Prism = { manual: true }` before loading the Prism core (image/code-screenshot does).
  prism: { kind: 'script', url: `${NPM}/prismjs@1.30.0/components/prism-core.min.js`, global: 'Prism' },
  prismAutoloader: { kind: 'script', url: `${NPM}/prismjs@1.30.0/plugins/autoloader/prism-autoloader.min.js`, global: 'Prism' },
  prismComponents: { kind: 'url', url: `${NPM}/prismjs@1.30.0/components/` },
  rough: { kind: 'esm', url: `${NPM}/roughjs@4.6.6/bundled/rough.esm.js` },
  pako: { kind: 'script', url: `${NPM}/pako@1.0.11/dist/pako.min.js`, global: 'pako' },
  upng: { kind: 'script', url: `${NPM}/upng-js@2.1.0/UPNG.min.js`, global: 'UPNG' }, // needs pako loaded first
  // Dev category. CodeMirror comes from esm.sh, not jsDelivr: jsDelivr's `+esm` builds pin a different
  // @codemirror/state per package (two copies → "Unrecognized extension value"). `?deps=` makes every
  // package share one copy of the core. esm.sh encodes a package's own dependency subset in its URL, so the
  // shared core packages are requested with exactly that subset (state and view: none / state only), which
  // gives the same URL the language packages import. Bumping a version means updating CM_DEPS and these.
  // Load them through lib/editor.js, never directly.
  cmState: { kind: 'esm', url: cm('@codemirror/state@6.7.6', '') },
  cmView: { kind: 'esm', url: cm('@codemirror/view@6.43.14', '@codemirror/state@6.7.6') },
  cmHighlight: { kind: 'esm', url: cm('@lezer/highlight@1.2.5', '@lezer/common@1.5.3') },
  cmCommands: { kind: 'esm', url: cm('@codemirror/commands@6.11.1') },
  cmLanguage: { kind: 'esm', url: cm('@codemirror/language@6.13.1') },
  cmJson: { kind: 'esm', url: cm('@codemirror/lang-json@6.0.2') },
  cmHtml: { kind: 'esm', url: cm('@codemirror/lang-html@6.4.12') },
  cmXml: { kind: 'esm', url: cm('@codemirror/lang-xml@6.1.0') },
  cmCss: { kind: 'esm', url: cm('@codemirror/lang-css@6.3.1') },
  diff: { kind: 'esm', url: `${NPM}/diff@9.0.0/+esm` },
  svgo: { kind: 'esm', url: `${NPM}/svgo@4.1.0/dist/svgo.browser.js` },
  croner: { kind: 'esm', url: `${NPM}/croner@10.0.1/dist/croner.js` },
  cronstrue: { kind: 'esm', url: `${NPM}/cronstrue@3.30.0/+esm` },
  // Faker: one ES module per locale (`dist/locale/<code>.js` exports `faker`); see dev/fake-data.
  faker: { kind: 'url', url: `${NPM}/@faker-js/faker@10.6.0/dist/locale/` },
  // EFF long wordlist (7776 words, CC BY 3.0) as a JSON array, for passphrases.
  effWords: { kind: 'url', url: `${NPM}/@wordlist/english-eff@1.0.1/dist/data/long.json` },
  // Audio category (lib/audio-*.js). mediabunny: container probing, track picking, WebCodecs decode, Opus in OGG/WebM
  // and audio stream copy. lamejs runs inside a classic worker (importScripts), so it is a 'url'. RNNoise: the ES module
  // glue takes `locateFile` for its .wasm.
  mediabunny: { kind: 'esm', url: `${NPM}/mediabunny@1.61.3/dist/bundles/mediabunny.min.mjs` },
  lamejs: { kind: 'url', url: `${NPM}/lamejs@1.2.1/lame.min.js` },
  rnnoise: { kind: 'esm', url: `${NPM}/@jitsi/rnnoise-wasm@0.2.1/dist/rnnoise.js` },
  rnnoiseWasm: { kind: 'url', url: `${NPM}/@jitsi/rnnoise-wasm@0.2.1/dist/rnnoise.wasm` },
  // Machine learning (bundles onnxruntime-web, which fetches its WASM from jsDelivr). Loaded inside workers by lib/whisper.js.
  transformers: { kind: 'esm', url: `${NPM}/@huggingface/transformers@4.2.0/dist/transformers.min.js` },
};

const loaded = new Map();

/** Load a library by its LIBS key. Rejects with a readable message when the CDN is unreachable. */
export function loadLib(name) {
  const lib = LIBS[name];
  if (!lib) return Promise.reject(new Error(`Unknown library "${name}".`));
  if (!loaded.has(name)) {
    const p = (lib.kind === 'esm' ? import(/* webpackIgnore: true */ lib.url)
      : lib.kind === 'script' ? loadScript(lib.url, lib.global)
        : Promise.resolve(lib.url))
      .catch((err) => {
        loaded.delete(name);
        console.error(err);
        throw new Error(`Couldn't load a required library (${name}). Check your connection or content blocker and try again.`);
      });
    loaded.set(name, p);
  }
  return loaded.get(name);
}

function loadScript(url, global) {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script');
    sc.src = url;
    sc.onload = () => resolve(window[global]);
    sc.onerror = () => { sc.remove(); reject(new Error(`Failed to load ${url}`)); };
    document.head.append(sc);
  });
}

/**
 * A module worker that runs a cross-origin worker script. Browsers refuse
 * `new Worker(crossOriginUrl)`, but a same-origin blob may `import` from a CORS-enabled CDN.
 */
export function workerUrl(moduleUrl) {
  return URL.createObjectURL(new Blob([`import ${JSON.stringify(moduleUrl)};`], { type: 'text/javascript' }));
}
