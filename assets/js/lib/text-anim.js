/**
 * Animated text renderer shared by Text Effects and Text Behind Person.
 *
 *   drawAnimatedText(ctx, {
 *     text, family, weight, size, color, align: 'center'|'left'|'right',
 *     x, y,                     // anchor point (block centre) in canvas pixels
 *     lineHeight: 1.1, letterSpacing: 0, uppercase: false,
 *     anim: 'fade', duration: 1, delay: 0, easing: 'easeOut',
 *     outDuration: 0, end: Infinity,           // optional fade-out ending at `end`
 *     exit: { anim, easing, duration, end },   // optional exit animation finishing at `end` (EXIT_ANIMATIONS)
 *     stroke: { width, color }, shadow: { blur, color, x, y }, glowColor,
 *   }, t);
 */
import { ease, clamp, easings } from './easing.js';
import { hash } from './random.js';
import { fontString } from './fonts.js';
import { scratch } from './canvas.js';

export const ANIMATIONS = [
  ['none', 'None'],
  ['fade', 'Fade in'],
  ['slide-up', 'Slide up'],
  ['slide-left', 'Slide from left'],
  ['rise', 'Rise (masked reveal)'],
  ['pop', 'Pop'],
  ['bounce', 'Bounce drop'],
  ['typewriter', 'Typewriter'],
  ['words', 'Word by word'],
  ['glitch', 'Glitch'],
  ['neon', 'Glow / neon'],
];

/** Suggested easing per animation (used by presets). */
export const DEFAULT_EASING = {
  none: 'linear', fade: 'easeOut', 'slide-up': 'easeOutQuint', 'slide-left': 'easeOutQuint', rise: 'easeOutQuint',
  pop: 'easeOutBack', bounce: 'easeOutBounce', typewriter: 'linear', words: 'easeOut', glitch: 'easeOut', neon: 'linear',
};

/** Exit animations: 'stay' keeps the text on screen, 'cut' removes it instantly at `end`. */
export const EXIT_ANIMATIONS = [
  ['stay', 'None (stay on screen)'],
  ['cut', 'Cut'],
  ['fade', 'Fade out'],
  ['slide-up', 'Slide up'],
  ['slide-left', 'Slide to right'],
  ['rise', 'Sink (masked)'],
  ['pop', 'Shrink'],
  ['bounce', 'Fall away'],
  ['typewriter', 'Backspace'],
  ['words', 'Word by word'],
  ['glitch', 'Glitch'],
  ['neon', 'Flicker off'],
];

/** Suggested easing per exit animation (exits usually accelerate away). */
export const EXIT_EASING = {
  stay: 'linear', cut: 'linear', fade: 'easeIn', 'slide-up': 'easeIn', 'slide-left': 'easeIn', rise: 'easeIn',
  pop: 'easeIn', bounce: 'easeIn', typewriter: 'linear', words: 'easeIn', glitch: 'easeIn', neon: 'linear',
};

const hasLetterSpacing = 'letterSpacing' in CanvasRenderingContext2D.prototype;

/** Measure and lay out lines. Returns {lines:[{text,x,y,w}], width, height, lineH}. */
export function layoutText(ctx, o) {
  const text = o.uppercase ? o.text.toUpperCase() : o.text;
  ctx.font = fontString(o.family, o.weight, o.size, o.italic);
  if (hasLetterSpacing) ctx.letterSpacing = `${o.letterSpacing || 0}px`;
  const lineH = o.size * (o.lineHeight || 1.15);
  const raw = text.split('\n');
  const widths = raw.map((l) => ctx.measureText(l).width);
  const width = Math.max(0, ...widths);
  const height = lineH * raw.length;
  const top = o.y - height / 2;
  const lines = raw.map((l, i) => {
    const w = widths[i];
    const x = o.align === 'left' ? o.x - width / 2 : o.align === 'right' ? o.x + width / 2 - w : o.x - w / 2;
    return { text: l, x, y: top + lineH * (i + 0.5), w };
  });
  return { lines, width, height, lineH, top };
}

