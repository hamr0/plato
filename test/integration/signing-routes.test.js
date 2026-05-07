// HTTP routes for M7/B4 archive signing.
//   GET  /.well-known/plato-pubkey       — public-key advertisement
//   GET  /export/<token>.tar.gz.sig      — token-bearer detached signature
//   GET  /about                          — surfaces the fingerprint

import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { knowless } from 'knowless';
import { gzipSync } from 'node:zlib';
import { openDb } from '../../src/db/index.js';
import { loadDisposableDomains } from '../../src/content/disposable-domain.js';
import { createApp } from '../../src/web/app.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  newDownloadToken, DOWNLOAD_TTL_MS, completeJob, enqueueSubExport,
} from '../../src/archive/queue.js';
import {
  getOrCreateInstanceKeypair, signBytes, verifyBytes,
} from '../../src/archive/signing.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DISPOSABLE_PATH = resolve(HERE, '../../disposable-domains.txt');

async function spinUp(brandingOverrides = {}) {
  return new Promise((res) => {
    const tmp = http.createServer((q, r) => r.end()).listen(0, () => {
      const port = tmp.address().port;
      tmp.close(() => {
        const baseUrl = `http://localhost:${port}`;
        const db = openDb(':memory:');
        applyAllMigrations(db);
        const auth = knowless({
          secret: randomBytes(32).toString('hex'),
          baseUrl, from: 'a@t', dbPath: ':memory:',
          openRegistration: true, cookieSecure: false,
          mailer: { async submit() {}, async verify() { return null; }, async close() {} },
        });
        const postsDir = mkdtempSync(join(tmpdir(), 'plato-sign-posts-'));
        const exportsDir = mkdtempSync(join(tmpdir(), 'plato-sign-exp-'));
        const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);
        const app = createApp({
          db, auth, disposableDomains, postsDir, exportsDir, baseUrl,
          branding: { forumName: 'tests', hostedBy: '@tester', ...brandingOverrides },
        });
        const server = http.createServer(app).listen(port, () => {
          res({ db, auth, postsDir, exportsDir, baseUrl, server });
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

// ---- /.well-known/plato-pubkey ----

test('GET /.well-known/plato-pubkey: returns JSON with algorithm, hex pubkey, fingerprint', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/.well-known/plato-pubkey');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^application\/json/);
  const body = await res.json();
  assert.equal(body.algorithm, 'ed25519');
  assert.match(body.public_key_hex, /^[0-9a-f]{64}$/);
  assert.match(body.fingerprint, /^sha256:[0-9a-f]{64}$/);
  assert.match(body.created_at, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(body.instance.forum_name, 'tests');
  assert.equal(body.instance.base_url, ctx.baseUrl);
});

test('GET /.well-known/plato-pubkey: served pubkey matches DB row + verifies signed bytes', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(ctx.baseUrl + '/.well-known/plato-pubkey');
  const body = await res.json();
  const dbKp = getOrCreateInstanceKeypair(ctx.db);
  assert.equal(body.public_key_hex, dbKp.publicKey.toString('hex'));
  // Prove the JSON's pubkey can verify a signature produced by the DB privkey.
  const message = Buffer.from('contract-bound message');
  const sig = signBytes(dbKp.privateKey, message);
  const pub = Buffer.from(body.public_key_hex, 'hex');
  assert.equal(verifyBytes(pub, message, sig), true);
});

test('GET /.well-known/plato-pubkey: idempotent across requests', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const a = await (await fetch(ctx.baseUrl + '/.well-known/plato-pubkey')).json();
  const b = await (await fetch(ctx.baseUrl + '/.well-known/plato-pubkey')).json();
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.public_key_hex, b.public_key_hex);
  assert.equal(a.created_at, b.created_at);
});

// ---- /about fingerprint ----

test('GET /about: surfaces the instance signing fingerprint with link to /.well-known/plato-pubkey', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const kp = getOrCreateInstanceKeypair(ctx.db);
  const res = await fetch(ctx.baseUrl + '/about');
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.match(body, /archive signing/i);
  assert.match(body, new RegExp(kp.fingerprint.replace(/:/g, '[:]?')));
  assert.match(body, /href="\/\.well-known\/plato-pubkey"/);
});

// ---- /export/<token>.tar.gz.sig ----

function seedSignedExport(db, exportsDir, { handle, subName, body, now = Date.now() }) {
  // Build a fake archive + matching signature using the real keypair so
  // the test exercises the actual route plumbing end-to-end.
  const kp = getOrCreateInstanceKeypair(db);
  const sig = signBytes(kp.privateKey, body);
  const filename = `plato-export-${subName}-fixture.tar.gz`;
  writeFileSync(join(exportsDir, filename), body);
  writeFileSync(join(exportsDir, `${filename}.sig`), sig);
  // completeJob writes a public-modlog row crediting the requester
  // (M7 followup); ensure the handle FK exists.
  db.prepare(
    'INSERT OR IGNORE INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)'
  ).run(handle, `pseudo-${handle.slice(0, 8)}`, now);
  const job = enqueueSubExport(db, { subName, requestedBy: handle, now: now - 1000 });
  const token = newDownloadToken();
  completeJob(db, job.id, {
    archiveFilename: filename, archiveSizeBytes: body.length, downloadToken: token, now,
  });
  return { token, filename, sig, kp };
}

test('GET /export/<token>.tar.gz.sig: serves detached signature alongside the archive', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  ctx.db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
  const archiveBytes = gzipSync(Buffer.from('fake archive payload'));
  const { token, sig } = seedSignedExport(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', body: archiveBytes,
  });
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz.sig`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /\.tar\.gz\.sig"/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const got = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(got, sig);
  // And the served sig verifies against the served pubkey + the served archive bytes.
  const pkRes = await (await fetch(ctx.baseUrl + '/.well-known/plato-pubkey')).json();
  const pub = Buffer.from(pkRes.public_key_hex, 'hex');
  const arRes = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz`, { redirect: 'manual' });
  const arBytes = Buffer.from(await arRes.arrayBuffer());
  assert.equal(verifyBytes(pub, arBytes, got), true);
});

test('GET /export/<token>.tar.gz.sig: bad token → 404', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(`${ctx.baseUrl}/export/${'0'.repeat(64)}.tar.gz.sig`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('GET /export/<token>.tar.gz.sig: sig file missing on disk → 404 (archive predates B4)', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  ctx.db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
  const archiveBytes = gzipSync(Buffer.from('legacy unsigned archive'));
  const { token, filename } = seedSignedExport(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', body: archiveBytes,
  });
  rmSync(join(ctx.exportsDir, `${filename}.sig`));
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz.sig`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

// ---- /export/<token>.tar.gz.ots (M7/B6 — operator-opt-in OpenTimestamps) ----

test('GET /export/<token>.tar.gz.ots: serves .ots proof when present on disk', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  ctx.db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
  const archiveBytes = gzipSync(Buffer.from('payload'));
  const { token, filename } = seedSignedExport(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', body: archiveBytes,
  });
  // Synthesize a fake .ots proof next to the archive (operator with
  // ots-cli would land here naturally; we just write bytes for the
  // route test).
  const otsBytes = Buffer.from('opentimestamps proof v1: stub bytes for test');
  const { writeFileSync } = await import('node:fs');
  writeFileSync(join(ctx.exportsDir, `${filename}.ots`), otsBytes);
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz.ots`, { redirect: 'manual' });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'application/octet-stream');
  assert.match(res.headers.get('content-disposition'), /\.tar\.gz\.ots"/);
  assert.equal(res.headers.get('cache-control'), 'private, no-store');
  const got = Buffer.from(await res.arrayBuffer());
  assert.deepEqual(got, otsBytes);
});

