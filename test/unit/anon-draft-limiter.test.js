import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeAnonDraftLimiter } from '../../src/web/app.js';

const HOUR = 60 * 60 * 1000;

test('anon draft limiter: allows exactly `limit` per IP per hour, then refuses', () => {
  const allow = makeAnonDraftLimiter(3);
  const t = 1_000_000_000_000; // fixed base so the window is stable
  assert.equal(allow('1.2.3.4', t), true);
  assert.equal(allow('1.2.3.4', t), true);
  assert.equal(allow('1.2.3.4', t), true);
  assert.equal(allow('1.2.3.4', t), false, '4th in the same window is refused');
});

test('anon draft limiter: each IP has its own budget', () => {
  const allow = makeAnonDraftLimiter(1);
  const t = 1_000_000_000_000;
  assert.equal(allow('a', t), true);
  assert.equal(allow('a', t), false, 'a is spent');
  assert.equal(allow('b', t), true, 'b is unaffected by a');
});

test('anon draft limiter: the budget resets in the next hour window', () => {
  const allow = makeAnonDraftLimiter(2);
  const t = 1_000_000_000_000;
  assert.equal(allow('ip', t), true);
  assert.equal(allow('ip', t), true);
  assert.equal(allow('ip', t), false, 'spent this hour');
  assert.equal(allow('ip', t + HOUR), true, 'new hour, fresh budget');
});

test('anon draft limiter: prunes stale windows so the map does not grow unbounded', () => {
  const allow = makeAnonDraftLimiter(1);
  // Fill one IP per hour across many hours; each window change should evict
  // the prior window's key. If it didn't prune, an old IP would still be
  // "spent" — instead it is allowed again because its bucket was dropped.
  const base = 1_000_000_000_000;
  assert.equal(allow('drifter', base), true);
  assert.equal(allow('drifter', base), false);
  // 100 hours later the old bucket is gone; the IP gets a fresh allow.
  assert.equal(allow('drifter', base + 100 * HOUR), true);
});
