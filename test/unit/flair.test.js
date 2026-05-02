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
    { slug: 'meta',      label: 'meta',      color: 'rgb(127, 217, 98)' },
  ];
  assert.deepEqual(parseFlairs(JSON.stringify(flairs)), flairs);
});

test('parseFlairs: trims label and color whitespace', () => {
  const out = parseFlairs(JSON.stringify([{ slug: 'a', label: '  news  ', color: '  #fff  ' }]));
  assert.equal(out[0].label, 'news');
  assert.equal(out[0].color, '#fff');
});

test('parseFlairs: malformed JSON throws', () => {
  assert.throws(() => parseFlairs('{not json'), /malformed/);
});

test('parseFlairs: non-array throws', () => {
  assert.throws(() => parseFlairs('{"a":1}'), /must be an array/);
});

test('parseFlairs: too many flairs throws', () => {
  const many = Array.from({ length: MAX_FLAIRS_PER_SUB + 1 }, (_, i) => ({
    slug: `f${i}`, label: `f${i}`, color: '#fff',
  }));
  assert.throws(() => parseFlairs(JSON.stringify(many)), /max 12/);
});

test('parseFlairs: duplicate slugs throw', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([
      { slug: 'a', label: 'A', color: '#fff' },
      { slug: 'a', label: 'A2', color: '#000' },
    ])),
    /duplicated/
  );
});

test('parseFlairs: bad slug format throws', () => {
  assert.throws(() => parseFlairs(JSON.stringify([{ slug: 'BadCaps', label: 'x', color: '#fff' }])), /slug/);
  assert.throws(() => parseFlairs(JSON.stringify([{ slug: '-leading', label: 'x', color: '#fff' }])), /slug/);
  assert.throws(() => parseFlairs(JSON.stringify([{ slug: 'a'.repeat(21), label: 'x', color: '#fff' }])), /slug/);
});

test('parseFlairs: label too long throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x'.repeat(25), color: '#fff' }])),
    /label/
  );
});

test('parseFlairs: empty label throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: '', color: '#fff' }])),
    /label/
  );
});

test('parseFlairs: CSS injection in color throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x', color: 'red; --bg: red' }])),
    /invalid characters/
  );
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x', color: 'red} body{color:red' }])),
    /invalid characters/
  );
});

test('parseFlairs: missing color throws', () => {
  assert.throws(
    () => parseFlairs(JSON.stringify([{ slug: 'a', label: 'x', color: '' }])),
    /color/
  );
});

test('serializeFlairs: validates before stringifying', () => {
  assert.throws(() => serializeFlairs([{ slug: 'BAD', label: 'x', color: '#fff' }]), /slug/);
});

test('validateFlair: index appears in error', () => {
  assert.throws(() => validateFlair({ slug: 'BAD', label: 'x', color: '#fff' }, 3), /flair\[3\]/);
});
