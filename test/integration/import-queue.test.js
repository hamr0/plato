// Import-queue state machine + builder + tar reader (M7/B5).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  enqueueSubImport, claimNextPendingImport, completeImport,
  failImport, recordSourceMetadata, markStaleImportsAsFailed,
  findCompletedImportBySource, findLatestImportJob,
  IMPORT_SLA_MS, MAX_ATTEMPTS,
} from '../../src/archive/import-queue.js';
import { readTar } from '../../src/archive/extract.js';
import { writeTar } from '../../src/archive/tar.js';
import {
  parseAndVerifyArchive, importSubArchive, pseudonymForImport,
} from '../../src/archive/import.js';
import { buildSubArchiveBytes } from '../../src/archive/sub-export.js';

const HERE = dirname(fileURLToPath(import.meta.url));

function memDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}
function ts(d) { return Date.UTC(2026, 4, 6) + d * 1000; }

const SOURCE_URL = 'https://source.example.com/export/aaaa.tar.gz';
const ALICE = 'a'.repeat(64);
const BOB   = 'b'.repeat(64);

function ensureHandle(db, handle, pseudonym) {
  db.prepare(
    `INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)`
  ).run(handle, pseudonym, Date.now());
}

// --- queue state machine ---

test('enqueueSubImport: requires handle, valid http(s) url', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  assert.throws(() => enqueueSubImport(db, { sourceUrl: '', requestedBy: ALICE }), /sourceUrl/);
  assert.throws(() => enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: '' }), /requestedBy/);
  assert.throws(() => enqueueSubImport(db, { sourceUrl: 'not-a-url', requestedBy: ALICE }), /valid URL/);
  assert.throws(() => enqueueSubImport(db, { sourceUrl: 'ftp://x/y', requestedBy: ALICE }), /http\(s\)/);
});

test('enqueueSubImport: dedupes pending requests per (url, handle)', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  const a = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  const b = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  assert.equal(a.id, b.id, 'second click while pending → same row');
  // Different user can enqueue same URL independently.
  ensureHandle(db, BOB, 'bob-pseudo');
  const c = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: BOB });
  assert.notEqual(a.id, c.id);
});

test('claimNextPendingImport: pops in requested_at order, sets started_at, increments retry_count', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE, now: ts(10) });
  enqueueSubImport(db, { sourceUrl: SOURCE_URL + '2', requestedBy: ALICE, now: ts(20) });
  const first = claimNextPendingImport(db, { now: ts(30) });
  assert.equal(first.requested_at, ts(10));
  assert.equal(first.started_at, ts(30));
  assert.equal(first.retry_count, 1);
  const second = claimNextPendingImport(db, { now: ts(40) });
  assert.equal(second.requested_at, ts(20));
  const third = claimNextPendingImport(db, { now: ts(50) });
  assert.equal(third, null, 'no more pending');
});

test('completeImport: stamps imported_sub_name + completed_at; fingerprints idempotence', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  const job = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  recordSourceMetadata(db, job.id, {
    sourceScopeSub: 'lobby', sourceExportedAt: '2026-05-06T00:00:00.000Z',
    sourceFingerprint: 'sha256:xx', sourceBaseUrl: 'https://source.example.com',
    sourceForumName: 'sourceforum', archiveSizeBytes: 12345,
  });
  claimNextPendingImport(db);
  completeImport(db, job.id, { importedSubName: 'lobby', now: ts(100) });

  const row = db.prepare('SELECT * FROM import_jobs WHERE id = ?').get(job.id);
  assert.equal(row.imported_sub_name, 'lobby');
  assert.equal(row.completed_at, ts(100));

  // Idempotence index: another completed row with same (source_scope_sub,
  // source_exported_at) is rejected at the unique index level.
  const job2 = enqueueSubImport(db, { sourceUrl: SOURCE_URL + 'b', requestedBy: ALICE });
  recordSourceMetadata(db, job2.id, {
    sourceScopeSub: 'lobby', sourceExportedAt: '2026-05-06T00:00:00.000Z',
  });
  claimNextPendingImport(db);
  assert.throws(
    () => completeImport(db, job2.id, { importedSubName: 'lobby2', now: ts(200) }),
    /UNIQUE constraint failed/
  );
});

