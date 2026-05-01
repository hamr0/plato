// URLhaus blocklist tests — M5/B5 (PRD §Spam Defenses 6).
// Covers cache loader, host extraction, matcher behavior, and the
// applyUrlhausMatches collapse + flag pipeline.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import {
  loadUrlhausCache, matchUrlhaus, applyUrlhausMatches,
} from '../../src/content/urlhaus.js';
import { SYSTEM_HANDLE } from '../../src/content/spamPatterns.js';
import { pendingFlagsAcrossSubs } from '../../src/content/flag.js';

const OWNER = 'a'.repeat(64);
const POSTER = 'e'.repeat(64);

function setup() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner'], [POSTER, 'post-x']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now() - 30 * 24 * 60 * 60 * 1000);
  }
  createSub(db, { name: 'lobby', description: '', ownerHandle: OWNER });
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p1', 'lobby', ?, 't', 'posts/p1.md', ?)`).run(POSTER, Date.now());
  return db;
}

function tmpUrlhausFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'plato-urlhaus-'));
  const path = join(dir, 'urlhaus.txt');
  writeFileSync(path, lines.join('\n'), 'utf8');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('loadUrlhausCache: skips comments and blanks, normalizes hosts', () => {
  const { path, cleanup } = tmpUrlhausFile([
    '# URLhaus dump',
    '# date: ...',
    '',
    'https://malware.example/payload.exe',
    'http://www.malware.example/another',  // dedups via www-stripping
    'http://OTHER-BAD.test/path',           // case-insensitive
  ]);
  try {
    const hosts = loadUrlhausCache(path);
    assert.equal(hosts.size, 2);
    assert.ok(hosts.has('malware.example'));
    assert.ok(hosts.has('other-bad.test'));
  } finally { cleanup(); }
});

test('loadUrlhausCache: missing file returns empty set', () => {
  const hosts = loadUrlhausCache('/nonexistent/urlhaus.txt');
  assert.equal(hosts.size, 0);
});

test('matchUrlhaus: returns matched hosts only', () => {
  const hosts = new Set(['bad.example']);
  assert.deepEqual(matchUrlhaus('see https://bad.example/x and https://good.example/y', hosts), ['bad.example']);
  assert.deepEqual(matchUrlhaus('all clean: https://good.example/x', hosts), []);
});

test('matchUrlhaus: dedupes a host hit by multiple URLs in same post', () => {
  const hosts = new Set(['bad.example']);
  const text = 'https://bad.example/a and https://bad.example/b and https://bad.example/c';
  assert.deepEqual(matchUrlhaus(text, hosts), ['bad.example']);
});

test('matchUrlhaus: empty host set is a no-op', () => {
  const hosts = new Set();
  assert.deepEqual(matchUrlhaus('https://anything.com', hosts), []);
});

test('matchUrlhaus: ignores non-URL noise', () => {
  const hosts = new Set(['bad.example']);
  assert.deepEqual(matchUrlhaus('not a url, just bad.example mentioned plainly', hosts), []);
});

test('applyUrlhausMatches: collapses target + inserts system flag with blocked-url note', () => {
  const db = setup();
  applyUrlhausMatches(db, {
    targetType: 'post', targetId: 'p1', matchedHosts: ['bad.example'],
  });
  const post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.ok(post.collapsed_at != null);
  const flag = db.prepare(`SELECT flagger_handle, category, note FROM flags WHERE target_id = 'p1'`).get();
  assert.equal(flag.flagger_handle, SYSTEM_HANDLE);
  assert.equal(flag.category, 'spam');
  assert.match(flag.note, /^blocked-url: bad\.example/);
});

test('applyUrlhausMatches: surfaces in /modlog open feed', () => {
  const db = setup();
  applyUrlhausMatches(db, { targetType: 'post', targetId: 'p1', matchedHosts: ['bad.example'] });
  const pending = pendingFlagsAcrossSubs(db, ['lobby']);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].target_id, 'p1');
});

test('applyUrlhausMatches: empty matched array is a no-op', () => {
  const db = setup();
  const result = applyUrlhausMatches(db, { targetType: 'post', targetId: 'p1', matchedHosts: [] });
  assert.equal(result.hidden, false);
});
