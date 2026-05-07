// OpenTimestamps shell-out wrapper tests (M7/B6).
//
// We don't depend on the real `ots` CLI being installed in CI — instead
// we synthesize a tiny stub binary in a tmp dir, point OTS_BIN at it,
// and verify our wrapper handles each path: success, non-zero exit,
// timeout, ENOENT.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { stampFile, upgradeFile } from '../../src/archive/timestamp.js';

function makeStubBin(tmp, name, body) {
  const bin = join(tmp, name);
  writeFileSync(bin, `#!/usr/bin/env bash\n${body}\n`);
  chmodSync(bin, 0o755);
  return bin;
}

test('stampFile: success — writes <abs>.ots, returns proofPath', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const archive = join(tmp, 'archive.tar.gz');
    writeFileSync(archive, 'fake-archive-bytes');
    // stub: when called with [stamp, <path>], write <path>.ots and exit 0
    const bin = makeStubBin(tmp, 'ots', 'if [ "$1" = "stamp" ]; then echo "fake proof bytes" > "$2.ots"; exit 0; fi; exit 99');
    const r = await stampFile(archive, { bin });
    assert.equal(r.error, undefined, `unexpected error: ${r.error}`);
    assert.equal(r.proofPath, `${archive}.ots`);
    assert.equal(existsSync(`${archive}.ots`), true);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('stampFile: missing binary → soft error "ots not found"', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const archive = join(tmp, 'archive.tar.gz');
    writeFileSync(archive, 'x');
    const r = await stampFile(archive, { bin: '/no/such/binary/here' });
    assert.equal(r.error, 'ots not found');
    assert.equal(r.proofPath, undefined);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('stampFile: non-zero exit → error includes exit code + stderr', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const archive = join(tmp, 'archive.tar.gz');
    writeFileSync(archive, 'x');
    const bin = makeStubBin(tmp, 'ots', 'echo "calendar unreachable" >&2; exit 7');
    const r = await stampFile(archive, { bin });
    assert.match(r.error, /ots stamp exit 7/);
    assert.match(r.error, /calendar unreachable/);
    // proof file never appeared
    assert.equal(existsSync(`${archive}.ots`), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('stampFile: success but proof file missing → flagged as error', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const archive = join(tmp, 'archive.tar.gz');
    writeFileSync(archive, 'x');
    // stub exits 0 without writing the .ots — pathological but worth defending
    const bin = makeStubBin(tmp, 'ots', 'exit 0');
    const r = await stampFile(archive, { bin });
    assert.match(r.error, /ots proof file missing after stamp/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('stampFile: hangs past timeout → killed, soft error', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const archive = join(tmp, 'archive.tar.gz');
    writeFileSync(archive, 'x');
    const bin = makeStubBin(tmp, 'ots', 'sleep 10');
    const r = await stampFile(archive, { bin, timeoutMs: 200 });
    assert.equal(r.error, 'ots timeout');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgradeFile: success — exit 0, no error', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const proof = join(tmp, 'archive.tar.gz.ots');
    writeFileSync(proof, 'fake proof');
    const bin = makeStubBin(tmp, 'ots', 'echo "upgraded" ; exit 0');
    const r = await upgradeFile(proof, { bin });
    assert.equal(r.ok, true);
    assert.match(r.stdout, /upgraded/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgradeFile: non-zero exit → error with exit code', async () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-otstest-'));
  try {
    const proof = join(tmp, 'archive.tar.gz.ots');
    writeFileSync(proof, 'fake');
    const bin = makeStubBin(tmp, 'ots', 'echo "still pending bitcoin" >&2; exit 1');
    const r = await upgradeFile(proof, { bin });
    assert.match(r.error, /ots upgrade exit 1/);
    assert.match(r.stderr, /still pending bitcoin/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('upgradeFile: missing binary → soft error', async () => {
  const r = await upgradeFile('/tmp/whatever.ots', { bin: '/no/such/binary' });
  assert.equal(r.error, 'ots not found');
});
