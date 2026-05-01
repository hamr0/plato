#!/usr/bin/env node
// Hourly refresher for the URLhaus blocklist cache.
//
// Wire via system cron:
//   0 * * * * cd /path/to/plato && node bin/refresh-urlhaus.js >> /var/log/plato-urlhaus.log 2>&1
//
// Writes the response body to data/urlhaus.txt (or PLATO_URLHAUS_CACHE
// when set). The plato app reads this file at boot via loadUrlhausCache;
// to pick up a fresh fetch the operator restarts the app — or moves to
// a watcher in a future revision. For an unannounced trial, hourly
// refresh + daily restart is more than sufficient.
//
// We DO NOT fetch from the running app process: a hung HTTP call to a
// third-party would block requests. Cron isolates that surface.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');
const FEED_URL = process.env.PLATO_URLHAUS_FEED ?? 'https://urlhaus.abuse.ch/downloads/text/';
const CACHE_PATH = process.env.PLATO_URLHAUS_CACHE ?? resolve(ROOT, 'data/urlhaus.txt');
const FETCH_TIMEOUT_MS = 30_000;

async function main() {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(FEED_URL, { signal: ctl.signal });
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) {
    console.error(`urlhaus refresh: HTTP ${res.status} from ${FEED_URL}`);
    process.exit(1);
  }
  const body = await res.text();
  // Sanity check: the URLhaus text feed is multi-MB. A near-empty body
  // probably means an upstream outage; refuse to overwrite a good cache.
  if (body.length < 1000) {
    console.error(`urlhaus refresh: response too short (${body.length} bytes); keeping previous cache`);
    process.exit(1);
  }
  mkdirSync(dirname(CACHE_PATH), { recursive: true });
  writeFileSync(CACHE_PATH, body, 'utf8');
  const lineCount = body.split('\n').filter((l) => l && !l.startsWith('#')).length;
  console.log(`urlhaus refresh: wrote ${lineCount} URLs to ${CACHE_PATH}`);
}

main().catch((err) => {
  console.error('urlhaus refresh: failed', err);
  process.exit(1);
});
