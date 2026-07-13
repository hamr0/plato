// Small HTTP request/response helpers used by the route handlers in app.js.
// Pure functions where possible; the only stateful bit is readBody (reads
// the request stream once, returns the body as a string).

// Hard ceiling on a buffered request body. The largest legitimate POST is a
// post/comment submission — BODY_MAX is 40 000 chars plus form-field overhead —
// so 1 MiB is ~25x headroom and still small enough that many concurrent maxed
// bodies can't exhaust the single process. Without a cap, `readBody` buffers
// the whole stream: an unauthenticated `POST /login` or `/draft` with a
// multi-GB body is a trivial memory-exhaustion DoS. On overflow we destroy the
// socket and throw; the dispatch try/catch turns it into a 500 for the abuser.
export const MAX_BODY_BYTES = 1024 * 1024;

export async function readBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new Error('readBody: request body exceeds limit');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export function parseForm(body) {
  return Object.fromEntries(new URLSearchParams(body));
}

export function parseCookie(header) {
  if (typeof header !== 'string' || header.length === 0) return {};
  const out = {};
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const name = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (name) out[name] = value;
  }
  return out;
}

export function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Content-Type': 'text/html; charset=utf-8',
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location, 'Cache-Control': 'no-store' });
  res.end();
}
