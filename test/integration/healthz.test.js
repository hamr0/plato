import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { knowless } from 'knowless';
import { openDb } from '../../src/db/index.js';
import { loadDisposableDomains } from '../../src/content/disposable-domain.js';
import { createApp } from '../../src/web/app.js';
import { applyAllMigrations } from '../_helpers/migrations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

async function spinUp({ exportsDir = 'auto' } = {}) {
  return new Promise((res) => {
    const tmp = http.createServer((req, r) => r.end()).listen(0, () => {
      const port = tmp.address().port;
      tmp.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'auth@test.local', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false,
          mailer: { async submit() {}, async verify() { return null; }, async close() {} },
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-healthz-posts-'));
        const resolvedExportsDir = exportsDir === 'auto'
          ? mkdtempSync(join(tmpdir(), 'plato-healthz-exports-'))
          : exportsDir;
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({
          db, auth, disposableDomains, postsDir, baseUrl,
          exportsDir: resolvedExportsDir,
          branding: { forumName: 'tests' },
        });
        const server = http.createServer(app).listen(port, () => {
          res({ db, auth, postsDir, exportsDir: resolvedExportsDir, baseUrl, server });
        });
      });
    });
  });
}

async function teardown({ auth, db, postsDir, exportsDir, server }) {
  await new Promise((r) => server.close(r));
  auth.close();
  db.close();
  rmSync(postsDir, { recursive: true, force: true });
  if (exportsDir && typeof exportsDir === 'string') {
    rmSync(exportsDir, { recursive: true, force: true });
  }
}

test('GET /healthz: 200 + ok=true when db + exports dir are writable', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const body = await res.json();
  assert.equal(body.ok, true);
  assert.equal(body.db_writable, true);
  assert.equal(body.exports_dir_writable, true);
  assert.equal(typeof body.uptime_s, 'number');
  assert.ok(body.uptime_s >= 0);
  assert.equal(typeof body.version, 'string');
  assert.match(body.version, /^\d+\.\d+\.\d+/);
});

test('GET /healthz: last_migration reads from schema_migrations tail', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  // applyAllMigrations runs the SQL files but doesn't populate
  // schema_migrations (that's bin/migrate.js's job in production). Mirror
  // the prod bookkeeping here so the end-to-end healthz path is exercised.
  ctx.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`);
  ctx.db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)')
    .run('001_init.sql', 1000);
  ctx.db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)')
    .run('999_latest.sql', 2000);
  const res = await fetch(ctx.baseUrl + '/healthz');
  const body = await res.json();
  assert.equal(body.last_migration, '999_latest.sql');
});

test('GET /healthz: last_migration is null when schema_migrations is absent', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/healthz');
  const body = await res.json();
  assert.equal(body.last_migration, null);
});

test('GET /healthz: 503 + ok=false when exports dir is missing', async (t) => {
  const missing = join(tmpdir(), `plato-healthz-missing-${randomBytes(4).toString('hex')}`);
  const ctx = await spinUp({ exportsDir: missing }); t.after(() => teardown({ ...ctx, exportsDir: null }));
  const res = await fetch(ctx.baseUrl + '/healthz');
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.exports_dir_writable, false);
  assert.equal(body.db_writable, true);
});

test('GET /healthz: 503 + ok=false when exportsDir is not configured', async (t) => {
  const ctx = await spinUp({ exportsDir: null }); t.after(() => teardown({ ...ctx, exportsDir: null }));
  const res = await fetch(ctx.baseUrl + '/healthz');
  assert.equal(res.status, 503);
  const body = await res.json();
  assert.equal(body.ok, false);
  assert.equal(body.exports_dir_writable, false);
});

test('GET /healthz: schema shape — all expected keys present', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/healthz');
  const body = await res.json();
  const keys = Object.keys(body).sort();
  assert.deepEqual(keys, [
    'db_writable',
    'exports_dir_writable',
    'last_migration',
    'ok',
    'uptime_s',
    'version',
  ]);
});

test('HEAD /healthz: 200, no body, same headers as GET (uptime monitors / curl -I)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/healthz', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  // Node strips the body on HEAD automatically; verify nothing leaked.
  const body = await res.text();
  assert.equal(body, '');
});

test('HEAD /static/<file>: 200, image/* content-type (link-preview validators / curl -I)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/static/og.png', { method: 'HEAD' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'image/png');
  const body = await res.text();
  assert.equal(body, '');
});