test('GET /export/<token>.tar.gz.ots: missing proof → 404 with operator-opt-in hint', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  ctx.db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
  const archiveBytes = gzipSync(Buffer.from('payload'));
  const { token } = seedSignedExport(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', body: archiveBytes,
  });
  // No .ots file written — simulates an operator who hasn't installed
  // ots-cli.
  const res = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz.ots`, { redirect: 'manual' });
  assert.equal(res.status, 404);
  const body = await res.text();
  assert.match(body, /operator may not have opted in/);
});

test('GET /export/<token>.tar.gz.ots: bad token → 404', async (t) => {
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  const res = await fetch(`${ctx.baseUrl}/export/${'0'.repeat(64)}.tar.gz.ots`, { redirect: 'manual' });
  assert.equal(res.status, 404);
});

test('GET /export/<token>.tar.gz: signature path no longer matches the .tar.gz route', async (t) => {
  // Defensive: ensure the EXPORT_DOWNLOAD_PATH_RE is anchored so .sig doesn't satisfy it.
  const ctx = await spinUp(); t.after(() => teardown(ctx));
  ctx.db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run('lobby', Date.now());
  const archiveBytes = gzipSync(Buffer.from('payload'));
  const { token } = seedSignedExport(ctx.db, ctx.exportsDir, {
    handle: 'h'.repeat(64), subName: 'lobby', body: archiveBytes,
  });
  const archive = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz`, { redirect: 'manual' });
  const sig = await fetch(`${ctx.baseUrl}/export/${token}.tar.gz.sig`, { redirect: 'manual' });
  assert.equal(archive.headers.get('content-type'), 'application/gzip');
  assert.equal(sig.headers.get('content-type'), 'application/octet-stream');
});
