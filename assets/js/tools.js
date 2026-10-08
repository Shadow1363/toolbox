/**
 * The single source of truth for everything listed on the site.
 *
 * Adding a tool:
 *   1. Add an entry to `tools` below.
 *   2. Create its folder (copy /_template/tool/) at the URL `toolUrl()` gives it:
 *        - with a category:    /<category>/<id>/index.html
 *        - without a category: /<id>/index.html   (e.g. /regex/, /format/)
 *   3. Drop a 16:10 thumbnail in /assets/img/ (SVG, PNG or WebP).
 *
 * Adding a category: add an entry to `categories` and create /<id>/index.html
 * (copy /video-effects/index.html and change data-category).
 *
 * Optional tool fields:
 *   status:  'new' | 'beta' | 'soon'   ('soon' renders a disabled card)
 *   tags:    extra words for search (home page and hub); list file formats here
 *   section: heading the tool is grouped under on its hub (category `sections` sets the order)
 *
 * Optional category fields:
 *   sections: hub headings, in order
 *   related:  ids of tools in other categories to link from this hub (and include in its search)
 */

export const categories = [
  {
    id: "video-effects",
    name: "Video Effects",
    description: "Animated text, paper looks, polished screen demos and more.",
    thumbnail: "/assets/img/video-effects.svg",
  },
  {
    id: "convert",
    name: "Convert & Encode",
    description: "Convert files and data between formats, encode, decode and hash.",
    thumbnail: "/assets/img/convert.svg",
    sections: ["Files", "Data", "Encoding", "Developer"],
  },
  {
    id: "image",
    name: "Image",
    description: "Mockups, code screenshots, social images, favicons, compression, palettes, whiteboards and pixel art.",
    thumbnail: "/assets/img/image.svg",
    sections: ["Create", "Optimize", "Draw"],
  },
  {
    id: "audio",
    name: "Audio",
    description: "Extract and transcribe audio, trim and fade, clean up noise and loudness, and turn clips into waveform videos.",
    thumbnail: "/assets/img/audio.svg",
    related: ["auto-captions", "file-converter"],
  },
  {
    id: "dev",
    name: "Dev",
    description: "Regex tester, diff checker, CSS generators, cron builder, fake data, SVG optimizer, meta tags and secure generators.",
    thumbnail: "/assets/img/dev.svg",
    sections: ["Code & text", "Web", "Generate"],
    related: ["json-tools", "encode-decode", "base64", "hash", "timestamp", "color", "case", "qr-code"],
  },
];

