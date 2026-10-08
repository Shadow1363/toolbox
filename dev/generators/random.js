/**
 * Secure randomness for the generators. Everything comes from crypto.getRandomValues
 * (crypto.randomUUID for v4); never Math.random. Index picks use rejection sampling, so no modulo bias.
 */
const buf = new Uint32Array(256);
let pos = buf.length;
function u32() {
  if (pos >= buf.length) { crypto.getRandomValues(buf); pos = 0; }
  return buf[pos++];
}

/** Uniform integer in [0, n). */
export function randInt(n) {
  if (n <= 0 || n > 0x100000000) throw new RangeError('n out of range');
  const limit = Math.floor(0x100000000 / n) * n;
  let x;
  do x = u32(); while (x >= limit);
  return x % n;
}

export const pick = (chars) => chars[randInt(chars.length)];

export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const DIGITS = '0123456789';
export const SYMBOLS = '!@#$%^&*()-_=+[]{};:,.<>/?~';
const SIMILAR = 'il1Lo0O|I';
const AMBIGUOUS = '{}[]()/\\\'"`~,;:.<>';

/** The character sets a password draws from, after exclusions. */
export function passwordSets(o) {
  const strip = (s) => [...new Set(s)].filter((c) => !(o.noSimilar && SIMILAR.includes(c)) && !(o.noAmbiguous && AMBIGUOUS.includes(c))).join('');
  return [o.lower && LOWER, o.upper && UPPER, o.digits && DIGITS, o.symbols && (o.symbolSet || SYMBOLS)].filter(Boolean).map(strip).filter(Boolean);
}

/** Random password; with `requireEach`, redraws until every set appears (keeps the result uniform among valid ones). */
export function password(length, sets, requireEach) {
  const pool = sets.join('');
  for (let tries = 0; tries < 1000; tries++) {
    let p = '';
    for (let i = 0; i < length; i++) p += pick(pool);
    if (!requireEach || sets.every((s) => [...p].some((c) => s.includes(c)))) return p;
  }
  throw new Error('Couldn’t satisfy every character set; try a longer password.');
}

export function passphrase(words, list, { sep = '-', capitalize = false, number = false }) {
  const parts = Array.from({ length: words }, () => {
    const w = list[randInt(list.length)];
    return capitalize ? w.charAt(0).toUpperCase() + w.slice(1) : w;
  });
  if (number) { const i = randInt(parts.length); parts[i] += String(randInt(10)); }
  return parts.join(sep);
}

/* ---------- UUID ---------- */
const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const dashed = (h) => `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;

export function uuid4() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return dashed(hex(b));
}

/**
 * UUID v7 (RFC 9562): 48-bit Unix ms timestamp, then random bits. Within one millisecond the 12-bit
 * rand_a field counts up from a random start (method 1), so a bulk batch stays in sort order.
 */
let lastMs = -1;
let seq = 0;
export function uuid7() {
  let ms = Date.now();
  if (ms <= lastMs) {
    seq++;
    if (seq > 0xfff) { lastMs++; seq = randInt(0x800); }
    ms = lastMs;
  } else {
    lastMs = ms;
    seq = randInt(0x800); // leave headroom for the counter
  }
  const b = crypto.getRandomValues(new Uint8Array(16));
  for (let i = 0; i < 6; i++) b[i] = Math.floor(ms / 2 ** (8 * (5 - i))) & 0xff;
  b[6] = 0x70 | ((seq >> 8) & 0x0f);
  b[7] = seq & 0xff;
  b[8] = (b[8] & 0x3f) | 0x80;
  return dashed(hex(b));
}

/* ---------- API keys ---------- */
export const ALPHABETS = {
  hex: '0123456789abcdef',
  base62: `${DIGITS}${UPPER}${LOWER}`,
  base64url: `${UPPER}${LOWER}${DIGITS}-_`,
};
export function token(length, alphabet) {
  let s = '';
  for (let i = 0; i < length; i++) s += pick(alphabet);
  return s;
}

/* ---------- Strength ---------- */
export const bits = (poolSize, count) => (poolSize > 1 ? count * Math.log2(poolSize) : 0);

export function strength(b) {
  const [label, level] = b < 28 ? ['Very weak', 0] : b < 40 ? ['Weak', 1] : b < 60 ? ['Fair', 2] : b < 80 ? ['Strong', 3] : ['Very strong', 4];
  return { label, level, bits: b, crack: crackTime(b) };
}

/** Average time to guess at 100 billion guesses per second (a well-funded offline attack on a fast hash). */
function crackTime(b) {
  const sec = 2 ** (b - 1) / 1e11;
  if (sec < 1) return 'instantly';
  const units = [['seconds', 60], ['minutes', 60], ['hours', 24], ['days', 365.25], ['years', 1000], ['thousand years', 1000], ['million years', 1000], ['billion years', 14]];
  let v = sec;
  for (const [name, next] of units) {
    if (v < next) return `${v < 10 ? v.toFixed(1) : Math.round(v).toLocaleString()} ${name}`;
    v /= next;
  }
  return 'longer than the age of the universe (14 billion years)';
}
