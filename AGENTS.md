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
  js/lib/                Shared modules (see below)
  img/                   16:10 card thumbnails (SVG) + favicon
_template/               Copy-paste starters: category/, tool/, canvas-tool/
<category>/index.html    Category hub, e.g. video-effects/
<category>/<tool>/       index.html + script.js (+ style.css, + tool-only modules)
```

## Routing and the registry
- Folder routing: `/<category>/<tool>/index.html` serves `/<category>/<tool>/`. A tool without a category lives at `/<tool>/` (e.g. a future `/regex/`).
- `assets/js/tools.js` is the single source of truth for what is listed.
  - `categories[]`: `{ id, name, description, thumbnail }`
  - `tools[]`: `{ id, category?, name, description, thumbnail, status?, tags? }`. `status` is `'new' | 'beta' | 'soon'` (`soon` renders a disabled card); `tags` feed home search.
  - Helpers: `getTool`, `getCategory`, `toolsIn`, `standaloneTools`, `toolUrl`, `categoryUrl`.
- `site.js` reads `<body data-tool="…">` or `<body data-category="…">` and fills placeholders:
  `#site-header`, `#site-footer`, `[data-tool-head]` (tool title + description from the registry), `[data-grid="home"]`, `[data-grid="category"]`, `[data-search]`.
  Names and descriptions live only in `tools.js`; pages never hard-code them (the `<title>`/meta tags are the one exception, for SEO).

## Shared code: reuse before writing
| Module (`assets/js/lib/`) | Use it for |
| --- | --- |
| `controls.js` | `createControls(root, sections, { onChange })`: declarative settings panel with a live `state`, `showIf`, presets, swatches |
| `upload.js` / `media.js` | `createDropzone(...)` and `loadMedia(file)`: drag-drop + picker, type/size validation, `MediaError` messages |
| `stage.js` | `createStage({ canvas, transport, render(t), getDuration, getVideo })`: preview loop + play/scrub/mute bar |
| `exporter.js` | `createExportBar(...)`, `recordStage`, `progressModal`, `exportPNG`, `TRANSPARENT_HINT` |
| `canvas.js` | `fit`, `outputSize`, `scratch`, `drawBlurred`, `roundRectPath`, `linearGradient` |
| `text-anim.js` | `drawAnimatedText` with entrance (`ANIMATIONS`) and exit (`EXIT_ANIMATIONS`) |
| `fonts.js` | `FONTS` list (Google Fonts, loaded on demand), `fontString`, `ensureFont` |
| `perspective.js` | WebGL quad (`draw`) and mesh (`drawMesh`) renderer for real 3D perspective |
| `paper-textures.js` | Cached grain / fiber / crumpled overlay textures |
| `easing.js`, `random.js` | Easings; seeded `rng`/`hash`/noise so preview and export match |
| `dom.js` | `h()` element builder, `icon()`, `toast()`, `downloadBlob`, `formatBytes`, `store` (safe localStorage) |
| `webm-duration.js` | Used by the exporter; writes duration into MediaRecorder WebM |

New helpers that two or more tools need go in `assets/js/lib/`; anything single-use stays in the tool folder.

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

## Add a category
1. Copy `_template/category/index.html` to `/<id>/index.html` and set `data-category="<id>"`, title and intro.
2. Add `{ id, name, description, thumbnail }` to `categories[]` in `tools.js`, plus a thumbnail.
3. Create `/<id>/AGENTS.md` (purpose, tool list, shared patterns) and `/<id>/CLAUDE.md` containing `@AGENTS.md`.
4. Link it in the index below.

## Conventions
- **Libraries:** CDN only, pinned to exact versions (jsDelivr preferred) and loaded lazily (dynamic `import()` or a script tag on first use). Current pins: `@mediapipe/tasks-vision@1.1.0`, `gifenc@1.0.3`, `jszip@3.10.1`. Fail gracefully with a `toast()` when the network is blocked.
- **Privacy:** no backend, no analytics, no uploads.
- **Names:** made-up names for generated sites, papers and people; no real brands or logos in UI, thumbnails or generated content.
- **Errors:** bad files go through `loadMedia` → `MediaError` → `toast(message, 'error')`. Feature-detect (`canRecord()`, `supportsCanvasFilter`, `createPerspective()` returning `null`) and show a hint instead of failing.
- **Responsive:** `.tool-layout > *` has `min-width: 0` so wide content scrolls inside its panel; keep it that way.

## Gotchas
- `createControls` evaluates every `showIf` while it builds the panel. Helpers a `showIf` calls must be hoisted `function` declarations, not `const` arrows declared later (TDZ error). `onChange` may reference objects created afterwards, because it only fires on input.
- Module top-level order matters: call render/init functions after the `const`s they use (`site.js` runs its init at the bottom for this reason).
- Canvas text measured before a web font loads uses fallback widths. Wait with `ensureFont(family, weight, cb)` or re-layout on `document.fonts` `loadingdone` (see Text Match Cut).
- `scratch(name, w, h)` canvases are shared by name and resize in place. Use a distinct name per size or use (e.g. `` `tmc-sharp-${W}x${H}` ``).
- Inside render code, use seeded `rng`/`hash`, never `Math.random`. Otherwise preview and export differ.

## Categories
- [Video Effects](video-effects/AGENTS.md): canvas effects for video, images and animated text.
