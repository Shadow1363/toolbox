/* QR code: create (qrcode-generator → crisp PNG/SVG) and read (BarcodeDetector, else jsQR) from an image. */
import { createControls } from '/assets/js/lib/controls.js';
import { createFilePicker } from '/assets/js/lib/upload.js';
import { h, icon, toast, downloadBlob } from '/assets/js/lib/dom.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { remember, copyButton, actionButton, debounce } from '/assets/js/lib/text-tool.js';

const canvas = document.getElementById('qr');
const qrStatus = document.getElementById('qr-status');
let matrix = null; // { n, dark(r, c) } for the current code

/* ---------- Mode ---------- */
const mode = remember('qr-mode', [{ title: '', controls: [
  { id: 'mode', type: 'segmented', label: 'Mode', value: 'create', options: [['create', 'Create a QR code'], ['read', 'Read a QR code']] },
]}]);
const modePanel = createControls(document.getElementById('mode'), mode.sections, { onChange: (st) => { mode.save(st); showMode(); } });
function showMode() {
  const read = modePanel.state.mode === 'read';
  document.getElementById('create').hidden = read;
  document.getElementById('read').hidden = !read;
}

/* ---------- Create ---------- */
const content = remember('qr-content', [{ title: '', controls: [
  { id: 'qrType', type: 'segmented', label: 'Type', value: 'text', options: [['text', 'Text or link'], ['wifi', 'Wi-Fi'], ['email', 'Email']] },
  { id: 'text', type: 'textarea', label: 'Text or link', value: 'https://example.com', rows: 4, showIf: (s) => s.qrType === 'text' },
  { id: 'ssid', type: 'text', label: 'Network name (SSID)', value: '', showIf: (s) => s.qrType === 'wifi' },
  { id: 'wifiPass', type: 'text', label: 'Password', value: '', showIf: (s) => s.qrType === 'wifi' && s.security !== 'nopass' },
  { id: 'security', type: 'segmented', label: 'Security', value: 'WPA', options: [['WPA', 'WPA/WPA2/WPA3'], ['WEP', 'WEP'], ['nopass', 'None']], showIf: (s) => s.qrType === 'wifi' },
  { id: 'hidden', type: 'toggle', label: 'Hidden network', value: false, showIf: (s) => s.qrType === 'wifi' },
  { id: 'emailTo', type: 'text', label: 'To', value: '', placeholder: 'name@example.com', showIf: (s) => s.qrType === 'email' },
  { id: 'emailSubject', type: 'text', label: 'Subject', value: '', showIf: (s) => s.qrType === 'email' },
  { id: 'emailBody', type: 'textarea', label: 'Message', value: '', rows: 3, showIf: (s) => s.qrType === 'email' },
]}]);
// Wi-Fi passwords stay out of localStorage.
content.sections[0].controls.find((c) => c.id === 'wifiPass').value = '';
const contentPanel = createControls(document.getElementById('fields'), content.sections, {
  onChange: (st) => { const { wifiPass, ...rest } = st; content.save(rest); draw(); },
});

const style = remember('qr-style', [{ title: '', controls: [
  { id: 'ecc', type: 'segmented', label: 'Error correction', value: 'M', options: [['L', 'L 7%'], ['M', 'M 15%'], ['Q', 'Q 25%'], ['H', 'H 30%']], hint: 'Higher survives damage or a logo on top, but makes a denser code.' },
  { id: 'size', type: 'range', label: 'PNG size', min: 128, max: 2048, step: 32, value: 512, unit: ' px' },
  { id: 'margin', type: 'range', label: 'Quiet zone', min: 0, max: 8, value: 4, unit: ' modules', hint: 'Scanners want 4; less may not scan.' },
  { id: 'fg', type: 'color', label: 'Foreground', value: '#000000' },
  { id: 'bg', type: 'color', label: 'Background', value: '#ffffff' },
  { id: 'transparent', type: 'toggle', label: 'Transparent background', value: false },
]}]);
const stylePanel = createControls(document.getElementById('style'), style.sections, { onChange: (st) => { style.save(st); draw(); } });

