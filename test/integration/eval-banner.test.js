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

async function spinUp({ evalBanner = false } = {}) {
  return new Promise((res) => {
    const tmp = http.createServer((q, r) => r.end()).listen(0, () => {
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
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-eval-banner-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({
          db, auth, disposableDomains, postsDir, baseUrl,
          evalBanner,
        });
        const server = http.createServer(app).listen(port, () => {
          res({ db, auth, postsDir, baseUrl, server });
        });
      });
    });
  });
}
async function teardown({ auth, db, postsDir, server }) {
  await new Promise((r) => server.close(r));
  auth.close(); db.close();
  rmSync(postsDir, { recursive: true, force: true });
}

test('eval banner: hidden by default (no createApp option)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  for (const path of ['/', '/about', '/subs']) {
    const res = await fetch(ctx.baseUrl + path);
    const body = await res.text();
    assert.doesNotMatch(body, /eval-banner/, `${path} should not render banner`);
    assert.doesNotMatch(body, /evaluation image/i, `${path} should not include eval text`);
  }
});

test('eval banner: rendered on every page when evalBanner: true', async (t) => {
  const ctx = await spinUp({ evalBanner: true }); t.after(() => teardown(ctx));
  for (const path of ['/', '/about', '/subs']) {
    const res = await fetch(ctx.baseUrl + path);
    const body = await res.text();
    assert.match(body, /<div class="eval-banner"/, `${path} must render banner`);
    assert.match(body, /evaluation image/i, `${path} must include eval text`);
    assert.match(body, /operator-guide\.md/, `${path} must link to operator guide`);
  }
});

test('eval banner: appears before the page header (top of <body>)', async (t) => {
  const ctx = await spinUp({ evalBanner: true }); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/');
  const body = await res.text();
  const bannerIdx = body.indexOf('eval-banner');
  const headerIdx = body.indexOf('<header');
  assert.ok(bannerIdx > 0 && headerIdx > 0, 'both must be present');
  assert.ok(bannerIdx < headerIdx, 'banner must precede header');
});
