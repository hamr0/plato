import http from 'node:http';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db/index.js';
import { createAuth } from '../src/auth/index.js';
import { loadDisposableDomains } from '../src/content/disposable-domain.js';
import { createApp } from '../src/web/app.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..');

const PORT = Number(process.env.PORT ?? 8080);
const BASE_URL = process.env.KNOWLESS_BASE_URL ?? `http://localhost:${PORT}`;
const DB_PATH = process.env.DB_PATH ?? resolve(ROOT, 'forum.db');
const POSTS_DIR = resolve(ROOT, 'posts');
const DISPOSABLE_PATH = resolve(ROOT, 'disposable-domains.txt');

const db = openDb(DB_PATH);
const auth = createAuth(process.env, {
  dbPath: process.env.KNOWLESS_DB_PATH ?? resolve(ROOT, 'knowless.db'),
});
const disposableDomains = loadDisposableDomains(DISPOSABLE_PATH);

const handler = createApp({ db, auth, disposableDomains, postsDir: POSTS_DIR, baseUrl: BASE_URL });

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
