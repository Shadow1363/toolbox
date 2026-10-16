/*
 * Pop Out: the social media post frame (a generic photo-app layout, no real logos), shared with the
 * registry's pop-out effect.
 *
 *   const L = layoutPost(ctx, s, u, data);  // blocks in post units; u = canvas px per unit (post width = 1080 units)
 *   drawPost(ctx, L, s, x, y, u, data);     // everything except the media, frame top-left at (x, y)
 *   const r = mediaRect(L, x, y, u);        // where the media goes, in canvas px
 *
 * s = panel state (ids below); data = { counts: { views, likes, comments, reposts, shares }, avatar (drawable | null),
 * comments: [{ user, text }] }. Every element can be switched off; heights follow the content (caption wrapping,
 * comment count), so layoutPost is cached on its inputs by the caller.
 */
import { roundRectPath, scratch, supportsCanvasFilter } from '/assets/js/lib/canvas.js';
import { clamp } from '/assets/js/lib/easing.js';

export const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
export const ASPECTS = { '4:5': 1.25, '1:1': 1, '9:16': 16 / 9, '16:9': 9 / 16 };

export const THEMES = {
  dark: { bg: '#000000', text: '#f5f5f5', sub: '#a8a8a8', line: '#262626', blue: '#0095f6', button: '#262626', chip: '#121212' },
  light: { bg: '#ffffff', text: '#0f0f0f', sub: '#737373', line: '#dbdbdb', blue: '#0095f6', button: '#efefef', chip: '#fafafa' },
};

/** Default panel values for the post (also the registry effect's defaults). */
export const POST_DEFAULTS = {
  theme: 'dark', aspect: '4:5', postType: 'regular', ctaText: 'Learn more',
  showAppBar: true, pageTitle: 'Posts', showHeader: true, username: 'studio.nova', audio: 'Nova Lane · Original audio', showDots: true,
  caption: 'Hold it up so everyone can see 👀 New drop this Friday. Tell me what you think in the comments', captionPos: 'below', captionLines: 2,
  showCounts: true, views: 41500, likes: 41500, comments: 1204, reposts: 832, shares: 2900, showViews: false,
  showComments: true, dateText: '2 days ago', showDate: true,
};

/** 41500 → '41.5K', 1200000 → '1.2M', 999 → '999'. */
export function formatCount(n) {
  n = Math.max(0, Math.round(n));
  const short = (v, unit) => `${(Math.floor(v * 10) / 10).toFixed(v < 100 ? 1 : 0).replace(/\.0$/, '')}${unit}`;
  if (n < 1000) return String(n);
  if (n < 1e6) return short(n / 1e3, 'K');
  if (n < 1e9) return short(n / 1e6, 'M');
  return short(n / 1e9, 'B');
}

/* ---------- Icons (24-unit outlines, drawn with the theme's text colour) ---------- */
const ICONS = {
  heart: 'M12 20.6s-7.6-4.7-9.7-9.3C.8 7.8 3 4 6.7 4c2.2 0 3.7 1.3 5.3 3.2C13.6 5.3 15.1 4 17.3 4 21 4 23.2 7.8 21.7 11.3 19.6 15.9 12 20.6 12 20.6z',
  comment: 'M12 3a9 9 0 0 0-7.8 13.4L3 21l4.7-1.2A9 9 0 1 0 12 3z',
  repost: 'M17 2.5 20.5 6 17 9.5M3.5 11V9.5A3.5 3.5 0 0 1 7 6h13.5M7 21.5 3.5 18 7 14.5M20.5 13v1.5A3.5 3.5 0 0 1 17 18H3.5',
  send: 'M21.5 2.5 10.8 13.2M21.5 2.5l-6.7 19-4-8.3-8.3-4z',
  bookmark: 'M19 21.5l-7-5.2-7 5.2V3.5a1 1 0 0 1 1-1h12a1 1 0 0 1 1 1z',
  back: 'M20 12H4.5M11 4.5 3.5 12l7.5 7.5',
  note: 'M9 18V5.5l11-2V16M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3zM20 16a3 3 0 1 1-3-3 3 3 0 0 1 3 3z',
  chevron: 'M9 5.5 15.5 12 9 18.5',
  play: 'M7 4.5v15l12.5-7.5z',
};
const paths = {};
const iconPath = (name) => (paths[name] ||= new Path2D(ICONS[name]));

