# Toolbox

Static site of browser tools. Plain HTML, CSS and ES modules: no framework, no build step. Files never leave the user's device.

```sh
npx serve .            # or: python3 -m http.server 8000
```

Pages use absolute paths (`/assets/...`) and ES modules, so serve the site from its root. Opening `index.html` directly with `file://` won't work.

## Structure

```
index.html                    Home: category cards + search (rendered from tools.js)
404.html
video-effects/index.html      Category hub (data-category="video-effects")
video-effects/<tool>/         index.html + script.js (+ any tool-only modules)
_template/tool/               Starter for text tools (input → output), e.g. /regex, /format
_template/canvas-tool/        Starter for media tools (upload → controls → preview → export)
assets/css/styles.css         Theme tokens (dark/light), layout, cards, controls
assets/js/tools.js            Registry: every category and tool lives here
assets/js/site.js             Header, breadcrumb, theme toggle, footer, card grids, tool title
assets/js/theme-init.js       Applies the saved theme before first paint
assets/js/lib/                Shared helpers (below)
assets/img/                   Card thumbnails (16:10) and favicon
```

## Adding a tool

1. Add an entry to `tools` in `assets/js/tools.js`:
   ```js
   { id: 'regex', name: 'Regex Tester', description: 'Test regular expressions live.', thumbnail: '/assets/img/regex.svg' }
   ```
   With no `category` it lives at `/regex/` and shows under "Tools" on the home page.
   Add `category: 'video-effects'` to put it at `/video-effects/regex/` instead. Optional: `status: 'new' | 'beta' | 'soon'`, `tags: [...]` for search.
2. Copy a template folder to that URL (`_template/tool` for text tools, `_template/canvas-tool` for media tools).
3. In the copied `index.html`, set `<body data-tool="regex">` and the `<title>`/description.
4. Add a thumbnail to `assets/img/`.

The header, breadcrumb, title, home card, hub card and search all update from the registry.

**New category:** add it to `categories` in `tools.js`, then copy `video-effects/index.html` to `/<id>/index.html` and change `data-category`.

## Shared helpers (`assets/js/lib/`)

| Module | What it gives you |
| --- | --- |
| `controls.js` | `createControls(root, sections, { onChange })`: declarative panel (range, color, select, segmented, toggle, text, presets, swatches) with a live `state` and `showIf` |
| `upload.js` | `createDropzone(root, { accept, onLoad, onClear })`: drag & drop + picker, type/size validation, friendly errors |
| `media.js` | `loadMedia(file)`, size limits, audio routing used when exporting |
| `stage.js` | `createStage({ canvas, render(t), getDuration, getVideo })`: preview loop + transport (play, scrub, mute) |
| `exporter.js` | `createExportBar(root, { stage, ... })`: WebM/MP4 via MediaRecorder + `captureStream`, PNG, progress modal, cancel |
| `webm-duration.js` | Writes the duration into recorded WebM files so players can seek them |
| `text-anim.js` | Animated text renderer (typewriter, glitch, neon, pop, words, rise...) |
| `fonts.js` | Google Fonts list + `ensureFont()` for canvas text |
| `canvas.js` | `fit`, `roundRectPath`, `linearGradient`, `drawBlurred`, scratch canvases |
| `perspective.js` | WebGL perspective quad for real 3D tilt |
| `easing.js`, `random.js` | Easings, seeded RNG and noise (identical output in preview and export) |
| `dom.js` | `h()` element builder, icons, toasts, download helper |

## Notes

- Video export records in real time, so a 30s clip takes about 30s. Keep the tab visible while it runs.
- Output is WebM (VP9/VP8 + Opus) in Chrome, Edge and Firefox, and MP4 in Safari. Transparent backgrounds keep alpha only in Chromium.
- Text Behind Person loads MediaPipe Tasks Vision (`@mediapipe/tasks-vision@1.1.0`) and its model from CDNs the first time it is used.
