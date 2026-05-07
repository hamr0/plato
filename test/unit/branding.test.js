import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveBrandingColors,
  resolveBrandingFeedbackEmail,
  resolveBrandingRules,
  resolveBrandingMetaDescription,
} from '../../src/web/app.js';

test('resolveBrandingColors: no overrides returns nulls', () => {
  const c = resolveBrandingColors({});
  assert.equal(c.up, null);
  assert.equal(c.down, null);
});

test('resolveBrandingColors: valid hex colors accepted', () => {
  const c = resolveBrandingColors({ up: '#7fd962', down: '#73d0ff' });
  assert.equal(c.up, '#7fd962');
  assert.equal(c.down, '#73d0ff');
});

test('resolveBrandingColors: valid rgb() accepted', () => {
  const c = resolveBrandingColors({ up: 'rgb(127, 217, 98)', down: 'rgb(115, 208, 255)' });
  assert.equal(c.up, 'rgb(127, 217, 98)');
});

test('resolveBrandingColors: named color accepted', () => {
  const c = resolveBrandingColors({ up: 'green', down: 'steelblue' });
  assert.equal(c.up, 'green');
});

test('resolveBrandingColors: empty string treated as null', () => {
  const c = resolveBrandingColors({ up: '', down: '' });
  assert.equal(c.up, null);
  assert.equal(c.down, null);
});

test('resolveBrandingColors: semicolon injection throws', () => {
  assert.throws(() => resolveBrandingColors({ up: 'red; --bg: red' }), /invalid characters/);
});

test('resolveBrandingColors: brace injection throws', () => {
  assert.throws(() => resolveBrandingColors({ down: 'red} body{color:red' }), /invalid characters/);
});

test('resolveBrandingColors: non-string throws', () => {
  assert.throws(() => resolveBrandingColors({ up: 123 }), /must be a string/);
});

test('resolveBrandingColors: error message uses field name (light variant uses branding.colorsLight)', () => {
  assert.throws(
    () => resolveBrandingColors({ up: 'red; --bg: red' }, 'branding.colorsLight'),
    /branding\.colorsLight\.up.*invalid characters/,
  );
  assert.throws(
    () => resolveBrandingColors({ down: 99 }, 'branding.colorsLight'),
    /branding\.colorsLight\.down.*must be a string/,
  );
});

test('resolveBrandingColors: light palette validates same shape as dark (both clean)', () => {
  const dark = resolveBrandingColors({ up: '#3fb950', down: '#58a6ff' });
  const light = resolveBrandingColors({ up: '#15803d', down: '#0066cc' }, 'branding.colorsLight');
  assert.equal(dark.up, '#3fb950');
  assert.equal(light.up, '#15803d');
  assert.equal(light.down, '#0066cc');
});

// --- feedbackEmail ---

test('resolveBrandingFeedbackEmail: null/empty returns null', () => {
  assert.equal(resolveBrandingFeedbackEmail(null), null);
  assert.equal(resolveBrandingFeedbackEmail(''), null);
  assert.equal(resolveBrandingFeedbackEmail(undefined), null);
});

test('resolveBrandingFeedbackEmail: valid address accepted', () => {
  assert.equal(resolveBrandingFeedbackEmail('hi@example.com'), 'hi@example.com');
  assert.equal(resolveBrandingFeedbackEmail('  hi@x.test  '), 'hi@x.test');
});

test('resolveBrandingFeedbackEmail: bad shape throws', () => {
  assert.throws(() => resolveBrandingFeedbackEmail('notanemail'), /valid email/);
  assert.throws(() => resolveBrandingFeedbackEmail('a@b'), /valid email/);
  assert.throws(() => resolveBrandingFeedbackEmail('a b@c.d'), /valid email/);
});

test('resolveBrandingFeedbackEmail: quote / CRLF / >120 chars throws', () => {
  assert.throws(() => resolveBrandingFeedbackEmail('"quoted"@x.test'), /valid email/);
  assert.throws(() => resolveBrandingFeedbackEmail(`a@${'x'.repeat(120)}.test`), /≤ 120 chars/);
});

test('resolveBrandingFeedbackEmail: non-string throws', () => {
  assert.throws(() => resolveBrandingFeedbackEmail(42), /must be a string/);
});

// --- rules ---

test('resolveBrandingRules: null/empty-string/[] suppress (operator opt-out)', () => {
  assert.deepEqual(resolveBrandingRules(null), []);
  assert.deepEqual(resolveBrandingRules(''), []);
  assert.deepEqual(resolveBrandingRules([]), []);
});

test('resolveBrandingRules: undefined yields the default rule set', () => {
  const r = resolveBrandingRules(undefined);
  assert.equal(r.length, 4);
  assert.match(r[0], /^be civil/);
  assert.match(r[1], /^no porn/);
  assert.match(r[2], /^no ads/);
  assert.match(r[3], /^mods are accountable/);
});

