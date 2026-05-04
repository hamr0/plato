// M6/B2: subscriptions module + HTTP wiring (POST /sub/<name>/subscribe
// + GET /subs?filter=mine + subscriber-count column).

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
import {
  subscribe, unsubscribe, isSubscribed,
  listSubscribedSubs, subscriberCounts,
} from '../../src/content/subscription.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

// --- Module-level (in-memory DB, no HTTP) ---

function moduleFixture() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  const now = Date.now();
  for (const sub of ['lobby', 'meta', 'news']) {
    db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run(sub, now);
  }
  for (const h of ['a'.repeat(64), 'b'.repeat(64)]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, h.slice(0, 6), now - 60 * 24 * 60 * 60 * 1000);
  }
  return db;
}

const ALICE = 'a'.repeat(64);
const BOB   = 'b'.repeat(64);

test('subscribe + isSubscribed + unsubscribe roundtrip', () => {
  const db = moduleFixture();
  assert.equal(isSubscribed(db, ALICE, 'lobby'), false);
  subscribe(db, { handle: ALICE, subName: 'lobby' });
  assert.equal(isSubscribed(db, ALICE, 'lobby'), true);
  unsubscribe(db, { handle: ALICE, subName: 'lobby' });
  assert.equal(isSubscribed(db, ALICE, 'lobby'), false);
});

test('subscribe is idempotent (double-subscribe preserves original created_at)', () => {
  const db = moduleFixture();
  subscribe(db, { handle: ALICE, subName: 'lobby', now: 1000 });
  subscribe(db, { handle: ALICE, subName: 'lobby', now: 9999 });
  const row = db.prepare(
    'SELECT created_at FROM subscriptions WHERE user_handle = ? AND sub_name = ?'
  ).get(ALICE, 'lobby');
  assert.equal(row.created_at, 1000);
});

test('unsubscribe is idempotent (deleting a non-row is a no-op)', () => {
  const db = moduleFixture();
  // No subscription exists; should not throw.
  unsubscribe(db, { handle: ALICE, subName: 'lobby' });
  assert.equal(isSubscribed(db, ALICE, 'lobby'), false);
});

test('listSubscribedSubs returns a Set of names sorted A-Z', () => {
  const db = moduleFixture();
  subscribe(db, { handle: ALICE, subName: 'news' });
  subscribe(db, { handle: ALICE, subName: 'lobby' });
  const subs = listSubscribedSubs(db, ALICE);
  assert.deepEqual([...subs], ['lobby', 'news']);
});

test('subscriberCounts: zero for empty input, accurate per-sub aggregation', () => {
  const db = moduleFixture();
  assert.equal(subscriberCounts(db, []).size, 0);
  subscribe(db, { handle: ALICE, subName: 'lobby' });
  subscribe(db, { handle: BOB,   subName: 'lobby' });
  subscribe(db, { handle: ALICE, subName: 'meta' });
  const counts = subscriberCounts(db, ['lobby', 'meta', 'news']);
  assert.equal(counts.get('lobby'), 2);
  assert.equal(counts.get('meta'), 1);
  assert.equal(counts.get('news'), 0);
});

test('subscribe rejects empty handle / subName', () => {
  const db = moduleFixture();
  assert.throws(() => subscribe(db, { handle: '', subName: 'lobby' }), /handle is required/);
  assert.throws(() => subscribe(db, { handle: ALICE, subName: '' }), /subName is required/);
});

// --- HTTP-level ---

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
        // Pre-seed two subs so HTTP tests can subscribe without first
        // creating one (sub-create flow has its own coverage).
        db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
        db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('meta',  Date.now());
        const mailer = captureMailer();
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false, mailer,
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-sub-'));
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
  // The post-finalize redirect lands on the new post's URL — which
  // means a handles row now exists and the cookie session is live.
  return jar;
}

test('POST /sub/<name>/subscribe: anonymous returns 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  assert.equal(res.status, 401);
});

test('POST /sub/<name>/subscribe: 404 when sub does not exist', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/no-such/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  assert.equal(res.status, 404);
});

test('POST /sub/<name>/subscribe: subscribe → unsubscribe roundtrip via form', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'a@x.test');
  // Subscribe.
  let res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe', return_to: '/sub/lobby' }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/lobby');
  // The sub-page button should now read 'unsubscribe'.
  res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  let body = await res.text();
  assert.match(body, /class="subscribe-btn"[^>]*>unsubscribe</);
  // Unsubscribe.
  res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'unsubscribe', return_to: '/sub/lobby' }),
  });
  assert.equal(res.status, 302);
  res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  body = await res.text();
  assert.match(body, /class="subscribe-btn"[^>]*>subscribe</);
});

test('POST /sub/<name>/subscribe: missing action toggles current state', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'a@x.test');
  // First call (no action body) toggles into subscribed.
  let res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 302);
  res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  assert.match(await res.text(), /class="subscribe-btn"[^>]*>unsubscribe</);
  // Second toggle removes.
  res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  assert.match(await res.text(), /class="subscribe-btn"[^>]*>subscribe</);
});

test('GET /subs?filter=mine: shows only subscribed subs for logged-in user', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'a@x.test');
  // Subscribe to lobby only.
  await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  // 'all' shows both seeded subs.
  let res = await jfetch(jar, ctx.baseUrl + '/subs');
  let body = await res.text();
  assert.match(body, /\/sub\/lobby/);
  assert.match(body, /\/sub\/meta/);
  // 'mine' shows lobby but not meta.
  res = await jfetch(jar, ctx.baseUrl + '/subs?filter=mine');
  body = await res.text();
  assert.match(body, /\/sub\/lobby/);
  assert.doesNotMatch(body, /href="\/sub\/meta"/);
});

