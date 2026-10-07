# Video Effects: category guide

Site-wide rules, shared modules and checklists: [root AGENTS.md](../AGENTS.md).

## Scope
- **Belongs here:** canvas tools that take a video or image (or nothing) and output an animated or still visual: WebM/MP4, GIF, PNG.
- **Belongs elsewhere:** non-visual or text-in/text-out utilities (formatters, regex, converters) are standalone tools or another category.

## Shared pipeline
`createDropzone` → `media` → `createControls` state → `createStage({ render(t) })` → `createExportBar`.
- `render(t)` is the only drawing path. Preview, PNG and video export all call it, so the export is the preview.
- Clock: when `getVideo()` returns a `<video>`, its `currentTime` drives `t`; otherwise the stage uses the wall clock and loops over `getDuration()`.
- Scale convention: `k = Math.min(W, H) / 1080`. Sliders are authored for a 1080px short side, so multiply sizes by `k`.
- Output size: `outputSize(w, h, 1920)` caps the long side at 1920 with even dimensions (video encoders need them).
- Determinism: seed every random choice (`rng`, `hash(step, n)`) from stable inputs (frame/step index, a seed slider).
- After a settings change, call `stage.invalidate()`. After a media change, call `stage.reset()` and `exportBar.refresh()`.
- With no upload, tools draw a built-in demo (Paper Effect, Screen Showcase) under an `.preview-overlay.is-note` hint.

## Import
- `createDropzone(root, { accept: ['video', 'image'], label, limits, onLoad, onClear })` gives a drop zone plus file picker (one file). Text Match Cut has its own multi-file picker that still calls `loadMedia`.
- `loadMedia` detects the kind by MIME type, or by extension when `file.type` is empty. Limits come from `LIMITS` in `media.js` (video 1 GB, image 50 MB), overridable per call.
- Files load from `URL.createObjectURL`; `media.dispose()` revokes the URL, and the dropzone calls it when the file is replaced or cleared.
- Videos are `muted`, `playsInline`, `preload="auto"`. WebM files reporting `Infinity` duration get a seek-to-end fix. Undecodable codecs (HEVC `.mov` in Chrome/Firefox) produce a friendly error.

## Export
- `createExportBar(root, { stage, filename, getVideo, video, png, hint, videoLabel, actions, beforeExport, afterExport })`. `video`, `png` and `hint` may be functions; call `exportBar.refresh()` when they would change. `actions` adds extra buttons (Text Match Cut: GIF, ZIP).
- **Video:** `recordStage` plays the stage once in real time and records `canvas.captureStream(30)` with MediaRecorder.
  - MIME is picked from VP9 → VP8 → WebM → MP4 (Safari records MP4). Bitrate scales with pixel count (4–20 Mbps).
  - `fixWebmDuration` patches the missing duration in Chrome WebM.
  - Audio: `audioGraph(video)` routes the element through Web Audio (once per element). After that, mute through `setPreviewMuted`, never `video.muted`.
  - The tab must stay visible: background tabs throttle `requestAnimationFrame` and the recording stalls.
- **Transparency:** clear the canvas and add the `checker` class to the preview. Alpha survives only in Chromium WebM and in PNG; show `TRANSPARENT_HINT`.
- **GIF** (Text Match Cut only): `gifenc` with a per-frame `quantize(256)` palette, a 4×4 Bayer dither before quantizing (prevents gradient banding), delays rounded to 10 ms and at least 20 ms (browsers slow faster frames to 100 ms). Size is estimated by encoding two sample frames.
- **Frames ZIP:** JSZip, `frame-001.png…` plus `timing.csv`.
- Long jobs use `progressModal(title, onCancel, message)`, yield with `setTimeout(0)` between frames, and support cancel.

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
- Files: `script.js`, `segmenter.js`.
- `segmenter.js` lazy-loads `@mediapipe/tasks-vision@1.1.0` (jsDelivr) and models from `storage.googleapis.com` (`MODELS`: square, landscape, multiclass). It tries the GPU delegate first, then CPU.
- VIDEO mode needs strictly increasing timestamps, which `segmentFrame` guarantees even after seeking back. Masks are copied inside the callback because they're only valid there.
- Per frame: video → text (`drawAnimatedText` with `exit`) → person layer (video `destination-in` mask). The mask goes through `smoothstep` threshold/softness → temporal smoothing → upscale + `blur()` feather.
- `looksLikePerson` auto-detects mask polarity (centre vs edges); users can override it.
- `syncTimeRanges()` keeps "Start at" / "End at" within the clip, and "End at" follows the clip end until the user moves it.

### text-match-cut: keyword pinned while pages flicker
- Files: `script.js`, `pages.js`, `style.css`.
- `pages.js`: `buildPage(template, seed, keyword, context)` returns a display list (`ops`) plus `key` (the keyword's rect). `flow()` wraps text with `measureText` and keeps the keyword as one unbreakable token. There are six `TEMPLATES`; `textSource` generates filler text. Call `resetMeasurements()` after fonts load.
- `script.js`:
  - Data: the `frames[]` model (`page` or `image` frames, `locked`); `delays()`/`rebuildTimeline()` map `t` to a frame index.
  - Drawing: `renderFrame()` = `drawContent` (page transformed so the keyword sits at the centre, highlight drawn after the text) → three blur levels masked by `maskEllipse` → texture → vignette. It redraws only when the frame index or `version` changes.
  - UI: filmstrip (lock, regenerate, remove) and the `markWord` dialog for user screenshots.
  - Exports: GIF, ZIP and WebM.

## Performance
- Rendering at 1080–1920px is the cost centre. Rebuild only what changed: Text Match Cut caches pages by seed and font version, and Paper Effect caches textures.
- Reuse offscreen canvases with `scratch()` rather than creating canvases per frame.
- `ctx.filter = 'blur()'` is fast but missing in older Safari; `drawBlurred` falls back to downscale/upscale.
- Draw thumbnails in time-sliced batches (`requestAnimationFrame`, ~24 ms budget), as the filmstrip does.
- GIF size grows with resolution × frames: default to 50% scale, show the estimate, and keep frame counts ≤ 40.
- Object URLs are revoked by `media.dispose()`; tool code that creates its own URLs must revoke them too.

## Ideas for future tools
- Kinetic captions from an SRT/VTT file, using `text-anim.js`.
- Picture-in-picture webcam bubble over a screen recording.
- Glitch / VHS / film-grain filters for video.
- Animated bar-chart race from CSV.
- Split-screen before/after comparison with a wipe.

## Checklist: new video tool
- [ ] Start from `_template/canvas-tool/`; keep `render(t)` the only drawing path.
- [ ] Scale sizes by `k`; cap output with `outputSize` or a `SIZES` preset.
- [ ] Seed all randomness; no `Math.random` inside `render`.
- [ ] Wire `createExportBar`; set `video`/`png`/`hint` (+ `TRANSPARENT_HINT` when the background can be clear).
- [ ] Validate uploads with `createDropzone`/`loadMedia`; handle missing WebGL / MediaRecorder / canvas filter.
- [ ] Pin and lazy-load any CDN library; show a `toast` if it fails to load.
- [ ] Test: no console errors, export plays with correct duration (`ffprobe`), 390px layout has no sideways scroll, light and dark themes.
- [ ] Register in `assets/js/tools.js`, add a thumbnail, and add a section above.
