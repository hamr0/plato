import { test } from 'node:test';
import assert from 'node:assert/strict';
import { avatarSvg } from '../../src/identity/avatar.js';

test('avatarSvg: returns SVG string', () => {
  const svg = avatarSvg('any-handle');
  assert.equal(typeof svg, 'string');
  assert.match(svg, /^<svg/, 'starts with <svg');
  assert.match(svg, /<\/svg>$/, 'ends with </svg>');
});

test('avatarSvg: deterministic for same handle', () => {
  assert.equal(avatarSvg('handle-x'), avatarSvg('handle-x'));
});

test('avatarSvg: different handles produce different SVGs', () => {
  assert.notEqual(avatarSvg('handle-a'), avatarSvg('handle-b'));
});

test('avatarSvg: size parameter is reflected in output', () => {
  const small = avatarSvg('h', 16);
  const big = avatarSvg('h', 128);
  assert.match(small, /width="16"/);
  assert.match(big, /width="128"/);
});

test('avatarSvg: default size is 32', () => {
  const svg = avatarSvg('h');
  assert.match(svg, /width="32"/);
});
