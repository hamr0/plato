// Sub-export HTTP routes (M7/B2-b):
//   POST /sub/<name>/export-request — auth-required, eligibility-gated, idempotent
//   GET  /export/<token>.tar.gz     — token-bearer, no auth check

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
import { newDownloadToken, DOWNLOAD_TTL_MS } from '../../src/archive/queue.js';
import { SUB_EXPORT_TENURE_MS } from '../../src/content/subscription.js';

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
        // Pre-seed a sub the tests will operate on.
        db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
        const mailer = captureMailer();
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false, mailer,
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-posts-'));
        const exportsDir = mkdtempSync(join(tmpdir(), 'plato-export-exp-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({ db, auth, disposableDomains, postsDir, exportsDir, baseUrl });
        const server = http.createServer(app).listen(port, () => {
          res({ db, auth, mailer, postsDir, exportsDir, baseUrl, server });
        });
      });
    });
  });
}
async function teardown({ auth, db, postsDir, exportsDir, server }) {
  await new Promise((r) => server.close(r));
  auth.close(); db.close();
  rmSync(postsDir, { recursive: true, force: true });
  rmSync(exportsDir, { recursive: true, force: true });
}

async function loginAs(ctx, email) {
  const { mailer, baseUrl, db } = ctx;
  const jar = newJar();
  let res = await jfetch(jar, baseUrl + '/draft', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ email, sub_name: 'lobby', title: 't', body: 'b' }),
  });
  assert.equal(res.status, 200);
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  // Pull the just-created handle off the post we drafted.
  const handle = db.prepare('SELECT handle FROM posts ORDER BY created_at DESC LIMIT 1').get().handle;
  return { jar, handle };
}

// --- POST /sub/<name>/export-request ---

test('POST /sub/<name>/export-request: anonymous → 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/lobby/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 401);
});

test('POST /sub/<name>/export-request: 404 on missing sub', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/no-such-sub/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 404);
});

test('POST /sub/<name>/export-request: logged-in non-subscriber → 403', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 403);
  const body = await res.text();
  assert.match(body, /60 days/);
});

test('POST /sub/<name>/export-request: 59-day subscriber → 403', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  const subscribedAt = Date.now() - (SUB_EXPORT_TENURE_MS - 24 * 60 * 60 * 1000);
  ctx.db.prepare(
    'INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)'
  ).run(handle, 'lobby', subscribedAt);
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 403);
});

test('POST /sub/<name>/export-request: 60-day subscriber → 302 → /memlog?export=queued, row enqueued', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  const subscribedAt = Date.now() - SUB_EXPORT_TENURE_MS - 1000;
  ctx.db.prepare(
    'INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)'
  ).run(handle, 'lobby', subscribedAt);
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/memlog?export=queued');
  const rows = ctx.db.prepare('SELECT * FROM export_jobs WHERE kind = ? AND scope = ?').all('sub', 'lobby');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requested_by, handle);
});

test('POST /sub/<name>/export-request: idempotent — second call while pending does not create a new row', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  ctx.db.prepare(
    'INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)'
  ).run(handle, 'lobby', Date.now() - SUB_EXPORT_TENURE_MS - 1000);
  for (let i = 0; i < 3; i++) {
    const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/export-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    assert.equal(res.status, 302);
  }
  const rows = ctx.db.prepare('SELECT * FROM export_jobs WHERE kind = ? AND scope = ?').all('sub', 'lobby');
  assert.equal(rows.length, 1, 'three POSTs collapse to one pending row');
});

test('POST /sub/<name>/export-request: mod can request even without 60-day tenure', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'mod@x.test');
  // Make this user the owner of lobby.
  ctx.db.prepare('UPDATE subs SET owner_handle = ? WHERE name = ?').run(handle, 'lobby');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 302);
});

// --- GET /export/<token>.tar.gz ---

function seedCompletedJob(db, exportsDir, { handle, subName, token, filename, body, completedAt = Date.now() }) {
  writeFileSync(join(exportsDir, filename), body);
  const expiresAt = completedAt + DOWNLOAD_TTL_MS.sub;
  const id = randomBytes(8).toString('hex');
  db.prepare(
    `INSERT INTO export_jobs
     (id, kind, scope, requested_by, requested_at, started_at, completed_at,
      retry_count, archive_filename, archive_size_bytes, download_token, expires_at)
     VALUES (?, 'sub', ?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`
  ).run(id, subName, handle, completedAt - 5000, completedAt - 1000, completedAt,
        filename, body.length, token, expiresAt);
  return { id, expiresAt };
}

