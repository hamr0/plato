import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isBlockedAddress, assertPublicUrl } from '../../src/archive/ssrf.js';

// A stub resolver so these tests never touch real DNS. Maps hostname → list
// of {address} the way dns.lookup(host, {all:true}) returns.
function stubLookup(map) {
  return async (host) => {
    if (!(host in map)) {
      const err = new Error('not found');
      err.code = 'ENOTFOUND';
      throw err;
    }
    return map[host].map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
  };
}

test('isBlockedAddress: loopback / private / link-local / reserved are blocked', () => {
  for (const ip of [
    '127.0.0.1', '127.255.255.254', '10.0.0.5', '172.16.0.1', '172.31.255.255',
    '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '255.255.255.255',
    '224.0.0.1', '240.0.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:169.254.169.254',
  ]) {
    assert.equal(isBlockedAddress(ip), true, `${ip} should be blocked`);
  }
});

test('isBlockedAddress: public addresses are allowed', () => {
  for (const ip of ['8.8.8.8', '1.1.1.1', '93.184.216.34', '2606:2800:220:1::1', '2001:4860:4860::8888']) {
    assert.equal(isBlockedAddress(ip), false, `${ip} should be allowed`);
  }
});

test('isBlockedAddress: garbage fails closed', () => {
  assert.equal(isBlockedAddress('not-an-ip'), true);
  assert.equal(isBlockedAddress(''), true);
});

test('assertPublicUrl: rejects non-http(s) schemes', async () => {
  const lookup = stubLookup({});
  await assert.rejects(() => assertPublicUrl('file:///etc/passwd', { lookup }), /http\(s\)/);
  await assert.rejects(() => assertPublicUrl('gopher://x/', { lookup }), /http\(s\)/);
});

test('assertPublicUrl: rejects hosts resolving to a private address', async () => {
  const lookup = stubLookup({ 'evil.test': ['10.0.0.5'] });
  await assert.rejects(() => assertPublicUrl('https://evil.test/a.tar.gz', { lookup }), /private or reserved/);
});

test('assertPublicUrl: rejects IP-literal loopback / metadata targets', async () => {
  const lookup = stubLookup({ '127.0.0.1': ['127.0.0.1'], '169.254.169.254': ['169.254.169.254'] });
  await assert.rejects(() => assertPublicUrl('http://127.0.0.1:6379/', { lookup }), /private or reserved/);
  await assert.rejects(() => assertPublicUrl('http://169.254.169.254/latest/meta-data/', { lookup }), /private or reserved/);
});

test('assertPublicUrl: rejects when ANY resolved address is private (rebinding guard)', async () => {
  const lookup = stubLookup({ 'mixed.test': ['93.184.216.34', '10.0.0.5'] });
  await assert.rejects(() => assertPublicUrl('https://mixed.test/a.tar.gz', { lookup }), /private or reserved/);
});

test('assertPublicUrl: allows a host resolving only to public addresses', async () => {
  const lookup = stubLookup({ 'good.test': ['93.184.216.34'] });
  const u = await assertPublicUrl('https://good.test/archive.tar.gz', { lookup });
  assert.equal(u.hostname, 'good.test');
});

test('assertPublicUrl: surfaces resolution failure', async () => {
  const lookup = stubLookup({});
  await assert.rejects(() => assertPublicUrl('https://nope.test/a', { lookup }), /could not resolve/);
});
