import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';

function freshDb() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

test('handles: insert + read works', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  const row = db.prepare('SELECT * FROM handles WHERE handle = ?').get('h1');
  assert.equal(row.pseudonym, 'usual-caribou');
});

test('handles: pseudonym is UNIQUE', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  assert.throws(() => {
    db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
      .run('h2', 'usual-caribou', Date.now());
  }, /UNIQUE/);
});

test('posts: requires existing handle (FK enforcement)', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('p1', 'nonexistent-handle', 'hi', 'posts/p1.md', Date.now());
  }, /FOREIGN KEY/);
});

test('posts: file_path is UNIQUE', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'first', 'posts/p1.md', Date.now());
  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('p2', 'h1', 'second', 'posts/p1.md', Date.now());
  }, /UNIQUE/);
});

test('posts: sub_name defaults to general', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'hi', 'posts/p1.md', Date.now());
  const row = db.prepare('SELECT sub_name FROM posts WHERE id = ?').get('p1');
  assert.equal(row.sub_name, 'general');
});

test('drafts: insert + finalize round-trip works', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());

  db.prepare(`INSERT INTO drafts (id, title, body, created_at)
              VALUES (?, ?, ?, ?)`)
    .run('d1', 'hello', '# hi', Date.now());

  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'hello', 'posts/p1.md', Date.now());

  db.prepare('UPDATE drafts SET finalized_post_id = ? WHERE id = ?').run('p1', 'd1');

  const row = db.prepare('SELECT * FROM drafts WHERE id = ?').get('d1');
  assert.equal(row.finalized_post_id, 'p1');
});

test('drafts: finalized_post_id is UNIQUE (one draft per post)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('p1', 'h1', 'hi', 'posts/p1.md', Date.now());

  db.prepare(`INSERT INTO drafts (id, title, body, created_at, finalized_post_id)
              VALUES (?, ?, ?, ?, ?)`)
    .run('d1', 't', 'b', Date.now(), 'p1');

  assert.throws(() => {
    db.prepare(`INSERT INTO drafts (id, title, body, created_at, finalized_post_id)
                VALUES (?, ?, ?, ?, ?)`)
      .run('d2', 't', 'b', Date.now(), 'p1');
  }, /UNIQUE/);
});

test('drafts: finalized_post_id FK rejects non-existent post', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO drafts (id, title, body, created_at, finalized_post_id)
                VALUES (?, ?, ?, ?, ?)`)
      .run('d1', 't', 'b', Date.now(), 'nonexistent-post');
  }, /FOREIGN KEY/);
});

test('drafts: NULL finalized_post_id is fine (unfinalized draft)', () => {
  const db = freshDb();
  db.prepare(`INSERT INTO drafts (id, title, body, created_at)
              VALUES (?, ?, ?, ?)`)
    .run('d1', 't', 'b', Date.now());
  const row = db.prepare('SELECT finalized_post_id FROM drafts WHERE id = ?').get('d1');
  assert.equal(row.finalized_post_id, null);
});

test('subs: general sub exists after migration with NULL owner', () => {
  const db = freshDb();
  const row = db.prepare('SELECT * FROM subs WHERE name = ?').get('general');
  assert.equal(row.name, 'general');
  assert.equal(row.owner_handle, null);
  assert.equal(row.default_sort, 'new');
});

test('subs: name is PRIMARY KEY (UNIQUE)', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO subs (name, created_at) VALUES (?, ?)`)
      .run('general', Date.now());
  }, /UNIQUE|PRIMARY/);
});

test('subs: owner_handle FK rejects nonexistent handle', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO subs (name, owner_handle, created_at) VALUES (?, ?, ?)`)
      .run('mysub', 'nonexistent-handle', Date.now());
  }, /FOREIGN KEY/);
});

test('posts.sub_name FK rejects nonexistent sub', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?, ?)`)
      .run('p1', 'nope', 'h1', 't', 'posts/p1.md', Date.now());
  }, /FOREIGN KEY/);
});

