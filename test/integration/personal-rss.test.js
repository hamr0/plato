// M6/B6: token-gated personal RSS feeds at /u/<token>/subs.rss and
// /u/<token>/rss, regenerate hook on /memlog.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { knowless } from 'knowless';
import { openDb } from '../../src/db/index.js';
import { loadDisposableDomains } from '../../src/content/disposable-domain.js';
import { createApp } from '../../src/web/app.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { subscribe } from '../../src/content/subscription.js';
import { recordNotification } from '../../src/content/notification.js';
import {
  getOrCreateRssToken, regenerateRssToken,
} from '../../src/content/rss-token.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

function captureMailer() {
  const sent = [];
  return {
    sent,
    async submit({ to, subject, body }) { sent.push({ to, subject, body }); return { messageId: '<x@t>' }; },
    async verify() { return true; },
    close() {},
  };
}
function magicLinkFrom(email) {
  const m = email.body.match(/https?:\/\/\S+\/auth\/callback\?t=\S+/);
  if (!m) throw new Error('no link');
  return m[0];
}
function newJar() {
  const c = new Map();
  return {
    update(h) {
      if (!h) return;
      for (const raw of (Array.isArray(h) ? h : [h])) {
        const head = raw.split(';')[0]; const eq = head.indexOf('=');
        if (eq === -1) continue;
        c.set(head.slice(0, eq).trim(), head.slice(eq + 1).trim());
      }
    },
    header() { return [...c.entries()].map(([k, v]) => `${k}=${v}`).join('; '); },
  };
}
async function jfetch(jar, url, opts = {}) {
  const headers = { ...(opts.headers ?? {}) };
  const ck = jar.header(); if (ck) headers.Cookie = ck;
  const res = await fetch(url, { ...opts, headers, redirect: 'manual' });
  jar.update(res.headers.getSetCookie?.() ?? res.headers.get('set-cookie'));
  return res;
}

async function spinUp() {
  return new Promise((res) => {
    const tmp = http.createServer((q, r) => r.end()).listen(0, () => {
      const port = tmp.address().port;
      tmp.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        for (const sub of ['lobby', 'meta']) {
          db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run(sub, Date.now());
        }
        const mailer = captureMailer();
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false, mailer,
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-prss-'));
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
  auth.close(); db.close();
  rmSync(postsDir, { recursive: true, force: true });
}

async function loginAs(ctx, email) {
  const { mailer, baseUrl } = ctx;
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, sub_name: 'lobby', title: 't', body: 'b' }),
  });
  assert.equal(res.status, 200);
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  assert.equal(res.status, 302);
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  // Discover the handle via the cookie we now hold — read it back via a
  // freshly authenticated GET that exposes the pseudonym in the header.
  const handle = ctx.auth.handleFromRequest({
    headers: { cookie: jar.header() },
    socket: { remoteAddress: '127.0.0.1' },
  });
  return { jar, handle };
}

function seedAuthor(db, handle) {
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, handle.slice(0, 6), Date.now() - 30 * 24 * 60 * 60 * 1000);
}
function seedPost(db, postsDir, { sub, handle, title, body = 'hello', removed = false, collapsed = false, when = Date.now() }) {
  const id = randomBytes(8).toString('hex');
  const file = `posts/${id}.md`;
  mkdirSync(join(postsDir, 'posts'), { recursive: true });
  writeFileSync(join(postsDir, file), `---\ntitle: ${title}\nhandle: ${handle}\n---\n\n${body}\n`);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, removed_at, collapsed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sub, handle, title, file, when, removed ? Date.now() : null, collapsed ? Date.now() : null);
  return id;
}

test('GET /u/<bad>/subs.rss: 404 for missing/malformed token', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  // Malformed (wrong length) — route regex misses, generic 404.
  let res = await fetch(ctx.baseUrl + '/u/short/subs.rss');
  assert.equal(res.status, 404);
  // Well-shaped but not issued — handler 404.
  res = await fetch(ctx.baseUrl + '/u/' + 'a'.repeat(64) + '/subs.rss');
  assert.equal(res.status, 404);
});

test('GET /u/<bad>/rss: same 404 behavior', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/u/' + 'a'.repeat(64) + '/rss');
  assert.equal(res.status, 404);
});

test('GET /u/<token>/subs.rss: returns Atom with posts from subscribed subs only', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, postsDir } = ctx;
  // Author for the posts.
  const author = 'c'.repeat(64);
  seedAuthor(db, author);
  seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'IN-LOBBY', when: 2000 });
  seedPost(db, postsDir, { sub: 'meta',  handle: author, title: 'IN-META',  when: 1000 });
  seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'REMOVED-MARK', removed: true, when: 3000 });
  seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'COLLAPSED-MARK', collapsed: true, when: 4000 });
  // Subscriber: subscribe to lobby only, then issue a token.
  const subscriber = 'd'.repeat(64);
  seedAuthor(db, subscriber);
  subscribe(db, { handle: subscriber, subName: 'lobby' });
  const token = getOrCreateRssToken(db, subscriber);

  const res = await fetch(`${ctx.baseUrl}/u/${token}/subs.rss`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/atom\+xml/);
  // Personal feeds should not be cached by intermediaries.
  assert.match(res.headers.get('cache-control') ?? '', /no-store/);
  const body = await res.text();
  assert.match(body, /<title>plato · my subs<\/title>/);
  // Only the subscribed sub's live post appears.
  assert.match(body, /IN-LOBBY/);
  assert.doesNotMatch(body, /IN-META/);
  assert.doesNotMatch(body, /REMOVED-MARK/);
  assert.doesNotMatch(body, /COLLAPSED-MARK/);
  // Title carries the //sub prefix so cross-sub merges are scannable.
  assert.match(body, /\/\/lobby: IN-LOBBY/);
});

