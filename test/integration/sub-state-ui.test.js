// HTTP-level coverage for the M5/B12 smoke items that can't be exercised
// at the mechanism layer alone:
//   - /sub/<name> action row renders "manage" for owner + co-mod
//   - POST /sub/<name>/mods action=disable_sub end-to-end
//   - Subscribe still works in a read-only sub (personal preference)
//   - /subs directory renders [read-only] chip on disabled subs
//   - /sub/<name> banner copy variants (read-only without mods, with mods)
//   - Self-flag affordance hidden on the author's own post
//   - Pseudonym → handle resolution in the promote/transfer pickers

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
import { recordAction, listModActions } from '../../src/content/mod.js';

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
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-substate-'));
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
  assert.equal(res.status, 200);
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

// --- Step 3: action row label flips to "manage" for any mod role ---

test('GET /sub/<name>: action row says "manage" for owner', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'o@x.test', sub: 'lobby' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /href="\/sub\/lobby\/edit"[^>]*>manage</);
});

test('GET /sub/<name>: action row says "manage" for co-mod (not "edit")', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { ownerHandle } = await loginAndCreateSub(ctx, { email: 'o2@x.test', sub: 'lobby' });
  const { jar: comodJar, handle: comodHandle } = await loginPlainUser(ctx, { email: 'co@x.test' });
  ctx.db.prepare('INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(comodHandle, 'lobby', Date.now());
  recordAction(ctx.db, {
    subName: 'lobby', modHandle: ownerHandle,
    action: 'promote_mod', targetType: 'handle', targetId: comodHandle,
  });
  const res = await jfetch(comodJar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /href="\/sub\/lobby\/edit"[^>]*>manage</);
  assert.doesNotMatch(body, />edit sub</);
});

// --- Steps 9–10: disable_sub end-to-end ---

test('POST disable_sub from manage page: clears owner_handle, sets disabled_at, writes synthetic modlog row', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'd@x.test', sub: 'lab' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lab/mods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'disable_sub' }),
  });
  assert.equal(res.status, 302);
  const sub = ctx.db.prepare('SELECT owner_handle, disabled_at FROM subs WHERE name = ?').get('lab');
  assert.equal(sub.owner_handle, null, 'owner_handle cleared');
  assert.ok(sub.disabled_at != null, 'disabled_at set');
  const actions = listModActions(ctx.db, 'lab');
  const auto = actions.find((a) => a.action === 'auto_disable_inactivity');
  assert.ok(auto, 'synthetic auto_disable_inactivity row written');
  assert.match(auto.reason ?? '', /stepped down with no co-mods/);
});

test('POST disable_sub blocked when co-mods exist (must transfer instead)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, ownerHandle } = await loginAndCreateSub(ctx, { email: 'e@x.test', sub: 'lab2' });
  const { handle: comodHandle } = await loginPlainUser(ctx, { email: 'cm@x.test' });
  ctx.db.prepare('INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(comodHandle, 'lab2', Date.now());
  recordAction(ctx.db, {
    subName: 'lab2', modHandle: ownerHandle,
    action: 'promote_mod', targetType: 'handle', targetId: comodHandle,
  });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lab2/mods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'disable_sub' }),
  });
  assert.equal(res.status, 400);
  const sub = ctx.db.prepare('SELECT owner_handle, disabled_at FROM subs WHERE name = ?').get('lab2');
  assert.equal(sub.owner_handle, ownerHandle, 'owner unchanged after rejection');
  assert.equal(sub.disabled_at, null, 'sub still active');
});

// --- Step 13: subscribe still works on a read-only sub ---

test('subscribe/unsubscribe still toggles on a read-only sub (personal preference, not content)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'r1@x.test', sub: 'frozen' });
  // Disable the sub manually
  ctx.db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'frozen');
  // A non-mod user subscribes to a read-only sub
  const { jar: userJar } = await loginPlainUser(ctx, { email: 'r2@x.test' });
  void jar;
  let res = await jfetch(userJar, ctx.baseUrl + '/sub/frozen/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'subscribe' }),
  });
  assert.equal(res.status, 302);
  // Unsubscribe also works
  res = await jfetch(userJar, ctx.baseUrl + '/sub/frozen/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'unsubscribe' }),
  });
  assert.equal(res.status, 302);
});

// --- Step 14: /subs directory shows [read-only] chip ---

