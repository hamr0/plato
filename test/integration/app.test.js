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

async function spinUpWithPort() {
  // Listen on 0 first, capture port, then construct auth with real baseUrl.
  return new Promise((res) => {
    const tmpServer = http.createServer((req, r) => r.end()).listen(0, () => {
      const port = tmpServer.address().port;
      tmpServer.close(() => {
        const baseUrl = `http://localhost:${port}`;

        const db = openDb(':memory:');
        applyAllMigrations(db);

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

function ensureSub(db, name) {
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run(name, Date.now());
}

test('end-to-end: stranger posts → magic link → click → published post visible', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;

  // PRD §Permanently out: no default catch-all sub. Operator/admin step.
  ensureSub(db, 'lobby');

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
      sub_name: 'lobby',
      title: 'first post',
      body: 'world **bold**\n\n# tail',
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

  // 5. Follow redirect to /draft/<id>/finalize → /sub/<sub_name>
  res = await jarFetch(jar, new URL(next, baseUrl).toString());
  assert.equal(res.status, 302);
  const subUrl = res.headers.get('location');
  assert.match(subUrl, /\/sub\/lobby$/, 'finalize redirects to the sub the post landed in');

  // 6. View the sub page; the new post (preview) is on it
  res = await jarFetch(jar, new URL(subUrl, baseUrl).toString());
  assert.equal(res.status, 200);
  html = await res.text();
  assert.match(html, /first post/, 'title rendered on sub page');
  assert.match(html, /<strong>bold<\/strong>/, 'preview markdown rendered');
  assert.match(html, /<img src="\/avatar\/[0-9a-f]{64}\.svg"/, 'identicon shown');
  assert.match(html, /[a-z]+-[a-z]+/, 'pseudonym shown');

  // 7. Home page now shows the post
  res = await jarFetch(jar, baseUrl + '/');
  assert.equal(res.status, 200);
  html = await res.text();
  assert.match(html, /first post/);

  // 8. Returning user's status block is rendered (cookie still in jar)
  assert.match(html, /class="status muted"/);
});

test('logged-in user posts directly without re-doing magic link', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;

  ensureSub(db, 'lobby');

  const jar = newJar();

  // Establish session: one full magic-link round trip on a first post.
  let res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'alice@example.com',
      sub_name: 'lobby',
      title: 'first',
      body: 'first body',
    }),
  });
  assert.equal(res.status, 200);
  assert.equal(mailer.sent.length, 1);
  res = await jarFetch(jar, magicLinkFrom(mailer.sent[0]));
  assert.equal(res.status, 302);
  res = await jarFetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  assert.equal(res.status, 302);

  // Home page now shows the form without an email input.
  res = await jarFetch(jar, baseUrl + '/');
  const homeHtml = await res.text();
  assert.match(homeHtml, /class="status muted"/);
  assert.doesNotMatch(homeHtml, /name="email"/);

  // Second post: no email field, must publish directly with no new mail sent.
  res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'lobby', title: 'second', body: 'second body' }),
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/sub\/lobby$/);
  assert.equal(mailer.sent.length, 1, 'no second magic-link mail sent');

  res = await jarFetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  assert.equal(res.status, 200);
  assert.match(await res.text(), /second/);
});

test('anonymous /draft without email returns 400', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;

  const res = await fetch(baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ title: 't', body: 'b' }),
  });
  assert.equal(res.status, 400);
});

test('disposable email is rejected at /draft, knowless never invoked', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;

  ensureSub(db, 'lobby');

  const res = await fetch(baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'spam@mailinator.com',
      sub_name: 'lobby',
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

test('GET /static/favicon.svg?v=N served (query string ignored for file lookup)', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;

  const res = await fetch(`${baseUrl}/static/favicon.svg?v=3`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /image\/svg/);
});

async function loginVia(jar, baseUrl, mailer, email, { db }) {
  // Posting now requires a real sub (no default catch-all). Create a
  // throwaway sub for the bootstrap post if it doesn't exist.
  ensureSub(db, 'bootstrap');
  let res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, sub_name: 'bootstrap', title: 'bootstrap', body: 'bootstrap' }),
  });
  assert.equal(res.status, 200);
  const link = magicLinkFrom(mailer.sent[mailer.sent.length - 1]);
  res = await jarFetch(jar, link);
  assert.equal(res.status, 302);
  res = await jarFetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  assert.equal(res.status, 302);  // /draft/<id>/finalize → /sub/<name>
}

