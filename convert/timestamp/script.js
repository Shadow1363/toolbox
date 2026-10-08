/* Timestamp converter: Unix (s/ms/µs/ns) ↔ ISO 8601 ↔ human-readable, in any IANA time zone. */
import { createControls } from '/assets/js/lib/controls.js';
import { h, icon } from '/assets/js/lib/dom.js';
import { remember, copyText, actionButton, debounce } from '/assets/js/lib/text-tool.js';

const input = document.getElementById('input');
const rowsEl = document.getElementById('rows');
const statusEl = document.getElementById('status');
const LOCAL = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
const ZONES = (() => { try { return Intl.supportedValuesOf('timeZone'); } catch { return ['UTC']; } })();
if (!ZONES.includes('UTC')) ZONES.unshift('UTC');

const opts = remember('timestamp', [{ title: '', controls: [
  { id: 'zone', type: 'select', label: 'Time zone', value: LOCAL, options: [[LOCAL, `${LOCAL} (yours)`], ...ZONES.filter((z) => z !== LOCAL).map((z) => [z, z.replace(/_/g, ' ')])] },
  { id: 'unit', type: 'segmented', label: 'Numbers are', value: 'auto', options: [['auto', 'Detect'], ['s', 'Seconds'], ['ms', 'Milliseconds'], ['us', 'µs'], ['ns', 'ns']] },
]}]);
const panel = createControls(document.getElementById('options'), opts.sections, { onChange: (st) => { opts.save(st); run(); } });
const s = panel.state;
if (!ZONES.includes(s.zone) && s.zone !== LOCAL) panel.set({ zone: LOCAL }, { silent: true });

document.getElementById('in-actions').append(actionButton('Now', 'restart', () => { input.value = String(Math.floor(Date.now() / 1000)); run(); }));
input.addEventListener('input', debounce(run, 100));

/* ---------- Time zone helpers ---------- */
function fieldsIn(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short' });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, weekday: p.weekday };
}
/** Zone offset from UTC in minutes at instant `ms`. */
function offsetMinutes(ms, tz) {
  const f = fieldsIn(ms, tz);
  return Math.round((Date.UTC(f.y, f.mo - 1, f.d, f.h, f.mi, f.s) - Math.floor(ms / 1000) * 1000) / 60000);
}
/** A wall-clock time in `tz` → epoch ms (two passes settle DST edges). */
function zonedToEpoch(y, mo, d, hh, mi, ss, msec, tz) {
  const guess = Date.UTC(y, mo - 1, d, hh, mi, ss, msec);
  let t = guess - offsetMinutes(guess, tz) * 60000;
  t = guess - offsetMinutes(t, tz) * 60000;
  return t;
}
const pad = (n, w = 2) => String(n).padStart(w, '0');
const offsetText = (min) => `${min < 0 ? '-' : '+'}${pad(Math.floor(Math.abs(min) / 60))}:${pad(Math.abs(min) % 60)}`;

/* ---------- Parsing ---------- */
const UNIT_MS = { s: 1000, ms: 1, us: 1e-3, ns: 1e-6 };
function parse(text) {
  const t = text.trim();
  if (/^-?\d+(\.\d+)?$/.test(t)) {
    const n = Number(t);
    const digits = Math.abs(Math.trunc(n)).toString().length;
    const unit = s.unit !== 'auto' ? s.unit : digits <= 11 ? 's' : digits <= 14 ? 'ms' : digits <= 17 ? 'us' : 'ns';
    return { ms: n * UNIT_MS[unit], how: `Unix time in ${{ s: 'seconds', ms: 'milliseconds', us: 'microseconds', ns: 'nanoseconds' }[unit]}${s.unit === 'auto' ? ' (detected from the number of digits)' : ''}` };
  }
  // ISO-like without a zone: read it as wall-clock time in the selected zone.
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/.exec(t);
  if (m) {
    const [, y, mo, d, hh = 0, mi = 0, ss = 0, frac = '0'] = m;
    return { ms: zonedToEpoch(+y, +mo, +d, +hh, +mi, +ss, +frac.padEnd(3, '0'), s.zone), how: `Date and time in ${s.zone}` };
  }
  const ms = Date.parse(t);
  if (!Number.isNaN(ms)) {
    const zoned = /([zZ]|[+-]\d{2}:?\d{2}|\b(UTC|GMT)\b)\s*$/.test(t);
    return { ms, how: zoned ? 'Date with its own time zone' : `Date read in your browser's time zone (${LOCAL})` };
  }
  return null;
}

