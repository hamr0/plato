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
} from '../../src/content/sub.js';
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
