# Dev: category guide

Site-wide rules, shared modules and checklists: [root AGENTS.md](../AGENTS.md).

## Scope
- **Belongs here:** developer utilities that turn code or text into something else: testers, comparers, generators, previewers, optimizers. Everything runs in the browser; nothing pasted is uploaded.
- **Belongs elsewhere:** plain format conversion, encoding and hashing (Convert & Encode: Base64, encoders, hashes, JSON tools, colors, timestamps, case, QR). Don't duplicate them here; the hub links to them through the category's `related` list in `tools.js`.

## Hub
- `/dev/index.html` has `data-search`; tools are grouped by `section` (`Code & text`, `Web`, `Generate`).
- `related: [...]` on the category renders an "Also useful (in Convert & Encode)" section at the end of the hub, and those tools are included in the hub search (`site.js` → `renderCategory`).

## Shared layout and code
Every tool is input on the left, output on the right (`.io-grid`, stacks under 860px), recomputed live, with Copy and Download buttons. Options persist with `remember()`; the input text persists with `rememberInput()`. Generated secrets (passwords, keys) are never persisted.

| Module | Use it for |
| --- | --- |
| `assets/js/lib/editor.js` | `createEditor(el, { value, lang, readOnly, wrap, lineNumbers, placeholder, label, onChange })` → `{ value, setLang, setMarks, select, focus, el, ready }`. Shows a `<textarea>` at once, then swaps in CodeMirror 6 (same text, selection and API). `lang`: `json`, `html`, `xml`, `css` or `null`. `setMarks([{ from, to, class }])` highlights ranges (Regex Tester). Setting `value` doesn't fire `onChange`. If the CDN fails it stays a textarea (marks are ignored) and logs one warning. |
| `assets/js/lib/text-tool.js` | `remember`, `copyButton`, `downloadButton`, `actionButton`, `copyText`, `debounce`, `readText`, plus `rememberInput(key, fallback, max)` (debounced, skips texts over `max` chars, stored as `input:<key>`) and `dropFiles(el, onFiles)` (any element as a drop target; adds `.is-over`). |
| `styles.css` §14 | `.code-editor` (+ `--editor-min` / `--editor-max` heights), `.tok-*` syntax colors for both themes, `.dev-tabs` (a full-width `.segmented` that scrolls on phones), `.io-sub` (small section heading inside an `.io-panel`). |
| `assets/js/lib/cdn.js` | Every library below is pinned here and loaded on first use. |

## Libraries and when they load
| Library (`cdn.js` key) | Loaded when |
| --- | --- |
| CodeMirror 6 (`cmState`, `cmView`, `cmCommands`, `cmLanguage`, `cmHighlight` + `cmJson`/`cmHtml`/`cmXml`/`cmCss`) | Any page with a code input (Regex, Diff, SVG Optimizer, Meta Previewer), right after first paint; a language package only when that language is first used. Served by **esm.sh**, not jsDelivr: jsDelivr's `+esm` pins a different `@codemirror/state` inside each package, and two copies break CodeMirror ("Unrecognized extension value"). esm.sh's `?deps=` forces one copy; see the comment in `cdn.js` before bumping versions. |
| jsdiff (`diff`) | Diff Checker, first comparison. |
| croner + cronstrue (`croner`, `cronstrue`) | Cron Builder, first valid expression. |
| Faker (`faker`, one ES module per locale: `dist/locale/<code>.js`) | Fake Data Generator, first run, then once per locale chosen. |
| SVGO browser build (`svgo`) | SVG Optimizer, first optimization. |
| EFF long wordlist (`effWords`, JSON, CC BY 3.0) | Generators, first passphrase. |
| JSZip (`jszip`, through `downloadZip` in `image-io.js`) | SVG Optimizer "All (.zip)". |

## Tools

### regex: Regex Tester
- Files: `script.js` (UI), `explain.js` (parser + plain-English explanation), `patterns.js` (library), `worker.js` (matching).
- Matching runs in a worker with the `d` flag added for group positions; if it doesn't answer in 1.5 s the worker is terminated and recreated (runaway backtracking like `(a+)+$`). Up to 1000 matches come back; the editor highlights up to 3000 ranges (alternating colors per match, groups underlined).
- Errors come from the browser's own `RegExp`; `explain.js` only describes. Its parser handles groups (named, lookaround, `(?i:)` modifiers), classes (ranges, `\p{…}`, v-mode nesting), escapes, backreferences and quantifiers, and never throws: unknown input degrades to literal characters. Clicking an explanation row selects that part of the pattern; clicking a match selects it in the text.
- The replacement is computed in the same worker run (JS `String.replace` syntax).
- A library pattern replaces the test text only when the text is empty or still an untouched sample.

