// Spam regex pattern tests — M5/B3 (PRD §Spam Defenses 9).
//
// Covers the pattern loader, the matcher, and applySpamMatches end-to-end:
// matched targets get collapsed_at set + a system flag inserted that
// surfaces in /modlog open mode.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import {
  loadSpamPatterns, matchSpamPatterns, applySpamMatches, SYSTEM_HANDLE,
} from '../../src/content/spamPatterns.js';
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

function tmpPatternsFile(lines) {
  const dir = mkdtempSync(join(tmpdir(), 'plato-spam-'));
  const path = join(dir, 'patterns.txt');
  writeFileSync(path, lines.join('\n'), 'utf8');
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('loadSpamPatterns: skips comments and blanks, compiles the rest', () => {
  const { path, cleanup } = tmpPatternsFile([
    '# leading comment',
    '',
    'guaranteed returns',
    '   ',
    'double your investment',
  ]);
  try {
    const patterns = loadSpamPatterns(path);
    assert.equal(patterns.length, 2);
    assert.equal(patterns[0].source, 'guaranteed returns');
    assert.ok(patterns[0].regex instanceof RegExp);
  } finally { cleanup(); }
});

test('loadSpamPatterns: skips invalid regex without crashing', () => {
  const { path, cleanup } = tmpPatternsFile(['(unclosed', 'valid pattern']);
  try {
    const patterns = loadSpamPatterns(path);
    // The valid one survives; the bad one is dropped.
    assert.equal(patterns.length, 1);
    assert.equal(patterns[0].source, 'valid pattern');
  } finally { cleanup(); }
});

test('loadSpamPatterns: missing file returns empty array', () => {
  assert.deepEqual(loadSpamPatterns('/nonexistent/path.txt'), []);
  assert.deepEqual(loadSpamPatterns(null), []);
});

test('matchSpamPatterns: case-insensitive + collapses whitespace', () => {
  const patterns = [{ source: 'guaranteed returns', regex: /guaranteed returns/i }];
  assert.deepEqual(matchSpamPatterns('GUARANTEED RETURNS!', patterns), ['guaranteed returns']);
  assert.deepEqual(matchSpamPatterns('guaranteed\nreturns!', patterns), ['guaranteed returns']);
  assert.deepEqual(matchSpamPatterns('clean text here', patterns), []);
});

test('matchSpamPatterns: returns every matching pattern in order', () => {
  const patterns = [
    { source: 'a', regex: /a/i },
    { source: 'b', regex: /b/i },
    { source: 'c', regex: /c/i },
  ];
  assert.deepEqual(matchSpamPatterns('abracadabra', patterns), ['a', 'b', 'c']);
  assert.deepEqual(matchSpamPatterns('xyz', patterns), []);
});

test('applySpamMatches: collapses target + inserts system flag', () => {
  const db = setup();
  const result = applySpamMatches(db, {
    targetType: 'post', targetId: 'p1', matched: ['guaranteed returns'],
  });
  assert.equal(result.hidden, true);

  const post = db.prepare('SELECT collapsed_at, score_at_collapse FROM posts WHERE id = ?').get('p1');
  assert.ok(post.collapsed_at != null, 'post should be collapsed');
  assert.ok(post.score_at_collapse != null, 'score_at_collapse snapshot');

  const flag = db.prepare(`SELECT flagger_handle, category, note, resolution FROM flags WHERE target_id = 'p1'`).get();
  assert.equal(flag.flagger_handle, SYSTEM_HANDLE);
  assert.equal(flag.category, 'spam');
  assert.match(flag.note, /pattern: guaranteed returns/);
  assert.equal(flag.resolution, 'pending');
});

test('applySpamMatches: idempotent on re-run (UNIQUE constraint)', () => {
  const db = setup();
  applySpamMatches(db, { targetType: 'post', targetId: 'p1', matched: ['x'] });
  applySpamMatches(db, { targetType: 'post', targetId: 'p1', matched: ['x'] });
  const flagCount = db.prepare(`SELECT COUNT(*) AS n FROM flags WHERE target_id = 'p1'`).get().n;
  assert.equal(flagCount, 1, 'system handle dedupes via UNIQUE');
});

test('applySpamMatches surfaces in pendingFlagsAcrossSubs (open mode feed)', () => {
  const db = setup();
  applySpamMatches(db, { targetType: 'post', targetId: 'p1', matched: ['guaranteed returns'] });
  const pending = pendingFlagsAcrossSubs(db, ['lobby']);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].target_id, 'p1');
  assert.equal(pending[0].pending, 1);
});

test('applySpamMatches: empty matched array is a no-op', () => {
  const db = setup();
  const result = applySpamMatches(db, { targetType: 'post', targetId: 'p1', matched: [] });
  assert.equal(result.hidden, false);
  const post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.equal(post.collapsed_at, null);
});

test('applySpamMatches: writes system-attributed mod_actions audit row', () => {
  const db = setup();
  applySpamMatches(db, {
    targetType: 'post', targetId: 'p1', subName: 'lobby', matched: ['guaranteed returns'],
  });
  const audit = db.prepare(
    `SELECT mod_handle, action, target_type, target_id, reason, sub_name
     FROM mod_actions WHERE target_id = 'p1'`
  ).get();
  assert.ok(audit, 'audit row should exist');
  assert.equal(audit.mod_handle, SYSTEM_HANDLE);
  assert.equal(audit.action, 'collapse');
  assert.equal(audit.target_type, 'post');
  assert.equal(audit.sub_name, 'lobby');
  assert.match(audit.reason, /pattern: guaranteed returns/);
});

test('applySpamMatches: skips audit row when target already collapsed', () => {
  const db = setup();
  applySpamMatches(db, { targetType: 'post', targetId: 'p1', subName: 'lobby', matched: ['x'] });
  applySpamMatches(db, { targetType: 'post', targetId: 'p1', subName: 'lobby', matched: ['x'] });
  const n = db.prepare(`SELECT COUNT(*) AS n FROM mod_actions WHERE target_id = 'p1'`).get().n;
  assert.equal(n, 1, 'no double-audit on re-publish');
});

test('applySpamMatches: omits audit row when no subName passed', () => {
  const db = setup();
  applySpamMatches(db, { targetType: 'post', targetId: 'p1', matched: ['x'] });
  const n = db.prepare(`SELECT COUNT(*) AS n FROM mod_actions WHERE target_id = 'p1'`).get().n;
  assert.equal(n, 0);
});

test('migration 007: SYSTEM_HANDLE row exists with pseudonym "system"', () => {
  const db = setup();
  const row = db.prepare('SELECT pseudonym FROM handles WHERE handle = ?').get(SYSTEM_HANDLE);
  assert.ok(row, 'SYSTEM_HANDLE row should exist after migrations');
  assert.equal(row.pseudonym, 'system');
});
