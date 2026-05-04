// Per-user RSS token (M6/B6).
//
// Backs the two token-gated personal feeds:
//   /u/<token>/subs.rss  — all-subs activity
//   /u/<token>/rss       — all-subs activity + memlog notifications
//
// One token per user covers both URLs. The token *is* the credential
// (no handle in the URL); rotation invalidates both feeds in one move.
// See migration 015 for schema rationale and PRD §Outbound channels for
// the broader pull-only design lock.

import { randomBytes } from 'node:crypto';

const TOKEN_BYTES = 32;
const TOKEN_HEX_RE = /^[0-9a-f]{64}$/;

function newToken() {
  return randomBytes(TOKEN_BYTES).toString('hex');
}

// Get the user's existing token, generating one on first call. Idempotent
// for an already-issued user — same token returned across calls until
// rotated. Returns the token string.
export function getOrCreateRssToken(db, handle) {
  if (!handle) throw new Error('getOrCreateRssToken: handle required');
  const row = db.prepare('SELECT rss_token FROM handles WHERE handle = ?').get(handle);
  if (!row) throw new Error(`getOrCreateRssToken: unknown handle ${handle}`);
  if (row.rss_token) return row.rss_token;
  const token = newToken();
  db.prepare('UPDATE handles SET rss_token = ? WHERE handle = ?').run(token, handle);
  return token;
}

// Force a new token, invalidating any URL the user previously copied.
// Returns the new token.
export function regenerateRssToken(db, handle) {
  if (!handle) throw new Error('regenerateRssToken: handle required');
  const exists = db.prepare('SELECT 1 FROM handles WHERE handle = ?').get(handle);
  if (!exists) throw new Error(`regenerateRssToken: unknown handle ${handle}`);
  const token = newToken();
  db.prepare('UPDATE handles SET rss_token = ? WHERE handle = ?').run(token, handle);
  return token;
}

// Reverse lookup: feed request → handle. Returns null for missing /
// malformed tokens, which the route handler converts to a 404. Validates
// the hex shape before touching the DB so probes can't drive query load
// with arbitrary strings.
export function handleByRssToken(db, token) {
  if (typeof token !== 'string' || !TOKEN_HEX_RE.test(token)) return null;
  const row = db.prepare('SELECT handle FROM handles WHERE rss_token = ?').get(token);
  return row ? row.handle : null;
}
