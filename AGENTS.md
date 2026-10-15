# Toolbox: agent guide

> **Rule:** When you add, rename or significantly change a tool or category, update the relevant AGENTS.md in the same change.

## What this is

- Static site of browser tools at tools.tomasmartinez.xyz: plain HTML, CSS and ES modules. No framework, no build step, no backend.
- Everything runs on the user's device; files are never uploaded. Keep it that way.

## Run locally

- `npx serve .` (or `python3 -m http.server 8000`) from the repo root, then open the printed URL.
- A server is required: pages use ES modules and absolute paths (`/assets/...`), which fail on `file://`.

## Layout

```
index.html               Home: category cards + search
404.html
assets/
  css/styles.css         The only shared stylesheet (tokens, layout, components)
  js/tools.js            Registry of every category and tool
  js/site.js             Header, breadcrumb, theme toggle, footer, card grids, tool title
  js/theme-init.js       Sets data-theme before first paint (classic script in <head>)
  js/toolbox.js          Home page toolbox animation (hover/click opens the lid, tools fan out; edit its TOOLS list)
  js/lib/                Shared modules (see below)
  img/                   16:10 card thumbnails (SVG) + logo.svg (favicon; the header draws the same shape inline from site.js)
_template/               Copy-paste starters: category/, tool/, canvas-tool/
<category>/index.html    Category hub, e.g. video-effects/, convert/, image/, audio/
<category>/<tool>/       index.html + script.js (+ style.css, + tool-only modules)
```

## Routing and the registry

