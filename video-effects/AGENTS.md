# Video Effects: category guide

Site-wide rules, shared modules and checklists: [root AGENTS.md](../AGENTS.md).

## Scope
- **Belongs here:** canvas tools that take a video or image (or nothing) and output an animated or still visual: WebM/MP4, GIF, PNG.
- **Belongs elsewhere:** non-visual or text-in/text-out utilities (formatters, regex, converters) are standalone tools or another category.

## Shared pipeline
`createDropzone` → `media` → `createControls` state → `createStage({ render(t) })` → `createExportBar`.
- `render(t)` is the only drawing path. Preview, PNG, GIF and video export all call it, so the export is the preview.
- Clock: when `getVideo()` returns a `<video>`, its `currentTime` drives `t`; otherwise the stage uses the wall clock and loops over `getDuration()`.
- Trim: pass `getVideoOffset: () => trimIn` and a trimmed `getDuration()`; stage `t = 0` is then that video time. `stage.videoTime(t)` converts back, and the exporter uses it when seeking (Shape Crop).
- Scale convention: `k = Math.min(W, H) / 1080`. Sliders are authored for a 1080px short side, so multiply sizes by `k`.
- Output size: `outputSize(w, h, 1920)` caps the long side at 1920 with even dimensions (video encoders need them).
- Determinism: seed every random choice (`rng`, `hash(step, n)`) from stable inputs (frame/step index, a seed slider).
- After a settings change, call `stage.invalidate()`. After a media change, call `stage.reset()` and `exportBar.refresh()`.
- With no upload, tools draw a built-in demo (Paper Effect, Screen Showcase) under an `.preview-overlay.is-note` hint.

## Import
- `createDropzone(root, { accept: ['video', 'image'], label, limits, onLoad, onClear })` gives a drop zone plus file picker (one file). Text Match Cut and Transitions have their own multi-file pickers that still call `loadMedia`.
- `loadMedia` detects the kind by MIME type, or by extension when `file.type` is empty. Limits come from `LIMITS` in `media.js` (video 1 GB, image 50 MB), overridable per call.
- Files load from `URL.createObjectURL`; `media.dispose()` revokes the URL, and the dropzone calls it when the file is replaced or cleared.
- Videos are `muted`, `playsInline`, `preload="auto"`. WebM files reporting `Infinity` duration get a seek-to-end fix. Undecodable codecs (HEVC `.mov` in Chrome/Firefox) produce a friendly error.

