// Sub subscriptions (M6/B2) — see PRD §Front Page → Sub subscription
// mechanics. Subscribing is a single private bit per (handle, sub):
// the row exists or it doesn't. No notifications produced from this
// module; downstream surfaces (digest, ntfy, RSS) read this table
// alongside notification preferences once those land.
//
// Privacy: subscriber lists are NEVER exposed publicly. Aggregate
// counts are fine (the /subs directory shows them); individual
// memberships are visible only to the subscribing user.

export function subscribe(db, { handle, subName, now = Date.now() }) {
  if (!handle) throw new Error('subscribe: handle is required');
  if (!subName) throw new Error('subscribe: subName is required');
  // INSERT OR IGNORE keeps double-subscribe idempotent and preserves
  // the original created_at — important for "subscribed since" UX
  // even though we don't surface it yet.
  db.prepare(
    'INSERT OR IGNORE INTO subscriptions (user_handle, sub_name, created_at) VALUES (?, ?, ?)'
  ).run(handle, subName, now);
}

export function unsubscribe(db, { handle, subName }) {
  if (!handle) throw new Error('unsubscribe: handle is required');
  if (!subName) throw new Error('unsubscribe: subName is required');
  db.prepare(
    'DELETE FROM subscriptions WHERE user_handle = ? AND sub_name = ?'
  ).run(handle, subName);
}

export function isSubscribed(db, handle, subName) {
  if (!handle || !subName) return false;
  const row = db.prepare(
    'SELECT 1 FROM subscriptions WHERE user_handle = ? AND sub_name = ?'
  ).get(handle, subName);
  return row != null;
}

// Set of sub names the handle is subscribed to. Used by /subs?filter=mine
// and (in B3) by the home-feed Subscribed/All toggle.
export function listSubscribedSubs(db, handle) {
  const out = new Set();
  if (!handle) return out;
  const rows = db.prepare(
    'SELECT sub_name FROM subscriptions WHERE user_handle = ? ORDER BY sub_name ASC'
  ).all(handle);
  for (const r of rows) out.add(r.sub_name);
  return out;
}

// Aggregate counts for the /subs directory's "subscribers" column.
// One round-trip across an arbitrary set of sub names; missing subs
// resolve to 0 in the returned Map (caller can default-render).
export function subscriberCounts(db, subNames) {
  const out = new Map();
  if (subNames.length === 0) return out;
  for (const name of subNames) out.set(name, 0);
  const placeholders = subNames.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT sub_name, COUNT(*) AS n FROM subscriptions
     WHERE sub_name IN (${placeholders}) GROUP BY sub_name`
  ).all(...subNames);
  for (const r of rows) out.set(r.sub_name, r.n);
  return out;
}