test('failImport: re-queues until MAX_ATTEMPTS, then terminal-fails', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  const job = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
    claimNextPendingImport(db);
    const r = failImport(db, job.id, { errorMessage: `boom ${attempt}` });
    assert.equal(r, 'requeued');
  }
  claimNextPendingImport(db);
  const r = failImport(db, job.id, { errorMessage: `final` });
  assert.equal(r, 'failed');
  const row = db.prepare('SELECT failed_at, error_message FROM import_jobs WHERE id = ?').get(job.id);
  assert.ok(row.failed_at);
  assert.equal(row.error_message, 'final');
});

test('markStaleImportsAsFailed: sweeps rows past SLA, leaves fresh ones', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  const fresh = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE, now: ts(0) });
  // Stale: requested at the past, longer than SLA.
  const stale = enqueueSubImport(db, { sourceUrl: SOURCE_URL + 'old', requestedBy: ALICE, now: ts(0) - IMPORT_SLA_MS - 1000 });
  const swept = markStaleImportsAsFailed(db, { now: ts(0) });
  assert.equal(swept.length, 1);
  assert.equal(swept[0].id, stale.id);
  const freshRow = db.prepare('SELECT failed_at FROM import_jobs WHERE id = ?').get(fresh.id);
  assert.equal(freshRow.failed_at, null);
});

test('findCompletedImportBySource: returns row when archive previously imported, null otherwise', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  assert.equal(findCompletedImportBySource(db, { sourceScopeSub: 'x', sourceExportedAt: '2026-01-01' }), null);
  // Seed a completed row.
  const job = enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  recordSourceMetadata(db, job.id, {
    sourceScopeSub: 'lobby', sourceExportedAt: '2026-05-06T00:00:00.000Z',
  });
  claimNextPendingImport(db);
  completeImport(db, job.id, { importedSubName: 'lobby' });
  const found = findCompletedImportBySource(db, {
    sourceScopeSub: 'lobby', sourceExportedAt: '2026-05-06T00:00:00.000Z',
  });
  assert.ok(found);
  assert.equal(found.imported_sub_name, 'lobby');
});

test('findLatestImportJob: returns most recent (by requested_at)', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'alice-pseudo');
  enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE, now: ts(10) });
  // Move to terminal so we can re-enqueue.
  const j1 = findLatestImportJob(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  claimNextPendingImport(db);
  for (let i = 0; i < MAX_ATTEMPTS + 1; i++) {
    claimNextPendingImport(db);
    failImport(db, j1.id, { errorMessage: 'x' });
  }
  enqueueSubImport(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE, now: ts(50) });
  const latest = findLatestImportJob(db, { sourceUrl: SOURCE_URL, requestedBy: ALICE });
  assert.equal(latest.requested_at, ts(50));
});

// --- pseudonym collision bracket ---

test('pseudonymForImport: no collision → archived pseudonym verbatim', () => {
  const db = memDb();
  const r = pseudonymForImport(db, 'clever-tiger');
  assert.deepEqual(r, { value: 'clever-tiger', bracketed: false });
});

test('pseudonymForImport: collision wraps lexical part — clever-tiger → [clever]-tiger', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'clever-tiger');
  const r = pseudonymForImport(db, 'clever-tiger');
  assert.deepEqual(r, { value: '[clever]-tiger', bracketed: true });
});

test('pseudonymForImport: bracketed form also collides → numeric suffix', () => {
  const db = memDb();
  ensureHandle(db, ALICE, 'clever-tiger');
  ensureHandle(db, BOB, '[clever]-tiger');
  const r = pseudonymForImport(db, 'clever-tiger');
  assert.deepEqual(r, { value: '[clever]-tiger-2', bracketed: true });
});

// --- tar reader symmetry ---

