import { html, render, raw } from './templates.js';
import { applyStaticRoute } from './static.js';
import { readBody, parseForm, send, redirect } from './request.js';
import { pseudonymFor } from '../identity/pseudonym.js';
import { avatarSvg } from '../identity/avatar.js';
import {
  submitDraft,
  finalizeDraft,
  getPost,
  getPostPreview,
  listRecentPostsCappedPerSub,
  listPostsInSub,
} from '../content/post.js';
import {
  createSub,
  getSubByName,
  listActiveSubs,
  validateSubName,
  RESERVED_SUB_NAMES,
} from '../content/sub.js';
import { isDisposableEmail } from '../content/disposable-domain.js';

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
    <span>· <a href="/sub/${post.sub_name}">/sub/${post.sub_name}</a></span>
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

// PRD §Permanently out: no default catch-all sub. The legacy 'general' row
// from the M1 schema is hidden from pickers; existing posts at /sub/general
// remain readable for archaeology, but new posts can't land there.
function listPostableSubs(db) {
  return db.prepare(
    "SELECT name FROM subs WHERE name != 'general' ORDER BY name ASC"
  ).all();
}

function loginStatusFor(db, currentHandle) {
  if (!currentHandle) return html``;
  const pseudonym = pseudonymFor(db, currentHandle);
  return html`<div class="status muted">
    <img src="/avatar/${currentHandle}.svg" width="16" height="16" alt="">
    <strong>${pseudonym}</strong>
    <form method="POST" action="/logout" class="inline">
      <button class="link">logout</button>
    </form>
  </div>`;
}

function anonHintFor(currentHandle) {
  return currentHandle
    ? html``
    : html`<p class="muted"><em>fill the form to post — magic-link required, no password, no PII</em></p>`;
}

function siteHeader({ db, currentHandle, title, subtitle }) {
  return html`<header class="site">
    <div class="brand">
      <h1>${title ?? html`plato · forum`}</h1>
      ${subtitle ? html`<div class="nav muted">${subtitle}</div>` : html``}
    </div>
    ${loginStatusFor(db, currentHandle)}
  </header>`;
}

function postFormFor({ currentHandle, defaultSub, postableSubs }) {
  // No default catch-all sub — every post must pick a sub with a real owner.
  // When a sub is contextually fixed (the sub page itself), the picker is
  // hidden and pinned. Otherwise both anon and logged-in users see a real
  // dropdown. If postableSubs is empty, render an empty state instead of
  // the form: posting requires creating the first sub.
  if (!defaultSub && postableSubs.length === 0) {
    return html`<p class="muted">
      no subs to post in yet. ${currentHandle
        ? html`<a href="/sub/create">create the first one</a> to get started.`
        : html`a logged-in user must <a href="/sub/create">create a sub</a> first.`}
    </p>`;
  }

  let subField;
  if (defaultSub) {
    subField = html`<input type="hidden" name="sub_name" value="${defaultSub}">`;
  } else {
    subField = html`<select name="sub_name" required>
      ${postableSubs.map((s) => html`<option value="${s.name}">/sub/${s.name}</option>`)}
    </select>`;
  }

  return html`<form method="POST" action="/draft">
    ${currentHandle
      ? html``
      : html`<input name="email" type="email" placeholder="your email (we don't keep it)" required>`}
    ${subField}
    <input name="title" placeholder="post title" required>
    <textarea name="body" placeholder="markdown body" required></textarea>
    <button>post</button>
  </form>`;
}

function postRowsView(posts, pseudonyms, previews) {
  if (posts.length === 0) {
    return html`<p class="muted">no posts yet — be the first.</p>`;
  }
  return posts.map((post) => {
    const name = pseudonyms.get(post.handle) ?? post.handle.slice(0, 8);
    const preview = previews?.get(post.id);
    return html`<div class="post">
      <div class="vote">
        <span class="arrow">▲</span>
        <span class="score">0</span>
        <span class="arrow">▼</span>
      </div>
      <div class="body">
        <h2><a href="/post/${post.id}">${post.title}</a></h2>
        ${authorMeta(post, name)}
        ${preview
          ? html`<div class="preview">${raw(preview.html)}${preview.truncated
              ? html` <a href="/post/${post.id}" class="more">read more →</a>`
              : html``}</div>`
          : html``}
      </div>
    </div>`;
  });
}

function buildPreviews(posts, postsDir, maxChars) {
  const map = new Map();
  for (const p of posts) {
    map.set(p.id, getPostPreview(p, postsDir, { maxChars }));
  }
  return map;
}

function activeSubsView(active) {
  if (active.length === 0) {
    return html`<p class="muted">no active subs in the last 24 hours.</p>`;
  }
  return html`<ul class="subs">
    ${active.map((s) => html`<li>
      <a href="/sub/${s.name}">/sub/${s.name}</a>
      <span class="muted">· ${s.post_count} post${s.post_count === 1 ? '' : 's'}</span>
    </li>`)}
  </ul>`;
}

