import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const GEN = join(ROOT, 'bin', 'gen-pulselog-config.js');

// Generates a pulselog config from a plato config fixture and returns the
// parsed result (or null when the generator wrote nothing). The generator reads
// process.env, so a clean env is passed to keep cases deterministic.
function gen(config, env = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'plato-pl-'));
  const cfgPath = join(dir, 'config.json');
  const outPath = join(dir, 'pulselog.config.json');
  writeFileSync(cfgPath, JSON.stringify(config));
  const res = spawnSync(process.execPath, [GEN], {
    env: { PATH: process.env.PATH, PLATO_CONFIG: cfgPath, PLATO_PULSELOG_CONFIG: outPath, ...env },
    encoding: 'utf8',
  });
  const out = existsSync(outPath) ? JSON.parse(readFileSync(outPath, 'utf8')) : null;
  rmSync(dir, { recursive: true, force: true });
  return { res, out };
}

test('backs up BOTH forum.db and knowless.db (knowless optional) + posts/config/spam', () => {
  // The 0.12.6 invariant: the identity store must not be dropped from backups.
  const { out } = gen({ operator: { email: 'ops@x.com', service: 'plato' }, branding: { baseUrl: 'https://f.example.com' } });
  const dbNames = out.backup.db.map((d) => d.name ?? d.engine);
  assert.deepEqual(dbNames, ['forum', 'knowless']);
  assert.equal(out.backup.db.find((d) => d.name === 'knowless').optional, true);
  const included = out.backup.include.map((i) => i.path);
  assert.ok(included.some((p) => p.endsWith('/posts')), 'posts/ included');
  assert.ok(included.some((p) => p.endsWith('/config.json')), 'config.json included');
  assert.ok(included.some((p) => p.endsWith('/spam-patterns.txt')), 'spam-patterns.txt included');
  assert.equal(out.backup.keepLast, 7);
});

test('digest wires bin/stats.js --metrics-json + the five metrics + flightlog rollup', () => {
  const { out } = gen({ operator: { email: 'ops@x.com' } });
  assert.deepEqual(out.digest.metricsCommand, { command: 'node', args: ['bin/stats.js', '--metrics-json'] });
  assert.deepEqual(out.digest.metrics.map((m) => m.name), ['users', 'subs', 'posts', 'comments', 'votes']);
  assert.ok(out.digest.flightlog.file.endsWith('/errors.jsonl'), 'digest reads flightlog sink');
});

test('health probes localhost /healthz and tails the flightlog sink in alerts', () => {
  const { out } = gen({ operator: { email: 'ops@x.com' } }, { PORT: '9999' });
  const http = out.checks.find((c) => c.name === 'app');
  assert.equal(http.url, 'http://127.0.0.1:9999/healthz');
  assert.equal(out.alert.email, 'ops@x.com');
  assert.ok(out.alert.logTail.endsWith('/errors.jsonl'));
});

test('health check set is the acute ones only — no cert (that stays on the daily check-cert.sh)', () => {
  // pulselog runs every 5 min and re-emails per failing run; a slow cert check
  // would storm the inbox for ~2 weeks before expiry, so cert is NOT here.
  const { out } = gen({ operator: {}, branding: { baseUrl: 'https://forum.example.com' } });
  assert.deepEqual(out.checks.map((c) => c.name), ['app', 'disk', 'backup', 'service']);
  assert.ok(!out.checks.some((c) => c.type === 'ssl'), 'no ssl/cert check in the 5-min health run');
});

test('alert from is an on-domain sender, NOT the operator mailbox (Gmail 550-5.7.26 guard)', () => {
  // The box sends via its own Postfix; From: a gmail.com mailbox is unauthenticated
  // spoofing and Gmail rejects it. Derive noreply@<domain> from the app's signed
  // identity (KNOWLESS_FROM), applied to all three mail modes.
  const { out } = gen(
    { operator: { email: 'avoidaccess@gmail.com', service: 'plato' } },
    { KNOWLESS_FROM: 'auth@forum.example.com' },
  );
  assert.equal(out.alert.from, 'noreply@forum.example.com');
  assert.equal(out.digest.from, 'noreply@forum.example.com');
  assert.equal(out.backup.from, 'noreply@forum.example.com');
  assert.equal(out.alert.email, 'avoidaccess@gmail.com', 'recipient stays the operator');
});

test('branding.baseUrl is a from-domain source when no KNOWLESS_FROM env', () => {
  const { out } = gen({ operator: { email: 'ops@x.com' }, branding: { baseUrl: 'https://f.example.com' } });
  assert.equal(out.alert.from, 'noreply@f.example.com');
});

