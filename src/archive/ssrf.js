// SSRF guard for the one place plato makes an outbound HTTP request from
// user-controlled input: the sub-import fetch (bin/run-import-queue.js).
//
// A logged-in user pastes a URL at /sub/create?mode=import; the off-peak
// worker fetches it. Without a guard that URL could point at loopback
// (127.0.0.1:<other-service>), the cloud metadata endpoint
// (169.254.169.254), or any RFC1918 host the box can route to — and the
// fetch-failure reason flows back to the user as a memlog notification,
// turning the importer into a blind-SSRF oracle for internal mapping.
//
// Defense: resolve the hostname and refuse if ANY resolved address is
// private / loopback / link-local / reserved. Callers re-run this on every
// redirect hop (the worker uses redirect: 'manual') so a public URL can't
// 302 into an internal one. Residual: an active DNS-rebinding attacker who
// flips a record between this lookup and the socket connect — out of scope
// at hobby scale, and the archive must still pass Ed25519 verification to
// import anything, so the rebind only buys the (now host-blocked) oracle.

import { BlockList, isIP } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';

// Special-use ranges that must never be the target of an import fetch.
// IPv4 set per IANA special-purpose registry; IPv6 covers loopback,
// unspecified, unique-local (fc00::/7), link-local (fe80::/10), multicast.
const blocked = new BlockList();
blocked.addSubnet('0.0.0.0', 8, 'ipv4');         // "this host"
blocked.addSubnet('10.0.0.0', 8, 'ipv4');        // private
blocked.addSubnet('100.64.0.0', 10, 'ipv4');     // CGNAT
blocked.addSubnet('127.0.0.0', 8, 'ipv4');       // loopback
blocked.addSubnet('169.254.0.0', 16, 'ipv4');    // link-local (incl. 169.254.169.254 metadata)
blocked.addSubnet('172.16.0.0', 12, 'ipv4');     // private
blocked.addSubnet('192.0.0.0', 24, 'ipv4');      // IETF protocol assignments
blocked.addSubnet('192.0.2.0', 24, 'ipv4');      // TEST-NET-1
blocked.addSubnet('192.168.0.0', 16, 'ipv4');    // private
blocked.addSubnet('198.18.0.0', 15, 'ipv4');     // benchmarking
blocked.addSubnet('198.51.100.0', 24, 'ipv4');   // TEST-NET-2
blocked.addSubnet('203.0.113.0', 24, 'ipv4');    // TEST-NET-3
blocked.addSubnet('224.0.0.0', 4, 'ipv4');       // multicast
blocked.addSubnet('240.0.0.0', 4, 'ipv4');       // reserved
blocked.addAddress('255.255.255.255', 'ipv4');   // broadcast
blocked.addAddress('::', 'ipv6');                // unspecified
blocked.addAddress('::1', 'ipv6');               // loopback
blocked.addSubnet('fc00::', 7, 'ipv6');          // unique-local
blocked.addSubnet('fe80::', 10, 'ipv6');         // link-local
blocked.addSubnet('ff00::', 8, 'ipv6');          // multicast

// True when `ip` is a literal in a blocked range (or not a valid IP at all,
// which fails closed). IPv4-mapped IPv6 (::ffff:127.0.0.1) is normalized to
// its embedded IPv4 form so a v4 rule still catches it.
export function isBlockedAddress(ip) {
  const mapped = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(ip);
  const addr = mapped ? mapped[1] : ip;
  const family = isIP(addr);
  if (family === 4) return blocked.check(addr, 'ipv4');
  if (family === 6) return blocked.check(addr, 'ipv6');
  return true;
}

// Parse + validate an outbound import URL. Resolves DNS and throws if the
// scheme isn't http(s) or the host maps to any blocked address. Returns the
// parsed URL on success. `lookup` is injectable for tests.
export async function assertPublicUrl(rawUrl, { lookup = dnsLookup } = {}) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error('import: source URL is not a valid URL'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    throw new Error('import: source URL must be http(s)');
  }
  let addrs;
  try {
    addrs = await lookup(u.hostname, { all: true });
  } catch (err) {
    throw new Error(`import: could not resolve ${u.hostname} (${err.code ?? err.message})`);
  }
  if (!addrs || addrs.length === 0) {
    throw new Error(`import: ${u.hostname} resolved to no addresses`);
  }
  for (const { address } of addrs) {
    if (isBlockedAddress(address)) {
      throw new Error(`import: ${u.hostname} resolves to a private or reserved address — refusing to fetch`);
    }
  }
  return u;
}
