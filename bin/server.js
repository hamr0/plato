import http from 'node:http';
import { html, render } from '../src/web/templates.js';
import { applyStaticRoute } from '../src/web/static.js';

const PORT = Number(process.env.PORT ?? 8080);
const BASE_URL = process.env.KNOWLESS_BASE_URL ?? `http://localhost:${PORT}`;

function layout(title, body) {
  return render(html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<link rel="stylesheet" href="/static/style.css">
</head>
<body>${body}</body>
</html>`);
}

function homePage() {
  return layout('plato', html`
    <header>
      <h1>plato · forum</h1>
      <div class="nav muted">M1 skeleton — no features yet</div>
    </header>
    <h3 class="section">// status</h3>
    <p class="muted">
      Boots, serves <code>/static/style.css</code>, escapes templates correctly.
      Add M1 features per <code>docs/01-product/build-plan.md</code>.
    </p>
    <h3 class="section">// next</h3>
    <ul class="muted">
      <li>Fill <code>src/db/migrations/001_initial.sql</code> with the M1 schema</li>
      <li>Run <code>npm run migrate</code></li>
      <li>Wire knowless in <code>src/auth/</code></li>
      <li>Build the post + draft + finalize flow in <code>src/content/</code></li>
      <li>Build pseudonym + identicon helpers in <code>src/identity/</code></li>
    </ul>
  `);
}

const server = http.createServer(async (req, res) => {
  try {
    if (await applyStaticRoute(req, res)) return;

    if (req.url === '/' && req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(homePage());
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(layout('not found', html`<p class="muted">not found</p>`));
  } catch (err) {
    console.error(err);
    res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('500');
  }
});

server.listen(PORT, () => console.log(`plato-forum on ${BASE_URL}`));

process.on('SIGINT', () => { server.close(() => process.exit(0)); });
