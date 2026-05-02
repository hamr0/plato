// Unified /modlog dispatcher + POST /modlog/resolve HTTP tests (M5/B6).
// Module pieces are covered in mod.test.js / modlog-resolve.test.js;
// this file exercises the request-level wiring.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { knowless } from 'knowless';
import { openDb } from '../../src/db/index.js';
import { loadDisposableDomains } from '../../src/content/disposable-domain.js';
import { createApp } from '../../src/web/app.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { SYSTEM_HANDLE } from '../../src/content/spamPatterns.js';

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
function ageHandles(db) {
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000;
  db.prepare('UPDATE handles SET first_seen_at = ? WHERE first_seen_at > ?').run(old, old);
}

async function spinUp({ spamPatternsFile = null, urlhausCacheFile = null } = {}) {
  return new Promise((res) => {
    const tmp = http.createServer((q, r) => r.end()).listen(0, () => {
      const port = tmp.address().port;
      tmp.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        const mailer = captureMailer();
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false, mailer,
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-modlog-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({
          db, auth, disposableDomains, postsDir, baseUrl,
          spamPatternsFile, urlhausCacheFile,
        });
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

// Bootstrap a logged-in mod via the magic-link flow + sub creation.
async function bootstrapMod(ctx, { sub = 'lobby' } = {}) {
  const { db, mailer, baseUrl } = ctx;
  // Pre-create a throwaway sub so the bootstrap post has somewhere to land.
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'mod@x.test', sub_name: 'seed', title: 't', body: 'b' }),
  });
  assert.equal(res.status, 200);
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  assert.equal(res.status, 302);
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  assert.equal(res.status, 302);
  ageHandles(db);
  res = await jfetch(jar, baseUrl + '/sub/create', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ name: sub, description: 'd' }),
  });
  assert.equal(res.status, 302);
  const ownerHandle = db.prepare('SELECT owner_handle FROM subs WHERE name = ?').get(sub).owner_handle;
  return { jar, ownerHandle };
}

function seedPost(db, { id, sub, handle, title = 't' }) {
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, sub, handle, title, `posts/${id}.md`, Date.now());
}
function seedFlag(db, { id, targetType, targetId, flagger, category = 'spam', note = null, now = Date.now() }) {
  db.prepare(`INSERT INTO flags (id, target_type, target_id, flagger_handle, category, note, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, targetType, targetId, flagger, category, note, now);
}
function seedAudit(db, { id, sub, mod, action, targetType, targetId, reason = null, now = Date.now() }) {
  db.prepare(`INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, sub, mod, action, targetType, targetId, reason, now);
}

test('GET /modlog: anonymous returns 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/modlog');
  assert.equal(res.status, 401);
});

test('GET /modlog: non-mod returns 403', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'rando@x.test', sub_name: 'seed', title: 't', body: 'b' }),
  });
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  res = await jfetch(jar, baseUrl + '/modlog');
  assert.equal(res.status, 403);
});

test('GET /modlog: defaults to audit when no pending; flips to open when pending exists', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);

  // No pending → default audit.
  let res = await jfetch(jar, baseUrl + '/modlog');
  assert.equal(res.status, 200);
  let body = await res.text();
  assert.match(body, /<a [^>]*class="[^"]*filter-toggle[^"]*"[^>]*>open<\/a>|>open<|mode=open|class="mode/);

  // Insert a flagged post → default flips to open.
  const otherHandle = 'b'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(otherHandle, 'rando', Date.now() - 60 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_open', sub: 'lobby', handle: otherHandle, title: 'flagged title' });
  seedFlag(db, { id: 'f1', targetType: 'post', targetId: 'p_open', flagger: ownerHandle });

  res = await jfetch(jar, baseUrl + '/modlog');
  body = await res.text();
  assert.match(body, /flagged title/, 'open mode should expose the flagged post');
});

test('GET /modlog?mode=audit: explicit mode wins over default', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  // Pending flag exists → default would be open. ?mode=audit must beat that.
  const other = 'c'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(other, 'rando', Date.now());
  seedPost(db, { id: 'p_aud', sub: 'lobby', handle: other, title: 'AUDIT-MARK' });
  seedFlag(db, { id: 'f2', targetType: 'post', targetId: 'p_aud', flagger: ownerHandle });
  seedAudit(db, { id: 'a1', sub: 'lobby', mod: ownerHandle, action: 'collapse', targetType: 'post', targetId: 'p_aud' });

  const res = await jfetch(jar, baseUrl + '/modlog?mode=audit');
  const body = await res.text();
  assert.match(body, /collapse/, 'audit table renders the action');
  assert.doesNotMatch(body, /AUDIT-MARK/, 'audit mode does not render post body');
});

