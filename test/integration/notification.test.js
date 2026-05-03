import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../../src/db/index.js';
import { applyAllMigrations } from '../_helpers/migrations.js';
import {
  recordNotification, unreadCount, listNotifications,
  markNotificationRead, markAllNotificationsRead, pruneOldNotifications,
  NOTIFICATION_RETENTION_MS,
} from '../../src/content/notification.js';

const A = 'a'.repeat(64);
const B = 'b'.repeat(64);

function fixture() {
  const db = openDb(':memory:');
  applyAllMigrations(db);
  return db;
}

test('recordNotification: inserts a row and unreadCount reflects it', () => {
  const db = fixture();
  const id = recordNotification(db, {
    recipientHandle: A, kind: 'comment_on_post', subName: 'lobby',
    targetType: 'comment', targetId: 't1', actorHandle: B, snippet: 'hi',
  });
  assert.ok(id);
  assert.equal(unreadCount(db, A), 1);
});

test('recordNotification: self-notifications are silently skipped', () => {
  const db = fixture();
  const id = recordNotification(db, {
    recipientHandle: A, kind: 'reply_to_comment',
    targetType: 'comment', targetId: 't1', actorHandle: A,
  });
  assert.equal(id, null);
  assert.equal(unreadCount(db, A), 0);
});

test('recordNotification: unknown kind throws', () => {
  const db = fixture();
  assert.throws(() => recordNotification(db, {
    recipientHandle: A, kind: 'vote', targetType: 'post', targetId: 'p1',
  }), /unknown kind/);
});

test('recordNotification: trims long snippet to 160 chars', () => {
  const db = fixture();
  const long = 'x'.repeat(500);
  recordNotification(db, {
    recipientHandle: A, kind: 'comment_on_post',
    targetType: 'comment', targetId: 't1', actorHandle: B, snippet: long,
  });
  const [row] = listNotifications(db, A);
  assert.ok(row.snippet.length <= 160);
  assert.ok(row.snippet.endsWith('…'));
});

test('listNotifications: default show=unread excludes read rows', () => {
  const db = fixture();
  const id1 = recordNotification(db, {
    recipientHandle: A, kind: 'comment_on_post', targetType: 'comment', targetId: 't1', actorHandle: B,
  });
  recordNotification(db, {
    recipientHandle: A, kind: 'reply_to_comment', targetType: 'comment', targetId: 't2', actorHandle: B,
  });
  markNotificationRead(db, A, id1);
  const unread = listNotifications(db, A);
  assert.equal(unread.length, 1);
  assert.equal(unread[0].kind, 'reply_to_comment');
  const all = listNotifications(db, A, { show: 'all' });
  assert.equal(all.length, 2);
});

test('listNotifications: kinds filter narrows the result set', () => {
  const db = fixture();
  recordNotification(db, { recipientHandle: A, kind: 'comment_on_post', targetType: 'comment', targetId: 't1', actorHandle: B });
  recordNotification(db, { recipientHandle: A, kind: 'reply_to_comment', targetType: 'comment', targetId: 't2', actorHandle: B });
  recordNotification(db, { recipientHandle: A, kind: 'mod_action', targetType: 'post', targetId: 'p1', actorHandle: B });
  const replies = listNotifications(db, A, { kinds: ['reply_to_comment'] });
  assert.equal(replies.length, 1);
  assert.equal(replies[0].kind, 'reply_to_comment');
});

test('markNotificationRead: only affects own rows', () => {
  const db = fixture();
  const id = recordNotification(db, {
    recipientHandle: A, kind: 'comment_on_post', targetType: 'comment', targetId: 't1', actorHandle: B,
  });
  // B can't mark A's notification read
  assert.equal(markNotificationRead(db, B, id), 0);
  assert.equal(unreadCount(db, A), 1);
  assert.equal(markNotificationRead(db, A, id), 1);
  assert.equal(unreadCount(db, A), 0);
});

test('markAllNotificationsRead: respects kinds filter', () => {
  const db = fixture();
  recordNotification(db, { recipientHandle: A, kind: 'comment_on_post', targetType: 'comment', targetId: 't1', actorHandle: B });
  recordNotification(db, { recipientHandle: A, kind: 'reply_to_comment', targetType: 'comment', targetId: 't2', actorHandle: B });
  recordNotification(db, { recipientHandle: A, kind: 'mod_action', targetType: 'post', targetId: 'p1', actorHandle: B });
  markAllNotificationsRead(db, A, { kinds: ['comment_on_post'] });
  assert.equal(unreadCount(db, A), 2);
});

test('pruneOldNotifications: drops rows older than the retention window', () => {
  const db = fixture();
  const now = Date.now();
  recordNotification(db, {
    recipientHandle: A, kind: 'comment_on_post', targetType: 'comment', targetId: 't1', actorHandle: B,
    now: now - NOTIFICATION_RETENTION_MS - 1000,
  });
  recordNotification(db, {
    recipientHandle: A, kind: 'reply_to_comment', targetType: 'comment', targetId: 't2', actorHandle: B,
    now,
  });
  const dropped = pruneOldNotifications(db, now);
  assert.equal(dropped, 1);
  assert.equal(listNotifications(db, A, { show: 'all' }).length, 1);
});
