import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import { createSub } from '../../src/content/sub.js';
import {
  accountAgeTier, checkPostRate, checkPostRatePerSub, checkCommentRate,
  resolveRateLimitConfig, RATE_LIMIT_FLOOR,
} from '../../src/content/rateLimit.js';

const OWNER = 'a'.repeat(64);
const NEW   = 'b'.repeat(64);
const REC   = 'c'.repeat(64);
const EST   = 'd'.repeat(64);

const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

function freshDb(now) {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  // Seed handles at varying ages relative to `now`.
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(OWNER, 'owner', now - 30 * DAY);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(NEW,   'new-acc', now - 30 * 60 * 1000);  // 30 min old
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(REC,   'recent',  now - 3 * DAY);          // 3 days old
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(EST,   'est',     now - 30 * DAY);
  createSub(db, { name: 'lobby', description: '', ownerHandle: OWNER });
  createSub(db, { name: 'other', description: '', ownerHandle: OWNER });
  return db;
}

function seedPost(db, handle, ts, idSuffix = '', subName = 'lobby') {
  const id = `p${ts}${idSuffix}`.padEnd(16, '0').slice(0, 16);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, 't', ?, ?)`).run(id, subName, handle, `posts/${id}.md`, ts);
  return id;
}

function seedComment(db, handle, ts, idSuffix = '') {
  const id = `c${ts}${idSuffix}`.padEnd(16, '0').slice(0, 16);
  db.prepare(`INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
              VALUES (?, 'p_anchor00000000', NULL, ?, 'b', ?)`).run(id, handle, ts);
  return id;
}

test('accountAgeTier classifies handles by age', () => {
  const now = Date.now();
  const db = freshDb(now);
  assert.equal(accountAgeTier(db, NEW, now), 'new');
  assert.equal(accountAgeTier(db, REC, now), 'recent');
  assert.equal(accountAgeTier(db, EST, now), 'established');
});

test('accountAgeTier defaults to "new" for unknown handle', () => {
  const now = Date.now();
  const db = freshDb(now);
  assert.equal(accountAgeTier(db, 'z'.repeat(64), now), 'new');
});

test('checkPostRate blocks new accounts at 1 post/hour', () => {
  const now = Date.now();
  const db = freshDb(now);
  // first post is fine
  assert.equal(checkPostRate(db, NEW, now), null);
  seedPost(db, NEW, now - 10 * 60 * 1000, 'a'); // 10 min ago
  // second post within the hour blocks
  const block = checkPostRate(db, NEW, now);
  assert.ok(block, 'expected block');
  assert.match(block.message, /1\/hour/);
});

test('checkPostRate blocks new accounts at 3 posts/day even spread across hours', () => {
  const now = Date.now();
  const db = freshDb(now);
  seedPost(db, NEW, now - 90 * 60 * 1000, 'a');  // 1.5h ago
  seedPost(db, NEW, now - 5 * HOUR, 'b');         // 5h ago
  seedPost(db, NEW, now - 12 * HOUR, 'c');        // 12h ago
  const block = checkPostRate(db, NEW, now);
  assert.ok(block);
  assert.match(block.message, /3\/day/);
});

test('checkPostRate allows recent-tier 3 posts/hour', () => {
  const now = Date.now();
  const db = freshDb(now);
  seedPost(db, REC, now - 10 * 60 * 1000, 'a');
  seedPost(db, REC, now - 20 * 60 * 1000, 'b');
  // 2 in last hour — still under recent-tier 3/hour limit
  assert.equal(checkPostRate(db, REC, now), null);
  seedPost(db, REC, now - 30 * 60 * 1000, 'c');
  // 3 in last hour — at the limit, next blocks
  const block = checkPostRate(db, REC, now);
  assert.ok(block);
  assert.match(block.message, /3\/hour/);
});

test('checkPostRate does not limit established accounts', () => {
  const now = Date.now();
  const db = freshDb(now);
  for (let i = 0; i < 25; i++) {
    seedPost(db, EST, now - i * 60 * 1000, `i${i}`);
  }
  assert.equal(checkPostRate(db, EST, now), null);
});

test('checkCommentRate blocks new accounts at 10 comments/day', () => {
  const now = Date.now();
  const db = freshDb(now);
  // post anchor for comments
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p_anchor00000000', 'lobby', ?, 't', 'posts/anchor.md', ?)`).run(OWNER, now);
  for (let i = 0; i < 10; i++) {
    seedComment(db, NEW, now - i * 60 * 1000, `i${i}`);
  }
  const block = checkCommentRate(db, NEW, now);
  assert.ok(block);
  assert.match(block.message, /10\/day/);
});

