/* Cron Expression Builder: validate (cron.js), describe (cronstrue), next runs in a time zone (croner). */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon, store } from '/assets/js/lib/dom.js';
import { remember, copyButton, downloadButton, debounce, rememberInput } from '/assets/js/lib/text-tool.js';
import { loadLib } from '/assets/js/lib/cdn.js';
import { parseCron, forCroner, dayOr, describeField, build, infer, FREQS, DAY_NAMES, MONTH_NAMES } from './cron.js';

const PRESETS = [
  ['Every minute', '* * * * *'], ['Every 5 minutes', '*/5 * * * *'], ['Every 15 minutes', '*/15 * * * *'], ['Hourly', '0 * * * *'],
  ['Every 6 hours', '0 */6 * * *'], ['Daily at midnight', '0 0 * * *'], ['Weekdays at 9:00', '0 9 * * 1-5'], ['Weekends at 10:00', '0 10 * * 0,6'],
  ['Mondays at 8:30', '30 8 * * 1'], ['1st of the month', '0 0 1 * *'], ['Last day of the month', '0 18 L * *'], ['Quarterly', '0 0 1 1,4,7,10 *'],
  ['Yearly (Jan 1)', '0 0 1 1 *'], ['Office hours, every 30 min', '*/30 9-17 * * 1-5'],
];
const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();
if (!ZONES.includes('UTC')) ZONES.unshift('UTC');

const $ = (id) => document.getElementById(id);
const exprEl = $('expr');
const saved = rememberInput('cron:expr', '0 9 * * 1-5');
exprEl.value = saved.value;

/* ---------- Time zone ---------- */
const zoneEl = $('zone');
zoneEl.append(h('option', { value: LOCAL }, `${LOCAL.replace(/_/g, ' ')} (yours)`), ...ZONES.filter((z) => z !== LOCAL).map((z) => h('option', { value: z }, z.replace(/_/g, ' '))));
zoneEl.value = ZONES.includes(store.get('opts:cron-zone')) ? store.get('opts:cron-zone') : LOCAL;
zoneEl.addEventListener('change', () => { store.set('opts:cron-zone', zoneEl.value); run(); });

/* ---------- Presets ---------- */
$('presets').append(...PRESETS.map(([label, expr]) => h('button', { type: 'button', class: 'chip', title: expr, onclick: () => setExpr(expr) }, label)));

/* ---------- Builder ---------- */
const timeEl = h('input', { type: 'time', value: '09:00', 'aria-label': 'Time' });
const dayBtns = [1, 2, 3, 4, 5, 6, 0].map((d) => h('button', { type: 'button', class: 'chip', 'data-d': d, 'aria-pressed': 'false' }, DAY_NAMES[d].slice(0, 3)));
const opts = remember('cron', [{ title: '', controls: [
  { id: 'freq', type: 'select', label: 'Run', value: 'weekly', options: [...FREQS, ['custom', 'Custom (edited by hand)']] },
  { id: 'every', type: 'number', label: 'Every … minutes', min: 1, max: 59, value: 5, showIf: (st) => st.freq === 'minutes' },
  { id: 'minute', type: 'number', label: 'At minute', min: 0, max: 59, value: 0, showIf: (st) => st.freq === 'hourly' },
  { id: 'everyHours', type: 'number', label: 'Every … hours', min: 1, max: 23, value: 1, showIf: (st) => st.freq === 'hourly' },
  { type: 'custom', label: 'On', el: h('div', { class: 'chips' }, dayBtns), showIf: (st) => st.freq === 'weekly' },
  { id: 'month', type: 'select', label: 'Month', value: '1', options: MONTH_NAMES.map((m, i) => [String(i + 1), m]), showIf: (st) => st.freq === 'yearly' },
  { id: 'dom', type: 'select', label: 'Day of month', value: '1', options: [...Array.from({ length: 31 }, (_, i) => [String(i + 1), String(i + 1)]), ['L', 'Last day']], showIf: (st) => st.freq === 'monthly' || st.freq === 'yearly' },
  { type: 'custom', label: 'At', el: timeEl, showIf: (st) => ['daily', 'weekly', 'monthly', 'yearly'].includes(st.freq) },
]}]);
const panel = createControls($('builder'), opts.sections, { onChange: (st) => { opts.save(st); fromBuilder(); } });
const b = panel.state;
let days = [1, 2, 3, 4, 5];
dayBtns.forEach((btn) => btn.addEventListener('click', () => {
  const d = +btn.dataset.d;
  days = days.includes(d) ? days.filter((x) => x !== d) : [...days, d];
  if (!days.length) days = [d];
  paintDays();
  fromBuilder();
}));
timeEl.addEventListener('change', () => fromBuilder());
const paintDays = () => dayBtns.forEach((btn) => btn.setAttribute('aria-pressed', String(days.includes(+btn.dataset.d))));

function fromBuilder() {
  if (b.freq === 'custom') return;
  const expr = build({ ...b, every: Math.max(1, Math.min(59, b.every | 0)), minute: Math.max(0, Math.min(59, b.minute | 0)), everyHours: Math.max(1, Math.min(23, b.everyHours | 0)), time: timeEl.value || '00:00', days });
  exprEl.value = expr;
  saved.save(expr);
  run();
}

