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
      "Place text behind the person in your video with AI segmentation.",
    thumbnail: "/assets/img/text-behind-person.svg",
    status: "beta",
    tags: ["segmentation", "mediapipe", "ai", "mask"],
  },
  {
    id: "nametag",
    category: "video-effects",
    name: "Nametag Tracker",
    description:
      "A blocky player nametag that floats above a person's head and follows them.",
    thumbnail: "/assets/img/nametag.svg",
    status: "new",
    tags: ["face tracking", "mediapipe", "pixel", "game", "username", "overlay"],
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