/** Draw one run of text, left-aligned at (x, y-middle), with stroke/shadow. */
function run(ctx, o, str, x, y) {
  if (!str) return;
  if (o.stroke?.width > 0) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.lineWidth = o.stroke.width * 2;
    ctx.strokeStyle = o.stroke.color;
    ctx.strokeText(str, x, y);
    ctx.restore();
    // Don't double the shadow on the fill.
    ctx.save(); ctx.shadowColor = 'transparent'; ctx.fillText(str, x, y); ctx.restore();
    return;
  }
  ctx.fillText(str, x, y);
}

function prepare(ctx, o) {
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = o.color;
  if (o.shadow?.blur > 0 || o.shadow?.x || o.shadow?.y) {
    ctx.shadowColor = o.shadow.color || 'rgba(0,0,0,.5)';
    ctx.shadowBlur = o.shadow.blur || 0;
    ctx.shadowOffsetX = o.shadow.x || 0;
    ctx.shadowOffsetY = o.shadow.y || 0;
  }
}

function drawLines(ctx, o, L) {
  for (const line of L.lines) run(ctx, o, line.text, line.x, line.y);
}

export function drawAnimatedText(ctx, o, t) {
  if (!o.text) return;
  const lt = t - (o.delay || 0);
  if (lt < 0 && o.anim !== 'none') return;

  // Which phase are we in? Entrance plays forward; the exit plays the chosen animation in reverse.
  let phase;
  const ex = o.exit;
  if (ex && ex.anim !== 'stay' && isFinite(ex.end)) {
    if (t >= ex.end) return;
    const exDur = ex.anim === 'cut' ? 0 : Math.max(0.01, ex.duration || 0.5);
    if (exDur > 0 && t >= ex.end - exDur) {
      const q = clamp((t - (ex.end - exDur)) / exDur);
      const exEase = ex.easing || EXIT_EASING[ex.anim] || 'easeIn';
      phase = { anim: ex.anim, p: 1 - q, dir: -1, curve: (x) => 1 - ease(exEase, 1 - x) };
    }
  }
  if (!phase) {
    const dur = Math.max(0.01, o.duration || 1);
    const inEase = o.easing || DEFAULT_EASING[o.anim];
    phase = { anim: o.anim, p: clamp(lt / dur), dir: 1, curve: (x) => ease(inEase, x) };
  }

  let outAlpha = 1;
  if (o.outDuration > 0 && isFinite(o.end)) outAlpha = clamp((o.end - t) / o.outDuration);
  if (outAlpha <= 0) return;

  ctx.save();
  ctx.globalAlpha *= outAlpha;
  const L = layoutText(ctx, o);
  prepare(ctx, o);
  drawPhase(ctx, o, L, phase, lt);
  ctx.restore();
}

/**
 * Draw one animation at progress phase.p (0 = hidden, 1 = fully shown).
 * phase.curve eases a progress value; phase.dir = -1 mirrors motion for exits,
 * so things leave in the direction they travel instead of rewinding.
 */