/** Point the builder at what the expression means, or "Custom" when it isn't a simple schedule. */
function toBuilder(expr) {
  let model = null;
  try { model = infer(parseCron(expr).expr); } catch { /* invalid: leave the builder as it is */ return; }
  if (!model) { panel.set({ freq: 'custom' }, { silent: true }); return; }
  const patch = { freq: model.freq };
  if (model.every) patch.every = model.every;
  if (model.minute !== undefined) patch.minute = model.minute;
  if (model.everyHours) patch.everyHours = model.everyHours;
  if (model.dom) patch.dom = String(model.dom);
  if (model.month) patch.month = String(model.month);
  if (model.time) timeEl.value = model.time;
  if (model.days) { days = model.days; paintDays(); }
  panel.set(patch, { silent: true });
}

function setExpr(expr) {
  exprEl.value = expr;
  saved.save(expr);
  toBuilder(expr);
  run();
}
exprEl.addEventListener('input', () => { saved.save(exprEl.value); toBuilder(exprEl.value); run(); });

/* ---------- Field labels under the input ---------- */
function paintFields(parsed) {
  const names = parsed?.fields?.length ? parsed.fields.map((f) => f.spec.label) : ['Minute', 'Hour', 'Day of month', 'Month', 'Weekday'];
  const raws = parsed?.fields?.length ? parsed.fields.map((f) => f.raw) : exprEl.value.trim().split(/\s+/);
  $('fields').replaceChildren(...names.map((n, i) => h('span', {}, h('code', {}, raws[i] ?? ' '), n)));
}

/* ---------- Output ---------- */
let last = { expr: '', desc: '', runs: [] };
$('out-actions').append(
  copyButton(() => last.expr, 'Copy expression'),
  downloadButton(() => (last.expr ? { text: summary(), name: 'cron-schedule.txt' } : null)));

const fmt = (zone) => new Intl.DateTimeFormat(undefined, { timeZone: zone, weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'short' });
const rel = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
function relative(ms) {
  const s = (ms - Date.now()) / 1000;
  for (const [unit, size] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(s) >= size) return rel.format(Math.round(s / size), unit);
  }
  return rel.format(Math.round(s), 'second');
}

function status(kind, text) {
  const el = $('expr-status');
  el.className = `io-status${kind ? ` is-${kind}` : ''}`;
  el.innerHTML = kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '';
  el.append(text);
}

let libs = null;
let runId = 0;
const run = debounce(async () => {
  const id = ++runId;
  const expr = exprEl.value;
  let parsed;
  try { parsed = parseCron(expr); } catch (err) {
    paintFields(null);
    status('error', err.message);
    $('desc').textContent = '—';
    $('runs').replaceChildren();
    $('table').replaceChildren();
    $('note').hidden = true;
    last = { expr: '', desc: '', runs: [] };
    return;
  }
  paintFields(parsed);
  try { libs ||= await Promise.all([loadLib('croner'), loadLib('cronstrue')]); } catch (err) { status('error', err.message); return; }
  if (id !== runId) return;
  const [{ Cron }, cronstrueMod] = libs;
  const cronstrue = cronstrueMod.default || cronstrueMod;
  const notes = [];
  let desc;
  let runs = [];
  if (parsed.reboot) {
    desc = 'At system startup (@reboot).';
    notes.push('@reboot runs once when the cron daemon starts, so there are no scheduled times to list.');
  } else {
    const normalized = forCroner(parsed);
    try {
      desc = cronstrue.toString(parsed.expr, { use24HourTimeFormat: true, verbose: false });
    } catch (err) { desc = String(err).replace(/^Error: /, ''); }
    try {
      runs = new Cron(normalized, { timezone: zoneEl.value }).nextRuns(10);
    } catch (err) {
      status('error', err.message.replace(/^CronPattern: /, ''));
      $('desc').textContent = desc;
      $('runs').replaceChildren();
      return;
    }
    if (!runs.length) notes.push('This schedule never runs: no date matches every field (for example, February 30).');
    if (dayOr(parsed)) notes.push('Both day of month and weekday are set, so standard cron runs when EITHER matches, not both.');
    if (parsed.fields.length === 6) notes.push('Six fields: the first is read as seconds. Classic crontab only has five.');
  }
  status('ok', `Valid${parsed.macro ? ` (${parsed.macro} = ${parsed.expr})` : ''}`);
  $('desc').textContent = desc;
  $('note').hidden = !notes.length;
  $('note').textContent = notes.join(' ');
  const f = fmt(zoneEl.value);
  $('runs').replaceChildren(...runs.map((d) => h('li', {}, h('span', {}, f.format(d)), h('span', { class: 'cr-rel' }, relative(d.getTime())))));
  $('table').replaceChildren(...parsed.fields.flatMap((fl) => [h('dt', {}, fl.spec.label), h('dd', {}, h('code', {}, fl.raw)), h('dd', {}, describeField(fl))]));
  last = { expr: expr.trim().replace(/\s+/g, ' '), desc, runs: runs.map((d) => f.format(d)) };
}, 120);

function summary() {
  return [`${last.expr}`, `# ${last.desc}`, '', `Next runs (${zoneEl.value}):`, ...last.runs.map((r) => `  ${r}`), ''].join('\n');
}

toBuilder(exprEl.value);
paintDays();
run();