function renderHome(req, res, { db, auth, postsDir }) {
  const posts = listRecentPostsCappedPerSub(db, { limit: 50, perSub: 2 });
  const handles = [...new Set(posts.map((p) => p.handle))];
  const pseudonyms = pseudonymsByHandle(db, handles);
  const active = listActiveSubs(db);
  const postableSubs = listPostableSubs(db);
  const currentHandle = auth.handleFromRequest(req);
  const previews = buildPreviews(posts, postsDir, 280);

  send(
    res,
    200,
    layout('plato', html`
      ${siteHeader({ db, currentHandle, subtitle: 'a forum that lives at one URL' })}
      ${anonHintFor(currentHandle)}
      <h3 class="section">// active subs</h3>
      ${activeSubsView(active)}
      ${currentHandle
        ? html`<p class="muted"><a href="/sub/create">+ create a sub</a></p>`
        : html``}
      <h3 class="section">// new post</h3>
      ${postFormFor({ currentHandle, postableSubs })}
      <h3 class="section">// recent (2 per sub)</h3>
      ${postRowsView(posts, pseudonyms, previews)}
    `)
  );
}

function renderSubPage(req, res, { db, auth, postsDir }, subName) {
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, layout('sub not found', html`<p class="muted">no such sub. <a href="/">back</a></p>`));
  }
  const posts = listPostsInSub(db, subName, { limit: 50 });
  const handles = [...new Set(posts.map((p) => p.handle))];
  const pseudonyms = pseudonymsByHandle(db, handles);
  const currentHandle = auth.handleFromRequest(req);
  // Sub page is still scan mode — about double the home preview. Long posts
  // truncate with "read more →" to the permalink (where comments will live).
  const previews = buildPreviews(posts, postsDir, 600);

  send(
    res,
    200,
    layout(`/sub/${subName}`, html`
      ${siteHeader({
        db,
        currentHandle,
        title: html`/sub/${subName}`,
        subtitle: sub.description || null,
      })}
      <p><a href="/">← home</a></p>
      ${anonHintFor(currentHandle)}
      <h3 class="section">// new post in /sub/${subName}</h3>
      ${postFormFor({ currentHandle, defaultSub: subName, postableSubs: [] })}
      <h3 class="section">// posts</h3>
      ${postRowsView(posts, pseudonyms, previews)}
    `)
  );
}

function renderSubCreate(req, res, { auth }) {
  const currentHandle = auth.handleFromRequest(req);
  if (!currentHandle) {
    return send(
      res,
      401,
      layout('login required', html`<p class="muted">creating a sub requires a session. <a href="/">back</a> and post once to get one.</p>`)
    );
  }
  send(
    res,
    200,
    layout('create a sub', html`
      <header><h1>create a sub</h1></header>
      <p><a href="/">← home</a></p>
      <form method="POST" action="/sub/create">
        <input name="name" placeholder="name (lowercase, 3–30, hyphens ok)" required pattern="[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])?">
        <input name="description" placeholder="one-line description (optional)">
        <button>create</button>
      </form>
      <p class="muted">name is locked at creation. reserved: ${[...RESERVED_SUB_NAMES].join(', ')}.</p>
    `)
  );
}

async function handleSubCreate(req, res, { db, auth }) {
  const currentHandle = auth.handleFromRequest(req);
  if (!currentHandle) {
    return send(res, 401, layout('login required', html`<p class="muted">login first.</p>`));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { name, description = '' } = form;

  try {
    validateSubName(name);
  } catch (err) {
    return send(
      res,
      400,
      layout('invalid name', html`<p class="muted">${err.message} <a href="/sub/create">try again</a></p>`)
    );
  }

  try {
    createSub(db, { name, description, ownerHandle: currentHandle });
  } catch (err) {
    return send(
      res,
      400,
      layout('create failed', html`<p class="muted">${err.message} <a href="/sub/create">try again</a></p>`)
    );
  }

  redirect(res, `/sub/${name}`);
}

async function handleDraft(req, res, { db, auth, disposableDomains, baseUrl, postsDir }) {
  const body = await readBody(req);
  const form = parseForm(body);
  const { email, title, body: postBody, sub_name: subName } = form;
  const currentHandle = auth.handleFromRequest(req);

  if (!title || !postBody || !subName || (!currentHandle && !email)) {
    return send(
      res,
      400,
      layout(
        'missing fields',
        html`<p class="muted">all fields are required, including the sub. <a href="/">back</a></p>`
      )
    );
  }

  // PRD §Permanently out: no default sub. 'general' is read-only legacy.
  if (subName === 'general') {
    return send(
      res,
      400,
      layout(
        'no default sub',
        html`<p class="muted">/sub/general is archive-only. pick a real sub or <a href="/sub/create">create one</a>.</p>`
      )
    );
  }

  if (!getSubByName(db, subName)) {
    return send(
      res,
      400,
      layout(
        'unknown sub',
        html`<p class="muted">/sub/${subName} doesn't exist. <a href="/">back</a></p>`
      )
    );
  }

  if (currentHandle) {
    const { draftId } = submitDraft(db, { title, body: postBody, subName });
    const { subName: published } = finalizeDraft(db, { draftId, handle: currentHandle, postsDir });
    return redirect(res, `/sub/${published}`);
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

  const { draftId } = submitDraft(db, { title, body: postBody, subName });

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

  redirect(res, `/sub/${result.subName}`);
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

const SUB_NAME_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})$/;

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

      if (path === '/' && method === 'GET') return renderHome(req, res, { db, auth, postsDir });
      if (path === '/draft' && method === 'POST') {
        return handleDraft(req, res, { db, auth, disposableDomains, baseUrl, postsDir });
      }
      if (path === '/sub/create' && method === 'GET') return renderSubCreate(req, res, { auth });
      if (path === '/sub/create' && method === 'POST') return handleSubCreate(req, res, { db, auth });

      let m;
      if ((m = path.match(SUB_NAME_PATH_RE)) && method === 'GET') {
        return renderSubPage(req, res, { db, auth, postsDir }, m[1]);
      }
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