test('readTar/writeTar: round-trips entries verbatim', () => {
  const buf = writeTar([
    { path: 'a.txt', body: 'hello' },
    { path: 'b/c.json', body: '{"x":1}' },
  ], { defaultMtime: 1700000000000 });
  const out = readTar(buf);
  assert.equal(out.size, 2);
  assert.equal(out.get('a.txt').toString(), 'hello');
  assert.equal(out.get('b/c.json').toString(), '{"x":1}');
});

test('readTar: rejects path traversal', () => {
  const buf = writeTar([{ path: 'a.txt', body: 'x' }]);
  // Manually corrupt the name to start with ../
  buf[0] = '.'.charCodeAt(0); buf[1] = '.'.charCodeAt(0); buf[2] = '/'.charCodeAt(0);
  buf[3] = 0;
  // Recompute checksum so the integrity check doesn't catch it first.
  buf.write('        ', 148, 8, 'ascii');
  let sum = 0; for (let i = 0; i < 512; i++) sum += buf[i];
  buf.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 8, 'ascii');
  assert.throws(() => readTar(buf), /traversal/);
});

test('readTar: rejects header checksum mismatch', () => {
  const buf = writeTar([{ path: 'a.txt', body: 'x' }]);
  buf[10] = (buf[10] + 1) & 0xff; // flip a bit in the name
  assert.throws(() => readTar(buf), /checksum mismatch/);
});

// --- importSubArchive end-to-end ---

function seedSourceFixture(db, postsDir, subName) {
  // Mirror the export-queue.test.js fixture so we exercise the round-trip.
  ensureHandle(db, ALICE, 'alice-pseudo');
  ensureHandle(db, BOB, 'bob-pseudo');
  db.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run(subName, ALICE, ts(0));
  db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)').run(subName, ALICE, 'owner');
  db.prepare(
    `INSERT INTO posts (id, sub_name, handle, title, file_path, created_at, score) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('post01', subName, ALICE, 'first post', `posts/${subName}-post01.md`, ts(10), 1.5);
  // Write the .md file to disk so the source-export builder can read it.
  writeFileSync(
    `${postsDir}/${subName}-post01.md`,
    `---\ntitle: "first post"\nhandle: ${ALICE}\nsub_name: ${subName}\ncreated_at: ${ts(10)}\n---\n\nhello world\n`
  );
  db.prepare(
    `INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at, score) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('comm01', 'post01', null, BOB, 'top reply', ts(20), 0.5);
  db.prepare(
    `INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at, score) VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('comm02', 'post01', 'comm01', ALICE, 'thread', ts(25), 0);
  db.prepare(
    `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('mod01', subName, ALICE, 'collapse', 'comment', 'comm02', 'noisy', ts(30));
}

// Helper: build a fresh sub archive Buffer from a memDb fixture.
async function buildFixtureArchive(subName, fingerprint = 'sha256:dead' + 'beef'.repeat(15)) {
  const sourceDb = memDb();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-importtest-src-'));
  seedSourceFixture(sourceDb, postsDir, subName);
  const tar = buildSubArchiveBytes(sourceDb, subName, {
    postsDir,
    branding: { forumName: 'sourceforum', baseUrl: 'https://source.example.com' },
    platoVersion: '0.1.0',
    exportedAt: new Date(ts(100)),
    pubkeyFingerprint: fingerprint,
  });
  return { tar, postsDir, sourceDb };
}

test('parseAndVerifyArchive: roundtrips an export, returns shaped data', async () => {
  const { tar, postsDir, sourceDb } = await buildFixtureArchive('lobby');
  try {
    const parsed = parseAndVerifyArchive(tar);
    assert.equal(parsed.manifest.kind, 'sub');
    assert.equal(parsed.manifest.scope.sub, 'lobby');
    assert.equal(parsed.posts.length, 1);
    assert.equal(parsed.comments.length, 2);
    assert.equal(parsed.modlog.length, 1);
    assert.ok(parsed.postBodies.has('post01'));
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
    sourceDb.close();
  }
});