/** Draw a 24-unit icon at (x, y) (top-left), `size` px. fill: true for solid shapes (play). */
export function drawIcon(ctx, name, x, y, size, color, { fill = false, weight = 2 } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (fill) { ctx.fillStyle = color; ctx.fill(iconPath(name)); } else { ctx.strokeStyle = color; ctx.stroke(iconPath(name)); }
  ctx.restore();
}

function dots(ctx, cx, cy, r, gap, color) {
  ctx.fillStyle = color;
  for (const dx of [-gap, 0, gap]) { ctx.beginPath(); ctx.arc(cx + dx, cy, r, 0, Math.PI * 2); ctx.fill(); }
}

const font = (weight, px) => `${weight} ${px}px ${FONT}`;

/** Wrap `text` into lines of at most `max` px; the last allowed line ends with "… more" when cut. */
function wrap(ctx, text, max, lines, { prefix = '', more = 'more' } = {}) {
  const words = `${prefix ? `${prefix} ` : ''}${text}`.split(/\s+/).filter(Boolean);
  const out = [];
  let line = '';
  for (let i = 0; i < words.length; i++) {
    const next = line ? `${line} ${words[i]}` : words[i];
    if (ctx.measureText(next).width <= max || !line) { line = next; continue; }
    out.push(line);
    line = words[i];
  }
  if (line) out.push(line);
  if (!lines || out.length <= lines) return { lines: out, cut: false };
  const kept = out.slice(0, lines);
  let last = kept[lines - 1];
  const tail = `… ${more}`;
  while (last && ctx.measureText(`${last}${tail}`).width > max) last = last.split(' ').slice(0, -1).join(' ');
  kept[lines - 1] = last;
  return { lines: kept, cut: true };
}

/**
 * Lay out the post at scale u. Returns { total, blocks: [{ type, y, h, … }], media: { y, h } } in post units
 * (multiply by u for px). Text is measured at the final size, so call it again when u changes.
 */
export function layoutPost(ctx, s, u, data = {}) {
  const blocks = [];
  let y = 0;
  const push = (type, h, extra = {}) => { blocks.push({ type, y, h, ...extra }); y += h; };
  const textW = 1080 - 72;
  ctx.save();
  if (s.showAppBar) push('appbar', 112);
  if (s.showHeader) push('header', 136);
  const cap = (s.caption || '').trim();
  if (cap && s.captionPos === 'above') {
    ctx.font = font(400, 34 * u);
    const w = wrap(ctx, cap, textW * u, +s.captionLines || 0);
    push('caption', 22 + w.lines.length * 46 + 14, { lines: w.lines, cut: w.cut, above: true });
  }
  const mh = 1080 * (ASPECTS[s.aspect] || 1.25);
  push('media', mh);
  if (s.postType === 'sponsored') push('cta', 100);
  push('actions', 118);
  if (s.postType === 'boosted') push('boost', 104);
  if (cap && s.captionPos === 'below') {
    ctx.font = font(400, 34 * u);
    const w = wrap(ctx, cap, textW * u, +s.captionLines || 0, { prefix: s.username || '' });
    push('caption', 8 + w.lines.length * 46 + 10, { lines: w.lines, cut: w.cut, above: false });
  }
  const comments = s.showComments ? (data.comments || []).filter((c) => c.user || c.text) : [];
  if (s.showComments) {
    ctx.font = font(400, 32 * u);
    const rows = comments.map((c) => wrap(ctx, c.text || '', (textW - 70) * u, 2, { prefix: c.user || '', more: '' }).lines);
    const extra = Math.max(0, Math.round(data.counts?.comments ?? s.comments) - comments.length);
    const h = (comments.length ? 6 : 0) + rows.reduce((a, l) => a + l.length * 44 + 10, 0) + (extra > 0 ? 50 : 0);
    if (h > 0) push('comments', h + 6, { rows, extra, comments });
  }
  if (s.showDate && s.dateText) push('date', 58);
  push('pad', 18);
  ctx.restore();
  const media = blocks.find((b) => b.type === 'media');
  return { total: y, blocks, media: { y: media.y, h: media.h } };
}

export const mediaRect = (L, x, y, u) => ({ x, y: y + L.media.y * u, w: 1080 * u, h: L.media.h * u });

