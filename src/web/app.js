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
  SUB_SORTS,
} from '../content/post.js';
import {
  createSub,
  getSubByName,
  validateSubName,
  RESERVED_SUB_NAMES,
} from '../content/sub.js';
import { addComment, listCommentsForPost, buildCommentTree } from '../content/comment.js';
import { castVote, getVote } from '../content/vote.js';
import { renderMarkdown } from '../content/markdown.js';
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

function authorMeta(post, pseudonym, { showComments = false } = {}) {
  return html`<div class="meta">
    <img src="/avatar/${post.handle}.svg" width="18" height="18" alt="">
    <span class="name">${pseudonym}</span>
    <span>· <a href="/sub/${post.sub_name}">/sub/${post.sub_name}</a></span>
    <span class="when">· ${relativeTime(post.created_at)}</span>
    ${showComments
      ? html`<span>· <a href="${permalinkFor(post)}#comments">${post.comment_count ?? 0} ${(post.comment_count ?? 0) === 1 ? 'reply' : 'replies'}</a></span>`
      : html``}
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

// Subs nav data: every postable sub plus its last-24h post count, hottest
// first. Used by the home-page strip — top 3 always visible, the rest
// collapse behind a "+ show all" <details>.
function listSubsForNav(db, { sinceMs = Date.now() - 24 * 60 * 60 * 1000 } = {}) {
  return db.prepare(
    `SELECT s.name,
       (SELECT COUNT(*) FROM posts p WHERE p.sub_name = s.name AND p.created_at >= ?) AS post_count
     FROM subs s
     WHERE s.name != 'general'
     ORDER BY post_count DESC, s.name ASC`
  ).all(sinceMs);
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

function permalinkFor(post) {
  return `/sub/${post.sub_name}/post/${post.id}`;
}

function formatScore(n) {
  // Cached score is REAL (half-weights from new accounts). Show one decimal
  // only when the value isn't whole; integers render cleanly.
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

function voteWidget({ targetType, targetId, score, currentVote, currentHandle, returnTo }) {
  // No JS: each arrow is its own POST form. Server toggles and redirects.
  // currentVote is 'up' / 'down' / null — used to highlight the active
  // arrow. Anonymous users see arrows as muted text (no form, no action).
  if (!currentHandle) {
    return html`<div class="vote">
      <span class="arrow muted">▲</span>
      <span class="score">${formatScore(score)}</span>
      <span class="arrow muted">▼</span>
    </div>`;
  }
  const upClass = currentVote === 'up' ? 'arrow up active' : 'arrow up';
  const downClass = currentVote === 'down' ? 'arrow down active' : 'arrow down';
  return html`<div class="vote">
    <form method="POST" action="/vote" class="inline">
      <input type="hidden" name="target_type" value="${targetType}">
      <input type="hidden" name="target_id" value="${targetId}">
      <input type="hidden" name="direction" value="up">
      <input type="hidden" name="return_to" value="${returnTo}">
      <button class="${upClass}" title="upvote">▲</button>
    </form>
    <span class="score">${formatScore(score)}</span>
    <form method="POST" action="/vote" class="inline">
      <input type="hidden" name="target_type" value="${targetType}">
      <input type="hidden" name="target_id" value="${targetId}">
      <input type="hidden" name="direction" value="down">
      <input type="hidden" name="return_to" value="${returnTo}">
      <button class="${downClass}" title="downvote">▼</button>
    </form>
  </div>`;
}

function postRowsView({ posts, pseudonyms, previews, voteState, currentHandle, returnTo }) {
  if (posts.length === 0) {
    return html`<p class="muted">no posts yet — be the first.</p>`;
  }
  return posts.map((post) => {
    const name = pseudonyms.get(post.handle) ?? post.handle.slice(0, 8);
    const preview = previews?.get(post.id);
    const link = permalinkFor(post);
    // After voting, redirect back to this exact post in the list so the
    // browser doesn't scroll to top. Anchor matches the post element below.
    const perPostReturn = `${returnTo}#post-${post.id}`;
    return html`<div class="post" id="post-${post.id}">
      ${voteWidget({
        targetType: 'post',
        targetId: post.id,
        score: post.score ?? 0,
        currentVote: voteState?.get(post.id) ?? null,
        currentHandle,
        returnTo: perPostReturn,
      })}
      <div class="body">
        <h2><a href="${link}">${post.title}</a></h2>
        ${authorMeta(post, name, { showComments: true })}
        ${preview
          ? html`<div class="preview">${raw(preview.html)}${preview.truncated
              ? html` <a href="${link}" class="more">read more →</a>`
              : html``}</div>`
          : html``}
      </div>
    </div>`;
  });
}

