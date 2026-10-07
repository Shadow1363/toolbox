/*
 * Canvas/video tool template: upload → controls → live preview → export.
 * Copy this folder to /<category>/<tool-id>/, register the tool in /assets/js/tools.js,
 * and set data-tool="<tool-id>" on <body> in index.html.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { createDropzone } from '/assets/js/lib/upload.js';
import { createStage } from '/assets/js/lib/stage.js';
import { createExportBar } from '/assets/js/lib/exporter.js';
import { fit, outputSize } from '/assets/js/lib/canvas.js';

const canvas = document.getElementById('preview');
const ctx = canvas.getContext('2d');
let media = null;
const isVideo = () => media?.kind === 'video';

const panel = createControls(document.getElementById('controls'), [
  { title: 'Effect', controls: [
    { id: 'amount', type: 'range', label: 'Amount', min: 0, max: 100, value: 50, unit: '%' },
    { id: 'color', type: 'color', label: 'Tint', value: '#7c6cff' },
    { id: 'clip', type: 'range', label: 'Clip length (images)', min: 1, max: 20, value: 5, unit: 's', showIf: () => !isVideo() },
  ]},
], { onChange: () => stage.invalidate() });
const s = panel.state;

createDropzone(document.getElementById('upload'), {
  accept: ['video', 'image'],
  onLoad: (m) => {
    media = m;
    const { w, h } = outputSize(m.width, m.height, 1920);
    canvas.width = w; canvas.height = h;
    panel.refresh(); stage.reset(); exportBar.refresh();
    stage.play().catch(() => {});
  },
  onClear: () => { media = null; panel.refresh(); stage.reset(); exportBar.refresh(); },
});

function render(t) {
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (!media) return;
  const f = fit(media.width, media.height, W, H);
  ctx.drawImage(media.el, f.x, f.y, f.w, f.h);
  // Your effect here. Example: a tint that pulses over time.
  ctx.globalAlpha = (s.amount / 100) * (0.5 + 0.5 * Math.sin(t * 3));
  ctx.fillStyle = s.color;
  ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = 1;
}

const stage = createStage({
  canvas,
  transport: document.getElementById('transport'),
  render,
  getDuration: () => (isVideo() ? media.duration : s.clip),
  getVideo: () => (isVideo() ? media.el : null),
});

const exportBar = createExportBar(document.getElementById('export'), {
  stage,
  filename: () => 'my-canvas-tool',
  getVideo: () => (isVideo() ? media.el : null),
  video: () => !!media,
  png: () => !!media,
});
