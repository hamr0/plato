// Small HTTP request/response helpers used by the route handlers in app.js.
// Pure functions where possible; the only stateful bit is readBody (reads
// the request stream once, returns the body as a string).

export async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
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
    ...headers,
  });
  res.end(body);
}

export function redirect(res, location, status = 302) {
  res.writeHead(status, { Location: location });
  res.end();
}
