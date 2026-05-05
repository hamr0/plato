// M5/B12 — sub state model: co-mod promotion eligibility, self-demote,
// step-down with successor or disable, read-only enforcement, reactivate,
// inactivity warning surface.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import {
  recordAction, canModerate, isDisabled, listCoMods,
  lastModActivity, runInactivitySweep, SUB_INACTIVITY_THRESHOLD_MS,
} from '../../src/content/mod.js';
import { finalizeDraft, submitDraft } from '../../src/content/post.js';
import { addComment } from '../../src/content/comment.js';
import { castVote } from '../../src/content/vote.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OWNER = 'a'.repeat(64);
const SUBSCRIBER = 'b'.repeat(64);
const STRANGER = 'c'.repeat(64);

function fresh() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  for (const [h, p] of [[OWNER, 'owner-x'], [SUBSCRIBER, 'sub-y'], [STRANGER, 'strange-z']]) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, p, Date.now());
  }
  createSub(db, { name: 'lobby', ownerHandle: OWNER });
  return db;
}

function subscribe(db, handle, subName = 'lobby') {
  db.prepare('INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)')
    .run(handle, subName, Date.now());
}

test('promote_mod: rejects non-subscriber target', () => {
  const db = fresh();
  // STRANGER is not subscribed to lobby
  assert.throws(
    () => recordAction(db, {
      subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
      targetType: 'handle', targetId: STRANGER,
    }),
    /must be subscribed/,
  );
  assert.equal(canModerate(db, 'lobby', STRANGER), null);
});

test('promote_mod: subscriber target succeeds', () => {
  const db = fresh();
  subscribe(db, SUBSCRIBER);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  assert.equal(canModerate(db, 'lobby', SUBSCRIBER), 'co');
});

test('promote_mod: subscription is checked at promotion time only — unsubscribing later does not auto-revoke', () => {
  const db = fresh();
  subscribe(db, SUBSCRIBER);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  // Unsubscribe after promotion
  db.prepare('DELETE FROM subscriptions WHERE user_handle = ? AND sub_name = ?')
    .run(SUBSCRIBER, 'lobby');
  // Mod role survives
  assert.equal(canModerate(db, 'lobby', SUBSCRIBER), 'co');
});

test('demote_mod: co-mod can self-demote (owner-only check has self-carve-out)', () => {
  const db = fresh();
  subscribe(db, SUBSCRIBER);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  assert.equal(canModerate(db, 'lobby', SUBSCRIBER), 'co');
  // The co-mod demotes themselves, not via owner.
  recordAction(db, {
    subName: 'lobby', modHandle: SUBSCRIBER, action: 'demote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  assert.equal(canModerate(db, 'lobby', SUBSCRIBER), null);
});

test('demote_mod: co-mod cannot demote another co-mod (still owner-only)', () => {
  const db = fresh();
  subscribe(db, SUBSCRIBER);
  subscribe(db, STRANGER);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: STRANGER,
  });
  assert.throws(
    () => recordAction(db, {
      subName: 'lobby', modHandle: SUBSCRIBER, action: 'demote_mod',
      targetType: 'handle', targetId: STRANGER,
    }),
    /owner-only/,
  );
});

test('isDisabled: false for active sub, true after disabled_at is set', () => {
  const db = fresh();
  assert.equal(isDisabled(db, 'lobby'), false);
  db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
  assert.equal(isDisabled(db, 'lobby'), true);
});

test('manual_reactivate: clears disabled_at + writes modlog row', () => {
  const db = fresh();
  db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'manual_reactivate',
    targetType: 'sub', targetId: 'lobby',
  });
  assert.equal(isDisabled(db, 'lobby'), false);
  const row = db.prepare(
    'SELECT action, target_type, mod_handle FROM mod_actions WHERE sub_name = ? ORDER BY created_at DESC LIMIT 1'
  ).get('lobby');
  assert.equal(row.action, 'manual_reactivate');
  assert.equal(row.target_type, 'sub');
  assert.equal(row.mod_handle, OWNER);
});

test('disabled sub rejects new posts (finalizeDraft throws read-only)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null,
    });
    assert.throws(
      () => finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp }),
      /read-only/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('disabled sub rejects new comments (addComment throws read-only)', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    // Seed a post BEFORE disabling so the parent exists.
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null,
    });
    const { postId } = finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp });
    db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
    assert.throws(
      () => addComment(db, { postId, handle: OWNER, body: 'reply' }),
      /read-only/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('disabled sub rejects new votes', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null,
    });
    const { postId } = finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp });
    db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
    // Make voter old enough
    db.prepare('UPDATE handles SET first_seen_at = ? WHERE handle = ?')
      .run(Date.now() - 30 * 24 * 60 * 60 * 1000, SUBSCRIBER);
    assert.throws(
      () => castVote(db, { targetType: 'post', targetId: postId, voterHandle: SUBSCRIBER, direction: 'up' }),
      /read-only/,
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('disabled sub rejects mod actions except manual_reactivate', () => {
  const db = fresh();
  db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
  // ban attempt fails
  assert.throws(
    () => recordAction(db, {
      subName: 'lobby', modHandle: OWNER, action: 'ban',
      targetType: 'handle', targetId: SUBSCRIBER, reason: 'spam',
    }),
    /read-only/,
  );
  // reactivate succeeds
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'manual_reactivate',
    targetType: 'sub', targetId: 'lobby',
  });
  assert.equal(isDisabled(db, 'lobby'), false);
});

