import { test } from 'node:test';
import assert from 'node:assert/strict';
import { html, raw, escapeHTML, render } from '../../src/web/templates.js';

test('escapeHTML escapes special chars', () => {
  assert.equal(escapeHTML('<script>'), '&lt;script&gt;');
  assert.equal(escapeHTML('a & b'), 'a &amp; b');
  assert.equal(escapeHTML(`"don't"`), '&quot;don&#39;t&quot;');
  assert.equal(escapeHTML(null), '');
  assert.equal(escapeHTML(undefined), '');
});

test('html`` escapes interpolated values by default', () => {
  const t = html`<p>${'<bad>'}</p>`;
  assert.equal(render(t), '<p>&lt;bad&gt;</p>');
});

test('raw() opt-out passes through unescaped', () => {
  const t = html`<div>${raw('<b>safe</b>')}</div>`;
  assert.equal(render(t), '<div><b>safe</b></div>');
});

test('arrays of strings escape each item', () => {
  const items = ['<a>', '<b>'];
  const t = html`${items}`;
  assert.equal(render(t), '&lt;a&gt;&lt;b&gt;');
});

test('arrays of raw() pass through', () => {
  const items = [raw('<i>1</i>'), raw('<i>2</i>')];
  const t = html`${items}`;
  assert.equal(render(t), '<i>1</i><i>2</i>');
});

test('nested html`` templates compose', () => {
  const items = ['x', 'y'].map(s => html`<li>${s}</li>`);
  const t = html`<ul>${items}</ul>`;
  assert.equal(render(t), '<ul><li>x</li><li>y</li></ul>');
});

test('null and undefined become empty', () => {
  const t = html`<p>${null}${undefined}</p>`;
  assert.equal(render(t), '<p></p>');
});

test('false is skipped', () => {
  const t = html`<p>${false}</p>`;
  assert.equal(render(t), '<p></p>');
});

test('numbers render as their string form, escaped', () => {
  const t = html`<p>${42}</p>`;
  assert.equal(render(t), '<p>42</p>');
});
