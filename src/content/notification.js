// Per-user notifications — memlog (M6/B0).
//
// Three kinds of events generate rows:
//   comment_on_post   — top-level comment on a post you authored
//   reply_to_comment  — reply to a comment you authored
//   mod_action        — your content or handle was acted on by a mod
//                       (sub-keyed action; reason carried in snippet)
//
// Vote events are deliberately not recorded. Score is the visible signal;
// per-vote pings are an engagement-bait surface plato refuses.
//
// Read items are kept for the retention window (default 90 days); the prune
// runs lazily on the memlog GET handler. The unread chip only counts rows
// where read_at IS NULL.

export const NOTIFICATION_KINDS = Object.freeze([
  'comment_on_post',
  'reply_to_comment',
  'mod_action',
]);

export const NOTIFICATION_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const SNIPPET_MAX = 160;

function trimSnippet(s) {
  if (typeof s !== 'string' || s.length === 0) return null;
  const flat = s.replace(/\s+/g, ' ').trim();
  if (flat.length === 0) return null;
  return flat.length > SNIPPET_MAX ? flat.slice(0, SNIPPET_MAX - 1) + '…' : flat;
}

// Insert one notification row. Self-notifications (actor === recipient) are
// silently skipped — no row is written. Returns the inserted id, or null.
export function recordNotification(db, {
  recipientHandle, kind, subName = null, targetType, targetId,
  actorHandle = null, snippet = null, now = Date.now(),
}) {
  if (!NOTIFICATION_KINDS.includes(kind)) {
    throw new Error(`recordNotification: unknown kind ${kind}`);
  }
  if (!recipientHandle || !targetType || targetId == null) {
    throw new Error('recordNotification: recipientHandle, targetType, targetId required');
  }
  if (actorHandle && actorHandle === recipientHandle) return null;
  const trimmed = trimSnippet(snippet);
  const result = db.prepare(
    `INSERT INTO notifications
     (recipient_handle, kind, sub_name, target_type, target_id, actor_handle, snippet, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(recipientHandle, kind, subName, targetType, String(targetId), actorHandle, trimmed, now);
  return Number(result.lastInsertRowid);
}

export function unreadCount(db, recipientHandle) {
  if (!recipientHandle) return 0;
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM notifications WHERE recipient_handle = ? AND read_at IS NULL'
  ).get(recipientHandle);
  return row?.n ?? 0;
}

// List notifications for a recipient. Filters:
//   show: 'unread' | 'all'           — default 'unread'
//   kinds: array of NOTIFICATION_KINDS — default all kinds
//   limit / offset
export function listNotifications(db, recipientHandle, { show = 'unread', kinds, limit = 100, offset = 0 } = {}) {
  if (!recipientHandle) return [];
  const where = ['recipient_handle = ?'];
  const params = [recipientHandle];
  if (show === 'unread') where.push('read_at IS NULL');
  if (Array.isArray(kinds) && kinds.length > 0) {
    where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    params.push(...kinds);
  }
  return db.prepare(
    `SELECT id, kind, sub_name, target_type, target_id, actor_handle, snippet, created_at, read_at
     FROM notifications
     WHERE ${where.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).all(...params, limit, offset);
}

export function markNotificationRead(db, recipientHandle, id, now = Date.now()) {
  if (!recipientHandle) return 0;
  return db.prepare(
    'UPDATE notifications SET read_at = ? WHERE id = ? AND recipient_handle = ? AND read_at IS NULL'
  ).run(now, id, recipientHandle).changes;
}

// Mark everything matching the active filter as read. Mirrors listNotifications
// filters so "mark all" respects the chip the user clicked it under.
export function markAllNotificationsRead(db, recipientHandle, { kinds } = {}, now = Date.now()) {
  if (!recipientHandle) return 0;
  const where = ['recipient_handle = ?', 'read_at IS NULL'];
  const params = [recipientHandle];
  if (Array.isArray(kinds) && kinds.length > 0) {
    where.push(`kind IN (${kinds.map(() => '?').join(',')})`);
    params.push(...kinds);
  }
  return db.prepare(
    `UPDATE notifications SET read_at = ? WHERE ${where.join(' AND ')}`
  ).run(now, ...params).changes;
}

// Lazy prune: drop rows older than the retention window regardless of
// read state. If a notification has sat for >90d the moment has passed.
export function pruneOldNotifications(db, now = Date.now(), retentionMs = NOTIFICATION_RETENTION_MS) {
  return db.prepare(
    'DELETE FROM notifications WHERE created_at < ?'
  ).run(now - retentionMs).changes;
}
