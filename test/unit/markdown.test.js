import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../../src/content/markdown.js';

test('renderMarkdown: empty / non-string input returns empty', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown(undefined), '');
  assert.equal(renderMarkdown(42), '');
});

test('renderMarkdown: headings', () => {
  const out = renderMarkdown('# title\n## sub');
  assert.match(out, /<h1>title<\/h1>/);
  assert.match(out, /<h2>sub<\/h2>/);
});

test('renderMarkdown: bold + italic', () => {
  const out = renderMarkdown('**bold** and *italic*');
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<em>italic<\/em>/);
});

test('renderMarkdown: links', () => {
  const out = renderMarkdown('[click here](https://example.com)');
  assert.match(out, /<a href="https:\/\/example\.com">click here<\/a>/);
});

test('renderMarkdown: inline code', () => {
  const out = renderMarkdown('use `npm test` to run');
  assert.match(out, /<code>npm test<\/code>/);
});

test('renderMarkdown: fenced code block with language', () => {
  const out = renderMarkdown('```js\nconst x = 1;\n```');
  assert.match(out, /<pre>/);
  assert.match(out, /<code class="language-js">/);
  assert.match(out, /const x = 1;/);
});

test('renderMarkdown: unordered list', () => {
  const out = renderMarkdown('- one\n- two\n- three');
  assert.match(out, /<ul>/);
  assert.match(out, /<li>one<\/li>/);
});

test('renderMarkdown: blockquote', () => {
  const out = renderMarkdown('> quoted');
  assert.match(out, /<blockquote>/);
  assert.match(out, /quoted/);
});

test('SECURITY: <script> tag in source is escaped, not executed', () => {
  const out = renderMarkdown('hello <script>alert(1)</script> world');
  assert.doesNotMatch(out, /<script>/, 'no live <script> tag in output');
  assert.match(out, /&lt;script&gt;/, 'script tag rendered as literal text');
});

test('SECURITY: <img onerror> in source is escaped', () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)">');
  assert.doesNotMatch(out, /<img/i, 'no live img tag in output');
  assert.match(out, /&lt;img/, 'img rendered as literal text');
});

test('SECURITY: <iframe> in source is escaped', () => {
  const out = renderMarkdown('<iframe src="https://evil.com"></iframe>');
  assert.doesNotMatch(out, /<iframe/i);
  assert.match(out, /&lt;iframe/);
});

test('SECURITY: arbitrary HTML attributes via raw tags are escaped', () => {
  const out = renderMarkdown('<a href="javascript:alert(1)">click</a>');
  assert.doesNotMatch(out, /href="javascript:/, 'no live anchor injection');
  assert.match(out, /&lt;a href=/);
});

test('SECURITY: HTML inside code blocks renders as literal text (not executed)', () => {
  const out = renderMarkdown('```\n<script>alert(1)</script>\n```');
  assert.doesNotMatch(out, /<script>alert/, 'no live script even in code block');
  assert.match(out, /&lt;script&gt;/);
});

test('SECURITY: HTML in inline code renders as literal text', () => {
  const out = renderMarkdown('use `<script>` carefully');
  assert.doesNotMatch(out, /<code><script>/);
  assert.match(out, /&lt;script&gt;/);
});

test('SECURITY: javascript: URL in markdown link', () => {
  const out = renderMarkdown('[click](javascript:alert(1))');
  assert.doesNotMatch(out, /href="javascript:/, 'javascript: URL must not survive in href');
});

test('SECURITY: data: URL in markdown link is filtered', () => {
  const out = renderMarkdown('[evil](data:text/html,<script>alert(1)</script>)');
  assert.doesNotMatch(out, /href="data:/, 'data: URL must not survive');
});

test('SECURITY: vbscript: URL in markdown link is filtered', () => {
  const out = renderMarkdown('[evil](vbscript:msgbox(1))');
  assert.doesNotMatch(out, /href="vbscript:/);
});

test('SECURITY: file: URL in markdown link is filtered', () => {
  const out = renderMarkdown('[evil](file:///etc/passwd)');
  assert.doesNotMatch(out, /href="file:/);
});

test('renderMarkdown: http(s), mailto, relative, and fragment URLs survive', () => {
  for (const href of ['https://example.com', 'http://example.com', 'mailto:a@b.c', '/relative', './rel', '../up', '#anchor']) {
    const out = renderMarkdown(`[x](${href})`);
    assert.match(out, new RegExp(`href="${href.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}"`), `${href} should survive`);
  }
});

test('PRD: image markdown is rewritten as a link (no inline embeds)', () => {
  const out = renderMarkdown('![cat photo](https://example.com/cat.jpg)');
  assert.doesNotMatch(out, /<img/i, 'no <img> tag should be emitted');
  assert.match(out, /<a href="https:\/\/example\.com\/cat\.jpg">/);
  assert.match(out, /cat photo/);
});

test('PRD: image with javascript: URL is rewritten safely', () => {
  const out = renderMarkdown('![evil](javascript:alert(1))');
  assert.doesNotMatch(out, /<img/i);
  assert.doesNotMatch(out, /href="javascript:/);
});

test('renderMarkdown: deterministic / pure', () => {
  const a = renderMarkdown('# hello\n\nworld **bold**');
  const b = renderMarkdown('# hello\n\nworld **bold**');
  assert.equal(a, b);
});

test('renderMarkdown: paragraphs separated by blank lines', () => {
  const out = renderMarkdown('first\n\nsecond');
  const matches = out.match(/<p>/g) || [];
  assert.equal(matches.length, 2, 'two distinct paragraphs');
});

test('renderMarkdown: GFM line breaks (single newline → <br>)', () => {
  const out = renderMarkdown('one\ntwo');
  assert.match(out, /<br/, 'breaks: true is enabled');
});

test('renderMarkdown: ampersand entities in prose are not double-escaped', () => {
  const out = renderMarkdown('Q&A about R&D');
  // marked's own entity encoding is safe; we don't pre-escape `&`
  assert.match(out, /Q&amp;A about R&amp;D/);
});
