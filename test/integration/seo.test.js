// SEO surface tests — head meta, OG, canonical, robots.txt, sitemap.xml.
// See docs/04-process/privacy-seo.md for the playbook this implements.

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

async function spinUp(brandingOverrides = {}) {
  return new Promise((res) => {
    const tmpServer = http.createServer((q, r) => r.end()).listen(0, () => {
      const port = tmpServer.address().port;
      tmpServer.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false,
          mailer: { async submit() {}, async verify() { return null; }, async close() {} },
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-seo-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({
          db, auth, disposableDomains, postsDir, baseUrl,
          branding: { forumName: 'tests', tagline: 'a test instance', hostedBy: '@tester', ...brandingOverrides },
        });
        const server = http.createServer(app).listen(port, () => {
          res({ db, auth, postsDir, baseUrl, server });
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

test('GET /robots.txt: standard policy + sitemap reference', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/robots.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = await res.text();
  assert.match(body, /^User-agent: \*$/m);
  assert.match(body, /^Allow: \/$/m);
  assert.match(body, /^Disallow: \/memlog$/m);     // private per-user log
  assert.match(body, /^Disallow: \/auth\/$/m);     // auth callbacks
  assert.match(body, /^Disallow: \/draft$/m);      // POST-only endpoint
  assert.match(body, new RegExp(`^Sitemap: ${ctx.baseUrl}/sitemap\\.xml$`, 'm'));
  // Public pages NOT in disallow list — they should be crawlable.
  assert.doesNotMatch(body, /^Disallow: \/about$/m);
  assert.doesNotMatch(body, /^Disallow: \/modlog$/m);
  // Sub reads are crawlable; only the subscribe POST endpoint is blocked.
  assert.doesNotMatch(body, /^Disallow: \/sub\/?$/m);
  assert.doesNotMatch(body, /^Disallow: \/sub\/[a-z0-9-]+\/?$/m);
  assert.match(body, /^Disallow: \/sub\/\*\/subscribe$/m);
});

test('GET /humans.txt: lists project + privacy posture, no analytics mention', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/humans.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = await res.text();
  assert.match(body, /name:\s+plato/);
  assert.match(body, /https:\/\/github\.com\/hamr0\/plato/);
  assert.match(body, /Apache-2\.0/);
  assert.match(body, /no analytics/);
  assert.match(body, /no third-party javascript/);
});

test('GET /.well-known/security.txt: RFC 9116 minimum (Contact + Expires)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/.well-known/security.txt');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/plain/);
  const body = await res.text();
  assert.match(body, /^Contact:/m);
  assert.match(body, /^Expires:\s+\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/m);
  assert.match(body, /^Preferred-Languages:\s+en$/m);
});

test('GET /sitemap.xml: lists static pages + every sub + every non-removed post', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('alpha', Date.now());
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('beta', Date.now());
  const author = 'h'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now());
  // One live post, one removed.
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run('p_live', 'alpha', author, 'live', 'posts/p_live.md', 0, Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, score, created_at, removed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run('p_dead', 'alpha', author, 'dead', 'posts/p_dead.md', 0, Date.now(), Date.now());

  const res = await fetch(baseUrl + '/sitemap.xml');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /xml/);
  const body = await res.text();

  // Static pages
  assert.match(body, new RegExp(`<loc>${baseUrl}/</loc>`));
  assert.match(body, new RegExp(`<loc>${baseUrl}/about</loc>`));
  assert.match(body, new RegExp(`<loc>${baseUrl}/modlog</loc>`));
  assert.match(body, new RegExp(`<loc>${baseUrl}/subs</loc>`));
  // Subs
  assert.match(body, new RegExp(`<loc>${baseUrl}/sub/alpha</loc>`));
  assert.match(body, new RegExp(`<loc>${baseUrl}/sub/beta</loc>`));
  // Live post present, removed post absent
  assert.match(body, new RegExp(`<loc>${baseUrl}/sub/alpha/post/p_live</loc>`));
  assert.doesNotMatch(body, /p_dead/);
  // Standard XML shape
  assert.match(body, /<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(body, /<urlset xmlns="http:\/\/www\.sitemaps\.org\/schemas\/sitemap\/0\.9">/);
});

test('GET /sitemap.xml: lastmod / priority / changefreq present on every entry', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sitemap.xml');
  const body = await res.text();
  // ISO 8601 date shape
  assert.match(body, /<lastmod>\d{4}-\d{2}-\d{2}<\/lastmod>/);
  assert.match(body, /<priority>1\.0<\/priority>/);    // homepage
  assert.match(body, /<priority>0\.5<\/priority>/);    // /about, /modlog, /subs
  assert.match(body, /<changefreq>hourly<\/changefreq>/);
  assert.match(body, /<changefreq>monthly<\/changefreq>/);
});

