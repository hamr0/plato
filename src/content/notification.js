// Per-user notifications — memlog (M6/B0).
//
// Seven kinds of events generate rows:
//   comment_on_post   — top-level comment on a post you authored
//   reply_to_comment  — reply to a comment you authored
//   mod_action        — your content or handle was acted on by a mod
//                       (sub-keyed action; reason carried in snippet)
//   export_ready      — an archive you requested has finished building
//                       (M7/B2-b; target_id = job id; snippet = expiry date)
//   export_failed     — an archive you requested terminal-failed after
//                       MAX_ATTEMPTS or hit its SLA window
//   import_ready      — a sub-import you requested has finished
//                       (M7/B5; target_id = import job id; snippet links
//                       to the new sub on this instance)
//   import_failed     — an import you requested terminal-failed (URL
//                       fetch failed, archive corrupt, name conflict, etc.)
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
  'export_ready',
  'export_failed',
  'import_ready',
  'import_failed',
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

// Activity stream: posts and comments authored by the handle, shaped to
// match the notification row contract so the memlog renderer can slot
// them into the same table. `id` is the post/comment id (not a
// notification id); the renderer links to memlogTargetLink directly
// rather than routing through /memlog/go (no read-state to mark).
//
// Removed targets are excluded — the user's own removed content stays
// in the public modlog as the audit trail; their personal activity
// view shows only live content. Same for hard-removed comments.
export function listActivityForHandle(db, handle, { kinds = ['post', 'comment'], limit = 100, offset = 0 } = {}) {
  if (!handle) return [];
  const parts = [];
  const params = [];
  if (kinds.includes('post')) {
    parts.push(
      `SELECT id, 'my_post' AS kind, sub_name, 'post' AS target_type, id AS target_id,
              NULL AS actor_handle, substr(title, 1, 120) AS snippet, created_at, NULL AS read_at
       FROM posts WHERE handle = ? AND removed_at IS NULL`
    );
    params.push(handle);
  }
  if (kinds.includes('comment')) {
    parts.push(
      `SELECT c.id AS id, 'my_comment' AS kind, p.sub_name AS sub_name, 'comment' AS target_type,
              c.id AS target_id, NULL AS actor_handle, substr(c.body, 1, 120) AS snippet,
              c.created_at AS created_at, NULL AS read_at
       FROM comments c JOIN posts p ON p.id = c.post_id
       WHERE c.handle = ? AND c.removed_at IS NULL`
    );
    params.push(handle);
  }
  if (parts.length === 0) return [];
  const sql = `SELECT * FROM (${parts.join(' UNION ALL ')}) ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...params, limit, offset);
}

// Lazy prune: drop rows older than the retention window regardless of
// read state. If a notification has sat for >90d the moment has passed.
export function pruneOldNotifications(db, now = Date.now(), retentionMs = NOTIFICATION_RETENTION_MS) {
  return db.prepare(
    'DELETE FROM notifications WHERE created_at < ?'
  ).run(now - retentionMs).changes;
}
