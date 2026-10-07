/**
 * MediaRecorder WebM files (Chrome) have no Duration in their header, so many
 * players can't seek them and editors report the wrong length. This writes the
 * Duration element into the Segment › Info block. Returns the original blob on
 * anything unexpected.
 */
const ID = { EBML: 0x1a45dfa3, Segment: 0x18538067, SeekHead: 0x114d9b74, Info: 0x1549a966, TimecodeScale: 0x2ad7b1, Duration: 0x4489 };

const vlen = (b) => { for (let i = 0; i < 8; i++) if (b & (0x80 >> i)) return i + 1; return 0; };

function readId(buf, pos) {
  const len = vlen(buf[pos]);
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + buf[pos + i];
  return { id, len };
}

function readSize(buf, pos) {
  const len = vlen(buf[pos]);
  let size = buf[pos] & (0xff >> len);
  let unknown = size === 0xff >> len;
  for (let i = 1; i < len; i++) { size = size * 256 + buf[pos + i]; if (buf[pos + i] !== 0xff) unknown = false; }
  return { size, len, unknown };
}

function readElement(buf, pos) {
  const id = readId(buf, pos);
  const sz = readSize(buf, pos + id.len);
  const data = pos + id.len + sz.len;
  return { id: id.id, sizePos: pos + id.len, sizeLen: sz.len, size: sz.size, unknown: sz.unknown, data, end: data + sz.size };
}

function readUint(buf, pos, len) { let v = 0; for (let i = 0; i < len; i++) v = v * 256 + buf[pos + i]; return v; }

function patch(buf, durationMs) {
  let pos = 0;
  const head = readElement(buf, pos);
  if (head.id !== ID.EBML) return null;
  const seg = readElement(buf, head.end);
  if (seg.id !== ID.Segment || !seg.unknown) return null;

  let sawSeekHead = false;
  pos = seg.data;
  while (pos < buf.length) {
    const el = readElement(buf, pos);
    if (el.id === ID.SeekHead) sawSeekHead = true;
    if (el.id === ID.Info) return patchInfo(buf, el, durationMs, sawSeekHead);
    if (el.unknown) return null;
    pos = el.end;
  }
  return null;
}

function patchInfo(buf, info, durationMs, sawSeekHead) {
  let scale = 1e6;
  let durationEl = null;
  for (let p = info.data; p < info.end;) {
    const el = readElement(buf, p);
    if (el.id === ID.TimecodeScale) scale = readUint(buf, el.data, el.size);
    if (el.id === ID.Duration) durationEl = el;
    p = el.end;
  }
  const value = (durationMs * 1e6) / scale;

  if (durationEl) { // overwrite in place
    const view = new DataView(buf.buffer, buf.byteOffset + durationEl.data, durationEl.size);
    if (durationEl.size === 8) view.setFloat64(0, value);
    else if (durationEl.size === 4) view.setFloat32(0, value);
    else return null;
    return buf;
  }
  if (sawSeekHead) return null; // inserting bytes would break SeekHead offsets

  const dur = new Uint8Array(11);
  dur.set([0x44, 0x89, 0x88]);
  new DataView(dur.buffer).setFloat64(3, value);

  const newSize = info.size + dur.length;
  const sizeVint = new Uint8Array(8);
  sizeVint[0] = 0x01;
  for (let i = 7, v = newSize; i >= 1; i--, v = Math.floor(v / 256)) sizeVint[i] = v & 0xff;

  const out = new Uint8Array(buf.length - info.sizeLen + 8 + dur.length);
  let o = 0;
  const put = (part) => { out.set(part, o); o += part.length; };
  put(buf.subarray(0, info.sizePos));
  put(sizeVint);
  put(buf.subarray(info.data, info.end));
  put(dur);
  put(buf.subarray(info.end));
  return out;
}

export async function fixWebmDuration(blob, durationMs) {
  if (!/webm/.test(blob.type)) return blob;
  try {
    const buf = new Uint8Array(await blob.arrayBuffer());
    const out = patch(buf, durationMs);
    return out ? new Blob([out], { type: blob.type }) : blob;
  } catch (err) {
    console.warn('Could not patch WebM duration', err);
    return blob;
  }
}
