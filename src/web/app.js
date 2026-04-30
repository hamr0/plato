import { html, render, raw } from './templates.js';
import { applyStaticRoute } from './static.js';
import { readBody, parseForm, send, redirect } from './request.js';
import { pseudonymFor } from '../identity/pseudonym.js';
import { avatarSvg } from '../identity/avatar.js';
import {
  submitDraft,
  finalizeDraft,
  getPost,
  listRecentPosts,
} from '../content/post.js';
import { isDisposableEmail } from '../content/disposable-domain.js';

const POST_ID_RE = /^[0-9a-f]{16}$/;
const HANDLE_RE = /^[0-9a-f]{1,128}$/;

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

function relativeTime(ms) {
  const d = Math.floor((Date.now() - ms) / 1000);
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d / 60)}m ago`;
  if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
  return `${Math.floor(d / 86400)}d ago`;
}

function authorMeta(post, pseudonym) {
  return html`<div class="meta">
    <img src="/avatar/${post.handle}.svg" width="18" height="18" alt="">
    <span class="name">${pseudonym}</span>
    <span>· /sub/${post.sub_name}</span>
    <span class="when">· ${relativeTime(post.created_at)}</span>
  </div>`;
}

function pseudonymsByHandle(db, handles) {
  if (handles.length === 0) return new Map();
  const placeholders = handles.map(() => '?').join(',');
  const rows = db
    .prepare(`SELECT handle, pseudonym FROM handles WHERE handle IN (${placeholders})`)
    .all(...handles);
  return new Map(rows.map((r) => [r.handle, r.pseudonym]));
}

function renderHome(req, res, { db, auth }) {
  const posts = listRecentPosts(db, { limit: 50 });
  const handles = [...new Set(posts.map((p) => p.handle))];
  const pseudonyms = pseudonymsByHandle(db, handles);
  const currentHandle = auth.handleFromRequest(req);
  const currentPseudonym = currentHandle ? pseudonymFor(db, currentHandle) : null;

  const loginBar = currentHandle
    ? html`<p class="muted">
        logged in as <strong>${currentPseudonym}</strong>
        <img src="/avatar/${currentHandle}.svg" width="18" height="18" alt="" style="vertical-align:middle">
        — <form method="POST" action="/logout" style="display:inline">
          <button>logout</button>
        </form>
      </p>`
    : html`<p class="muted"><em>fill the form to post — magic-link required, no password, no PII</em></p>`;

  const postRows =
    posts.length === 0
      ? html`<p class="muted">no posts yet — be the first.</p>`
      : posts.map((post) => {
          const name = pseudonyms.get(post.handle) ?? post.handle.slice(0, 8);
          return html`<div class="post">
            <div class="vote">
              <span class="arrow">▲</span>
              <span class="score">0</span>
              <span class="arrow">▼</span>
            </div>
            <div class="body">
              <h2><a href="/post/${post.id}">${post.title}</a></h2>
              ${authorMeta(post, name)}
            </div>
          </div>`;
        });

  send(
    res,
    200,
    layout('plato', html`
      <header>
        <h1>plato · forum</h1>
        <div class="nav muted">a forum that lives at one URL</div>
      </header>
      ${loginBar}
      <h3 class="section">// new post</h3>
      <form method="POST" action="/draft">
        ${currentHandle
          ? html``
          : html`<input name="email" type="email" placeholder="your email (we don't keep it)" required>`}
        <input name="title" placeholder="post title" required>
        <textarea name="body" placeholder="markdown body" required></textarea>
        <button>post</button>
      </form>
      <h3 class="section">// recent</h3>
      ${postRows}
    `)
  );
}

async function handleDraft(req, res, { db, auth, disposableDomains, baseUrl, postsDir }) {
  const body = await readBody(req);
  const form = parseForm(body);
  const { email, title, body: postBody } = form;
  const currentHandle = auth.handleFromRequest(req);

  if (!title || !postBody || (!currentHandle && !email)) {
    return send(
      res,
      400,
      layout(
        'missing fields',
        html`<p class="muted">all fields are required. <a href="/">back</a></p>`
      )
    );
  }

  if (currentHandle) {
    const { draftId } = submitDraft(db, { title, body: postBody });
    const { postId } = finalizeDraft(db, { draftId, handle: currentHandle, postsDir });
    return redirect(res, `/post/${postId}`);
  }

  if (isDisposableEmail(email, disposableDomains)) {
    return send(
      res,
      400,
      layout(
        'rejected',
        html`<p class="muted">disposable email domains aren't accepted. <a href="/">back</a></p>`
      )
    );
  }

  const { draftId } = submitDraft(db, { title, body: postBody });

  await auth.startLogin({
    email,
    nextUrl: `${baseUrl}/draft/${draftId}/finalize`,
    sourceIp: req.socket?.remoteAddress,
  });

  send(
    res,
    200,
    layout(
      'check your email',
      html`
        <header>
          <h1>plato · check your email</h1>
        </header>
        <p>We sent a magic link to <code>${email}</code>. Click it within 15 minutes to publish your post.</p>
        <p class="muted">No account needed. The same email always becomes the same pseudonym + avatar on this instance — that's how identity works here. We never store the email itself, only a one-way hash of it.</p>
        <p class="muted">Your draft is saved server-side until you click. If you don't get the email or the link expires, just <a href="/">post again</a>.</p>
      `
    )
  );
}