test('GET /u/<token>/subs.rss: empty subscription list yields a valid empty feed (200)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const subscriber = 'e'.repeat(64);
  seedAuthor(ctx.db, subscriber);
  const token = getOrCreateRssToken(ctx.db, subscriber);
  const res = await fetch(`${ctx.baseUrl}/u/${token}/subs.rss`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.doesNotMatch(body, /<entry>/);
});

test('GET /u/<token>/rss: includes both subscribed-sub posts AND memlog notifications', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, postsDir } = ctx;
  const author = 'f'.repeat(64);
  seedAuthor(db, author);
  const subscriber = '1'.repeat(64);
  seedAuthor(db, subscriber);
  subscribe(db, { handle: subscriber, subName: 'lobby' });
  // A live post in the subscribed sub.
  seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'POST-MARK', when: 1000 });
  // A memlog notification for the subscriber.
  recordNotification(db, {
    recipientHandle: subscriber,
    kind: 'reply_to_comment',
    subName: 'lobby',
    targetType: 'post',
    targetId: 'doesnotmatter',
    actorHandle: author,
    snippet: 'NOTIF-SNIPPET',
    now: 2000,
  });
  const token = getOrCreateRssToken(db, subscriber);

  const res = await fetch(`${ctx.baseUrl}/u/${token}/rss`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<title>plato · my feed<\/title>/);
  assert.match(body, /POST-MARK/);
  assert.match(body, /NOTIF-SNIPPET/);
});

test('GET /u/<token>/subs.rss: notifications are NOT included in the subs-only feed', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db } = ctx;
  const subscriber = '2'.repeat(64);
  const actor = '3'.repeat(64);
  seedAuthor(db, subscriber);
  seedAuthor(db, actor);
  recordNotification(db, {
    recipientHandle: subscriber,
    kind: 'comment_on_post',
    subName: 'lobby',
    targetType: 'post',
    targetId: 'x',
    actorHandle: actor,
    snippet: 'SHOULD-NOT-APPEAR',
  });
  const token = getOrCreateRssToken(db, subscriber);
  const res = await fetch(`${ctx.baseUrl}/u/${token}/subs.rss`);
  const body = await res.text();
  assert.doesNotMatch(body, /SHOULD-NOT-APPEAR/);
});

test('regenerating the token invalidates the prior URL', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const subscriber = '4'.repeat(64);
  seedAuthor(ctx.db, subscriber);
  const oldToken = getOrCreateRssToken(ctx.db, subscriber);
  const newToken = regenerateRssToken(ctx.db, subscriber);
  assert.notEqual(oldToken, newToken);
  const res = await fetch(`${ctx.baseUrl}/u/${oldToken}/subs.rss`);
  assert.equal(res.status, 404);
  const res2 = await fetch(`${ctx.baseUrl}/u/${newToken}/subs.rss`);
  assert.equal(res2.status, 200);
});

test('robots.txt disallows /u/', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/robots.txt');
  const body = await res.text();
  assert.match(body, /^Disallow: \/u\/$/m);
});

test('GET /memlog: logged-in user sees personal feed URLs and a regenerate form', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'reader@example.com');
  const res = await jfetch(jar, ctx.baseUrl + '/memlog');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /personal rssvp feed/);
  assert.match(body, /\/u\/[0-9a-f]{64}\/subs\.rss/);
  assert.match(body, /\/u\/[0-9a-f]{64}\/rss/);
  assert.match(body, /action="\/memlog\/rss-regenerate"/);
});

test('POST /memlog/rss-regenerate: anonymous returns 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/memlog/rss-regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.status, 401);
});

test('POST /memlog/rss-regenerate: rotates the token, redirects to /memlog', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'rotator@example.com');
  // Visit /memlog once so the token gets issued.
  let res = await jfetch(jar, ctx.baseUrl + '/memlog');
  const before = res.headers.get('content-type'); // sanity
  assert.ok(before);
  const firstBody = await res.text();
  const firstMatch = firstBody.match(/\/u\/([0-9a-f]{64})\/rss/);
  assert.ok(firstMatch, 'first token surfaces');
  const firstToken = firstMatch[1];

  res = await jfetch(jar, ctx.baseUrl + '/memlog/rss-regenerate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  assert.equal(res.status, 302);
  // Redirect carries ?rssvp=open so the <details> stays open after regen.
  assert.equal(res.headers.get('location'), '/memlog?rssvp=open');

  res = await jfetch(jar, ctx.baseUrl + '/memlog');
  const secondBody = await res.text();
  const secondMatch = secondBody.match(/\/u\/([0-9a-f]{64})\/rss/);
  assert.ok(secondMatch);
  assert.notEqual(secondMatch[1], firstToken);
});