/** Bold username + regular text on one line (the comment/caption style). Returns the x where the text ends. */
function richLine(ctx, line, prefix, x, y, u, size) {
  if (prefix && line.startsWith(`${prefix} `)) {
    ctx.font = font(600, size * u);
    ctx.fillText(prefix, x, y);
    const w = ctx.measureText(`${prefix} `).width;
    ctx.font = font(400, size * u);
    const rest = line.slice(prefix.length + 1);
    ctx.fillText(rest, x + w, y);
    return x + w + ctx.measureText(rest).width;
  }
  ctx.font = font(prefix && line === prefix ? 600 : 400, size * u);
  ctx.fillText(line, x, y);
  return x + ctx.measureText(line).width;
}

/** Draw everything but the media. (x, y) = the post's top-left in px. */
export function drawPost(ctx, L, s, x, y, u, data = {}) {
  const th = THEMES[s.theme] || THEMES.dark;
  const counts = data.counts || s;
  const P = (v) => v * u;
  ctx.save();
  ctx.fillStyle = th.bg;
  ctx.fillRect(x, y, P(1080), P(L.total));
  ctx.textBaseline = 'middle';
  for (const b of L.blocks) {
    const top = y + P(b.y), mid = top + P(b.h) / 2;
    switch (b.type) {
      case 'appbar': {
        drawIcon(ctx, 'back', x + P(30), mid - P(26), P(52), th.text, { weight: 2.2 });
        ctx.fillStyle = th.text;
        ctx.font = font(700, P(38));
        ctx.textAlign = 'center';
        ctx.fillText(s.pageTitle || '', x + P(540), mid);
        ctx.textAlign = 'left';
        break;
      }
      case 'header': {
        const r = P(42), ax = x + P(36) + r;
        ctx.save();
        ctx.beginPath(); ctx.arc(ax, mid, r, 0, Math.PI * 2); ctx.closePath();
        if (data.avatar) {
          ctx.clip();
          const a = data.avatar, aw = a.naturalWidth || a.width, ah = a.naturalHeight || a.height;
          const sc = Math.max((2 * r) / aw, (2 * r) / ah);
          ctx.drawImage(a, ax - (aw * sc) / 2, mid - (ah * sc) / 2, aw * sc, ah * sc);
        } else {
          const g = ctx.createLinearGradient(ax - r, mid - r, ax + r, mid + r);
          g.addColorStop(0, '#7c6cff'); g.addColorStop(1, '#ff7aa8');
          ctx.fillStyle = g; ctx.fill();
          ctx.fillStyle = '#fff';
          ctx.font = font(700, r);
          ctx.textAlign = 'center';
          ctx.fillText((s.username || '?').replace(/[^a-z0-9]/gi, '').charAt(0).toUpperCase() || '?', ax, mid + P(2));
          ctx.textAlign = 'left';
        }
        ctx.restore();
        const tx = ax + r + P(22);
        const sub = s.postType === 'sponsored' ? 'Sponsored' : s.audio;
        ctx.fillStyle = th.text;
        ctx.font = font(600, P(34));
        ctx.fillText(s.username || '', tx, sub ? mid - P(19) : mid);
        if (sub) {
          ctx.fillStyle = th.sub;
          ctx.font = font(400, P(29));
          let sx = tx;
          if (s.postType !== 'sponsored') { drawIcon(ctx, 'note', sx, mid + P(19) - P(14), P(28), th.sub, { weight: 2.2 }); sx += P(36); }
          ctx.fillText(sub, sx, mid + P(20));
        }
        if (s.showDots) dots(ctx, x + P(1080 - 62), mid, P(5), P(15), th.text);
        break;
      }
      case 'caption': {
        ctx.fillStyle = th.text;
        b.lines.forEach((line, i) => {
          const ly = top + P(b.above ? 22 : 8) + P(46 * i + 23);
          const end = richLine(ctx, line, b.above || i ? '' : s.username, x + P(36), ly, u, 34);
          if (b.cut && i === b.lines.length - 1) {
            ctx.font = font(400, P(34));
            ctx.fillStyle = th.sub;
            ctx.fillText('… more', end, ly);
            ctx.fillStyle = th.text;
          }
        });
        break;
      }
      case 'cta': {
        ctx.fillStyle = th.blue;
        ctx.fillRect(x, top, P(1080), P(b.h));
        ctx.fillStyle = '#ffffff';
        ctx.font = font(600, P(34));
        ctx.fillText(s.ctaText || 'Learn more', x + P(36), mid);
        drawIcon(ctx, 'chevron', x + P(1080 - 80), mid - P(22), P(44), '#ffffff', { weight: 2.6 });
        break;
      }
      case 'actions': {
        const size = P(60), iy = mid - size / 2;
        let ix = x + P(30);
        const item = (name, count) => {
          drawIcon(ctx, name, ix, iy, size, th.text, { weight: 1.9 });
          ix += size + P(12);
          if (s.showCounts && count != null) {
            ctx.fillStyle = th.text;
            ctx.font = font(600, P(31));
            const txt = formatCount(count);
            ctx.fillText(txt, ix, mid + P(1));
            ix += ctx.measureText(txt).width + P(34);
          } else ix += P(22);
        };
        item('heart', counts.likes);
        item('comment', counts.comments);
        item('repost', counts.reposts);
        item('send', counts.shares);
        drawIcon(ctx, 'bookmark', x + P(1080 - 30 - 56), mid - P(28), P(56), th.text, { weight: 1.9 });
        break;
      }
      case 'boost': {
        ctx.fillStyle = th.text;
        ctx.font = font(600, P(31));
        ctx.fillText('View insights', x + P(36), mid);
        const bw = P(230), bh = P(64), bx = x + P(1080 - 36) - bw;
        ctx.beginPath(); roundRectPath(ctx, bx, mid - bh / 2, bw, bh, P(16));
        ctx.fillStyle = th.blue; ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'center';
        ctx.fillText('Boost post', bx + bw / 2, mid + P(1));
        ctx.textAlign = 'left';
        break;
      }
      case 'comments': {
        let cy = top + P(6);
        b.rows.forEach((lines, i) => {
          const c = b.comments[i];
          ctx.fillStyle = th.text;
          lines.forEach((line, j) => { richLine(ctx, line, j ? '' : c.user || '', x + P(36), cy + P(22 + 44 * j), u, 32); });
          drawIcon(ctx, 'heart', x + P(1080 - 36 - 30), cy + P(8), P(30), th.sub, { weight: 2.2 });
          cy += P(lines.length * 44 + 10);
        });
        if (b.extra > 0) {
          ctx.fillStyle = th.sub;
          ctx.font = font(400, P(31));
          ctx.fillText(b.comments.length ? `and ${formatCount(b.extra)} others commented` : `View all ${formatCount(b.extra)} comments`, x + P(36), cy + P(24));
        }
        break;
      }
      case 'date': {
        ctx.fillStyle = th.sub;
        ctx.font = font(400, P(26));
        ctx.fillText(s.dateText, x + P(36), mid);
        break;
      }
      default:
    }
  }
  ctx.restore();
}

