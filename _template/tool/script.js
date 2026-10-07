/*
 * Text tool template (input → output), a starting point for things like /format or /regex.
 * Copy this folder to /<tool-id>/ (standalone) or /<category>/<tool-id>/, register the tool
 * in /assets/js/tools.js, and set data-tool="<tool-id>" on <body> in index.html.
 */
import { createControls } from '/assets/js/lib/controls.js';
import { toast } from '/assets/js/lib/dom.js';

const input = document.getElementById('input');
const output = document.getElementById('output');

const panel = createControls(document.getElementById('controls'), [
  { title: 'Options', controls: [
    { id: 'indent', type: 'segmented', label: 'Indent', value: '2', options: [['2', '2 spaces'], ['4', '4 spaces'], ['tab', 'Tab']] },
    { id: 'sortKeys', type: 'toggle', label: 'Sort keys', value: false },
  ]},
], { onChange: run });

function run() {
  const s = panel.state;
  try {
    let value = JSON.parse(input.value);
    if (s.sortKeys) value = sortKeys(value);
    output.value = JSON.stringify(value, null, s.indent === 'tab' ? '\t' : +s.indent);
  } catch (err) {
    output.value = `Error: ${err.message}`;
  }
}

const sortKeys = (v) => Array.isArray(v) ? v.map(sortKeys)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v;

input.addEventListener('input', run);
document.getElementById('copy').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(output.value); toast('Copied', 'success', 1500); }
  catch { toast('Copy failed', 'error'); }
});
run();
