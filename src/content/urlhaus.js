// URLhaus blocklist matcher — PRD §Spam Defenses 6 (link cap source list)
// and §6 ("every URL is checked against a maintained malicious-domain
// list before the post is accepted").
//
// URLhaus is a free, community-maintained blocklist of malware URLs at
// urlhaus.abuse.ch. Their text feed at
// https://urlhaus.abuse.ch/downloads/text/ is one URL per line plus a
// few `#` header comments. The feed updates hourly.
//
// Plato pulls the feed via a separate cron script (bin/refresh-urlhaus.js)
// and writes it to a local cache file. This module reads the cache at
// boot, builds a Set of hostnames, and exposes a matcher that the
// post-publish path consults: matched posts get collapsed + flagged
// using the same system-handle pipeline as the spam regex pattern file.
//
// Why match by host (not by exact URL):
// - Malware operators rotate paths under the same host within an hour.
// - URLhaus already has plenty of host coverage; a host hit is a strong
//   signal even if the specific URL isn't listed yet.
// - False positives would require a legitimate site to share a host
//   with a known malware URL, which is rare; if it happens, the operator
//   can append the host to a local allow-list (future feature).

import { existsSync, readFileSync } from 'node:fs';

// Extract hostname (lowercased, no leading 'www.') from a URL string.
// Returns null if the input isn't a parseable absolute URL.
function hostOf(url) {
  try {
    const u = new URL(url);
    return u.hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function loadUrlhausCache(filePath) {
  if (!filePath || !existsSync(filePath)) return new Set();
  const raw = readFileSync(filePath, 'utf8');
  const hosts = new Set();
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const host = hostOf(trimmed);
    if (host) hosts.add(host);
  }
  return hosts;
}

// Pull every absolute URL out of `text` and return the array of host
// strings whose hosts are in the blocklist. Empty array means clean.
const URL_RE = /https?:\/\/[^\s)\]]+/gi;

// Same shape as applySpamMatches in spamPatterns.js, but with a
// distinct note prefix so mods can tell URLhaus hits from regex hits
// at a glance in /modlog open mode. The UNIQUE constraint on flags
// dedupes per (target, flagger) — if a target already has a
// system-handle flag (from a prior spam-regex match in the same
// publish), this insert is a no-op. Acceptable: the post is already
// in the queue.
import { randomBytes } from 'node:crypto';
import { SYSTEM_HANDLE } from './spamPatterns.js';

export function applyUrlhausMatches(db, { targetType, targetId, matchedHosts, now = Date.now() }) {
  if (!matchedHosts || matchedHosts.length === 0) return { hidden: false };
  const table = targetType === 'post' ? 'posts' : 'comments';
  db.prepare(`UPDATE ${table} SET collapsed_at = ?, score_at_collapse = score WHERE id = ? AND collapsed_at IS NULL`)
    .run(now, targetId);
  const id = randomBytes(8).toString('hex');
  const note = `blocked-url: ${matchedHosts.join(', ')}`;
  db.prepare(
    `INSERT OR IGNORE INTO flags
       (id, target_type, target_id, flagger_handle, category, note, created_at)
     VALUES (?, ?, ?, ?, 'spam', ?, ?)`
  ).run(id, targetType, targetId, SYSTEM_HANDLE, note, now);
  return { hidden: true, matchedHosts };
}

export function matchUrlhaus(text, hostSet) {
  if (!text || !hostSet || hostSet.size === 0) return [];
  const urls = text.match(URL_RE) ?? [];
  const matched = new Set();
  for (const u of urls) {
    const host = hostOf(u);
    if (host && hostSet.has(host)) matched.add(host);
  }
  return [...matched];
}