/** Views count over the media's bottom-left corner (play icon + number), as on video posts. */
export function drawViews(ctx, r, u, views) {
  const P = (v) => v * u;
  ctx.save();
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = P(10);
  drawIcon(ctx, 'play', r.x + P(30), r.y + r.h - P(74), P(40), '#ffffff', { fill: true });
  ctx.fillStyle = '#ffffff';
  ctx.font = font(600, P(32));
  ctx.textBaseline = 'middle';
  ctx.fillText(formatCount(views), r.x + P(78), r.y + r.h - P(54));
  ctx.restore();
}

/* ---------- The pop ---------- */
/**
 * Alpha of the area the cut-out may cover: bands past each allowed edge that fade out at the limit. Not the media
 * rect itself: the media is drawn at the same rect there, so the cut-out would only add edge artefacts (masks lag
 * fast motion a little). The bands start 1 px inside the media so no seam shows at the edge.
 */
function regionMask(W, H, r0, reach, fade, edges, name) {
  const c = scratch(`${name}-region-${W}x${H}`, W, H);
  const x = c.getContext('2d');
  x.clearRect(0, 0, W, H);
  if (reach <= 0.5) return c;
  const r = { x: r0.x + 1, y: r0.y + 1, w: r0.w - 2, h: r0.h - 2 };
  reach += 1;
  const ramp = (g) => { g.addColorStop(0, '#fff'); g.addColorStop(clamp(1 - fade), '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)'); return g; };
  const left = edges.sides ? r.x - reach : r.x, right = edges.sides ? r.x + r.w + reach : r.x + r.w;
  if (edges.top) { x.fillStyle = ramp(x.createLinearGradient(0, r.y, 0, r.y - reach)); x.fillRect(left, r.y - reach, right - left, reach); }
  if (edges.bottom) { x.fillStyle = ramp(x.createLinearGradient(0, r.y + r.h, 0, r.y + r.h + reach)); x.fillRect(left, r.y + r.h, right - left, reach); }
  if (edges.sides) {
    // Side bands also cover the top/bottom bands' height; 'lighten' merges them in the corners.
    const top = edges.top ? r.y - reach : r.y, bottom = edges.bottom ? r.y + r.h + reach : r.y + r.h;
    x.save();
    x.globalCompositeOperation = 'lighten';
    for (const edge of [r.x, r.x + r.w]) {
      const dir = edge === r.x ? -1 : 1;
      x.fillStyle = ramp(x.createLinearGradient(edge, 0, edge + dir * reach, 0));
      x.fillRect(dir < 0 ? edge - reach : edge, top, reach, bottom - top);
    }
    x.restore();
  }
  return c;
}

