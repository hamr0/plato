// Queue state-machine + per-sub builder tests (M7/B2-a).
//
// Doesn't exercise the bin/run-export-queue.js worker directly — that's a
// thin glue script. The state machine and the builder are the load-bearing
// pieces; both are tested here.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  enqueueSubExport, enqueueUserExport, claimNextPendingJob,
  completeJob, failJob, markStaleAsFailed,
  findCompletedJobByToken, findLatestJob, pruneExpiredJobs, newDownloadToken,
  MAX_ATTEMPTS, DOWNLOAD_TTL_MS, SLA_MS,
} from '../../src/archive/queue.js';
import { buildSubArchiveBytes, archiveFilenameFor } from '../../src/archive/sub-export.js';
import { validateManifest, sha256Hex } from '../../src/archive/manifest.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function memDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

function ensureHandle(db, handle, pseudonym) {
  db.prepare(
    'INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)'
  ).run(handle, pseudonym, Date.now());
}

function ts(d) { return Date.UTC(2026, 4, 6) + d * 1000; }

// In-memory tar reader, ustar regular files only.
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

// --- Queue state machine ---

test('enqueueSubExport: creates pending row on first call, returns same row on re-request', () => {
  const db = memDb();
  const j1 = enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  assert.equal(j1.kind, 'sub');
  assert.equal(j1.scope, 'lobby');
  assert.equal(j1.requested_by, 'h1');
  assert.equal(j1.started_at, null);
  assert.equal(j1.completed_at, null);
  assert.equal(j1.failed_at, null);
  assert.equal(j1.retry_count, 0);

  const j2 = enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(2) });
  assert.equal(j2.id, j1.id, 'idempotent — same row returned');
});

test('enqueueSubExport: same sub, different user gets a different row', () => {
  const db = memDb();
  const a = enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  const b = enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h2', now: ts(2) });
  assert.notEqual(a.id, b.id);
});

test('claimNextPendingJob: marks pending → in-progress, increments retry_count, returns null when empty', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  assert.ok(job);
  assert.equal(job.started_at, ts(2));
  assert.equal(job.retry_count, 1);
  // Second claim while job is in-progress (started_at != null) returns null.
  assert.equal(claimNextPendingJob(db, { now: ts(3) }), null);
});

test('claimNextPendingJob: oldest first', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'a', requestedBy: 'h1', now: ts(10) });
  enqueueSubExport(db, { subName: 'b', requestedBy: 'h1', now: ts(5) });
  const j = claimNextPendingJob(db, { now: ts(20) });
  assert.equal(j.scope, 'b', 'older requested_at wins');
});

test('completeJob: sets completion fields + expires_at', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  const token = newDownloadToken();
  completeJob(db, job.id, {
    archiveFilename: 'plato-export-lobby-2026-05-06.tar.gz',
    archiveSizeBytes: 12345,
    downloadToken: token,
    now: ts(3),
  });
  const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(job.id);
  assert.equal(row.completed_at, ts(3));
  assert.equal(row.archive_size_bytes, 12345);
  assert.equal(row.download_token, token);
  assert.equal(row.expires_at, ts(3) + DOWNLOAD_TTL_MS.sub);
});

test('completeJob: rejects malformed token', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  assert.throws(() => completeJob(db, job.id, {
    archiveFilename: 'x', archiveSizeBytes: 1, downloadToken: 'short',
  }), /downloadToken must be 64-char hex/);
});

