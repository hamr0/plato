import { DatabaseSync } from 'node:sqlite';

export function openDb(path) {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  // Wait up to 5s for a held write lock instead of throwing SQLITE_BUSY on the
  // first contended `BEGIN IMMEDIATE`. WAL keeps readers off the writer's back,
  // but writers still serialize: the live server plus the export/import cron
  // workers (same */15 off-peak window) all write forum.db, so a momentary
  // collision is expected and should wait-and-retry, not crash the worker.
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}
