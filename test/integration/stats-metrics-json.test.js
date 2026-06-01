import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

// bin/stats.js --metrics-json is the source pulselog's digest metricsCommand
// consumes: a flat JSON object of named integers, no snapshot_at, on stdout.
test('stats.js --metrics-json prints a flat integer object (no snapshot_at)', () => {
  // Point the DBs at non-existent paths → every count() returns 0, so the test
  // is hermetic and asserts shape, not data.
  const res = spawnSync(process.execPath, [join(ROOT, 'bin', 'stats.js'), '--metrics-json'], {
    env: {
      PATH: process.env.PATH,
      DB_PATH: join(ROOT, 'does-not-exist-forum.db'),
      KNOWLESS_DB_PATH: join(ROOT, 'does-not-exist-knowless.db'),
    },
    encoding: 'utf8',
  });
  assert.equal(res.status, 0);
  const obj = JSON.parse(res.stdout.trim());
  assert.deepEqual(Object.keys(obj).sort(), ['comments', 'posts', 'subs', 'users', 'votes']);
  assert.ok(Object.values(obj).every(Number.isInteger), 'all values are integers');
  assert.equal(obj.snapshot_at, undefined, 'snapshot_at is excluded from --metrics-json');
});
