import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  createSub,
  getSubByName,
  setSubFlairs,
  getSubFlairs,
  cascadeFlairChanges,
} from '../../src/content/sub.js';
import { computeFlairChanges } from '../../src/content/flair.js';
import { submitDraft, finalizeDraft, listPostsInSub } from '../../src/content/post.js';

const OWNER = 'a'.repeat(64);
const NEWS    = { slug: 'news', label: 'news',    color: '#58a6ff' };
const META    = { slug: 'meta', label: 'meta',    color: '#3fb950' };

function fresh() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run(OWNER, 'owner', Date.now());
  return db;
}

test('createSub: persists flairs as JSON', () => {
  const db = fresh();
  createSub(db, { name: 'general-talk', ownerHandle: OWNER, flairs: [NEWS, META] });
  const sub = getSubByName(db, 'general-talk');
  assert.equal(JSON.parse(sub.flairs).length, 2);
  assert.deepEqual(getSubFlairs(db, 'general-talk'), [NEWS, META]);
});

test('createSub: flairs_required cannot be set without flairs', () => {
  const db = fresh();
  assert.throws(
    () => createSub(db, { name: 'oops', ownerHandle: OWNER, flairs: [], flairsRequired: true }),
    /cannot be set when no flairs/
  );
});

test('createSub: invalid flair rejects whole creation', () => {
  const db = fresh();
  assert.throws(
    () => createSub(db, { name: 'bad-sub', ownerHandle: OWNER, flairs: [{ slug: 'BAD', label: 'x', color: '#fff' }] }),
    /slug/
  );
  assert.equal(getSubByName(db, 'bad-sub'), null);
});

test('setSubFlairs: replaces list and required flag', () => {
  const db = fresh();
  createSub(db, { name: 'rolling-news', ownerHandle: OWNER, flairs: [NEWS] });
  setSubFlairs(db, 'rolling-news', { flairs: [NEWS, META], flairsRequired: true });
  assert.deepEqual(getSubFlairs(db, 'rolling-news'), [NEWS, META]);
  assert.equal(getSubByName(db, 'rolling-news').flairs_required, 1);
});

test('setSubFlairs: unknown sub throws', () => {
  const db = fresh();
  assert.throws(() => setSubFlairs(db, 'ghost', { flairs: [], flairsRequired: false }), /not found/);
});