/**
 * Where the source is drawn at pop amount p: `src` (the media's draw rect at rest) grown by 1 + (scale − 1)·p around
 * the subject's centre (`box`, 0..1 of the source; the media centre without one) and lifted by lift·k·p px, then grown
 * a little more if needed so it still covers the media rect `r` (no empty band appears inside the post).
 * The media inside the post AND the cut-out are both drawn at this rect, so they always line up: transforming only
 * the cut-out left a second, unmoved copy of the subject visible in the media behind it.
 */
export function popRect({ r, src, box, p, k, scale = 1, lift = 0 }) {
  const ax = box ? src.x + box.cx * src.w : src.x + src.w / 2;
  const ay = box ? src.y + box.cy * src.h : src.y + src.h / 2;
  const ly = ay - lift * k * p;
  let sc = Math.max(0.05, 1 + (scale - 1) * p);
  const need = [
    (ax - r.x) / (ax - src.x), (r.x + r.w - ax) / (src.x + src.w - ax),
    (ly - r.y) / (ay - src.y), (r.y + r.h - ly) / (src.y + src.h - ay),
  ].filter((v) => Number.isFinite(v) && v > 0);
  sc = Math.max(sc, ...need);
  return { x: ax + (src.x - ax) * sc, y: ly + (src.y - ay) * sc, w: src.w * sc, h: src.h * sc };
}

/**
 * Draw the subject cut out of `source` (drawn at `src`, normally popRect()) by `alpha` (a canvas over the same rect)
 * where it leaves the media rect `r`: up to `reach`·k·p past the allowed `edges`, over a drop shadow that only falls
 * outside the media. Draw the media at the same `src` (clipped to `r`) first; inside `r` it already shows the subject.
 */
export function drawPopped(ctx, { source, alpha, r, src, p, k, reach = 400, fade = 0.35, edges, shadow, name = 'pop' }) {
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const layer = scratch(`${name}-layer-${W}x${H}`, W, H);
  const lx = layer.getContext('2d');
  lx.globalCompositeOperation = 'source-over';
  lx.clearRect(0, 0, W, H);
  lx.drawImage(source, src.x, src.y, src.w, src.h);
  lx.globalCompositeOperation = 'destination-in';
  lx.drawImage(alpha, src.x, src.y, src.w, src.h);
  lx.globalCompositeOperation = 'destination-in';
  lx.drawImage(regionMask(W, H, r, reach * k * clamp(p, 0, 1.2), fade, edges, name), 0, 0);
  lx.globalCompositeOperation = 'source-over';
  if (shadow && shadow.opacity > 0) {
    const sh = scratch(`${name}-shadow-${W}x${H}`, W, H);
    const sx = sh.getContext('2d');
    sx.globalCompositeOperation = 'source-over';
    sx.clearRect(0, 0, W, H);
    sx.globalAlpha = shadow.opacity * clamp(p);
    if (supportsCanvasFilter) sx.filter = `blur(${shadow.blur * k}px) brightness(0)`;
    sx.drawImage(layer, 0, shadow.offset * k);
    sx.filter = 'none';
    sx.globalAlpha = 1;
    if (!supportsCanvasFilter) { sx.globalCompositeOperation = 'source-in'; sx.fillStyle = 'rgba(0,0,0,.5)'; sx.fillRect(0, 0, W, H); }
    sx.globalCompositeOperation = 'destination-out'; // only outside the media: on the post UI
    sx.fillRect(r.x, r.y, r.w, r.h);
    sx.globalCompositeOperation = 'source-over';
    ctx.drawImage(sh, 0, 0);
  }
  ctx.drawImage(layer, 0, 0);
}
