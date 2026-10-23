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
import { loadSpamPatterns, matchSpamPatterns } from '../../src/content/spamPatterns.js';
import { createApp } from '../../src/web/app.js';
import { makeCdnTripwire, isCloudflareIp } from '../../src/cdnTripwire.js';
import { applyAllMigrations } from '../_helpers/migrations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');
const SPAM_PATH = resolve(HERE, '../../spam-patterns.txt');
const FORM = { 'Content-Type': 'application/x-www-form-urlencoded' };

async function spinUp() {
  const tmp = http.createServer((q, r) => r.end());
  const port = await new Promise((r) => tmp.listen(0, () => r(tmp.address().port)));
  await new Promise((r) => tmp.close(r));
  const baseUrl = `http://localhost:${port}`;
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT OR IGNORE INTO subs (name, created_at) VALUES (?, ?)').run('seed', Date.now());
  const sent = [];
  const mailer = {
    async submit({ to, subject, body }) { sent.push({ to, subject, body }); return { messageId: '<x@t>' }; },
    async verify() { return true; }, close() {},
  };
  const auth = knowless({
    secret: randomBytes(32).toString('hex'), baseUrl, from: 'a@t', dbPath: ':memory:',
    openRegistration: true, cookieSecure: false, mailer,
  });
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-bot-'));
  const captured = [];
  const app = createApp({
    db, auth, disposableDomains: loadDisposableDomains(DISPOSABLE_PATH), postsDir, baseUrl,
    spamPatternsFile: SPAM_PATH,
    captureError: (err, extra) => captured.push({ err, extra }),
  });
  const server = http.createServer(app);
  await new Promise((r) => server.listen(port, r));
  return { db, auth, sent, postsDir, baseUrl, server, captured };
}
async function teardown({ db, auth, postsDir, server }) {
  await new Promise((r) => server.close(r));
  auth.close(); db.close();
  rmSync(postsDir, { recursive: true, force: true });
}
const drafts = (db) => db.prepare('SELECT COUNT(*) AS n FROM drafts').get().n;
const post = (ctx, fields, headers = {}) => fetch(ctx.baseUrl + '/draft', {
  method: 'POST', headers: { ...FORM, ...headers }, redirect: 'manual', body: new URLSearchParams(fields),
});
const base = { email: 'v@x.test', sub_name: 'seed', title: 'hello', body: 'world' };

test('anon honeypot filled: 200 check-your-email, no draft, no mail', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await post(ctx, { ...base, website: 'http://spam.test' });
  assert.equal(res.status, 200);
  assert.match(await res.text(), /We sent a magic link/);
  assert.equal(drafts(ctx.db), 0);
  assert.equal(ctx.sent.length, 0);
});

test('anon honeypot empty: draft written and mail sent', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await post(ctx, { ...base, website: '' });
  assert.equal(res.status, 200);
  assert.equal(drafts(ctx.db), 1);
  assert.equal(ctx.sent.length, 1);
});

test('anon form renders the honeypot field', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const html = await (await fetch(ctx.baseUrl + '/sub/seed')).text();
  assert.match(html, /name="website"[^>]*class="hp-field"|class="hp-field"[^>]*name="website"/);
});

test('logged-in post ignores a filled honeypot', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  let res = await post(ctx, base);
  const link = ctx.sent.at(-1).body.match(/https?:\/\/\S+\/auth\/callback\?t=\S+/)[0];
  res = await fetch(link, { redirect: 'manual' });
  const cookies = res.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  res = await fetch(new URL(res.headers.get('location'), ctx.baseUrl), { redirect: 'manual', headers: { Cookie: cookies } });
  assert.equal(res.status, 302);
  const old = Date.now() - 90 * 24 * 60 * 60 * 1000;
  ctx.db.prepare('UPDATE handles SET first_seen_at = ? WHERE first_seen_at > ?').run(old, old);
  const before = ctx.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n;
  res = await fetch(ctx.baseUrl + '/draft', {
    method: 'POST', redirect: 'manual', headers: { ...FORM, Cookie: cookies },
    body: new URLSearchParams({ sub_name: 'seed', title: 'second', body: 'again', website: 'filled' }),
  });
  assert.equal(res.status, 302);
  assert.equal(ctx.db.prepare('SELECT COUNT(*) AS n FROM posts').get().n, before + 1);
});

