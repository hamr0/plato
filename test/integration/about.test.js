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

async function spinUp(brandingOverrides = {}) {
  return new Promise((res) => {
    const tmpServer = http.createServer((req, r) => r.end()).listen(0, () => {
      const port = tmpServer.address().port;
      tmpServer.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'auth@test.local', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false,
          mailer: { async submit() {}, async verify() { return null; }, async close() {} },
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-about-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({
          db, auth, disposableDomains, postsDir, baseUrl,
          branding: { forumName: 'tests', hostedBy: '@tester', ...brandingOverrides },
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
  auth.close();
  db.close();
  rmSync(postsDir, { recursive: true, force: true });
}

test('GET /about: renders boilerplate + default rules with no operator config', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/about');
  assert.equal(res.status, 200);
  const body = await res.text();
  // Always-on boilerplate sections
  assert.match(body, /what data this instance keeps/i);
  assert.match(body, /your email address is never stored/i);
  assert.match(body, /if you don't trust this operator/i);
  // Default rules ship out of the box — fresh instance still has tone.
  assert.match(body, /<h3>rules<\/h3>/i);
  assert.match(body, />be civil/);
  assert.match(body, />mods are accountable/);
});

test('GET /about: explicit branding.rules:[] suppresses the rules section', async (t) => {
  const ctx = await spinUp({ rules: [] }); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/about');
  const body = await res.text();
  assert.doesNotMatch(body, /<h3>rules<\/h3>/i);
});

test('GET /about: renders rules list when branding.rules set', async (t) => {
  const ctx = await spinUp({
    rules: ['be civil', 'no spam', 'no doxxing', 'no porn'],
  });
  t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/about');
  const body = await res.text();
  assert.match(body, /<h3>rules<\/h3>/i);
  assert.match(body, />be civil</);
  assert.match(body, />no spam</);
  assert.match(body, />no doxxing</);
  assert.match(body, />no porn</);
  // Cross-surface note explaining the rules also appear in mail
  assert.match(body, /magic-link email/i);
});

test('GET /about: renders feedback mailto when feedbackEmail set', async (t) => {
  const ctx = await spinUp({ feedbackEmail: 'hello@example.test' });
  t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/about');
  const body = await res.text();
  assert.match(body, /mailto:hello@example\.test/);
});

test('GET /about: hides feedback line when feedbackEmail unset', async (t) => {
  const ctx = await spinUp();
  t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/about');
  const body = await res.text();
  assert.doesNotMatch(body, /mailto:/);
});

test('GET /: site footer always includes about + modlog links', async (t) => {
  const ctx = await spinUp();
  t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/');
  const body = await res.text();
  assert.match(body, /href="\/about">about<\/a>/);
  assert.match(body, /href="\/modlog">modlog<\/a>/);
});

test('GET /: site footer includes feedback mailto only when configured', async (t) => {
  const ctxOff = await spinUp();
  let res = await fetch(ctxOff.baseUrl + '/');
  let body = await res.text();
  assert.doesNotMatch(body, /mailto:/);
  await teardown(ctxOff);

  const ctxOn = await spinUp({ feedbackEmail: 'fb@example.test' });
  t.after(() => teardown(ctxOn));
  res = await fetch(ctxOn.baseUrl + '/');
  body = await res.text();
  assert.match(body, /href="mailto:fb@example\.test">feedback<\/a>/);
});