test('M2: logged-in user creates a sub and posts in it', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'creator@example.com', { db });

  // Create a sub.
  let res = await jarFetch(jar, baseUrl + '/sub/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'cooking', description: 'recipes etc.' }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/cooking');

  // Sub page renders.
  res = await jarFetch(jar, baseUrl + '/sub/cooking');
  assert.equal(res.status, 200);
  let body = await res.text();
  assert.match(body, /\/sub\/cooking/);
  assert.match(body, /recipes etc\./);

  // Post into the new sub via the sub page form (hidden sub_name=cooking).
  res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'cooking', title: 'pasta', body: 'al dente' }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/cooking');

  // Sub page now shows the post.
  res = await jarFetch(jar, baseUrl + '/sub/cooking');
  body = await res.text();
  assert.match(body, /pasta/);
});

test('M2: GET /sub/create requires session', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;
  const res = await fetch(baseUrl + '/sub/create');
  assert.equal(res.status, 401);
});

test('M2: POST /sub/create rejects reserved name', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'creator@example.com', { db });

  const res = await jarFetch(jar, baseUrl + '/sub/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'admin' }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /reserved/);
});

test('M2: POST /sub/create rejects duplicate name', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'creator@example.com', { db });

  let res = await jarFetch(jar, baseUrl + '/sub/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'cooking' }),
  });
  assert.equal(res.status, 302);

  res = await jarFetch(jar, baseUrl + '/sub/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: 'cooking' }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /already exists/);
});

test('M2: GET /sub/<unknown> returns 404', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;
  const res = await fetch(baseUrl + '/sub/nonesuch');
  assert.equal(res.status, 404);
});

test('M2: home page caps recent posts to 2 per sub', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  const handle = 'c'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, 'capper-test', Date.now());

  // 5 posts in 'general'. Cap is 2 → only the 2 newest should appear.
  const insert = db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
     VALUES (?, 'general', ?, ?, ?, ?)`
  );
  const now = Date.now();
  for (let i = 0; i < 5; i++) {
    insert.run(
      String(i).padStart(16, '0'),
      handle,
      `general-post-${i}`,
      `posts/g${i}.md`,
      now - i * 1000,
    );
  }

  const res = await fetch(baseUrl + '/');
  const body = await res.text();
  assert.match(body, /general-post-0/, 'newest visible');
  assert.match(body, /general-post-1/, 'second-newest visible');
  assert.doesNotMatch(body, /general-post-2/, '3rd post must be capped');
  assert.doesNotMatch(body, /general-post-3/);
  assert.doesNotMatch(body, /general-post-4/);
});

test('M2: /draft to unknown sub returns 400', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'poster@example.com', { db });

  const res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'doesnotexist', title: 't', body: 'b' }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /doesn't exist/);
});

test('home subs strip: shows top 3 inline, rest behind <details>', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  // Five real subs, ranked by 24h post count.
  for (const name of ['alpha', 'beta', 'gamma', 'delta', 'epsilon']) {
    db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run(name, Date.now());
  }
  const handle = 'h'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, 'strip-test', Date.now() - 10000);
  // Give 'alpha', 'beta', 'gamma' recent posts so they rank top by count.
  for (const [name, n] of [['alpha', 5], ['beta', 3], ['gamma', 1]]) {
    for (let i = 0; i < n; i++) {
      db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
                  VALUES (?, ?, ?, ?, ?, ?)`)
        .run(`${name[0]}${i}`.padStart(16, '0'), name, handle, `t-${i}`, `posts/${name}${i}.md`, Date.now());
    }
  }

  const res = await fetch(baseUrl + '/');
  const body = await res.text();

  // Strip wrapper present, top 3 sub links rendered.
  assert.match(body, /class="subs-strip"/);
  assert.match(body, /\/sub\/alpha/);
  assert.match(body, /\/sub\/beta/);
  assert.match(body, /\/sub\/gamma/);

  // The two non-top subs go inside the <details> with summary "+ show all (2)".
  assert.match(body, /\+ show all \(2\)/);
  assert.match(body, /\/sub\/delta/);
  assert.match(body, /\/sub\/epsilon/);

  // Order check: alpha (top) appears before delta (in show-all).
  assert.ok(body.indexOf('/sub/alpha') < body.indexOf('/sub/delta'));
});

