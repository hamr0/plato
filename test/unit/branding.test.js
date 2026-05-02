import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveBrandingColors } from '../../src/web/app.js';

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