test('failJob: requeues on attempts < MAX, terminal-fails on the MAX-th', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  // Attempt 1
  let j = claimNextPendingJob(db, { now: ts(2) });
  assert.equal(failJob(db, j.id, { errorMessage: 'first', now: ts(3) }), 'requeued');
  let row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(j.id);
  assert.equal(row.started_at, null, 're-queued: started_at cleared');
  assert.equal(row.failed_at, null);
  assert.equal(row.error_message, 'first');
  assert.equal(row.retry_count, 1);

  // Attempt 2
  j = claimNextPendingJob(db, { now: ts(4) });
  assert.equal(j.retry_count, 2);
  assert.equal(failJob(db, j.id, { errorMessage: 'second', now: ts(5) }), 'requeued');

  // Attempt 3 (terminal)
  j = claimNextPendingJob(db, { now: ts(6) });
  assert.equal(j.retry_count, MAX_ATTEMPTS);
  assert.equal(failJob(db, j.id, { errorMessage: 'third', now: ts(7) }), 'failed');
  row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(j.id);
  assert.equal(row.failed_at, ts(7));
  assert.equal(row.error_message, 'third');
});

test('terminal-failed job releases dedupe slot — user can re-request', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const j = claimNextPendingJob(db, { now: ts(2 + i) });
    failJob(db, j.id, { errorMessage: `attempt ${i + 1}`, now: ts(3 + i) });
  }
  // After terminal fail, a new request should succeed (different row).
  const fresh = enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(20) });
  assert.equal(fresh.failed_at, null);
  assert.equal(fresh.retry_count, 0);
});

test('findCompletedJobByToken: matches only completed and unexpired', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  const token = newDownloadToken();
  completeJob(db, job.id, {
    archiveFilename: 'f.tar.gz', archiveSizeBytes: 1, downloadToken: token, now: ts(3),
  });
  // Within window
  assert.ok(findCompletedJobByToken(db, token, { now: ts(3) + 1000 }));
  // Past expiry
  assert.equal(findCompletedJobByToken(db, token, { now: ts(3) + DOWNLOAD_TTL_MS.sub + 1 }), null);
  // Bad token
  assert.equal(findCompletedJobByToken(db, 'not-a-token', { now: ts(3) }), null);
});

test('findLatestJob: returns most recent regardless of state', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  // Claim + fail MAX_ATTEMPTS times so the first job goes terminal.
  for (let i = 0; i < MAX_ATTEMPTS; i++) {
    const j = claimNextPendingJob(db, { now: ts(2 + i * 2) });
    failJob(db, j.id, { errorMessage: 'x', now: ts(3 + i * 2) });
  }
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(20) });
  const latest = findLatestJob(db, { kind: 'sub', scope: 'lobby', requestedBy: 'h1' });
  assert.equal(latest.requested_at, ts(20));
});

test('pruneExpiredJobs: deletes expired rows + reports filenames', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  const token = newDownloadToken();
  completeJob(db, job.id, {
    archiveFilename: 'expired.tar.gz', archiveSizeBytes: 1, downloadToken: token, now: ts(3),
  });
  // Before expiry — no prune.
  assert.deepEqual(pruneExpiredJobs(db, { now: ts(3) + 1000 }), []);
  // Past expiry — pruned, filename returned.
  const filenames = pruneExpiredJobs(db, { now: ts(3) + DOWNLOAD_TTL_MS.sub + 1 });
  assert.deepEqual(filenames, ['expired.tar.gz']);
  assert.equal(db.prepare('SELECT COUNT(*) AS c FROM export_jobs').get().c, 0);
});

// --- enqueueUserExport ---

test('enqueueUserExport: creates pending row, scope == requestedBy', () => {
  const db = memDb();
  const j = enqueueUserExport(db, { requestedBy: 'h1', now: ts(1) });
  assert.equal(j.kind, 'user');
  assert.equal(j.scope, 'h1');
  assert.equal(j.requested_by, 'h1');
  assert.equal(j.started_at, null);
});

test('enqueueUserExport: idempotent while a job is pending', () => {
  const db = memDb();
  const a = enqueueUserExport(db, { requestedBy: 'h1', now: ts(1) });
  const b = enqueueUserExport(db, { requestedBy: 'h1', now: ts(2) });
  assert.equal(a.id, b.id);
});

test('enqueueUserExport: different users get different rows', () => {
  const db = memDb();
  const a = enqueueUserExport(db, { requestedBy: 'h1', now: ts(1) });
  const b = enqueueUserExport(db, { requestedBy: 'h2', now: ts(2) });
  assert.notEqual(a.id, b.id);
});

