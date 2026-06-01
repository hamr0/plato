#!/usr/bin/env node
// Generates pulselog.config.json from plato's config.json — single source of
// truth, so the operator email / base URL / service name live in one place and
// flow into the watcher's three modes (health · digest · backup). pulselog is
// the external sibling to flightlog: flightlog records errors from *inside* the
// app; pulselog probes it from *outside* on a schedule. plato ships it on by
// default with safe defaults that mirror the bespoke scripts it replaces
// (health-watch.sh / stats-weekly.js / backup.sh).
//
// Run at deploy (after config.json is written), loading .env so KNOWLESS_BASE_URL
// / PORT are visible:
//   node --env-file=.env bin/gen-pulselog-config.js
//
// Off switch: set "operator": { "monitoring": false } in config.json — this
// writes nothing and the deploy skips the timers. Default (absent/true) = on.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const CONFIG_PATH = process.env.PLATO_CONFIG ?? resolve(ROOT, 'config.json');
const OUT_PATH = process.env.PLATO_PULSELOG_CONFIG ?? resolve(ROOT, 'pulselog.config.json');

const config = existsSync(CONFIG_PATH)
  ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  : {};

const operator = config.operator ?? {};
const branding = config.branding ?? {};

// Off switch — a single declarative field. Default on (absent or anything but
// an explicit false).
if (operator.monitoring === false) {
  console.log('[gen-pulselog] operator.monitoring is false — monitoring disabled, no config written.');
  process.exit(0);
}

const email = operator.email || '';        // omit alerts/digest/backup mail if unset (pulselog → log-only)
const service = operator.service || 'plato';
const forumName = branding.forumName || service;

// Two operator-tunable thresholds. pulselog's baked defaults (7 daily backups,
// 90% disk) suit hobby-scale, so these stay unset for almost everyone — they
// exist for the small-disk / deep-history operator. Validated as a deploy
// boundary: a bad value fails the deploy loudly rather than writing a broken
// monitor (e.g. keepLast:0 would wipe every backup — pulselog requires >= 1).
function intOption(raw, fallback, label, min, max) {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < min || raw > max) {
    console.error(`[gen-pulselog] ${label} must be an integer in [${min}..${max}] — got ${JSON.stringify(raw)}`);
    process.exit(1);
  }
  return raw;
}
const keepLast = intOption(operator.backupKeepLast, 7, 'operator.backupKeepLast', 1, 365);
const diskMaxPercent = intOption(operator.diskMaxPercent, 90, 'operator.diskMaxPercent', 50, 99);

// NB: no TLS-cert check here on purpose. pulselog health runs every 5 min and
// re-emails every run while a check fails — fine for acute checks (app down,
// disk full), but a cert at <warnDays would email every 5 min for ~2 weeks.
// Cert expiry is slow-moving and stays on bin/check-cert.sh (daily, graduated
// severity). The health http probe hits *localhost* — it tests the app process
// directly, not DNS/TLS/nginx.
const PORT = Number(process.env.PORT ?? 8080);
const DATA = resolve(ROOT, 'data');
const LOGS = resolve(DATA, 'logs');
const BACKUP_DIR = process.env.BACKUP_DIR ?? resolve(DATA, 'backups');
const ERRORS_JSONL = process.env.PLATO_FLIGHTLOG_FILE ?? resolve(LOGS, 'errors.jsonl');
const FORUM_DB = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const KNOWLESS_DB = process.env.KNOWLESS_DB_PATH ?? resolve(ROOT, 'knowless.db');
const POSTS_DIR = process.env.POSTS_DIR ?? resolve(ROOT, 'posts');
const SPAM_PATTERNS = process.env.PLATO_SPAM_PATTERNS ?? resolve(ROOT, 'spam-patterns.txt');

// Mail block reused by all three modes — omit entirely when no operator email
// (pulselog then logs the JSONL line and sends nothing). from === to so the
// send aligns with the operator's own authenticated MTA identity (the msmtp →
// Gmail recipe in pulselog.context.md).
const mail = email ? { email, from: email } : {};

const pulselogConfig = {
  // --- health (default mode): silent on green, one email when something breaks
  output: { file: resolve(LOGS, 'health.jsonl'), maxBytes: 5_000_000 },
  alert: { ...mail, app: service, logTail: ERRORS_JSONL },
  retry: { retries: 2, retryDelayMs: 2000 },
  checks: [
    { type: 'http', name: 'app', enabled: true, url: `http://127.0.0.1:${PORT}/healthz`, expectStatus: 200 },
    { type: 'disk', name: 'disk', enabled: true, path: DATA, maxPercent: diskMaxPercent },
    { type: 'file-age', name: 'backup', enabled: true, path: BACKUP_DIR, maxAgeHours: 48, pattern: '.tar.gz', recursive: false },
    { type: 'service', name: 'service', enabled: true, unit: `${service}.service` },
  ],

  // --- digest (--digest): weekly stats email + flightlog error rollup
  digest: {
    ...mail,
    app: forumName,
    history: resolve(LOGS, 'stats.jsonl'),
    weeks: 4,
    metricsCommand: { command: 'node', args: ['bin/stats.js', '--metrics-json'] },
    metrics: [{ name: 'users' }, { name: 'subs' }, { name: 'posts' }, { name: 'comments' }, { name: 'votes' }],
    flightlog: { file: ERRORS_JSONL, groupBy: 'proc', flagAtLeast: 20 },
  },

  // --- backup (--backup): nightly archive, scope mirrors the retired backup.sh
  backup: {
    ...mail,
    app: service,
    dir: BACKUP_DIR,
    name: `${service}-backup`,
    db: [
      { engine: 'sqlite', path: FORUM_DB, name: 'forum' },
      { engine: 'sqlite', path: KNOWLESS_DB, name: 'knowless', optional: true },
    ],
    include: [
      { path: POSTS_DIR, optional: true },
      { path: CONFIG_PATH, optional: true },
      { path: SPAM_PATTERNS, optional: true },
    ],
    keepLast,
    minBytes: 1024,
    history: resolve(LOGS, 'backup.jsonl'),
  },
};

writeFileSync(OUT_PATH, JSON.stringify(pulselogConfig, null, 2) + '\n');
console.log(`[gen-pulselog] wrote ${OUT_PATH}` +
  (email ? ` (alerts → ${email})` : ' (no operator.email — pulselog will log-only, no mail)'));