test('GET /modlog?mode=inbox: deduped per target', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);

  const author = 'd'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_inbox', sub: 'lobby', handle: author });
  // Three events on the same target.
  for (const [i, action] of [['a', 'collapse'], ['b', 'uncollapse'], ['c', 'collapse']]) {
    seedAudit(db, { id: `aa_${i}`, sub: 'lobby', mod: ownerHandle, action,
      targetType: 'post', targetId: 'p_inbox', now: Date.now() + i.charCodeAt(0) });
  }
  const res = await jfetch(jar, baseUrl + '/modlog?mode=inbox');
  const body = await res.text();
  // Inbox dedupes to one row per target with an event count.
  const matches = body.match(/p_inbox/g) ?? [];
  assert.ok(matches.length <= 3, 'inbox should not render duplicate target rows');
});

test('GET /modlog?mod=system: filters to system-attributed events', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'e'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_sys', sub: 'lobby', handle: author });
  seedPost(db, { id: 'p_human', sub: 'lobby', handle: author });
  seedAudit(db, { id: 'as1', sub: 'lobby', mod: SYSTEM_HANDLE, action: 'collapse',
    targetType: 'post', targetId: 'p_sys', reason: 'pattern: foo' });
  seedAudit(db, { id: 'ah1', sub: 'lobby', mod: ownerHandle, action: 'collapse',
    targetType: 'post', targetId: 'p_human' });

  const res = await jfetch(jar, baseUrl + '/modlog?mode=audit&mod=system');
  const body = await res.text();
  assert.match(body, /p_sys/);
  assert.doesNotMatch(body, /p_human/, 'human-mod row excluded by mod=system filter');
  assert.match(body, /system/i);
});

test('POST /modlog/resolve: anonymous returns 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ target_type: 'post', target_id: 'x', sub_name: 's', decision: 'dismiss' }),
  });
  assert.equal(res.status, 401);
});

test('POST /modlog/resolve: non-mod returns 403', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  // Login a non-mod user.
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'rando@x.test', sub_name: 'seed', title: 't', body: 'b' }),
  });
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());

  // Create a sub owned by someone else and a post in it.
  const owner = 'f'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(owner, 'own', Date.now() - 90 * 24 * 60 * 60 * 1000);
  db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)')
    .run('private', owner, Date.now());
  seedPost(db, { id: 'p_priv', sub: 'private', handle: owner });

  res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_priv', sub_name: 'private', decision: 'dismiss',
    }),
  });
  assert.equal(res.status, 403);
});

test('POST /modlog/resolve: uphold-soft collapses + resolves flags', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'g'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_soft', sub: 'lobby', handle: author });
  seedFlag(db, { id: 'fs', targetType: 'post', targetId: 'p_soft', flagger: ownerHandle });

  const res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_soft', sub_name: 'lobby', decision: 'uphold-soft',
    }),
  });
  assert.equal(res.status, 302);

  const post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p_soft');
  assert.ok(post.collapsed_at != null, 'post collapsed');
  const flag = db.prepare('SELECT resolution FROM flags WHERE id = ?').get('fs');
  assert.equal(flag.resolution, 'upheld');
  const audit = db.prepare(`SELECT action FROM mod_actions WHERE target_id = 'p_soft'`).get();
  assert.equal(audit.action, 'collapse');
});

test('POST /modlog/resolve: uphold-hard requires reason', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'h'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_hard', sub: 'lobby', handle: author });
  seedFlag(db, { id: 'fh', targetType: 'post', targetId: 'p_hard', flagger: ownerHandle });

  let res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_hard', sub_name: 'lobby', decision: 'uphold-hard',
    }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /reason required/);

  res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_hard', sub_name: 'lobby', decision: 'uphold-hard', reason: 'malware',
    }),
  });
  assert.equal(res.status, 302);
  const post = db.prepare('SELECT removed_at FROM posts WHERE id = ?').get('p_hard');
  assert.ok(post.removed_at != null, 'hard removal flips removed_at');
});

