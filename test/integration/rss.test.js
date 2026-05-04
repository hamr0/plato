// M6/B4: per-sub Atom feed at /sub/<name>/rss. PRD §M6 → per-sub RSS
// feeds. Bridges plato to external readers without leaking handles
// (subscribers stay private; feeds expose the same content the public
// sub page already shows).

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

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

async function spinUp() {
  return new Promise((res) => {
    const tmp = http.createServer((q, r) => r.end()).listen(0, () => {
      const port = tmp.address().port;
      tmp.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        const mailer = {
          sent: [],
          async submit({ to, subject, body }) { this.sent.push({ to, subject, body }); return { messageId: '<x@t>' }; },
          async verify() { return true; }, close() {},
        };
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false, mailer,
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-rss-'));
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

function seedSub(db, name) {
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run(name, Date.now());
}
function seedAuthor(db, handle, pseudonym = handle.slice(0, 6)) {
  db.prepare('INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(handle, pseudonym, Date.now() - 30 * 24 * 60 * 60 * 1000);
}
function seedPost(db, postsDir, { sub, handle, title, body = 'hello world', removed = false }) {
  const id = randomBytes(8).toString('hex');
  const file = `posts/${id}.md`;
  mkdirSync(join(postsDir, 'posts'), { recursive: true });
  writeFileSync(join(postsDir, file), `---\ntitle: ${title}\nhandle: ${handle}\n---\n\n${body}\n`);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, removed_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sub, handle, title, file, Date.now(), removed ? Date.now() : null);
  return id;
}

test('GET /sub/<name>/rss: 404 when sub missing', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/nope/rss');
  assert.equal(res.status, 404);
});

test('GET /sub/<name>/rss: 200 with empty feed when no posts', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  seedSub(ctx.db, 'lobby');
  const res = await fetch(ctx.baseUrl + '/sub/lobby/rss');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /application\/atom\+xml/);
  assert.match(res.headers.get('cache-control') ?? '', /max-age=300/);
  const body = await res.text();
  assert.match(body, /<feed xmlns="http:\/\/www\.w3\.org\/2005\/Atom">/);
  assert.match(body, /<title>plato \/\/lobby<\/title>/);
  assert.doesNotMatch(body, /<entry>/);
});

test('GET /sub/<name>/rss: lists non-removed posts in newest-first order', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, postsDir } = ctx;
  seedSub(db, 'lobby');
  const author = 'a'.repeat(64);
  seedAuthor(db, author, 'al-pseudo');
  const oldest = seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'oldest-post' });
  // Bump created_at on the second insertion via raw SQL so the order
  // is deterministic without sleeping.
  const middleId = seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'middle-post' });
  const newest   = seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'newest-post' });
  const removed  = seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'REMOVED-MARK', removed: true });
  void oldest; void middleId; void newest; void removed;
  // Re-stamp so newest > middle > oldest > removed regardless of clock.
  db.prepare('UPDATE posts SET created_at = ? WHERE title = ?').run(1000, 'oldest-post');
  db.prepare('UPDATE posts SET created_at = ? WHERE title = ?').run(2000, 'middle-post');
  db.prepare('UPDATE posts SET created_at = ? WHERE title = ?').run(3000, 'newest-post');
  db.prepare('UPDATE posts SET created_at = ? WHERE title = ?').run(4000, 'REMOVED-MARK');

  const res = await fetch(ctx.baseUrl + '/sub/lobby/rss');
  const body = await res.text();
  // Removed post excluded.
  assert.doesNotMatch(body, /REMOVED-MARK/);
  // Newest first.
  const newestPos = body.indexOf('newest-post');
  const middlePos = body.indexOf('middle-post');
  const oldestPos = body.indexOf('oldest-post');
  assert.ok(newestPos > 0 && middlePos > newestPos && oldestPos > middlePos,
    'entries should appear newest-first in the feed');
  // Author pseudonym surfaces (not the raw handle).
  assert.match(body, /<name>al-pseudo<\/name>/);
  assert.doesNotMatch(body, new RegExp(author));
});

test('GET /sub/<name>/rss: feed self-link + alternate HTML link both present', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  seedSub(ctx.db, 'lobby');
  const res = await fetch(ctx.baseUrl + '/sub/lobby/rss');
  const body = await res.text();
  assert.match(body, new RegExp(`<link rel="self" href="${ctx.baseUrl}/sub/lobby/rss"/>`));
  assert.match(body, new RegExp(`<link rel="alternate" type="text/html" href="${ctx.baseUrl}/sub/lobby"/>`));
});

test('GET /sub/<name>: HTML page advertises Atom feed via <link rel="alternate">', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  seedSub(ctx.db, 'lobby');
  const res = await fetch(ctx.baseUrl + '/sub/lobby');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<link rel="alternate" type="application\/atom\+xml" href="\/sub\/lobby\/rss"/);
  // Visible "rss" text link in the action row.
  assert.match(body, /<a href="\/sub\/lobby\/rss">rss<\/a>/);
});

test('GET /: home page does NOT advertise an Atom feed (per-sub only for now)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/');
  const body = await res.text();
  assert.doesNotMatch(body, /<link rel="alternate" type="application\/atom\+xml"/);
});

test('GET /sub/<name>/rss: post body / title with HTML special chars are XML-escaped', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, postsDir } = ctx;
  seedSub(db, 'lobby');
  const author = 'b'.repeat(64);
  seedAuthor(db, author);
  seedPost(db, postsDir, { sub: 'lobby', handle: author, title: 'a < b & c > d', body: 'plain' });
  const res = await fetch(ctx.baseUrl + '/sub/lobby/rss');
  const body = await res.text();
  // Title special chars escape into entities, never into raw < > &.
  assert.match(body, /<title>a &lt; b &amp; c &gt; d<\/title>/);
});
