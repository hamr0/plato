import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FORMAT_VERSION,
  buildManifest,
  validateManifest,
  sha256Hex,
  findFile,
  verifyFile,
} from '../../src/archive/manifest.js';

const VALID_INPUTS = () => ({
  kind: 'sub',
  scope: { sub: 'lobby' },
  instance: { forum_name: 'example forum', base_url: 'https://example.com' },
  exportedAt: '2026-05-05T12:34:56Z',
  platoVersion: '0.6.0',
  counts: { posts: 1, comments: 0, mod_actions: 0, subs: 1 },
  files: [
    { path: 'posts/abc123.md', sha256: 'a'.repeat(64), size: 100 },
    { path: 'subs.json', sha256: 'b'.repeat(64), size: 50 },
  ],
});

test('sha256Hex: deterministic + matches openssl shape', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(sha256Hex('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  // Buffer + string with same content hash equally
  assert.equal(sha256Hex('plato'), sha256Hex(Buffer.from('plato', 'utf8')));
});

test('buildManifest: valid input returns canonical shape', () => {
  const m = buildManifest(VALID_INPUTS());
  assert.equal(m.format_version, FORMAT_VERSION);
  assert.equal(m.plato_version, '0.6.0');
  assert.equal(m.kind, 'sub');
  assert.deepEqual(m.scope, { sub: 'lobby' });
  assert.equal(m.exported_at, '2026-05-05T12:34:56Z');
  assert.equal(m.instance.forum_name, 'example forum');
  assert.equal(m.instance.base_url, 'https://example.com');
  assert.equal(m.instance.pubkey_fingerprint, null);
  assert.deepEqual(m.counts, { posts: 1, comments: 0, mod_actions: 0, subs: 1 });
  assert.equal(m.files.length, 2);
});

test('buildManifest: files array is sorted by path for determinism', () => {
  const inp = VALID_INPUTS();
  inp.files = [
    { path: 'z-last.json', sha256: 'a'.repeat(64), size: 1 },
    { path: 'a-first.md', sha256: 'b'.repeat(64), size: 1 },
    { path: 'm-middle.json', sha256: 'c'.repeat(64), size: 1 },
  ];
  const m = buildManifest(inp);
  assert.deepEqual(m.files.map((f) => f.path), ['a-first.md', 'm-middle.json', 'z-last.json']);
});

test('buildManifest: kind=user requires scope.handle_attribution', () => {
  const inp = VALID_INPUTS();
  inp.kind = 'user';
  inp.scope = { handle_attribution: 'alice-2x9k' };
  const m = buildManifest(inp);
  assert.deepEqual(m.scope, { handle_attribution: 'alice-2x9k' });
});

test('buildManifest: pubkey_fingerprint passes through when set', () => {
  const inp = VALID_INPUTS();
  inp.instance.pubkey_fingerprint = 'sha256:abc';
  const m = buildManifest(inp);
  assert.equal(m.instance.pubkey_fingerprint, 'sha256:abc');
});

test('buildManifest: missing exportedAt defaults to now (ISO)', () => {
  const inp = VALID_INPUTS();
  delete inp.exportedAt;
  const m = buildManifest(inp);
  assert.match(m.exported_at, /^\d{4}-\d{2}-\d{2}T/);
});

test('buildManifest: rejects invalid kind', () => {
  const inp = VALID_INPUTS();
  inp.kind = 'whole-forum';
  assert.throws(() => buildManifest(inp), /kind must be 'sub' or 'user'/);
});

test('buildManifest: rejects mismatched scope for kind', () => {
  const inp = VALID_INPUTS();
  inp.kind = 'user';
  // Still has sub-shaped scope
  assert.throws(() => buildManifest(inp), /scope\.handle_attribution/);
});

test('buildManifest: rejects path traversal in file paths', () => {
  const inp = VALID_INPUTS();
  inp.files = [{ path: '../etc/passwd', sha256: 'a'.repeat(64), size: 1 }];
  assert.throws(() => buildManifest(inp), /must be relative and not traverse/);
});

test('buildManifest: rejects absolute file paths', () => {
  const inp = VALID_INPUTS();
  inp.files = [{ path: '/posts/x.md', sha256: 'a'.repeat(64), size: 1 }];
  assert.throws(() => buildManifest(inp), /must be relative/);
});

test('buildManifest: rejects malformed sha256', () => {
  const inp = VALID_INPUTS();
  inp.files = [{ path: 'x.md', sha256: 'not-hex', size: 1 }];
  assert.throws(() => buildManifest(inp), /sha256 must be 64-char/);
});

test('buildManifest: rejects uppercase sha256', () => {
  const inp = VALID_INPUTS();
  inp.files = [{ path: 'x.md', sha256: 'A'.repeat(64), size: 1 }];
  assert.throws(() => buildManifest(inp), /sha256 must be 64-char lowercase/);
});

test('buildManifest: rejects negative size', () => {
  const inp = VALID_INPUTS();
  inp.files = [{ path: 'x.md', sha256: 'a'.repeat(64), size: -1 }];
  assert.throws(() => buildManifest(inp), /file\.size/);
});

test('buildManifest: rejects duplicate file paths', () => {
  const inp = VALID_INPUTS();
  inp.files = [
    { path: 'x.md', sha256: 'a'.repeat(64), size: 1 },
    { path: 'x.md', sha256: 'b'.repeat(64), size: 2 },
  ];
  assert.throws(() => buildManifest(inp), /duplicate file path/);
});

test('buildManifest: rejects negative counts', () => {
  const inp = VALID_INPUTS();
  inp.counts.posts = -1;
  assert.throws(() => buildManifest(inp), /counts\.posts/);
});

test('validateManifest: accepts a freshly-built manifest', () => {
  const m = buildManifest(VALID_INPUTS());
  assert.strictEqual(validateManifest(m), m);
});

test('validateManifest: rejects wrong format_version', () => {
  const m = buildManifest(VALID_INPUTS());
  m.format_version = 999;
  assert.throws(() => validateManifest(m), /unsupported format_version 999/);
});

test('validateManifest: rejects malformed exported_at', () => {
  const m = buildManifest(VALID_INPUTS());
  m.exported_at = 'yesterday';
  assert.throws(() => validateManifest(m), /ISO 8601/);
});

test('validateManifest: rejects null', () => {
  assert.throws(() => validateManifest(null), /not an object/);
});

test('findFile: returns entry by path', () => {
  const m = buildManifest(VALID_INPUTS());
  assert.equal(findFile(m, 'subs.json').path, 'subs.json');
  assert.equal(findFile(m, 'nope.json'), undefined);
});

test('verifyFile: bytes matching recorded hash → true', () => {
  const bytes = 'hello plato';
  const inp = VALID_INPUTS();
  inp.files = [{ path: 'greeting.txt', sha256: sha256Hex(bytes), size: bytes.length }];
  const m = buildManifest(inp);
  assert.equal(verifyFile(m, 'greeting.txt', bytes), true);
});

test('verifyFile: tampered bytes → false', () => {
  const bytes = 'hello plato';
  const inp = VALID_INPUTS();
  inp.files = [{ path: 'greeting.txt', sha256: sha256Hex(bytes), size: bytes.length }];
  const m = buildManifest(inp);
  assert.equal(verifyFile(m, 'greeting.txt', 'tampered'), false);
});

test('verifyFile: unknown path → false (does not throw)', () => {
  const m = buildManifest(VALID_INPUTS());
  assert.equal(verifyFile(m, 'ghost.json', 'anything'), false);
});

test('manifest is JSON-serializable round-trip safe', () => {
  const m = buildManifest(VALID_INPUTS());
  const round = JSON.parse(JSON.stringify(m));
  assert.deepEqual(round, m);
  // And re-validates after a serialize round-trip
  assert.strictEqual(validateManifest(round), round);
});
