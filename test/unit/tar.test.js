// Unit tests for the minimal USTAR writer (M7/B2-a).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeTar } from '../../src/archive/tar.js';

// In-memory tar reader, ustar only, regular files only. Returns
// [{path, body}, ...] in archive order. Exists for test verification.
function readTar(buf) {
  const out = [];
  let i = 0;
  while (i + 512 <= buf.length) {
    // EOF marker = two zero blocks. Detect by checking that the first
    // byte of the header is 0 (name field would never start with NUL for
    // a real entry).
    if (buf[i] === 0) break;
    const name = buf.slice(i, i + 100).toString('utf8').replace(/\0+$/, '');
    const sizeStr = buf.slice(i + 124, i + 124 + 11).toString('ascii').replace(/\0/g, '');
    const size = parseInt(sizeStr, 8);
    const typeflag = buf.slice(i + 156, i + 157).toString('ascii');
    const magic = buf.slice(i + 257, i + 263).toString('ascii');
    if (magic !== 'ustar\0') throw new Error(`readTar: bad magic at offset ${i}: ${JSON.stringify(magic)}`);
    if (typeflag !== '0' && typeflag !== '\0') throw new Error(`readTar: only regular files supported, got typeflag=${JSON.stringify(typeflag)}`);
    const body = buf.slice(i + 512, i + 512 + size);
    out.push({ path: name, body: Buffer.from(body) });
    const padded = size + (size % 512 === 0 ? 0 : 512 - (size % 512));
    i += 512 + padded;
  }
  return out;
}

test('writeTar: single file round-trips', () => {
  const buf = writeTar([{ path: 'hello.txt', body: 'hi there' }]);
  const entries = readTar(buf);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].path, 'hello.txt');
  assert.equal(entries[0].body.toString('utf8'), 'hi there');
});

test('writeTar: multi-file in declared order', () => {
  const buf = writeTar([
    { path: 'a.md', body: 'aaaa' },
    { path: 'b/c.json', body: '{}' },
    { path: 'big.txt', body: Buffer.alloc(513, 'x') },
  ]);
  const entries = readTar(buf);
  assert.equal(entries.length, 3);
  assert.deepEqual(entries.map((e) => e.path), ['a.md', 'b/c.json', 'big.txt']);
  assert.equal(entries[2].body.length, 513);
});

test('writeTar: 512-byte padding boundary', () => {
  const buf = writeTar([{ path: 'exact.txt', body: Buffer.alloc(512, 'x') }]);
  // header(512) + body(512) + zero-block(512) + zero-block(512) = 2048
  assert.equal(buf.length, 2048);
  const entries = readTar(buf);
  assert.equal(entries[0].body.length, 512);
});

test('writeTar: empty body is allowed and round-trips', () => {
  const buf = writeTar([{ path: 'empty', body: '' }]);
  const entries = readTar(buf);
  assert.equal(entries[0].body.length, 0);
});

test('writeTar: rejects path > 100 chars', () => {
  const longPath = 'x'.repeat(101);
  assert.throws(() => writeTar([{ path: longPath, body: 'x' }]), /path too long/);
});

test('writeTar: rejects invalid entry shape', () => {
  assert.throws(() => writeTar('nope'), /entries must be an array/);
  assert.throws(() => writeTar([null]), /each entry must be an object/);
  assert.throws(() => writeTar([{ path: 'x', body: 42 }]), /body must be Buffer or string/);
});

test('writeTar: ends with two zero blocks', () => {
  const buf = writeTar([{ path: 'a', body: 'a' }]);
  const last1024 = buf.slice(buf.length - 1024);
  assert.ok(last1024.every((b) => b === 0), 'last 1024 bytes should be all zero (EOF marker)');
});
