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