test('GET /subs: disabled sub is marked [read-only] in the directory listing', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 's1@x.test', sub: 'frozen-zone' });
  ctx.db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'frozen-zone');
  const res = await fetch(ctx.baseUrl + '/subs');
  const body = await res.text();
  assert.match(body, /\/sub\/frozen-zone[\s\S]*?\[read-only\]/);
});

// --- Step 15: banner copy on a read-only sub ---

test('GET /sub/<name>: read-only sub with no mods shows the no-mods-remain banner', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  await loginAndCreateSub(ctx, { email: 'b1@x.test', sub: 'lonely' });
  // Disable + clear all mods (mimics disable_sub end-state)
  ctx.db.prepare('UPDATE subs SET disabled_at = ?, owner_handle = NULL WHERE name = ?').run(Date.now(), 'lonely');
  ctx.db.prepare('DELETE FROM sub_mods WHERE sub_name = ?').run('lonely');
  const res = await fetch(ctx.baseUrl + '/sub/lonely');
  const body = await res.text();
  assert.match(body, /no mods remain/i);
  assert.match(body, /create a successor/i);
});

test('GET /sub/<name>: read-only sub WITH mods shows reactivate-able banner', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'b2@x.test', sub: 'parked' });
  ctx.db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'parked');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/parked');
  const body = await res.text();
  // The mod themselves sees a reactivate affordance somewhere on the page.
  assert.match(body, /this sub is read-only/i);
  assert.doesNotMatch(body, /no mods remain/i);
});

// --- Self-flag UI hide ---

test('GET /sub/<name>: post listing hides the flag affordance on the viewer\'s own post', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'sf@x.test', sub: 'mine' });
  // Owner posts to their own sub
  let res = await jfetch(jar, ctx.baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'mine', title: 'self-post', body: 'body' }),
  });
  assert.equal(res.status, 302);
  // Owner is also a mod, which already hides the flag button — but
  // verify the no-mod-role co-mod path: a non-mod author viewing their
  // own post detail page should still not see the flag affordance.
  const { jar: userJar } = await loginPlainUser(ctx, { email: 'au@x.test' });
  ageHandles(ctx.db);
  res = await jfetch(userJar, ctx.baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ sub_name: 'mine', title: 'authored', body: 'b2' }),
  });
  assert.equal(res.status, 302);
  // Author visits their own post on the sub feed — flag affordance must not appear.
  res = await jfetch(userJar, ctx.baseUrl + '/sub/mine');
  const body = await res.text();
  // Find the row containing "authored" and check no flag <details> renders for it.
  // Simplest invariant: total flag-trigger summaries on the page is 0 for
  // the author's view of their own posts (only post on the page is theirs).
  // Other users' posts with flags would render <summary class="flag-trigger">.
  // (The owner's "self-post" is visible to both users; the author has authored
  // exactly one post on this page.)
  // Conservative assertion: across all author-only posts, the flag affordance
  // should not appear next to the author's pseudonym.
  // We verify by counting "flag-trigger" occurrences for posts the author
  // wrote. Here both posts on the page are visible to userJar; one is
  // authored by them, one by the owner. The author should see exactly
  // one flag affordance (for the owner's post), not two.
  const flagTriggers = (body.match(/class="flag-trigger/g) || []).length;
  assert.equal(flagTriggers, 1, 'author sees flag affordance only on the other user\'s post');
});

// --- Pseudonym → handle resolution in the picker ---

test('POST promote_mod accepts pseudonym (datalist-typed) in addition to handle', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'p1@x.test', sub: 'studio' });
  const { handle: candidateHandle } = await loginPlainUser(ctx, { email: 'p2@x.test' });
  ctx.db.prepare('INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(candidateHandle, 'studio', Date.now());
  const candidatePseudo = ctx.db.prepare('SELECT pseudonym FROM handles WHERE handle = ?')
    .get(candidateHandle).pseudonym;
  // Post the pseudonym (not the 64-char handle) — handler must resolve.
  const res = await jfetch(jar, ctx.baseUrl + '/sub/studio/mods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'promote_mod', target: candidatePseudo }),
  });
  assert.equal(res.status, 302);
  const row = ctx.db.prepare('SELECT role FROM sub_mods WHERE sub_name = ? AND handle = ?')
    .get('studio', candidateHandle);
  assert.equal(row?.role, 'co');
});

test('POST promote_mod with unknown pseudonym is rejected (no silent miss)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'p3@x.test', sub: 'gallery' });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/gallery/mods', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ action: 'promote_mod', target: 'no-such-user' }),
  });
  assert.equal(res.status, 400);
});
