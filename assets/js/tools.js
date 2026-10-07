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
 *   status: 'new' | 'beta' | 'soon'   ('soon' renders a disabled card)
 *   tags:   extra words for the home-page search
 */

export const categories = [
  {
    id: "video-effects",
    name: "Video Effects",
    description: "Animated text, paper looks, polished screen demos and more.",
    thumbnail: "/assets/img/video-effects.svg",
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