test('enqueueUserExport: completed job releases dedupe slot', () => {
  const db = memDb();
  enqueueUserExport(db, { requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  completeJob(db, job.id, {
    archiveFilename: 'plato-export-user-h1-2026-05-06.tar.gz',
    archiveSizeBytes: 1, downloadToken: newDownloadToken(), now: ts(3),
  });
  const fresh = enqueueUserExport(db, { requestedBy: 'h1', now: ts(4) });
  assert.notEqual(fresh.id, job.id, 'new row created after completion');
});

// --- Per-kind TTL ---

test('completeJob: user kind uses user TTL', () => {
  const db = memDb();
  enqueueUserExport(db, { requestedBy: 'h1', now: ts(1) });
  const job = claimNextPendingJob(db, { now: ts(2) });
  completeJob(db, job.id, {
    archiveFilename: 'u.tar.gz', archiveSizeBytes: 1, downloadToken: newDownloadToken(), now: ts(3),
  });
  const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(job.id);
  assert.equal(row.expires_at, ts(3) + DOWNLOAD_TTL_MS.user);
});

// --- markStaleAsFailed (SLA sweep) ---

test('markStaleAsFailed: terminal-fails sub jobs older than 7d', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(0) });
  const swept = markStaleAsFailed(db, { now: ts(0) + SLA_MS.sub + 1 });
  assert.equal(swept.length, 1);
  assert.match(swept[0].error_message, /exceeded SLA window \(sub: 7d\)/);
  const row = db.prepare('SELECT * FROM export_jobs WHERE id = ?').get(swept[0].id);
  assert.notEqual(row.failed_at, null);
});

test('markStaleAsFailed: terminal-fails user jobs older than 3d (shorter SLA)', () => {
  const db = memDb();
  enqueueUserExport(db, { requestedBy: 'h1', now: ts(0) });
  // Past user SLA but not yet past sub SLA — only user is swept.
  const swept = markStaleAsFailed(db, { now: ts(0) + SLA_MS.user + 1 });
  assert.equal(swept.length, 1);
  assert.equal(swept[0].kind, 'user');
  assert.match(swept[0].error_message, /exceeded SLA window \(user: 3d\)/);
});

test('markStaleAsFailed: leaves recent pending jobs untouched', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(0) });
  const swept = markStaleAsFailed(db, { now: ts(0) + SLA_MS.sub - 1000 });
  assert.equal(swept.length, 0);
  const row = db.prepare('SELECT failed_at FROM export_jobs').get();
  assert.equal(row.failed_at, null);
});

test('markStaleAsFailed: ignores already-completed and already-failed rows', () => {
  const db = memDb();
  // One completed
  enqueueSubExport(db, { subName: 'a', requestedBy: 'h1', now: ts(0) });
  let job = claimNextPendingJob(db, { now: ts(1) });
  completeJob(db, job.id, {
    archiveFilename: 'a.tar.gz', archiveSizeBytes: 1, downloadToken: newDownloadToken(), now: ts(2),
  });
  // One pending, fresh
  enqueueSubExport(db, { subName: 'b', requestedBy: 'h1', now: ts(SLA_MS.sub / 1000 - 100) });
  // Sweep at "way past SLA for the completed one, but completed rows are immune".
  const swept = markStaleAsFailed(db, { now: ts(0) + SLA_MS.sub + 10 * 24 * 3600 * 1000 });
  // b is past SLA → swept; a is completed → untouched.
  assert.equal(swept.length, 1);
  assert.equal(swept[0].scope, 'b');
});

test('markStaleAsFailed: a mid-flight job (started_at set, retry < MAX) is also swept if past SLA', () => {
  const db = memDb();
  enqueueSubExport(db, { subName: 'lobby', requestedBy: 'h1', now: ts(0) });
  // Worker claimed it at ts(1) — now past SLA without ever completing.
  claimNextPendingJob(db, { now: ts(1) });
  const swept = markStaleAsFailed(db, { now: ts(0) + SLA_MS.sub + 1 });
  assert.equal(swept.length, 1, 'started-but-stuck jobs are still terminal-failed by SLA sweep');
});

