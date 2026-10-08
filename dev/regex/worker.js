/*
 * Runs the regex off the main thread so a catastrophic pattern ((a+)+$ on a long line) can be
 * stopped: the page terminates this worker when it doesn't answer in time and starts a new one.
 * In:  { id, pattern, flags, text, replacement, limit }
 * Out: { id, matches: [{ index, end, groups: [[start, end, value] | null] }], total, replaced } or { id, error }
 */
self.onmessage = ({ data }) => {
  const { id, pattern, flags, text, replacement, limit } = data;
  try {
    const re = new RegExp(pattern, flags.includes('d') ? flags : `${flags}d`);
    const matches = [];
    let total = 0;
    const take = (m) => {
      total++;
      if (matches.length >= limit) return;
      matches.push({
        index: m.index,
        end: m.index + m[0].length,
        groups: m.slice(1).map((v, k) => (v === undefined ? null : [m.indices[k + 1][0], m.indices[k + 1][1], v])),
      });
    };
    if (re.global) {
      const unicode = re.unicode || re.unicodeSets;
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(text))) {
        take(m);
        if (m[0] === '') {
          // Step past an empty match (a whole code point in u/v mode) or exec would loop forever.
          const cp = unicode ? text.codePointAt(re.lastIndex) : 0;
          re.lastIndex += cp > 0xffff ? 2 : 1;
          if (re.lastIndex > text.length) break;
        }
        if (total > 1_000_000) break;
      }
    } else {
      const m = re.exec(text);
      if (m) take(m);
    }
    const replaced = replacement == null ? null : text.replace(new RegExp(pattern, flags), replacement);
    self.postMessage({ id, matches, total, replaced });
  } catch (err) {
    self.postMessage({ id, error: err.message });
  }
};