test('drafts.sub_name FK rejects nonexistent sub', () => {
  const db = freshDb();
  assert.throws(() => {
    db.prepare(`INSERT INTO drafts (id, sub_name, title, body, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('d1', 'nope', 't', 'b', Date.now());
  }, /FOREIGN KEY/);
});

test('sub_mods: composite PK on (sub_name, handle)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());
  db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)')
    .run('general', 'h1', 'owner');
  assert.throws(() => {
    db.prepare('INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, ?)')
      .run('general', 'h1', 'co');
  }, /UNIQUE|PRIMARY/);
});

test('comments: insert + read works', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'commenter-one', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', 'general', 'h1', 't', 'posts/p1.md', Date.now());

  db.prepare(`INSERT INTO comments (id, post_id, handle, body, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('c1', 'p1', 'h1', 'first thought', Date.now());
  const row = db.prepare('SELECT * FROM comments WHERE id = ?').get('c1');
  assert.equal(row.body, 'first thought');
  assert.equal(row.parent_comment_id, null);
  assert.equal(row.score, 0);
});

test('comments: parent_comment_id self-reference works (replies)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'commenter-one', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', 'general', 'h1', 't', 'posts/p1.md', Date.now());

  db.prepare('INSERT INTO comments (id, post_id, handle, body, created_at) VALUES (?, ?, ?, ?, ?)')
    .run('c1', 'p1', 'h1', 'parent', Date.now());
  db.prepare(`INSERT INTO comments (id, post_id, parent_comment_id, handle, body, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('c2', 'p1', 'c1', 'h1', 'reply', Date.now());

  const reply = db.prepare('SELECT parent_comment_id FROM comments WHERE id = ?').get('c2');
  assert.equal(reply.parent_comment_id, 'c1');
});

test('comments: post_id FK rejects nonexistent post', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'one', Date.now());
  assert.throws(() => {
    db.prepare('INSERT INTO comments (id, post_id, handle, body, created_at) VALUES (?, ?, ?, ?, ?)')
      .run('c1', 'nope', 'h1', 'b', Date.now());
  }, /FOREIGN KEY/);
});

test('votes: composite PK on (target_type, target_id, handle)', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'voter-one', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', 'general', 'h1', 't', 'posts/p1.md', Date.now());

  db.prepare(`INSERT INTO votes (target_type, target_id, handle, value, created_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run('post', 'p1', 'h1', 1.0, Date.now());

  assert.throws(() => {
    db.prepare(`INSERT INTO votes (target_type, target_id, handle, value, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('post', 'p1', 'h1', -1.0, Date.now());
  }, /UNIQUE|PRIMARY/);
});

test('votes: value CHECK rejects illegal magnitudes', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'voter-one', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', 'general', 'h1', 't', 'posts/p1.md', Date.now());

  for (const bad of [0, 2, -2, 0.25, 1.5]) {
    assert.throws(() => {
      db.prepare(`INSERT INTO votes (target_type, target_id, handle, value, created_at)
                  VALUES (?, ?, ?, ?, ?)`)
        .run('post', 'p1', 'h1', bad, Date.now());
    }, /CHECK/, `value ${bad} should violate CHECK`);
  }
});

test('votes: target_type CHECK rejects unknown types', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'voter-one', Date.now());
  assert.throws(() => {
    db.prepare(`INSERT INTO votes (target_type, target_id, handle, value, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('user', 'h1', 'h1', 1.0, Date.now());
  }, /CHECK/);
});

test('posts: score column defaults to 0', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'one', Date.now());
  db.prepare(`INSERT INTO posts (id, sub_name, handle, title, file_path, created_at)
              VALUES (?, ?, ?, ?, ?, ?)`)
    .run('p1', 'general', 'h1', 't', 'posts/p1.md', Date.now());
  const row = db.prepare('SELECT score FROM posts WHERE id = ?').get('p1');
  assert.equal(row.score, 0);
});

test('STRICT enforcement: type mismatches reject', () => {
  const db = freshDb();
  db.prepare('INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)')
    .run('h1', 'usual-caribou', Date.now());

  assert.throws(() => {
    db.prepare(`INSERT INTO posts (id, handle, title, file_path, created_at)
                VALUES (?, ?, ?, ?, ?)`)
      .run('p1', 'h1', 'hi', 'posts/p1.md', 'not-an-integer');
  }, /TYPE|cannot store|datatype/i);
});