test('operator.mailFrom overrides the derived sender (msmtp→Gmail recipe)', () => {
  const { out } = gen(
    { operator: { email: 'me@gmail.com', mailFrom: 'me@gmail.com' } },
    { KNOWLESS_FROM: 'auth@forum.example.com' },
  );
  assert.equal(out.alert.from, 'me@gmail.com');
});

test('no operator.email → log-only (no mail keys anywhere)', () => {
  const { out } = gen({ operator: { service: 'plato' } });
  assert.equal(out.alert.email, undefined);
  assert.equal(out.digest.email, undefined);
  assert.equal(out.backup.email, undefined);
});

test('backupKeepLast + diskMaxPercent default to the safe values when unset', () => {
  const { out } = gen({ operator: { email: 'ops@x.com' } });
  assert.equal(out.backup.keepLast, 7);
  assert.equal(out.checks.find((c) => c.name === 'disk').maxPercent, 90);
});

test('operator can override backupKeepLast + diskMaxPercent', () => {
  const { out } = gen({ operator: { email: 'ops@x.com', backupKeepLast: 3, diskMaxPercent: 80 } });
  assert.equal(out.backup.keepLast, 3);
  assert.equal(out.checks.find((c) => c.name === 'disk').maxPercent, 80);
});

test('a bad threshold fails the deploy loudly — no config written, non-zero exit', () => {
  for (const operator of [
    { backupKeepLast: 0 },          // pulselog requires >= 1; 0 would wipe every backup
    { backupKeepLast: 7.5 },        // non-integer
    { diskMaxPercent: 100 },        // 100 never trips — out of [50..99]
    { diskMaxPercent: 'lots' },     // wrong type
  ]) {
    const { res, out } = gen({ operator });
    assert.equal(out, null, `no config written for ${JSON.stringify(operator)}`);
    assert.notEqual(res.status, 0, `non-zero exit for ${JSON.stringify(operator)}`);
  }
});

test('operator.monitoring:false is the off switch — writes nothing, exits 0', () => {
  const { res, out } = gen({ operator: { monitoring: false, email: 'ops@x.com' } });
  assert.equal(out, null, 'no config written when monitoring is off');
  assert.equal(res.status, 0);
});

test('no fallback sink by default — omitted from all three modes (zero vendor coupling)', () => {
  const { out } = gen({ operator: { email: 'ops@x.com' } });
  assert.equal(out.alert.fallback, undefined);
  assert.equal(out.digest.fallback, undefined);
  assert.equal(out.backup.fallback, undefined);
});

test('operator.fallbackCommand wires an opt-in fallback sink with per-mode when defaults', () => {
  // health/backup fire only on failure → "always" (also survives an async bounce
  // after a clean handoff); digest emails weekly → "on-primary-failure" (no dupe).
  const { out } = gen({ operator: { email: 'ops@x.com', fallbackCommand: '/usr/local/bin/notify.sh' } });
  assert.deepEqual(out.alert.fallback, { when: 'always', command: '/usr/local/bin/notify.sh', timeoutMs: 15000 });
  assert.equal(out.digest.fallback.when, 'on-primary-failure');
  assert.equal(out.backup.fallback.when, 'always');
});

test('operator.fallbackArgs + fallbackWhen override are threaded through', () => {
  const { out } = gen({ operator: {
    email: 'ops@x.com',
    fallbackCommand: 'curl',
    fallbackArgs: ['-m', '10', '-fsS', '-d', '@-', 'https://ntfy.sh/topic'],
    fallbackWhen: 'always',
  } });
  assert.deepEqual(out.alert.fallback.args, ['-m', '10', '-fsS', '-d', '@-', 'https://ntfy.sh/topic']);
  assert.equal(out.digest.fallback.when, 'always', 'global fallbackWhen overrides the per-mode default');
});

test('fallback is emitted even with no operator.email (sole sink — a box with no MTA)', () => {
  const { out } = gen({ operator: { fallbackCommand: '/usr/local/bin/notify.sh' } });
  assert.equal(out.alert.email, undefined, 'no primary email');
  assert.equal(out.alert.fallback.command, '/usr/local/bin/notify.sh', 'fallback still present as sole sink');
});

test('a bad operator.fallbackWhen fails the deploy loudly — writes nothing', () => {
  const { res, out } = gen({ operator: { email: 'ops@x.com', fallbackCommand: 'x', fallbackWhen: 'sometimes' } });
  assert.equal(out, null, 'no config written on invalid input');
  assert.notEqual(res.status, 0, 'generator exits non-zero');
});