/* ---------- Output ---------- */
function relative(ms) {
  const diff = (ms - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, sec] of [['year', 31536000], ['month', 2592000], ['week', 604800], ['day', 86400], ['hour', 3600], ['minute', 60]]) {
    if (Math.abs(diff) >= sec) return rtf.format(Math.round(diff / sec), unit);
  }
  return rtf.format(Math.round(diff), 'second');
}
function isoWeek(y, mo, d) {
  const date = new Date(Date.UTC(y, mo - 1, d));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  return [date.getUTCFullYear(), Math.ceil(((date - yearStart) / 86400000 + 1) / 7)];
}

function rows(ms) {
  const tz = s.zone;
  const f = fieldsIn(ms, tz);
  const off = offsetMinutes(ms, tz);
  const msPart = ((ms % 1000) + 1000) % 1000;
  const local = `${f.y}-${pad(f.mo)}-${pad(f.d)}T${pad(f.h)}:${pad(f.mi)}:${pad(f.s)}${msPart ? `.${pad(Math.floor(msPart), 3)}` : ''}${offsetText(off)}`;
  const human = new Intl.DateTimeFormat(undefined, { timeZone: tz, dateStyle: 'full', timeStyle: 'long' }).format(ms);
  const [wy, wk] = isoWeek(f.y, f.mo, f.d);
  const dayOfYear = Math.round((Date.UTC(f.y, f.mo - 1, f.d) - Date.UTC(f.y, 0, 1)) / 86400000) + 1;
  return [
    ['Unix seconds', String(Math.floor(ms / 1000))],
    ['Unix ms', String(Math.round(ms))],
    ['ISO 8601 (UTC)', new Date(ms).toISOString()],
    [`ISO 8601 (${tz.split('/').pop().replace(/_/g, ' ')})`, local],
    ['Readable', human],
    ['Relative', relative(ms)],
    ['RFC 7231 (HTTP)', new Date(ms).toUTCString()],
    ['Calendar', `${f.weekday} · day ${dayOfYear} · ISO week ${wy}-W${pad(wk)} · UTC${offsetText(off)}`],
  ];
}

function run() {
  const text = input.value.trim();
  if (!text) { rowsEl.replaceChildren(); status('Enter a timestamp or a date, or press Now.'); return; }
  const r = parse(text);
  if (!r || !Number.isFinite(r.ms) || Math.abs(r.ms) > 8.64e15) {
    rowsEl.replaceChildren();
    return status('Not a date or timestamp this tool understands. Try 1700000000 or 2024-05-01T10:00:00Z.', 'error');
  }
  status(r.how, 'ok');
  rowsEl.replaceChildren(...rows(r.ms).map(([label, value]) => h('div', { class: 'io-row' },
    h('span', {}, label), h('code', {}, value),
    h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': `Copy ${label}`, html: icon('copy'), onclick: () => copyText(value, `${label} copied`) }))));
}

function status(text, kind = '') {
  statusEl.className = `io-status${kind ? ` is-${kind}` : ''}`;
  statusEl.innerHTML = kind === 'ok' ? icon('check') : kind === 'error' ? icon('alert') : '';
  statusEl.append(text);
}

// A live clock: the current Unix time.
const clock = document.getElementById('clock');
const tick = () => { clock.textContent = `Now: ${Math.floor(Date.now() / 1000)} (Unix seconds)`; };
setInterval(tick, 1000);
tick();
input.value = String(Math.floor(Date.now() / 1000));
run();
