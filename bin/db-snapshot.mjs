#!/usr/bin/env node
// Online, lock-safe snapshot of one SQLite database into a single clean
// file, using Node's bundled node:sqlite (VACUUM INTO).
//
//   node bin/db-snapshot.mjs <source.db> <dest.db>
//
// Replaces shelling out to the system `sqlite3` CLI for backups: on
// RHEL-family distros that CLI is older than 3.37 and can't open plato's
// STRICT-schema databases, so the backup silently failed there. node:sqlite
// is the same engine plato runs on, so this works on any distro and drops a
// system dependency. VACUUM INTO copies a consistent snapshot while writers
// continue (WAL-safe, no server stop) and emits a fully checkpointed single
// file — no -wal/-shm sidecars to carry in the tarball.
import { DatabaseSync } from 'node:sqlite';

const [src, dest] = process.argv.slice(2);
if (!src || !dest) {
  console.error('usage: db-snapshot.mjs <source.db> <dest.db>');
  process.exit(2);
}

const db = new DatabaseSync(src);
try {
  db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
} finally {
  db.close();
}
