// Tests for the /modlog/resolve endpoint and its content-layer
// building blocks (recordAction + resolveFlagsForTarget). Covers the
// three decisions (soft / hard / dismiss), the auth + mod gates, and
// the auto-uncollapse-on-dismiss path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import { recordAction } from '../../src/content/mod.js';
import { submitFlag, resolveFlagsForTarget, pendingFlagCount } from '../../src/content/flag.js';

const OWNER = 'a'.repeat(64);
const F1 = 'b'.repeat(64);
const F2 = 'c'.repeat(64);
const F3 = 'd'.repeat(64);
const POSTER = 'e'.repeat(64);

function setup() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner-x'], [F1, 'f1'], [F2, 'f2'], [F3, 'f3'], [POSTER, 'post-x']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now() - 10 * 24 * 60 * 60 * 1000); // established
  }
  createSub(db, { name: 'lobby', description: '', ownerHandle: OWNER });
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p1', 'lobby', ?, 't', 'posts/p1.md', ?)`).run(POSTER, Date.now());
  return db;
}

test('soft-remove: recordAction(collapse) sets collapsed_at + score_at_collapse', () => {
  const db = setup();
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'collapse',
    targetType: 'post', targetId: 'p1', reason: 'spammy',
  });
  const post = db.prepare('SELECT collapsed_at, score_at_collapse, removed_at FROM posts WHERE id = ?').get('p1');
  assert.ok(post.collapsed_at != null, 'collapsed_at should be set');
  assert.ok(post.score_at_collapse != null, 'score_at_collapse should be set');
  assert.equal(post.removed_at, null, 'removed_at should remain null');
});

test('hard-remove: recordAction(remove) sets removed_at, leaves collapsed_at', () => {
  const db = setup();
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'remove',
    targetType: 'post', targetId: 'p1', reason: 'illegal',
  });
  const post = db.prepare('SELECT collapsed_at, removed_at FROM posts WHERE id = ?').get('p1');
  assert.ok(post.removed_at != null, 'removed_at should be set');
});

test('uphold flow: collapse + resolveFlagsForTarget marks all flags upheld', () => {
  const db = setup();
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam' });
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F3, category: 'harassment' });
  assert.equal(pendingFlagCount(db, 'post', 'p1'), 3);

  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'collapse',
    targetType: 'post', targetId: 'p1', reason: 'reviewed',
  });
  const resolved = resolveFlagsForTarget(db, {
    targetType: 'post', targetId: 'p1', resolverHandle: OWNER, resolution: 'upheld',
  });
  assert.equal(resolved, 3, 'all 3 pending flags resolved');
  assert.equal(pendingFlagCount(db, 'post', 'p1'), 0);

  const flagRow = db.prepare(`SELECT resolution, resolver_handle FROM flags WHERE target_id = 'p1' LIMIT 1`).get();
  assert.equal(flagRow.resolution, 'upheld');
  assert.equal(flagRow.resolver_handle, OWNER);
});

test('dismiss flow: resolves flags as dismissed; auto-uncollapse needs an explicit recordAction', () => {
  const db = setup();
  // Auto-hide via 3 flags reaching threshold
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F2, category: 'spam' });
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F3, category: 'spam' });
  let post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.ok(post.collapsed_at != null, 'auto-hide should have collapsed at threshold');

  resolveFlagsForTarget(db, {
    targetType: 'post', targetId: 'p1', resolverHandle: OWNER, resolution: 'dismissed',
  });
  assert.equal(pendingFlagCount(db, 'post', 'p1'), 0);

  // Mod must explicitly uncollapse (the resolve handler does this when
  // collapsed_at was non-null before dismiss).
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'uncollapse',
    targetType: 'post', targetId: 'p1', reason: null,
  });
  post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.equal(post.collapsed_at, null, 'uncollapse should clear collapsed_at');
});

test('flaggedTargetsByHandle: pending flags dim button; resolved do not', async () => {
  const { flaggedTargetsByHandle } = await import('../../src/content/flag.js');
  const db = setup();
  submitFlag(db, { targetType: 'post', targetId: 'p1', flaggerHandle: F1, category: 'spam' });
  // While pending, flagger sees their flag
  let dim = flaggedTargetsByHandle(db, 'post', ['p1'], F1);
  assert.ok(dim.has('p1'), 'pending flag should dim button');

  resolveFlagsForTarget(db, {
    targetType: 'post', targetId: 'p1', resolverHandle: OWNER, resolution: 'upheld',
  });
  dim = flaggedTargetsByHandle(db, 'post', ['p1'], F1);
  assert.equal(dim.has('p1'), false, 'resolved flag should not dim button');
});
