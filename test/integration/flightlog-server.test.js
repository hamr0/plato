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

// Proves the 0.12.12 server path: when a route throws, the top-level handler
// catch flight-records it (the `captureError` threaded in from bin/server.js)
// alongside the 500, with the query string stripped from `path`.
test('a server-side request 500 is flight-recorded with where:request and a stripped path', async () => {
  const tmp = http.createServer((req, r) => r.end());
  const port = await new Promise((r) => tmp.listen(0, () => r(tmp.address().port)));
  await new Promise((r) => tmp.close(r));
  const baseUrl = `http://localhost:${port}`;

  const db = openDb(':memory:');
  applyAllMigrations(db);

  // db that throws on any access once armed — armed AFTER construction +
  // migrations, so only the in-flight request trips it. Bind methods so the
  // un-armed path behaves like the real handle.
  let armed = false;
  const throwingDb = new Proxy(db, {
    get(t, p, r) {
      if (armed) throw new Error('forced-500');
      const v = Reflect.get(t, p, r);
      return typeof v === 'function' ? v.bind(t) : v;
    },
  });

  const auth = knowless({
    secret: randomBytes(32).toString('hex'),
    baseUrl, from: 'auth@test.local', dbPath: ':memory:',
    openRegistration: true, cookieSecure: false,
    mailer: { async submit() {}, async verify() { return null; }, async close() {} },
  });
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-fl-srv-posts-'));
  const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);

  const captured = [];
  const app = createApp({
    db: throwingDb, auth, disposableDomains, postsDir, baseUrl,
    branding: { forumName: 'tests' },
    captureError: (err, extra) => captured.push({ err, extra }),
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(port, r));

  try {
    armed = true;
    // `/` (renderHome) reads the feed from the db → throws → top-level catch.
    // `?token=secret` rides along to prove the query string is stripped.
    const resp = await fetch(`${baseUrl}/?token=secret`);
    armed = false;
    assert.equal(resp.status, 500);
    assert.equal(captured.length, 1, 'exactly one capture for one failed request');
    const { extra } = captured[0];
    assert.equal(extra.where, 'request');
    assert.equal(extra.method, 'GET');
    assert.equal(extra.path, '/', 'query string must be stripped — no token in the log');
    assert.ok(captured[0].err instanceof Error);
  } finally {
    armed = false;
    await new Promise((r) => server.close(r));
    auth.close();
    db.close();
    rmSync(postsDir, { recursive: true, force: true });
  }
});
