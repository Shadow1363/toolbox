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
