import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdtempSync, rmSync, writeFileSync, mkdirSync, readdirSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKUP_SH = resolve(HERE, '../../bin/backup.sh');

// A STRICT-schema WAL database with `rows` rows — STRICT is the shape that
// the old `sqlite3` CLI (< 3.37, shipped by RHEL-family distros) cannot open,
// which is the bug this script's node:sqlite snapshot fixes.
function makeStrictDb(path, rows) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT NOT NULL) STRICT');
  const ins = db.prepare('INSERT INTO t (v) VALUES (?)');
  for (let i = 0; i < rows; i++) ins.run('row-' + i);
  db.close();
}

function inspect(path) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return {
      rows: db.prepare('SELECT COUNT(*) n FROM t').get().n,
      integrity: db.prepare('PRAGMA integrity_check').get().integrity_check,
    };
  } finally {
    db.close();
  }
}

function runBackup(env) {
  execFileSync('bash', [BACKUP_SH], { env: { ...process.env, ...env } });
}

test('backs up both forum.db and knowless.db, restorable with matching counts', () => {
  const root = mkdtempSync(join(tmpdir(), 'plato-backup-'));
  try {
    const forumDb = join(root, 'forum.db');
    const knowlessDb = join(root, 'knowless.db');
    makeStrictDb(forumDb, 34);     // the forum
    makeStrictDb(knowlessDb, 386); // the identity store the old backup missed

    const postsDir = join(root, 'posts');
    mkdirSync(postsDir);
    writeFileSync(join(postsDir, '2026-01-01-abc.md'), '# hello');
    const configPath = join(root, 'config.json');
    writeFileSync(configPath, '{"branding":{"forumName":"t"}}');
    const backupDir = join(root, 'backups');

    runBackup({
      DB_PATH: forumDb,
      KNOWLESS_DB_PATH: knowlessDb,
      POSTS_DIR: postsDir,
      PLATO_CONFIG: configPath,
      PLATO_SPAM_PATTERNS: join(root, 'spam-patterns.txt'), // absent → isolated from repo
      BACKUP_DIR: backupDir,
    });

    const archives = readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz'));
    assert.equal(archives.length, 1, 'exactly one archive written');

    const restore = join(root, 'restore');
    mkdirSync(restore);
    execFileSync('tar', ['-xzf', join(backupDir, archives[0]), '-C', restore]);

    for (const [name, expected] of [['forum.db', 34], ['knowless.db', 386]]) {
      const p = join(restore, name);
      assert.ok(existsSync(p), `${name} present in backup`);
      assert.ok(!existsSync(p + '-wal'), `${name} is a clean single-file snapshot (no -wal)`);
      const { rows, integrity } = inspect(p);
      assert.equal(rows, expected, `${name} row count preserved`);
      assert.equal(integrity, 'ok', `${name} integrity ok`);
    }

    assert.ok(existsSync(join(restore, 'posts', '2026-01-01-abc.md')), 'posts/ carried');
    assert.ok(existsSync(join(restore, 'config.json')), 'config.json carried');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('succeeds when knowless.db is absent (fresh install), backing up forum.db only', () => {
  const root = mkdtempSync(join(tmpdir(), 'plato-backup-'));
  try {
    const forumDb = join(root, 'forum.db');
    makeStrictDb(forumDb, 3);
    const backupDir = join(root, 'backups');

    runBackup({
      DB_PATH: forumDb,
      KNOWLESS_DB_PATH: join(root, 'knowless.db'), // does not exist
      POSTS_DIR: join(root, 'no-posts'),           // does not exist
      PLATO_CONFIG: join(root, 'no-config.json'),
      PLATO_SPAM_PATTERNS: join(root, 'spam-patterns.txt'),
      BACKUP_DIR: backupDir,
    });

    const archives = readdirSync(backupDir).filter((f) => f.endsWith('.tar.gz'));
    assert.equal(archives.length, 1);
    const restore = join(root, 'restore');
    mkdirSync(restore);
    execFileSync('tar', ['-xzf', join(backupDir, archives[0]), '-C', restore]);
    assert.ok(existsSync(join(restore, 'forum.db')), 'forum.db present');
    assert.equal(inspect(join(restore, 'forum.db')).rows, 3);
    assert.ok(!existsSync(join(restore, 'knowless.db')), 'absent knowless.db skipped, no failure');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
