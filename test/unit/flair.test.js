import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFlairs,
  serializeFlairs,
  validateFlair,
  MAX_FLAIRS_PER_SUB,
} from '../../src/content/flair.js';

test('parseFlairs: empty defaults to []', () => {
  assert.deepEqual(parseFlairs(''), []);
  assert.deepEqual(parseFlairs(null), []);
  assert.deepEqual(parseFlairs('[]'), []);
});

test('parseFlairs: valid array roundtrips', () => {
  const flairs = [
    { slug: 'news',      label: 'news',      color: '#58a6ff' },
    { slug: 'meta',      label: 'meta',      color: '#3FB950' },
  ];
  assert.deepEqual(parseFlairs(JSON.stringify(flairs)), flairs);
});

test('parseFlairs: trims label and color whitespace', () => {
  const out = parseFlairs(JSON.stringify([{ slug: 'a', label: '  news  ', color: '  #ffffff  ' }]));
  assert.equal(out[0].label, 'news');
  assert.equal(out[0].color, '#ffffff');
});

test('parseFlairs: malformed JSON throws', () => {
  assert.throws(() => parseFlairs('{not json'), /malformed/);
});

test('parseFlairs: non-array throws', () => {
  assert.throws(() => parseFlairs('{"a":1}'), /must be an array/);
});

test('parseFlairs: too many flairs throws', () => {
  const many = Array.from({ length: MAX_FLAIRS_PER_SUB + 1 }, (_, i) => ({
    slug: `f${i}`, label: `f${i}`, color: '#ffffff',
  }));
  assert.throws(() => parseFlairs(JSON.stringify(many)), new RegExp(`max ${MAX_FLAIRS_PER_SUB}`));
});

test('parseFlairs: duplicate slugs throw', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([
      { slug: 'a', label: 'A', color: '#ffffff' },
      { slug: 'a', label: 'A2', color: '#000000' },
    ])),
    /duplicated/
  );
});

test('parseFlairs: bad slug format throws', () => {
  assert.throws(() => parseFlairs(JSON.stringify([{ slug: 'BadCaps', label: 'x', color: '#ffffff' }])), /slug/);
  assert.throws(() => parseFlairs(JSON.stringify([{ slug: '-leading', label: 'x', color: '#ffffff' }])), /slug/);
  assert.throws(() => parseFlairs(JSON.stringify([{ slug: 'a'.repeat(21), label: 'x', color: '#ffffff' }])), /slug/);
});

test('parseFlairs: label too long throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x'.repeat(25), color: '#ffffff' }])),
    /label/
  );
});

test('parseFlairs: empty label throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: '', color: '#ffffff' }])),
    /label/
  );
});

test('parseFlairs: non-hex color throws', () => {
  // Hex-only allowlist rejects every CSS-injection vector by construction
  // (no semicolons, braces, or parens can match `^#[0-9a-f]{6}$`), plus
  // named colors and rgb()/hsl() functions that the form never emits.
  for (const bad of [
    'red; --bg: red',
    'red} body{color:red',
    'rgb(127, 217, 98)',
    'tomato',
    '#fff',          // 3-digit shorthand: form always emits 6
    '#1234567',      // 7 digits
    '58a6ff',        // missing #
  ]) {
    assert.throws(
      () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x', color: bad }])),
      /must be a 6-digit hex/,
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test('parseFlairs: missing color throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x', color: '' }])),
    /must be a 6-digit hex/
  );
});

test('serializeFlairs: validates before stringifying', () => {
  assert.throws(() => serializeFlairs([{ slug: 'BAD', label: 'x', color: '#ffffff' }]), /slug/);
});

test('validateFlair: index appears in error', () => {
  assert.throws(() => validateFlair({ slug: 'BAD', label: 'x', color: '#ffffff' }, 3), /flair\[3\]/);
});
