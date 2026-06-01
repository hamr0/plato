import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';

// openDb is the single connection factory; every server + cron-worker DB handle
// flows through it. These lock in the connection-level pragmas it must apply.
// We assert *that we set them* (the read-back value) — SQLite honoring the
// busy_timeout is the engine's job, not ours to re-test.
test('openDb applies foreign_keys, WAL, and a busy_timeout', () => {
  const dir = mkdtempSync(join(tmpdir(), 'plato-db-'));
  const db = openDb(join(dir, 'forum.db'));
  try {
    assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
    assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode, 'wal');
    // The fix: a contended BEGIN IMMEDIATE must wait, not throw SQLITE_BUSY on
    // the first collision (export + import cron workers + the live server all
    // write forum.db). 0 would mean no wait — the pre-fix behavior.
    assert.equal(db.prepare('PRAGMA busy_timeout').get().timeout, 5000);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
