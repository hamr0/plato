import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import {
  canModerate,
  contentTargetInSub,
  recordAction,
  listModActions,
  isBanned,
  MOD_ACTIONS,
} from '../../src/content/mod.js';

const OWNER  = 'a'.repeat(64);
const COMOD  = 'b'.repeat(64);
const RAND   = 'c'.repeat(64);
const TARGET = 'd'.repeat(64);

function freshDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner-x'], [COMOD, 'comod-y'], [RAND, 'rand-z'], [TARGET, 'target-w']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now());
  }
  createSub(db, { name: 'lobby', description: '', ownerHandle: OWNER });
  // Promote COMOD via direct insert to keep this fixture independent of recordAction.
  db.prepare(`INSERT INTO sub_mods (sub_name, handle, role) VALUES ('lobby', ?, 'co')`).run(COMOD);
  return db;
}

function seedPost(db, id = 'p1', handle = OWNER) {
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run(id, 'lobby', handle, 't', `posts/${id}.md`, Date.now());
}

function seedComment(db, id = 'c1', postId = 'p1', handle = OWNER) {
  db.prepare(`INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
              VALUES (?, ?, NULL, ?, ?, ?)`)
    .run(id, postId, handle, 'body', Date.now());
}

test('canModerate: owner returns "owner", co-mod returns "co", rando returns null', () => {
  const db = freshDb();
  assert.equal(canModerate(db, 'lobby', OWNER), 'owner');
  assert.equal(canModerate(db, 'lobby', COMOD), 'co');
  assert.equal(canModerate(db, 'lobby', RAND), null);
  assert.equal(canModerate(db, 'lobby', null), null);
  assert.equal(canModerate(db, 'no-such-sub', OWNER), null);
});

test('recordAction: collapse post flips collapsed_at and writes audit row', () => {
  const db = freshDb();
  seedPost(db);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'collapse',
    targetType: 'post', targetId: 'p1', reason: 'off-topic',
  });
  const post = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.ok(post.collapsed_at > 0);
  const log = db.prepare(`SELECT action, target_id, reason FROM mod_actions WHERE sub_name = 'lobby'`).all();
  assert.equal(log.length, 1);
  assert.equal(log[0].action, 'collapse');
  assert.equal(log[0].target_id, 'p1');
  assert.equal(log[0].reason, 'off-topic');
});

test('recordAction: uncollapse flips back to NULL', () => {
  const db = freshDb();
  seedPost(db);
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse',   targetType: 'post', targetId: 'p1' });
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'uncollapse', targetType: 'post', targetId: 'p1' });
  const row = db.prepare('SELECT collapsed_at FROM posts WHERE id = ?').get('p1');
  assert.equal(row.collapsed_at, null);
});

test('recordAction: remove + unremove on a comment', () => {
  const db = freshDb();
  seedPost(db);
  seedComment(db);
  recordAction(db, { subName: 'lobby', modHandle: COMOD, action: 'remove',   targetType: 'comment', targetId: 'c1' });
  let row = db.prepare('SELECT removed_at FROM comments WHERE id = ?').get('c1');
  assert.ok(row.removed_at > 0);
  recordAction(db, { subName: 'lobby', modHandle: COMOD, action: 'unremove', targetType: 'comment', targetId: 'c1' });
  row = db.prepare('SELECT removed_at FROM comments WHERE id = ?').get('c1');
  assert.equal(row.removed_at, null);
});

test('recordAction: ban inserts row, isBanned returns true; unban removes it', () => {
  const db = freshDb();
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'ban',
    targetType: 'handle', targetId: TARGET, reason: 'repeat spam',
  });
  assert.equal(isBanned(db, 'lobby', TARGET), true);
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'unban', targetType: 'handle', targetId: TARGET });
  assert.equal(isBanned(db, 'lobby', TARGET), false);
});

test('recordAction: rejects non-mods', () => {
  const db = freshDb();
  seedPost(db);
  assert.throws(
    () => recordAction(db, { subName: 'lobby', modHandle: RAND, action: 'collapse', targetType: 'post', targetId: 'p1' }),
    /not a mod/,
  );
});

test('recordAction: owner-only actions reject co-mods', () => {
  const db = freshDb();
  for (const action of ['promote_mod', 'demote_mod', 'transfer_owner']) {
    assert.throws(
      () => recordAction(db, {
        subName: 'lobby', modHandle: COMOD, action, targetType: 'handle', targetId: TARGET,
      }),
      /owner-only/,
    );
  }
});

test('recordAction: collapse on missing post throws and rolls back the audit row', () => {
  const db = freshDb();
  assert.throws(
    () => recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse', targetType: 'post', targetId: 'ghost' }),
    /not found/,
  );
  const log = db.prepare(`SELECT count(*) AS n FROM mod_actions`).get();
  assert.equal(log.n, 0);
});

