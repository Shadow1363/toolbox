/**
 * Cron syntax checking with readable errors, normalization for croner, and a simple builder model.
 * Accepts 5 fields (minute hour day month weekday) or 6 (seconds first), names (JAN, MON),
 * `?`, L, LW, nW (day of month), nL and n#k (weekday), and the @daily-style macros.
 */
export const FIELDS = [
  { key: 'minute', label: 'Minute', min: 0, max: 59, unit: 'minute' },
  { key: 'hour', label: 'Hour', min: 0, max: 23, unit: 'hour' },
  { key: 'dom', label: 'Day of month', min: 1, max: 31, unit: 'day' },
  { key: 'month', label: 'Month', min: 1, max: 12, unit: 'month', names: ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'], base: 1 },
  { key: 'dow', label: 'Weekday', min: 0, max: 7, unit: 'weekday', names: ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'], base: 0 },
];
const SECOND = { key: 'second', label: 'Second', min: 0, max: 59, unit: 'second' };
export const MACROS = {
  '@yearly': '0 0 1 1 *', '@annually': '0 0 1 1 *', '@monthly': '0 0 1 * *', '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *', '@midnight': '0 0 * * *', '@hourly': '0 * * * *',
};
export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

class CronError extends Error {}

/** → { fields: [{ spec, raw }], expr (expanded), reboot? } or throws CronError with a sentence. */
export function parseCron(input) {
  const text = input.trim().replace(/\s+/g, ' ');
  if (!text) throw new CronError('Type a cron expression, or build one below.');
  if (text.startsWith('@')) {
    const m = text.toLowerCase();
    if (m === '@reboot') return { reboot: true, fields: [], expr: text };
    if (!MACROS[m]) throw new CronError(`Unknown shortcut “${text}”. Use one of: ${Object.keys(MACROS).join(', ')}, @reboot.`);
    return { ...parseCron(MACROS[m]), macro: m };
  }
  const parts = text.split(' ');
  if (parts.length !== 5 && parts.length !== 6) {
    throw new CronError(`Expected 5 fields (minute hour day-of-month month weekday)${parts.length > 6 ? '' : ' or 6 with seconds first'}, but found ${parts.length}.`);
  }
  const specs = parts.length === 6 ? [SECOND, ...FIELDS] : FIELDS;
  const fields = parts.map((raw, i) => { checkField(raw, specs[i]); return { spec: specs[i], raw }; });
  return { fields, expr: text };
}

function toNumber(tok, f, whole) {
  const t = tok.toUpperCase();
  if (f.names) {
    const i = f.names.indexOf(t);
    if (i >= 0) return i + f.base;
  }
  if (!/^\d+$/.test(t)) {
    throw new CronError(`${f.label}: “${tok}” isn’t a number${f.names ? ` or a name like ${f.names[0]}` : ''} (in “${whole}”).`);
  }
  const n = +t;
  if (n < f.min || n > f.max) throw new CronError(`${f.label}: ${n} is out of range (${f.min}–${f.max}${f.key === 'dow' ? ', where 0 and 7 are Sunday' : ''}).`);
  return n;
}

function checkField(raw, f) {
  if (raw === '') throw new CronError(`${f.label} is empty.`);
  for (const item of raw.split(',')) {
    if (item === '') throw new CronError(`${f.label}: “${raw}” has an empty item between commas.`);
    if (item === '?' && (f.key === 'dom' || f.key === 'dow')) continue;
    if (f.key === 'dom' && /^(L|LW|L-\d+)$/i.test(item)) continue;
    if (f.key === 'dom' && /^\d+W$/i.test(item)) { toNumber(item.slice(0, -1), f, raw); continue; }
    if (f.key === 'dow' && /^\w+L$/i.test(item) && item.length > 1) { toNumber(item.slice(0, -1), f, raw); continue; }
    if (f.key === 'dow' && item.includes('#')) {
      const [d, k] = item.split('#');
      const day = toNumber(d, f, raw);
      if (/^L$/i.test(k)) throw new CronError(`Weekday: write “the last ${DAY_NAMES[day % 7]} of the month” as “${day}L”, not “${item}”.`);
      if (!/^[1-5]$/.test(k)) throw new CronError(`Weekday: in “${item}” the part after # must be 1–5 (which week of the month).`);
      continue;
    }
    const bare = f.names ? item.toUpperCase().replace(new RegExp(f.names.join('|'), 'g'), '0') : item;
    if (/[LW#?]/i.test(bare)) {
      throw new CronError(`${f.label}: “${item}” uses a special character that isn’t allowed in this field.`);
    }
    const [range, step, extra] = item.split('/');
    if (extra !== undefined) throw new CronError(`${f.label}: “${item}” has more than one “/”.`);
    if (step !== undefined && (!/^\d+$/.test(step) || +step < 1)) throw new CronError(`${f.label}: the step in “${item}” must be a whole number of 1 or more.`);
    if (step !== undefined && +step > f.max) throw new CronError(`${f.label}: a step of ${step} is larger than the field allows (max ${f.max}).`);
    if (range === '*') continue;
    const ends = range.split('-');
    if (ends.length > 2 || ends.some((e) => e === '')) throw new CronError(`${f.label}: “${range}” isn’t a valid range (write it as start-end, like 1-5).`);
    const [a, b] = ends.map((e) => toNumber(e, f, raw));
    if (b !== undefined && b < a) throw new CronError(`${f.label}: the range “${range}” goes backwards (${a} is after ${b}).`);
  }
}

/** The expression croner understands: `?` → `*`, `5/10` → `5-max/10`, macros expanded. */
export function forCroner(parsed) {
  return parsed.fields.map(({ raw, spec }) => raw.split(',').map((item) => {
    if (item === '?') return '*';
    const m = /^(\w+)\/(\d+)$/.exec(item);
    return m ? `${m[1]}-${spec.max === 7 ? 6 : spec.max}/${m[2]}` : item;
  }).join(',')).join(' ');
}

/** True when both day fields are restricted: cron then runs when EITHER matches. */
export const dayOr = (parsed) => {
  const f = Object.fromEntries(parsed.fields.map((x) => [x.spec.key, x.raw]));
  return f.dom && f.dow && !['*', '?'].includes(f.dom) && !['*', '?'].includes(f.dow);
};

/** One field in words, for the breakdown table. */
export function describeField({ raw, spec }) {
  if (raw === '*' || raw === '?') return `every ${spec.unit}`;
  const named = (n) => (spec.key === 'dow' ? DAY_NAMES[n % 7] : spec.key === 'month' ? MONTH_NAMES[n - 1] : String(n));
  const num = (t) => {
    const u = t.toUpperCase();
    const i = spec.names?.indexOf(u) ?? -1;
    return i >= 0 ? i + spec.base : +t;
  };
  return raw.split(',').map((item) => {
    if (/^L$/i.test(item)) return 'the last day of the month';
    if (/^LW$/i.test(item)) return 'the last weekday of the month';
    if (/^L-(\d+)$/i.test(item)) return `${item.slice(2)} days before the last day`;
    if (/^\d+W$/i.test(item)) return `the weekday nearest day ${parseInt(item, 10)}`;
    if (spec.key === 'dow' && /L$/i.test(item)) return `the last ${named(num(item.slice(0, -1)))} of the month`;
    if (item.includes('#')) { const [d, k] = item.split('#'); return `the ${['', 'first', 'second', 'third', 'fourth', 'fifth'][k]} ${named(num(d))}`; }
    const [range, step] = item.split('/');
    const r = range === '*' ? null : range.split('-').map(num);
    const span = !r ? '' : r.length === 2 ? `${named(r[0])} through ${named(r[1])}` : named(r[0]);
    if (step) return `every ${step} ${spec.unit}s${r ? ` ${r.length === 2 ? 'from' : 'starting at'} ${span}` : ''}`;
    return span;
  }).join(', ');
}

/* ---------- Builder model ---------- */
export const FREQS = [['minutes', 'Every N minutes'], ['hourly', 'Hourly'], ['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly'], ['yearly', 'Yearly']];

export function build(b) {
  const [hh, mm] = (b.time || '09:00').split(':').map(Number);
  switch (b.freq) {
    case 'minutes': return b.every > 1 ? `*/${b.every} * * * *` : '* * * * *';
    case 'hourly': return `${b.minute} ${b.everyHours > 1 ? `*/${b.everyHours}` : '*'} * * *`;
    case 'daily': return `${mm} ${hh} * * *`;
    case 'weekly': return `${mm} ${hh} * * ${compactDays(b.days.length ? b.days : [1])}`;
    case 'monthly': return `${mm} ${hh} ${b.dom} * *`;
    case 'yearly': return `${mm} ${hh} ${b.dom} ${b.month} *`;
    default: return '* * * * *';
  }
}

/** [1,2,3,4,5] → "1-5", [0,6] → "0,6". */
function compactDays(days) {
  const d = [...new Set(days)].sort((a, b) => a - b);
  const out = [];
  for (let i = 0; i < d.length; i++) {
    let j = i;
    while (j + 1 < d.length && d[j + 1] === d[j] + 1) j++;
    out.push(j - i >= 2 ? `${d[i]}-${d[j]}` : d.slice(i, j + 1).join(','));
    i = j;
  }
  return out.join(',');
}

/** Recognise simple expressions so the builder can follow hand edits; null when it can't. */
export function infer(expr) {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return null;
  // Names → numbers (MON-FRI → 1-5, JAN → 1) so named schedules are recognised too.
  p[3] = p[3].toUpperCase().replace(/[A-Z]{3}/g, (x) => String(FIELDS[3].names.indexOf(x) + 1 || x));
  p[4] = p[4].toUpperCase().replace(/[A-Z]{3}/g, (x) => String(FIELDS[4].names.indexOf(x) >= 0 ? FIELDS[4].names.indexOf(x) : x));
  const [mi, ho, dom, mon, dow] = p;
  const n = (s, lo, hi) => (/^\d+$/.test(s) && +s >= lo && +s <= hi ? +s : null);
  const time = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  let m;
  if (ho === '*' && dom === '*' && mon === '*' && dow === '*') {
    if (mi === '*') return { freq: 'minutes', every: 1 };
    if ((m = /^\*\/(\d+)$/.exec(mi)) && +m[1] <= 59) return { freq: 'minutes', every: +m[1] };
    if (n(mi, 0, 59) !== null) return { freq: 'hourly', minute: +mi, everyHours: 1 };
  }
  if (n(mi, 0, 59) !== null && (m = /^\*\/(\d+)$/.exec(ho)) && dom === '*' && mon === '*' && dow === '*') return { freq: 'hourly', minute: +mi, everyHours: +m[1] };
  const H = n(ho, 0, 23);
  const M = n(mi, 0, 59);
  if (H === null || M === null) return null;
  if (dom === '*' && mon === '*' && dow === '*') return { freq: 'daily', time: time(H, M) };
  if (dom === '*' && mon === '*' && /^[\d,-]+$/.test(dow)) {
    const days = [];
    for (const part of dow.split(',')) {
      const [a, b] = part.split('-').map(Number);
      if (a > 7 || (b ?? a) > 7) return null;
      for (let d = a; d <= (b ?? a); d++) days.push(d % 7);
    }
    return { freq: 'weekly', time: time(H, M), days: [...new Set(days)] };
  }
  if (dow === '*' && mon === '*' && (n(dom, 1, 31) !== null || dom === 'L')) return { freq: 'monthly', time: time(H, M), dom };
  if (dow === '*' && n(mon, 1, 12) !== null && (n(dom, 1, 31) !== null || dom === 'L')) return { freq: 'yearly', time: time(H, M), dom, month: +mon };
  return null;
}
