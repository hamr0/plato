// Per-user archive builder + personal-export route + /memlog pill (M7/B2-b).

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
import { buildUserArchiveBytes, userArchiveFilenameFor } from '../../src/archive/user-export.js';
import { validateManifest, sha256Hex } from '../../src/archive/manifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

function memDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

function ts(d) { return Date.UTC(2026, 4, 6) + d * 1000; }

// Tar reader (ustar regular files only).
function readTar(buf) {
  const out = [];
  let i = 0;
  while (i + 512 <= buf.length) {
    if (buf[i] === 0) break;
    const name = buf.slice(i, i + 100).toString('utf8').replace(/\0+$/, '');
    const sizeStr = buf.slice(i + 124, i + 124 + 11).toString('ascii').replace(/\0/g, '');
    const size = parseInt(sizeStr, 8);
    const body = Buffer.from(buf.slice(i + 512, i + 512 + size));
    out.push({ path: name, body });
    const padded = size + (size % 512 === 0 ? 0 : 512 - (size % 512));
    i += 512 + padded;
  }
  return out;
}

function entryByPath(entries, path) {
  return entries.find((e) => e.path === path);
}

// Seed: one user (alice) authoring a post + comment in 'lobby', plus a
// vote, plus a subscription, plus a mod action against her post.
const ALICE = 'a'.repeat(64);
const BOB = 'b'.repeat(64);

function seedUserFixture(db, postsDir) {
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`).run(ALICE, 'alice-pseudo', ts(0));
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`).run(BOB, 'bob-pseudo', ts(0));
  db.prepare(`INSERT INTO subs (name, description, owner_handle, default_sort, created_at)
              VALUES ('lobby', '', ?, 'new', ?)`).run(BOB, ts(0));
  // alice authored 1 post + 1 comment in another sub
  db.prepare(`INSERT INTO subs (name, description, owner_handle, default_sort, created_at)
              VALUES ('news', '', ?, 'new', ?)`).run(ALICE, ts(0));

  const postId = '1234567890abcdef';
  const filename = `2026-05-06-${postId}.md`;
  writeFileSync(
    join(postsDir, filename),
    `---\ntitle: "alice's post"\nhandle: ${ALICE}\nsub_name: news\ncreated_at: ${ts(10)}\n---\n\nhello.\n`,
    'utf8',
  );
  db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score)
     VALUES (?, 'news', ?, ?, ?, ?, 1.0)`
  ).run(postId, ALICE, "alice's post", `posts/${filename}`, ts(10));

  // alice's comment on bob's-sub post
  const otherPostId = 'abcdef1234567890';
  const otherFilename = `2026-05-06-${otherPostId}.md`;
  writeFileSync(
    join(postsDir, otherFilename),
    `---\ntitle: "bob's post"\nhandle: ${BOB}\nsub_name: lobby\ncreated_at: ${ts(5)}\n---\n\nhi.\n`,
    'utf8',
  );
  db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score)
     VALUES (?, 'lobby', ?, ?, ?, ?, 1.0)`
  ).run(otherPostId, BOB, "bob's post", `posts/${otherFilename}`, ts(5));
  db.prepare(
    `INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at, score)
     VALUES (?, ?, NULL, ?, 'thoughtful reply', ?, 1.0)`
  ).run('cccccccccccccccc', otherPostId, ALICE, ts(11));

  // alice's subscription to lobby
  db.prepare(
    `INSERT INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, 'lobby', ?)`
  ).run(ALICE, ts(0));

  // alice voted on bob's post
  db.prepare(
    `INSERT INTO votes (target_type, target_id, handle, value, created_at)
     VALUES ('post', ?, ?, 1, ?)`
  ).run(otherPostId, ALICE, ts(6));

  // bob (mod of lobby) collapsed alice's comment
  db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
     VALUES ('mod-act-1', 'lobby', ?, 'collapse', 'comment', 'cccccccccccccccc', 'too punchy', ?)`
  ).run(BOB, ts(20));

  // alice (mod of news) banned bob from news (mod action she took)
  db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
     VALUES ('mod-act-2', 'news', ?, 'ban', 'handle', ?, 'spam', ?)`
  ).run(ALICE, BOB, ts(25));

  return { postId, otherPostId };
}