## Export
- Every tool exports **video, GIF and PNG** from one `createExportBar`, always in that order with those labels. Keep all three; a still source still exports a clip of the stage duration.
- `createExportBar(root, { stage, filename, getVideo, getAudio, hasAudio, video, gif, png, onGif, primary, hint, actions, beforeExport, afterExport, prepareFrame })`.
  - `video`/`gif`/`png` enable each button (bool or function; disabled buttons stay visible, e.g. before an upload). `hint` may be a function. Call `exportBar.refresh()` when any of them would change.
  - `primary` picks the highlighted button (`'video'` by default; Text Match Cut uses `'gif'`). `actions` adds extra buttons after the three (Text Match Cut's ZIP, Shape Crop's SVG); an action's `show` (bool or function) hides it, re-checked on `refresh()`.
  - Multi-clip tools pass `getAudio: () => mixTrack(videos)` instead of `getVideo`.
  - `beforeExport(kind)`/`afterExport(kind)` run around video and built-in GIF exports (`kind` is `'video'` or `'gif'`); throw from `beforeExport` to refuse with a toast.
  - `prepareFrame(t)` (async) runs before each built-in GIF frame is drawn, after `getVideo()` is seeked: seek extra videos (Background Remover's looping background) or a remapped source (Speed Ramp, whose stage has no video).
  - Tools on a wall clock that still have sound pass `getAudio: () => audioGraph(video).track` + `hasAudio` instead of `getVideo` (Speed Ramp), so the exporter neither seeks the video nor treats it as the clock.
- **Video:** `recordStage` plays the stage once in real time and records `canvas.captureStream(30)` with MediaRecorder. The progress modal states the length and an estimate (`estimateVideoBytes`: the recorder's target bitrate × duration); the success toast gives the real size.
  - MIME is picked from VP9 → VP8 → WebM → MP4 (Safari records MP4). Bitrate scales with pixel count (4–20 Mbps).
  - `fixWebmDuration` patches the missing duration in Chrome WebM.
  - Audio: `audioGraph(video)` routes the element through Web Audio (once per element): source → `level` (clip volume/fades) → `monitor` (preview mute) → speakers, and `level` → recorder. After that, mute through `setPreviewMuted`, never `video.muted`.
  - The tab must stay visible: background tabs throttle `requestAnimationFrame` and the recording stalls.
- **Transparency:** clear the canvas and add the `checker` class to the preview. Full alpha survives in PNG and Chromium WebM (VP9, `alpha_mode=1`); GIF keeps 1-bit alpha (hard edges). Show `TRANSPARENT_HINT`. `canRecordAlpha()` says whether this browser keeps alpha in video; when it doesn't, record a matte color during `exportKind === 'video'` and warn in `beforeExport` (Shape Crop, Background Remover, Progress Overlay).
- **GIF, built in:** the GIF button opens a dialog (start/end range, fps 10–24, width 320–800 or full; frame count, size estimate, warning over 180 frames; choice saved in `localStorage`), then `recordStageGif` steps through the stage: seeks `getVideo()` to each frame, calls `stage.renderFrame(t)` (pauses the live loop), downscales and encodes, then `stage.release()`s and restores the playhead. Frames are exact, so it needs no real-time playback and works in any browser.
- **GIF, custom:** tools whose frames aren't a plain function of the stage clock pass `onGif(btn)` and encode themselves (Text Match Cut: per-page holds; Transitions: multi-clip seeking).
- **GIF encoding** (`lib/gif.js`): `gifenc` with a per-frame `quantize(256)` palette and a 4×4 Bayer dither before quantizing (prevents gradient banding). Frames with clear pixels switch to `rgba4444` + `oneBitAlpha`; spread `frameOptions(q)` into `writeFrame` to get the transparent index and `dispose: 2`. Delays are in 10 ms steps and at least 20 ms (browsers slow faster frames to 100 ms); `gifDelays(n, fps)` carries the rounding error forward so the GIF keeps time.
- **Frames ZIP:** JSZip, `frame-001.png…` plus `timing.csv`.
- Long jobs use `progressModal(title, onCancel, message)`, yield with `setTimeout(0)` between frames, and support cancel. Multi-step jobs call `modal.phase(title, message)` to start a new step (bar and ETA reset) and `modal.message(text)` for live detail (Auto Captions: decode → download → transcribe).

## Following people (MediaPipe)
Shared in `assets/js/lib/`; reuse these instead of loading MediaPipe again.
- `vision.js`: lazy-loads `@mediapipe/tasks-vision@1.1.0` (jsDelivr) once, with models from `storage.googleapis.com`; each task is cached per options and tries the GPU delegate, then CPU. Tasks run in VIDEO mode (`nextTimestamp()` keeps timestamps strictly increasing even after seeking back); `loadSegmenter(key, { mode: 'IMAGE' })` + `segmentImage` segment a still once with no timestamps.
  - Several people: `loadFaceLandmarker({ numFaces })` / `loadPoseLandmarker({ numPoses })` (one cached task per count) with `detectFaces` / `detectPoses` (arrays).
  - Segmentation: `SEGMENT_MODELS` (square, landscape, multiclass), `segmentFrame` (copies the mask inside the callback, where it's valid), `looksLikePerson` (auto polarity; returns `null` when the frame has no clear person, e.g. a title card, so `createPersonMask` keeps asking instead of locking in a wrong guess).
  - Landmarks: `detectFace` (478 face-mesh points) and `detectPose` (33 body points with `visibility`), both normalized 0..1.
- `person-mask.js`: `createPersonMask(prefix)` → `update(segmenter, source, t, { model, smoothing, still })`, `full(W, H, { threshold, softness, polarity, feather })`; `drawPersonCutout(ctx, source, alpha)`. Temporal smoothing depends on frame order, so pass `smoothing: 0` when the export seeks frames (GIF) and must match the preview. Setting `mask.prev = null` (to restart smoothing before an export) is safe: `small()` falls back to the raw mask.
- `head-tracking.js`: track once, then draw from stored data so playback is smooth and exports match the preview.
  - `trackHead(media, { fps, mode: 'auto'|'face'|'body', onProgress, signal })` seeks every 1/fps s and stores `{ found, x, y, size, roll, via }` (y = top of head; size = head width / frame height). Face first (crown ≈ landmark 10 + 30% of the face height); body (ears, else shoulders) when the face is missing or tiny.
  - `smoothTrack(track, { strength, hold, fadeOut, fadeIn })`: holds the last position through gaps, fades after `hold`, splits into segments wherever the head was fully hidden (no gliding across the frame), and smooths each segment with a zero-lag forward + backward One Euro pass. Cheap, so rerun it on slider changes.
  - `sampleTrack(smooth, t)` interpolates between samples.
- `multi-track.js`: the same idea for several people; reuse it for any per-person effect (Auto Reframe, face blur, speech bubbles).
  - `detectHeads(media, { fps, mode, maxPeople, maxSide, onProgress, signal })` stores every head on every frame (`frames[i] = [{ x, y, size, roll, via }]`). Face Landmarker runs with `numFaces = maxPeople`; Pose Landmarker (`numPoses`) adds heads turned away when fewer faces than people are in view, and every 10th frame for newcomers. Heads inside another head's box are duplicates (`sameHead`; faces win), so a body estimate never becomes an extra person. `maxSide` downscales frames before detection (faster, misses small faces). `onProgress(p, { people })`.
  - `assignTracks(det, { count: 'auto' | n })` is cheap, so rerun it when the count changes. Auto = the most heads seen together for ≥ 0.3 s (`autoCount`, ignores one-frame false positives); a number keeps the n largest heads per frame. Each frame: predict each track from its EMA velocity (up to 0.7 s while hidden), cost = distance in head widths + 1.5 × |log size ratio|, gate that grows while a track is hidden, `hungarian` for the one-to-one match. Leftover heads start a new track while there are fewer than `count`, else reconnect to the nearest lost track anywhere in the frame (people leaving and coming back). Ids are 1..count by first appearance, then left to right.
  - Output tracks have `samples` in `trackHead`'s shape, so `smoothTrack`/`sampleTrack` work per track unchanged.
  - `applyEdits(res, [{ op: 'swap' | 'merge', a, b, from }])` returns a fixed copy (from = sample index). `trackThumbnails(media, res)` crops each track's largest face on a second `<video>`, so the preview playhead never moves.
  - Unit-testable in Node (no DOM at import): synthetic crossing/leave-and-return detections → `assignTracks` → check each person keeps one id.
- Draw debug overlays (landmarks, boxes) on a separate canvas stacked over the preview so no export can include them (Nametag's `#debug`).

## Speech (Whisper)
- Also used by the Audio category (Extractor, Waveform Video); see [audio/AGENTS.md](../audio/AGENTS.md).
- `lib/whisper.js` runs Whisper through transformers.js (`LIBS.transformers`, 4.2.0) inside `lib/whisper-worker.js`, a module worker, so the page stays responsive.
  - Models: `onnx-community/whisper-{tiny,base,small}_timestamped`. Only these exports include the alignment heads that word timestamps (`return_timestamps: 'word'`) need.
  - Device: `pickDevice('auto'|'webgpu'|'wasm')`. WebGPU loads an fp32 encoder (fp16 for small when `shader-f16` exists) plus a q4 decoder; WASM loads q8 for both. A failed WebGPU load falls back to WASM automatically.
  - WASM sessions need `graphOptimizationLevel: 'basic'`: onnxruntime's extended optimizations reject the q8 merged decoder ("Missing required scale … TransposeDQWeightsForMatMulNBits").
  - Downloads go to Cache Storage (`transformers-cache`, keyed by the Hugging Face URL), so each model downloads once. `modelBytes(model, device)` gives the size to show before downloading; `isCached` checks the cache, so the UI can say "Downloaded".
  - `decodeAudio(blob)` decodes the file's audio track to 16 kHz mono through an `OfflineAudioContext`. `splitAudio` cuts it into windows of up to 29 s at the quietest 50 ms, so words aren't split, and skips near-silent windows (Whisper invents text on silence).
  - `transcribe(audio, { model, device, language, onDownload, onProgress, onWords, signal })` returns `{ words: [{ text, start, end }], device }` with times in seconds. `onWords` streams each window as it finishes. Cancelling between windows keeps the words found so far. Cancelling during the download terminates the worker.
  - Language: transformers.js silently assumes English when no language is passed, so with `language: null` `transcribe` first runs `detectLanguage` (one decoder step after `<|startoftranscript|>`, softmax over the language tokens, on the first speech window) and reports it through `onLanguage(code, p)` and the result's `language`/`languageProb`. `task: 'translate'` outputs English.
  - `dropLoops` keeps at most two consecutive copies of a repeated 1–8 word phrase (Whisper tiny loops on unclear audio).

## Screen Showcase styling (`lib/showcase-frame.js`)
- Shared by Screen Showcase and Zoom on Click, so both tools offer the same backgrounds and frames.
- `backgroundSection()` and `frameSection({ frame, padding })` return `createControls` sections. They own these ids: `bg`, `bgColor`, `gradient`, `gAngle`, `blurAmount`, `frame`, `url`, `padding`, `radius`, `border`, `borderColor`, `shadow`, `shadowOpacity`. Don't reuse them for other controls.
- Drawing: `drawShowcaseBackground(ctx, media, W, H, k, s)` → `fitInFrame(media, W, H, k, s)` → `buildFrameCard(source, w, h, k, s, name)` → `drawCardShadow(ctx, card, r, tf, s, k, alpha)`.
- `source` can be any drawable. Zoom on Click passes its zoomed content canvas. `mediaOffset(s, k)` is where the media sits inside the card, used to map clicks.

## Passing files between tools (`lib/handoff.js`)
- `sendFile('<receiving tool id>', file, meta)` stores a File plus structured-cloneable metadata in IndexedDB (`toolbox-handoff`). The receiver calls `takeFile(id)` on load (it reads and deletes the entry) and passes the file to `dropzone.load(file)`.
- Each receiver has one slot; a newer send replaces it. Entries older than a day are ignored.
- Zoom on Click receives `{ width, height, clicks: [{ t, x, y }] }`: seconds, and pixels of the recording (or 0..1 fractions). A future Screen Recorder should send its recording and click log in this shape. The same JSON (or a bare array) can be imported as a file; `parseClickLog` also accepts `time`/`ms` and `{ events: [{ type: 'click' }] }`.

## Tools

### text-effects: animated titles
- Files: `text-effects/script.js`.
- Background (none/solid/gradient) or an uploaded video (the video drives the clock and audio is kept), then `drawAnimatedText(ctx, opts, t)`.
- Presets patch `anim` / `easing` / `family`; picking an `anim` sets `DEFAULT_EASING`.

### paper-effect: paper craft look
- Files: `script.js`, `textures.js` (`backgroundTexture`, `edgePath`, `tracePath`), `transitions.js` (`transformCard`, `ENTRANCES`, `EXITS`).
- Per frame: background → `buildCard()` (paper rim, torn/cut `edgePath`, media clip, overlay texture) → `transitionAt(t)` → `transformCard` → `drawImage` with shadow and stop-motion jitter.
- Transitions: fold/unfold splits the card at creases and draws each flap with `persp.draw` (back side = paper colour past 90°); crumple is a grid mesh drawn with `persp.drawMesh`. Both fall back to 2D when WebGL is missing. The composite is faded as a whole (`fadeWhole`) so stacked flaps don't show through each other.
- Stop-motion quantizes `t` to `fps` steps; "choppy" holds video frames in the `paper-hold` scratch canvas.

### screen-showcase: product-demo framing
- Files: `screen-showcase/script.js`; backgrounds, frames and the shadow come from `lib/showcase-frame.js` (shared with Zoom on Click).
- `buildFrameCard()` (media + browser/phone chrome, radius, border) → `motion(t)` (intro zoom, fade, pan, tilt) → `drawCardShadow` (projected polygon) → card via `persp.draw` when tilted, plain `drawImage` otherwise.
- Aspect presets come from `SIZES` (16:9, 9:16, 1:1, 4:5).

### text-behind-person: text and images between background and person
- Files: `script.js` (layers, panel, render, on-canvas editing, exports), `still-mask.js` (photo mask: edge snapping + brush), `style.css`. Video segmentation uses `lib/vision.js` and `lib/person-mask.js` (see Following people).
- Layers: `layers[]` of `{ type: 'text' | 'image', … }`, drawn in array order; `front: true` draws over the person. The panel edits the selected layer: `select()` copies its values into the panel (`LAYER_KEYS`), `onChange` writes them back. Text-only and image-only controls have their own ids (`anim`/`imgAnim`, `exitAnim`/`imgExit`, `imgWidth`); shared ids (position, rotation, opacity, timing) live in one section each, because duplicate ids break `createControls`. Image layers animate through `drawImageLayer` (same names as the text animations).
- Per frame: source → layers behind → person cut-out (`personAlpha`) → layers in front. "Show mask" tints the mask instead.
- Editing on the preview: `#handles` canvas over the preview (never exported) draws the selection box, corner (scale) and round (rotate, Shift snaps 15°) handles. Hit testing works on `layerBox()`, the layer's settled (un-animated) box.
- Photos: the canvas is the photo at full size (up to 4096 px long side), the transport is hidden, and the preview shows the settled state (no animation). `detectStill()` runs the high-quality multiclass model once in IMAGE mode. `still-mask.js` upscales the raw 256² mask to a working size (≤ 1536 px), snaps it to the photo with a grey guided filter ("Snap edges to the photo"), applies threshold/softness/polarity, then brush layers: out = (base ∪ add) − erase. Strokes are stored; undo/redo replay them. `full()` caches the feathered full-size mask by version.
- Photo exports: PNG = full-resolution still. GIF/video only when a layer has an entrance or exit animation; `beforeExport` sets `animating` (and shrinks the canvas to 1920 px for video), `afterExport` restores. "Play animation" plays once (`previewing`).
- Video: mask polarity is auto-detected (`looksLikePerson`); users can override it. Temporal smoothing applies to video only.
- `syncTimeRanges()` keeps every layer's "Start at" / "End at" within the clip, and "End at" follows the clip end (`endFollows`) until the user moves it.

### nametag: player nametags that follow every head
- Files: `script.js`, `pixel-font.js`, `style.css`.
- Flow: upload → `detectHeads` pass in a `progressModal` (reruns on detector, rate or resolution change, or when a manual count needs more faces than were detected) → `assignTracks` (reruns on people count) → `applyEdits` (swap/merge fixes) → `smoothTrack` per person (reruns on smoothing/hold/fade) → `render(t)` draws from `sampleTrack`. Exports are disabled until tracks exist.
- People: "Everyone" (auto count) or "Set a number" (1–10, largest faces). `people` (Map by track id) holds name, enabled and the optional own style (`pColor`, `pBg`, `pSize`, `pOffsetX/Y` override `textColor`, `bgOpacity`, `size`, `offsetX/Y`); `styleOf(p)` picks own or shared. The Name field edits the selected person (person 1 starts with the name typed before upload). Clicking a head or tag on the preview selects that person and focuses Name.
- Fixes: "Swap" / "Merge" with another person from the current frame on (`edits`, undoable). Thumbnails come from `trackThumbnails`.
- Overlap: "Keep tags apart" (`separateTags`) keeps the lowest tag and moves the others up past it (or below it when there's no room above).
- The `#debug` canvas is always shown: dashed outline on the selected tag (2+ people), plus per-track paths, boxes and ids when "Show tracking overlay" is on.
- `pixel-font.js`: an original 8-row bitmap font (rows 0–6 above the baseline, row 7 descenders). Characters it lacks are rasterized from the system font at 8 px and thresholded, so "Allow any text" stays blocky. Never bundle the game's font.
- Tag: `tagBitmap()` draws box + shadow + text at 1 px per tag pixel (cached); `drawTag` scales it with `imageSmoothingEnabled = false`, snapping to whole pixels when upright. Tag pixel size `u` = 5% of the head width × Size (fixed size uses the median head size). Offsets are in tag pixels, so they scale with the tag; dragging the tag on the preview edits them. `keepInFrame` slides the rotated box back inside the frame.
- Hide behind person: `mask.update(…, { smoothing: 0 })` once per frame (the mask covers everyone), then the person cut-out is drawn clipped to each tag's box (Tag only mode uses `destination-out` instead).
- Speed: each sampled frame costs one Face Landmarker run (plus Pose when people are missing). The modal warns on videos over 60 s and when 4+ people are in view; 15 / s and 720p/480p tracking resolution are the fixes.
- Output "Tag only" clears the video for a transparent tag (PNG/WebM/GIF).

### text-match-cut: keyword pinned while pages flicker
- Files: `script.js`, `pages.js`, `lang.js`, `style.css`.
- `pages.js`: `buildPage(template, seed, keyword, context, lang)` returns a display list (`ops`) plus `key` (the keyword's rect). `flow()` wraps text with `measureText` and keeps the keyword as one unbreakable token. There are six `TEMPLATES`; `textSource` generates filler text. Call `resetMeasurements()` after fonts load.
- `lang.js`: `LANGS` (`en`, `pt` = Brazilian Portuguese) holds everything a page says: filler sentences, keyword sentences and titles, names, places, dates, numbers and each template's labels (mastheads, menus, bylines, search tabs). Templates read it as `txt.L`, so no page text is hard-coded in `pages.js`. The "Page language" control (`s.lang`) is part of the page cache key. Portuguese subjects carry their number so verbs agree, and `KEY` never follows an article (no gender agreement needed). To add a language, copy `en`, translate every field, and add it to `LANGS` and `LANG_OPTIONS`.
- `script.js`:
  - Data: the `frames[]` model (`page` or `image` frames, `locked`); `delays()`/`rebuildTimeline()` map `t` to a frame index.
  - Drawing: `renderFrame()` = `drawContent` (page transformed so the keyword sits at the centre, highlight drawn after the text) → three blur levels masked by `maskEllipse` → texture → vignette. It redraws only when the frame index or `version` changes.
  - UI: filmstrip (lock, regenerate, remove) and the `markWord` dialog for user screenshots.
  - Exports: GIF (primary, its own `onGif` with per-page holds), video, PNG of the current frame, and a frames ZIP.
  - Shutter sound (Output → `shutter`, `shutterVolume`, `shutterPreview`): `shutter.mp3` (next to the script) is decoded once when the toggle turns on (that click also resumes the AudioContext). One stage `tick` listener plays the buffer whenever `frameAt(t)` changes, and each click cuts off the previous one. Preview: to the speakers, only while playing (scrubbing is silent). Video export: `getAudio` switches it to a `MediaStreamDestination` track; `afterExport` switches back. GIF/PNG/ZIP are silent. `hasAudio: () => false` hides the exporter's Audio toggle.

### transitions: cinematic transitions between clips
- Files: `script.js` (UI, video sync, export), `sequence.js` (timeline math, `drawClip`), `engine.js` (WebGL renderer + `GLSL_HEADER`), `gallery.js` (picker with live thumbnails), `samples.js` (demo/gallery frames), `transitions/*.js` (one per transition; `index.js` registry, `_common.js` param/2D helpers, `_text.js` text layout + masks).
- Model: `clips[]` (video trim in/out or image duration + Ken Burns, per-clip fit), `cuts[i]` between clips i and i+1, plus `intro`/`outro` slots that transition from/to a solid color. Slot = `{ type, duration, easing, bezier, params, slotColor }`; `type: 'cut'` means none.
- Overlap model (`buildTimeline`): a transition of length d starts d s before clip A ends and clip B starts then; d is capped at 45% of each neighbouring clip.
- Per frame `renderAt(ctx, t)`: `frameAt(tl, t)` → one clip via `drawClip`, or two side frames (`tr-side-A/B` scratch) → `engine.render`. Preview, PNG, WebM and GIF all call it. The preview plays `previewRange()`: the selected transition ±1 s, the selected clip, or the full sequence.
- Videos: the stage runs on the wall clock (`getVideo` is null); `syncVideos(t)` plays, pre-rolls (parks the next clip on `trimIn` 1.5 s early), drift-corrects (>0.25 s) and pauses each `<video>`, and crossfades their audio `level`. GIF export seeks instead (`seekClips`) so frames are exact.
- Engine: frames are prepared in 2D (fit/fill/blurred fill), uploaded as `uA`/`uB`, plus `uMask`; drawn on an offscreen WebGL canvas, then copied onto the 2D preview. No WebGL, or a shader that fails to compile → that transition's `draw2d`.
- Text transitions redraw their mask canvas every frame (crisp at any zoom). Zoom through text finds the thickest point of the chosen letter with a distance transform (`letterFocus`) and zooms until that stroke covers the frame (`coverScale`).

#### Add a transition
1. Create `transitions/transitions/<id>.js` exporting `{ id, name, category: 'scale'|'text'|'motion', description, duration, easing, maxDuration?, pickCenter?, params, presets, glsl, uniforms(P, env), mask?(P, env), draw2d(ctx, A, B, p, P, env) }`. `luma-fade.js` is the smallest example.
2. `glsl` defines `vec4 transition(vec2 uv)` (uv (0,0) = top-left). The header gives you `uA`, `uB`, `uMask`, `uProgress` (eased), `uRaw`, `uRes`, `uSeed`, and helpers `getA/getB` (mirrored edges), `getMask`, `zoomAt`, `rotateAt`, `dirBlur/zoomBlur/spinBlur`, `sdRoundBox`, `rand`, `fbm`, `luma`. `half` is a reserved word in GLSL ES.
3. `params` are `createControls` specs (helpers: `direction`, `axis`, `range`, `percent`, `seed`, `textParams`). Avoid ids `duration`, `easing`, `bezier`, `slotColor`. `uniforms` maps params to uniforms (numbers or 2–4 element arrays). `env` = `{ W, H, k, p, raw, duration, mask, refresh }`.
4. Import it in `transitions/index.js` and add it to `TRANSITIONS`. It then appears in the gallery and the editor.
5. Check the WebGL and 2D paths at p = 0, 0.5 and 1: p = 0 must look like A and p = 1 like B.

### shape-crop: crop media to a shape
- Files: `script.js` (UI, views, render, dragging, SVG export), `custom.js` (SVG sanitizing, PNG masks, raster cache, "My shapes" in localStorage), `shapes/*.js` (one file per built-in shape; `index.js` registry, `_geom.js` helpers), `style.css`.
- Model, all in source pixels: the shape box `{ x, y (centre), w, h, rot }`, optional `keys[]` (the same plus `t` in source seconds, linearly interpolated by `boxAt(t)`), the media offset `mt` + zoom. With keyframes, every edit goes to the keyframe at the playhead (`commitBox` adds one when needed).
- Views map that space onto a canvas: `{ cw, ch, sc, fx, fy }`. `resultView(t)` is the export (Fit shape: the largest bounding box over all keyframes, plus room for outline/shadow/feather, centred on the current box, so the size never changes mid-clip; Original frame; Custom size + padding). `editView()` is the whole source plus a margin.
- `composite(ctx, slot, view, t, edit)` is the only drawing path: media → background (transparent / colour / blurred, drawn wider than the frame so the blur doesn't fade) → cut-out layer (media `destination-in` mask, plus outline) → drawn with the shadow and the scale animation. `render(t)` draws the result into `#preview` (exported) and, in Edit view, the dimmed whole frame + handles into `#editor` (never exported). Exports switch to Result view in `beforeExport`.
- Masks: `buildMask` caches per slot (`'res'`, `'edit'`) on a key of view + box + animation + shape + feather/invert; it draws the hard shape (Path2D, or the custom raster), then feathers with `drawBlurred` and inverts with `destination-out`. Outlines: vector shapes stroke the path (clipped inside/outside); raster shapes dilate/erode the hard mask by stamping it on three rings (`rasterOutline`, cached with the mask). Invert swaps inside/outside.
- Custom shapes: `sanitizeSvg` parses with `DOMParser`, drops scripts, `foreignObject`, animation elements, `on*` attributes, `javascript:` values and external `href`/`url()`; normalizes `viewBox`/`width`/`height` and sets `preserveAspectRatio="none"`. One plain filled `<path>` with no transforms becomes a vector shape (`path: { d, rule, vb }`); anything else (text, groups, strokes) loads through `<img>` and its alpha is the mask (`rasterMask`, sizes bucketed to 64 px). PNG/WebP masks are downscaled to 1024 px; a fully opaque one uses brightness (`lum`).
- Animation (`animAt`): scale in/out scales the whole cut-out; reveal scales only the mask from 0; rotate spins the mask (duration = one turn).
- Exports: GIF pre-blends soft edges with the matte colour on the GPU (`matteEdges`) so the 1-bit alpha has no dark fringe. Video keeps alpha in Chromium WebM (VP9 alpha); elsewhere (`videoAlpha` false) a transparent background is recorded on the matte colour, with a warning. SVG (images only): the original file embedded once, clipped by a vector `clipPath` (or a white-on-clear `mask` image when feathered, inverted or a raster shape), with stroke, `feDropShadow` and background filters.

#### Add a built-in shape
1. Create `shape-crop/shapes/<id>.js` exporting `{ id, name, aspect?, params, path(w, h, p) }`. `path` returns SVG path data filling a w×h box with (0, 0) at the top-left; the tool turns it into a `Path2D`, the picker icon and the SVG export. `heart.js` and `diamond.js` are small examples.
2. `params` are `createControls` specs with local ids (the panel stores them as `<shape id>.<param id>`, shown only while the shape is selected). Add `seed: true` to a range for a Randomize button. `_geom.js` has `polygonD(points, cornerRadius)`, `smoothClosedD`, `fitPoints`, `circlePoints`, `ellipseD`, `roundRectD`, `regularShape(id, name, sides)` and the shared `roundingParam`.
3. `aspect` (w / h, usually 1) makes picking the shape snap the box to that ratio and lock it. Leave it out for shapes that stretch well.
4. Import it in `shapes/index.js` and add it to `SHAPES` (the order is the picker order).
5. Check it at extreme box ratios and with every param at its min and max; it must stay inside its box.

### auto-captions: speech to animated captions
- Files: `script.js` (UI, transcription flow, render), `style.css`. The line model (`lib/transcript.js`: retiming, pages, SRT/VTT) and `drawCaption` (`lib/captions.js`) are shared with the Audio tools.
- Flow: upload, then Transcribe. That runs `decodeAudio(fetch(media.url))`, downloads the model (shown in a `progressModal` phase), then calls `transcribe`; words stream into the transcript editor. `buildLines` groups words into lines, breaking on pauses over 0.7 s, sentence ends, 14 words or 7 s.
- Model: `lines = [{ id, words: [{ text, start, end }] }]`. A line is the unit the user edits. `pagesOf(line, maxWords)` splits it into balanced captions. `timeline()` sets each caption's `until`: it bridges short gaps so captions don't flicker, and lingers 0.6 s otherwise. `pageAt(pages, t)` finds the caption with a binary search.
- Editing keeps timing. `retime(snapshotWords, text)` matches tokens with an LCS. Matched words keep their times; new words split the span of the words they replace (or the gap they sit in) in proportion to their length. The snapshot is taken on focus, so every keystroke retimes against the original words. Enter splits the line at the cursor (`wordIndexAt`); Backspace at the start merges it into the line above.
- The transcript is saved in localStorage per file (`auto-captions:<name>:<size>`) and restored on upload.
- Styles: the presets (Karaoke, Pop-in, Classic, Bold short-form, Boxed word) only set panel values. The render reads `highlight` (`none|color|box|wipe`), `reveal` (`page|word`), `pop`, outline, shadow and background box. The current word stays highlighted until the next word starts. `offset` shifts every caption.
- Exports: video/GIF/PNG of the burned-in captions, plus SRT and VTT actions. Both files have one cue per on-screen caption, with uppercase applied; VTT adds inline word timestamps (`<00:00:01.200>`).

### background-remover: remove or replace the background
- Files: `script.js`. Uses `vision.js` and `person-mask.js` (see Following people).
- Per frame:
  1. Draw the background into a separate layer: transparent/matte, color, the source blurred (drawn wider than the frame so the edges stay sharp), an image, or a looping video, with optional darkening.
  2. Run the mask (`mask.update` with the user's temporal smoothing; smoothing is 0 for GIF).
  3. Build the person layer: the source, then a brightness match toward the background's average luminance (`ctx.filter`), a soft-light tint with the background's average color, then cut out with `destination-in`.
  4. Composite, then add the light wrap: the blurred background, masked to the person minus their blurred interior (an edge band), drawn with `screen`.
- Background video: `syncBgVideo(t)` plays it along while the stage plays (re-syncs when drift exceeds 0.3 s) and parks it on `t % duration` when paused. GIF export seeks it in `prepareFrame`.
- Transparent output keeps alpha in PNG, GIF (1-bit) and Chromium WebM. Elsewhere, video export records the matte color and warns.

### zoom-on-click: automatic zooms on screen recordings
- Files: `script.js` (UI, render, pointer editing, timeline strip), `camera.js` (keyframes, camera sampling, auto-suggest, click-log parsing), `style.css`.
- Points: `{ id, t, x, y (0..1), zoom, dur, hold, easing, source: 'click'|'manual'|'auto' }`. Sources:
  - Click log (`handoff.js` slot `zoom-on-click`, or an imported .json; duplicates are skipped).
  - Clicks on the preview at the playhead, mapped back through the current camera.
  - "Suggest zooms": `suggestZooms` seeks at 4 fps at 160 px and diffs luma. It keeps changes that are small and local (0.15–20% of pixels, bounding box under 45% of the frame) and the strongest one per 2 s.
- Camera (`buildKeyframes`):
  - Each move is centred on its click: it starts `dur/2` before `t` and arrives `dur/2` after. Every move takes at least `dur/2`, so near-simultaneous clicks glide instead of jumping.
  - A click whose move starts before the previous zoom-out would end (+ "Follow nearby clicks" seconds) joins the same session: the camera pans from point to point.
  - `cameraAt` interpolates the centre linearly and the zoom in log space, then `clampView` keeps the view inside the frame.
- Render: background → `fitInFrame` → zoomed content canvas → `buildFrameCard` → shadow → card.
  - Motion blur averages up to 24 camera samples across a shutter of up to 1/30 s, capped at a 3.5% smear so it stays subtle; the frame stays the same, only the view moves.
  - The click ring expands for 0.7 s at the click spot.
- Editing: markers (with zoom and time labels) are drawn on the `#marks` overlay canvas, never exported. Click to add, drag to move (the camera freezes during the drag), Delete removes the selected point. Result/Original switch; exports force Result.
- The timeline strip shows sessions as bars and points as dots.
- Points are saved in localStorage per file. With no upload, a built-in demo screenshot with two zooms plays.

### progress-overlay: progress bar, countdown and chapters
- Files: `script.js`, `style.css`.
- Works with no video (a solid or transparent stage, length slider, aspect presets) or over a video. "Overlay only" hides the video (it still drives the clock) for a transparent export, with a matte fallback.
- `p = (t − start) / (end − start)`. "Ends at" follows the clip end until the user moves it.
- Bar styles: line, rounded (track + pill fill), segmented (`segmentStops()`: chapter boundaries, or N equal parts), circle (in one of the 9 spots). Positions: top, bottom, or edges (one clockwise path from the top-left, dashed to `p × perimeter`). Glow and "empty instead of fill" options.
- Chapters `{ t, label }` are kept in localStorage (`progress-overlay:chapters`). They draw ticks on line/rounded bars and split the segmented bar. Labels: none, the current one, or all, each clipped to its own segment.
- Timer: counts down (rounding up, like a countdown should) or up, in five formats, with an optional label and pill. It can sit in any of the 9 spots or inside the circle, and moves clear of a bar on the same edge.

### retro: VHS, CRT, film, 8mm, dithering, ASCII
- Files: `script.js` (panel, presets, demo, VHS on-screen text, render), `engine.js` (multi-pass WebGL renderer + `HEADER`), `effects.js` (`EFFECTS` shaders + uniform mappers, `PALETTES`, `CHARSETS`, `buildAtlas`).
- Engine:
  - Uploads the frame (downscaled to output size first), then runs each enabled effect as a full-screen pass, ping-ponging between two FBOs. The last pass draws to the GL canvas, which is copied onto the 2D preview.
  - FBO passes use `uFlip = 0` and the final pass `uFlip = 1`, so uv (0,0) is always the top-left. Use `uv * uRes` for pixel positions, never `gl_FragCoord`.
  - Extra textures (the glyph atlas, the VHS text) re-upload only when their `version` changes. Select the texture unit before creating a texture, because unit 0 holds the pass input.
- Stacking: effects run in `EFFECTS` order when enabled: dither → ascii → film → mm8 → vhs → crt. Presets switch a stack on (VHS on a CRT, Terminal = mono ASCII + CRT).
- All noise comes from `uFrame = floor(t × 24)`, so preview, GIF and video match. Pixel-sized parameters scale by `uK`.
- Dither: Bayer 8×8 (recursive `bayer2`). Ramp palettes (dark → light) map by luma; "nearest" palettes (Retro PC 4, Fantasy console 16) map by weighted RGB distance. Palette names avoid brands.
- ASCII: `buildAtlas` renders the characters in Space Mono and sorts them by measured ink. Each cell samples five taps for its color.
- VHS: luma at the wobbled position plus chroma averaged over 6 taps to the left (bleed in YIQ), a moving tracking band, head-switching noise at the bottom, and noise. The camcorder text (PLAY, a clock counting up from the start time, the date; VT323) is drawn on a half-resolution canvas and composited inside the VHS pass, so it bleeds and wobbles, then gets curved by the CRT.
- Without WebGL the preview shows the original frame with a hint.

### speed-ramp: speed curve editor
- Files: `script.js` (UI, curve editor canvas, video sync, audio), `curve.js` (`speedAt`/`logSpeedAt`, `buildMap`, `PRESETS`), `style.css`.
- Curve: points `{ x: source s, v: log2 speed }` from −2 to 2 (0.25×–4×), eased with smoothstep (or linear) in log space, constant beyond the end points. `buildMap` integrates `1/speed` at 240 samples per second: `map.duration` is the new length, and `srcAt(τ)` and `outAt(x)` convert between output and source time.
- Editor: click to add a point on the curve (adding one never changes the speed by itself), drag to move (snaps to 1×, can't cross its neighbours), double-click or Delete removes. The selected point has a numeric speed field. Points are saved per file.
- Playback: the stage runs on output time (wall clock, `getVideo: () => null`). `syncVideo(τ)` sets `playbackRate = speed` and nudges it by up to ±20% to absorb drift, seeking only when drift exceeds 0.25 s; measured drift during export stays under 40 ms. When paused, it seeks to `srcAt(τ)` + 1 ms (remapped times land just under frame boundaries).
- Audio goes through `audioGraph(video).level`, so preview and export match:
  - Pitch-corrected: `preservesPitch`.
  - Pitch follows speed: `preservesPitch = false`.
  - Drop below or above thresholds: the level gain falls to 0 outside them.
  - Mute.
  - The graph is created on the first user gesture. The preview's sound toggle replaces the stage's mute button, which only appears when the stage owns a video.
- Frame-rate warning: `requestVideoFrameCallback` estimates the source fps (median of 20 frames). When the slowest speed is below 1×, the warning gives the effective fps there.
- Exports: video (real-time playback of the ramp), GIF (`prepareFrame` seeks each exact source frame), PNG.

## Performance
- Rendering at 1080–1920px is the cost centre. Rebuild only what changed: Text Match Cut caches pages by seed and font version, and Paper Effect caches textures.
- Reuse offscreen canvases with `scratch()` rather than creating canvases per frame.
- `ctx.filter = 'blur()'` is fast but missing in older Safari; `drawBlurred` falls back to downscale/upscale.
- Draw thumbnails in time-sliced batches (`requestAnimationFrame`, ~24 ms budget), as the filmstrip does.
- GIF size grows with resolution × frames: default to a reduced scale, show the estimate, and warn on long sequences (Transitions asks before > 180 frames).
- Transitions uploads two 1080p frames per transition frame; outside a transition it draws the clip straight to 2D and skips WebGL.
- Object URLs are revoked by `media.dispose()`; tool code that creates its own URLs must revoke them too.

## Ideas for future tools
- Face-following effects on `head-tracking.js` / `multi-track.js`: Auto Reframe (crop that follows the active person), speech bubbles, blur/pixelate faces, sticker hats, spotlight follow.
- Import SRT/VTT into Auto Captions (skip transcription), reusing `transcript.js`.
- Screen Recorder (`getDisplayMedia`) that logs clicks and hands recording + clicks to Zoom on Click via `handoff.js`.
- Picture-in-picture webcam bubble over a screen recording.
- Animated bar-chart race from CSV.
- Split-screen before/after comparison with a wipe.

## Checklist: new video tool
- [ ] Start from `_template/canvas-tool/`; keep `render(t)` the only drawing path.
- [ ] Scale sizes by `k`; cap output with `outputSize` or a `SIZES` preset.
- [ ] Seed all randomness; no `Math.random` inside `render`.
- [ ] Wire `createExportBar` so video, GIF and PNG all work; set `video`/`gif`/`png` only to disable them until there's something to export, and `hint` (+ `TRANSPARENT_HINT` when the background can be clear).
- [ ] Validate uploads with `createDropzone`/`loadMedia`; handle missing WebGL / MediaRecorder / canvas filter.
- [ ] Pin and lazy-load any CDN library; show a `toast` if it fails to load.
- [ ] Test: no console errors, all three exports download and the video/GIF have the correct duration (`ffprobe`), 390px layout has no sideways scroll, light and dark themes.
- [ ] Register in `assets/js/tools.js`, add a thumbnail, and add a section above.
