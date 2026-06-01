import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The short-lived cron/queue workers install flightlog with
// { exitOnRejection:true, bootCheck:false }. Two capture paths exist and both
// matter: the global net (for scripts that let a throw propagate) and an explicit
// captureSync in a script's own catch (which bypasses the global handlers). One
// representative each — the per-script wiring is otherwise identical.

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function runWorker(rel, env) {
  const dir = mkdtempSync(join(tmpdir(), 'plato-fl-cron-'));
  const sink = join(dir, 'errors.jsonl');
  const res = spawnSync(process.execPath, [join(ROOT, 'bin', rel)], {
    env: { ...process.env, PLATO_FLIGHTLOG_FILE: sink, ...env },
    encoding: 'utf8',
  });
  let records = [];
  try {
    records = readFileSync(sink, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  } catch { /* sink absent → nothing captured */ }
  rmSync(dir, { recursive: true, force: true });
  return { res, records };
}

test('global net records a boot-time throw (check-sub-inactivity)', () => {
  // DB_PATH under a non-directory → openDb throws during module evaluation,
  // after initFlightlog has registered the handlers → uncaughtException net.
  const { res, records } = runWorker('check-sub-inactivity.js', { DB_PATH: '/dev/null/forum.db' });
  assert.notEqual(res.status, 0, 'a failed sweep must exit non-zero');
  const rec = records.find((r) => r.proc === 'inactivity');
  assert.ok(rec, 'expected a flightlog record tagged proc:inactivity');
  assert.equal(rec.kind, 'uncaught');
  assert.equal(rec.app, 'plato');
});

test('captureSync in a catch records a failure (refresh-urlhaus)', () => {
  const { res, records } = runWorker('refresh-urlhaus.js', {
    PLATO_URLHAUS_FEED: 'not-a-valid-url', // fetch rejects → main().catch → captureSync
    PLATO_URLHAUS_CACHE: join(tmpdir(), 'plato-fl-cron-never-written.txt'),
  });
  assert.notEqual(res.status, 0);
  const rec = records.find((r) => r.proc === 'urlhaus');
  assert.ok(rec, 'expected a flightlog record tagged proc:urlhaus');
  assert.equal(rec.where, 'urlhaus.main');
  assert.equal(rec.kind, 'manual');
});