function votesForPostList(db, posts, currentHandle) {
  if (!currentHandle || posts.length === 0) return new Map();
  const placeholders = posts.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT target_id, value FROM votes
     WHERE target_type = 'post' AND handle = ? AND target_id IN (${placeholders})`
  ).all(currentHandle, ...posts.map((p) => p.id));
  const map = new Map();
  for (const r of rows) map.set(r.target_id, r.value > 0 ? 'up' : 'down');
  return map;
}

function buildPreviews(posts, postsDir, maxChars) {
  const map = new Map();
  for (const p of posts) {
    map.set(p.id, getPostPreview(p, postsDir, { maxChars }));
  }
  return map;
}

function subEntry(s) {
  const title = `${s.post_count} post${s.post_count === 1 ? '' : 's'} in the last 24h`;
  return html`<a href="/sub/${s.name}" title="${title}">${s.name}${s.post_count > 0
    ? html` <span class="count">${s.post_count}</span>`
    : html``}</a>`;
}

function subsStripView({ subs, currentHandle }) {
  if (subs.length === 0) {
    return html`<div class="subs-strip">
      <span class="label">subs · last 24h</span>
      <span class="muted"><em>none yet</em></span>
      ${currentHandle
        ? html`<a class="new-sub" href="/sub/create">+ new</a>`
        : html``}
    </div>`;
  }

  const top = subs.slice(0, 3);
  const rest = subs.slice(3);

  return html`<div class="subs-strip">
    <span class="label">subs · last 24h</span>
    ${top.map(subEntry)}
    ${rest.length > 0
      ? html`<details class="subs-more"><summary>+ show all (${rest.length})</summary>
          <div class="subs-grid">
            ${rest.map(subEntry)}
          </div>
        </details>`
      : html``}
    ${currentHandle
      ? html`<a class="new-sub" href="/sub/create">+ new</a>`
      : html``}
  </div>`;
}

function renderHome(req, res, { db, auth, postsDir }) {
  const posts = listRecentPostsCappedPerSub(db, { limit: 50, perSub: 2 });
  const handles = [...new Set(posts.map((p) => p.handle))];
  const pseudonyms = pseudonymsByHandle(db, handles);
  const subsNav = listSubsForNav(db);
  const postableSubs = listPostableSubs(db);
  const currentHandle = auth.handleFromRequest(req);
  const previews = buildPreviews(posts, postsDir, 280);
  const voteState = votesForPostList(db, posts, currentHandle);

  send(
    res,
    200,
    layout('plato', html`
      ${siteHeader({ db, currentHandle, subtitle: 'a forum that lives at one URL' })}
      ${anonHintFor(currentHandle)}
      ${subsStripView({ subs: subsNav, currentHandle })}
      <h3 class="section">// new post</h3>
      ${postFormFor({ currentHandle, postableSubs })}
      <h3 class="section">// recent (2 per sub)</h3>
      ${postRowsView({ posts, pseudonyms, previews, voteState, currentHandle, returnTo: '/' })}
    `)
  );
}

function renderSubPage(req, res, { db, auth, postsDir }, subName, sort) {
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, layout('sub not found', html`<p class="muted">no such sub. <a href="/">back</a></p>`));
  }
  const activeSort = SUB_SORTS.includes(sort) ? sort : 'new';
  const posts = listPostsInSub(db, subName, { limit: 50, sort: activeSort });
  const handles = [...new Set(posts.map((p) => p.handle))];
  const pseudonyms = pseudonymsByHandle(db, handles);
  const currentHandle = auth.handleFromRequest(req);
  const previews = buildPreviews(posts, postsDir, 600);
  const voteState = votesForPostList(db, posts, currentHandle);
  const returnTo = `/sub/${subName}${activeSort === 'new' ? '' : `?sort=${activeSort}`}`;

  const sortNav = html`<div class="sort-nav muted">
    ${SUB_SORTS.map((s) => {
      const href = s === 'new' ? `/sub/${subName}` : `/sub/${subName}?sort=${s}`;
      return s === activeSort
        ? html`<strong>${s}</strong>`
        : html`<a href="${href}">${s}</a>`;
    })}
  </div>`;

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
      <h3 class="section">// posts · sort:</h3>
      ${sortNav}
      ${postRowsView({ posts, pseudonyms, previews, voteState, currentHandle, returnTo })}
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

// Comment tree render. Depth is unbounded; we cap visual indent at 8 levels
// so deep replies don't disappear off-screen but still maintain order.
const COLLAPSE_THRESHOLD = -3;
const MAX_INDENT_DEPTH = 8;

function commentNodeView(node, ctx, depth) {
  const pseudonym = ctx.pseudonyms.get(node.handle) ?? node.handle.slice(0, 8);
  const collapsed = node.score <= COLLAPSE_THRESHOLD;
  const indent = Math.min(depth, MAX_INDENT_DEPTH);
  const replyForm = ctx.currentHandle
    ? html`<details class="reply"><summary class="muted">reply</summary>
        <form method="POST" action="/sub/${ctx.subName}/post/${ctx.postId}/comment" class="reply-form">
          <input type="hidden" name="parent_id" value="${node.id}">
          <textarea name="body" placeholder="markdown reply" required></textarea>
          <button>reply</button>
        </form>
      </details>`
    : html``;

  const body = html`<div class="comment-body">${raw(renderMarkdown(node.body))}</div>`;

  const inner = collapsed
    ? html`<details class="comment-collapsed">
        <summary class="muted">(score ${formatScore(node.score)}) collapsed comment by ${pseudonym}. show.</summary>
        ${body}
      </details>`
    : body;

  return html`<div class="comment depth-${indent}" id="comment-${node.id}">
    <div class="comment-header">
      ${voteWidget({
        targetType: 'comment',
        targetId: node.id,
        score: node.score,
        currentVote: ctx.commentVotes.get(node.id) ?? null,
        currentHandle: ctx.currentHandle,
        returnTo: `${ctx.returnTo}#comment-${node.id}`,
      })}
      <div class="meta">
        <img src="/avatar/${node.handle}.svg" width="16" height="16" alt="">
        <span class="name">${pseudonym}</span>
        <span class="when">· ${relativeTime(node.created_at)}</span>
      </div>
    </div>
    ${inner}
    ${replyForm}
    ${node.replies.length > 0
      ? html`<div class="replies">${node.replies.map((r) => commentNodeView(r, ctx, depth + 1))}</div>`
      : html``}
  </div>`;
}

function commentVotesFor(db, comments, currentHandle) {
  if (!currentHandle || comments.length === 0) return new Map();
  const placeholders = comments.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT target_id, value FROM votes
     WHERE target_type = 'comment' AND handle = ? AND target_id IN (${placeholders})`
  ).all(currentHandle, ...comments.map((c) => c.id));
  const map = new Map();
  for (const r of rows) map.set(r.target_id, r.value > 0 ? 'up' : 'down');
  return map;
}