test('GET /subs?filter=mine: anonymous silently falls back to all (chip not rendered)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/subs?filter=mine');
  assert.equal(res.status, 200);
  const body = await res.text();
  // Both subs visible because filter degrades to 'all' for anonymous.
  assert.match(body, /\/sub\/lobby/);
  assert.match(body, /\/sub\/meta/);
});

test('GET /subs: subscriber column reflects real counts', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'a@x.test');
  await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  const res = await jfetch(jar, ctx.baseUrl + '/subs?sort=name');
  const body = await res.text();
  // Find the lobby row, then assert it carries a 1 in the subscribers
  // <td class="num muted">. Anchored to the row to avoid matching meta.
  const lobbyRow = body.match(/<tr>[^]*?\/sub\/lobby[^]*?<\/tr>/)?.[0] ?? '';
  assert.ok(lobbyRow, 'lobby row should exist');
  assert.match(lobbyRow, /<td class="num muted">1<\/td>/);
});

test('GET /sub/<name>: subscribe button absent for anonymous', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/lobby');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /class="subscribe-btn"/);
});

// --- M6/B3: home-feed Subscribed/All toggle ---

function seedPost(db, { sub, title }) {
  const id = randomBytes(8).toString('hex');
  const author = randomBytes(32).toString('hex');
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, author.slice(0, 6), Date.now() - 60 * 24 * 60 * 60 * 1000);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, sub, author, title, `posts/${id}.md`, Date.now());
  return id;
}

test('GET /?feed=subscribed: shows only posts from subscribed subs', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db } = ctx;
  seedPost(db, { sub: 'lobby', title: 'LOBBY-POST-MARK' });
  seedPost(db, { sub: 'meta',  title: 'META-POST-MARK' });
  const jar = await loginAs(ctx, 'a@x.test');
  // Subscribe to lobby only.
  await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  // All-feed: both posts visible.
  let res = await jfetch(jar, ctx.baseUrl + '/');
  let body = await res.text();
  assert.match(body, /LOBBY-POST-MARK/);
  assert.match(body, /META-POST-MARK/);
  // Subscribed-feed: lobby only.
  res = await jfetch(jar, ctx.baseUrl + '/?feed=subscribed');
  body = await res.text();
  assert.match(body, /LOBBY-POST-MARK/);
  assert.doesNotMatch(body, /META-POST-MARK/);
});

test('GET /?feed=subscribed: chip not rendered for anonymous; param degrades to all', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db } = ctx;
  seedPost(db, { sub: 'meta', title: 'META-POST-MARK' });
  const res = await fetch(ctx.baseUrl + '/?feed=subscribed');
  assert.equal(res.status, 200);
  const body = await res.text();
  // Chip pair is hidden for anonymous (the existing all/24h/etc chips
  // still render, but no `feed=subscribed` link should appear).
  assert.doesNotMatch(body, /href="\/\?feed=subscribed"/);
  // And the meta post is visible because the filter degraded to all.
  assert.match(body, /META-POST-MARK/);
});

test('GET /?feed=subscribed: empty-state message when logged-in user subscribes to nothing', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db } = ctx;
  seedPost(db, { sub: 'lobby', title: 'LOBBY-POST-MARK' });
  const jar = await loginAs(ctx, 'a@x.test');
  // Note: loginAs posts to lobby as part of the magic-link flow, but
  // posting != subscribing. Confirm zero subscriptions, then ask for
  // the subscribed feed and assert the empty-state copy renders.
  const handle = db.prepare('SELECT handle FROM posts ORDER BY created_at DESC LIMIT 1').get().handle;
  const count = db.prepare('SELECT COUNT(*) AS n FROM subscriptions WHERE user_handle = ?').get(handle).n;
  assert.equal(count, 0);
  const res = await jfetch(jar, ctx.baseUrl + '/?feed=subscribed');
  const body = await res.text();
  assert.match(body, /haven't subscribed to any subs yet/);
  assert.doesNotMatch(body, /LOBBY-POST-MARK/);
});

test('GET /?feed=subscribed&tab=comments: comment feed honors the same filter', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db } = ctx;
  const lobbyPost = seedPost(db, { sub: 'lobby', title: 'lobby' });
  const metaPost  = seedPost(db, { sub: 'meta',  title: 'meta' });
  const author = 'd'.repeat(64);
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 30 * 24 * 60 * 60 * 1000);
  for (const [postId, body] of [[lobbyPost, 'LOBBY-COMMENT-MARK'], [metaPost, 'META-COMMENT-MARK']]) {
    db.prepare(`INSERT INTO comments (id, post_id, handle, body, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run(randomBytes(8).toString('hex'), postId, author, body, Date.now());
  }
  const jar = await loginAs(ctx, 'a@x.test');
  await jfetch(jar, ctx.baseUrl + '/sub/lobby/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  const res = await jfetch(jar, ctx.baseUrl + '/?tab=comments&feed=subscribed');
  const body = await res.text();
  assert.match(body, /LOBBY-COMMENT-MARK/);
  assert.doesNotMatch(body, /META-COMMENT-MARK/);
});
