import { readFile, stat } from 'node:fs/promises';
import { resolve, join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const STATIC_ROOT = resolve(fileURLToPath(import.meta.url), '../static');

const TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.txt': 'text/plain; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
};

export async function applyStaticRoute(req, res) {
  if (!req.url.startsWith('/static/') || req.method !== 'GET') return false;
  const rel = normalize(req.url.slice('/static/'.length));
  if (rel.startsWith('..') || rel.startsWith('/')) {
    res.writeHead(403);
    res.end('forbidden');
    return true;
  }
  const path = join(STATIC_ROOT, rel);
  try {
    const s = await stat(path);
    if (!s.isFile()) {
      res.writeHead(404);
      res.end('not found');
      return true;
    }
    const buf = await readFile(path);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buf);
    return true;
  } catch (e) {
    if (e.code === 'ENOENT') {
      res.writeHead(404);
      res.end('not found');
      return true;
    }
    throw e;
  }
}