function renderPostPage(req, res, { db, auth, postsDir }, subName, postId) {
  const sub = getSubByName(db, subName);
  if (!sub) {
    return send(res, 404, layout('not found', html`<p class="muted">sub not found.</p>`));
  }
  const result = getPost(db, postId, postsDir);
  if (!result || result.post.sub_name !== subName) {
    return send(res, 404, layout('not found', html`<p class="muted">post not found in this sub.</p>`));
  }

  const { post, bodyHtml } = result;
  const currentHandle = auth.handleFromRequest(req);
  const returnTo = permalinkFor(post);

  const comments = listCommentsForPost(db, postId);
  const tree = buildCommentTree(comments);
  const allHandles = [...new Set([post.handle, ...comments.map((c) => c.handle)])];
  const pseudonyms = pseudonymsByHandle(db, allHandles);
  const commentVotes = commentVotesFor(db, comments, currentHandle);
  const postVote = currentHandle
    ? getVote(db, { targetType: 'post', targetId: postId, voterHandle: currentHandle })
    : null;
  const treeCtx = { pseudonyms, commentVotes, currentHandle, subName, postId, returnTo };

  send(
    res,
    200,
    layout(post.title, html`
      ${siteHeader({ db, currentHandle, title: html`plato · forum` })}
      <p><a href="/">← home</a> · <a href="/sub/${subName}">/sub/${subName}</a></p>
      <div class="post post-page">
        ${voteWidget({ targetType: 'post', targetId: postId, score: post.score, currentVote: postVote, currentHandle, returnTo })}
        <div class="body">
          <h1>${post.title}</h1>
          ${authorMeta(post, pseudonyms.get(post.handle))}
          <article>${raw(bodyHtml)}</article>
        </div>
      </div>

      <h3 class="section" id="comments">// comments (${comments.length})</h3>
      ${currentHandle
        ? html`<form method="POST" action="/sub/${subName}/post/${postId}/comment">
            <textarea name="body" placeholder="add a comment in markdown" required></textarea>
            <button>comment</button>
          </form>`
        : html`<p class="muted">log in to comment.</p>`}

      ${tree.length === 0
        ? html`<p class="muted">no comments yet.</p>`
        : tree.map((node) => commentNodeView(node, treeCtx, 0))}
    `)
  );
}

