// Sub-import HTTP routes (M7/B5):
//   GET  /sub/create?mode=import — second tab on the sub-create page
//   POST /sub/import             — auth-required, queues an import job
// Plus the imported-sub banner + [imported] modlog tag rendering.

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
async function loginAs(ctx, email) {
  const jar = newJar();
  await jfetch(jar, ctx.baseUrl + '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `email=${encodeURIComponent(email)}`,
  });
  const link = magicLinkFrom(ctx.mailer.sent.at(-1));
  await jfetch(jar, link);
  // Fetch home so siteHeader's pseudonymFor() materializes a handles
  // row — otherwise FK-constrained INSERTs (notifications,
  // import_jobs.requested_by) won't find the handle.
  await jfetch(jar, ctx.baseUrl + '/');
  return jar;
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
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-imp-posts-'));
        const exportsDir = mkdtempSync(join(tmpdir(), 'plato-imp-exports-'));
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

// --- /sub/create tabs ---

test('GET /sub/create: default mode=create renders create form, hides import form', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/create');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /class="sub-create-tabs"/);
  assert.match(body, /create new<\/a>/);
  assert.match(body, /import from URL<\/a>/);
  assert.match(body, /action="\/sub\/create"/);
  assert.doesNotMatch(body, /action="\/sub\/import"/);
});

test('GET /sub/create?mode=import: renders import form, hides create form', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/create?mode=import');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /action="\/sub\/import"/);
  assert.match(body, /name="sourceUrl"/);
  assert.match(body, /name="renameTo"/);
  assert.doesNotMatch(body, /action="\/sub\/create"\b/);
});

test('GET /sub/create: anon sees 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/create?mode=import');
  assert.equal(res.status, 401);
});

// --- POST /sub/import ---

test('POST /sub/import: anon → 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'sourceUrl=https%3A%2F%2Fother.example%2Fexport%2Fx.tar.gz',
  });
  assert.equal(res.status, 401);
});

test('POST /sub/import: missing url → 400', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'sourceUrl=',
  });
  assert.equal(res.status, 400);
});

test('POST /sub/import: invalid url → 400', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'sourceUrl=not-a-url',
  });
  assert.equal(res.status, 400);
});

test('POST /sub/import: non-http(s) protocol → 400', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'sourceUrl=ftp%3A%2F%2Fother.example%2Fx.tar.gz',
  });
  assert.equal(res.status, 400);
});

test('POST /sub/import: bad rename name → 400', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'sourceUrl=' + encodeURIComponent('https://other.example/export/x.tar.gz') + '&renameTo=Bad%20Name',
  });
  assert.equal(res.status, 400);
});

test('POST /sub/import: valid → 302 to /memlog?import=queued + row enqueued', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const res = await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'sourceUrl=' + encodeURIComponent('https://other.example/export/x.tar.gz') + '&renameTo=lobby-archive',
  });
  assert.equal(res.status, 302);
  assert.match(res.headers.get('location'), /\/memlog\?import=queued/);
  const row = ctx.db.prepare('SELECT source_url, rename_to FROM import_jobs').get();
  assert.equal(row.source_url, 'https://other.example/export/x.tar.gz');
  assert.equal(row.rename_to, 'lobby-archive');
});

test('POST /sub/import: idempotent within pending — second submit collapses onto same row', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const url = 'https://other.example/export/x.tar.gz';
  const body = 'sourceUrl=' + encodeURIComponent(url);
  await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  await jfetch(jar, ctx.baseUrl + '/sub/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const count = ctx.db.prepare('SELECT COUNT(*) AS n FROM import_jobs').get().n;
  assert.equal(count, 1);
});

// --- imported banner on /sub/<name> ---