test('recordAction: transfer_owner flips owner_handle and demotes old owner to co', () => {
  const db = freshDb();
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'transfer_owner',
    targetType: 'handle', targetId: TARGET,
  });
  const sub = db.prepare(`SELECT owner_handle FROM subs WHERE name = 'lobby'`).get();
  assert.equal(sub.owner_handle, TARGET);
  // Old owner is now a co-mod.
  const row = db.prepare(`SELECT role FROM sub_mods WHERE sub_name = 'lobby' AND handle = ?`).get(OWNER);
  assert.equal(row.role, 'co');
  // New owner's sub_mods row is cleared (owner_handle is the source of truth).
  const newOwnerRow = db.prepare(`SELECT 1 FROM sub_mods WHERE sub_name = 'lobby' AND handle = ?`).get(TARGET);
  assert.equal(newOwnerRow, undefined);
  assert.equal(canModerate(db, 'lobby', TARGET), 'owner');
  assert.equal(canModerate(db, 'lobby', OWNER), 'co');
});

test('listModActions: returns most-recent first, scoped to sub', () => {
  const db = freshDb();
  seedPost(db, 'p1');
  seedPost(db, 'p2');
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse', targetType: 'post', targetId: 'p1', now: 1000 });
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse', targetType: 'post', targetId: 'p2', now: 2000 });
  const rows = listModActions(db, 'lobby');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].target_id, 'p2');
  assert.equal(rows[1].target_id, 'p1');
});

test('MOD_ACTIONS exposes all 11 known actions and is frozen', () => {
  // 9 baseline + 2 sub-state actions added in M5/B12 (auto_disable_inactivity,
  // manual_reactivate). Count guard so adding silent actions surfaces in CI.
  assert.equal(MOD_ACTIONS.length, 11);
  assert.ok(Object.isFrozen(MOD_ACTIONS));
});

test('recordAction: transfer_owner to a nonexistent handle throws cleanly', () => {
  const db = freshDb();
  const ghost = 'f'.repeat(64);
  assert.throws(
    () => recordAction(db, {
      subName: 'lobby', modHandle: OWNER, action: 'transfer_owner',
      targetType: 'handle', targetId: ghost,
    }),
    /not a known handle/,
  );
  // Sub still owned by HANDLE — transaction rolled back.
  const sub = db.prepare(`SELECT owner_handle FROM subs WHERE name = 'lobby'`).get();
  assert.equal(sub.owner_handle, OWNER);
});

test('recordAction: ban targeting the acting mod is rejected (self-ban guard)', () => {
  const db = freshDb();
  assert.throws(
    () => recordAction(db, {
      subName: 'lobby', modHandle: OWNER, action: 'ban',
      targetType: 'handle', targetId: OWNER, reason: 'self-ban attempt',
    }),
    /cannot target the acting mod/,
  );
  assert.equal(isBanned(db, 'lobby', OWNER), false);
});

test('recordAction: unban targeting the acting mod is rejected (self-unban guard)', () => {
  const db = freshDb();
  // Pre-seed a ban row so isBanned has something to find — direct insert
  // to bypass the guard we're verifying.
  db.prepare(`INSERT INTO bans (sub_name, handle, banned_by, reason, created_at)
              VALUES ('lobby', ?, ?, 'orphan ban', ?)`).run(OWNER, OWNER, Date.now());
  assert.throws(
    () => recordAction(db, {
      subName: 'lobby', modHandle: OWNER, action: 'unban',
      targetType: 'handle', targetId: OWNER,
    }),
    /cannot target the acting mod/,
  );
});

test('contentTargetInSub: true only when the post/comment lives in the sub', () => {
  const db = freshDb();
  createSub(db, { name: 'other', description: '', ownerHandle: RAND });
  seedPost(db, 'p1');          // in lobby
  seedComment(db, 'c1', 'p1'); // in lobby (via p1)
  assert.equal(contentTargetInSub(db, { targetType: 'post', targetId: 'p1', subName: 'lobby' }), true);
  assert.equal(contentTargetInSub(db, { targetType: 'post', targetId: 'p1', subName: 'other' }), false);
  assert.equal(contentTargetInSub(db, { targetType: 'comment', targetId: 'c1', subName: 'lobby' }), true);
  assert.equal(contentTargetInSub(db, { targetType: 'comment', targetId: 'c1', subName: 'other' }), false);
  assert.equal(contentTargetInSub(db, { targetType: 'post', targetId: 'nope', subName: 'lobby' }), false);
});

test('recordAction: cross-sub content moderation is rejected (IDOR guard)', () => {
  const db = freshDb();
  // RAND owns `other`; the post + comment live in `lobby`, which RAND does not
  // moderate. Naming `other` passes canModerate but must not flip lobby content.
  createSub(db, { name: 'other', description: '', ownerHandle: RAND });
  seedPost(db, 'p1');
  seedComment(db, 'c1', 'p1');
  for (const [targetType, targetId] of [['post', 'p1'], ['comment', 'c1']]) {
    assert.throws(
      () => recordAction(db, {
        subName: 'other', modHandle: RAND, action: 'remove',
        targetType, targetId, reason: 'pwn',
      }),
      /not found/,
      `${targetType} cross-sub remove should be rejected`,
    );
  }
  // The lobby content is untouched and nothing was logged under `other`.
  assert.equal(db.prepare('SELECT removed_at FROM posts WHERE id = ?').get('p1').removed_at, null);
  assert.equal(db.prepare('SELECT removed_at FROM comments WHERE id = ?').get('c1').removed_at, null);
  assert.equal(listModActions(db, 'other').length, 0);
});