test('parseAndVerifyArchive: refuses kind=user', () => {
  // Synthesize a minimal kind=user archive; the verify path should refuse
  // before doing any DB work.
  const fakeManifest = {
    format_version: 1, plato_version: '0.1.0',
    kind: 'user', scope: { handle_attribution: 'alice-pseudo' },
    exported_at: '2026-05-06T00:00:00.000Z',
    instance: { forum_name: 'x', base_url: 'https://x', pubkey_fingerprint: null },
    counts: { posts: 0, comments: 0, mod_actions: 0, subs: 0 }, files: [],
  };
  const tar = writeTar([{ path: 'manifest.json', body: JSON.stringify(fakeManifest) }]);
  assert.throws(() => parseAndVerifyArchive(tar), /only kind=sub archives/);
});

test('parseAndVerifyArchive: refuses sha256 mismatch', async () => {
  const { tar, postsDir, sourceDb } = await buildFixtureArchive('lobby');
  try {
    // Find a post .md byte and flip it. The posts/<id>.md offset is well
    // past the manifest; flip somewhere safe inside its body region.
    // Find "hello world" in the tarball and flip the 'h'.
    const idx = tar.indexOf(Buffer.from('hello world'));
    assert.ok(idx > 0, 'fixture should contain hello world');
    tar[idx] = (tar[idx] + 1) & 0xff;
    assert.throws(() => parseAndVerifyArchive(tar), /sha256 mismatch|checksum/);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
    sourceDb.close();
  }
});