test('GET /sub/<name>: imported banner renders only on imported subs', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  // Native sub: no banner.
  ctx.db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('lobby', null, Date.now());
  let res = await fetch(ctx.baseUrl + '/sub/lobby');
  let body = await res.text();
  assert.doesNotMatch(body, /class="imported-banner"/);

  // Imported sub: banner shows source host + date.
  const importerHandle = 'a'.repeat(64);
  ctx.db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(importerHandle, 'importer-pseudo', Date.now());
  ctx.db.prepare(
    `INSERT INTO subs (name, owner_handle, created_at, imported_from_url, imported_from_fingerprint, imported_at, imported_at_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('archive', importerHandle, Date.now(), 'https://source.example.com/export/aa.tar.gz', 'sha256:fp', Date.UTC(2026, 4, 7), Date.UTC(2026, 4, 6));
  ctx.db.prepare(`INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'owner')`).run('archive', importerHandle);
  res = await fetch(ctx.baseUrl + '/sub/archive');
  body = await res.text();
  assert.match(body, /class="imported-banner"/);
  assert.match(body, /source\.example\.com/);
  assert.match(body, /imported by <strong>importer-pseudo<\/strong>/);
  assert.match(body, /\[imported\]/);
});

// --- [imported] tag in modlog ---

test('GET /sub/<name>/modlog: imported_from_fingerprint rows render with [imported] tag', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  ctx.db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('archive', null, Date.now());
  const modHandle = 'a'.repeat(64);
  ctx.db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(modHandle, 'archived-mod', Date.now());
  // Imported row + native row in the same modlog.
  ctx.db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at, imported_from_fingerprint)
     VALUES (?, ?, ?, 'collapse', 'comment', 'c1', 'noisy', ?, 'sha256:fp')`
  ).run('m1', 'archive', modHandle, Date.now() - 1000);
  ctx.db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
     VALUES (?, ?, ?, 'remove', 'post', 'p1', 'illegal', ?)`
  ).run('m2', 'archive', modHandle, Date.now());
  const res = await fetch(ctx.baseUrl + '/sub/archive/modlog');
  const body = await res.text();
  assert.match(body, /imported-tag[^>]*>\[imported\]/);
});

test('imported handle pseudonyms render with imported-author class + aria-label; native render bare', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  // Two handles with the same pseudonym shape — one native, one imported.
  // Imported must render wrapped in <span class="imported-author"
  // aria-label="imported author <name>">; native must render bare.
  const native = 'a'.repeat(64);
  const imported = 'b'.repeat(64);
  ctx.db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(native, 'native-fox', Date.now());
  ctx.db.prepare(
    `INSERT INTO handles (handle, pseudonym, first_seen_at, imported_from_fingerprint) VALUES (?, ?, ?, 'sha256:src')`
  ).run(imported, 'imported-bear', Date.now());
  ctx.db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('archive', null, Date.now());
  ctx.db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
     VALUES (?, ?, ?, 'remove', 'post', 'p1', 'r1', ?)`
  ).run('m-native', 'archive', native, Date.now() - 1000);
  ctx.db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at, imported_from_fingerprint)
     VALUES (?, ?, ?, 'remove', 'post', 'p2', 'r2', ?, 'sha256:src')`
  ).run('m-imported', 'archive', imported, Date.now());
  const res = await fetch(ctx.baseUrl + '/sub/archive/modlog');
  const body = await res.text();
  // Imported: class + aria-label, name unchanged.
  assert.match(body, /<span class="imported-author" aria-label="imported author imported-bear">imported-bear<\/span>/);
  // Native: bare, no class, no aria-label of this shape.
  assert.ok(body.includes('native-fox'), 'native pseudonym must appear');
  assert.ok(!/<span class="imported-author"[^>]*>native-fox</.test(body), 'native pseudonym must NOT carry imported-author class');
  assert.ok(!body.includes('aria-label="imported author native-fox"'), 'native pseudonym must NOT carry imported aria-label');
  // Bracket render is gone; dagger render is gone.
  assert.ok(!body.includes('[imported-bear]'), 'old bracket render must be removed');
  assert.ok(!body.includes('imported-bear†'), 'dagger render must be removed');
});

test('imported pseudonym with -N suffix in DB renders as bare stripped name', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  // The DB stores `clever-tiger-2` (collision suffix). The display should
  // strip the suffix and wrap in the imported-author span.
  const importedHandle = 'c'.repeat(64);
  ctx.db.prepare(
    `INSERT INTO handles (handle, pseudonym, first_seen_at, imported_from_fingerprint) VALUES (?, ?, ?, 'sha256:src')`
  ).run(importedHandle, 'clever-tiger-2', Date.now());
  ctx.db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('archive', null, Date.now());
  ctx.db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at, imported_from_fingerprint)
     VALUES (?, ?, ?, 'remove', 'post', 'p1', 'r', ?, 'sha256:src')`
  ).run('m1', 'archive', importedHandle, Date.now());
  const res = await fetch(ctx.baseUrl + '/sub/archive/modlog');
  const body = await res.text();
  // Display shows the stripped name in the imported-author span.
  assert.match(body, /<span class="imported-author" aria-label="imported author clever-tiger">clever-tiger<\/span>/);
  assert.ok(!body.includes('clever-tiger-2</span>'), 'display must strip the -N suffix from the inner text');
});

