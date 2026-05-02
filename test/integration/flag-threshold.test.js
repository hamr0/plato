import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  createSub,
  getSubByName,
  setSubFlagThreshold,
} from '../../src/content/sub.js';
import {
  submitFlag,
  resolveFlagThreshold,
  FLAG_THRESHOLD_FLOOR,
} from '../../src/content/flag.js';

const OWNER = 'a'.repeat(64);
const F1 = 'b'.repeat(64);
const F2 = 'c'.repeat(64);
const F3 = 'd'.repeat(64);
const F4 = 'e'.repeat(64);
const F5 = 'f'.repeat(64);

function freshDb({ threshold } = {}) {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner'], [F1, 'f1'], [F2, 'f2'], [F3, 'f3'], [F4, 'f4'], [F5, 'f5']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now());
  }
  createSub(db, { name: 'lobby', ownerHandle: OWNER, ...(threshold != null ? { flagThreshold: threshold } : {}) });
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p1', 'lobby', ?, 't', 'posts/p1.md', ?)`).run(OWNER, Date.now());
  db.prepare(`INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
              VALUES ('c1', 'p1', NULL, ?, 'b', ?)`).run(OWNER, Date.now());
  return db;
}

test('createSub: defaults flag_threshold to floor', () => {
  const db = freshDb();
  assert.equal(getSubByName(db, 'lobby').flag_threshold, FLAG_THRESHOLD_FLOOR);
});

test('createSub: rejects below-floor threshold', () => {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(OWNER, 'owner', Date.now());
  assert.throws(
    () => createSub(db, { name: 'too-low', ownerHandle: OWNER, flagThreshold: 2 }),
    /flag threshold/
  );
});

test('createSub: accepts above-floor threshold', () => {
  const db = freshDb({ threshold: 5 });
  assert.equal(getSubByName(db, 'lobby').flag_threshold, 5);
});

test('setSubFlagThreshold: tightening (raising) is allowed', () => {
  const db = freshDb();
  setSubFlagThreshold(db, 'lobby', 7);
  assert.equal(getSubByName(db, 'lobby').flag_threshold, 7);
});

test('setSubFlagThreshold: below-floor throws', () => {
  const db = freshDb();
  assert.throws(() => setSubFlagThreshold(db, 'lobby', 2), /flag threshold/);
});

test('setSubFlagThreshold: unknown sub throws', () => {
  const db = freshDb();
  assert.throws(() => setSubFlagThreshold(db, 'ghost', 5), /not found/);
});

test('resolveFlagThreshold: post inherits sub setting', () => {
  const db = freshDb({ threshold: 5 });
  assert.equal(resolveFlagThreshold(db, 'post', 'p1'), 5);
});

test('resolveFlagThreshold: comment inherits its post.sub setting', () => {
  const db = freshDb({ threshold: 4 });
  assert.equal(resolveFlagThreshold(db, 'comment', 'c1'), 4);
});

test('submitFlag: auto-hide fires at the per-sub threshold (not global default)', () => {
  // Sub with threshold 5; first 4 flaggers should NOT trigger auto-hide
  // (default is 3, but per-sub override raises the bar to 5).
  const db = freshDb({ threshold: 5 });
  const r1 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  const r2 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam' });
  const r3 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F3, category: 'spam' });
  const r4 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F4, category: 'spam' });
  assert.equal(r1.autoHidden, false);
  assert.equal(r3.autoHidden, false, 'default-3 threshold must not fire');
  assert.equal(r4.autoHidden, false);
  const post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.equal(post.collapsed_at, null);
  // 5th distinct flagger crosses the per-sub floor
  const r5 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F5, category: 'spam' });
  assert.equal(r5.autoHidden, true);
  const post2 = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.notEqual(post2.collapsed_at, null);
});

test('submitFlag: floor (3) still fires auto-hide for default subs', () => {
  const db = freshDb();
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam' });
  const r3 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F3, category: 'spam' });
  assert.equal(r3.autoHidden, true);
});