async function handleAddComment(req, res, { db, auth }, subName, postId) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, layout('login required', html`<p class="muted">log in to comment.</p>`));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { body: commentBody, parent_id: parentId } = form;
  if (!commentBody || commentBody.trim().length === 0) {
    return send(res, 400, layout('empty', html`<p class="muted">comment body required.</p>`));
  }
  try {
    addComment(db, { postId, parentId: parentId || null, handle, body: commentBody });
  } catch (err) {
    return send(res, 400, layout('comment failed', html`<p class="muted">${err.message}</p>`));
  }
  redirect(res, `/sub/${subName}/post/${postId}`);
}

async function handleVote(req, res, { db, auth }) {
  const handle = auth.handleFromRequest(req);
  if (!handle) {
    return send(res, 401, layout('login required', html`<p class="muted">log in to vote.</p>`));
  }
  const body = await readBody(req);
  const form = parseForm(body);
  const { target_type: targetType, target_id: targetId, direction, return_to: returnTo } = form;
  try {
    castVote(db, { targetType, targetId, voterHandle: handle, direction });
  } catch (err) {
    return send(res, 400, layout('vote failed', html`<p class="muted">${err.message}</p>`));
  }
  // Redirect back to wherever the vote button was clicked. Whitelist the
  // path to keep an attacker from using /vote as an open redirect.
  const safeReturn = typeof returnTo === 'string' && returnTo.startsWith('/') ? returnTo : '/';
  redirect(res, safeReturn);
}

// Legacy /post/<id> from M1/M2: redirect to the canonical sub-namespaced URL.
function redirectLegacyPost(req, res, { db }, postId) {
  const post = db.prepare('SELECT sub_name FROM posts WHERE id = ?').get(postId);
  if (!post) return send(res, 404, layout('not found', html`<p class="muted">post not found.</p>`));
  res.writeHead(301, { Location: `/sub/${post.sub_name}/post/${postId}` });
  res.end();
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
const SUB_POST_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/post\/([0-9a-f]{16})$/;
const SUB_POST_COMMENT_PATH_RE = /^\/sub\/([a-z0-9-]{3,30})\/post\/([0-9a-f]{16})\/comment$/;

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
      if (path === '/vote' && method === 'POST') return handleVote(req, res, { db, auth });
      if (path === '/sub/create' && method === 'GET') return renderSubCreate(req, res, { auth });
      if (path === '/sub/create' && method === 'POST') return handleSubCreate(req, res, { db, auth });

      let m;
      if ((m = path.match(SUB_POST_COMMENT_PATH_RE)) && method === 'POST') {
        return handleAddComment(req, res, { db, auth }, m[1], m[2]);
      }
      if ((m = path.match(SUB_POST_PATH_RE)) && method === 'GET') {
        return renderPostPage(req, res, { db, auth, postsDir }, m[1], m[2]);
      }
      if ((m = path.match(SUB_NAME_PATH_RE)) && method === 'GET') {
        return renderSubPage(req, res, { db, auth, postsDir }, m[1], url.searchParams.get('sort'));
      }
      if ((m = path.match(/^\/draft\/([0-9a-f]{16})\/finalize$/)) && method === 'GET') {
        return handleFinalize(req, res, { db, auth, postsDir }, m[1]);
      }
      if ((m = path.match(/^\/post\/([0-9a-f]{16})$/)) && method === 'GET') {
        return redirectLegacyPost(req, res, { db }, m[1]);
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
