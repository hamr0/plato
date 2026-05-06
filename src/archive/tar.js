// Minimal POSIX USTAR writer (M7/B2-a).
//
// Produces an in-memory tarball Buffer from a list of {path, body, mtime}
// entries. No streaming, no add-on features — the archives are hobby-scale
// (~MB to low-tens-of-MB) and a single Buffer keeps the surface tiny.
//
// Format reference: POSIX 1003.1-1990 ustar. Each file is one 512-byte
// header + body padded to a 512-byte boundary, followed by two 512-byte
// zero blocks at the very end (the EOF marker).
//
// Constraints we accept:
//   - Path length ≤ 100 chars (USTAR's `prefix` field is unused; throws
//     on overflow). All plato archive paths are short by spec.
//   - Bodies are Buffers or strings; max ~8 GB (octal size field limit).
//   - Mode is fixed at 0644 (regular files); we don't pack directories.

const HEADER_SIZE = 512;
const MAX_NAME = 100;
const MAX_SIZE = 0o77777777777; // 11 octal digits

function octal(n, width) {
  const s = n.toString(8);
  if (s.length > width) throw new Error(`tar: octal value ${n} exceeds field width ${width}`);
  return s.padStart(width, '0');
}

function buildHeader({ name, size, mtime }) {
  if (typeof name !== 'string' || name.length === 0) {
    throw new Error('tar: name must be a non-empty string');
  }
  if (name.length > MAX_NAME) {
    throw new Error(`tar: path too long for ustar (${name.length} > ${MAX_NAME}): ${name}`);
  }
  if (!Number.isInteger(size) || size < 0 || size > MAX_SIZE) {
    throw new Error(`tar: invalid size ${size} for ${name}`);
  }
  const buf = Buffer.alloc(HEADER_SIZE, 0);
  buf.write(name, 0, 100, 'utf8');
  buf.write(octal(0o644, 7) + '\0', 100, 8, 'ascii');           // mode
  buf.write(octal(0, 7) + '\0', 108, 8, 'ascii');               // uid
  buf.write(octal(0, 7) + '\0', 116, 8, 'ascii');               // gid
  buf.write(octal(size, 11) + '\0', 124, 12, 'ascii');          // size
  buf.write(octal(Math.floor(mtime / 1000), 11) + '\0', 136, 12, 'ascii'); // mtime in seconds
  // checksum field (offset 148, 8 bytes) — first written as 8 spaces so
  // the unsigned-byte sum below covers a known placeholder, then replaced
  // with the actual computed value.
  buf.write('        ', 148, 8, 'ascii');
  buf.write('0', 156, 1, 'ascii');                              // typeflag '0' = regular file
  buf.write('ustar\0', 257, 6, 'ascii');                        // magic
  buf.write('00', 263, 2, 'ascii');                             // version
  // name/uname/gname/devmajor/devminor/prefix all stay zero.

  let sum = 0;
  for (let i = 0; i < HEADER_SIZE; i++) sum += buf[i];
  buf.write(octal(sum, 6) + '\0 ', 148, 8, 'ascii');
  return buf;
}

function pad512(n) {
  const r = n % HEADER_SIZE;
  return r === 0 ? 0 : HEADER_SIZE - r;
}

// entries: array of { path: string, body: Buffer | string, mtime?: number (unix ms) }
// Returns a Buffer containing the full tarball with EOF marker.
export function writeTar(entries, { defaultMtime = Date.now() } = {}) {
  if (!Array.isArray(entries)) throw new Error('writeTar: entries must be an array');
  const parts = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') throw new Error('writeTar: each entry must be an object');
    const body = typeof e.body === 'string' ? Buffer.from(e.body, 'utf8') : e.body;
    if (!Buffer.isBuffer(body)) throw new Error(`writeTar: body must be Buffer or string for ${e.path}`);
    const header = buildHeader({
      name: e.path,
      size: body.length,
      mtime: e.mtime ?? defaultMtime,
    });
    parts.push(header, body);
    const pad = pad512(body.length);
    if (pad > 0) parts.push(Buffer.alloc(pad, 0));
  }
  // EOF marker: two consecutive zero blocks.
  parts.push(Buffer.alloc(HEADER_SIZE * 2, 0));
  return Buffer.concat(parts);
}
