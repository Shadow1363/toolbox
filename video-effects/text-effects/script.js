/* Text Effects — animated titles, standalone or over an uploaded video. */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar, TRANSPARENT_HINT } from '/assets/js/lib/exporter.js';
import { drawAnimatedText, ANIMATIONS, DEFAULT_EASING } from '/assets/js/lib/text-anim.js';
import { fontOptions, weightOptions, ensureFont } from '/assets/js/lib/fonts.js';
import { easingOptions } from '/assets/js/lib/easing.js';
import { linearGradient, outputSize } from '/assets/js/lib/canvas.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d', { alpha: true });
let media = null; // uploaded video (optional)

const ASPECTS = { '16:9': [16, 9], '9:16': [9, 16], '1:1': [1, 1], '4:5': [4, 5] };

/* ---------- Controls ---------- */
const presets = [
  { label: 'Typewriter', value: 'typewriter', patch: { anim: 'typewriter', easing: 'linear', duration: 1.8, family: 'Space Mono', weight: '700' } },
  { label: 'Fade & slide', value: 'slide-up', patch: { anim: 'slide-up', easing: 'easeOutQuint', duration: 0.9, family: 'Inter', weight: '900' } },
  { label: 'Pop', value: 'pop', patch: { anim: 'pop', easing: 'easeOutBack', duration: 0.6, family: 'Archivo Black', weight: '400' } },
  { label: 'Bounce', value: 'bounce', patch: { anim: 'bounce', easing: 'easeOutBounce', duration: 1.1, family: 'Anton', weight: '400' } },
  { label: 'Glitch', value: 'glitch', patch: { anim: 'glitch', easing: 'easeOut', duration: 1.4, family: 'Bebas Neue', weight: '400', color: '#ffffff' } },
  { label: 'Neon', value: 'neon', patch: { anim: 'neon', duration: 1.2, family: 'Pacifico', weight: '400', color: '#ffffff', glowColor: '#ff2fd1' } },
  { label: 'Word reveal', value: 'words', patch: { anim: 'words', easing: 'easeOut', duration: 1.6, family: 'Montserrat', weight: '900' } },
  { label: 'Title rise', value: 'rise', patch: { anim: 'rise', easing: 'easeOutQuint', duration: 1, family: 'Playfair Display', weight: '900' } },
];

const panel = createControls(document.getElementById('controls'), [
  { title: 'Animation', controls: [
    { id: 'preset', type: 'presets', label: 'Presets', value: 'slide-up', options: presets },
    { id: 'anim', type: 'select', label: 'Animation', value: 'slide-up', options: ANIMATIONS },
    { id: 'easing', type: 'select', label: 'Easing', value: 'easeOutQuint', options: easingOptions },
    { id: 'duration', type: 'range', label: 'Duration', min: 0.1, max: 5, step: 0.1, value: 0.9, unit: 's', decimals: 1 },
    { id: 'delay', type: 'range', label: 'Delay', min: 0, max: 5, step: 0.1, value: 0.3, unit: 's', decimals: 1 },
    { id: 'outDuration', type: 'range', label: 'Fade out at end', min: 0, max: 3, step: 0.1, value: 0.5, unit: 's', decimals: 1, hint: '0 keeps the text on screen until the end.' },
    { id: 'clip', type: 'range', label: 'Clip length', min: 1, max: 30, step: 0.5, value: 4, unit: 's', decimals: 1, showIf: () => !hasVideo() },
  ]},
  { title: 'Text', controls: [
    { id: 'text', type: 'textarea', label: 'Text', value: 'Make it move', rows: 2, hint: 'Use Enter for multiple lines.' },
    { id: 'family', type: 'select', label: 'Font', value: 'Inter', options: fontOptions },
    { id: 'weight', type: 'select', label: 'Weight', value: '900', options: weightOptions },
    { id: 'size', type: 'range', label: 'Size', min: 16, max: 400, value: 140, unit: 'px' },
    { id: 'color', type: 'color', label: 'Color', value: '#ffffff' },
    { id: 'glowColor', type: 'color', label: 'Glow color', value: '#ff2fd1', showIf: (s) => s.anim === 'neon' },
    { id: 'align', type: 'segmented', label: 'Align', value: 'center', options: [['left', 'Left'], ['center', 'Center'], ['right', 'Right']] },
    { id: 'uppercase', type: 'toggle', label: 'Uppercase', value: false },
    { id: 'letterSpacing', type: 'range', label: 'Letter spacing', min: -10, max: 40, value: 0, unit: 'px' },
    { id: 'lineHeight', type: 'range', label: 'Line height', min: 0.8, max: 2, step: 0.05, value: 1.1, decimals: 2 },
  ]},
  { title: 'Outline & shadow', controls: [
    { id: 'strokeWidth', type: 'range', label: 'Outline', min: 0, max: 20, value: 0, unit: 'px' },
    { id: 'strokeColor', type: 'color', label: 'Outline color', value: '#000000', showIf: (s) => s.strokeWidth > 0 },
    { id: 'shadow', type: 'toggle', label: 'Drop shadow', value: false },
    { id: 'shadowBlur', type: 'range', label: 'Shadow blur', min: 0, max: 80, value: 24, unit: 'px', showIf: (s) => s.shadow },
    { id: 'shadowY', type: 'range', label: 'Shadow offset', min: 0, max: 40, value: 6, unit: 'px', showIf: (s) => s.shadow },
    { id: 'shadowColor', type: 'color', label: 'Shadow color', value: '#000000', showIf: (s) => s.shadow },
  ]},
  { title: 'Position', controls: [
    { id: 'posX', type: 'range', label: 'Horizontal', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'posY', type: 'range', label: 'Vertical', min: 0, max: 100, value: 50, unit: '%' },
  ]},
  { title: 'Canvas', showIf: () => !hasVideo(), controls: [
    { id: 'aspect', type: 'segmented', label: 'Aspect ratio', value: '16:9', options: Object.keys(ASPECTS).map((k) => [k, k]) },
    { id: 'res', type: 'segmented', label: 'Resolution', value: '1080', options: [['720', '720p'], ['1080', '1080p']] },
    { id: 'bg', type: 'segmented', label: 'Background', value: 'gradient', options: [['transparent', 'None'], ['solid', 'Solid'], ['gradient', 'Gradient']] },
    { id: 'bgColor', type: 'color', label: 'Color', value: '#0f1220', showIf: (s) => s.bg === 'solid' },
    { id: 'bgSwatch', type: 'swatches', label: 'Gradient', value: 'violet', showIf: (s) => s.bg === 'gradient', options: [
      { label: 'Violet', value: 'violet', preview: 'linear-gradient(135deg,#2b1055,#7597de)', patch: { g1: '#2b1055', g2: '#7597de' } },
      { label: 'Sunset', value: 'sunset', preview: 'linear-gradient(135deg,#f83600,#f9d423)', patch: { g1: '#f83600', g2: '#f9d423' } },
      { label: 'Ocean', value: 'ocean', preview: 'linear-gradient(135deg,#0f2027,#2c5364)', patch: { g1: '#0f2027', g2: '#2c5364' } },
      { label: 'Candy', value: 'candy', preview: 'linear-gradient(135deg,#ff6a88,#ff99ac)', patch: { g1: '#ff6a88', g2: '#ff99ac' } },
      { label: 'Mint', value: 'mint', preview: 'linear-gradient(135deg,#11998e,#38ef7d)', patch: { g1: '#11998e', g2: '#38ef7d' } },
      { label: 'Night', value: 'night', preview: 'linear-gradient(135deg,#000000,#434343)', patch: { g1: '#000000', g2: '#434343' } },
    ]},
    { id: 'g1', type: 'color', label: 'From', value: '#2b1055', showIf: (s) => s.bg === 'gradient' },
    { id: 'g2', type: 'color', label: 'To', value: '#7597de', showIf: (s) => s.bg === 'gradient' },
    { id: 'gAngle', type: 'range', label: 'Angle', min: 0, max: 360, value: 135, unit: '°', showIf: (s) => s.bg === 'gradient' },
  ]},
], { onChange: (s, id) => {
  if (id === 'anim') panel.set({ easing: DEFAULT_EASING[s.anim] }, { silent: true });
  if (id === 'family' || id === 'weight' || id === 'preset') ensureFont(s.family, s.weight, () => stage.invalidate());
  resize();
  exportBar.refresh();
  stage.invalidate();
} });