// --- Per-sub builder ---

function seedSubFixture(db, postsDir, subName) {
  // Two handles
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`)
    .run('a'.repeat(64), 'alice-pseudo', ts(0));
  db.prepare(`INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`)
    .run('b'.repeat(64), 'bob-pseudo', ts(0));
  db.prepare(`INSERT INTO subs (name, description, owner_handle, default_sort, created_at)
              VALUES (?, ?, ?, 'new', ?)`)
    .run(subName, 'a sub for tests', 'a'.repeat(64), ts(0));
  // One post by alice
  const postId = '1234567890abcdef';
  const filename = `2026-05-06-${postId}.md`;
  writeFileSync(
    join(postsDir, filename),
    `---\ntitle: "first post"\nhandle: ${'a'.repeat(64)}\nsub_name: ${subName}\ncreated_at: ${ts(10)}\n---\n\nhello world.\n`,
    'utf8',
  );
  db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score)
     VALUES (?, ?, ?, ?, ?, ?, 1.5)`
  ).run(postId, subName, 'a'.repeat(64), 'first post', `posts/${filename}`, ts(10));
  // One comment by bob
  db.prepare(
    `INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at, score)
     VALUES (?, ?, NULL, ?, ?, ?, 1.0)`
  ).run('cccccccccccccccc', postId, 'b'.repeat(64), 'nice post', ts(15));
  // One mod action
  db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
     VALUES (?, ?, ?, 'collapse', 'post', ?, 'spammy', ?)`
  ).run('aaaaaaaaaaaaaaaa', subName, 'a'.repeat(64), postId, ts(20));
  // Vote tallies
  db.prepare(`INSERT INTO votes (target_type, target_id, handle, value, created_at) VALUES ('post', ?, ?, 1, ?)`)
    .run(postId, 'b'.repeat(64), ts(11));
  db.prepare(`INSERT INTO votes (target_type, target_id, handle, value, created_at) VALUES ('comment', 'cccccccccccccccc', ?, 1, ?)`)
    .run('a'.repeat(64), ts(16));
  return { postId };
}

test('buildSubArchiveBytes: produces a valid tarball with all expected files', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    const { postId } = seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const paths = entries.map((e) => e.path).sort();
    assert.deepEqual(paths, [
      'README.md', 'archive.css', 'comments.json', 'index.html',
      'manifest.json', 'modlog.json',
      'posts.json', `posts/${postId}.html`, `posts/${postId}.md`,
      'subs.json', 'votes.json',
    ]);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildSubArchiveBytes: manifest hashes match every file body', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const manifestEntry = entryByPath(entries, 'manifest.json');
    const manifest = JSON.parse(manifestEntry.body.toString('utf8'));
    validateManifest(manifest);
    for (const file of manifest.files) {
      const e = entryByPath(entries, file.path);
      assert.ok(e, `manifest references ${file.path} but it's not in the archive`);
      assert.equal(e.body.length, file.size, `${file.path}: size mismatch`);
      assert.equal(sha256Hex(e.body), file.sha256, `${file.path}: sha256 mismatch`);
    }
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildSubArchiveBytes: posts.json + comments.json + modlog.json shapes', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    const { postId } = seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const posts = JSON.parse(entryByPath(entries, 'posts.json').body.toString('utf8'));
    assert.equal(posts.length, 1);
    assert.equal(posts[0].id, postId);
    assert.equal(posts[0].pseudonym, 'alice-pseudo');
    assert.equal(posts[0].comment_count, 1);

    const comments = JSON.parse(entryByPath(entries, 'comments.json').body.toString('utf8'));
    assert.equal(comments.length, 1);
    assert.equal(comments[0].pseudonym, 'bob-pseudo');
    assert.equal(comments[0].body, 'nice post');

    const modlog = JSON.parse(entryByPath(entries, 'modlog.json').body.toString('utf8'));
    assert.equal(modlog.length, 1);
    assert.equal(modlog[0].action, 'collapse');
    assert.equal(modlog[0].mod_pseudonym, 'alice-pseudo');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildSubArchiveBytes: votes.json carries tallies only — no per-voter handles', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    const { postId } = seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const votes = JSON.parse(entryByPath(entries, 'votes.json').body.toString('utf8'));
    assert.deepEqual(votes[`post:${postId}`], { up: 1, down: 0, score: 1.5 });
    assert.deepEqual(votes['comment:cccccccccccccccc'], { up: 1, down: 0, score: 1.0 });
    // Per-voter handle should never appear in votes.json
    const raw = entryByPath(entries, 'votes.json').body.toString('utf8');
    assert.doesNotMatch(raw, /a{30}/, 'voter handle leaked');
    assert.doesNotMatch(raw, /b{30}/, 'voter handle leaked');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildSubArchiveBytes: posts/<id>.md is the on-disk source byte-for-byte', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    const { postId } = seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const md = entryByPath(entries, `posts/${postId}.md`).body.toString('utf8');
    assert.match(md, /^---\ntitle: "first post"\n/);
    assert.match(md, /\nhello world\.\n$/);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildSubArchiveBytes: throws on missing sub', () => {
  const db = memDb();
  assert.throws(() => buildSubArchiveBytes(db, 'no-such-sub', {
    postsDir: '/tmp', branding: { forumName: 't', baseUrl: '' }, platoVersion: '0.1.0',
  }), /sub no-such-sub not found/);
});

