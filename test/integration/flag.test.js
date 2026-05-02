import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import {
  submitFlag,
  pendingFlagCount,
  flagsForTarget,
  resolveFlag,
  pendingFlagsForSub,
  FLAG_CATEGORIES,
  AUTO_HIDE_THRESHOLD,
} from '../../src/content/flag.js';

const OWNER = 'a'.repeat(64);
const F1 = 'b'.repeat(64);
const F2 = 'c'.repeat(64);
const F3 = 'd'.repeat(64);

function freshDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner-x'], [F1, 'flag-one'], [F2, 'flag-two'], [F3, 'flag-three']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now());
  }
  createSub(db, { name: 'lobby', description: '', ownerHandle: OWNER });
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p1', 'lobby', ?, 't', 'posts/p1.md', ?)`).run(OWNER, Date.now());
  db.prepare(`INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
              VALUES ('c1', 'p1', NULL, ?, 'b', ?)`).run(OWNER, Date.now());
  return db;
}

test('submitFlag: inserts row, returns id + pending count', () => {
  const db = freshDb();
  const result = submitFlag(db, {
    targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam',
  });
  assert.match(result.id, /^[0-9a-f]{16}$/);
  assert.equal(result.pending, 1);
  assert.equal(result.autoHidden, false);
  const flags = flagsForTarget(db, 'post', 'p1');
  assert.equal(flags.length, 1);
  assert.equal(flags[0].category, 'spam');
});

test('submitFlag: same flagger on same target rejected (UNIQUE)', () => {
  const db = freshDb();
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  assert.throws(
    () => submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'harassment' }),
    /UNIQUE/,
  );
});

test('submitFlag: rejects unknown target', () => {
  const db = freshDb();
  assert.throws(
    () => submitFlag(db, { targetType: 'post', targetId: 'ghost', flaggerHandle: F1, category: 'spam' }),
    /not found/,
  );
});

test('submitFlag: rejects invalid category', () => {
  const db = freshDb();
  assert.throws(
    () => submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'bogus' }),
    /invalid category/,
  );
});

test('submitFlag: third pending flag triggers auto-hide on the post', () => {
  const db = freshDb();
  let r;
  r = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  assert.equal(r.autoHidden, false);
  r = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam' });
  assert.equal(r.autoHidden, false);
  r = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F3, category: 'spam' });
  assert.equal(r.autoHidden, true);
  assert.equal(r.pending, AUTO_HIDE_THRESHOLD);
  const post = db.prepare(`SELECT collapsed_at FROM posts WHERE id = 'p1'`).get();
  assert.ok(post.collapsed_at > 0);
});

test('submitFlag: already-collapsed target is not re-touched', () => {
  const db = freshDb();
  // Pre-collapse via a fixed timestamp so we can detect overwrite.
  const FIXED = 12345;
  db.prepare(`UPDATE posts SET collapsed_at = ? WHERE id = 'p1'`).run(FIXED);
  for (const h of [F1, F2, F3]) {
    submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: h, category: 'spam' });
  }
  const post = db.prepare(`SELECT collapsed_at FROM posts WHERE id = 'p1'`).get();
  assert.equal(post.collapsed_at, FIXED);
});

test('resolveFlag: pending → dismissed un-counts toward threshold', () => {
  const db = freshDb();
  const r1 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  const r2 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam' });
  resolveFlag(db, { flagId: r1.id, resolverHandle: OWNER, resolution: 'dismissed' });
  assert.equal(pendingFlagCount(db, 'post', 'p1'), 1);
  // Third flag now lands but pending is only 2, no auto-hide.
  const r3 = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F3, category: 'spam' });
  assert.equal(r3.autoHidden, false);
  assert.equal(r3.pending, 2);
});

test('resolveFlag: rejects already-resolved or unknown ids', () => {
  const db = freshDb();
  const r = submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  resolveFlag(db, { flagId: r.id, resolverHandle: OWNER, resolution: 'upheld' });
  assert.throws(
    () => resolveFlag(db, { flagId: r.id, resolverHandle: OWNER, resolution: 'dismissed' }),
    /not found or already resolved/,
  );
});

test('pendingFlagsForSub: groups by target, sorts by most-recent flag', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p2', 'lobby', ?, 't2', 'posts/p2.md', ?)`).run(OWNER, Date.now());
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam', now: 1000 });
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam', now: 1100 });
  submitFlag(db, { targetType: 'post', targetId: 'p2', flaggerHandle: F1, category: 'spam', now: 2000 });
  submitFlag(db, { targetType: 'comment', targetId: 'c1', flaggerHandle: F1, category: 'harassment', now: 1500 });

  const queue = pendingFlagsForSub(db, 'lobby');
  assert.equal(queue.length, 3);
  // Most recent first.
  assert.equal(queue[0].target_id, 'p2');
  assert.equal(queue[1].target_id, 'c1');
  assert.equal(queue[2].target_id, 'p1');
  assert.equal(queue[2].pending, 2);
});

test('FLAG_CATEGORIES exposes 5 known categories and is frozen', () => {
  assert.equal(FLAG_CATEGORIES.length, 5);
  assert.ok(Object.isFrozen(FLAG_CATEGORIES));
  assert.deepEqual([...FLAG_CATEGORIES].sort(), ['harassment', 'illegal', 'off_topic', 'other', 'spam']);
});

import { NOTE_MAX } from '../../src/content/flag.js';

test('submitFlag: rejects note over cap', () => {
  const db = freshDb();
  assert.throws(
    () => submitFlag(db, {
      targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam',
      note: 'x'.repeat(NOTE_MAX + 1),
    }),
    /exceeds/,
  );
});

test('submitFlag: a fresh handle (no prior post/comment) auto-creates handles row', () => {
  const db = freshDb();
  const fresh = 'f'.repeat(64);
  // No INSERT INTO handles for `fresh`. Should not throw FK violation.
  const result = submitFlag(db, {
    targetType: 'post', targetId: 'p1', flaggerHandle: fresh, category: 'spam',
  });
  assert.match(result.id, /^[0-9a-f]{16}$/);
  const row = db.prepare('SELECT pseudonym FROM handles WHERE handle = ?').get(fresh);
  assert.ok(row, 'handles row created on first flag');
});
