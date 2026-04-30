import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { knowless } from 'knowless';
import { openDb } from '../../src/db/index.js';
import { loadDisposableDomains } from '../../src/content/disposable-domain.js';
import { createApp } from '../../src/web/app.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATION_001 = readFileSync(
  resolve(HERE, '../../src/db/migrations/001_initial.sql'),
  'utf8'
);
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

// Capture mailer: implements the {submit, verify, close} interface knowless
// expects. Records every email instead of sending. Tests then parse the magic
// link out of the body and exercise the full click flow via fetch().
function createCaptureMailer() {
  const sent = [];
  return {
    sent,
    async submit({ to, subject, body }) {
      sent.push({ to, subject, body });
      return { messageId: `<capture-${sent.length}@test>` };
    },
    async verify() { return true; },
    close() {},
  };
}

function magicLinkFrom(email) {
  // Knowless mail body contains the magic link on its own line. Find any
  // http(s) URL ending in /auth/callback?t=<token>.
  const match = email.body.match(/https?:\/\/\S+\/auth\/callback\?t=\S+/);
  if (!match) throw new Error(`no magic link found in mail body:\n${email.body}`);
  return match[0];
}

async function spinUp() {
  const db = openDb(':memory:');
  db.exec(MIGRATION_001);

  const mailer = createCaptureMailer();
  const auth = knowless({
    secret: randomBytes(32).toString('hex'),
    baseUrl: 'http://placeholder.invalid',  // overridden below per-instance
    from: 'auth@test.local',
    dbPath: ':memory:',
    openRegistration: true,
    cookieSecure: false,
    mailer,  // ← capture instead of SMTP
  });

  const postsDir = mkdtempSync(join(tmpdir(), 'plato-app-'));
  const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);

  // Will fill baseUrl after server.listen — but knowless was already constructed
  // with placeholder. We replace the auth.config.baseUrl path used by startLogin
  // by reconstructing auth once we know the port. Simpler: hardcode test baseUrl
  // and find the matching port. Easier: just listen on 0, capture port, then
  // swap auth's config (knowless exposes config but it's read-only by contract).
  //
  // Cleaner approach: listen first, then construct knowless with the real URL.
  // Refactor below.
  return { db, auth, mailer, postsDir };
}

