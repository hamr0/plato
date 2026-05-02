import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import { recordAction, listModActionsAcrossSubs } from '../../src/content/mod.js';
import { buildRevokeMap } from '../../src/web/app.js';

const OWNER = 'a'.repeat(64);
const OTHER_MOD = 'b'.repeat(64);
const VICTIM = 'c'.repeat(64);

function fresh() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner'], [OTHER_MOD, 'mod-2'], [VICTIM, 'victim']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now());
  }
  createSub(db, { name: 'lobby', ownerHandle: OWNER });
  // Add OTHER_MOD as a co-mod so they can record actions too
  db.prepare(`INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)`)
    .run('lobby', OTHER_MOD, 'co');
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p1', 'lobby', ?, 't', 'posts/p1.md', ?)`).run(VICTIM, Date.now());
  db.prepare(`INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
              VALUES ('c1', 'p1', NULL, ?, 'b', ?)`).run(VICTIM, Date.now());
  return db;
}

function actionsFor(db) {
  return listModActionsAcrossSubs(db, ['lobby'], { limit: 100 });
}

test('buildRevokeMap: returns inverse for own-active collapse', () => {
  const db = fresh();
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse', targetType: 'post', targetId: 'p1' });
  const actions = actionsFor(db);
  const map = buildRevokeMap(db, actions, OWNER);
  assert.equal(map.get(actions[0].id), 'uncollapse');
});

test('buildRevokeMap: nothing when target already uncollapsed', () => {
  const db = fresh();
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse', targetType: 'post', targetId: 'p1' });
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'uncollapse', targetType: 'post', targetId: 'p1' });
  const actions = actionsFor(db);
  const map = buildRevokeMap(db, actions, OWNER);
  // Both rows: the original collapse no longer applies (target is uncollapsed),
  // and uncollapse itself isn't in REVOKE_MAP.
  assert.equal(map.size, 0);
});

test('buildRevokeMap: nothing for someone else\'s action', () => {
  const db = fresh();
  recordAction(db, { subName: 'lobby', modHandle: OTHER_MOD, action: 'collapse', targetType: 'post', targetId: 'p1' });
  const actions = actionsFor(db);
  const map = buildRevokeMap(db, actions, OWNER);
  assert.equal(map.size, 0);
});

test('buildRevokeMap: remove on a comment offers unremove', () => {
  const db = fresh();
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'remove', targetType: 'comment', targetId: 'c1', reason: 'test',
  });
  const actions = actionsFor(db);
  const map = buildRevokeMap(db, actions, OWNER);
  assert.equal(map.get(actions[0].id), 'unremove');
});

test('buildRevokeMap: ban offers unban while user banned, drops after unban', () => {
  const db = fresh();
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'ban', targetType: 'handle', targetId: VICTIM });
  let actions = actionsFor(db);
  assert.equal(buildRevokeMap(db, actions, OWNER).get(actions[0].id), 'unban');

  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'unban', targetType: 'handle', targetId: VICTIM });
  actions = actionsFor(db);
  assert.equal(buildRevokeMap(db, actions, OWNER).size, 0);
});

test('buildRevokeMap: empty when not logged in', () => {
  const db = fresh();
  recordAction(db, { subName: 'lobby', modHandle: OWNER, action: 'collapse', targetType: 'post', targetId: 'p1' });
  const actions = actionsFor(db);
  assert.equal(buildRevokeMap(db, actions, null).size, 0);
});

test('buildRevokeMap: only revocable actions count (no transfer_owner etc.)', () => {
  const db = fresh();
  // promote_mod: even though it has an inverse (demote_mod), REVOKE_MAP
  // intentionally doesn't list it — sub-keys-of-the-kingdom changes need
  // explicit re-action through the mod-management surface, not a one-click.
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod', targetType: 'handle', targetId: VICTIM,
  });
  const actions = actionsFor(db);
  assert.equal(buildRevokeMap(db, actions, OWNER).size, 0);
});
