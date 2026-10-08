# Convert & Encode: category guide

Site-wide rules, shared modules and checklists: [root AGENTS.md](../AGENTS.md).

## Scope
- **Belongs here:** turning files or text from one format into another, encoding/decoding, hashing, and small developer converters. Everything runs in the browser; files are never uploaded.
- **Belongs elsewhere:** visual effects on video/images (Video Effects).

## Hub
- `/convert/index.html` has `data-search`; `site.js` renders tools grouped by `section` (order from the category's `sections` in `tools.js`: Files, Data, Encoding, Developer) and filters by name, description and `tags`.
- List every format a tool handles in its `tags` (`"pdf"`, `"base64"`, `"heic"`…): that is how searching a format finds the tool.

## Shared code
| Module | Use it for |
| --- | --- |
| `assets/js/lib/cdn.js` | `LIBS` (every pinned CDN URL) and `loadLib(name)`: loads a library on first use, once. `workerUrl(url)` runs a CDN worker script (pdf.js, ffmpeg) through a same-origin blob. Add new libraries here, never inline. |
| `assets/js/lib/codecs.js` | CSV/TSV parse + stringify (in-house, RFC 4180, delimiter detection), `rowsToObjects`/`objectsToRows`/`findRecords`, JSON with line/column errors (`jsonErrorAt`), YAML, XML, TOML. Throws `CodecError` with readable messages. |
| `assets/js/lib/text-tool.js` | `remember(key, sections)` (options persist in localStorage), `copyButton`, `downloadButton`, `actionButton`, `debounce`, `readText` |
| `assets/js/lib/upload.js` | `createFilePicker(root, { multiple, accept, label, hint, onFiles })`: any file type; add `.is-compact` to its `el` for a one-line zone |
| `styles.css` §12 | `.io-options` (options bar), `.io-grid` (input left, output right; stacks under 860px), `.io-panel`, `.io-head`, `.io-status`, `.io-rows`/`.io-row` (label · value · copy), `.io-banner` |

## Small tools (input → output, live)
Each is `index.html` + `script.js` (+ `style.css` when needed): `createControls` options in `#options` wrapped in `remember('<tool-id>', …)`, input panel left, output right, recomputed on input (`debounce`), Copy/Download buttons.
- **base64**: text (UTF-8) or a file → Base64 / Base64URL / data URI; decodes standard, URL-safe, unpadded or `data:` input. Binary output is typed with `detect()` from the file converter's `formats.js` and previewed when it's an image. Output box shows the first 1M characters; copy/download get everything.
- **encode-decode**: URL (component or full), HTML entities (decoded through a `<textarea>`, so nothing executes), Unicode escapes (`\uXXXX` incl. surrogates, `\u{X}`, `U+`), hex and binary over UTF-8 bytes, JWT (decode only, always labelled "Not verified"; JWE refused).
- **hash**: MD5 via hash-wasm, SHA-1/256/512 via Web Crypto; files over 256 MB stream in 8 MB chunks through hash-wasm. "Compare" matches hex (any case) or Base64.
- **json-tools**: input auto-detected (JSON → XML → TOML → YAML); Format, Minify, YAML, TOML, XML, TypeScript (`ts-types.js`: arrays of objects merge into one interface, missing keys become optional).
- **color**: parses hex/rgb/hsl/oklch itself, anything else through the browser's CSS parser; OKLCH via Björn Ottosson's OKLab matrices; out-of-gamut OKLCH is clamped and flagged; WCAG contrast is for the opaque colour.
- **timestamp**: numbers are s/ms/µs/ns by digit count (or forced); `YYYY-MM-DD[ HH:mm[:ss]]` without a zone is wall time in the selected IANA zone (`zonedToEpoch`, two passes for DST); other strings go through `Date.parse`.
- **case**: `words()` splits at separators and camel humps (`XMLHttp` → `XML Http`); Title Case keeps punctuation, small words and mixed-case words (iPhone).
- **qr-code**: create with qrcode-generator (UTF-8 bytes as a binary string), drawn on our own canvas/SVG for crisp modules; read with `BarcodeDetector` when it supports QR, else jsQR. Wi-Fi passwords are never saved to localStorage; decoded links are shown, never opened automatically.

## Universal File Converter (`file-converter/`)
- Files: `script.js` (queue UI, conversion runner, downloads), `formats.js` (`FORMATS`, `detect`, `detectText`), `registry.js` (`Item`, `register`, `targets`, `run`), `preview.js`, `converters/*.js`, `style.css`.
- Flow: drop/paste → `detect()` (signature bytes → extension → content sniff for text) → targets = every format reachable through the registry → convert → preview → download (one file, or a ZIP for several).
- Light conversions (no `heavy` step, ≤ 25 MB) run automatically when files, targets or options change; audio/video waits for **Convert**. Failed or cancelled items don't auto-retry until something changes (`stale()` vs `retryable()`).
- Options shown = the union of option specs of every queued chain, persisted in `fc-options`; the last target per source format is remembered (`fc-target:<format>`).
- Two or more images targeting PDF combine into one `images.pdf` (toggle in the queue).
- Preview: HTML (and DOCX via mammoth) in an `iframe sandbox=""` with scripts stripped; PDF in the browser viewer; CSV/TSV/XLSX as a table (first 200 rows); text capped at 200 KB.
- Size limits (`LIMIT`): documents/data 200 MB, images 100 MB, audio/video 1 GB (warning above 250 MB).

### Converter registry
```js
{ from: 'md', to: 'html', options?: [controls specs], note?: 'what is lost', final?: true, many?: true, heavy?: true,
  convert(item, opts, ctx) → Item | Item[] }   // ctx: progress(0..1), status(text), warn(text), signal
```
- No direct converter → `targets()` finds the shortest chain (BFS, max 3 steps; ties by registration order). The UI shows it (Markdown → HTML → PDF) plus every step's `note`.
- `final`: only as the last step (outputs that shouldn't be fed on, e.g. PDF → page images). `many`: takes all queued items and makes one output; only as the first step.
- Hubs: HTML for documents (MD/DOCX/TXT reach PDF and DOCX through it), JSON for data.
- Errors: throw `ConvertError` with a sentence the user can act on; anything else is shown as "Conversion failed: …".

### Add a format
1. Add it to `FORMATS` in `formats.js` (label, extensions, MIME, kind, `text`), plus a signature in `fromSignature()` if it's binary.
2. Write `converters/<name>.js` default-exporting an array of converters to and/or from an existing hub format; load libraries with `loadLib()` (add them to `LIBS` first).
3. Import it in `converters/index.js`. It now shows up in every target list it can reach.
4. Add the format to the tool's `tags` in `tools.js`, and a `DEFAULT_TARGET` in `script.js` if it's a new source.
5. Test: convert a real file, open the output in its native app (or `file`/`ffprobe`), and convert it back.

## Libraries and when they load
| Library (cdn.js key) | Loaded when |
| --- | --- |
| marked | Markdown → HTML |
| turndown + @joplin/turndown-plugin-gfm | HTML → Markdown |
| mammoth | DOCX → HTML/text, DOCX preview |
| docx | HTML → DOCX (writer in `converters/html-docx.js`) |
| pdfmake + vfs_fonts + html-to-pdfmake | HTML → PDF |
| jsPDF | images → PDF (one page per image, any page size) |
| pdfjs-dist (+ worker) | PDF → text/images |
| SheetJS (cdn.sheetjs.com, not npm: npm `xlsx` is stale) | XLSX/XLS/ODS in or out, spreadsheet preview |
| js-yaml, fast-xml-parser, smol-toml | YAML, XML, TOML (converter and JSON Tools) |
| heic-to | HEIC → PNG/JPG |
| @ffmpeg/ffmpeg + core (single-thread, ~32 MB wasm) | first audio/video conversion |
| JSZip | "Download all (.zip)" |
| hash-wasm, qrcode-generator, jsQR | Hash (MD5/streaming), QR create, QR read fallback |

## Known limitations
- **PDF output** uses pdfmake's Roboto: no CJK glyphs (warned) and code blocks aren't monospace. Layout is simplified (structure kept; CSS, fonts and colours dropped).
- **DOCX** in or out keeps structure only: page layout, headers/footers, columns, text boxes and exact fonts are lost.
- **PDF → text** has no OCR: scanned PDFs give no text (warned). Reading order is rebuilt from positions and can still be off for multi-column layouts.
- **Spreadsheets**: formulas become values; formatting, charts and merged cells are dropped.
- **Images**: animated GIFs keep only the first frame (use GIF → MP4); Safari can't encode WebP; HEIC can't be previewed before converting.
- **Remote images** in HTML/Markdown are only embedded in PDF/DOCX when their server allows CORS; others are dropped with a warning.
- **Audio/video**: ffmpeg runs single-threaded in memory: roughly real time or slower, and large files can run out of memory. WebM output is VP8 + Vorbis (fast); MP4/MOV are H.264 + AAC.

## Checklist: new tool in this category
- [ ] Copy `_template/tool/`; use the `.io-*` layout and `text-tool.js` helpers; persist options with `remember()`.
- [ ] Give it a `section` and format-rich `tags` in `tools.js`, plus a thumbnail.
- [ ] Libraries only through `cdn.js`, pinned and lazy.
- [ ] Clear error messages for bad input (line/column where possible); nothing auto-opens or executes user content.
- [ ] Test known-answer values, no console errors, 390px width, light and dark.
- [ ] Add a section above and the tool to the `.github/ISSUE_TEMPLATE/` dropdowns.
