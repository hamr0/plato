import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readBody, parseForm, parseCookie, send, redirect } from '../../src/web/request.js';

class MockResponse {
  constructor() {
    this.statusCode = null;
    this.headers = {};
    this.body = '';
    this.ended = false;
  }
  writeHead(status, headers) {
    this.statusCode = status;
    if (headers) Object.assign(this.headers, headers);
  }
  end(body) {
    if (body !== undefined) this.body = body;
    this.ended = true;
  }
}

test('readBody: collects chunks into a string', async () => {
  const req = Readable.from([Buffer.from('hello '), Buffer.from('world')]);
  assert.equal(await readBody(req), 'hello world');
});

test('readBody: handles empty body', async () => {
  const req = Readable.from([]);
  assert.equal(await readBody(req), '');
});

test('parseForm: parses URL-encoded form body', () => {
  assert.deepEqual(
    parseForm('email=a%40b.com&title=hello&body=world'),
    { email: 'a@b.com', title: 'hello', body: 'world' }
  );
});

test('parseForm: empty body returns empty object', () => {
  assert.deepEqual(parseForm(''), {});
});

test('parseCookie: parses simple cookie header', () => {
  assert.deepEqual(
    parseCookie('session=abc; theme=dark'),
    { session: 'abc', theme: 'dark' }
  );
});

test('parseCookie: handles values with =', () => {
  assert.deepEqual(
    parseCookie('token=a=b=c'),
    { token: 'a=b=c' }
  );
});

test('parseCookie: tolerates malformed input', () => {
  assert.deepEqual(parseCookie(null), {});
  assert.deepEqual(parseCookie(undefined), {});
  assert.deepEqual(parseCookie(''), {});
  assert.deepEqual(parseCookie('no-equals'), {});
});

test('send: writes status, default text/html, body, ends', () => {
  const res = new MockResponse();
  send(res, 200, '<p>hi</p>');
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
  assert.equal(res.body, '<p>hi</p>');
  assert.equal(res.ended, true);
});

test('send: extra headers merge with content-type', () => {
  const res = new MockResponse();
  send(res, 200, 'x', { 'X-Custom': 'yes' });
  assert.equal(res.headers['X-Custom'], 'yes');
  assert.equal(res.headers['Content-Type'], 'text/html; charset=utf-8');
});

test('send: extra headers can override content-type', () => {
  const res = new MockResponse();
  send(res, 200, '{}', { 'Content-Type': 'application/json' });
  assert.equal(res.headers['Content-Type'], 'application/json');
});

test('redirect: 302 with Location, ends', () => {
  const res = new MockResponse();
  redirect(res, '/foo');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, '/foo');
  assert.equal(res.ended, true);
});

test('redirect: custom status (301, 303, etc.)', () => {
  const res = new MockResponse();
  redirect(res, '/foo', 303);
  assert.equal(res.statusCode, 303);
});