test('GET /: head includes description, canonical, OG, twitter card, theme-color', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/');
  const body = await res.text();
  assert.match(body, /<meta name="description" content="a tests instance/);
  assert.match(body, /magic-link auth, no tracking, no analytics/);
  assert.match(body, new RegExp(`<link rel="canonical" href="${ctx.baseUrl}/">`));
  assert.match(body, /<meta name="theme-color" content="#0d1117">/);
  assert.match(body, /<meta property="og:type" content="website">/);
  assert.match(body, /<meta property="og:title" content="tests">/);
  assert.match(body, new RegExp(`<meta property="og:url" content="${ctx.baseUrl}/">`));
  assert.match(body, /<meta property="og:site_name" content="tests">/);
  assert.match(body, new RegExp(`<meta property="og:image" content="${ctx.baseUrl}/static/og.png\\?v=1">`));
  assert.match(body, /<meta property="og:image:width" content="1200">/);
  assert.match(body, /<meta property="og:image:height" content="630">/);
  assert.match(body, /<meta property="og:image:alt" content="plato">/);
  assert.match(body, /<meta name="twitter:card" content="summary_large_image">/);
});

test('GET /about: page-specific description + canonical', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/about');
  const body = await res.text();
  assert.match(body, /<meta name="description" content="what tests keeps about its users/);
  assert.match(body, new RegExp(`<link rel="canonical" href="${ctx.baseUrl}/about">`));
});

test('GET /sub/<name>: canonical = /sub/<name>; description from sub.description when set', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl } = ctx;
  db.prepare('INSERT INTO subs (name, description, created_at) VALUES (?, ?, ?)')
    .run('alpha', 'all things alpha', Date.now());
  const res = await fetch(baseUrl + '/sub/alpha');
  const body = await res.text();
  assert.match(body, /<meta name="description" content="all things alpha">/);
  assert.match(body, new RegExp(`<link rel="canonical" href="${baseUrl}/sub/alpha">`));
});

test('GET /sub/<name>/post/<id>: og:type = article; description = body excerpt', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { db, baseUrl, postsDir } = ctx;
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('alpha', Date.now());
  const author = 'h'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(author, 'au', Date.now());
  // Real post on disk so getPost can read frontmatter + body.
  const id = '0123456789abcdef';  // 16 hex chars, matches SUB_POST_PATH_RE
  const filename = `${id}.md`;
  const fm = `---\ntitle: A long-ish title\nhandle: ${author}\ncreated_at: ${Date.now()}\nsub_name: alpha\n---\nThis is the post body. It is plain prose without markdown markers, and it should land in the og:description verbatim, modulo trimming.\n`;
  writeFileSync(join(postsDir, filename), fm);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, score, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(id, 'alpha', author, 'A long-ish title', filename, 0, Date.now());
  const res = await fetch(baseUrl + `/sub/alpha/post/${id}`);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /<meta property="og:type" content="article">/);
  assert.match(body, /<meta name="description" content="This is the post body/);
  assert.match(body, new RegExp(`<link rel="canonical" href="${baseUrl}/sub/alpha/post/${id}">`));
  // i18n: the user-content surfaces (title h1, body article) carry
  // dir="auto" so Arabic/Hebrew/Persian posts auto-flip to RTL while
  // Latin/CJK stay LTR. UI chrome stays LTR by design — see PRD.
  assert.match(body, /<h1 dir="auto">/);
  assert.match(body, /<article dir="auto">/);
});

test('GET /modlog: canonical = /modlog regardless of query params', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/modlog?type=banned&date=24h');
  const body = await res.text();
  assert.match(body, new RegExp(`<link rel="canonical" href="${ctx.baseUrl}/modlog">`));
  assert.match(body, /<meta name="description" content="every moderation action on tests/);
});

test('branding.metaDescription override is used when set', async (t) => {
  const ctx = await spinUp({
    metaDescription: 'A handcrafted tiny forum for the alpha-team. Magic-link auth, no tracking.',
  });
  t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/');
  const body = await res.text();
  assert.match(body, /<meta name="description" content="A handcrafted tiny forum/);
});