const s = panel.state;
function hasVideo() { return media?.kind === 'video'; }

/* ---------- Upload (optional background video) ---------- */
createDropzone(document.getElementById('upload'), {
  accept: ['video'],
  label: 'Optional: drop a video to overlay the text on',
  onLoad: (m) => { media = m; afterMediaChange(); },
  onClear: () => { media = null; afterMediaChange(); },
});

function afterMediaChange() {
  panel.refresh();
  resize();
  stage.reset();
  exportBar.refresh();
}

/* ---------- Rendering ---------- */
function resize() {
  let w, h;
  if (hasVideo()) ({ w, h } = outputSize(media.width, media.height, 1920));
  else {
    const [aw, ah] = ASPECTS[s.aspect];
    const short = +s.res;
    ({ w, h } = aw >= ah ? { w: Math.round((short * aw) / ah / 2) * 2, h: short } : { w: short, h: Math.round((short * ah) / aw / 2) * 2 });
  }
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
  canvas.classList.toggle('checker', !hasVideo() && s.bg === 'transparent');
}

function render(t) {
  const W = canvas.width, H = canvas.height;
  const k = Math.min(W, H) / 1080; // sizes are authored for a 1080px short side
  ctx.clearRect(0, 0, W, H);

  if (hasVideo()) ctx.drawImage(media.el, 0, 0, W, H);
  else if (s.bg === 'solid') { ctx.fillStyle = s.bgColor; ctx.fillRect(0, 0, W, H); }
  else if (s.bg === 'gradient') { ctx.fillStyle = linearGradient(ctx, W, H, s.gAngle, [s.g1, s.g2]); ctx.fillRect(0, 0, W, H); }

  drawAnimatedText(ctx, {
    text: s.text, family: s.family, weight: s.weight, size: s.size * k, color: s.color, glowColor: s.glowColor,
    align: s.align, uppercase: s.uppercase, letterSpacing: s.letterSpacing * k, lineHeight: s.lineHeight,
    x: (s.posX / 100) * W, y: (s.posY / 100) * H,
    anim: s.anim, duration: s.duration, delay: s.delay, easing: s.easing,
    outDuration: s.outDuration, end: duration(),
    stroke: { width: s.strokeWidth * k, color: s.strokeColor },
    shadow: s.shadow ? { blur: s.shadowBlur * k, y: s.shadowY * k, color: s.shadowColor } : null,
  }, t);
}

const duration = () => (hasVideo() ? media.duration : s.clip);

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: duration,
  getVideo: () => (hasVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => `text-${s.anim}`,
  getVideo: () => (hasVideo() ? media.el : null),
  hint: () => (!hasVideo() && s.bg === 'transparent' ? TRANSPARENT_HINT : ''),
});

resize();
ensureFont(s.family, s.weight, () => stage.invalidate());
stage.play().catch(() => {});
