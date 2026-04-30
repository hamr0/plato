import { randomBytes } from 'node:crypto';
import { uniqueNamesGenerator, adjectives, animals } from 'unique-names-generator';

const MAX_COLLISION_RETRIES = 20;

// Attempt 0 is deterministic from handle (so the first generation for a given
// handle is reproducible — useful for tests and for "what would my pseudonym
// be" curiosity). Retries use crypto-random seeds because the deterministic
// seed→combo mapping in unique-names-generator has hash-collision-like behavior
// where suffixed retry seeds (handle-X-1, handle-X-2) can deterministically
// collide with other handles' attempt-0 outputs. Random retries break that
// pattern. Determinism on retry isn't useful anyway — the first successful
// insert is cached, so re-invocations hit the cache.
export function defaultGenerate(handle, attempt) {
  return uniqueNamesGenerator({
    dictionaries: [adjectives, animals],
    separator: '-',
    length: 2,
    seed: attempt === 0 ? handle : randomBytes(8).toString('hex'),
  });
}

export function pseudonymFor(db, handle, generate = defaultGenerate) {
  const cached = db.prepare('SELECT pseudonym FROM handles WHERE handle = ?').get(handle);
  if (cached) return cached.pseudonym;

  const insert = db.prepare(
    'INSERT INTO handles (handle, pseudonym, first_seen_at) VALUES (?, ?, ?)'
  );

  for (let attempt = 0; attempt < MAX_COLLISION_RETRIES; attempt++) {
    const pseudonym = generate(handle, attempt);
    try {
      insert.run(handle, pseudonym, Date.now());
      return pseudonym;
    } catch (err) {
      // node:sqlite surfaces SQLite errors via err.message (no err.code constant
      // like better-sqlite3). Match by the stable "UNIQUE constraint failed" prefix.
      if (!/^UNIQUE constraint failed/.test(err.message)) throw err;
    }
  }

  throw new Error(
    `pseudonymFor: collision retry exhausted (${MAX_COLLISION_RETRIES} attempts) for handle ${handle.slice(0, 8)}...`
  );
}