test('native pseudonym ending in -2 is NOT stripped or wrapped', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  // A native HMAC pseudonym could legitimately end in -2; strip + wrap
  // are gated on imported_from_fingerprint.
  const nativeHandle = 'd'.repeat(64);
  ctx.db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(nativeHandle, 'odd-name-2', Date.now());
  ctx.db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('lobby', null, Date.now());
  ctx.db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
     VALUES (?, ?, ?, 'remove', 'post', 'p1', 'r', ?)`
  ).run('m1', 'lobby', nativeHandle, Date.now());
  const res = await fetch(ctx.baseUrl + '/sub/lobby/modlog');
  const body = await res.text();
  assert.ok(body.includes('odd-name-2'), 'native -N pseudonym must render verbatim');
  assert.ok(!body.includes('aria-label="imported author odd-name"'), 'native pseudonym must not be stripped');
  assert.ok(!/<span class="imported-author"[^>]*>odd-name/.test(body), 'native pseudonym must not be wrapped');
});

test('imported sub renders [i] chip on modlog page; native sub does not', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const importerHandle = 'e'.repeat(64);
  ctx.db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(importerHandle, 'importer-pseudo', Date.now());
  ctx.db.prepare(
    `INSERT INTO subs (name, owner_handle, created_at, imported_from_url, imported_from_fingerprint, imported_at, imported_at_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('archive', importerHandle, Date.now(), 'https://source.example.com/x.tar.gz', 'sha256:fp', Date.UTC(2026, 4, 7), Date.UTC(2026, 4, 6));
  ctx.db.prepare(`INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'owner')`).run('archive', importerHandle);

  // Modlog page: chip present, title carries source + date (no dagger explanation).
  let res = await fetch(ctx.baseUrl + '/sub/archive/modlog');
  let body = await res.text();
  assert.match(body, /class="imported-chip"/);
  assert.match(body, /title="imported from source\.example\.com on 2026-05-07"/);
  assert.ok(!body.includes('historical authors marked'), 'chip title must not reference the dagger convention');

  // Native sub: chip absent on its modlog page.
  ctx.db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('lobby', null, Date.now());
  res = await fetch(ctx.baseUrl + '/sub/lobby/modlog');
  body = await res.text();
  assert.doesNotMatch(body, /class="imported-chip"/);
});

test('imported-banner copy: provenance only, no dagger explainer', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const importerHandle = 'f'.repeat(64);
  ctx.db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(importerHandle, 'importer-pseudo', Date.now());
  ctx.db.prepare(
    `INSERT INTO subs (name, owner_handle, created_at, imported_from_url, imported_from_fingerprint, imported_at, imported_at_source)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('archive2', importerHandle, Date.now(), 'https://source.example.com/x.tar.gz', 'sha256:fp', Date.UTC(2026, 4, 7), Date.UTC(2026, 4, 6));
  ctx.db.prepare(`INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'owner')`).run('archive2', importerHandle);
  const res = await fetch(ctx.baseUrl + '/sub/archive2');
  const body = await res.text();
  assert.match(body, /\[imported\] from <a/);
  assert.match(body, /imported by <strong>importer-pseudo<\/strong>/);
  assert.ok(!body.includes('historical authors marked'), 'banner must not reference the dagger convention');
});

// --- /memlog rendering for import_ready / import_failed ---

test('GET /memlog: import_ready row renders link to /sub/<imported_sub_name>', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const aliceHandle = ctx.db.prepare(
    `SELECT handle FROM handles ORDER BY first_seen_at DESC LIMIT 1`
  ).get()?.handle;
  // Pre-seed: a completed import job belonging to alice + the matching
  // notification.
  const jobId = randomBytes(8).toString('hex');
  ctx.db.prepare(
    `INSERT INTO import_jobs (id, source_url, source_scope_sub, source_exported_at, source_fingerprint,
       imported_sub_name, requested_by, requested_at, completed_at)
     VALUES (?, 'https://src.example/x.tar.gz', 'lobby', '2026-05-07T00:00:00.000Z', 'sha256:fp',
       'lobby-imp', ?, ?, ?)`
  ).run(jobId, aliceHandle, Date.now() - 1000, Date.now());
  ctx.db.prepare(
    `INSERT INTO subs (name, owner_handle, created_at, imported_from_url) VALUES ('lobby-imp', ?, ?, ?)`
  ).run(aliceHandle, Date.now(), 'https://src.example/x.tar.gz');
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, sub_name, target_type, target_id, snippet, created_at)
     VALUES (?, 'import_ready', 'lobby-imp', 'import', ?, 'imported //lobby-imp from src — 1 post', ?)`
  ).run(aliceHandle, jobId, Date.now());

  const res = await jfetch(jar, ctx.baseUrl + '/memlog?show=all');
  const body = await res.text();
  assert.match(body, /imported \/\/lobby-imp from src/);
  // The kind label shows up in the row
  assert.match(body, /import ready/);
  // The "go" link should resolve through the import target_type to the imported sub page
  assert.match(body, new RegExp(`href="/memlog/go/\\d+"`));
});