test('POST /modlog/resolve: dismiss closes flags + uncollapses if auto-hidden', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'i'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_dis', sub: 'lobby', handle: author });
  // Pretend it auto-hid: collapsed_at non-null, no mod 'collapse' on record.
  db.prepare(`UPDATE posts SET collapsed_at = ?, score_at_collapse = 0 WHERE id = 'p_dis'`).run(Date.now());
  seedFlag(db, { id: 'fd', targetType: 'post', targetId: 'p_dis', flagger: ownerHandle });

  const res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_dis', sub_name: 'lobby', decision: 'dismiss',
    }),
  });
  assert.equal(res.status, 302);
  const post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p_dis');
  assert.equal(post.collapsed_at, null, 'dismiss un-hides auto-hidden target');
  const flag = db.prepare('SELECT resolution FROM flags WHERE id = ?').get('fd');
  assert.equal(flag.resolution, 'dismissed');
  const uncollapse = db.prepare(`SELECT COUNT(*) AS n FROM mod_actions WHERE target_id = 'p_dis' AND action = 'uncollapse'`).get();
  assert.equal(uncollapse.n, 1);
});

test('POST /modlog/resolve: invalid decision returns 400', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await bootstrapMod(ctx);
  const res = await jfetch(jar, ctx.baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'x', sub_name: 'lobby', decision: 'nuke',
    }),
  });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /unknown decision/);
});

test('defenses fire end-to-end: spam regex collapses post + writes audit row', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'plato-spam-cfg-'));
  const patternsFile = join(dir, 'patterns.txt');
  writeFileSync(patternsFile, 'guaranteed returns\n', 'utf8');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ctx = await spinUp({ spamPatternsFile: patternsFile });
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar } = await bootstrapMod(ctx);

  const res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'lobby', title: 'GUARANTEED RETURNS', body: 'click here' }),
  });
  assert.equal(res.status, 302);
  const post = db.prepare('SELECT id, collapsed_at FROM posts WHERE title = ?').get('GUARANTEED RETURNS');
  assert.ok(post, 'post written');
  assert.ok(post.collapsed_at != null, 'spam-regex auto-collapsed the post');
  const audit = db.prepare(`SELECT mod_handle, reason FROM mod_actions WHERE target_id = ?`).get(post.id);
  assert.ok(audit, 'system audit row written');
  assert.equal(audit.mod_handle, SYSTEM_HANDLE);
  assert.match(audit.reason, /pattern: guaranteed returns/);
});

test('defenses fire end-to-end: URLhaus host collapses post + writes audit row', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'plato-urlhaus-cfg-'));
  const cacheFile = join(dir, 'urlhaus.txt');
  writeFileSync(cacheFile, 'http://malware.example/payload\n', 'utf8');
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const ctx = await spinUp({ urlhausCacheFile: cacheFile });
  t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar } = await bootstrapMod(ctx);

  const res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      sub_name: 'lobby', title: 'check this', body: 'see https://malware.example/here',
    }),
  });
  assert.equal(res.status, 302);
  const post = db.prepare(`SELECT id, collapsed_at FROM posts WHERE title = 'check this'`).get();
  assert.ok(post.collapsed_at != null, 'urlhaus host auto-collapsed the post');
  const audit = db.prepare(`SELECT mod_handle, reason FROM mod_actions WHERE target_id = ?`).get(post.id);
  assert.ok(audit);
  assert.equal(audit.mod_handle, SYSTEM_HANDLE);
  assert.match(audit.reason, /blocked-url: malware\.example/);
});

test('defenses fire end-to-end: link cap blocks new account 2-link post', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  // Fresh account (no aging) — new tier, link cap = 1.
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      email: 'fresh@x.test', sub_name: 'seed',
      title: 't', body: 'see https://a.test and https://b.test',
    }),
  });
  // Magic-link flow goes through /draft → mail → click → finalize.
  // Link-cap fires at finalize.
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  assert.equal(res.status, 400);
  assert.match(await res.text(), /too many links|link cap|links/i);
});