const esc = (v) => String(v).replace(/([\;,:"])/g, '\\$1');
function payload() {
  const c = contentPanel.state;
  if (c.qrType === 'wifi') {
    if (!c.ssid) return '';
    return `WIFI:T:${c.security === 'nopass' ? 'nopass' : c.security};S:${esc(c.ssid)};${c.security === 'nopass' ? '' : `P:${esc(c.wifiPass)};`}${c.hidden ? 'H:true;' : ''};`;
  }
  if (c.qrType === 'email') {
    if (!c.emailTo) return '';
    const q = new URLSearchParams();
    if (c.emailSubject) q.set('subject', c.emailSubject);
    if (c.emailBody) q.set('body', c.emailBody);
    return `mailto:${c.emailTo}${q.toString() ? `?${q.toString().replace(/\+/g, '%20')}` : ''}`;
  }
  return c.text;
}

const draw = debounce(async () => {
  const data = payload();
  if (!data) { matrix = null; paint(); return status(qrStatus, 'Fill in the content to make a code.'); }
  try {
    const { default: qrcode } = await loadLib('qrcode');
    const qr = qrcode(0, stylePanel.state.ecc);
    qr.addData(unescape(encodeURIComponent(data)), 'Byte'); // UTF-8 bytes as a binary string
    qr.make();
    const n = qr.getModuleCount();
    matrix = { n, dark: (r, c) => qr.isDark(r, c) };
    paint();
    status(qrStatus, `${new TextEncoder().encode(data).length} bytes · ${n}×${n} modules (version ${(n - 17) / 4})`, 'ok');
  } catch (err) {
    matrix = null;
    paint();
    status(qrStatus, /overflow/i.test(String(err)) ? 'Too much data for a QR code. Shorten it or lower the error correction.' : `Couldn't make a QR code: ${err.message || err}`, 'error');
  }
}, 80);

function paint() {
  const st = stylePanel.state;
  const x = canvas.getContext('2d');
  if (!matrix) { canvas.width = canvas.height = 256; x.clearRect(0, 0, 256, 256); return; }
  const total = matrix.n + st.margin * 2;
  const scale = Math.max(1, Math.round(st.size / total));
  canvas.width = canvas.height = total * scale;
  x.clearRect(0, 0, canvas.width, canvas.height);
  if (!st.transparent) { x.fillStyle = st.bg; x.fillRect(0, 0, canvas.width, canvas.height); }
  x.fillStyle = st.fg;
  for (let r = 0; r < matrix.n; r++) for (let c = 0; c < matrix.n; c++) if (matrix.dark(r, c)) x.fillRect((c + st.margin) * scale, (r + st.margin) * scale, scale, scale);
}

function svg() {
  const st = stylePanel.state;
  const total = matrix.n + st.margin * 2;
  let d = '';
  for (let r = 0; r < matrix.n; r++) for (let c = 0; c < matrix.n; c++) if (matrix.dark(r, c)) d += `M${c + st.margin} ${r + st.margin}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${st.size}" height="${st.size}" shape-rendering="crispEdges">${st.transparent ? '' : `<rect width="100%" height="100%" fill="${st.bg}"/>`}<path fill="${st.fg}" d="${d}"/></svg>\n`;
}

const pngBlob = () => new Promise((res) => canvas.toBlob(res, 'image/png'));
document.getElementById('qr-actions').append(
  actionButton('PNG', 'download', async () => { if (!matrix) return toast('Nothing to download yet.'); downloadBlob(await pngBlob(), 'qr-code.png'); }),
  actionButton('SVG', 'download', () => { if (!matrix) return toast('Nothing to download yet.'); downloadBlob(new Blob([svg()], { type: 'image/svg+xml' }), 'qr-code.svg'); }),
  actionButton('Copy', 'copy', async () => {
    if (!matrix) return toast('Nothing to copy yet.');
    try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]); toast('QR code copied as an image', 'success', 1500); } catch { toast('Your browser blocked copying images. Use PNG instead.', 'error'); }
  }));

/* ---------- Read ---------- */
const readOut = document.getElementById('read-out');
const readStatus = document.getElementById('read-status');
const readExtra = document.getElementById('read-extra');
const readImg = document.getElementById('read-img');
createFilePicker(document.getElementById('read-drop'), { accept: 'image/*', label: 'Drop an image with a QR code', onFiles: ([f]) => readFile(f) });
document.addEventListener('paste', (e) => {
  if (modePanel.state.mode !== 'read') return;
  const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith('image/'));
  if (f) readFile(f);
});
document.getElementById('read-actions').append(copyButton(() => readOut.value));

async function decode(bitmap) {
  if ('BarcodeDetector' in window) {
    try {
      if ((await BarcodeDetector.getSupportedFormats()).includes('qr_code')) {
        const hits = await new BarcodeDetector({ formats: ['qr_code'] }).detect(bitmap);
        if (hits.length) return hits[0].rawValue;
      }
    } catch { /* fall back to jsQR */ }
  }
  const { default: jsQR } = await loadLib('jsqr');
  const k = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bitmap.width * k); c.height = Math.round(bitmap.height * k);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bitmap, 0, 0, c.width, c.height);
  const r = jsQR(x.getImageData(0, 0, c.width, c.height).data, c.width, c.height, { inversionAttempts: 'attemptBoth' });
  return r ? r.data : null;
}

async function readFile(f) {
  readOut.value = '';
  readExtra.replaceChildren();
  if (readImg.src) URL.revokeObjectURL(readImg.src);
  readImg.src = URL.createObjectURL(f);
  readImg.hidden = false;
  status(readStatus, 'Reading…');
  try {
    const value = await decode(await createImageBitmap(f));
    if (value == null) return status(readStatus, 'No QR code found. Try a sharper or tighter crop of the code.', 'error');
    readOut.value = value;
    status(readStatus, 'QR code read', 'ok');
    describe(value);
  } catch (err) {
    console.error(err);
    status(readStatus, 'That image couldn\'t be read.', 'error');
  }
}

/** Explain common payloads; links are shown, never opened automatically. */
function describe(v) {
  const wifi = /^WIFI:(.*)$/i.exec(v);
  if (wifi) {
    const get = (k) => new RegExp(`(?:^|;)${k}:((?:\\\\.|[^;])*)`).exec(wifi[1])?.[1]?.replace(/\\(.)/g, '$1') ?? '';
    readExtra.append(h('dl', { class: 'kv' }, h('dt', {}, 'Wi-Fi network'), h('dd', {}, get('S')), h('span'),
      h('dt', {}, 'Password'), h('dd', {}, get('P') || '(none)'), h('span'), h('dt', {}, 'Security'), h('dd', {}, get('T') || 'none'), h('span')));
  } else if (/^https?:\/\//i.test(v)) {
    readExtra.append(h('div', { class: 'io-banner' }, 'This is a link. Check where it goes before opening it: ',
      h('a', { href: v, target: '_blank', rel: 'noopener noreferrer nofollow' }, new URL(v).host)));
  }
}

function status(el, text, kind = '') {
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '';
  el.append(text);
}

showMode();
draw();
