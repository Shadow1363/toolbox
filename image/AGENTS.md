# Image: category guide

Site-wide rules, shared modules and checklists: [root AGENTS.md](../AGENTS.md).

## Scope
- **Belongs here:** tools whose result is a still image (or a short image animation) made or edited in the browser: mockups, generated graphics, editors, compression, color extraction.
- **Belongs elsewhere:** video effects and anything with a timeline of real footage (Video Effects); plain format conversion (Convert & Encode → Universal File Converter).

## Hub
- `/image/index.html` has `data-search`; tools are grouped by `section` in `tools.js` (`Create`, `Optimize`, `Draw`).

## Shared rules
- **Every tool accepts a pasted image** (Ctrl/⌘+V anywhere on the page, plus a Paste button where there is a drop zone) and **copies its result** (PNG on the clipboard; browsers only accept PNG images there).
- Paste is ignored while the user types in a text field, unless the clipboard holds only an image.
- Results are drawn on a canvas by one function that the preview and every export call, so exports match the preview.

## Shared code
| Module | Use it for |
| --- | --- |
| `assets/js/lib/image-io.js` | `createImageDrop(root, { label, onLoad, onClear, paste })`: `createDropzone` for one image + page-wide paste + Paste button (`paste: false` when the tool routes pastes itself, e.g. Before/After's two slots). `onPasteImages(cb, { multiple })`, `imagesFromClipboard(clipboardData)`, `readClipboardImages()`, `pasteButton()`. `loadImage(file)` (= `loadMedia` for images), `blobToImage`. `FORMATS`, `canEncode(mime)` (toBlob silently falls back to PNG, so it checks the blob type), `encodeCanvas`, `flatten` (JPG matte). `copyCanvas`/`copyBlob` (passes a Promise to `ClipboardItem` for Safari), `copySvgText`, `downloadZip(files, name)` (JSZip), `pickFile(accept)`, `safeName`. |
| `createImageExport(root, { id, getCanvas(scale), formats, svg, scales, matte, enabled, actions })` | The standard image export bar: Format (PNG/JPG/WebP/AVIF/SVG), Scale, Quality (lossy only), **Download** and **Copy**. Choices persist per `id`; formats the browser can't encode are disabled. `getCanvas` may be async. `actions` adds buttons (Pixel Art: Sprite sheet, GIF). Returns `{ refresh, state, setInfo }`. |
| `assets/js/lib/palette.js` | `samplePixels(img, maxSide)` (opaque pixels, downscaled), `kmeans(px, k, { seed })` in Lab with k-means++ seeding, `medianCut(px, k)`; both return `[{ rgb, count, share }]` largest first. Color math: `hex`, `parseHex`, `rgbToHsl`, `luminance`, `contrastRatio`, `wcag(ratio)`, `readableOn`. |
| `assets/js/lib/kv.js` | `kvGet`/`kvSet`/`kvDel` on IndexedDB (`toolbox-kv`), `autosaver(key, get, ms)` (debounced, flushes on `pagehide`). Used instead of localStorage because boards, sprites and designs with images outgrow its ~5 MB. |
| `styles.css` §13 | `.img-paste-row`, `.img-export`, `.editor-layout` (canvas + 300px side panel), `.editor-main`, `.editor-side`, `.toolbar`, `.tool-btn` (with `<kbd>` shortcut hint), `.editor-viewport`, `.btn-row`, `.kbd-help`. |

## Libraries and when they load
| Library (`cdn.js` key) | Loaded when |
| --- | --- |
| Prism core + autoloader (`prism`, `prismAutoloader`, `prismComponents`) | Code Screenshot, first non-plain highlight. The autoloader fetches each language and its dependencies from jsDelivr. `window.Prism = { manual: true }` is set first so Prism never touches the page. |
| Rough.js (`rough`) | Whiteboard start (hand-drawn style). Without it, shapes fall back to the clean style with a toast. |
| pako + UPNG (`pako`, `upng`) | Image Compressor, the first PNG with a reduced color count. |
| JSZip (`jszip`) | Any "Download all (.zip)" (Compressor, Favicon, Before/After separate files). |
| gifenc (`lib/gif.js`) | Before/After GIF (through `createExportBar`), Pixel Art GIF. |
| Google Fonts | Code Screenshot (the chosen mono font), Social Image (`fonts.js` list), Favicon text (`fonts.js`), Whiteboard (Kalam, hand-drawn text). Canvas re-renders when the font arrives. |

## Tools

### mockup: Mockup Generator
- Files: `script.js` (devices list, editor, layout, export), `devices.js` (`TYPES`, `COLORS`, `screenSize`, `geometry`, `drawDevice`, `drawFakeUI`).
- Devices are drawn with canvas paths: generic phone (punch-hole camera, side buttons), tablet, laptop (lid + deck with a notch), monitor (stand), browser window (light/dark, address text). No product shapes, no logos.
- Model: `devices[] = { id, type, color, theme, url, landscape, size, fit, media }`. `TYPES[].units` is each type's screen width relative to the others, so a phone next to a laptop looks the right size; `size` (40–160%) scales one device.
- `compose(ctx, W, H)` is the only drawing path: background → `rowLayout()` (row, bottom or centre aligned, spacing can be negative to overlap; later devices are in front) → each device into its own canvas at final size → placed flat (with Z rotation) or through `createPerspective()` for Turn/Tilt, with a drop shadow. It returns hitboxes so a click on the preview selects that device.
- Browser windows take the screenshot's aspect ratio; other devices fill their screen (top-aligned, centred, or fit).
- Paste/drop: onto the selected device; a drop on the preview goes to the device under the pointer; a drop on a list row goes to that device.
- Without a screenshot a device shows a made-up app UI (`drawFakeUI`, seeded by device id).
- Export: PNG/JPG/WebP at 1600 px (1×) or 3200 px (2×) on the long side; canvas aspect presets or Auto (fits the devices).

### code-screenshot: Code Screenshot
- Files: `script.js`, `themes.js` (`THEMES`, Prism token → role map, `toLines`), `languages.js` (`LANGS`, `detect`).
- `detect(code)` scores weighted regex rules per language (≥ 3 points wins, else plain text). Keep rules linear: a nested-quantifier rule once hung the page with catastrophic backtracking. Test new rules on a long snippet.
- `layout()` measures every token (canvas `measureText`) into a model shared by `paint()` (canvas at any scale) and `toSvg()` (one `<text>` per line with coloured `<tspan>`s, `xml:space="preserve"`, the Google font `@import`ed, `feDropShadow`).
- Highlighted lines: a text field (`3, 5-7`) or click a line in the preview; numbers are the displayed line numbers (they follow "First line number").
- Code, language and options persist in localStorage. Tab in the code box inserts spaces.

### social-image: Social Image Maker
- Files: `script.js` (editor), `model.js` (`TEMPLATES` with safe-area guides, `starter()` layouts, `renderDoc`, text wrapping, geometry).
- Document `{ template, w, h, bg, layers[] }`; layers are `text | image | rect | ellipse | line` with `x, y, w, h, rot, opacity`. Image data lives in `assets` (id → data URL; images over 2400 px or 2.5 MB are downscaled) so undo snapshots stay small.
- `#doc` is the document at template pixels; `#overlay` (40 px larger each side) draws selection, 8 resize handles + rotation handle, safe-area guides and snap lines. Nothing on the overlay is exported.
- Resize works in the layer's rotated frame with the opposite handle fixed. Corners keep aspect for images (Shift frees it); text corners scale the font, side handles change the wrap width; text height always follows its content.
- Moving snaps edges/centres to the canvas and other layers (Alt disables).
- Guides: `safe` (green, keep content inside) and `avoid` (red, covered by platform UI) rectangles in fractions of the size. Changing template scales the layers to fit.
- History: `checkpoint()` before an edit (JSON snapshot), `changed()` after. Autosave to `kv` (`social-image:current`); named designs in `kv` (`social-image:designs`); download/open JSON (`{ app, doc, assets }`).

### favicon: Favicon Generator
- Files: `script.js`, `style.css`.
- Source: text/emoji (font from `fonts.js` or system emoji, centred on its ink with `actualBoundingBox*`) or an image/SVG, on an optional shape (square, rounded, circle) with a solid or gradient fill.
- `drawIcon(ctx, S, { matte, maskable })` draws every size directly from the source (SVG stays crisp). Apple touch icon and the maskable icon get the touch background (phones show no transparency); maskable content shrinks into the 80% safe circle.
- `favicon.ico` = 16/32/48 PNG-compressed entries (`buildIco`). `favicon.svg` only for text/emoji or SVG sources (it wraps the original SVG, or returns it unchanged with no shape/padding).
- ZIP: ICO, PNGs (16, 32, 180, 192, 512, 512 maskable), SVG, `site.webmanifest`, `favicon-tags.html`. The "Files live at" path prefixes the tags and manifest.

### before-after: Before/After Slider
- Files: `script.js`, `style.css`. Uses `createStage` + `createExportBar` (video, GIF, PNG) like the video tools.
- The Before image sets the frame (`outputSize` up to the chosen long side); After is scaled into it (Crop to fill / Fit inside), then shifted and scaled by the alignment sliders.
- Auto-align (runs when both images load): edge maps (gradient magnitude, robust to colour/exposure edits) at 160 px, searched over ±14 px shifts × 5 scales by mean absolute difference.
- `render(t)`: the divider follows `sweep(t)` (there and back with pauses and easing) while the stage plays or an export runs (`exporting` set in `beforeExport`), else the dragged position.
- Embed code: a dependency-free slider (two images, `clip-path` driven by a transparent `<input type="range">`, so it works with the keyboard). Images inline as JPEG data URIs, or as `before.jpg`/`after.jpg` in a ZIP. The exported images are the aligned frames, so the embed matches the preview.

### compressor: Image Compressor
- Files: `script.js`, `style.css`.
- Queue: items `{ file, url, img, status, out }` processed one at a time; changing a setting re-queues everything (`runToken` drops stale results).
- Pipeline: decode with `<img>` (EXIF orientation applied) → halve-step downscale (`drawDownscaled`) → `canvas.toBlob` (drops all metadata). PNG with fewer colors → UPNG palette PNG. "Same as original" keeps JPG/WebP/AVIF and turns everything else into PNG.
- Keep EXIF (strip off, JPG → JPG only): copies the APP1 Exif segment into the new JPEG with Orientation reset to 1, because the pixels are already upright.
- "Keep the original if it's smaller": when re-encoding at the same size doesn't shrink the file, the original is used.
- Compare: two stacked `<img>` with `clip-path` on the result; Fit/100%/200% (pixelated) zoom.

### palette: Palette Extractor
- Files: `script.js`, `style.css`.
- `samplePixels(img, 200)` → `kmeans` (seed slider) or `medianCut` → sort by coverage, hue (greys last) or lightness.
- Contrast matrix: every text/background pair with the ratio and WCAG level (AA 4.5, AA large 3, AAA 7).
- Exports: CSS variables, Tailwind (v3 config and a v4 `@theme` block), SCSS (variables + map), JSON; a PNG/SVG swatch strip through `createImageExport`. Names are `<prefix>-100, -200…`.

### whiteboard: Whiteboard
- Files: `script.js` (state, input, tools, panel, clipboard, export), `scene.js` (geometry, hit testing, binding, canvas and SVG rendering).
- Elements: shapes/text/sticky/image use `x, y, w, h`; line/arrow/pen use absolute `points` with `x, y, w, h` kept as their bounding box (`syncBox`). Images keep their data in `files` (fileId → data URL), out of undo snapshots.
- Arrow binding: `start`/`end = { id }`. `updateBindings` recomputes each bound endpoint as the point where the line towards the shape's centre crosses its outline (rect, ellipse, diamond), plus a 6 px gap. It runs after every move, resize, text edit and nudge. Dragging an arrow without its shapes unbinds it; dropping an end on a shape binds it (highlighted while dragging).
- Hand-drawn style: Rough.js generator drawables cached per element (`roughCache`, keyed by geometry + style + seed); each element has its own `seed` so it doesn't wobble between frames. SVG export uses `gen.toPaths` for the same strokes.
- Hit testing: unfilled shapes only near their outline, so things inside them stay clickable; groups select as a unit.
- Text editing: a `<textarea>` placed over the element in screen space (free text, sticky notes, shape labels).
- History: `commit()` after each finished operation compares a JSON snapshot with the last one. Autosave: `kv` key `whiteboard:scene` (elements, used files, view, board settings).
- Export: PNG/JPG/WebP (1–3×, capped at 8192 px) or SVG of everything or the selection, with or without the board background; 32 px padding. Copy/paste elements between boards as JSON on the clipboard; pasted images and plain text become elements.

### pixel-art: Pixel Art Editor
- Files: `script.js` (tools, UI, history), `doc.js` (document, compositing, PNG/sheet/GIF/JSON), `palettes.js` (preset palettes with descriptive names, no product names).
- Document: `layers[]` (bottom first) × `frames[]`, each frame holding `cells[layerId]` as RGBA `Uint8ClampedArray`. `composite()` draws visible layers with their opacity; the view, thumbnails, picker and every export use it.
- Tools plot through `plot()`, which applies brush size and mirror axes; painting is clipped to the selection when one exists. Shapes preview on a copy of the cell and commit on release (Shift = filled / constrained line).
- Select/move: dragging inside the selection lifts it into a floating buffer; it is stamped back on Enter/Escape, a tool change or a frame change. Pasted or dropped images become a floating selection scaled to fit.
- History: strokes store the cell before/after; structural edits (layers, frames, resize, rename) store whole-document clones.
- Onion skin: previous frame tinted red, next frame blue, at the ghost opacity.
- GIF: exact palette when the art has ≤ 255 colours (no dithering, unlike `quantizeFrame`), index bitmaps upscaled by nearest neighbour, 1-bit transparency, per-frame durations. Sprite sheet: one row (or a grid over 8 frames) plus a JSON with frame rects and durations.
- Autosave: `kv` key `pixel-art:project` (typed arrays stored as-is). Project JSON stores cells as base64 RGBA.

## Known limitations
- **Clipboard:** browsers only take PNG images, so "Copy" always copies PNG (Compressor converts its result to PNG for the clipboard). The Paste button needs the async Clipboard API; Firefox may refuse it, but Ctrl/⌘+V always works.
- **Encoders:** WebP export is unavailable in Safari; AVIF only where the browser's canvas can encode it (feature-detected and disabled otherwise). The Compressor has no WASM encoders, so it can't beat the browser's own JPEG/WebP quality per byte.
- **Fonts in SVG exports** (Code Screenshot, Whiteboard, favicon text) reference Google Fonts or system fonts; offline or in apps that block web fonts, a fallback font is used and widths can differ.
- **Mockups** are drawn generic devices; perspective needs WebGL (falls back to flat rotation with a toast).
- **Auto-align** (Before/After) only corrects shift and small scale changes, not rotation or perspective.
- **Language detection** is heuristic; short or ambiguous snippets may need the picker.
- **Storage:** autosave and saved designs live in this browser's IndexedDB; clearing site data removes them. Export JSON to keep a copy.
- **Pixel Art** canvases are capped at 256×256 (512 when opening a file); GIFs keep 1-bit transparency.
- **Whiteboard** has straight arrows only (no elbows or curves) and no element rotation.

## Checklist: new image tool
- [ ] Start from `_template/canvas-tool/` (or an editor here); register it with a `section` and tags in `tools.js`, add a thumbnail.
- [ ] Input through `createImageDrop`/`onPasteImages`; output through `createImageExport` (or `createExportBar` for animations) so paste and copy work.
- [ ] One drawing function for preview and export; seeded randomness only.
- [ ] Libraries only through `cdn.js`, lazy, with a toast on failure.
- [ ] Editors: undo/redo, keyboard shortcuts that ignore text fields, autosave through `kv.js`, JSON save/load.
- [ ] Test: no console errors, every export opens correctly, 390px width, light and dark themes. Add a section above and the tool to the `.github/ISSUE_TEMPLATE/` dropdowns.
