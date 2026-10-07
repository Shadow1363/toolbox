/**
 * Built-in sample frames: the demo clips shown before any upload, and the A/B pair
 * the gallery thumbnails animate between. Drawn once per size and cached.
 */
const cache = new Map();

export function sampleFrame(which, W, H) {
  const key = `${which}|${W}x${H}`;
  if (cache.has(key)) return cache.get(key);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  (which === 'A' ? drawA : drawB)(c.getContext('2d'), W, H, Math.min(W, H) / 1080);
  cache.set(key, c);
  return c;
}

/* A: a warm sunset with layered hills. */
function drawA(ctx, W, H, k) {
  const sky = ctx.createLinearGradient(0, 0, 0, H);
  sky.addColorStop(0, '#2b1055');
  sky.addColorStop(0.45, '#d4418e');
  sky.addColorStop(0.75, '#ff9a5a');
  sky.addColorStop(1, '#ffd27a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, H);
  const sun = ctx.createRadialGradient(W * 0.62, H * 0.62, 0, W * 0.62, H * 0.62, 260 * k);
  sun.addColorStop(0, '#fff6d8');
  sun.addColorStop(0.35, '#ffe08a');
  sun.addColorStop(1, 'rgba(255,200,120,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(0, 0, W, H);
  const hills = [['#7a2a6b', 0.7, 0.06], ['#4d1a55', 0.78, 0.09], ['#2a0f3a', 0.88, 0.05]];
  hills.forEach(([color, base, amp], j) => {
    ctx.beginPath();
    ctx.moveTo(0, H);
    for (let x = 0; x <= W; x += W / 60) {
      const y = H * base - Math.sin(x / W * Math.PI * (2 + j) + j * 1.7) * H * amp - Math.sin(x / W * 13 + j) * H * 0.012;
      ctx.lineTo(x, y);
    }
    ctx.lineTo(W, H);
    ctx.fillStyle = color;
    ctx.fill();
  });
  label(ctx, 'A', W, H, k, 'rgba(255,255,255,0.92)', '#2a0f3a');
}

/* B: a cool, graphic scene with stripes and rings. */
function drawB(ctx, W, H, k) {
  const bg = ctx.createLinearGradient(0, H, W, 0);
  bg.addColorStop(0, '#04263f');
  bg.addColorStop(0.55, '#0b6e99');
  bg.addColorStop(1, '#3fd2c7');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  ctx.save();
  ctx.globalAlpha = 0.14;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 26 * k;
  for (let x = -H; x < W + H; x += 90 * k) {
    ctx.beginPath(); ctx.moveTo(x, H); ctx.lineTo(x + H, 0); ctx.stroke();
  }
  ctx.restore();
  ctx.lineWidth = 34 * k;
  [[0.3, 0.42, 230, '#ffffff'], [0.3, 0.42, 150, '#ffd60a'], [0.74, 0.66, 120, '#ffffff']].forEach(([x, y, r, col]) => {
    ctx.beginPath(); ctx.arc(W * x, H * y, r * k, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.stroke();
  });
  ctx.fillStyle = '#ff5e7e';
  ctx.beginPath(); ctx.arc(W * 0.74, H * 0.66, 60 * k, 0, Math.PI * 2); ctx.fill();
  label(ctx, 'B', W, H, k, 'rgba(255,255,255,0.92)', '#04263f');
}

function label(ctx, text, W, H, k, bg, fg) {
  const s = 120 * k;
  ctx.fillStyle = bg;
  ctx.beginPath();
  ctx.roundRect ? ctx.roundRect(40 * k, 40 * k, s, s, 24 * k) : ctx.rect(40 * k, 40 * k, s, s);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.font = `800 ${Math.round(84 * k)}px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 40 * k + s / 2, 40 * k + s / 2 + 4 * k);
}