test('buildUserArchiveBytes: produces a valid tarball with all expected files', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    const { postId } = seedUserFixture(db, postsDir);
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, [
      'README.md', 'archive.css', 'comments.json', 'index.html',
      'manifest.json', 'mod_actions_received.json', 'mod_actions_taken.json',
      'posts.json', `posts/${postId}.html`, `posts/${postId}.md`,
      'subs_moderated.json', 'subscriptions.json', 'votes_cast.json',
    ]);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildUserArchiveBytes: pubkeyFingerprint when supplied lands in manifest.instance', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    seedUserFixture(db, postsDir);
    const fp = 'sha256:' + 'cd'.repeat(32);
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
      pubkeyFingerprint: fp,
    });
    const entries = readTar(tar);
    const manifest = JSON.parse(entryByPath(entries, 'manifest.json').body.toString('utf8'));
    assert.equal(manifest.instance.pubkey_fingerprint, fp);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildUserArchiveBytes: manifest has kind=user and scope.handle_attribution = pseudonym', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    seedUserFixture(db, postsDir);
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const manifest = JSON.parse(entryByPath(entries, 'manifest.json').body.toString('utf8'));
    validateManifest(manifest);
    assert.equal(manifest.kind, 'user');
    assert.equal(manifest.scope.handle_attribution, 'alice-pseudo');
    assert.ok(!('handle' in manifest.scope), 'scope must not leak the secret handle');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildUserArchiveBytes: posts.json + comments.json + votes_cast.json shapes', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    const { postId, otherPostId } = seedUserFixture(db, postsDir);
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);

    const posts = JSON.parse(entryByPath(entries, 'posts.json').body.toString('utf8'));
    assert.equal(posts.length, 1, 'only alice\'s posts');
    assert.equal(posts[0].id, postId);
    assert.equal(posts[0].sub_name, 'news');

    const comments = JSON.parse(entryByPath(entries, 'comments.json').body.toString('utf8'));
    assert.equal(comments.length, 1);
    assert.equal(comments[0].sub_name, 'lobby');
    assert.equal(comments[0].body, 'thoughtful reply');

    const votes = JSON.parse(entryByPath(entries, 'votes_cast.json').body.toString('utf8'));
    assert.deepEqual(votes[`post:${otherPostId}`], { value: 1, cast_at: ts(6) });
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildUserArchiveBytes: mod_actions_received vs mod_actions_taken split correctly', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    seedUserFixture(db, postsDir);
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const received = JSON.parse(entryByPath(entries, 'mod_actions_received.json').body.toString('utf8'));
    const taken = JSON.parse(entryByPath(entries, 'mod_actions_taken.json').body.toString('utf8'));
    assert.equal(received.length, 1);
    assert.equal(received[0].action, 'collapse');
    assert.equal(taken.length, 1);
    assert.equal(taken[0].action, 'ban');
    assert.equal(taken[0].target_pseudonym, 'bob-pseudo');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildUserArchiveBytes: subscriptions.json + subs_moderated.json', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    seedUserFixture(db, postsDir);
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const subs = JSON.parse(entryByPath(entries, 'subscriptions.json').body.toString('utf8'));
    assert.deepEqual(subs.map((s) => s.sub_name), ['lobby']);
    const moderated = JSON.parse(entryByPath(entries, 'subs_moderated.json').body.toString('utf8'));
    assert.equal(moderated.length, 1);
    assert.equal(moderated[0].sub_name, 'news');
    assert.equal(moderated[0].role, 'owner');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildUserArchiveBytes: throws on missing handle', () => {
  const db = memDb();
  assert.throws(() => buildUserArchiveBytes(db, 'z'.repeat(64), {
    postsDir: '/tmp', branding: { forumName: 't', baseUrl: '' }, platoVersion: '0.1.0',
  }), /handle.*not found/);
});

test('userArchiveFilenameFor: shape uses 8-char handle prefix', () => {
  const f = userArchiveFilenameFor(ALICE, new Date('2026-05-06T12:00:00Z'));
  assert.equal(f, 'plato-export-user-aaaaaaaa-2026-05-06.tar.gz');
});

test('buildUserArchiveBytes: votes.json doesn\'t leak OTHER users\' handles (only own)', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-'));
  try {
    seedUserFixture(db, postsDir);
    // Add BOB voting too — that vote should NOT appear in alice's archive.
    db.prepare(
      `INSERT INTO votes (target_type, target_id, handle, value, created_at)
       VALUES ('post', '1234567890abcdef', ?, 1, ?)`
    ).run(BOB, ts(12));
    const tar = buildUserArchiveBytes(db, ALICE, {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const raw = entryByPath(entries, 'votes_cast.json').body.toString('utf8');
    assert.doesNotMatch(raw, /b{30}/, 'bob\'s handle leaked into votes_cast.json');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

// --- HTTP-level: POST /export-request ---

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
        db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
        const mailer = captureMailer();
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false, mailer,
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-posts-'));
        const exportsDir = mkdtempSync(join(tmpdir(), 'plato-uexport-exp-'));
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
  res = await jfetch(jar, magicLinkFrom(mailer.sent.at(-1)));
  res = await jfetch(jar, new URL(res.headers.get('location'), baseUrl).toString());
  const handle = db.prepare('SELECT handle FROM posts ORDER BY created_at DESC LIMIT 1').get().handle;
  return { jar, handle };
}

test('POST /export-request: anonymous → 401', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 401);
});

test('POST /export-request: logged-in → 302 → /memlog?export=queued, row enqueued', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  assert.equal(res.status, 302);
  assert.equal(res.headers.get('location'), '/memlog?export=queued');
  const rows = ctx.db.prepare('SELECT * FROM export_jobs WHERE kind = ?').all('user');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].requested_by, handle);
  assert.equal(rows[0].scope, handle);
});

