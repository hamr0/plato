// Minimal POSIX USTAR reader (M7/B2-a writer's mirror).
//
// Consumes a Buffer (the gunzipped tarball produced by writeTar) and
// returns a Map of { path → bodyBuffer }. Validates checksums to catch
// transit corruption that gzip didn't already; rejects non-regular files
// and path traversal.
//
// Hobby-scale: archives fit in memory; no streaming. Symbolic constants
// match writeTar's so changes here track changes there.

const HEADER_SIZE = 512;

// Read a NUL-terminated ASCII octal field. Empty / all-NUL → 0.
function readOctal(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  let end = 0;
  while (end < slice.length && slice[end] !== 0 && slice[end] !== 0x20) end++;
  const s = slice.subarray(0, end).toString('ascii').trim();
  if (s.length === 0) return 0;
  if (!/^[0-7]+$/.test(s)) throw new Error(`extract: bad octal field at offset ${off}: ${JSON.stringify(s)}`);
  return parseInt(s, 8);
}

function readName(buf, off, len) {
  const slice = buf.subarray(off, off + len);
  let end = 0;
  while (end < slice.length && slice[end] !== 0) end++;
  return slice.subarray(0, end).toString('utf8');
}

function verifyChecksum(header) {
  // The tarball stores a checksum computed with the checksum field
  // replaced by 8 ASCII spaces. We recompute and compare.
  const stored = readOctal(header, 148, 8);
  let unsigned = 0;
  for (let i = 0; i < HEADER_SIZE; i++) {
    if (i >= 148 && i < 156) unsigned += 0x20; // treat checksum field as spaces
    else unsigned += header[i];
  }
  return unsigned === stored;
}

// Returns a Map<string, Buffer>. Throws on malformed headers, bad
// checksums, path traversal, or non-regular file types.
export function readTar(buf) {
  if (!Buffer.isBuffer(buf)) throw new Error('readTar: buffer required');
  const entries = new Map();
  let i = 0;
  while (i + HEADER_SIZE <= buf.length) {
    // Two consecutive zero blocks = EOF marker.
    if (buf[i] === 0 && buf.subarray(i, i + HEADER_SIZE).every((b) => b === 0)) {
      break;
    }
    const header = buf.subarray(i, i + HEADER_SIZE);
    if (!verifyChecksum(header)) {
      throw new Error(`readTar: header checksum mismatch at offset ${i}`);
    }
    const name = readName(header, 0, 100);
    if (name.length === 0) throw new Error(`readTar: empty name at offset ${i}`);
    if (name.includes('..') || name.startsWith('/')) {
      throw new Error(`readTar: path traversal rejected: ${name}`);
    }
    const size = readOctal(header, 124, 12);
    const typeflag = header[156];
    // typeflag '0' (0x30) and NUL (0x00) both mean regular file in ustar.
    if (typeflag !== 0x30 && typeflag !== 0x00) {
      throw new Error(`readTar: only regular files supported (typeflag=${typeflag}, name=${name})`);
    }
    const bodyStart = i + HEADER_SIZE;
    const bodyEnd = bodyStart + size;
    if (bodyEnd > buf.length) {
      throw new Error(`readTar: entry ${name} truncated (size=${size}, remaining=${buf.length - bodyStart})`);
    }
    const body = Buffer.from(buf.subarray(bodyStart, bodyEnd));
    if (entries.has(name)) {
      throw new Error(`readTar: duplicate entry ${name}`);
    }
    entries.set(name, body);
    const padded = size + (size % HEADER_SIZE === 0 ? 0 : HEADER_SIZE - (size % HEADER_SIZE));
    i = bodyStart + padded;
  }
  return entries;
}
