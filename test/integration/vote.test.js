import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { castVote, getVote, isNewAccount } from '../../src/content/vote.js';
import { recordAction } from '../../src/content/mod.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const VOTER = 'a'.repeat(64);
const AUTHOR = 'b'.repeat(64);
const SUB = 'lobby';

function fixture({ voterFirstSeenAt, postCreatedAt = Date.now() } = {}) {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO subs (name, created_at) VALUES (?, ?)').run(SUB, Date.now());
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(VOTER, 'voter-one', voterFirstSeenAt ?? Date.now() - 30 * DAY_MS);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(AUTHOR, 'author-one', Date.now() - 30 * DAY_MS);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', SUB, AUTHOR, 't', 'posts/p1.md', postCreatedAt);
  db.prepare(`INSERT INTO comments (id, post_id, handle, body, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('c1', 'p1', AUTHOR, 'b', Date.now());
  return db;
}

test('castVote: full-weight upvote on post sets value=1.0 and score=1.0', () => {
  const db = fixture();
  const r = castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' });
  assert.equal(r.vote, 'up');
  assert.equal(r.score, 1.0);
  const post = db.prepare('SELECT score FROM posts WHERE id = ?').get('p1');
  assert.equal(post.score, 1.0);
});

test('castVote: re-voting same direction toggles off', () => {
  const db = fixture();
  castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' });
  const r = castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' });
  assert.equal(r.vote, null);
  assert.equal(r.score, 0);
  assert.equal(getVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER }), null);
});

test('castVote: opposite direction switches sides', () => {
  const db = fixture();
  castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' });
  const r = castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'down' });
  assert.equal(r.vote, 'down');
  assert.equal(r.score, -1.0);
});

test('castVote: new account upvote on young post is half-weight', () => {
  const db = fixture({ voterFirstSeenAt: Date.now() - DAY_MS });
  const r = castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' });
  assert.equal(r.vote, 'up');
  assert.equal(r.score, 0.5);
});

test('castVote: new account vote on comment throws', () => {
  const db = fixture({ voterFirstSeenAt: Date.now() - DAY_MS });
  assert.throws(
    () => castVote(db, { targetType: 'comment', targetId: 'c1', voterHandle: VOTER, direction: 'up' }),
    /new accounts.*cannot vote on comments/
  );
});

test('castVote: new account vote on post older than 24h throws', () => {
  const db = fixture({
    voterFirstSeenAt: Date.now() - DAY_MS,
    postCreatedAt: Date.now() - 2 * DAY_MS,
  });
  assert.throws(
    () => castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' }),
    /< 24h old/
  );
});

test('castVote: established account vote on comment works (full weight)', () => {
  const db = fixture();
  const r = castVote(db, { targetType: 'comment', targetId: 'c1', voterHandle: VOTER, direction: 'up' });
  assert.equal(r.score, 1.0);
  const c = db.prepare('SELECT score FROM comments WHERE id = ?').get('c1');
  assert.equal(c.score, 1.0);
});

test('castVote: nonexistent target throws', () => {
  const db = fixture();
  assert.throws(
    () => castVote(db, { targetType: 'post', targetId: 'nope', voterHandle: VOTER, direction: 'up' }),
    /not found/
  );
});

test('castVote: invalid targetType / direction reject', () => {
  const db = fixture();
  assert.throws(
    () => castVote(db, { targetType: 'user', targetId: 'p1', voterHandle: VOTER, direction: 'up' }),
    /targetType/
  );
  assert.throws(
    () => castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'sideways' }),
    /direction/
  );
});

test('castVote: score cache stays in sync across many voters', () => {
  const db = fixture();
  const voters = ['c', 'd', 'e'].map((c) => c.repeat(64));
  for (const v of voters) {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(v, `voter-${v[0]}`, Date.now() - 30 * DAY_MS);
  }
  for (const v of voters) {
    castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: v, direction: 'up' });
  }
  // 3 upvotes from established accounts = +3.0
  const post = db.prepare('SELECT score FROM posts WHERE id = ?').get('p1');
  assert.equal(post.score, 3.0);

  // One toggles off, one switches to down
  castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: voters[0], direction: 'up' });   // toggle off
  castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: voters[1], direction: 'down' }); // switch
  // 1 (still up) + (-1, switched) + 0 (toggled) = 0
  const after = db.prepare('SELECT score FROM posts WHERE id = ?').get('p1');
  assert.equal(after.score, 0);
});

test('isNewAccount: true within 7 days, false after', () => {
  const db = fixture({ voterFirstSeenAt: Date.now() - 1 * DAY_MS });
  assert.equal(isNewAccount(db, VOTER), true);

  const db2 = fixture({ voterFirstSeenAt: Date.now() - 30 * DAY_MS });
  assert.equal(isNewAccount(db2, VOTER), false);
});

// --- M4 ban check ---

test('castVote: banned user rejected from voting in their banned sub', () => {
  const db = fixture();
  const banner = 'f'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(banner, 'mod-banner', Date.now());
  db.prepare(`UPDATE subs SET owner_handle = ? WHERE name = ?`).run(banner, SUB);
  recordAction(db, {
    subName: SUB, modHandle: banner, action: 'ban',
    targetType: 'handle', targetId: VOTER,
  });
  assert.throws(
    () => castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: VOTER, direction: 'up' }),
    new RegExp(`banned from ${SUB}`),
  );
});

// --- M4 polish: auto-uncollapse on cumulative community votes ---
// Per-sub configurable thresholds (migration 006). Tests below override the
// fixture sub's thresholds to small numbers so we don't have to spin up 50
// voters per test — the threshold path is identical at any size.

function setSubThresholds(db, { post, comment }) {
  db.prepare('UPDATE subs SET auto_uncollapse_post = ?, auto_uncollapse_comment = ? WHERE name = ?')
    .run(post, comment, SUB);
}

function spinUpVoters(db, n) {
  for (let i = 0; i < n; i++) {
    const h = String.fromCharCode(0x40 + i).repeat(64);
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run(h, `voter-${i}`, Date.now() - 30 * DAY_MS);
    castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: h, direction: 'up' });
  }
}

test('castVote: collapsed target accumulating +threshold upvotes auto-uncollapses + writes audit row', () => {
  const db = fixture();
  setSubThresholds(db, { post: 5, comment: 5 });
  const owner = 'm'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(owner, 'mod-x', Date.now() - 30 * DAY_MS);
  db.prepare(`UPDATE subs SET owner_handle = ? WHERE name = ?`).run(owner, SUB);
  recordAction(db, {
    subName: SUB, modHandle: owner, action: 'collapse',
    targetType: 'post', targetId: 'p1',
  });
  let snap = db.prepare(`SELECT score_at_collapse, collapsed_at FROM posts WHERE id = 'p1'`).get();
  assert.equal(snap.score_at_collapse, 0);
  assert.ok(snap.collapsed_at > 0);

  spinUpVoters(db, 5);

  snap = db.prepare(`SELECT score_at_collapse, collapsed_at, score FROM posts WHERE id = 'p1'`).get();
  assert.equal(snap.collapsed_at, null, 'auto-uncollapse fired');
  assert.equal(snap.score_at_collapse, null, 'snapshot cleared');
  assert.equal(snap.score, 5);

  const audit = db.prepare(`SELECT action, mod_handle, reason FROM mod_actions WHERE action = 'auto_uncollapse_community'`).get();
  assert.ok(audit, 'audit row written');
  assert.equal(audit.mod_handle, null);
  assert.equal(audit.reason, null);
});

test('castVote: collapsed target stays collapsed below threshold', () => {
  const db = fixture();
  setSubThresholds(db, { post: 5, comment: 5 });
  const owner = 'm'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(owner, 'mod-y', Date.now() - 30 * DAY_MS);
  db.prepare(`UPDATE subs SET owner_handle = ? WHERE name = ?`).run(owner, SUB);
  recordAction(db, {
    subName: SUB, modHandle: owner, action: 'collapse',
    targetType: 'post', targetId: 'p1',
  });

  spinUpVoters(db, 4);

  const snap = db.prepare(`SELECT collapsed_at FROM posts WHERE id = 'p1'`).get();
  assert.ok(snap.collapsed_at > 0, 'still collapsed at threshold-1');
});

test('castVote: hard-removed target NOT eligible for auto-revert via votes', () => {
  const db = fixture();
  setSubThresholds(db, { post: 5, comment: 5 });
  const owner = 'm'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(owner, 'mod-z', Date.now() - 30 * DAY_MS);
  db.prepare(`UPDATE subs SET owner_handle = ? WHERE name = ?`).run(owner, SUB);
  recordAction(db, {
    subName: SUB, modHandle: owner, action: 'remove',
    targetType: 'post', targetId: 'p1', reason: 'harassment',
  });

  spinUpVoters(db, 5);

  const snap = db.prepare(`SELECT removed_at FROM posts WHERE id = 'p1'`).get();
  assert.ok(snap.removed_at > 0, 'hard removal stays — not subject to vote auto-revert');
  const audit = db.prepare(`SELECT count(*) AS n FROM mod_actions WHERE action = 'auto_uncollapse_community'`).get();
  assert.equal(audit.n, 0, 'no auto-revert audit row written');
});

test('castVote: per-sub threshold override is honored (post threshold = 3 fires at 3)', () => {
  const db = fixture();
  setSubThresholds(db, { post: 3, comment: 3 });
  const owner = 'm'.repeat(64);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(owner, 'mod-q', Date.now() - 30 * DAY_MS);
  db.prepare(`UPDATE subs SET owner_handle = ? WHERE name = ?`).run(owner, SUB);
  recordAction(db, {
    subName: SUB, modHandle: owner, action: 'collapse',
    targetType: 'post', targetId: 'p1',
  });

  spinUpVoters(db, 3);

  const snap = db.prepare(`SELECT collapsed_at FROM posts WHERE id = 'p1'`).get();
  assert.equal(snap.collapsed_at, null, 'fired at the per-sub threshold of 3');
});

test('castVote: fresh voter with no handle row auto-creates one (no FK crash)', () => {
  const db = fixture();
  const fresh = 'f'.repeat(64);
  // Delete any pre-seeded row to be sure.
  db.prepare('DELETE FROM handles WHERE handle = ?').run(fresh);
  // Should not throw "handle not found"; handles row is auto-created.
  const r = castVote(db, { targetType: 'post', targetId: 'p1', voterHandle: fresh, direction: 'up' });
  assert.equal(r.vote, 'up');
  const row = db.prepare('SELECT pseudonym FROM handles WHERE handle = ?').get(fresh);
  assert.ok(row, 'handles row auto-created on first vote');
});