test('GET /export/<token>.tar.gz: completed token → 200 with archive bytes', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const token = newDownloadToken();
  const body = Buffer.from('fake-tarball-bytes');
  seedCompletedJob(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', token,
    filename: 'plato-export-lobby-2026-05-06.tar.gz', body,
  });
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/gzip');
  assert.match(res.headers.get('content-disposition'), /attachment/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const got = Buffer.from(await res.arrayBuffer());
  assert.equal(got.toString(), body.toString());
});

test('GET /export/<token>.tar.gz: bad token → 404', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(`${ctx.baseUrl}/export/${'0'.repeat(64)}.tar.gz`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('GET /export/<token>.tar.gz: malformed (non-hex) token → 404 via path miss', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(`${ctx.baseUrl}/export/not-a-token.tar.gz`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('GET /export/<token>.tar.gz: file missing on disk → 404', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const token = newDownloadToken();
  const filename = 'missing.tar.gz';
  // Seed a row but DON'T write the file.
  const body = Buffer.from('bytes');
  seedCompletedJob(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', token, filename, body,
  });
  // Remove the file we just wrote.
  rmSync(join(ctx.exportsDir, filename));
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

// --- Sub-page export pill states ---

test('pill: anon viewer sees a live "request archive" link to /login', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /class="export-btn"[^>]*href="\/login\?next=[^"]+"[^>]*>request archive</);
});

test('pill: logged-in non-subscriber → disabled with "subscribe to //…" tooltip', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /class="export-btn"[^>]*disabled[^>]*subscribe to \/\/lobby for 60 days/);
});

test('pill: 30-day subscriber → disabled with "you can request this archive on YYYY-MM-DD"', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  ctx.db.prepare('INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(handle, 'lobby', Date.now() - 30 * 24 * 60 * 60 * 1000);
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /class="export-btn"[^>]*disabled[^>]*you can request this archive on \d{4}-\d{2}-\d{2}/);
});

test('pill: 60-day subscriber → live form posting to /sub/<name>/export-request', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  ctx.db.prepare('INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(handle, 'lobby', Date.now() - SUB_EXPORT_TENURE_MS - 1000);
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /<form[^>]*action="\/sub\/lobby\/export-request"/);
  assert.match(body, /class="export-btn"[^>]*type="submit"[^>]*>request archive</);
});

test('pill: mod (no tenure) → live form', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'mod@x.test');
  ctx.db.prepare('UPDATE subs SET owner_handle = ? WHERE name = ?').run(handle, 'lobby');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /<form[^>]*action="\/sub\/lobby\/export-request"/);
});

test('pill: pending job → disabled "archive queued"', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  ctx.db.prepare('INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(handle, 'lobby', Date.now() - SUB_EXPORT_TENURE_MS - 1000);
  // Simulate a pending job.
  await jfetch(jar, ctx.baseUrl + '/sub/lobby/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /class="export-btn"[^>]*disabled[^>]*archive queued/);
});

test('pill: completed-not-expired job → disabled "archive ready"', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  // Seed a completed job for this handle directly.
  const token = newDownloadToken();
  const completedAt = Date.now() - 1000;
  const id = randomBytes(8).toString('hex');
  ctx.db.prepare(
    `INSERT INTO export_jobs
     (id, kind, scope, requested_by, requested_at, started_at, completed_at,
      retry_count, archive_filename, archive_size_bytes, download_token, expires_at)
     VALUES (?, 'sub', 'lobby', ?, ?, ?, ?, 1, 'a.tar.gz', 1, ?, ?)`
  ).run(id, handle, completedAt - 5000, completedAt - 2000, completedAt, token, completedAt + DOWNLOAD_TTL_MS.sub);
  const res = await jfetch(jar, ctx.baseUrl + '/sub/lobby');
  const body = await res.text();
  assert.match(body, /class="export-btn"[^>]*disabled[^>]*archive ready in your memlog \(expires \d{4}-\d{2}-\d{2}\)/);
});

test('GET /export/<token>.tar.gz: download route is token-only (no login required)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const token = newDownloadToken();
  seedCompletedJob(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', token,
    filename: 'a.tar.gz', body: Buffer.from('x'),
  });
  // No cookies, no jar — anonymous request.
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz`, { redirect: 'manual' });
  assert.equal(res.status, 200, 'token IS the credential — no login check');
});
