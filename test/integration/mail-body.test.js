import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeMailBody } from '../../src/web/app.js';

// composeMailBody (0.10.3) is plato's bodyOverride payload for knowless's
// magic-link mail. Tests pin the body shape that the operator-facing email
// must match: warning first, URL on its own line (knowless invariant), the
// optional Last-sign-in security signal, optional instance stub line, and
// the existing civility footer under a standard `-- ` delimiter.

const URL = 'https://terribic.com/auth/callback?t=AAA111BBB222';

test('composeMailBody: warning leads, URL on its own line, no last-login when absent', () => {
  const body = composeMailBody({ url: URL });
  const lines = body.split('\n');
  assert.equal(lines[0], "This link expires in 15 minutes. If you didn't request this,");
  assert.equal(lines[1], 'ignore this email.');
  assert.ok(body.includes('Click to sign in:\n\n' + URL + '\n'));
  assert.ok(!body.includes('Last sign-in'));
  // knowless invariant: URL appears exactly once, on its own line.
  assert.equal(body.split(URL).length - 1, 1);
  assert.equal(lines.filter((l) => l === URL).length, 1);
});

test('composeMailBody: includes Last-sign-in block with ISO timestamp when lastLoginAt provided', () => {
  const ts = Date.parse('2026-05-09T16:57:05.667Z');
  const body = composeMailBody({ url: URL, lastLoginAt: ts });
  assert.ok(body.includes('\nLast sign-in: 2026-05-09T16:57:05.667Z.\n'));
  assert.ok(body.includes("If that wasn't you, do not click the link above."));
});

test('composeMailBody: omits Last-sign-in when lastLoginAt is null', () => {
  const body = composeMailBody({ url: URL, lastLoginAt: null });
  assert.ok(!body.includes('Last sign-in'));
});

test('composeMailBody: footer with stub + rules under -- delimiter', () => {
  const body = composeMailBody({
    url: URL,
    hostedBy: '@terribic',
    feedbackEmail: 'feedback@terribic.com',
    rules: ['be civil.', 'no porn, no illegal content.'],
  });
  assert.ok(body.includes('\n-- \na plato instance hosted by @terribic . feedback@terribic.com\n'));
  assert.ok(body.includes('be civil.'));
  assert.ok(body.includes('no porn, no illegal content.'));
});

test('composeMailBody: stub omitted when neither hostedBy nor feedbackEmail set', () => {
  const body = composeMailBody({ url: URL, rules: ['be civil.'] });
  assert.ok(!body.includes('a plato instance'));
  assert.ok(body.includes('\n-- \nbe civil.\n'));
});

test('composeMailBody: stub uses only hostedBy when feedbackEmail unset', () => {
  const body = composeMailBody({ url: URL, hostedBy: '@terribic', rules: [] });
  assert.ok(body.includes('a plato instance hosted by @terribic\n'));
  assert.ok(!body.includes(' . '));
});

test('composeMailBody: stub uses only feedbackEmail when hostedBy unset', () => {
  const body = composeMailBody({ url: URL, feedbackEmail: 'feedback@x.com', rules: [] });
  assert.ok(body.includes('a plato instance feedback@x.com\n'));
});

test('composeMailBody: no footer block when both stub and rules empty', () => {
  const body = composeMailBody({ url: URL, rules: [] });
  assert.ok(!body.includes('-- '));
});

test('composeMailBody: full email shape matches the documented order', () => {
  const ts = Date.parse('2026-05-09T16:57:05.667Z');
  const body = composeMailBody({
    url: URL,
    lastLoginAt: ts,
    hostedBy: '@terribic',
    feedbackEmail: 'feedback@terribic.com',
    rules: [
      'be civil, especially when disagreeing.',
      'no porn, no illegal content.',
      'no ads, spam, scams, or doxxing.',
      'mods are accountable.',
    ],
  });
  // Verify ordering: warning → click → URL → last-sign-in → -- → footer
  const idxWarning = body.indexOf('This link expires');
  const idxClick = body.indexOf('Click to sign in:');
  const idxUrl = body.indexOf(URL);
  const idxLastLogin = body.indexOf('Last sign-in:');
  const idxDelim = body.indexOf('\n-- \n');
  const idxStub = body.indexOf('a plato instance');
  assert.ok(idxWarning < idxClick);
  assert.ok(idxClick < idxUrl);
  assert.ok(idxUrl < idxLastLogin);
  assert.ok(idxLastLogin < idxDelim);
  assert.ok(idxDelim < idxStub);
});

test('composeMailBody: output stays within knowless bodyOverride caps (≤2048 chars, ASCII)', () => {
  const body = composeMailBody({
    url: URL,
    lastLoginAt: Date.now(),
    hostedBy: '@terribic',
    feedbackEmail: 'feedback@terribic.com',
    rules: [
      'be civil, especially when disagreeing. no racism, sexism, ableism, homophobia, or transphobia.',
      'no porn, no illegal content.',
      'no ads, spam, scams, or doxxing.',
      'mods are accountable; the modlog is public, and votes can reverse soft removes.',
    ],
  });
  assert.ok(body.length <= 2048, `body length ${body.length} exceeds knowless cap`);
  assert.ok(/^[\x00-\x7f]*$/.test(body), 'body contains non-ASCII characters');
  assert.ok(!body.includes('\r'), 'body contains CR (header-injection defense)');
});
