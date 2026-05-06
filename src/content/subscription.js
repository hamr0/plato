// Sub subscriptions (M6/B2) — see PRD §Front Page → Sub subscription
// mechanics. Subscribing is a single private bit per (handle, sub):
// the row exists or it doesn't. No notifications produced from this
// module; downstream surfaces (digest, ntfy, RSS) read this table
// alongside notification preferences once those land.
//
// Privacy: subscriber lists are NEVER exposed publicly. Aggregate
// counts are fine (the /subs directory shows them); individual
// memberships are visible only to the subscribing user.

// 60-day continuous-subscription gate for sub export (M7/B2-b). The
// resubscribe restart is automatic: unsubscribe is a hard DELETE, so
// re-subscribing inserts a fresh created_at and the clock starts over.
export const SUB_EXPORT_TENURE_MS = 60 * 24 * 60 * 60 * 1000;

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

// Returns the timestamp the handle's *current* subscription to subName
// began, or null if not subscribed. Because unsubscribe hard-deletes the
// row, re-subscribing produces a fresh created_at — exactly the
// "continuous-since" semantics the export gate needs.
export function subscribedSince(db, handle, subName) {
  if (!handle || !subName) return null;
  const row = db.prepare(
    'SELECT created_at FROM subscriptions WHERE user_handle = ? AND sub_name = ?'
  ).get(handle, subName);
  return row?.created_at ?? null;
}

// Has the handle been continuously subscribed to subName for at least
// SUB_EXPORT_TENURE_MS? Used as the eligibility check for sub-export
// requests (alongside mod-or-co-mod, which short-circuits this).
export function hasSubExportTenure(db, handle, subName, { now = Date.now() } = {}) {
  const since = subscribedSince(db, handle, subName);
  if (since == null) return false;
  return now - since >= SUB_EXPORT_TENURE_MS;
}

// The earliest time the handle becomes export-eligible for subName, or
// null if not subscribed. UI uses this to render the disabled-with-date
// tooltip ("you can request this archive on YYYY-MM-DD").
export function subExportEligibleAt(db, handle, subName) {
  const since = subscribedSince(db, handle, subName);
  return since == null ? null : since + SUB_EXPORT_TENURE_MS;
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