### diff: Diff Checker
- `diffLines` with a `comparator` that applies Ignore whitespace (collapse + trim) and Ignore case; both sides are then rebuilt from their own original lines, so ignored differences still show their real text. Removed+added blocks are paired row by row and get `diffWordsWithSpace` / `diffChars` highlights (skipped for lines over 4000 chars). jsdiff `timeout: 5000` guards huge inputs.
- JSON mode parses both sides (`parseJson`, line/column errors), sorts keys recursively and formats with 2 spaces before diffing.
- Unchanged runs fold to "⋯ N unchanged lines" with 3 lines of context (click to expand). Rendering stops at 20,000 rows; the patch always covers everything.
- The `.patch` is `createTwoFilesPatch` on the real (or JSON-formatted) texts, so it records whitespace/case changes even when they're ignored in the view. File names come from opened/dropped files.

### css: CSS Generators
- One page, five tabs. `script.js` is the shell; each tab module exports `{ id, label, mount({ controls, preview, output }) }`, keeps its own state in `localStorage` (`css-gen:<id>` via `util.js` `tabState`) and calls `output({ css, tailwind, note })`.
- `gradient.js` (stops editor: click the bar to add, drag a selected stop), `shadow.js` (layers), `glass.js` (sample scenes), `clip-path.js` (presets; drag points, click an edge to add, double-click/tap a point to remove; detected in `pointerdown` because each drag end re-renders), `bezier.js` (SVG graph with y from −0.6 to 1.6, race against a standard easing).
- Tailwind output targets **v4**: `bg-linear-*`, `bg-radial`, `bg-conic-*` with `from/via/to` for up to 3 stops, named scale steps when a value matches exactly (`rounded-2xl`, `backdrop-blur-lg`), arbitrary values otherwise (`shadow-[…]`, `[clip-path:…]`, `ease-[cubic-bezier(…)]`). `util.js` `twArb` turns spaces into underscores.
- Preset patches containing arrays (stops, layers) are cloned on every change, otherwise edits would mutate the preset.