test('importSubArchive: round-trip — exported sub re-emerges on a fresh instance with all rows', async () => {
  const { tar, postsDir: srcPostsDir, sourceDb } = await buildFixtureArchive('lobby');
  const destDb = memDb();
  const destPostsDir = mkdtempSync(join(tmpdir(), 'plato-importtest-dest-'));
  const importerHandle = 'c'.repeat(64);
  ensureHandle(destDb, importerHandle, 'importer-pseudo');
  try {
    const parsed = parseAndVerifyArchive(tar);
    const result = importSubArchive(destDb, {
      parsed, postsDir: destPostsDir, importerHandle, now: ts(500),
    });
    assert.equal(result.subName, 'lobby');
    assert.equal(result.counts.posts, 1);
    assert.equal(result.counts.comments, 2);
    assert.equal(result.counts.modActions, 1);
    // Sub row exists, owner = importer, imported_* columns set.
    const subRow = destDb.prepare('SELECT * FROM subs WHERE name = ?').get('lobby');
    assert.equal(subRow.owner_handle, importerHandle);
    assert.equal(subRow.imported_from_url, 'https://source.example.com');
    assert.match(subRow.imported_from_fingerprint, /^sha256:/);
    assert.equal(subRow.imported_at, ts(500));
    assert.ok(subRow.imported_at_source > 0);
    // Importer is the sub's mod via sub_mods.
    const modRole = destDb.prepare('SELECT role FROM sub_mods WHERE sub_name = ? AND handle = ?').get('lobby', importerHandle);
    assert.equal(modRole.role, 'owner');
    // Original handles inserted as imported (alice/bob), with their archived
    // pseudonyms verbatim (no collision in this run).
    const aliceRow = destDb.prepare('SELECT * FROM handles WHERE handle = ?').get(ALICE);
    assert.equal(aliceRow.pseudonym, 'alice-pseudo');
    assert.match(aliceRow.imported_from_fingerprint, /^sha256:/);
    // Posts preserved with original ID.
    const postRow = destDb.prepare('SELECT * FROM posts WHERE id = ?').get('post01');
    assert.equal(postRow.sub_name, 'lobby');
    assert.equal(postRow.handle, ALICE);
    assert.equal(postRow.score, 1.5);
    // Post body is on disk under the dest postsDir (file_path follows YYYY-MM-DD shape).
    const onDisk = readFileSync(resolve(destPostsDir, postRow.file_path.replace(/^posts\//, '')), 'utf8');
    assert.match(onDisk, /hello world/);
    // Comments preserved with original IDs and parent thread.
    const c1 = destDb.prepare('SELECT * FROM comments WHERE id = ?').get('comm01');
    const c2 = destDb.prepare('SELECT * FROM comments WHERE id = ?').get('comm02');
    assert.equal(c1.post_id, 'post01');
    assert.equal(c2.parent_comment_id, 'comm01');
    // Mod action preserved + tagged imported.
    const action = destDb.prepare('SELECT * FROM mod_actions WHERE id = ?').get('mod01');
    assert.equal(action.action, 'collapse');
    assert.match(action.imported_from_fingerprint, /^sha256:/);
  } finally {
    rmSync(srcPostsDir, { recursive: true, force: true });
    rmSync(destPostsDir, { recursive: true, force: true });
    sourceDb.close();
    destDb.close();
  }
});

test('importSubArchive: refuses on destination sub name conflict', async () => {
  const { tar, postsDir: srcPostsDir, sourceDb } = await buildFixtureArchive('lobby');
  const destDb = memDb();
  const destPostsDir = mkdtempSync(join(tmpdir(), 'plato-importtest-dest-'));
  const importerHandle = 'c'.repeat(64);
  ensureHandle(destDb, importerHandle, 'importer-pseudo');
  try {
    // Pre-seed a sub with the same name on the destination.
    destDb.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('lobby', importerHandle, Date.now());
    const parsed = parseAndVerifyArchive(tar);
    assert.throws(
      () => importSubArchive(destDb, { parsed, postsDir: destPostsDir, importerHandle }),
      /already in use/
    );
  } finally {
    rmSync(srcPostsDir, { recursive: true, force: true });
    rmSync(destPostsDir, { recursive: true, force: true });
    sourceDb.close();
    destDb.close();
  }
});

test('importSubArchive: rename_to lets you import past a name conflict', async () => {
  const { tar, postsDir: srcPostsDir, sourceDb } = await buildFixtureArchive('lobby');
  const destDb = memDb();
  const destPostsDir = mkdtempSync(join(tmpdir(), 'plato-importtest-dest-'));
  const importerHandle = 'c'.repeat(64);
  ensureHandle(destDb, importerHandle, 'importer-pseudo');
  try {
    destDb.prepare('INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)').run('lobby', importerHandle, Date.now());
    const parsed = parseAndVerifyArchive(tar);
    const result = importSubArchive(destDb, {
      parsed, postsDir: destPostsDir, importerHandle, renameTo: 'lobby-archive',
    });
    assert.equal(result.subName, 'lobby-archive');
    const renamedSub = destDb.prepare('SELECT name, imported_from_url FROM subs WHERE name = ?').get('lobby-archive');
    assert.equal(renamedSub.name, 'lobby-archive');
    assert.match(renamedSub.imported_from_url, /^https:/);
  } finally {
    rmSync(srcPostsDir, { recursive: true, force: true });
    rmSync(destPostsDir, { recursive: true, force: true });
    sourceDb.close();
    destDb.close();
  }
});

test('importSubArchive: pseudonym collision wraps lexical part on destination handle', async () => {
  const { tar, postsDir: srcPostsDir, sourceDb } = await buildFixtureArchive('lobby');
  const destDb = memDb();
  const destPostsDir = mkdtempSync(join(tmpdir(), 'plato-importtest-dest-'));
  const importerHandle = 'c'.repeat(64);
  ensureHandle(destDb, importerHandle, 'importer-pseudo');
  // Pre-seed: a different handle on the destination already has the
  // pseudonym 'alice-pseudo'. The imported alice's pseudonym should
  // bracket on insert.
  ensureHandle(destDb, 'd'.repeat(64), 'alice-pseudo');
  try {
    const parsed = parseAndVerifyArchive(tar);
    const result = importSubArchive(destDb, {
      parsed, postsDir: destPostsDir, importerHandle,
    });
    assert.equal(result.counts.bracketed, 1);
    const importedAlice = destDb.prepare('SELECT pseudonym FROM handles WHERE handle = ?').get(ALICE);
    assert.equal(importedAlice.pseudonym, '[alice]-pseudo');
  } finally {
    rmSync(srcPostsDir, { recursive: true, force: true });
    rmSync(destPostsDir, { recursive: true, force: true });
    sourceDb.close();
    destDb.close();
  }
});