test('finalizeDraft: rejects unknown flair', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-'));
  try {
    createSub(db, { name: 'topic-a', ownerHandle: OWNER, flairs: [NEWS] });
    const { draftId } = submitDraft(db, { title: 't', body: 'b', subName: 'topic-a', flairSlug: 'meta' });
    assert.throws(
      () => finalizeDraft(db, { draftId, handle: OWNER, postsDir }),
      /not available/
    );
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('finalizeDraft: rejects missing flair when required', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-'));
  try {
    createSub(db, { name: 'topic-b', ownerHandle: OWNER, flairs: [NEWS], flairsRequired: true });
    const { draftId } = submitDraft(db, { title: 't', body: 'b', subName: 'topic-b' });
    assert.throws(
      () => finalizeDraft(db, { draftId, handle: OWNER, postsDir }),
      /requires a flair/
    );
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('finalizeDraft: writes flair_slug onto the post', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-'));
  try {
    createSub(db, { name: 'topic-c', ownerHandle: OWNER, flairs: [NEWS] });
    const { draftId } = submitDraft(db, { title: 't', body: 'b', subName: 'topic-c', flairSlug: 'news' });
    const { postId } = finalizeDraft(db, { draftId, handle: OWNER, postsDir });
    const row = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(postId);
    assert.equal(row.flair_slug, 'news');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('listPostsInSub: filters by flair_slug', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-'));
  try {
    createSub(db, { name: 'mixed', ownerHandle: OWNER, flairs: [NEWS, META] });
    for (const slug of ['news', 'meta', 'news', null]) {
      const { draftId } = submitDraft(db, { title: 't', body: 'b', subName: 'mixed', flairSlug: slug });
      finalizeDraft(db, { draftId, handle: OWNER, postsDir });
    }
    assert.equal(listPostsInSub(db, 'mixed').length, 4);
    assert.equal(listPostsInSub(db, 'mixed', { flairSlug: 'news' }).length, 2);
    assert.equal(listPostsInSub(db, 'mixed', { flairSlug: 'meta' }).length, 1);
    assert.equal(listPostsInSub(db, 'mixed', { flairSlug: 'ghost' }).length, 0);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

// --- Flair edit cascade (PRD: flair = categorization slot, not contract) ---

test('computeFlairChanges: pure rename at same row index', () => {
  const newSlugByRow = new Map([[0, 'tools']]);
  const { renames, removes } = computeFlairChanges(['ai', '', '', '', '', ''], newSlugByRow);
  assert.deepEqual(renames, [{ fromSlug: 'ai', toSlug: 'tools' }]);
  assert.deepEqual(removes, []);
});

test('computeFlairChanges: cleared label produces a remove', () => {
  const newSlugByRow = new Map();
  const { renames, removes } = computeFlairChanges(['ai', '', '', '', '', ''], newSlugByRow);
  assert.deepEqual(renames, []);
  assert.deepEqual(removes, ['ai']);
});

test('computeFlairChanges: swap preserves both slugs, no cascade', () => {
  const newSlugByRow = new Map([[0, 'tools'], [1, 'ai']]);
  const { renames, removes } = computeFlairChanges(['ai', 'tools', '', '', '', ''], newSlugByRow);
  assert.deepEqual(renames, []);
  assert.deepEqual(removes, []);
});

test('computeFlairChanges: slug-stable label tweak (case/punct only) is a no-op', () => {
  // Caller passes the SAME slug because slugify produced no change.
  const newSlugByRow = new Map([[0, 'ai']]);
  const { renames, removes } = computeFlairChanges(['ai', '', '', '', '', ''], newSlugByRow);
  assert.deepEqual(renames, []);
  assert.deepEqual(removes, []);
});

test('computeFlairChanges: row cleared but slug reappears at another row = no remove', () => {
  // User cleared row 0 'ai' and retyped 'AI' at row 3 — semantically a move.
  const newSlugByRow = new Map([[3, 'ai']]);
  const { renames, removes } = computeFlairChanges(['ai', '', '', '', '', ''], newSlugByRow);
  assert.deepEqual(renames, []);
  assert.deepEqual(removes, []);
});

test('cascadeFlairChanges: rename updates posts and drafts', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-cascade-'));
  try {
    createSub(db, { name: 'cascade-sub', ownerHandle: OWNER, flairs: [NEWS] });
    // One post with the flair, one draft with the flair, one of each without.
    const { draftId: d1 } = submitDraft(db, { title: 'p1', body: 'b', subName: 'cascade-sub', flairSlug: 'news' });
    const { postId: p1 } = finalizeDraft(db, { draftId: d1, handle: OWNER, postsDir });
    const { draftId: d2 } = submitDraft(db, { title: 'p2', body: 'b', subName: 'cascade-sub' });
    const { postId: p2 } = finalizeDraft(db, { draftId: d2, handle: OWNER, postsDir });
    // Live unfinalized draft with the flair.
    const { draftId: d3 } = submitDraft(db, { title: 'p3', body: 'b', subName: 'cascade-sub', flairSlug: 'news' });

    cascadeFlairChanges(db, 'cascade-sub', {
      renames: [{ fromSlug: 'news', toSlug: 'headlines' }],
      removes: [],
    });

    const row1 = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(p1);
    const row2 = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(p2);
    const row3 = db.prepare('SELECT flair_slug FROM drafts WHERE id = ?').get(d3);
    assert.equal(row1.flair_slug, 'headlines', 'flaired post should follow rename');
    assert.equal(row2.flair_slug, null, 'unflaired post should stay null');
    assert.equal(row3.flair_slug, 'headlines', 'flaired draft should follow rename');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('cascadeFlairChanges: remove nulls posts and drafts', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-cascade-'));
  try {
    createSub(db, { name: 'remove-sub', ownerHandle: OWNER, flairs: [NEWS] });
    const { draftId: d1 } = submitDraft(db, { title: 'p1', body: 'b', subName: 'remove-sub', flairSlug: 'news' });
    const { postId: p1 } = finalizeDraft(db, { draftId: d1, handle: OWNER, postsDir });
    const { draftId: d2 } = submitDraft(db, { title: 'p2', body: 'b', subName: 'remove-sub', flairSlug: 'news' });

    cascadeFlairChanges(db, 'remove-sub', { renames: [], removes: ['news'] });

    const post = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(p1);
    const draft = db.prepare('SELECT flair_slug FROM drafts WHERE id = ?').get(d2);
    assert.equal(post.flair_slug, null);
    assert.equal(draft.flair_slug, null);
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('cascadeFlairChanges: empty inputs are a no-op', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-cascade-'));
  try {
    createSub(db, { name: 'noop-sub', ownerHandle: OWNER, flairs: [NEWS] });
    const { draftId } = submitDraft(db, { title: 'p', body: 'b', subName: 'noop-sub', flairSlug: 'news' });
    const { postId } = finalizeDraft(db, { draftId, handle: OWNER, postsDir });
    cascadeFlairChanges(db, 'noop-sub', { renames: [], removes: [] });
    const row = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(postId);
    assert.equal(row.flair_slug, 'news');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});

test('cascadeFlairChanges: scoped to one sub — sibling subs untouched', () => {
  const db = fresh();
  const postsDir = mkdtempSync(join(tmpdir(), 'plato-flair-cascade-'));
  try {
    createSub(db, { name: 'sub-a', ownerHandle: OWNER, flairs: [NEWS] });
    createSub(db, { name: 'sub-b', ownerHandle: OWNER, flairs: [NEWS] });
    const { draftId: dA } = submitDraft(db, { title: 'a', body: 'b', subName: 'sub-a', flairSlug: 'news' });
    const { postId: pA } = finalizeDraft(db, { draftId: dA, handle: OWNER, postsDir });
    const { draftId: dB } = submitDraft(db, { title: 'b', body: 'b', subName: 'sub-b', flairSlug: 'news' });
    const { postId: pB } = finalizeDraft(db, { draftId: dB, handle: OWNER, postsDir });

    cascadeFlairChanges(db, 'sub-a', {
      renames: [{ fromSlug: 'news', toSlug: 'headlines' }],
      removes: [],
    });

    const rowA = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(pA);
    const rowB = db.prepare('SELECT flair_slug FROM posts WHERE id = ?').get(pB);
    assert.equal(rowA.flair_slug, 'headlines', 'sub-a post should be renamed');
    assert.equal(rowB.flair_slug, 'news', 'sub-b post should keep its slug');
  } finally {
    rmSync(postsDir, { recursive: true, force: true });
  }
});
