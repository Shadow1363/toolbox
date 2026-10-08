# Audio: category guide

Site-wide rules, shared modules and checklists: [root AGENTS.md](../AGENTS.md).

## Scope
- **Belongs here:** tools whose input or output is sound: extract, trim, clean up, measure, transcribe, or turn audio into a video.
- **Belongs elsewhere:** visual effects on footage (Video Effects); plain one-shot format conversion with no editing (Convert & Encode → Universal File Converter, which has its own ffmpeg copy).

## Hub
- `/audio/index.html` lists the four tools; `related` in `tools.js` adds Auto Captions and the File Converter.

## Shared pipeline
`createAudioDrop` / `createFilePicker` → `loadAudio(WithProgress)` (AudioBuffer) → `createWaveform` + `createPlayer` → the tool builds the final AudioBuffer (`renderOffline`, `sliceBuffer`, `concatBuffers`) → `createAudioExport` encodes it.
- The buffer the player plays is the buffer that gets encoded, so exports match the preview. Live effects in the player (the Trimmer's fades) use `envelopeCurve`, the same 200 Hz gain curve the offline render applies.
- Decoding resamples to the shared `AudioContext` rate (usually 48 kHz; 44.1 kHz on some machines and in headless Chrome).
- Hand-offs: the Extractor sends a file with `sendFile('<tool id>', file, meta)`; Trimmer, Cleanup and Waveform Video call `takeFile('<own id>')` on load. `meta = { from, words?, language? }`; `words` are seconds relative to the sent file (Waveform Video turns them into captions).

## Shared code (`assets/js/lib/`)
| Module | Use it for |
| --- | --- |
| `audio-io.js` | `mediaKind(file)`, `AUDIO_ACCEPT`, `audioContext()` (one shared context), `decodeBytes`, `probeMedia(file)` (mediabunny: container, duration, audio tracks with codec/rate/channels/language), `probeAny` (+ ffmpeg banner fallback), `loadAudio(file, { track, fallback, onStatus, onProgress, signal })` → `{ buffer, method }`, `loadAudioWithProgress` (same, with a progress modal that opens only for slow loads; `fallback` on), `resample(buffer, rate, channels)`, `codecName`, `METHOD_LABEL`, `clock(t, decimals)`, `parseTime("1:23.5")`, `createAudioDrop(root, { label, onFile, onClear })` → `{ setFile(file, meta), clear }`. |
| `audio-waveform.js` | `createWaveform(root, { height, selectable, onSeek, onSelect(sel, { done }), onView, overlay(ctx, g), markers(), color(), selectionTone() })`. Zoom (buttons, Ctrl/⌘ + wheel, +/−), horizontal scroll (scrollbar, Shift + wheel, trackpad), playhead, click to seek (←/→ step), drag to select, drag the edges to resize, Esc clears. `setBuffer(buf, { keepView })`, `setTime(t, { follow })`, `selection` (get/set, silent), `setSelection`, `setView(start, span)`, `zoom`, `fit`, `zoomToSelection`, `redraw`. Peaks: min/max per 256 samples plus a 4096 level; closer zooms read raw samples. `g` in `overlay` gives `x(t)`, `t(x)`, `top`, `bottom`, `mid`, `W`, `H`. |
| `audio-player.js` | `createPlayer(root, { waveform, getBuffer, envelope, useEnvelope, onTime, onState })`: play/pause, back to start, position, **Loop selection** (loops the waveform's selection), Space and Home shortcuts (the last-used player owns them; ignored while typing). `refresh()` after the buffer or envelope changes (keeps playing from the same spot: A/B in Cleanup). `envelopeCurve(fn, t0, t1)`. |
| `audio-export.js` | `renderOffline(buffer, build, { start, end, sampleRate, channels })`, `makeBuffer`, `sliceBuffer`, `concatBuffers(list, { xfade })` (equal-power crossfades), `encodeWav(buffer, 16|24|32)`, `encodeMp3` (lamejs in a worker), `encodeAudio(buffer, { format: 'wav'|'mp3'|'ogg'|'webm', kbps, bits })` → `{ blob, ext, note }`, `estimateBytes`, `createAudioExport(root, { id, getBuffer, filename, info, extra, actions, enabled, hint })` → `{ refresh, state, settings(), encode(buffer, overrides, hooks) }`. `extra` adds formats with their own `run` (the Extractor's "Original"). Choices persist per `id`. |
| `ffmpeg.js` | `getFFmpeg`, `ffmpegRun(file, (input) => args, outName, { onStatus, onProgress, signal })` (input mounted with WORKERFS, not copied), `ffmpegProbe`, `parseStreams(log)`, `copyExtension(codec)`. |
| `whisper.js` | Shared with Auto Captions. `transcribe(audio, { model, device, language, task: 'transcribe'|'translate', onLanguage, … })` → `{ words, language, languageProb }`; `detectLanguage`; `languageName(code)`; `dropLoops` (removes Whisper's runaway repeats). transformers.js treats a missing language as English, so `transcribe` detects first when `language` is null. |
| `transcript.js`, `captions.js` | Moved from Auto Captions: line model (`buildLines`, `retime`, `timeline`, `pageAt`, `toSRT`, `toVTT`) and the caption renderer `drawCaption`. |
| `styles.css` §15 | `.audio-main`, `.audio-panel`, `.audio-panel-head`, `.audio-empty`, `.waveform*`, `.audio-player`, `.audio-export*`, `.audio-stats` / `.audio-stat`. |

## Libraries and when they load
| Library (`cdn.js` key) | Loaded when |
| --- | --- |
| mediabunny 1.61.3 (`mediabunny`) | Probing a file (Extractor), decoding a track the browser's decoder can't pick (second audio track, some MKV/MOV), Opus encoding for OGG/WebM, "Original" stream copy. ~700 KB. |
| lamejs 1.2.1 (`lamejs`) | First MP3 export, inside a classic blob worker (`importScripts`). |
| RNNoise, `@jitsi/rnnoise-wasm` 0.2.1 (`rnnoise`, `rnnoiseWasm`) | Cleanup, first time RNNoise is on (~120 KB). |
| ffmpeg.wasm 0.12 (`ffmpeg`, `ffmpegCore`, …) | Only as a fallback: a file nothing else can decode (AVI, odd codecs), or "Original" copy mediabunny can't remux. ~32 MB, cached. |
| transformers.js + Whisper weights | Transcribe (Extractor, Waveform Video). Size shown before downloading; cached in Cache Storage. |
| JSZip | Trimmer "Export parts (.zip)", Extractor "Download all (.zip)" (through `image-io.js` `downloadZip`). |
| Google Fonts | Waveform Video titles and captions (`fonts.js`). |

## Tools

### extractor: Audio Extractor + Transcript
- Files: `script.js` (queue, view, transcript editor, batch), `copy.js` (`copyAudioStream`: mediabunny `Conversion` remux, ffmpeg `-c:a copy` fallback), `formats.js` (`transcriptFile(kind, doc, { timestamps })`: TXT, SRT, VTT, JSON with word timings, Markdown), `style.css`.
- Queue items `{ file, status, progress, probe, track, buffer, method, transcript, out }`. Only the selected item keeps its AudioBuffer; batch runs decode → encode (or copy) → transcribe → release, one file at a time, then "Download all (.zip)".
- Decoding shows its method (browser, WebCodecs, ffmpeg). Multiple audio tracks: a picker appears; tracks after the first decode with WebCodecs or ffmpeg (`-map 0:a:N`).
- "Export only the selection" trims both re-encoded and copied audio (copies cut on packet boundaries). Transcripts always cover the whole file.
- Transcript: language dropdown in the panel header (auto-detect first, then pick a language to re-run), "Translate to English" (Whisper translate task), click a time to play from there, active line follows playback, search filters lines, edits re-time with `retime` and are saved in localStorage per file + track (`extractor:<name>:<size>:<track>`).
- Send to Trimmer / Cleanup / Waveform Video: sends the original file when the browser decoded it directly (track 1, no trim), otherwise a 16-bit WAV of the decoded (trimmed) audio, plus the transcript words.

### trimmer: Audio Trimmer + Fade
- Files: `script.js`, `style.css`.
- Model in source seconds: `sel`, `splits[]`, `off` (excluded part indices). `pieces()` (memoized per `version`) gives the source ranges of the result; `renderResult()` cuts them (`concatBuffers`, 10 ms crossfades) and applies fades in `renderOffline` with `envelopeCurve`. Results are cached by a settings key and concurrent calls share one render.
- Modes: Trim (keep or delete the selection, optional max length) and Split (S or the button adds a split at the playhead; parts can be excluded; export each part as a ZIP or the kept parts joined). Fades apply to the whole result, or to each part when exporting separately.
- Edit view plays the source with the result's gain (removed audio ducked to 20%); Result view plays and shows the rendered buffer.
- Shortcuts: `[` / `]` set the start/end at the playhead, `S` splits. Presets: ringtone 30 s / 40 s, clip 15 s, story 60 s (select from the playhead + gentle fades).

### waveform-video: Waveform Video
- Files: `script.js` (panel, layout, render, clip, captions), `viz.js` (`createAnalyzer`: mono mix + 2048-point FFT, `bands(t, n)` log-spaced 50 Hz–10 kHz with a +26 dB tilt, `wave(t, n)`, `level(t)`; `drawViz(ctx, style, levels, box, o)`, `symmetric`), `style.css`.
- Video-effects pipeline: `createStage` with an `<audio>` element as the clock (`getVideoOffset` = clip start) and `createExportBar` (WebM with sound, GIF, PNG). `makeAudio` uses the file itself, or a WAV of the decoded audio when `<audio>` can't play it.
- Levels are a pure function of t (smoothing averages earlier instants instead of keeping state), so every export matches the preview. With no file, a demo with synthetic levels plays.
- Styles: bars, mirrored bars, line, waveform (oscilloscope), circular (around the cover when there is one), dots. Layout: stacked (portrait/square) or side by side (wide), from `layoutFor(W, H)`; sizes scale by `k = min(W, H) / 1080`.
- Clip: drag on the waveform (files over 90 s start with the first minute selected). Captions: Whisper on the clip only, or words handed over from the Extractor; four styles reuse `drawCaption`.

### cleanup: Noise Reduction + Volume Normalizer
- Files: `script.js` (panel, processing chain, A/B, stats), `dsp.js` (`measureLoudness`: BS.1770-4 K-weighting with the −70 LUFS / −10 LU gates, matches ffmpeg `ebur128`; `gateMix`; `normalizeLimit`: gain + 5 ms lookahead limiter via a monotonic-deque min filter; `rnnoise`: 48 kHz, int16-scaled frames of 480, delay measured by cross-correlation and removed), `style.css`.
- Chain: RNNoise (fully wet, cached per file) mixed with the dry signal by Strength, optional gate → offline high-pass, EQ preset biquads and compressor preset (+ makeup) → measure → gain to the target LUFS + limiter at the peak ceiling. Each stage is skipped when off. Changes re-run after 250 ms; stale runs are dropped.
- Two waveforms with synced zoom/scroll and mirrored selections; A/B (button or `B`) swaps the player's buffer at the same position.

## Known limitations
- Everything lives in memory as 32-bit float: about 23 MB per stereo minute at 48 kHz, and Cleanup keeps a few copies. Files up to ~1 hour are fine on a desktop; longer ones may crash the tab (Cleanup warns past 45 minutes).
- `decodeAudioData` only reads the first audio track; other tracks need WebCodecs (mediabunny) or ffmpeg.
- OGG/WebM export is fast only where WebCodecs can encode Opus (Chromium, recent Firefox and Safari). Elsewhere MediaRecorder records it in real time and may produce the other container (Chromium records WebM only).
- MP3 is CBR. Sample rates other than 32/44.1/48 kHz are resampled to 44.1 kHz; more than two channels are downmixed.
- "Original" copies trim on packet boundaries (a few ms off) and may need ffmpeg (32 MB) for AVI or unusual codecs.
- Loudness is integrated LUFS with a sample-peak limiter, not true peak (inter-sample peaks can exceed the ceiling by a fraction of a dB).
- RNNoise is a speech model: it can make music sound watery; lower Strength or use the gate.
- Whisper tiny can hallucinate on unclear audio; `dropLoops` removes the worst repeats, but base or small are more accurate. Word timings in translate mode are approximate.
- Waveform Video's video export records in real time (keep the tab visible), as in Video Effects.

## Checklist: new audio tool
- [ ] Load with `loadAudioWithProgress` / `createAudioDrop`; show the waveform with `createWaveform` and play with `createPlayer`.
- [ ] Build the final audio from one function and play that same buffer (or the same `envelopeCurve`) so the export matches.
- [ ] Export through `createAudioExport` (WAV / MP3 / OGG / WebM); add an `extra` format only for something the encoders can't do.
- [ ] Lazy-load any new library through `cdn.js`; show download sizes before large ones.
- [ ] Accept hand-offs with `takeFile('<id>')` if other tools should send audio here, and add the tool to the Extractor's "Open in" list.
- [ ] Test: no console errors, exports have the expected duration (`ffprobe`), Space/selection/loop work, 390 px layout, light and dark themes.
- [ ] Register in `assets/js/tools.js`, add a thumbnail, add a section above and to the issue templates.
