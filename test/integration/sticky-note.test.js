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
import { recordAction } from '../../src/content/mod.js';
import { setSubStickyNote, getSubByName } from '../../src/content/sub.js';

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

async function spinUp() {
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
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-sticky-'));
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

async function loginAndCreateSub(ctx, { email, sub }) {
  const { db, mailer, baseUrl } = ctx;
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, sub_name: 'seed', title: 't', body: 'b' }),
  });
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
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

async function loginPlainUser(ctx, { email }) {
  const { mailer, baseUrl, db } = ctx;
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, sub_name: 'seed', title: 't', body: 'b' }),
  });
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  const handle = db.prepare('SELECT handle FROM posts ORDER BY created_at DESC LIMIT 1').get().handle;
  return { jar, handle };
}

test('sticky note column starts NULL on a fresh sub', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const sub = getSubByName(ctx.db, 'lobby');
  assert.equal(sub.sticky_note, null);
});

test('setSubStickyNote persists; empty string normalizes to NULL', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  setSubStickyNote(ctx.db, 'lobby', 'hi readers, **rules** apply');
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, 'hi readers, **rules** apply');
  setSubStickyNote(ctx.db, 'lobby', '');
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, null);
});

test('GET /sub/<name>: sticky note renders above the feed when set, absent when null', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });

  let res = await fetch(ctx.baseUrl + '/sub/lobby');
  let body = await res.text();
  assert.doesNotMatch(body, /sub-sticky-note/);

  setSubStickyNote(ctx.db, 'lobby', 'welcome — see [the rules](/about) and **be kind**');
  res = await fetch(ctx.baseUrl + '/sub/lobby');
  body = await res.text();
  assert.match(body, /<div class="sub-sticky-note"[\s\S]*<strong>be kind<\/strong>/);
  assert.match(body, /<a href="\/about">the rules<\/a>/);
  // Sticky note appears before the feed posts list.
  const noteIdx = body.indexOf('sub-sticky-note');
  const feedIdx = body.search(/\/\/ posts · sort/);
  assert.ok(noteIdx > 0 && feedIdx > 0 && noteIdx < feedIdx, 'note must precede feed');
});

test('GET /sub/<name>: sticky-note markdown image syntax becomes a link, not an <img>', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  setSubStickyNote(ctx.db, 'lobby', '![not an image](https://example.test/x.png)');
  const res = await fetch(ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /sub-sticky-note/);
  assert.doesNotMatch(body, /<img/);
});

test('POST /sub/<name>/sticky: 401 for anon', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const res = await fetch(ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'hi' }),
    redirect: 'manual',
  });
  assert.equal(res.status, 401);
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, null);
});

test('POST /sub/<name>/sticky: 403 for non-mod logged-in user', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const { jar } = await loginPlainUser(ctx, { email: 'rando@x.test' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'hi' }),
  });
  assert.equal(res.status, 403);
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, null);
});

test('POST /sub/<name>/sticky: 404 for missing sub', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/nonexistent/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'hi' }),
  });
  assert.equal(res.status, 404);
});

test('POST /sub/<name>/sticky: owner saves, redirects to /edit, value persists', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'announcement: rules updated' }),
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/lobby/edit');
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, 'announcement: rules updated');
});

test('POST /sub/<name>/sticky: co-mod (not owner) can save', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { ownerHandle } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const { handle: comodHandle } = await loginPlainUser(ctx, { email: 'co@x.test' });
  ctx.db.prepare('INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(comodHandle, 'lobby', Date.now());
  recordAction(ctx.db, {
    subName: 'lobby', modHandle: ownerHandle,
    action: 'promote_mod', targetType: 'handle', targetId: comodHandle,
  });
  // Re-login the co-mod into a fresh jar to drive POST as them.
  const j = newJar();
  let res = await jfetch(j, ctx.baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email: 'co@x.test', sub_name: 'seed', title: 't2', body: 'b' }),
  });
  res = await jfetch(j, magicLinkFrom(ctx.mailer.sent.at(-1)));
  await jfetch(j, new URL(res.headers.get('location'), ctx.baseUrl).toString());

  res = await jfetch(j, ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'co-mod note' }),
  });
  assert.equal(res.status, 302);
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, 'co-mod note');
});

test('POST /sub/<name>/sticky: empty submit clears the note', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  setSubStickyNote(ctx.db, 'lobby', 'first version');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: '' }),
  });
  assert.equal(res.status, 302);
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, null);
});

test('POST /sub/<name>/sticky: rejects > 200 chars', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'a'.repeat(201) }),
  });
  assert.equal(res.status, 400);
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, null);
});

test('POST /sub/<name>/sticky: 409 when sub is disabled', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  ctx.db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/sticky', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ note: 'hi' }),
  });
  assert.equal(res.status, 409);
  assert.equal(getSubByName(ctx.db, 'lobby').sticky_note, null);
});

test('GET /sub/<name>/edit: sticky-note form is visible to the owner', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  setSubStickyNote(ctx.db, 'lobby', 'current value');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/edit');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /sub-sticky-edit-form/);
  assert.match(body, /name="note"/);
  // Existing value pre-fills the textarea.
  assert.match(body, /<textarea[^>]*>current value<\/textarea>/);
});
