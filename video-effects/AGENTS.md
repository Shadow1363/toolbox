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
- `createExportBar(root, { stage, filename, getVideo, getAudio, hasAudio, video, gif, png, onGif, primary, hint, actions, beforeExport, afterExport })`.
  - `video`/`gif`/`png` enable each button (bool or function; disabled buttons stay visible, e.g. before an upload). `hint` may be a function. Call `exportBar.refresh()` when any of them would change.
  - `primary` picks the highlighted button (`'video'` by default; Text Match Cut uses `'gif'`). `actions` adds extra buttons after the three (Text Match Cut's ZIP, Shape Crop's SVG); an action's `show` (bool or function) hides it, re-checked on `refresh()`.
  - Multi-clip tools pass `getAudio: () => mixTrack(videos)` instead of `getVideo`.
  - `beforeExport(kind)`/`afterExport(kind)` run around video and built-in GIF exports (`kind` is `'video'` or `'gif'`); throw from `beforeExport` to refuse with a toast.
- **Video:** `recordStage` plays the stage once in real time and records `canvas.captureStream(30)` with MediaRecorder.
  - MIME is picked from VP9 → VP8 → WebM → MP4 (Safari records MP4). Bitrate scales with pixel count (4–20 Mbps).
  - `fixWebmDuration` patches the missing duration in Chrome WebM.
  - Audio: `audioGraph(video)` routes the element through Web Audio (once per element): source → `level` (clip volume/fades) → `monitor` (preview mute) → speakers, and `level` → recorder. After that, mute through `setPreviewMuted`, never `video.muted`.
  - The tab must stay visible: background tabs throttle `requestAnimationFrame` and the recording stalls.
- **Transparency:** clear the canvas and add the `checker` class to the preview. Full alpha survives in PNG and Chromium WebM; GIF keeps 1-bit alpha (hard edges). Show `TRANSPARENT_HINT`.
- **GIF, built in:** the GIF button opens a dialog (start/end range, fps 10–24, width 320–800 or full; frame count, size estimate, warning over 180 frames; choice saved in `localStorage`), then `recordStageGif` steps through the stage: seeks `getVideo()` to each frame, calls `stage.renderFrame(t)` (pauses the live loop), downscales and encodes, then `stage.release()`s and restores the playhead. Frames are exact, so it needs no real-time playback and works in any browser.
- **GIF, custom:** tools whose frames aren't a plain function of the stage clock pass `onGif(btn)` and encode themselves (Text Match Cut: per-page holds; Transitions: multi-clip seeking).
- **GIF encoding** (`lib/gif.js`): `gifenc` with a per-frame `quantize(256)` palette and a 4×4 Bayer dither before quantizing (prevents gradient banding). Frames with clear pixels switch to `rgba4444` + `oneBitAlpha`; spread `frameOptions(q)` into `writeFrame` to get the transparent index and `dispose: 2`. Delays are in 10 ms steps and at least 20 ms (browsers slow faster frames to 100 ms); `gifDelays(n, fps)` carries the rounding error forward so the GIF keeps time.
- **Frames ZIP:** JSZip, `frame-001.png…` plus `timing.csv`.
- Long jobs use `progressModal(title, onCancel, message)`, yield with `setTimeout(0)` between frames, and support cancel.