test('resolveBrandingRules: defaults are ASCII, ≤4 lines, ≤240 chars joined (knowless cap)', () => {
  const r = resolveBrandingRules(undefined);
  assert.ok(r.length <= 4);
  for (const line of r) assert.doesNotMatch(line, /[^\x20-\x7e]/, 'ascii only');
  assert.ok(r.join('\n').length <= 240);
});

test('resolveBrandingRules: valid array accepted, trimmed', () => {
  const r = resolveBrandingRules(['be civil', '  no spam  ', 'no doxxing']);
  assert.deepEqual(r, ['be civil', 'no spam', 'no doxxing']);
});

test('resolveBrandingRules: more than 4 throws', () => {
  assert.throws(() => resolveBrandingRules(['a', 'b', 'c', 'd', 'e']), /at most 4/);
});

test('resolveBrandingRules: non-array throws', () => {
  assert.throws(() => resolveBrandingRules('a, b'), /must be an array/);
});

test('resolveBrandingRules: non-string entry throws', () => {
  assert.throws(() => resolveBrandingRules(['ok', 5]), /must be a string/);
});

test('resolveBrandingRules: empty entry throws', () => {
  assert.throws(() => resolveBrandingRules(['ok', '   ']), /is empty/);
});

test('resolveBrandingRules: newline in entry throws', () => {
  assert.throws(() => resolveBrandingRules(['line one\nline two']), /must be one line/);
});

test('resolveBrandingRules: non-ASCII throws', () => {
  assert.throws(() => resolveBrandingRules(['café']), /ASCII/);
});

test('resolveBrandingRules: http(s) URL throws (footer phishing vector)', () => {
  assert.throws(() => resolveBrandingRules(['see https://evil.example for rules']), /URL/i);
  assert.throws(() => resolveBrandingRules(['HTTP://evil.example']), /URL/i);
});

test('resolveBrandingRules: non-http URI scheme throws', () => {
  assert.throws(() => resolveBrandingRules(['mailto://nope']), /URL/i);
  assert.throws(() => resolveBrandingRules(['data://blob']), /URL/i);
  assert.throws(() => resolveBrandingRules(['javascript://x']), /URL/i);
  assert.throws(() => resolveBrandingRules(['ftp://host']), /URL/i);
});

test('resolveBrandingRules: bare domain throws (mail clients auto-link)', () => {
  assert.throws(() => resolveBrandingRules(['contact us at example.com']), /bare domain/i);
  assert.throws(() => resolveBrandingRules(['evil.io/path']), /bare domain/i);
  assert.throws(() => resolveBrandingRules(['Visit Mailinator.com today']), /bare domain/i);
});

test('resolveBrandingRules: prose without domains/schemes accepted', () => {
  assert.deepEqual(
    resolveBrandingRules(['be civil', 'no spam', 'no doxxing', 'no porn']),
    ['be civil', 'no spam', 'no doxxing', 'no porn'],
  );
});

test('resolveBrandingRules: trim-then-internal-newline still throws', () => {
  // Belt-and-braces: a string with internal newlines but no leading /
  // trailing whitespace tested separately to confirm the .includes()
  // check fires after .trim() (i.e. only end-strips, internal kept).
  assert.throws(() => resolveBrandingRules(['valid first', 'second\nrule']), /must be one line/);
});

test('resolveBrandingRules: DEL (0x7f) and other control chars throw', () => {
  assert.throws(() => resolveBrandingRules(['hi\x7fthere']), /ASCII/);
  assert.throws(() => resolveBrandingRules(['hi\x01there']), /ASCII/);
});

// --- metaDescription ---

test('resolveBrandingMetaDescription: null/empty returns null', () => {
  assert.equal(resolveBrandingMetaDescription(null), null);
  assert.equal(resolveBrandingMetaDescription(''), null);
  assert.equal(resolveBrandingMetaDescription('   '), null);
  assert.equal(resolveBrandingMetaDescription(undefined), null);
});

test('resolveBrandingMetaDescription: valid string accepted, trimmed', () => {
  const r = resolveBrandingMetaDescription('  A short description for the forum.  ');
  assert.equal(r, 'A short description for the forum.');
});

test('resolveBrandingMetaDescription: > 200 chars throws', () => {
  assert.throws(
    () => resolveBrandingMetaDescription('x'.repeat(201)),
    /≤ 200 chars/,
  );
});

test('resolveBrandingMetaDescription: non-ASCII throws', () => {
  assert.throws(() => resolveBrandingMetaDescription('café forum'), /ASCII/);
});

test('resolveBrandingMetaDescription: non-string throws', () => {
  assert.throws(() => resolveBrandingMetaDescription(42), /must be a string/);
});

test('resolveBrandingRules: joined > 240 chars throws', () => {
  const r = ['x'.repeat(60), 'x'.repeat(60), 'x'.repeat(60), 'x'.repeat(60)];
  assert.throws(() => resolveBrandingRules(r), /≤ 240/);
});
