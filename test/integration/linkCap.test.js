// Outbound link cap tests — M5/B4 (PRD §Spam Defenses 6).
// Covers: URL counting, tier-based caps, config validation, allowed
// vs blocked thresholds.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  countLinks, checkLinkCap, resolveLinkCapConfig, LINK_CAP_FLOOR,
} from '../../src/content/linkCap.js';

const NEW   = 'b'.repeat(64);
const REC   = 'c'.repeat(64);
const EST   = 'd'.repeat(64);
const HOUR = 60 * 60 * 1000;
const DAY  = 24 * HOUR;

function freshDb(now) {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(NEW, 'new-acc', now - 30 * 60 * 1000);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(REC, 'recent',  now - 3 * DAY);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)').run(EST, 'est',     now - 30 * DAY);
  return db;
}

test('countLinks: counts bare URLs', () => {
  assert.equal(countLinks('see https://example.com and http://other.org'), 2);
  assert.equal(countLinks('plain text with no links'), 0);
});

test('countLinks: dedupes the same URL', () => {
  assert.equal(countLinks('https://x.com is mentioned at https://x.com twice'), 1);
});

test('countLinks: catches markdown link URLs', () => {
  assert.equal(countLinks('[click](https://a.com) and [more](https://b.com)'), 2);
});

test('checkLinkCap: new tier blocked at >1 link', () => {
  const now = Date.now();
  const db = freshDb(now);
  assert.equal(checkLinkCap(db, NEW, 'one https://a.com', now), null);
  const block = checkLinkCap(db, NEW, 'two https://a.com https://b.com', now);
  assert.ok(block);
  assert.match(block.message, /1 link/);
  assert.match(block.message, /new accounts/);
});

test('checkLinkCap: recent tier blocked at >3 links', () => {
  const now = Date.now();
  const db = freshDb(now);
  assert.equal(checkLinkCap(db, REC, 'a https://a.com b https://b.com c https://c.com', now), null);
  const block = checkLinkCap(db, REC, 'a https://a.com b https://b.com c https://c.com d https://d.com', now);
  assert.ok(block);
  assert.match(block.message, /3 links/);
});

test('checkLinkCap: established tier blocked at >5 links', () => {
  const now = Date.now();
  const db = freshDb(now);
  const fiveLinks = [1,2,3,4,5].map((i) => `https://x${i}.com`).join(' ');
  assert.equal(checkLinkCap(db, EST, fiveLinks, now), null);
  const sixLinks = fiveLinks + ' https://x6.com';
  const block = checkLinkCap(db, EST, sixLinks, now);
  assert.ok(block);
  assert.match(block.message, /5 links/);
});

test('checkLinkCap: zero links is always allowed regardless of tier', () => {
  const now = Date.now();
  const db = freshDb(now);
  assert.equal(checkLinkCap(db, NEW, 'no links here', now), null);
  assert.equal(checkLinkCap(db, NEW, '', now), null);
});

test('resolveLinkCapConfig: empty overrides → floor', () => {
  const cfg = resolveLinkCapConfig({});
  assert.deepEqual(cfg, LINK_CAP_FLOOR);
});

test('resolveLinkCapConfig: tighten allowed', () => {
  const cfg = resolveLinkCapConfig({ established: 2 });
  assert.equal(cfg.established, 2);
  assert.equal(cfg.new, LINK_CAP_FLOOR.new);
});

test('resolveLinkCapConfig: loosen above floor throws', () => {
  assert.throws(() => resolveLinkCapConfig({ new: 5 }), /exceeds floor/);
  assert.throws(() => resolveLinkCapConfig({ established: 99 }), /exceeds floor/);
});

test('resolveLinkCapConfig: bad type throws', () => {
  assert.throws(() => resolveLinkCapConfig({ new: -1 }), /non-negative/);
  assert.throws(() => resolveLinkCapConfig({ recent: 'lots' }), /non-negative/);
});

test('checkLinkCap honors tightened config', () => {
  const now = Date.now();
  const db = freshDb(now);
  // Tighten established from 5 to 1
  const cfg = resolveLinkCapConfig({ established: 1 });
  assert.equal(checkLinkCap(db, EST, 'one https://a.com', now, cfg), null);
  const block = checkLinkCap(db, EST, 'two https://a.com https://b.com', now, cfg);
  assert.ok(block);
  assert.match(block.message, /1 link\b/);
});
