import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/index.js';
import { createAuth } from '../src/auth/index.js';
import { loadDisposableDomains } from '../src/content/disposable-domain.js';
import { createMailerTransport } from '../src/mail/transport.js';
import { createApp, resolveBrandingRules } from '../src/web/app.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 8080);
const BASE_URL = process.env.KNOWLESS_BASE_URL ?? `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const POSTS_DIR = process.env.POSTS_DIR ?? resolve(ROOT, 'posts');
const EXPORTS_DIR = process.env.EXPORTS_DIR ?? resolve(ROOT, 'exports');
const DISPOSABLE_PATH = resolve(ROOT, 'disposable-domains.txt');
const CONFIG_PATH = process.env.PLATO_CONFIG ?? resolve(ROOT, 'config.json');
const SPAM_PATTERNS_PATH = process.env.PLATO_SPAM_PATTERNS ?? resolve(ROOT, 'spam-patterns.txt');
const URLHAUS_CACHE_PATH = process.env.PLATO_URLHAUS_CACHE ?? resolve(ROOT, 'data/urlhaus.txt');

// Operator config is optional. When config.json is present, parse it
// and forward to createApp. createApp validates it against the floor
// and throws on illegal values — bad config kills the boot rather
// than silently weakening protections.
const operatorConfig = existsSync(CONFIG_PATH)
  ? JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))
  : {};

const db = openDb(DB_PATH);

// Resolve site rules once at boot so the same text feeds two surfaces:
// (a) the /about page + footer-of-every-page links via createApp, and
// (b) the magic-link email body footer via knowless. Single source of
// truth — operators edit one config field, both surfaces stay in sync.
const brandingRules = resolveBrandingRules(operatorConfig.branding?.rules);

// PLATO_SENDMAIL_PATH=/usr/sbin/sendmail in production .env routes magic-link
// mail through the local sendmail binary (msmtp-mta in our deploy story); the
// relay creds live in /etc/msmtprc, never in plato's process. When the env var
// is unset (dev), this returns null and knowless keeps its SMTP-localhost:1025
// default → fails fast → KNOWLESS_DEV_LOG_LINKS stderr fallback prints the link.
const transportOverride = createMailerTransport(process.env);

const auth = createAuth(process.env, {
  dbPath: process.env.KNOWLESS_DB_PATH ?? resolve(ROOT, 'knowless.db'),
  bodyFooter: brandingRules.length > 0 ? brandingRules.join('\n') : undefined,
  ...(transportOverride ? { transportOverride } : {}),
});
const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);

const handler = createApp({
  db, auth, disposableDomains,
  postsDir: POSTS_DIR, exportsDir: EXPORTS_DIR, baseUrl: BASE_URL,
  rateLimits: operatorConfig.rateLimits ?? {},
  spamPatternsFile: operatorConfig.spamPatternsFile ?? SPAM_PATTERNS_PATH,
  linkCaps: operatorConfig.linkCaps ?? {},
  urlhausCacheFile: operatorConfig.urlhausCacheFile ?? URLHAUS_CACHE_PATH,
  branding: operatorConfig.branding ?? {},
  urlDisplayMax: operatorConfig.urlDisplayMax,
  feedPageSize: operatorConfig.feedPageSize,
  evalBanner: process.env.PLATO_EVAL_BANNER === '1',
});

const server = http.createServer(handler);

server.listen(PORT, () => console.log(`plato on ${BASE_URL}`));

function shutdown() {
  server.close(() => {
    auth.close();
    db.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