async function spinUpWithPort() {
  // Listen on 0 first, capture port, then construct auth with real baseUrl.
  return new Promise((res) => {
    const tmpServer = http.createServer((req, r) => r.end()).listen(0, () => {
      const port = tmpServer.address().port;
      tmpServer.close(() => {
        const baseUrl = `http://localhost:${port}`;

        const db = openDb(':memory:');
        db.exec(MIGRATION_001);

        const mailer = createCaptureMailer();
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl,
          from: 'auth@test.local',
          dbPath: ':memory:',
          openRegistration: true,
          cookieSecure: false,
          mailer,
        });

        const postsDir = mkdtempSync(join(tmpdir(), 'plato-app-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({ db, auth, disposableDomains, postsDir, baseUrl });
        const server = http.createServer(app).listen(port, () => {
          res({ db, auth, mailer, postsDir, baseUrl, server });
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

// Cookie jar that survives across fetch() calls.
function newJar() {
  const cookies = new Map();
  return {
    update(setCookieHeader) {
      if (!setCookieHeader) return;
      // Simple parsing: take only name=value (drop attributes).
      const headers = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader];
      for (const raw of headers) {
        const head = raw.split(';')[0];
        const eq = head.indexOf('=');
        if (eq === -1) continue;
        const name = head.slice(0, eq).trim();
        const value = head.slice(eq + 1).trim();
        cookies.set(name, value);
      }
    },
    header() {
      return [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    },
  };
}

async function jarFetch(jar, url, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  const cookieHeader = jar.header();
  if (cookieHeader) headers.Cookie = cookieHeader;
  const response = await fetch(url, { ...opts, headers, redirect: 'manual' });
  const setCookie = response.headers.getSetCookie?.() ?? response.headers.get('set-cookie');
  jar.update(setCookie);
  return response;
}

test('end-to-end: stranger posts → magic link → click → published post visible', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { mailer, baseUrl } = ctx;

  const jar = newJar();

  // 1. Home page renders, no posts yet
  let res = await jarFetch(jar, baseUrl + '/');
  assert.equal(res.status, 200);
  let html = await res.text();
  assert.match(html, /no posts yet/);

  // 2. Submit a draft (POST /draft)
  res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'alice@example.com',
      title: 'first post',
      body: '# hello\n\nworld **bold**',
    }),
  });
  assert.equal(res.status, 200);
  html = await res.text();
  assert.match(html, /check your email/i);

  // 3. Mailer captured exactly one email
  assert.equal(mailer.sent.length, 1, 'one magic-link mail captured');
  assert.equal(mailer.sent[0].to, 'alice@example.com');

  // 4. Extract magic link, click it
  const magicLink = magicLinkFrom(mailer.sent[0]);
  res = await jarFetch(jar, magicLink);
  // Knowless callback redeems the token, sets a session cookie, redirects to nextUrl.
  assert.equal(res.status, 302);
  const next = res.headers.get('location');
  assert.match(next, /\/draft\/[0-9a-f]{16}\/finalize$/);

  // 5. Follow redirect to /draft/<id>/finalize
  res = await jarFetch(jar, new URL(next, baseUrl).toString());
  assert.equal(res.status, 302);
  const postUrl = res.headers.get('location');
  assert.match(postUrl, /\/post\/[0-9a-f]{16}$/);

  // 6. View the post
  res = await jarFetch(jar, new URL(postUrl, baseUrl).toString());
  assert.equal(res.status, 200);
  html = await res.text();
  assert.match(html, /first post/, 'title rendered');
  assert.match(html, /<h1>hello<\/h1>/, 'markdown body rendered');
  assert.match(html, /<strong>bold<\/strong>/);
  assert.match(html, /<img src="\/avatar\/[0-9a-f]{64}\.svg"/, 'identicon shown');
  assert.match(html, /[a-z]+-[a-z]+/, 'pseudonym shown');

  // 7. Home page now shows the post
  res = await jarFetch(jar, baseUrl + '/');
  assert.equal(res.status, 200);
  html = await res.text();
  assert.match(html, /first post/);

  // 8. Returning user is shown as logged in (cookie still in jar)
  assert.match(html, /logged in as/);
});

test('disposable email is rejected at /draft, knowless never invoked', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { mailer, baseUrl } = ctx;

  const res = await fetch(baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'spam@mailinator.com',
      title: 't',
      body: 'b',
    }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /disposable email/);
  assert.equal(mailer.sent.length, 0, 'knowless was never reached');
});

test('finalize without session redirects with a 401-style message', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  // Insert a draft directly to skip the auth flow
  const draftId = 'a'.repeat(16);
  db.prepare('INSERT INTO drafts (id, title, body, created_at) VALUES (?, ?, ?, ?)')
    .run(draftId, 't', 'b', Date.now());

  const res = await fetch(`${baseUrl}/draft/${draftId}/finalize`);
  assert.equal(res.status, 401);
  assert.match(await res.text(), /not logged in|session expired/);
});

test('GET /post/<unknown> returns 404', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;

  const res = await fetch(`${baseUrl}/post/${'0'.repeat(16)}`);
  assert.equal(res.status, 404);
});

test('GET /avatar/<handle>.svg returns SVG', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;

  const res = await fetch(`${baseUrl}/avatar/${'a'.repeat(64)}.svg`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg\+xml/);
  const svg = await res.text();
  assert.match(svg, /^<svg/);
});

test('GET /static/style.css served', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;

  const res = await fetch(`${baseUrl}/static/style.css`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/css/);
});

test('SECURITY: title with HTML is escaped on home page', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  // Insert handle + post directly (bypass auth flow for focused test)
  const handle = 'b'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, 'test-handle', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, 'general', ?, ?, ?, ?)`)
    .run('1'.repeat(16), handle, '<script>alert(1)</script>', 'posts/test.md', Date.now());

  const res = await fetch(baseUrl + '/');
  const html = await res.text();
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/, 'title HTML must be escaped');
  assert.match(html, /&lt;script&gt;/);
});