function drawPhase(ctx, o, L, { anim, p, dir, curve }, lt) {
  const e = curve(p);
  const cx = o.x, cy = o.y;

  switch (anim) {
    case 'none':
    case 'cut':
      drawLines(ctx, o, L);
      break;

    case 'fade':
      ctx.globalAlpha *= clamp(e);
      drawLines(ctx, o, L);
      break;

    case 'slide-up':
      ctx.globalAlpha *= clamp(p * 1.6);
      ctx.translate(0, (1 - e) * o.size * 0.9 * dir);
      drawLines(ctx, o, L);
      break;

    case 'slide-left':
      ctx.globalAlpha *= clamp(p * 1.6);
      ctx.translate(-(1 - e) * (L.width * 0.4 + o.size) * dir, 0);
      drawLines(ctx, o, L);
      break;

    case 'rise': {
      // Each line slides out of a clip box at its own baseline (classic title reveal).
      const stagger = 0.12, n = L.lines.length;
      L.lines.forEach((line, i) => {
        const lp = clamp(p * (1 + stagger * (n - 1)) - i * stagger);
        const le = curve(lp);
        ctx.save();
        ctx.beginPath();
        ctx.rect(line.x - o.size, line.y - L.lineH / 2 - o.size * 0.1, line.w + o.size * 2, L.lineH + o.size * 0.2);
        ctx.clip();
        ctx.translate(0, (1 - le) * L.lineH * 1.05 * dir);
        run(ctx, o, line.text, line.x, line.y);
        ctx.restore();
      });
      break;
    }

    case 'pop': {
      const s = Math.max(0, e);
      ctx.globalAlpha *= clamp(p * 4);
      ctx.translate(cx, cy); ctx.scale(s, s); ctx.translate(-cx, -cy);
      drawLines(ctx, o, L);
      break;
    }

    case 'bounce': {
      // Enter: drop in from above. Exit: fall away below.
      const travel = dir > 0 ? -(cy + L.height) : ctx.canvas.height - cy + L.height;
      ctx.translate(0, (1 - e) * travel);
      if (dir > 0) {
        const squash = p > 0.3 ? 1 - Math.sin(Math.min(1, (p - 0.3) / 0.7) * Math.PI * 3) * 0.06 * (1 - p) : 1;
        ctx.translate(cx, cy + L.height / 2); ctx.scale(2 - squash, squash); ctx.translate(-cx, -(cy + L.height / 2));
      }
      drawLines(ctx, o, L);
      break;
    }

    case 'typewriter': {
      const total = L.lines.reduce((n, l) => n + [...l.text].length, 0);
      let shown = Math.floor(e * total + 1e-6);
      let cursor = null;
      for (const line of L.lines) {
        const chars = [...line.text];
        const n = Math.min(chars.length, shown);
        const str = chars.slice(0, n).join('');
        run(ctx, o, str, line.x, line.y);
        if (shown <= chars.length && !cursor) cursor = { x: line.x + ctx.measureText(str).width, y: line.y };
        shown -= n;
      }
      if (!cursor) { const last = L.lines[L.lines.length - 1]; cursor = { x: last.x + last.w, y: last.y }; }
      const blinkOn = p < 1 || Math.floor(lt * 2) % 2 === 0;
      if (o.cursor !== false && blinkOn) {
        ctx.fillRect(cursor.x + o.size * 0.06, cursor.y - o.size * 0.42, Math.max(2, o.size * 0.07), o.size * 0.84);
      }
      break;
    }

    case 'words': {
      const words = [];
      for (const line of L.lines) {
        const parts = line.text.split(/(\s+)/);
        let x = line.x;
        for (const part of parts) {
          const w = ctx.measureText(part).width;
          if (part.trim()) words.push({ text: part, x, y: line.y });
          x += w;
        }
      }
      const n = words.length;
      const wd = n > 1 ? Math.min(0.6, 2.5 / n) : 1; // each word's share of the duration
      const step = n > 1 ? (1 - wd) / (n - 1) : 0;
      words.forEach((word, i) => {
        const wp = clamp((p - i * step) / wd);
        if (wp <= 0) return;
        const we = curve(wp);
        ctx.save();
        ctx.globalAlpha *= clamp(wp * 2);
        ctx.translate(0, (1 - we) * o.size * 0.5 * dir);
        run(ctx, o, word.text, word.x, word.y);
        ctx.restore();
      });
      break;
    }

    case 'glitch':
      drawGlitch(ctx, o, L, lt, p);
      break;

    case 'neon':
      drawNeon(ctx, o, L, lt, p);
      break;

    default:
      drawLines(ctx, o, L);
  }
}

