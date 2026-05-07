import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateSubName, validateStickyNote, RESERVED_SUB_NAMES, STICKY_NOTE_MAX } from '../../src/content/sub.js';

test('validateSubName: accepts typical names', () => {
  validateSubName('cooking');
  validateSubName('home-improvement');
  validateSubName('subsubsub');
  validateSubName('1234');
  validateSubName('a-b-c');
});

test('validateSubName: rejects names < 3 chars', () => {
  assert.throws(() => validateSubName('a'), /3.*30/);
  assert.throws(() => validateSubName('ab'), /3.*30/);
});

test('validateSubName: accepts exactly 3 chars', () => {
  validateSubName('abc');
  validateSubName('a1b');
});

test('validateSubName: rejects > 30 chars', () => {
  assert.throws(() => validateSubName('a'.repeat(31)), /3.*30/);
});

test('validateSubName: accepts exactly 30 chars', () => {
  validateSubName('a'.repeat(30));
});

test('validateSubName: rejects uppercase', () => {
  assert.throws(() => validateSubName('Cooking'), /lowercase/);
  assert.throws(() => validateSubName('cookING'), /lowercase/);
});

test('validateSubName: rejects underscores, dots, slashes, spaces', () => {
  assert.throws(() => validateSubName('home_improvement'), /lowercase/);
  assert.throws(() => validateSubName('cool.sub'), /lowercase/);
  assert.throws(() => validateSubName('a/b'), /lowercase/);
  assert.throws(() => validateSubName('with space'), /lowercase/);
});

test('validateSubName: rejects leading/trailing hyphen', () => {
  assert.throws(() => validateSubName('-cooking'), /lowercase/);
  assert.throws(() => validateSubName('cooking-'), /lowercase/);
});

test('validateSubName: rejects each reserved name', () => {
  for (const reserved of RESERVED_SUB_NAMES) {
    assert.throws(() => validateSubName(reserved), /reserved/, `${reserved} should be reserved`);
  }
});

test('validateSubName: rejects non-strings', () => {
  assert.throws(() => validateSubName(123), /string/);
  assert.throws(() => validateSubName(null), /string/);
  assert.throws(() => validateSubName(undefined), /string/);
});

test('validateStickyNote: accepts null/undefined as empty string', () => {
  assert.equal(validateStickyNote(null), '');
  assert.equal(validateStickyNote(undefined), '');
});

test('validateStickyNote: accepts a typical short paragraph', () => {
  assert.equal(validateStickyNote('hi mods here, **read the rules**'), 'hi mods here, **read the rules**');
});

test(`validateStickyNote: accepts exactly ${STICKY_NOTE_MAX} chars`, () => {
  validateStickyNote('a'.repeat(STICKY_NOTE_MAX));
});

test(`validateStickyNote: rejects > ${STICKY_NOTE_MAX} chars`, () => {
  assert.throws(() => validateStickyNote('a'.repeat(STICKY_NOTE_MAX + 1)), /≤ 200/);
});

test('validateStickyNote: rejects non-strings', () => {
  assert.throws(() => validateStickyNote(123), /must be a string/);
  assert.throws(() => validateStickyNote({}), /must be a string/);
});