### cron: Cron Expression Builder
- `cron.js`: `parseCron` (5 fields, or 6 with seconds first; names; `?`, `L`, `LW`, `nW`, `nL`, `n#k`; `@daily`-style macros and `@reboot`) throws a sentence naming the field and the problem. `forCroner` normalizes what croner rejects or reads differently: `?` → `*` (croner treats `?` as a restriction) and `5/10` → `5-59/10`. `FRI#L` is refused with a hint to write `5L` (cronstrue can't describe it).
- Description: cronstrue (`use24HourTimeFormat`). Next 10 runs: `new Cron(expr, { timezone }).nextRuns(10)` in the chosen IANA zone (default: the browser's). No runs means an impossible date (Feb 30). A note explains day-of-month OR weekday when both are set.
- The builder (`build`) writes expressions; typing goes back through `infer`, which recognises simple schedules (also with names like MON-FRI) and otherwise shows "Custom".

### fake-data: Fake Data Generator
- `fields.js` lists the field types (`gen(f, row, opts)`, TS and SQL types, option specs). `row.person()` gives one name per row so name, email and username agree.
- Repeatable: `faker.seed(seed)` before each run, everything goes through faker (no `Math.random`, no "now"-relative dates: birthdates use a fixed `refDate`). The empty-% roll is drawn before each value so changing it doesn't reshuffle other columns.
- Emails use `exampleEmail` (example.com/net/org), never real providers.
- Outputs: JSON (pretty, compact, NDJSON), CSV (`stringifyDelimited`), SQL (optional CREATE TABLE, one INSERT per 500 rows, ANSI or MySQL quoting), TypeScript (interface + typed array). Up to 10,000 rows; the box shows the first 1M characters.
- Lorem mode uses `faker.lorem` in the chosen locale (Latin for most, local words for a few, e.g. Japanese).

### svg-optimizer: SVG Optimizer
- SVGO 4 `preset-default` with per-plugin `overrides`, plus opt-in extras (`removeScripts` is on by default; `removeDimensions`, `removeViewBox`, `prefixIds`…). Toggles persist in `opts:svg-plugins`.
- Items: dropped files plus pasted code (the editor always shows the selected item's source and edits it). An untouched sample is dropped when real files arrive. Sizes are of the minified output; gzip size via `CompressionStream`.
- Outputs: Minified, Readable (a second SVGO pass with `pretty` and no plugins), Data URI (URL-encoded with single quotes, or Base64; optional `url()`), React (`convert.js`: DOMParser walk, camelCased attributes, `style` objects, `{...props}` on the root).
- Previews are `<img>` from blob URLs, so scripts inside an SVG never run; the source is never inserted into the page DOM.

### meta-preview: Meta Tag Previewer
- Input: pasted HTML (`DOMParser` gives an inert document: no scripts, no requests) or a form. Switching to the form carries over what was found. The UI explains why a live URL can't be fetched (CORS, no backend).
- `meta.js`: `extract` → `resolve` (each platform's fallback order: Google uses `<title>`/description; social cards use `og:*`; X uses `twitter:*` → `og:*`), `check` (title width measured in px like Google's 20px Arial, description length, missing tags, image: relative/http/SVG/data URI, loaded size and ratio vs 1200×630), `generate` (full tag set, attributes escaped).
- The image is loaded once with `new Image()` (no-referrer) to read its size; that's the only network request, and it goes to the URL the user gave.
- Preview cards are look-alikes drawn in HTML/CSS with each platform's light colors (Discord dark): no logos, platform names as plain labels.
- `sample-og.jpg` is a made-up 1200×630 image for the built-in sample (rendered from HTML; the sample site is `fernhollow.example`).

### generators: Password, UUID & API Key Generator
- `random.js`: `randInt(n)` uses `crypto.getRandomValues` with rejection sampling (no modulo bias). Passwords redraw until every selected set appears ("at least one of each"). Passphrases pick from the EFF long list (7776 words ≈ 12.9 bits each).
- UUID v4 is `crypto.randomUUID()`; v7 follows RFC 9562 (48-bit ms timestamp, version/variant bits, a 12-bit counter within the same millisecond so a batch sorts in order).
- API keys: prefix + N characters from hex, base62 or base64url.
- Strength = entropy of how it was generated (pool size × length, or words × log2 7776), not a pattern guesser; crack time assumes 10¹¹ guesses per second.
- Options persist; results are never stored. The UI says so.

## Known limitations
- **Regex:** JavaScript flavor only (no possessive quantifiers, atomic groups or PCRE verbs). Zero-length matches are listed but not highlighted in the text. Highlights need CodeMirror; the textarea fallback shows only the match list.
- **Diff:** line-based alignment (no move detection). Very different large files can hit the 5 s timeout.
- **CSS:** Tailwind classes are v4 syntax; v3 users need `bg-gradient-to-*` instead of `bg-linear-*`. Clip-path points are clamped to 0–100%.
- **Cron:** croner semantics (Vixie-style OR for day of month + weekday; seconds-first for 6 fields). Quartz-only syntax (year field, 1–7 weekdays) isn't supported.
- **Fake data:** faker's locales vary in coverage (some fall back to English for missing data). Changing the faker version changes seeded output.
- **SVG Optimizer:** very large or many files are optimized on the main thread and can pause the page briefly. The JSX output doesn't rewrite `<style>` selectors or IDs.
- **Meta previews:** approximations of each platform's layout, which change over time. Images on servers that block hotlinking may not load (the size check then can't run). No live URL fetching.
- **Generators:** strength assumes the value was generated here; it says nothing about reused or leaked passwords.

## Checklist: new tool in this category
- [ ] Copy `_template/tool/`; use `.io-grid` with input left and output right; persist options with `remember()` and input with `rememberInput()`.
- [ ] Code inputs use `createEditor()`; never insert user HTML/SVG into the page (use `DOMParser`, `<img>` or a sandboxed iframe).
- [ ] Libraries only through `cdn.js`, pinned and lazy; fail with a readable message.
- [ ] Give it a `section`, `tags` and a thumbnail; if it overlaps a Convert tool, link that one instead (category `related`).
- [ ] Test: no console errors, 390px with no sideways scroll, light and dark.
- [ ] Add a section above and the tool to the `.github/ISSUE_TEMPLATE/` dropdowns.