/* Glitch: RGB split + horizontal slice displacement, strong during entry, occasional bursts after. */
function drawGlitch(ctx, o, L, lt, p) {
  const f = Math.floor(lt * 30);
  const burst = p >= 1 && hash(Math.floor(lt * 6), 7) > 0.82 ? 0.5 : 0;
  const amount = Math.max(1 - easings.easeOut(p), burst);
  if (p < 1 && hash(f, 1) < (1 - p) * 0.35) return; // flicker off during entry

  // Render text once into a scratch canvas the size of the target.
  const W = ctx.canvas.width, H = ctx.canvas.height;
  const off = scratch('glitch', W, H);
  const octx = off.getContext('2d');
  octx.setTransform(1, 0, 0, 1, 0, 0);
  octx.clearRect(0, 0, W, H);
  octx.font = ctx.font;
  if (hasLetterSpacing) octx.letterSpacing = ctx.letterSpacing;
  octx.textBaseline = 'middle';
  octx.fillStyle = o.color;
  for (const line of L.lines) run(octx, o, line.text, line.x, line.y);

  const shift = o.size * 0.08 * amount;
  if (amount > 0.01) {
    // Coloured ghosts behind the main text.
    const ghosts = [['#ff1f5a', -1], ['#1fe5ff', 1]];
    for (const [col, dir] of ghosts) {
      const g = scratch(`glitch-${dir}`, W, H);
      const gctx = g.getContext('2d');
      gctx.globalCompositeOperation = 'source-over';
      gctx.clearRect(0, 0, W, H);
      gctx.drawImage(off, 0, 0);
      gctx.globalCompositeOperation = 'source-in';
      gctx.fillStyle = col;
      gctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.shadowColor = 'transparent';
      ctx.globalAlpha *= 0.85;
      ctx.drawImage(g, dir * shift * (1 + hash(f, dir + 3)), (hash(f, dir + 9) - 0.5) * shift);
      ctx.restore();
    }
  }

  // Main text, with random horizontal slices displaced.
  ctx.save();
  ctx.shadowColor = 'transparent';
  const top = L.top - o.size * 0.3, bottom = L.top + L.height + o.size * 0.3;
  if (amount > 0.01) {
    let y = top;
    let i = 0;
    while (y < bottom) {
      const hgt = o.size * (0.05 + hash(f, i, 11) * 0.25);
      const dx = hash(f, i, 13) < 0.35 * amount + 0.1 ? (hash(f, i, 17) - 0.5) * o.size * 0.6 * amount : 0;
      const sy = Math.max(0, y), sh = Math.min(H - sy, hgt);
      if (sh > 0) ctx.drawImage(off, 0, sy, W, sh, dx, sy, W, sh);
      y += hgt; i++;
    }
  } else {
    ctx.drawImage(off, 0, 0);
  }
  ctx.restore();
}

/* Neon: layered glow, flickers on during entry, gentle hum afterwards. */
function drawNeon(ctx, o, L, lt, p) {
  const f = Math.floor(lt * 24);
  const glow = o.glowColor || o.color;
  let level = 1;
  if (p < 1) level = hash(f, 5) < 0.35 + p * 0.6 ? 1 : 0.12;
  else level = 0.92 + Math.sin(lt * 9) * 0.04 + (hash(f, 6) > 0.97 ? -0.4 : 0);

  ctx.save();
  ctx.globalAlpha *= level;
  ctx.shadowColor = glow;
  ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
  for (const blur of [o.size * 0.6, o.size * 0.3, o.size * 0.12]) {
    ctx.shadowBlur = blur;
    ctx.fillStyle = glow;
    for (const line of L.lines) ctx.fillText(line.text, line.x, line.y);
  }
  ctx.shadowBlur = o.size * 0.05;
  ctx.fillStyle = o.color;
  for (const line of L.lines) ctx.fillText(line.text, line.x, line.y);
  ctx.restore();
}