test('checkCommentRate counts only the calling handle', () => {
  const now = Date.now();
  const db = freshDb(now);
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES ('p_anchor00000000', 'lobby', ?, 't', 'posts/anchor.md', ?)`).run(OWNER, now);
  // OWNER spam doesn't count against NEW
  for (let i = 0; i < 50; i++) seedComment(db, OWNER, now - i * 60 * 1000, `o${i}`);
  assert.equal(checkCommentRate(db, NEW, now), null);
});

test('checkPostRatePerSub: under-30d account blocked at 5/day per sub', () => {
  const now = Date.now();
  const db = freshDb(now);
  // REC = 3 days old → newish (under 30d). Limit = 5/day per sub.
  for (let i = 0; i < 5; i++) {
    seedPost(db, REC, now - i * 60 * 1000, `i${i}`, 'lobby');
  }
  const block = checkPostRatePerSub(db, REC, 'lobby', now);
  assert.ok(block);
  assert.match(block.message, /5\/day/);
  assert.match(block.message, /lobby/);
});

test('checkPostRatePerSub: posts in other subs do not count', () => {
  const now = Date.now();
  const db = freshDb(now);
  // 4 in 'other' shouldn't count toward the 'lobby' cap
  for (let i = 0; i < 4; i++) {
    seedPost(db, REC, now - i * 60 * 1000, `o${i}`, 'other');
  }
  assert.equal(checkPostRatePerSub(db, REC, 'lobby', now), null);
});

test('checkPostRatePerSub: established (>=30d) account allowed 20/day per sub', () => {
  const now = Date.now();
  const db = freshDb(now);
  // EST = 30 days old → trusted. Limit = 20/day. Seed 19 → still ok.
  for (let i = 0; i < 19; i++) {
    seedPost(db, EST, now - i * 60 * 1000, `e${i}`, 'lobby');
  }
  assert.equal(checkPostRatePerSub(db, EST, 'lobby', now), null);
  // Seed one more → at the limit, next blocks
  seedPost(db, EST, now - 20 * 60 * 1000, 'e19', 'lobby');
  const block = checkPostRatePerSub(db, EST, 'lobby', now);
  assert.ok(block);
  assert.match(block.message, /20\/day/);
});

test('rolloff: posts older than the window do not count', () => {
  const now = Date.now();
  const db = freshDb(now);
  // 4 posts but all >24h ago — none count toward the new-tier day cap
  for (let i = 0; i < 4; i++) {
    seedPost(db, NEW, now - (DAY + i * HOUR), `o${i}`);
  }
  assert.equal(checkPostRate(db, NEW, now), null);
});

test('resolveRateLimitConfig: empty overrides returns floor', () => {
  const cfg = resolveRateLimitConfig({});
  assert.equal(cfg.perAccount.new.postsPerHour, RATE_LIMIT_FLOOR.perAccount.new.postsPerHour);
  assert.equal(cfg.perSubDay.newish, RATE_LIMIT_FLOOR.perSubDay.newish);
});

test('resolveRateLimitConfig: tightening below floor is allowed', () => {
  const cfg = resolveRateLimitConfig({
    perAccount: { recent: { postsPerDay: 5 } }, // floor = 10, override = 5
    perSubDay: { trusted: 10 },                  // floor = 20, override = 10
  });
  assert.equal(cfg.perAccount.recent.postsPerDay, 5);
  assert.equal(cfg.perSubDay.trusted, 10);
  // Untouched values stay at floor
  assert.equal(cfg.perAccount.recent.postsPerHour, RATE_LIMIT_FLOOR.perAccount.recent.postsPerHour);
});

test('resolveRateLimitConfig: loosening above floor throws', () => {
  assert.throws(() => resolveRateLimitConfig({
    perAccount: { new: { postsPerHour: 10 } }, // floor = 1
  }), /exceeds floor/);
  assert.throws(() => resolveRateLimitConfig({
    perSubDay: { newish: 100 }, // floor = 5
  }), /exceeds floor/);
});

test('resolveRateLimitConfig: bad types throw', () => {
  assert.throws(() => resolveRateLimitConfig({
    perAccount: { new: { postsPerHour: -1 } },
  }), /non-negative/);
  assert.throws(() => resolveRateLimitConfig({
    perAccount: { new: { postsPerHour: 'lots' } },
  }), /non-negative/);
});

test('checkPostRate honors operator config when passed', () => {
  const now = Date.now();
  const db = freshDb(now);
  // Tighten: limit "recent" tier to 1 post/hour. REC has 0 posts → first ok.
  const cfg = resolveRateLimitConfig({ perAccount: { recent: { postsPerHour: 1 } } });
  assert.equal(checkPostRate(db, REC, now, cfg), null);
  seedPost(db, REC, now - 10 * 60 * 1000, 'a');
  const block = checkPostRate(db, REC, now, cfg);
  assert.ok(block);
  assert.match(block.message, /1\/hour/);
});