test('anon draft matching a spam pattern: 400, no draft, no mail', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await post(ctx, { ...base, title: 'Hi, i am write about your   price', body: 'Hola, volia saber el seu preu.' });
  assert.equal(res.status, 400);
  assert.match(await res.text(), /post not accepted/);
  assert.equal(drafts(ctx.db), 0);
  assert.equal(ctx.sent.length, 0);
});

test('price-bot pattern matches whole bot titles only (title-only haystack)', () => {
  const patterns = loadSpamPatterns(SPAM_PATH);
  const hit = (s) => matchSpamPatterns(s, patterns).length > 0;
  for (const s of [
    'Hi, i am write about your   price',
    'Hallo    wrote about your   prices',
    'Aloha, i am wrote about your   price for reseller',
    'Hello  i writing about your   price for reseller',
    'Aloha  i writing about your the price for reseller',
    'Aloha i write about price',
    'Hallo i am writing about the price for reseller',
    'Hello, wrote about the prices',
    'Hi write about price for reseller',
    'Hallo, i wrote about     price for reseller',
  ]) assert.ok(hit(s), s);
  for (const s of [
    'What do you think about pricing for open source?',
    'I wrote about your post on prices yesterday',
    'How should a forum handle prices?',
    'Hi all, I wrote about pricing models last week',
    'Hi all, I wrote about pricing models',
    'I wrote about your price of admission',
    'Hi, I wrote about the price of RAM',
    'hello I am writing about prices in Berlin',
    'Hi, I am writing about the price elasticity of demand',
  ]) assert.ok(!hit(s), s);
});

test('anon draft titled like ordinary English about price is accepted', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await post(ctx, { ...base, title: 'Hi, I wrote about the price of RAM' });
  assert.equal(res.status, 200);
  assert.equal(drafts(ctx.db), 1);
  assert.equal(ctx.sent.length, 1);
});

test('cdn tripwire: Cloudflare IP warns once per window, normal IP never', () => {
  const calls = [];
  const check = makeCdnTripwire((err, extra) => calls.push(extra));
  check('203.0.113.9', 1000);
  check('::1', 1000);
  assert.equal(calls.length, 0);
  check('172.67.10.1', 1000);
  check('2606:4700::1', 2000);
  check('::ffff:104.16.0.1', 3000);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where, 'cdn-tripwire');
  check('172.67.10.1', 1000 + 24 * 60 * 60 * 1000 + 1);
  assert.equal(calls.length, 2);
  assert.ok(isCloudflareIp('104.16.0.1') && !isCloudflareIp('8.8.8.8') && !isCloudflareIp('garbage'));
});

const loginPost = (ctx, fields) => fetch(ctx.baseUrl + '/login', {
  method: 'POST', headers: FORM, redirect: 'manual', body: new URLSearchParams(fields),
});

test('/login honeypot filled: same success page as a real login, no mail', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const real = await loginPost(ctx, { email: 'a@x.test', website: '' });
  assert.equal(ctx.sent.length, 1);
  const realHtml = await real.text();
  const res = await loginPost(ctx, { email: 'b@x.test', website: 'http://spam.test' });
  assert.equal(res.status, real.status);
  const html = await res.text();
  assert.match(html, /We sent a magic link to <code>b@x\.test<\/code>/);
  assert.equal(html.replace('b@x.test', 'a@x.test'), realHtml);
  assert.equal(ctx.sent.length, 1, 'no mail for the honeypot hit');
});

test('/login honeypot empty: mail sent', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await loginPost(ctx, { email: 'a@x.test' });
  assert.equal(res.status, 200);
  assert.equal(ctx.sent.length, 1);
});

test('both login forms render the honeypot field', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const hp = /name="website"[^>]*class="hp-field"/;
  assert.match(await (await fetch(ctx.baseUrl + '/sub/seed')).text().then((h) => h.slice(h.indexOf('class="login-form"'))), hp);
  const page = await (await fetch(ctx.baseUrl + '/login')).text();
  assert.match(page.slice(page.indexOf('login-form-page')), hp);
});