function handleFinalize(req, res, { db, auth, postsDir }, draftId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(
      res,
      401,
      layout(
        'not logged in',
        html`<p class="muted">your session expired. <a href="/">post again</a> to get a fresh magic link.</p>`
      )
    );
  }

  let result;
  try {
    result = finalizeDraft(db, { draftId, handle, postsDir });
  } catch (err) {
    if (/draft .* not found/.test(err.message)) {
      return send(res, 404, layout('not found', html`<p class="muted">draft expired or not found.</p>`));
    }
    throw err;
  }

  redirect(res, `/post/${result.postId}`);
}

function renderPost(req, res, { db, postsDir }, postId) {
  const result = getPost(db, postId, postsDir);
  if (!result) {
    return send(res, 404, layout('not found', html`<p class="muted">post not found.</p>`));
  }

  const { post, bodyHtml } = result;
  const pseudonym = pseudonymFor(db, post.handle);

  send(
    res,
    200,
    layout(
      post.title,
      html`
        <p><a href="/">← home</a></p>
        ${authorMeta(post, pseudonym)}
        <h1>${post.title}</h1>
        <article>${raw(bodyHtml)}</article>
      `
    )
  );
}

function renderAvatar(res, handle) {
  if (!HANDLE_RE.test(handle)) {
    return send(res, 400, 'bad handle');
  }
  res.writeHead(200, {
    'Content-Type': 'image/svg+xml; charset=utf-8',
    'Cache-Control': 'public, max-age=86400',
  });
  res.end(avatarSvg(handle));
}

export function createApp({ db, auth, disposableDomains, postsDir, baseUrl }) {
  return async function handler(req, res) {
    try {
      const url = new URL(req.url, baseUrl);
      const path = url.pathname;
      const method = req.method;

      if (await applyStaticRoute(req, res)) return;

      if (path === '/login' && method === 'GET') return auth.loginForm(req, res);
      if (path === '/login' && method === 'POST') return auth.login(req, res);
      if (path === '/auth/callback') return auth.callback(req, res);
      if (path === '/verify') return auth.verify(req, res);
      if (path === '/logout' && method === 'POST') return auth.logout(req, res);

      if (path === '/' && method === 'GET') return renderHome(req, res, { db, auth });
      if (path === '/draft' && method === 'POST') {
        return handleDraft(req, res, { db, auth, disposableDomains, baseUrl, postsDir });
      }

      let m;
      if ((m = path.match(/^\/draft\/([0-9a-f]{16})\/finalize$/)) && method === 'GET') {
        return handleFinalize(req, res, { db, auth, postsDir }, m[1]);
      }
      if ((m = path.match(/^\/post\/([0-9a-f]{16})$/)) && method === 'GET') {
        return renderPost(req, res, { db, postsDir }, m[1]);
      }
      if ((m = path.match(/^\/avatar\/([0-9a-f]+)\.svg$/)) && method === 'GET') {
        return renderAvatar(res, m[1]);
      }

      send(res, 404, layout('not found', html`<p class="muted">not found</p>`));
    } catch (err) {
      console.error(err);
      send(res, 500, '<pre>500</pre>');
    }
  };
}
