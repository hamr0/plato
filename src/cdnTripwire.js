import { BlockList, isIP } from 'node:net';

export const CLOUDFLARE_RANGES = Object.freeze({
  v4: Object.freeze([
    '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
    '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
    '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
    '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  ]),
  v6: Object.freeze([
    '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
    '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
  ]),
});

const blockList = new BlockList();
for (const cidr of CLOUDFLARE_RANGES.v4) {
  const [net, bits] = cidr.split('/');
  blockList.addSubnet(net, Number(bits), 'ipv4');
}
for (const cidr of CLOUDFLARE_RANGES.v6) {
  const [net, bits] = cidr.split('/');
  blockList.addSubnet(net, Number(bits), 'ipv6');
}

export function isCloudflareIp(ip) {
  if (typeof ip !== 'string') return false;
  const bare = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const family = isIP(bare);
  if (!family) return false;
  return blockList.check(bare, family === 4 ? 'ipv4' : 'ipv6');
}

const WINDOW_MS = 24 * 60 * 60 * 1000;

// Warns (at most once per window per process) when the resolved client IP is a
// Cloudflare edge: nginx isn't unwrapping CF-Connecting-IP, so every per-IP cap
// is shared across the whole CDN. Never throws, never alters the request.
export function makeCdnTripwire(captureError) {
  let lastWarnAt = -Infinity;
  return function check(ip, now = Date.now()) {
    try {
      if (!captureError || !isCloudflareIp(ip)) return;
      if (now - lastWarnAt < WINDOW_MS) return;
      lastWarnAt = now;
      captureError(new Error('client IP is a Cloudflare edge address; nginx realip is not configured, per-IP caps are collapsed (or a Cloudflare WARP user posted; check the access log before assuming nginx is broken)'), { where: 'cdn-tripwire', level: 'warning' });
    } catch { /* tripwire must never affect the request */ }
  };
}