test('POST /export-request: idempotent — second call does not create a new row', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  for (let i = 0; i < 3; i++) {
    const res = await jfetch(jar, ctx.baseUrl + '/export-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: '',
    });
    assert.equal(res.status, 302);
  }
  const rows = ctx.db.prepare('SELECT * FROM export_jobs WHERE kind = ?').all('user');
  assert.equal(rows.length, 1);
});

// --- /memlog personal-export pill states ---

test('/memlog: logged-in user with no jobs → live "request archive" pill', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/memlog');
  const body = await res.text();
  assert.match(body, /<form[^>]*action="\/export-request"/);
  assert.match(body, /class="export-btn"[^>]*type="submit"[^>]*>request archive</);
});

test('/memlog: pending job → disabled "archive queued"', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  await jfetch(jar, ctx.baseUrl + '/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  const res = await jfetch(jar, ctx.baseUrl + '/memlog');
  const body = await res.text();
  assert.match(body, /class="export-btn"[^>]*disabled[^>]*archive queued/);
});

test('/memlog?export=queued: shows the "queued" hint', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  // Enqueue first so the pill shows queued state too.
  await jfetch(jar, ctx.baseUrl + '/export-request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: '',
  });
  const res = await jfetch(jar, ctx.baseUrl + '/memlog?export=queued');
  const body = await res.text();
  assert.match(body, /archive queued. you'll get a memlog notification/);
});

// --- Memlog notification wiring (export_ready / export_failed) ---

test('/memlog: export_ready notification renders with download link via memlog/go', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  // Seed a completed user-export job + the matching memlog notification.
  const jobId = randomBytes(8).toString('hex');
  const token = randomBytes(32).toString('hex');
  const completedAt = Date.now() - 1000;
  ctx.db.prepare(
    `INSERT INTO export_jobs
     (id, kind, scope, requested_by, requested_at, started_at, completed_at,
      retry_count, archive_filename, archive_size_bytes, download_token, expires_at)
     VALUES (?, 'user', ?, ?, ?, ?, ?, 1, 'a.tar.gz', 1, ?, ?)`
  ).run(jobId, handle, handle, completedAt - 5000, completedAt - 2000, completedAt,
        token, completedAt + 3 * 24 * 60 * 60 * 1000);
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, sub_name, target_type, target_id, snippet, created_at)
     VALUES (?, 'export_ready', NULL, 'export', ?, 'your personal archive is ready · expires 2026-05-09', ?)`
  ).run(handle, jobId, completedAt);
  const res = await jfetch(jar, ctx.baseUrl + '/memlog');
  const body = await res.text();
  // The "kind" cell shows the new label.
  assert.match(body, /archive ready/);
  // The link goes through /memlog/go/<id> which then redirects to the
  // download URL — same shape as other notification rows.
  const linkMatch = body.match(/<a href="\/memlog\/go\/(\d+)"/);
  assert.ok(linkMatch, '/memlog/go link present for export_ready');
  // Follow it and verify it lands on the token URL.
  const goRes = await jfetch(jar, `${ctx.baseUrl}/memlog/go/${linkMatch[1]}`);
  assert.equal(goRes.status, 302);
  assert.equal(goRes.headers.get('location'), `/export/${token}.tar.gz`);
});

test('/memlog: export_failed notification renders without a link', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar, handle } = await loginAs(ctx, 'a@x.test');
  // Seed a terminal-failed sub-export job + matching notification.
  const jobId = randomBytes(8).toString('hex');
  ctx.db.prepare(
    `INSERT INTO export_jobs
     (id, kind, scope, requested_by, requested_at, retry_count, failed_at, error_message)
     VALUES (?, 'sub', 'lobby', ?, ?, 3, ?, 'unknown error')`
  ).run(jobId, handle, Date.now() - 5000, Date.now());
  ctx.db.prepare(
    `INSERT INTO notifications (recipient_handle, kind, sub_name, target_type, target_id, snippet, created_at)
     VALUES (?, 'export_failed', 'lobby', 'export', ?, 'archive request failed after 3 attempts: unknown error', ?)`
  ).run(handle, jobId, Date.now());
  const res = await jfetch(jar, ctx.baseUrl + '/memlog');
  const body = await res.text();
  assert.match(body, /archive failed/);
  assert.match(body, /failed after 3 attempts/);
});

test('/memlog filter chip "archives" narrows to export kinds', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const { jar } = await loginAs(ctx, 'a@x.test');
  const res = await jfetch(jar, ctx.baseUrl + '/memlog?kind=archives');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /filter-btn-active[^>]*>archives</);
});