## Following people (MediaPipe)
Shared in `assets/js/lib/`; reuse these instead of loading MediaPipe again.
- `vision.js`: lazy-loads `@mediapipe/tasks-vision@1.1.0` (jsDelivr) once, with models from `storage.googleapis.com`; each task is cached and tries the GPU delegate, then CPU. All tasks run in VIDEO mode, and `nextTimestamp()` keeps timestamps strictly increasing even after seeking back.
  - Segmentation: `SEGMENT_MODELS` (square, landscape, multiclass), `segmentFrame` (copies the mask inside the callback, where it's valid), `looksLikePerson` (auto polarity).
  - Landmarks: `detectFace` (478 face-mesh points) and `detectPose` (33 body points with `visibility`), both normalized 0..1.
- `person-mask.js`: `createPersonMask(prefix)` → `update(segmenter, source, t, { model, smoothing, still })`, `full(W, H, { threshold, softness, polarity, feather })`; `drawPersonCutout(ctx, source, alpha)`. Temporal smoothing depends on frame order, so pass `smoothing: 0` when the export seeks frames (GIF) and must match the preview.
- `head-tracking.js`: track once, then draw from stored data so playback is smooth and exports match the preview.
  - `trackHead(media, { fps, mode: 'auto'|'face'|'body', onProgress, signal })` seeks every 1/fps s and stores `{ found, x, y, size, roll, via }` (y = top of head; size = head width / frame height). Face first (crown ≈ landmark 10 + 30% of the face height); body (ears, else shoulders) when the face is missing or tiny.
  - `smoothTrack(track, { strength, hold, fadeOut, fadeIn })`: holds the last position through gaps, fades after `hold`, splits into segments wherever the head was fully hidden (no gliding across the frame), and smooths each segment with a zero-lag forward + backward One Euro pass. Cheap, so rerun it on slider changes.
  - `sampleTrack(smooth, t)` interpolates between samples.
- Draw debug overlays (landmarks, boxes) on a separate canvas stacked over the preview so no export can include them (Nametag's `#debug`).

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
- Files: `screen-showcase/script.js`.
- `buildCard()` (media + browser/phone chrome, radius, border) → `motion(t)` (intro zoom, fade, pan, tilt) → shadow polygon from `projectPoint` → card via `persp.draw` when tilted, plain `drawImage` otherwise.
- Aspect presets come from `SIZES` (16:9, 9:16, 1:1, 4:5).

### text-behind-person: text between background and person
- Files: `script.js`. Segmentation and the mask pipeline come from `lib/vision.js` and `lib/person-mask.js` (see Following people).
- Per frame: video → text (`drawAnimatedText` with `exit`) → `mask.update` (live, with the user's temporal smoothing) → `mask.full` → `drawPersonCutout`. "Show mask" tints the mask instead.
- Mask polarity is auto-detected (`looksLikePerson`); users can override it.
- `syncTimeRanges()` keeps "Start at" / "End at" within the clip, and "End at" follows the clip end until the user moves it.

### nametag: player nametag that follows a head
- Files: `script.js`, `pixel-font.js`, `style.css`.
- Flow: upload → `trackHead` pass in a `progressModal` (reruns on detector or rate change) → `smoothTrack` (reruns on smoothing/hold/fade) → `render(t)` draws from `sampleTrack`. Exports are disabled until a track exists.
- `pixel-font.js`: an original 8-row bitmap font (rows 0–6 above the baseline, row 7 descenders). Characters it lacks are rasterized from the system font at 8 px and thresholded, so "Allow any text" stays blocky. Never bundle the game's font.
- Tag: `tagBitmap()` draws box + shadow + text at 1 px per tag pixel (cached); `drawTag` scales it with `imageSmoothingEnabled = false`, snapping to whole pixels when upright. Tag pixel size `u` = 5% of the head width × Size (fixed size uses the median head size). Offsets are in tag pixels, so they scale with the tag; dragging the tag on the preview edits them. `keepInFrame` slides the rotated box back inside the frame.
- Hide behind person: `mask.update(…, { smoothing: 0 })` live per frame, then the person cut-out is drawn clipped to the tag's box (Tag only mode uses `destination-out` instead).
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

## Performance
- Rendering at 1080–1920px is the cost centre. Rebuild only what changed: Text Match Cut caches pages by seed and font version, and Paper Effect caches textures.
- Reuse offscreen canvases with `scratch()` rather than creating canvases per frame.
- `ctx.filter = 'blur()'` is fast but missing in older Safari; `drawBlurred` falls back to downscale/upscale.
- Draw thumbnails in time-sliced batches (`requestAnimationFrame`, ~24 ms budget), as the filmstrip does.
- GIF size grows with resolution × frames: default to a reduced scale, show the estimate, and warn on long sequences (Transitions asks before > 180 frames).
- Transitions uploads two 1080p frames per transition frame; outside a transition it draws the clip straight to 2D and skips WebGL.
- Object URLs are revoked by `media.dispose()`; tool code that creates its own URLs must revoke them too.

## Ideas for future tools
- Face-following effects on `head-tracking.js`: speech bubbles, blur/pixelate a face, sticker hats, spotlight follow.
- Kinetic captions from an SRT/VTT file, using `text-anim.js`.
- Picture-in-picture webcam bubble over a screen recording.
- Glitch / VHS / film-grain filters for video (the Glitch and Light leak shaders are a starting point).
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