test('errorPage: banned-from-sub error renders site chrome + back link', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, mailer, baseUrl } = ctx;
  const { ownerHandle } = await bootstrapMod(ctx);

  // Login a second user fully so we can identify their handle from their
  // first published post in 'lobby'. Then ban them and try a fresh draft.
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'banned@x.test', sub_name: 'lobby', title: 'first', body: 'b' }),
  });
  assert.equal(res.status, 200);
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  assert.equal(res.status, 302);
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  assert.equal(res.status, 302);
  ageHandles(db);

  const targetHandle = db.prepare(
    `SELECT handle FROM posts WHERE sub_name = 'lobby' AND title = 'first'`
  ).get().handle;
  assert.notEqual(targetHandle, ownerHandle);
  db.prepare('INSERT INTO bans (sub_name, handle, banned_by, reason, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('lobby', targetHandle, ownerHandle, 'test ban', Date.now());

  // New draft from the (now banned) session: bootstraps a draft, finalizes,
  // and finalizeDraft throws "banned from lobby".
  res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'lobby', title: 'second', body: 'b' }),
  });
  assert.equal(res.status, 400);
  const body = await res.text();
  assert.match(body, /<header/);
  assert.match(body, /plato/);
  assert.match(body, /href="\/sub\/lobby"/);
});

test('safeLocalRedirect: //evil.com falls back to default', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'k'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_or', sub: 'lobby', handle: author });
  seedFlag(db, { id: 'f_or', targetType: 'post', targetId: 'p_or', flagger: ownerHandle });

  const res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_or', sub_name: 'lobby', decision: 'dismiss',
      return_to: '//evil.com/path',
    }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/modlog', 'fell back to /modlog');
});

test('safeLocalRedirect: /\\evil falls back to default', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'l'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_or2', sub: 'lobby', handle: author });
  seedFlag(db, { id: 'f_or2', targetType: 'post', targetId: 'p_or2', flagger: ownerHandle });

  const res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_or2', sub_name: 'lobby', decision: 'dismiss',
      return_to: '/\\evil.com',
    }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/modlog');
});

test('safeLocalRedirect: legitimate /sub/x is preserved', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { jar, ownerHandle } = await bootstrapMod(ctx);
  const author = 'm'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 90 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_or3', sub: 'lobby', handle: author });
  seedFlag(db, { id: 'f_or3', targetType: 'post', targetId: 'p_or3', flagger: ownerHandle });

  const res = await jfetch(jar, baseUrl + '/modlog/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      target_type: 'post', target_id: 'p_or3', sub_name: 'lobby', decision: 'dismiss',
      return_to: '/sub/lobby',
    }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/lobby');
});

test('GET /communities: lists subs with sort + filter', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  await bootstrapMod(ctx, { sub: 'alpha-room' });
  await bootstrapMod(ctx, { sub: 'beta-zone' });
  const res = await fetch(baseUrl + '/communities');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /\/sub\/alpha-room/);
  assert.match(body, /\/sub\/beta-zone/);
  assert.match(body, /community-filter/, 'has the client-side filter input');
  assert.match(body, /most recent|most posts|a-z/, 'has sort chips');
});

test('GET /?tab=comments: renders the comments feed', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  const { ownerHandle } = await bootstrapMod(ctx);
  // Seed a post + a comment.
  const author = 'n'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 30 * 24 * 60 * 60 * 1000);
  seedPost(db, { id: 'p_cf', sub: 'lobby', handle: author, title: 'COMMENT-FEED-MARK' });
  db.prepare(`INSERT INTO comments (id, post_id, handle, body, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run('c_cf', 'p_cf', author, 'a witty reply', Date.now());
  const res = await fetch(baseUrl + '/?tab=comments');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /COMMENT-FEED-MARK/, 'parent post title shown as context');
  assert.match(body, /a witty reply/, 'comment body excerpt rendered');
});

test('GET /?sort=top&date=24h: cross-sub posts feed honors filter', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  await bootstrapMod(ctx);
  const author = 'o'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now() - 30 * 24 * 60 * 60 * 1000);
  // One recent (24h), one old.
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, score, created_at) VALUES (?, 'lobby', ?, ?, ?, ?, ?)`)
    .run('p_recent', author, 'RECENT-POST', 'posts/p_recent.md', 5, Date.now() - 60 * 60 * 1000);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, score, created_at) VALUES (?, 'lobby', ?, ?, ?, ?, ?)`)
    .run('p_old', author, 'OLD-POST', 'posts/p_old.md', 99, Date.now() - 7 * 24 * 60 * 60 * 1000);
  const res = await fetch(baseUrl + '/?sort=top&date=24h');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /RECENT-POST/);
  assert.doesNotMatch(body, /OLD-POST/, 'date=24h excludes old post');
});