test('home subs strip: hides "+ show all" when ≤ 3 subs', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('alpha', Date.now());
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('beta', Date.now());

  const res = await fetch(baseUrl + '/');
  const body = await res.text();
  assert.match(body, /class="subs-strip"/);
  assert.doesNotMatch(body, /\+ show all/);
});

test('M3: legacy /post/<id> 301 redirects to /sub/<name>/post/<id>', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  ensureSub(db, 'lobby');
  const handle = 'h'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, 'legacy-test', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('1'.repeat(16), 'lobby', handle, 't', 'posts/legacy.md', Date.now());

  const res = await fetch(`${baseUrl}/post/${'1'.repeat(16)}`, { redirect: 'manual' });
  assert.equal(res.status, 301);
  assert.equal(res.headers.get('location'), `/sub/lobby/post/${'1'.repeat(16)}`);
});

test('M3: GET /sub/<name>/post/<id> renders post + comment form when logged in', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer, postsDir } = ctx;

  ensureSub(db, 'lobby');

  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'reader@example.com', { db });

  // Post via the route to get a real file on disk.
  let res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'lobby', title: 'about plato', body: 'a forum' }),
  });
  assert.equal(res.status, 302);
  const subUrl = res.headers.get('location');
  assert.match(subUrl, /\/sub\/lobby$/);

  // Pull the post id from the sub page.
  res = await jarFetch(jar, baseUrl + subUrl);
  const sub = await res.text();
  const m = sub.match(/href="(\/sub\/lobby\/post\/[0-9a-f]{16})"/);
  assert.ok(m, 'permalink found on sub page');
  const permalink = m[1];

  res = await jarFetch(jar, baseUrl + permalink);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /about plato/, 'title rendered');
  assert.match(body, /a forum/, 'body rendered');
  assert.match(body, /comments \(0\)/, 'empty comment header');
  assert.match(body, /name="body"/, 'comment form exists');
});

test('M3: POST /sub/<name>/post/<id>/comment adds a comment, redirects back', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  ensureSub(db, 'lobby');
  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'commenter@example.com', { db });

  // Create a post.
  let res = await jarFetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'lobby', title: 'topic', body: 'discuss' }),
  });
  assert.equal(res.status, 302);
  const postId = db.prepare("SELECT id FROM posts WHERE title = 'topic'").get().id;
  const permalink = `/sub/lobby/post/${postId}`;

  // Add a top-level comment.
  res = await jarFetch(jar, baseUrl + `${permalink}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ body: 'first reply with **markdown**' }),
  });
  assert.equal(res.status, 302);
  // Redirect lands on the new comment's anchor so the page doesn't jump to top.
  assert.match(res.headers.get('location'), new RegExp(`^${permalink}#comment-[0-9a-f]{16}$`));

  res = await jarFetch(jar, baseUrl + permalink);
  const body = await res.text();
  assert.match(body, /comments \(1\)/);
  assert.match(body, /<strong>markdown<\/strong>/);
});

