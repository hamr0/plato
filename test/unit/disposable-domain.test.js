import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDisposableDomains, isDisposableEmail } from '../../src/content/disposable-domain.js';

function tempFile(content) {
  const dir = mkdtempSync(join(tmpdir(), 'plato-disp-'));
  const path = join(dir, 'domains.txt');
  writeFileSync(path, content);
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('loadDisposableDomains: parses one domain per line', (t) => {
  const { path, cleanup } = tempFile('mailinator.com\nguerrillamail.com\n');
  t.after(cleanup);

  const set = loadDisposableDomains(path);
  assert.equal(set.size, 2);
  assert.ok(set.has('mailinator.com'));
  assert.ok(set.has('guerrillamail.com'));
});

test('loadDisposableDomains: skips comments and blank lines', (t) => {
  const { path, cleanup } = tempFile([
    '# this is a comment',
    '',
    'mailinator.com',
    '   ',
    '# another comment',
    'tempmail.com',
  ].join('\n'));
  t.after(cleanup);

  const set = loadDisposableDomains(path);
  assert.equal(set.size, 2);
});

test('loadDisposableDomains: lowercases and trims', (t) => {
  const { path, cleanup } = tempFile('  Mailinator.COM  \n  TEMPMAIL.com');
  t.after(cleanup);

  const set = loadDisposableDomains(path);
  assert.ok(set.has('mailinator.com'));
  assert.ok(set.has('tempmail.com'));
});

test('isDisposableEmail: matches a known disposable domain', () => {
  const set = new Set(['mailinator.com', 'tempmail.com']);
  assert.equal(isDisposableEmail('user@mailinator.com', set), true);
  assert.equal(isDisposableEmail('user@tempmail.com', set), true);
});

test('isDisposableEmail: case-insensitive on domain', () => {
  const set = new Set(['mailinator.com']);
  assert.equal(isDisposableEmail('user@Mailinator.COM', set), true);
});

test('isDisposableEmail: returns false for legitimate domains', () => {
  const set = new Set(['mailinator.com']);
  assert.equal(isDisposableEmail('user@gmail.com', set), false);
  assert.equal(isDisposableEmail('user@example.org', set), false);
});

test('isDisposableEmail: handles malformed input gracefully', () => {
  const set = new Set(['mailinator.com']);
  assert.equal(isDisposableEmail('', set), false);
  assert.equal(isDisposableEmail('not-an-email', set), false);
  assert.equal(isDisposableEmail(null, set), false);
  assert.equal(isDisposableEmail(undefined, set), false);
  assert.equal(isDisposableEmail(42, set), false);
});

test('isDisposableEmail: subdomain match is exact (no fuzzy match)', () => {
  // PRD intentionally treats this as exact-match-on-domain, not suffix-match.
  // mail.mailinator.com is a different domain; if we want to block it, the
  // operator adds it to the list explicitly.
  const set = new Set(['mailinator.com']);
  assert.equal(isDisposableEmail('user@evil.mailinator.com', set), false,
    'exact match only — subdomain not auto-blocked');
});

test('isDisposableEmail: trailing whitespace in email is tolerated', () => {
  const set = new Set(['mailinator.com']);
  assert.equal(isDisposableEmail('user@mailinator.com  ', set), true);
});

test('isDisposableEmail: multiple @-signs uses last @ as splitter', () => {
  // RFC 5321 only allows one @, but defensive parsing handles weird input.
  const set = new Set(['mailinator.com']);
  assert.equal(isDisposableEmail('weird@inner@mailinator.com', set), true);
});