test('GET /memlog/go/<id>: import_ready notification 302s to /sub/<imported_sub_name>', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const aliceHandle = ctx.db.prepare(
    `SELECT handle FROM handles ORDER BY first_seen_at DESC LIMIT 1`
  ).get()?.handle;
  const jobId = randomBytes(8).toString('hex');
  ctx.db.prepare(
    `INSERT INTO import_jobs (id, source_url, source_scope_sub, source_exported_at,
       imported_sub_name, requested_by, requested_at, completed_at)
     VALUES (?, 'https://src.example/x.tar.gz', 'lobby', '2026-05-07T00:00:00.000Z',
       'lobby-imp', ?, ?, ?)`
  ).run(jobId, aliceHandle, Date.now() - 1000, Date.now());
  ctx.db.prepare(
    `INSERT INTO subs (name, owner_handle, created_at, imported_from_url) VALUES ('lobby-imp', ?, ?, ?)`
  ).run(aliceHandle, Date.now(), 'https://src.example/x.tar.gz');
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, sub_name, target_type, target_id, snippet, created_at)
     VALUES (?, 'import_ready', 'lobby-imp', 'import', ?, 's', ?)`
  ).run(aliceHandle, jobId, Date.now());
  const notifRow = ctx.db.prepare('SELECT id FROM notifications WHERE kind = ? LIMIT 1').get('import_ready');
  const res = await jfetch(jar, ctx.baseUrl + `/memlog/go/${notifRow.id}`);
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/sub/lobby-imp');
});

test('GET /memlog: import_failed row renders snippet with no link', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const aliceHandle = ctx.db.prepare(
    `SELECT handle FROM handles ORDER BY first_seen_at DESC LIMIT 1`
  ).get()?.handle;
  const jobId = randomBytes(8).toString('hex');
  ctx.db.prepare(
    `INSERT INTO import_jobs (id, source_url, requested_by, requested_at, failed_at, error_message)
     VALUES (?, 'https://bad.example/missing.tar.gz', ?, ?, ?, 'fetch failed: HTTP 404')`
  ).run(jobId, aliceHandle, Date.now() - 1000, Date.now());
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, target_type, target_id, snippet, created_at)
     VALUES (?, 'import_failed', 'import', ?, 'import failed after 3 attempts: fetch failed: HTTP 404', ?)`
  ).run(aliceHandle, jobId, Date.now());
  const res = await jfetch(jar, ctx.baseUrl + '/memlog?show=all');
  const body = await res.text();
  assert.match(body, /import failed/);
  assert.match(body, /HTTP 404/);
});

test('GET /memlog?kind=imports: filter chip narrows to import kinds', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const jar = await loginAs(ctx, 'alice@plato.test');
  const aliceHandle = ctx.db.prepare(
    `SELECT handle FROM handles ORDER BY first_seen_at DESC LIMIT 1`
  ).get()?.handle;
  // One import_ready + one comment_on_post; filter must keep only import_ready.
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, target_type, target_id, snippet, created_at)
     VALUES (?, 'import_ready', 'import', 'imp1', 'snippet-import', ?)`
  ).run(aliceHandle, Date.now() - 1000);
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, sub_name, target_type, target_id, snippet, created_at)
     VALUES (?, 'comment_on_post', 'lobby', 'post', 'p1', 'snippet-comment', ?)`
  ).run(aliceHandle, Date.now());
  const res = await jfetch(jar, ctx.baseUrl + '/memlog?kind=imports&show=all');
  const body = await res.text();
  assert.match(body, /snippet-import/);
  assert.doesNotMatch(body, /snippet-comment/);
});