test('M3: POST /sub/<name>/post/<id>/comment requires login', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  ensureSub(db, 'lobby');
  const handle = 'k'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, 'author', Date.now());
  const postId = '2'.repeat(16);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(postId, 'lobby', handle, 't', 'posts/x.md', Date.now());

  const res = await fetch(`${baseUrl}/sub/lobby/post/${postId}/comment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ body: 'b' }),
  });
  assert.equal(res.status, 401);
});

test('M3: POST /vote upvote, score updates, redirect honored', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  ensureSub(db, 'lobby');
  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'voter@example.com', { db });
  // Voter is brand new (just created via login bootstrap), so half-weight on
  // a freshly-created post. Backdate first_seen_at to remove that wrinkle.
  db.prepare("UPDATE handles SET first_seen_at = ? WHERE pseudonym != ?")
    .run(Date.now() - 30 * 24 * 60 * 60 * 1000, 'never');

  // A post by another author.
  const author = 'a'.repeat(64);
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'author-x', Date.now() - 30 * 24 * 60 * 60 * 1000);
  const postId = '3'.repeat(16);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(postId, 'lobby', author, 'votable', 'posts/v.md', Date.now());

  let res = await jarFetch(jar, baseUrl + '/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post',
      target_id: postId,
      direction: 'up',
      return_to: '/sub/lobby',
    }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/lobby');

  const score = db.prepare('SELECT score FROM posts WHERE id = ?').get(postId).score;
  assert.equal(score, 1.0);
});

test('M3: POST /vote with Accept: application/json returns JSON, no redirect', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  ensureSub(db, 'lobby');
  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'jsvoter@example.com', { db });
  db.prepare("UPDATE handles SET first_seen_at = ?")
    .run(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const author = 'j'.repeat(64);
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'j-author', Date.now() - 30 * 24 * 60 * 60 * 1000);
  const postId = '5'.repeat(16);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(postId, 'lobby', author, 't', 'posts/j.md', Date.now());

  const res = await jarFetch(jar, baseUrl + '/vote', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Accept': 'application/json',
    },
    body: new URLSearchParams({ target_type: 'post', target_id: postId, direction: 'up' }),
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /application\/json/);
  const data = await res.json();
  assert.equal(data.vote, 'up');
  assert.equal(data.score, 1.0);
});

test('M3: POST /vote requires login', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { baseUrl } = ctx;

  const res = await fetch(baseUrl + '/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ target_type: 'post', target_id: 'x', direction: 'up' }),
  });
  assert.equal(res.status, 401);
});

test('M3: /vote return_to path is whitelisted to local paths', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl, mailer } = ctx;

  ensureSub(db, 'lobby');
  const jar = newJar();
  await loginVia(jar, baseUrl, mailer, 'voter2@example.com', { db });
  db.prepare("UPDATE handles SET first_seen_at = ?")
    .run(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const author = 'q'.repeat(64);
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'q-author', Date.now() - 30 * 24 * 60 * 60 * 1000);
  const postId = '4'.repeat(16);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(postId, 'lobby', author, 't', 'posts/q.md', Date.now());

  const res = await jarFetch(jar, baseUrl + '/vote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post',
      target_id: postId,
      direction: 'up',
      return_to: 'https://evil.example.com/x',
    }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/', 'malicious external return_to rewritten to /');
});

test('M3: ?sort=top reorders sub page by score', async (t) => {
  const ctx = await spinUpWithPort();
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;

  ensureSub(db, 'lobby');
  const handle = 'z'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, 'sort-test', Date.now() - 30 * 24 * 60 * 60 * 1000);
  const insertPost = db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  // newest = lowest score; oldest = highest score
  insertPost.run('a'.repeat(16), 'lobby', handle, 'fresh-low',  'posts/a.md', Date.now(),         1);
  insertPost.run('b'.repeat(16), 'lobby', handle, 'old-high',   'posts/b.md', Date.now() - 9999,  10);

  let res = await fetch(baseUrl + '/sub/lobby?sort=new');
  let body = await res.text();
  assert.ok(body.indexOf('fresh-low') < body.indexOf('old-high'), 'new: fresh first');

  res = await fetch(baseUrl + '/sub/lobby?sort=top');
  body = await res.text();
  assert.ok(body.indexOf('old-high') < body.indexOf('fresh-low'), 'top: high score first');
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