test('buildSubArchiveBytes: throws on missing post .md so worker can retry', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    seedSubFixture(db, postsDir, 'studio');
    // Wipe the postsDir between seeding and exporting to simulate a
    // disk-level failure mid-deploy.
    rmSync(postsDir, { recursive: true, force: true });
    mkdirSync(postsDir);
    assert.throws(() => buildSubArchiveBytes(db, 'studio', {
      postsDir, branding: { forumName: 't', baseUrl: '' }, platoVersion: '0.1.0',
    }), /ENOENT/);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('archiveFilenameFor: shape', () => {
  const f = archiveFilenameFor('lobby', new Date('2026-05-06T12:00:00Z'));
  assert.equal(f, 'plato-export-lobby-2026-05-06.tar.gz');
});

// --- M7 followup: shared-artifact dedupe + sentinel fan-out ---

test('enqueueSubExport: second user requesting same sub with completed-non-expired archive reuses bytes (fresh token)', () => {
  const db = memDb();
  const ALICE = 'a'.repeat(64);
  const BOB = 'b'.repeat(64);
  ensureHandle(db, ALICE, 'alice-pseudo');
  ensureHandle(db, BOB, 'bob-pseudo');
  // Alice enqueues + completes.
  const j1 = enqueueSubExport(db, { subName: 'lobby', requestedBy: ALICE, now: ts(0) });
  claimNextPendingJob(db, { now: ts(1) });
  completeJob(db, j1.id, {
    archiveFilename: 'plato-export-lobby-2026-05-07-aaaa1111.tar.gz',
    archiveSizeBytes: 1024,
    downloadToken: 'a'.repeat(64),
    now: ts(2),
  });
  // Bob requests now, while Alice's archive is still downloadable.
  const j2 = enqueueSubExport(db, { subName: 'lobby', requestedBy: BOB, now: ts(3) });
  // Bob's row should be insta-completed pointing at the same file.
  assert.notEqual(j2.id, j1.id, 'should be a fresh row');
  assert.equal(j2.archive_filename, 'plato-export-lobby-2026-05-07-aaaa1111.tar.gz', 'reuses on-disk file');
  assert.equal(j2.archive_size_bytes, 1024);
  assert.notEqual(j2.download_token, 'a'.repeat(64), 'Bob gets a fresh bearer token');
  assert.match(j2.download_token, /^[0-9a-f]{64}$/);
  assert.ok(j2.completed_at, 'Bob is completed without going through the worker');
  // Both rows share expires_at — pruner unlinks the file when both windows close.
  const j1Row = db.prepare('SELECT expires_at FROM export_jobs WHERE id = ?').get(j1.id);
  assert.equal(j2.expires_at, j1Row.expires_at, 'shared expires_at');
});

test('enqueueSubExport: second user while parent is in-flight gets a sentinel row', () => {
  const db = memDb();
  const ALICE = 'a'.repeat(64);
  const BOB = 'b'.repeat(64);
  ensureHandle(db, ALICE, 'alice-pseudo');
  ensureHandle(db, BOB, 'bob-pseudo');
  const parent = enqueueSubExport(db, { subName: 'lobby', requestedBy: ALICE, now: ts(0) });
  claimNextPendingJob(db, { now: ts(1) }); // parent now in-progress
  const sentinel = enqueueSubExport(db, { subName: 'lobby', requestedBy: BOB, now: ts(2) });
  assert.notEqual(sentinel.id, parent.id);
  assert.equal(sentinel.started_at, -1, 'sentinel marker on started_at');
  assert.equal(sentinel.completed_at, null);
  // Worker's claim should not pick the sentinel.
  const next = claimNextPendingJob(db, { now: ts(3) });
  assert.equal(next, null, 'sentinel must not be claimable as a real job');
});

test('completeJob: fan-out completes sentinel siblings with fresh tokens + shared expires_at', () => {
  const db = memDb();
  const ALICE = 'a'.repeat(64);
  const BOB = 'b'.repeat(64);
  const CHARLIE = 'c'.repeat(64);
  ensureHandle(db, ALICE, 'alice-pseudo');
  ensureHandle(db, BOB, 'bob-pseudo');
  ensureHandle(db, CHARLIE, 'charlie-pseudo');
  const parent = enqueueSubExport(db, { subName: 'lobby', requestedBy: ALICE, now: ts(0) });
  claimNextPendingJob(db, { now: ts(1) });
  // Two sentinels for different users join while parent is in-flight.
  const s1 = enqueueSubExport(db, { subName: 'lobby', requestedBy: BOB,     now: ts(2) });
  const s2 = enqueueSubExport(db, { subName: 'lobby', requestedBy: CHARLIE, now: ts(3) });
  assert.equal(s1.started_at, -1);
  assert.equal(s2.started_at, -1);
  // Worker completes parent.
  completeJob(db, parent.id, {
    archiveFilename: 'plato-export-lobby-2026-05-07-aaaa1111.tar.gz',
    archiveSizeBytes: 9999,
    downloadToken: 'a'.repeat(64),
    now: ts(4),
  });
  const rows = db.prepare('SELECT id, completed_at, archive_filename, archive_size_bytes, download_token, expires_at, started_at FROM export_jobs WHERE kind = ? AND scope = ? ORDER BY requested_at').all('sub', 'lobby');
  assert.equal(rows.length, 3);
  for (const r of rows) {
    assert.ok(r.completed_at, `${r.id} should be completed`);
    assert.equal(r.archive_filename, 'plato-export-lobby-2026-05-07-aaaa1111.tar.gz');
    assert.equal(r.archive_size_bytes, 9999);
    assert.equal(r.expires_at, rows[0].expires_at, 'all share parent\'s expires_at');
    assert.notEqual(r.started_at, -1, 'sentinels filled in');
  }
  const tokens = new Set(rows.map((r) => r.download_token));
  assert.equal(tokens.size, 3, 'each requester gets a unique download token');
});

test('failJob terminal: fans out to sentinels too', () => {
  const db = memDb();
  const ALICE = 'a'.repeat(64);
  const BOB = 'b'.repeat(64);
  ensureHandle(db, ALICE, 'alice-pseudo');
  ensureHandle(db, BOB, 'bob-pseudo');
  const parent = enqueueSubExport(db, { subName: 'lobby', requestedBy: ALICE, now: ts(0) });
  claimNextPendingJob(db, { now: ts(1) });
  const sentinel = enqueueSubExport(db, { subName: 'lobby', requestedBy: BOB, now: ts(2) });
  assert.equal(sentinel.started_at, -1);
  // Burn through retries.
  for (let i = 1; i < MAX_ATTEMPTS; i++) {
    failJob(db, parent.id, { errorMessage: `attempt ${i}` });
    claimNextPendingJob(db);
  }
  const result = failJob(db, parent.id, { errorMessage: 'final boom', now: ts(99) });
  assert.equal(result, 'failed');
  const sentinelRow = db.prepare('SELECT failed_at, error_message FROM export_jobs WHERE id = ?').get(sentinel.id);
  assert.equal(sentinelRow.failed_at, ts(99));
  assert.equal(sentinelRow.error_message, 'final boom');
});

test('archiveFilenameFor: includes 8-hex jobId disambiguator when supplied', () => {
  const f1 = archiveFilenameFor('foo', new Date(Date.UTC(2026, 4, 7)));
  const f2 = archiveFilenameFor('foo', new Date(Date.UTC(2026, 4, 7)), { jobId: 'aaaa1111deadbeef' });
  assert.equal(f1, 'plato-export-foo-2026-05-07.tar.gz');
  assert.equal(f2, 'plato-export-foo-2026-05-07-aaaa1111.tar.gz');
});

test('pruneExpiredJobs: returns deduped filename list when many rows share one artifact', () => {
  const db = memDb();
  const ALICE = 'a'.repeat(64);
  const BOB = 'b'.repeat(64);
  ensureHandle(db, ALICE, 'alice-pseudo');
  ensureHandle(db, BOB, 'bob-pseudo');
  const j1 = enqueueSubExport(db, { subName: 'lobby', requestedBy: ALICE, now: ts(0) });
  claimNextPendingJob(db);
  completeJob(db, j1.id, {
    archiveFilename: 'plato-export-lobby-2026-05-07-aaaa1111.tar.gz',
    archiveSizeBytes: 1, downloadToken: 'a'.repeat(64), now: ts(1),
  });
  // Bob reuses while still downloadable.
  enqueueSubExport(db, { subName: 'lobby', requestedBy: BOB, now: ts(2) });
  // Move clock past TTL.
  const future = ts(1) + DOWNLOAD_TTL_MS.sub + 1000;
  const filenames = pruneExpiredJobs(db, { now: future });
  assert.deepEqual(filenames, ['plato-export-lobby-2026-05-07-aaaa1111.tar.gz']);
  // Both rows are gone.
  const remaining = db.prepare('SELECT COUNT(*) AS n FROM export_jobs').get().n;
  assert.equal(remaining, 0);
});

test('buildSubArchiveBytes: pubkeyFingerprint defaults to null in manifest', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const entries = readTar(tar);
    const manifest = JSON.parse(entryByPath(entries, 'manifest.json').body.toString('utf8'));
    assert.equal(manifest.instance.pubkey_fingerprint, null);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('buildSubArchiveBytes: pubkeyFingerprint when supplied lands in manifest.instance', () => {
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    seedSubFixture(db, postsDir, 'studio');
    const fp = 'sha256:' + 'ab'.repeat(32);
    const tar = buildSubArchiveBytes(db, 'studio', {
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

test('buildSubArchiveBytes: gzipped tarball round-trips through gunzip', async () => {
  const { gzipSync, gunzipSync } = await import('node:zlib');
  const db = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-export-'));
  try {
    seedSubFixture(db, postsDir, 'studio');
    const tar = buildSubArchiveBytes(db, 'studio', {
      postsDir,
      branding: { forumName: 'testforum', baseUrl: 'http://localhost' },
      platoVersion: '0.1.0',
      exportedAt: new Date(ts(100)),
    });
    const gz = gzipSync(tar);
    const unz = gunzipSync(gz);
    assert.deepEqual(Buffer.from(unz), Buffer.from(tar), 'gzip round-trip preserves bytes');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});