- Folder routing: `/<category>/<tool>/index.html` serves `/<category>/<tool>/`. A tool without a category lives at `/<tool>/` (e.g. a future `/regex/`).
- `assets/js/tools.js` is the single source of truth for what is listed.
  - `categories[]`: `{ id, name, description, thumbnail, sections?, related? }`. `related` lists tool ids from other categories to show (and search) at the end of the hub.
  - `tools[]`: `{ id, category?, name, description, thumbnail, status?, tags?, privacy? }`. `status` is `'new' | 'beta' | 'soon'` (a badge on the card; `soon` renders a disabled card; use it sparingly, see [video-effects/AGENTS.md](video-effects/AGENTS.md#tags-in-toolsjs)); `tags` feed home search; `privacy` replaces the "Processed locally, nothing is uploaded" line under the title, for a tool that makes requests the user opts into (Validators).
  - Helpers: `getTool`, `getCategory`, `toolsIn`, `standaloneTools`, `toolUrl`, `categoryUrl`.
- `site.js` reads `<body data-tool="…">` or `<body data-category="…">` and fills placeholders:
  `#site-header`, `#site-footer`, `[data-tool-head]` (tool title + description from the registry), `[data-grid="home"]`, `[data-grid="category"]`, `[data-search]`.
  Names and descriptions live only in `tools.js`; pages never hard-code them (the `<title>`/meta tags are the one exception, for SEO).

## Shared code: reuse before writing

| Module (`assets/js/lib/`) | Use it for                                                                                                                                                                                   |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `controls.js`             | `createControls(root, sections, { onChange })`: declarative settings panel with a live `state`, `showIf`, presets, swatches; sections take `collapsed` (a `<details>`; `panel.section(id)` returns it) and `{ type: 'subhead' }` controls group long sections |
| `upload.js` / `media.js` | `createDropzone(...)` and `loadMedia(file)`: drag-drop + picker, type/size validation, `MediaError` messages; HEIC photos decode natively in Safari, elsewhere through `heic-to` (`isHeic`); `createFilePicker` for any file type; `audioGraph`/`mixTrack` route video audio for export |
| `stage.js`                | `createStage({ canvas, transport, render(t), getDuration, getVideo, getVideoOffset? })`: preview loop + play/scrub/mute bar; `renderFrame(t)`/`release()` for frame-by-frame export; `getVideoOffset` trims (stage t 0 = that video time) |
| `exporter.js`             | `createExportBar(...)`: the standard **Export video / Export GIF / Export PNG** bar every media tool uses (video export shows its estimated size; `prepareFrame(t)` runs before each GIF frame); `recordStage`, `recordStageGif`, `progressModal` (`.phase()`/`.message()` for multi-step jobs), `exportPNG`, `canRecordAlpha`, `TRANSPARENT_HINT` |
| `gif.js`                  | `loadGifenc`, `quantizeFrame` (Bayer dither + palette, 1-bit alpha), `frameOptions`, `gifDelay`, `gifDelays`                                                                                 |
| `vision.js`               | MediaPipe Tasks Vision (lazy, one WASM fileset, GPU→CPU): `loadSegmenter`/`segmentFrame` (VIDEO) or `loadSegmenter(key, { mode: 'IMAGE' })`/`segmentImage` (stills), `loadFaceLandmarker({ numFaces })`/`detectFace`/`detectFaces`, `loadPoseLandmarker({ numPoses })`/`detectPose`/`detectPoses`, `loadHandLandmarker({ numHands })`/`detectHands` (21 points, 8 = index fingertip), `nextTimestamp` |
| `multi-track.js`          | Several people at once: `detectHeads` (every head per frame), `assignTracks` (stable ids: velocity prediction + Hungarian matching, reconnects people who come back), `applyEdits` (swap/merge fixes), `trackThumbnails`. Feeds `smoothTrack`/`sampleTrack` per track |
| `person-mask.js`          | `createPersonMask(prefix)` (smoothing → threshold/softness → feathered alpha canvas) and `drawPersonCutout`                                                                                  |
| `still-mask.js`           | Photos: `createStillMask(prefix)` turns one raw mask (`segmentImage`, or `subject.js`) into an edge-snapped (guided filter) alpha with optional add/erase brush strokes and undo; `setMask(raw)` swaps the mask and keeps the strokes; `full(W, H, feather)` (Text Behind Person, Background Remover, Nametag) |
| `object-mask.js` / `mask-panel.js` | Subject masks for video and photos: `createMaskTrack(prefix)` (person = MediaPipe, object = SAM 2.1 clicks tracked frame to frame, both = union; correction keyframes, automatic keyframes via `setKeyframes` with grouped / optional prompts, brush, grow/shrink, feather, zero-lag temporal smoothing, masks cached per frame) and `createMaskPanel(...)` (the shared Subject + Mask edges sections, clicks/brush on the preview, masking pass with a progress bar, frame status strip; `showMode`/`showPoints`/`autoRun` for tools with presets). Pop Out, Magic Mask, Scrolling Playlist. Details in [video-effects/AGENTS.md](video-effects/AGENTS.md) |
| `subject.js` (+ `subject-worker.js`) | Photos, any subject (transformers.js worker, WebGPU → WASM): `segmentSubject` (ISNet, main subject), `embedPhoto` + `pickMask(groups)` (SAM 2.1 click selection, several objects), `subjectPlan` (download size, cached?), `loadSubjectModel` |
| `whisper.js` (+ `whisper-worker.js`) | Speech to text with Whisper (transformers.js in a module worker, WebGPU → WASM): `transcribe` (word timestamps, auto language detection, `task: 'translate'`), `detectLanguage`, `languageName`, `decodeAudio`, `modelBytes`, `isCached`, `pickDevice`, language list |
| `transcript.js` / `captions.js` | Timed transcript lines (`buildLines`, `retime`, `timeline`, `pageAt`, `toSRT`, `toVTT`) and the animated caption renderer `drawCaption` + `CAPTION_PRESETS` (Auto Captions, Audio Extractor, Waveform Video) |
| `audio-io.js` / `audio-waveform.js` / `audio-player.js` / `audio-export.js` | Audio tools: probe + decode any audio/video (`loadAudio`, browser → WebCodecs → ffmpeg), waveform view with zoom/selection, AudioBuffer player (Space, loop selection), offline render + WAV/MP3/OGG/WebM export bar. Details in [audio/AGENTS.md](audio/AGENTS.md) |
| `ffmpeg.js` | ffmpeg.wasm fallback: `ffmpegRun`, `ffmpegProbe`, `parseStreams` (the file converter keeps its own copy) |
| `showcase-frame.js`       | Screen Showcase styling shared with Zoom on Click: `backgroundSection`/`frameSection` panel specs, `drawShowcaseBackground`, `fitInFrame`, `buildFrameCard`, `drawCardShadow`, `cardMotion(t, D, s)` (intro zoom, pan, tilt, fades), `drawCard` (shadow + card, tilted through `persp`) |
| `zoom-camera.js`          | Zoom on Click's camera: `buildKeyframes(points, { follow })`, `cameraAt(keys, t)`, `viewRect`, `clampView`, `drawZoomed(c, src, keys, points, cam, t, bw, bh, k, opts)` (motion blur, click rings, `crop` to move the camera inside part of the source) |
| `progress-bar.js`         | Progress Overlay's drawing: `drawProgressOverlay(ctx, t, s, chapters)` (bar styles, chapter labels, timer) |
| `audio-dsp.js` / `audio-clean.js` | Audio Cleanup's processing: `measureLoudness`, `gateMix`, `normalizeLimit`, `rnnoise`; `cleanAudio(buffer, opts, { wet, stale, signal })` runs the whole chain (RNNoise/gate → high-pass/EQ/compressor → loudness + limiter) with `TARGETS`, `COMP`, `EQ`, `CLEAN_DEFAULTS` |
| `effects/`                | **Effect registry** (see below): `EFFECTS`, `getEffect`, `effectParams`, `describeEffectsForAI`, `effectSchema`, `createGpu`; `effects/schema.js` turns control specs into defaults, JSON Schema and validation |
| `video-encode.js`         | Frame-by-frame export with WebCodecs (mediabunny): `canEncode(W, H)`, `encodeVideo({ width, height, fps, duration, drawFrame, audio, onProgress, signal })` → MP4 (H.264/AAC) or WebM (VP9/Opus); `openFrames(file)` decodes a video's frames (`at(times)` for monotonic times, `get(t)`). Hook it into the export bar with `createExportBar`'s `renderVideo` |
| `handoff.js`              | Pass a file + JSON metadata to another tool through IndexedDB: `sendFile(toolId, file, meta)`, `takeFile(toolId)`, `peekFile`, `clearFile`                                            |
| `head-tracking.js`        | `trackHead` (offline pass, face then body), `smoothTrack` (One Euro, hold + fade), `sampleTrack(t)`; `OneEuro`                                                                               |
| `canvas.js`               | `fit`, `outputSize`, `scratch`, `drawBlurred`, `roundRectPath`, `linearGradient`                                                                                                             |
| `text-anim.js`            | `drawAnimatedText` with entrance (`ANIMATIONS`) and exit (`EXIT_ANIMATIONS`); `textOptions(s, W, H, end)` maps Text Effects panel state to its options |
| `fonts.js`                | `FONTS` list (Google Fonts, loaded on demand), `fontString`, `ensureFont`                                                                                                                    |
| `perspective.js`          | WebGL quad (`draw`) and mesh (`drawMesh`) renderer for real 3D perspective                                                                                                                   |
| `paper-textures.js`       | Cached grain / fiber / crumpled overlay textures                                                                                                                                             |
| `easing.js`, `random.js`  | Easings (+ `cubicBezier`, `easeWith(name, bezier, t)` for a `custom` bezier string); seeded `rng`/`hash`/noise so preview and export match |
| `dom.js`                  | `h()` element builder, `icon()`, `toast()`, `downloadBlob`, `formatBytes`, `store` (safe localStorage)                                                                                       |
| `webm-duration.js`        | Used by the exporter; writes duration into MediaRecorder WebM                                                                                                                                |
| `cdn.js` | `LIBS` (every pinned CDN library) + `loadLib(name)` (lazy, once) + `workerUrl()` for CDN workers |
| `codecs.js` | CSV/TSV, JSON (line/column errors), YAML, XML, TOML parse/stringify; table helpers |
| `text-tool.js` | Input → output tools: `remember` (persisted options), `rememberInput` (persisted input text), copy/download buttons, `debounce`, `dropFiles` (any element as a drop target) |
| `editor.js` | `createEditor(el, { value, lang, onChange, … })`: a textarea at once, upgraded to CodeMirror 6 (JSON/HTML/XML/CSS highlighting, `setMarks` for highlighted ranges); stays a textarea if the CDN fails |
| `image-io.js` | Image tools: `createImageDrop` (dropzone + Ctrl/⌘+V + Paste button), `onPasteImages`, `createImageExport` (PNG/JPG/WebP/SVG + scale + quality, Download and Copy), `copyCanvas`/`copyBlob`, `canEncode`, `downloadZip`, `pickFile` |
| `palette.js` | `samplePixels`, `kmeans` (Lab, seeded), `medianCut`; `hex`/`parseHex`/`rgbToHsl`, WCAG `contrastRatio`/`wcag`/`readableOn` |
| `ai.js` | Optional AI step with the user's own Anthropic key: `aiKey`/`setAiKey(key, { remember })` (memory unless opted in), `askJson({ system, prompt, schema })` (official SDK from `LIBS.anthropic` in browser mode, JSON-schema structured output, refusal fallbacks on, readable errors). Scrolling Playlist's Auto-build |
| `kv.js` | IndexedDB key-value store (`kvGet`/`kvSet`) and a debounced `autosaver(key, get)`; falls back to localStorage |

New helpers that two or more tools need go in `assets/js/lib/`; anything single-use stays in the tool folder.

## Effect registry (`assets/js/lib/effects/`)

- One module per effect, each wrapping an existing tool's drawing code with a common interface: `{ id, name, description, kind: 'overlay' | 'camera' | 'transition', single?, params, ai: { params, hint }, presets?, normalize?, prepare?, track?, render(ctx, frame, t, params, env) }`. The full contract (including `env`) is in the comment at the top of `effects/index.js`.
- Registered: `captions` (lib/captions.js), `text` (lib/text-anim.js), `screenshot` (lib/showcase-frame.js cards + picture-in-picture), `zoom` (lib/zoom-camera.js), `transition` (the Transitions tool's engine and its 17 transitions), `progress` (lib/progress-bar.js), `pop-out` (Pop Out's post.js: the frame inside a post, person popping out), `playlist` (Scrolling Playlist's playlist.js, auto or fingertip scrolling), `magic-mask` (Magic Mask's wipe.js, a transition kind).
- Transition-kind effects get `env.A`/`env.B` (outgoing/incoming frame canvases); the Auto Editor renders a cut with the layer's own effect, so a new transition kind needs no change there.
- `params` are ordinary `createControls` specs. The same list builds an edit panel, the defaults, the JSON Schema an AI fills (`effectSchema`), the prompt text (`describeEffectsForAI`) and the validation (`effectParams` → `{ params, errors, warnings }`). `ai.params` limits what the AI may set; `ai.hint` says when to use the effect.
- Tool pages don't go through the registry; they call the lib functions directly, so the registry can't change how they render. To add an effect, write `effects/<id>.js` and add it to `EFFECTS`; `describeEffectsForAI` and the validation pick it up with no other change.
- Params use local ids per effect, because the same id means different things in different tools (`bg`, `shadow`, `size`).

## Design rules

- **Tokens:** `styles.css` starts with the brand palette shared with the main site (`--bg-color`, `--text-color`, `--accent-color`, `--secondary-bg`, `--card-bg`, `--card-border`, `--nav-bg`), then derived tokens (`--bg`, `--surface`, `--surface-2`, `--border`, `--text-muted`, `--accent`, …). Components use the derived tokens; change colours only in the palette blocks.
- **Themes:** `:root` holds the light tokens; dark overrides them under `[data-theme="dark"]` on `<html>`. `theme-init.js` applies `localStorage.theme`, falling back to the system preference; `site.js` toggles and saves it.
- **Font:** system stack (`--font`, SF Pro on Apple). Web fonts are for canvas text only.
- **Tool page layout:** `[data-tool-head]`, then `.tool-layout` = `aside.panel.controls-panel` (`#upload` + `#controls`) beside `section.panel.preview-panel` (`.preview-stage > canvas#preview`, `#transport`, `#export`). Stacks with the preview first under 960px.
- **Components:** `.card`, `.panel`, `.btn` / `.btn-primary` / `.btn-ghost`, `.chip`, `.segmented`, `.toggle`, `.dropzone`, `.modal`, `.toast`, `.checker` (transparency preview). Tool-only CSS goes in the tool's `style.css`, built on the same tokens.

## Templates (`_template/`)

- `category/index.html`: hub page. Set `data-category`, title and intro.
- `tool/`: text tool (input → output; a working JSON formatter), the starting point for things like `/regex` or `/format`.
- `canvas-tool/`: media tool (upload → controls → stage preview → export).
  `_template/` is not in the registry, so it never shows on the site.

## Add a tool

1. Copy `_template/tool/` or `_template/canvas-tool/` to `/<category>/<id>/` (or `/<id>/` for a standalone tool).
2. In `index.html`, set `<body data-tool="<id>">`, `<title>` and the meta description.
3. Add the entry to `tools[]` in `assets/js/tools.js`.
4. Add a 16:10 thumbnail (`assets/img/<id>.svg`, viewBox `0 0 320 200`); no real logos.
5. Serve the site and check the home card, the hub card, the breadcrumb, the browser console, and the layout at 390px wide (no sideways scroll).
6. Document the tool in that category's AGENTS.md.
7. Add the tool's name to the **Which tool?** dropdowns in `.github/ISSUE_TEMPLATE/feature_request.yml` and `bug_report.yml`.

## Add a category

1. Copy `_template/category/index.html` to `/<id>/index.html` and set `data-category="<id>"`, title and intro.
2. Add `{ id, name, description, thumbnail, sections? }` to `categories[]` in `tools.js`, plus a thumbnail. With `sections`, the hub groups tools by their `section`; add `<div data-search>` to the hub for a search box.
3. Create `/<id>/AGENTS.md` (purpose, tool list, shared patterns) and `/<id>/CLAUDE.md` containing `@AGENTS.md`.
4. Link it in the index below.

## Conventions

- **Libraries:** CDN only, pinned to exact versions (jsDelivr preferred) and loaded lazily (dynamic `import()` or a script tag on first use). Pins live in `assets/js/lib/cdn.js` (`LIBS`); add new libraries there and load them with `loadLib()` (workers import the `LIBS` URL directly, as `whisper-worker.js` does with `transformers`). ML model weights come from huggingface.co / storage.googleapis.com and are cached by the browser; show the download size before fetching them. Exception: CodeMirror comes from esm.sh with pinned `?deps=` because jsDelivr's `+esm` bundles duplicate `@codemirror/state` (see the comment in `cdn.js`). Audio: mediabunny (probe, WebCodecs decode, Opus, stream copy; also video encode/decode in `video-encode.js`), lamejs (MP3, in a worker), RNNoise WASM. AI: `@anthropic-ai/sdk` (`LIBS.anthropic`, through `lib/ai.js` only). OCR: tesseract.js 7 (`tesseract`, its worker, core and per-language data pinned at `@1.0.0`). Older pins still inline: `@mediapipe/tasks-vision@1.1.0` (`vision.js`), `gifenc@1.0.3` (`gif.js`), `jszip@3.10.1` (Text Match Cut). Fail gracefully with a `toast()` when the network is blocked.
- **Privacy:** no backend, no analytics, no uploads. Opt-in network features (cover lookups, a music-service import with the user's own app, an AI step with the user's own key) go straight from the browser to that service, say so next to the button, and set `privacy` in the registry.
- **Names:** made-up names for generated sites, papers and people; no real brands or logos in UI, thumbnails or generated content.
- **Errors:** bad files go through `loadMedia` → `MediaError` → `toast(message, 'error')`. Feature-detect (`canRecord()`, `supportsCanvasFilter`, `createPerspective()` returning `null`) and show a hint instead of failing.
- **Editors** (Whiteboard, Pixel Art, Social Image) use `.editor-layout` (canvas + 300px side panel), `.toolbar` and `.tool-btn` from `styles.css` §13, and autosave through `kv.js`.
- **Responsive:** `.tool-layout > *` has `min-width: 0` so wide content scrolls inside its panel; keep it that way.

## Gotchas

- `createControls` evaluates every `showIf` while it builds the panel. Helpers a `showIf` calls must be hoisted `function` declarations, not `const` arrows declared later (TDZ error). `onChange` may reference objects created afterwards, because it only fires on input.
- Module top-level order matters: call render/init functions after the `const`s they use (`site.js` runs its init at the bottom for this reason).
- Control ids share one `state` object per panel. Sections from a shared helper (`showcase-frame.js`) own their ids (`bg`, `blurAmount`, `padding`, `shadow`, …); reusing one silently makes two sliders fight (Zoom on Click's motion blur once read the background blur's 60).
- Local testing with `python3 -m http.server` lets Chrome cache modules and workers heuristically; after editing a worker, hard-reload or use a server that sends `Cache-Control: no-store`.
- Canvas text measured before a web font loads uses fallback widths. Wait with `ensureFont(family, weight, cb)` or re-layout on `document.fonts` `loadingdone` (see Text Match Cut).
- `scratch(name, w, h)` canvases are shared by name and resize in place. Use a distinct name per size or use (e.g. `` `tmc-sharp-${W}x${H}` ``).
- Inside render code, use seeded `rng`/`hash`, never `Math.random`. Otherwise preview and export differ.
- `el.replaceChildren(a, null)` inserts the text "null" (unlike `h()`, which skips null children). Filter first.
- Control specs hold `showIf` functions, so `structuredClone` on them throws; copy with spreads. If you set `panel.state` values after `createControls`, call `panel.refresh()` so `showIf` sections update.

## Categories

- [Video Effects](video-effects/AGENTS.md): canvas effects for video, images and animated text, plus captions, background removal, zooms, progress overlays, retro looks, speed ramps, pop-out posts, a hand-scrolled playlist and magic mask transitions.
- [Convert & Encode](convert/AGENTS.md): file converter (documents, data, images, audio/video), Base64, encoders, hashes, JSON, colors, timestamps, case, QR.
- [Image](image/AGENTS.md): device mockups, code screenshots, social images, favicons, before/after sliders, compression, palettes, a whiteboard and a pixel art editor.
- [Audio](audio/AGENTS.md): audio extractor + Whisper transcript (batch, original-stream copy), trimmer with fades and splits, waveform videos (audiograms), noise reduction and loudness normalization.
- [Dev](dev/AGENTS.md): regex tester, diff checker, cron builder, CSS generators (gradient, shadow, glass, clip-path, cubic-bezier), SVG optimizer, meta tag previewer, CPF/CNPJ/CEP/postal code/phone validators, fake data, and password/UUID/API key generators.
