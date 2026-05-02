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
import { getSubByName, getSubFlairs } from '../../src/content/sub.js';

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
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-subedit-'));
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

test('GET /sub/<name>/edit: co-mod (non-owner) gets 403', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar: ownerJar, ownerHandle } = await loginAndCreateSub(ctx, { email: 'owner@x.test', sub: 'lobby' });
  const { handle: comodHandle } = await loginPlainUser(ctx, { email: 'comod@x.test' });
  recordAction(ctx.db, {
    subName: 'lobby', modHandle: ownerHandle,
    action: 'promote_mod', targetType: 'handle', targetId: comodHandle,
  });
  void ownerJar;
  // Re-login the co-mod into a fresh jar to drive the GET as them.
  const { jar: comodJar } = await (async () => {
    const j = newJar();
    let res = await jfetch(j, ctx.baseUrl + '/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ email: 'comod@x.test', sub_name: 'seed', title: 't2', body: 'b' }),
    });
    res = await jfetch(j, magicLinkFrom(ctx.mailer.sent.at(-1)));
    await jfetch(j, new URL(res.headers.get('location'), ctx.baseUrl).toString());
    return { jar: j };
  })();
  const res = await jfetch(comodJar, ctx.baseUrl + '/sub/lobby/edit');
  assert.equal(res.status, 403);
});

test('POST /sub/<name>/edit: below-floor flagThreshold rolls back all other writes', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAndCreateSub(ctx, { email: 'owner2@x.test', sub: 'club' });

  const before = getSubByName(ctx.db, 'club');
  const flairsBefore = getSubFlairs(ctx.db, 'club');

  const body = new URLSearchParams();
  body.set('description', 'CHANGED');
  body.set('sensitive', '1');
  body.set('flairs_required', '0');
  body.set('flair_slug_0', 'news');
  body.set('flair_label_0', 'news');
  body.set('flair_color_0', '#58a6ff');
  body.set('flagThreshold', '2');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/club/edit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  assert.equal(res.status, 400);

  const after = getSubByName(ctx.db, 'club');
  assert.equal(after.description, before.description, 'description must not have changed');
  assert.equal(after.sensitive, before.sensitive, 'sensitive must not have changed');
  assert.equal(after.flag_threshold, before.flag_threshold, 'flag_threshold must not have changed');
  assert.deepEqual(getSubFlairs(ctx.db, 'club'), flairsBefore, 'flairs must not have changed');
});