test('lastModActivity: returns max across posts/comments/mod_actions by any mod', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    subscribe(db, SUBSCRIBER);
    recordAction(db, {
      subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
      targetType: 'handle', targetId: SUBSCRIBER,
    });
    // The promote_mod row itself counts as activity (most recent).
    const initial = lastModActivity(db, 'lobby');
    assert.ok(initial != null && initial > 0);

    // A comment by the co-mod resets the clock to a later time.
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null,
    });
    const { postId } = finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp });
    db.prepare('UPDATE comments SET created_at = ? WHERE 1=0'); // no-op, just establishing prepared statement isn't needed
    const later = Date.now() + 5000;
    addComment(db, { postId, handle: SUBSCRIBER, body: 'still here', now: later });
    assert.ok(lastModActivity(db, 'lobby') >= later);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('lastModActivity: null when no mods exist', () => {
  const db = fresh();
  // Strip the owner — sub now has zero mods
  db.prepare('UPDATE subs SET owner_handle = NULL WHERE name = ?').run('lobby');
  assert.equal(lastModActivity(db, 'lobby'), null);
});

test('listCoMods: excludes the owner', () => {
  const db = fresh();
  subscribe(db, SUBSCRIBER);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  const co = listCoMods(db, 'lobby');
  assert.deepEqual(co, [SUBSCRIBER]);
  assert.ok(!co.includes(OWNER));
});

test('transfer_owner: old mod becomes co-mod, new mod takes over', () => {
  const db = fresh();
  subscribe(db, SUBSCRIBER);
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'promote_mod',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  recordAction(db, {
    subName: 'lobby', modHandle: OWNER, action: 'transfer_owner',
    targetType: 'handle', targetId: SUBSCRIBER,
  });
  assert.equal(canModerate(db, 'lobby', SUBSCRIBER), 'owner');
  assert.equal(canModerate(db, 'lobby', OWNER), 'co');
});

// --- Inactivity cron sweep (M5/B12 commit 2) ---

test('runInactivitySweep: no subs disabled when activity is recent', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null,
    });
    finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp });
    // Sub has fresh mod activity (the post just now). Sweep should no-op.
    const disabled = runInactivitySweep(db, { now: Date.now() });
    assert.deepEqual(disabled, []);
    assert.equal(isDisabled(db, 'lobby'), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runInactivitySweep: disables subs with no mod activity for >30 days', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    // Seed a post by the owner long ago (older than 30 days)
    const longAgo = Date.now() - SUB_INACTIVITY_THRESHOLD_MS - 60_000;
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null,
      now: longAgo,
    });
    finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp, now: longAgo });
    // Manually backdate the post (submitDraft might use 'now' for created_at;
    // ensure the activity timestamp is genuinely old).
    db.prepare('UPDATE posts SET created_at = ? WHERE sub_name = ?').run(longAgo, 'lobby');

    const disabled = runInactivitySweep(db, { now: Date.now() });
    assert.deepEqual(disabled, ['lobby']);
    assert.equal(isDisabled(db, 'lobby'), true);

    // Modlog row written with action=auto_disable_inactivity, target='sub'
    const row = db.prepare(
      `SELECT action, target_type, target_id, mod_handle, reason
       FROM mod_actions WHERE sub_name = ? ORDER BY created_at DESC LIMIT 1`
    ).get('lobby');
    assert.equal(row.action, 'auto_disable_inactivity');
    assert.equal(row.target_type, 'sub');
    assert.equal(row.target_id, 'lobby');
    assert.match(row.reason, /30 days no mod activity/);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runInactivitySweep: any mod activity (even by a co-mod) restarts the clock', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'plato-state-'));
  try {
    const db = fresh();
    subscribe(db, SUBSCRIBER);
    // Owner promotes co-mod long ago
    const longAgo = Date.now() - SUB_INACTIVITY_THRESHOLD_MS - 60_000;
    db.prepare(
      `INSERT INTO mod_actions (id, sub_name, mod_handle, action, target_type, target_id, created_at)
       VALUES (?, ?, ?, 'promote_mod', 'handle', ?, ?)`
    ).run('a'.repeat(16), 'lobby', OWNER, SUBSCRIBER, longAgo);
    db.prepare("INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'co')").run('lobby', SUBSCRIBER);

    // Co-mod commented recently — restarts the clock
    const { draftId } = submitDraft(db, {
      title: 't', body: 'b', subName: 'lobby', sensitive: false, flairSlug: null, now: longAgo,
    });
    const { postId } = finalizeDraft(db, { draftId, handle: OWNER, postsDir: tmp, now: longAgo });
    db.prepare('UPDATE posts SET created_at = ? WHERE id = ?').run(longAgo, postId);
    addComment(db, { postId, handle: SUBSCRIBER, body: 'still here', now: Date.now() });

    const disabled = runInactivitySweep(db, { now: Date.now() });
    assert.deepEqual(disabled, []);
    assert.equal(isDisabled(db, 'lobby'), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('runInactivitySweep: skip subs with no mods at all (different failure mode)', () => {
  const db = fresh();
  // Strip the owner; sub has zero mods
  db.prepare('UPDATE subs SET owner_handle = NULL WHERE name = ?').run('lobby');
  const disabled = runInactivitySweep(db, { now: Date.now() });
  assert.deepEqual(disabled, []);
  assert.equal(isDisabled(db, 'lobby'), false);
});

test('runInactivitySweep: idempotent — running on an already-disabled sub is a no-op', () => {
  const db = fresh();
  db.prepare('UPDATE subs SET disabled_at = ? WHERE name = ?').run(Date.now(), 'lobby');
  const disabled = runInactivitySweep(db, { now: Date.now() });
  assert.deepEqual(disabled, []);
  // Still disabled, no extra modlog row
  assert.equal(isDisabled(db, 'lobby'), true);
  const rowCount = db.prepare(
    `SELECT COUNT(*) AS n FROM mod_actions WHERE sub_name = ? AND action = 'auto_disable_inactivity'`
  ).get('lobby').n;
  assert.equal(rowCount, 0);
});
