import { readdirSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(HERE, '../src/db/migrations');
const DB_PATH = process.env.DB_PATH ?? './forum.db';

const db = openDb(DB_PATH);

// Migrations may need to rebuild tables to alter constraints (SQLite cannot
// ALTER TABLE ADD CONSTRAINT). The canonical pattern requires foreign_keys
// = OFF, which is a no-op inside a transaction. Disable here, before any
// BEGIN. Re-enabled at the end with a foreign_key_check to catch any
// integrity issue introduced by the migrations themselves.
db.exec('PRAGMA foreign_keys = OFF');

db.exec(`
  CREATE TABLE IF NOT EXISTS schema_migrations (
    filename TEXT PRIMARY KEY,
    applied_at INTEGER NOT NULL
  );
`);

const applied = new Set(
  db.prepare('SELECT filename FROM schema_migrations').all().map(r => r.filename)
);

const files = readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
let applied_count = 0;

for (const f of files) {
  if (applied.has(f)) continue;
  const sql = readFileSync(resolve(MIGRATIONS_DIR, f), 'utf8');
  db.exec('BEGIN');
  try {
    if (sql.trim()) db.exec(sql);
    db.prepare('INSERT INTO schema_migrations (filename, applied_at) VALUES (?, ?)').run(f, Date.now());
    db.exec('COMMIT');
    console.log(`applied ${f}`);
    applied_count++;
  } catch (err) {
    db.exec('ROLLBACK');
    console.error(`failed ${f}: ${err.message}`);
    process.exit(1);
  }
}

db.exec('PRAGMA foreign_keys = ON');
const violations = db.prepare('PRAGMA foreign_key_check').all();
if (violations.length > 0) {
  console.error('foreign key check failed after migrations:');
  for (const v of violations) console.error(' ', v);
  process.exit(1);
}

console.log(applied_count === 0 ? 'no pending migrations' : `applied ${applied_count} migration(s)`);
db.close();