export const tools = [
  {
    id: "text-effects",
    category: "video-effects",
    name: "Text Effects",
    description: "Animated titles: typewriter, glitch, neon, pop and more.",
    thumbnail: "/assets/img/text-effects.svg",
    tags: ["typography", "title", "animation", "overlay"],
  },
  {
    id: "paper-effect",
    category: "video-effects",
    name: "Paper Effect",
    description:
      "Torn-paper edges, grain and stop-motion jitter for any media.",
    thumbnail: "/assets/img/paper-effect.svg",
    tags: ["craft", "texture", "collage", "stop motion"],
  },
  {
    id: "screen-showcase",
    category: "video-effects",
    name: "Screen Showcase",
    description: "Turn screen recordings into polished product demos.",
    thumbnail: "/assets/img/screen-showcase.svg",
    tags: ["mockup", "screenshot", "browser frame", "device", "3d"],
  },
  {
    id: "text-behind-person",
    category: "video-effects",
    name: "Text Behind Person",
    description:
      "Place text and images behind the person in a video or photo with AI segmentation.",
    thumbnail: "/assets/img/text-behind-person.svg",
    status: "beta",
    tags: ["segmentation", "mediapipe", "ai", "mask", "photo", "layers", "sticker", "logo"],
  },
  {
    id: "nametag",
    category: "video-effects",
    name: "Nametag Tracker",
    description:
      "Blocky player nametags that float above people's heads and follow them, one per person.",
    thumbnail: "/assets/img/nametag.svg",
    status: "new",
    tags: ["face tracking", "mediapipe", "pixel", "game", "username", "overlay", "multiple people"],
  },
  {
    id: "text-match-cut",
    category: "video-effects",
    name: "Text Match Cut",
    description:
      "Your word stays locked in place while pages flicker behind it. Export as GIF.",
    thumbnail: "/assets/img/text-match-cut.svg",
    tags: ["gif", "match cut", "newspaper", "highlight", "kinetic typography"],
  },
  {
    id: "transitions",
    category: "video-effects",
    name: "Cinematic Transitions",
    description:
      "Join clips with zoom-through text, whip pans, glitches, light leaks and more.",
    thumbnail: "/assets/img/transitions.svg",
    status: "new",
    tags: ["transition", "webgl", "zoom", "whip pan", "glitch", "light leak", "edit", "gif"],
  },
  {
    id: "shape-crop",
    category: "video-effects",
    name: "Shape Crop",
    description:
      "Crop a video or image to a circle, heart, star or your own SVG, with a transparent background.",
    thumbnail: "/assets/img/shape-crop.svg",
    status: "new",
    tags: ["crop", "mask", "circle", "heart", "star", "svg", "png", "transparent", "cutout", "shape", "keyframes", "gif"],
  },
  {
    id: "auto-captions",
    category: "video-effects",
    name: "Auto Captions",
    description:
      "Transcribe speech on your device and add word-by-word animated captions. Export video, SRT or VTT.",
    thumbnail: "/assets/img/auto-captions.svg",
    status: "new",
    tags: ["subtitles", "captions", "transcribe", "transcription", "whisper", "speech to text", "karaoke", "srt", "vtt", "ai"],
  },
  {
    id: "background-remover",
    category: "video-effects",
    name: "Background Remover",
    description:
      "Remove the background behind a person, or swap it for a color, blur, image or looping video.",
    thumbnail: "/assets/img/background-remover.svg",
    status: "new",
    tags: ["background", "remove background", "green screen", "chroma", "segmentation", "mediapipe", "ai", "transparent", "blur", "virtual background"],
  },
  {
    id: "zoom-on-click",
    category: "video-effects",
    name: "Zoom on Click",
    description:
      "Smooth automatic zooms on screen recordings: follow clicks, add your own points, or let it suggest them.",
    thumbnail: "/assets/img/zoom-on-click.svg",
    status: "new",
    tags: ["zoom", "screen recording", "screencast", "tutorial", "demo", "click", "cursor", "motion blur", "pan"],
  },
  {
    id: "progress-overlay",
    category: "video-effects",
    name: "Progress Overlay",
    description:
      "A progress bar or countdown timer over your video, with chapters. Export it alone on a transparent background.",
    thumbnail: "/assets/img/progress-overlay.svg",
    status: "new",
    tags: ["progress bar", "countdown", "timer", "count up", "chapters", "overlay", "transparent", "shorts", "reels"],
  },
  {
    id: "retro",
    category: "video-effects",
    name: "Retro Looks",
    description:
      "VHS, CRT, film grain, 8mm, dithering and ASCII art. Stack them; WebGL keeps it smooth at full resolution.",
    thumbnail: "/assets/img/retro.svg",
    status: "new",
    tags: ["vhs", "crt", "film grain", "8mm", "super 8", "dither", "1-bit", "pixel", "ascii", "scanlines", "vintage", "glitch", "webgl", "filter"],
  },
  {
    id: "speed-ramp",
    category: "video-effects",
    name: "Speed Ramp",
    description:
      "Draw a speed curve: slow motion and fast forward from 0.25× to 4× with smooth easing and pitch-corrected audio.",
    thumbnail: "/assets/img/speed-ramp.svg",
    status: "new",
    tags: ["speed", "slow motion", "slow-mo", "fast forward", "timelapse", "ramp", "time remap", "velocity", "edit"],
  },
  {
    id: "file-converter",
    category: "convert",
    section: "Files",
    name: "Universal File Converter",
    description: "Documents, spreadsheets, images, audio and video: drop files, pick a format, download.",
    thumbnail: "/assets/img/file-converter.svg",
    status: "new",
    tags: ["pdf", "docx", "word", "markdown", "md", "html", "txt", "text", "csv", "tsv", "json", "yaml", "xml", "xlsx", "excel", "spreadsheet",
      "png", "jpg", "jpeg", "webp", "bmp", "ico", "icon", "svg", "heic", "image", "mp4", "webm", "mov", "gif", "mp3", "wav", "ogg", "audio", "video", "zip"],
  },
  {
    id: "qr-code",
    category: "convert",
    section: "Files",
    name: "QR Code",
    description: "Turn text or a link into a QR code (PNG or SVG), or read one from an image.",
    thumbnail: "/assets/img/qr-code.svg",
    tags: ["qr", "barcode", "scan", "png", "svg", "link", "url", "wifi"],
  },
  {
    id: "json-tools",
    category: "convert",
    section: "Data",
    name: "JSON Tools",
    description: "Format, minify and validate JSON; convert to YAML, TOML or XML; generate TypeScript types.",
    thumbnail: "/assets/img/json-tools.svg",
    tags: ["json", "yaml", "yml", "toml", "xml", "typescript", "ts", "types", "interface", "format", "prettify", "minify", "validate", "lint"],
  },
  {
    id: "timestamp",
    category: "convert",
    section: "Data",
    name: "Timestamp Converter",
    description: "Unix time, ISO 8601 and human-readable dates, in any time zone.",
    thumbnail: "/assets/img/timestamp.svg",
    tags: ["unix", "epoch", "date", "time", "iso", "iso 8601", "utc", "time zone", "timezone", "milliseconds"],
  },
  {
    id: "base64",
    category: "convert",
    section: "Encoding",
    name: "Base64",
    description: "Text or files to Base64 and data URIs, and Base64 back to files with a preview.",
    thumbnail: "/assets/img/base64.svg",
    tags: ["base64", "base64url", "data uri", "data url", "encode", "decode", "image", "file"],
  },
  {
    id: "encode-decode",
    category: "convert",
    section: "Encoding",
    name: "Encode / Decode",
    description: "URL encoding, HTML entities, Unicode escapes, hex, binary and JWT decoding.",
    thumbnail: "/assets/img/encode-decode.svg",
    tags: ["url", "percent", "uri", "html entities", "escape", "unescape", "unicode", "hex", "binary", "jwt", "token", "encode", "decode"],
  },
  {
    id: "hash",
    category: "convert",
    section: "Encoding",
    name: "Hash Generator",
    description: "MD5, SHA-1, SHA-256 and SHA-512 checksums for text or files.",
    thumbnail: "/assets/img/hash.svg",
    tags: ["hash", "md5", "sha", "sha1", "sha-1", "sha256", "sha-256", "sha512", "sha-512", "checksum", "digest", "verify"],
  },
  {
    id: "color",
    category: "convert",
    section: "Developer",
    name: "Color Converter",
    description: "HEX, RGB, HSL and OKLCH with a picker, live preview and contrast check.",
    thumbnail: "/assets/img/color.svg",
    tags: ["color", "colour", "hex", "rgb", "hsl", "oklch", "css", "picker", "contrast"],
  },
  {
    id: "case",
    category: "convert",
    section: "Developer",
    name: "Case Converter",
    description: "camelCase, snake_case, kebab-case, PascalCase, Title Case, UPPER and lower.",
    thumbnail: "/assets/img/case.svg",
    tags: ["case", "camel", "camelcase", "snake", "snake_case", "kebab", "pascal", "title", "upper", "lower", "slug", "text"],
  },
  {
    id: "mockup",
    category: "image",
    section: "Create",
    name: "Mockup Generator",
    description: "Put screenshots into phone, tablet, laptop, monitor and browser frames, side by side.",
    thumbnail: "/assets/img/mockup.svg",
    status: "new",
    tags: ["mockup", "device", "frame", "phone", "tablet", "laptop", "monitor", "browser", "screenshot", "app store", "png", "transparent"],
  },
  {
    id: "code-screenshot",
    category: "image",
    section: "Create",
    name: "Code Screenshot",
    description: "Paste code and get a beautiful image with syntax highlighting, themes and a window frame.",
    thumbnail: "/assets/img/code-screenshot.svg",
    status: "new",
    tags: ["code", "snippet", "syntax highlighting", "carbon", "screenshot", "share", "png", "svg", "prism"],
  },
  {
    id: "social-image",
    category: "image",
    section: "Create",
    name: "Social Image Maker",
    description: "Thumbnails, Open Graph images, posts and banners at the right size, with a layered editor.",
    thumbnail: "/assets/img/social-image.svg",
    status: "new",
    tags: ["og image", "open graph", "thumbnail", "banner", "post", "story", "social media", "template", "editor", "1200x630", "png", "jpg"],
  },
  {
    id: "favicon",
    category: "image",
    section: "Create",
    name: "Favicon Generator",
    description: "Every favicon size from an image, an SVG or an emoji: ICO, PNGs, SVG, manifest and the HTML tags.",
    thumbnail: "/assets/img/favicon-generator.svg",
    status: "new",
    tags: ["favicon", "ico", "icon", "apple touch icon", "webmanifest", "manifest", "pwa", "emoji", "svg", "png", "zip"],
  },
  {
    id: "before-after",
    category: "image",
    section: "Create",
    name: "Before/After Slider",
    description: "Compare two images with a slider. Export a GIF, a video or embeddable HTML.",
    thumbnail: "/assets/img/before-after.svg",
    status: "new",
    tags: ["before after", "compare", "comparison", "slider", "wipe", "gif", "video", "embed", "html"],
  },
  {
    id: "compressor",
    category: "image",
    section: "Optimize",
    name: "Image Compressor",
    description: "Shrink many images at once: resize, convert to WebP, AVIF or JPG, compare and download a ZIP.",
    thumbnail: "/assets/img/compressor.svg",
    status: "new",
    tags: ["compress", "optimize", "resize", "shrink", "batch", "jpg", "jpeg", "png", "webp", "avif", "exif", "metadata", "zip"],
  },
  {
    id: "palette",
    category: "image",
    section: "Optimize",
    name: "Palette Extractor",
    description: "Pull the main colors out of an image, check their contrast and export CSS, Tailwind or JSON.",
    thumbnail: "/assets/img/palette.svg",
    status: "new",
    tags: ["palette", "color", "colour", "extract", "swatches", "k-means", "median cut", "contrast", "wcag", "css variables", "tailwind", "scss", "json"],
  },
  {
    id: "whiteboard",
    category: "image",
    section: "Draw",
    name: "Whiteboard",
    description: "An infinite canvas for sketching diagrams: shapes, connected arrows, sticky notes and a hand-drawn style.",
    thumbnail: "/assets/img/whiteboard.svg",
    status: "new",
    tags: ["whiteboard", "diagram", "sketch", "flowchart", "draw", "arrows", "sticky notes", "hand-drawn", "rough", "svg", "png", "infinite canvas"],
  },
  {
    id: "pixel-art",
    category: "image",
    section: "Draw",
    name: "Pixel Art Editor",
    description: "Draw sprites with layers and animation frames, then export a crisp PNG, sprite sheet or GIF.",
    thumbnail: "/assets/img/pixel-art.svg",
    status: "new",
    tags: ["pixel art", "sprite", "sprite sheet", "8-bit", "animation", "gif", "onion skin", "palette", "16x16", "32x32", "editor"],
  },
  {
    id: "regex",
    category: "dev",
    section: "Code & text",
    name: "Regex Tester",
    description: "Live match highlighting, capture groups, a plain-English explanation, replace preview and a pattern library.",
    thumbnail: "/assets/img/regex.svg",
    status: "new",
    tags: ["regex", "regexp", "regular expression", "pattern", "match", "replace", "capture group", "named group", "javascript", "explain", "test"],
  },
  {
    id: "diff",
    category: "dev",
    section: "Code & text",
    name: "Diff Checker",
    description: "Compare two texts or JSON files side by side or inline, with word-level highlights. Export a .patch.",
    thumbnail: "/assets/img/diff.svg",
    status: "new",
    tags: ["diff", "compare", "difference", "changes", "patch", "unified diff", "json", "text", "merge", "side by side"],
  },
  {
    id: "cron",
    category: "dev",
    section: "Code & text",
    name: "Cron Expression Builder",
    description: "Build or paste a cron schedule, read it in plain English and see the next runs in any time zone.",
    thumbnail: "/assets/img/cron.svg",
    status: "new",
    tags: ["cron", "crontab", "schedule", "job", "timer", "time zone", "timezone", "next run", "explain"],
  },
  {
    id: "css",
    category: "dev",
    section: "Web",
    name: "CSS Generators",
    description: "Gradients, box shadows, glassmorphism, clip-path shapes and cubic-bezier easings, with Tailwind classes.",
    thumbnail: "/assets/img/css.svg",
    status: "new",
    tags: ["css", "gradient", "linear-gradient", "radial", "conic", "box-shadow", "shadow", "neumorphism", "glassmorphism", "glass", "backdrop-filter", "clip-path", "polygon", "cubic-bezier", "easing", "animation", "tailwind"],
  },
  {
    id: "svg-optimizer",
    category: "dev",
    section: "Web",
    name: "SVG Optimizer",
    description: "Shrink SVG files with SVGO: batch, per-plugin toggles, before/after preview, data URI and React output.",
    thumbnail: "/assets/img/svg-optimizer.svg",
    status: "new",
    tags: ["svg", "svgo", "optimize", "minify", "compress", "icon", "data uri", "react", "jsx", "component", "zip"],
  },
  {
    id: "meta-preview",
    category: "dev",
    section: "Web",
    name: "Meta Tag Previewer",
    description: "See how a link looks in search results and social shares, catch missing tags and generate them.",
    thumbnail: "/assets/img/meta-preview.svg",
    status: "new",
    tags: ["meta tags", "open graph", "og", "og:image", "twitter card", "seo", "social", "link preview", "unfurl", "html"],
  },
  {
    id: "fake-data",
    category: "dev",
    section: "Generate",
    name: "Fake Data Generator",
    description: "Mock rows from a schema you build, as JSON, CSV, SQL or TypeScript, plus lorem ipsum. Seeded and repeatable.",
    thumbnail: "/assets/img/fake-data.svg",
    status: "new",
    tags: ["fake", "mock", "faker", "test data", "dummy", "seed", "json", "csv", "sql", "insert", "typescript", "lorem ipsum", "placeholder"],
  },
  {
    id: "generators",
    category: "dev",
    section: "Generate",
    name: "Password, UUID & API Key Generator",
    description: "Strong passwords and passphrases, UUID v4/v7 and API tokens from your browser's secure random generator.",
    thumbnail: "/assets/img/generators.svg",
    status: "new",
    tags: ["password", "passphrase", "diceware", "uuid", "guid", "v4", "v7", "api key", "token", "secret", "random", "strength", "bulk"],
  },
  {
    id: "extractor",
    category: "audio",
    name: "Audio Extractor + Transcript",
    description: "Pull the audio out of any video (MP4, MOV, MKV, AVI…), export WAV/MP3/OGG or the original stream, and transcribe it with Whisper.",
    thumbnail: "/assets/img/audio-extractor.svg",
    status: "new",
    tags: ["extract audio", "video to audio", "mp4 to mp3", "mkv", "avi", "mov", "m4a", "aac", "wav", "transcribe", "transcript", "speech to text", "whisper", "subtitles", "srt", "vtt", "translate", "batch", "zip"],
  },
  {
    id: "trimmer",
    category: "audio",
    name: "Audio Trimmer + Fade",
    description: "Cut audio on a waveform, fade in and out with a curve, split into parts, or make a 30-second ringtone.",
    thumbnail: "/assets/img/audio-trimmer.svg",
    status: "new",
    tags: ["trim", "cut", "crop audio", "fade in", "fade out", "split", "join", "ringtone", "clip", "mp3", "wav", "waveform"],
  },
  {
    id: "waveform-video",
    category: "audio",
    name: "Waveform Video",
    description: "Turn a podcast clip into a shareable video with an animated visualizer, cover art, titles and captions.",
    thumbnail: "/assets/img/waveform-video.svg",
    status: "new",
    tags: ["audiogram", "visualizer", "podcast", "spectrum", "bars", "music video", "cover art", "captions", "webm", "gif", "9:16", "reels"],
  },
  {
    id: "cleanup",
    category: "audio",
    name: "Noise Reduction + Normalizer",
    description: "Remove background noise from voice, cut rumble, add EQ and compression, and normalize to −16 or −14 LUFS.",
    thumbnail: "/assets/img/audio-cleanup.svg",
    status: "new",
    tags: ["denoise", "noise removal", "rnnoise", "noise gate", "high-pass", "rumble", "normalize", "loudness", "lufs", "podcast", "youtube", "compressor", "eq", "limiter", "volume"],
  },
];

/* ---------- helpers (used by site.js and tool pages) ---------- */

export const getCategory = (id) => categories.find((c) => c.id === id);
export const getTool = (id) => tools.find((t) => t.id === id);
export const toolsIn = (categoryId) =>
  tools.filter((t) => t.category === categoryId);
export const standaloneTools = () => tools.filter((t) => !t.category);
export const categoryUrl = (c) => `/${c.id}/`;
export const toolUrl = (t) =>
  t.category ? `/${t.category}/${t.id}/` : `/${t.id}/`;
