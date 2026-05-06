// Per-sub archive builder (M7/B2-a).
//
// Pure function: given a DB connection and a sub name, returns a tarball
// Buffer matching the canonical archive format (see
// docs/02-features/archive-format.md). No HTTP, no disk-write, no signing
// — those concerns live in the worker (bin/run-export-queue.js) and the
// download route (M7/B2-b).
//
// Hobby-scale: the entire archive is built in memory before being
// gzipped to disk. A 100k-comment / 10k-post sub still fits comfortably;
// streaming is deferred until a real instance hits the wall.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildManifest, sha256Hex } from './manifest.js';
import { writeTar } from './tar.js';
import { renderMarkdown } from '../content/markdown.js';

// Default static reader styling — ~80 lines, monospace, plato-voice but
// reduced (no JS, no interactivity, no theme tokens — archive lives
// outside any plato instance and rebrands by overwriting this one file).
const ARCHIVE_CSS = `:root {
  --bg: #0d1117;
  --bg-soft: #161b22;
  --border: #30363d;
  --text: #c9d1d9;
  --text-dim: #8b949e;
  --accent: #58a6ff;
}
* { box-sizing: border-box; }
html { background: var(--bg); color: var(--text); }
body {
  font-family: 'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace;
  font-size: 14px;
  line-height: 1.6;
  max-width: 880px;
  margin: 2rem auto;
  padding: 0 1rem;
}
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline dotted; }
h1, h2, h3 { font-weight: 600; margin-top: 1.5rem; }
h1 { font-size: 1.4rem; }
h2 { font-size: 1.15rem; }
.muted { color: var(--text-dim); }
.section { border-bottom: 1px solid var(--border); padding-bottom: 0.3rem; }
ul.posts { list-style: none; padding: 0; }
ul.posts > li { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
ul.posts > li .meta { color: var(--text-dim); font-size: 0.85rem; }
.comment { border-left: 2px solid var(--border); padding: 0.4rem 0.8rem; margin: 0.6rem 0; }
.comment .comment { margin-left: 0.6rem; }
.comment .meta { color: var(--text-dim); font-size: 0.85rem; }
.comment.removed > .body { color: var(--text-dim); font-style: italic; }
.comment.collapsed > .body { display: none; }
.banner { border: 1px solid var(--text-dim); padding: 0.4rem 0.7rem; margin: 0.5rem 0; font-size: 0.85rem; }
blockquote { border-left: 3px solid var(--border); margin: 0.5rem 0; padding: 0 0.8rem; color: var(--text-dim); }
pre { background: var(--bg-soft); padding: 0.5rem 0.8rem; overflow-x: auto; }
code { background: var(--bg-soft); padding: 0.1rem 0.3rem; border-radius: 3px; }
pre > code { background: transparent; padding: 0; }
img { max-width: 100%; }
`;

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function htmlPage({ title, cssHref, body }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="${escapeHtml(cssHref)}">
</head>
<body>
${body}
</body>
</html>
`;
}

function fmtTimestamp(ms) {
  if (ms == null) return '';
  return new Date(ms).toISOString();
}

// Render the body of <id>.html: post header + rendered post body +
// threaded comment tree. Comments are rendered as a flat depth-prefixed
// list so the static reader doesn't need JS to fold/unfold.
function renderPostHtml({ post, postBody, comments, pseudonyms, subName }) {
  const ps = pseudonyms.get(post.handle) ?? post.handle.slice(0, 8);
  const removedBanner = post.removed_at
    ? `<p class="banner">[mod removed] this post was removed by a moderator at ${fmtTimestamp(post.removed_at)}. body retained for the public archive.</p>`
    : '';
  const collapsedBanner = post.collapsed_at
    ? `<p class="banner">[mod collapsed] this post was soft-collapsed at ${fmtTimestamp(post.collapsed_at)}.</p>`
    : '';
  const sensitiveBanner = post.sensitive
    ? `<p class="banner">[!] sensitive content — use discretion</p>`
    : '';

  const byPostId = new Map();
  for (const c of comments) {
    if (!byPostId.has(c.parent_comment_id || null)) byPostId.set(c.parent_comment_id || null, []);
    byPostId.get(c.parent_comment_id || null).push(c);
  }
  function renderComment(c) {
    const cps = pseudonyms.get(c.handle) ?? c.handle.slice(0, 8);
    const cls = ['comment'];
    if (c.removed_at != null) cls.push('removed');
    if (c.collapsed_at != null) cls.push('collapsed');
    const meta = `<div class="meta">${escapeHtml(cps)} · ${fmtTimestamp(c.created_at)} · score ${c.score}${c.edited_at ? ' · edited' : ''}${c.removed_at ? ' · [mod removed]' : ''}${c.collapsed_at ? ' · [mod collapsed]' : ''}</div>`;
    const body = c.removed_at ? '<div class="body">[content removed]</div>' : `<div class="body">${renderMarkdown(c.body)}</div>`;
    const children = (byPostId.get(c.id) ?? []).map((kid) => renderComment(kid)).join('');
    return `<div class="${cls.join(' ')}">${meta}${body}${children}</div>`;
  }
  const tree = (byPostId.get(null) ?? []).map((c) => renderComment(c)).join('');

  return `<p><a href="../index.html">← index</a></p>
<h1>${escapeHtml(post.title)}</h1>
<p class="muted">posted by ${escapeHtml(ps)} in //${escapeHtml(subName)} · ${fmtTimestamp(post.created_at)}${post.edited_at ? ' · edited' : ''} · score ${post.score}</p>
${sensitiveBanner}
${collapsedBanner}
${removedBanner}
<div class="post-body">${renderMarkdown(postBody)}</div>
<h2 class="section">// comments (${comments.length})</h2>
${tree}`;
}

function renderIndexHtml({ sub, posts, pseudonyms, instance }) {
  const items = posts
    .slice()
    .sort((a, b) => b.created_at - a.created_at)
    .map((p) => {
      const ps = pseudonyms.get(p.handle) ?? p.handle.slice(0, 8);
      const tags = [];
      if (p.removed_at) tags.push('[mod removed]');
      if (p.collapsed_at) tags.push('[mod collapsed]');
      if (p.sensitive) tags.push('[!]');
      return `<li>
  <a href="posts/${escapeHtml(p.id)}.html">${escapeHtml(p.title)}</a> ${tags.length ? `<span class="muted">${escapeHtml(tags.join(' '))}</span>` : ''}
  <div class="meta">${escapeHtml(ps)} · ${fmtTimestamp(p.created_at)} · score ${p.score} · ${p.comment_count} ${p.comment_count === 1 ? 'comment' : 'comments'}</div>
</li>`;
    })
    .join('\n');

  const sourceLine = instance.base_url
    ? `exported from <a href="${escapeHtml(instance.base_url)}">${escapeHtml(instance.forum_name)}</a> · ${posts.length} posts · format v1`
    : `exported from ${escapeHtml(instance.forum_name)} · ${posts.length} posts · format v1`;

  return `<h1>//${escapeHtml(sub.name)} archive</h1>
<p class="muted">${escapeHtml(sub.description || '')}</p>
<p class="muted">${sourceLine}</p>
<p class="muted">offline static reader. no javascript. read-only. see README.md for the schema.</p>
<h2 class="section">// posts</h2>
<ul class="posts">${items}</ul>`;
}

function buildReadme({ sub, instance, exportedAtIso, counts }) {
  const source = instance.base_url
    ? `${instance.forum_name} (${instance.base_url})`
    : instance.forum_name;
  return `# //${sub.name} archive

This is a plato per-sub archive (\`kind: "sub"\`).

- **Sub**: //${sub.name}
- **Source instance**: ${source}
- **Exported at**: ${exportedAtIso}
- **Format version**: 1
- **Counts**: ${counts.posts} posts, ${counts.comments} comments, ${counts.mod_actions} mod actions

## How to read

Open \`index.html\` in any browser. The archive is fully self-contained — no JavaScript, no external assets, no plato install needed.

## File layout

\`\`\`
manifest.json            # inventory + per-file SHA-256
index.html               # static reader entry
archive.css              # styling, ~80 lines
posts/<id>.md            # post source (frontmatter + markdown body)
posts/<id>.html          # rendered for the static reader
posts.json               # per-post metadata (score, sensitive, flair, edits)
comments.json            # flat array of all comments, threaded via parent_comment_id
modlog.json              # public moderator actions on this sub
votes.json               # vote tallies (NOT per-voter — see Privacy posture below)
subs.json                # sub metadata
\`\`\`

## What is NOT in this archive

- Email addresses (plato never stores them)
- Per-voter vote map (only tallies, never the (handle → vote) mapping)
- Subscriber lists, drafts, flag entries, IP addresses, session tokens, magic-link tokens, operator config

The archive's silence on these is itself a security property.

## Identity model

Pseudonyms are static attribution labels. Handles (64-hex strings) are derived from the source instance's master secret over a user's email; they cannot be re-derived on a different instance, so they don't bridge identity across forks. On import, archived pseudonyms appear as historical attribution — they cannot be claimed.

## Reconstruction

The four JSON files (\`posts.json\`, \`comments.json\`, \`modlog.json\`, \`votes.json\`) plus \`subs.json\` map directly to plato's DB schema. An importer reads them, re-derives handles under its own master secret, and inserts. Or: walk \`posts/*.md\` to extract plain markdown bodies; run them through any markdown engine for a static blog.

The canonical spec lives at \`docs/02-features/archive-format.md\` in the plato repository. This README is generated from it.
`;
}

// Main entry: build a per-sub tarball Buffer.
//
// db          — open DB connection
// subName     — string
// options:
//   postsDir          — absolute path; resolves <post.file_path>
//   branding          — { forumName, baseUrl, ... }
//   platoVersion      — string from package.json
//   exportedAt        — Date instance (defaults to now)
//
// Throws if the sub doesn't exist.
export function buildSubArchiveBytes(db, subName, { postsDir, branding, platoVersion, exportedAt = new Date() }) {
  const sub = db.prepare('SELECT * FROM subs WHERE name = ?').get(subName);
  if (!sub) throw new Error(`buildSubArchiveBytes: sub ${subName} not found`);

  const posts = db.prepare(`SELECT * FROM posts WHERE sub_name = ? ORDER BY created_at ASC`).all(subName);
  const postIds = posts.map((p) => p.id);
  const comments = postIds.length === 0
    ? []
    : db.prepare(
        `SELECT * FROM comments WHERE post_id IN (${postIds.map(() => '?').join(',')}) ORDER BY created_at ASC`
      ).all(...postIds);
  const modActions = db.prepare(
    `SELECT * FROM mod_actions WHERE sub_name = ? ORDER BY created_at ASC`
  ).all(subName);

  // Pseudonym map for every handle that appears anywhere.
  const handleSet = new Set();
  for (const p of posts) handleSet.add(p.handle);
  for (const c of comments) handleSet.add(c.handle);
  for (const a of modActions) if (a.mod_handle) handleSet.add(a.mod_handle);
  if (sub.owner_handle) handleSet.add(sub.owner_handle);
  const handles = [...handleSet];
  const pseudonyms = new Map();
  if (handles.length > 0) {
    const rows = db.prepare(
      `SELECT handle, pseudonym FROM handles WHERE handle IN (${handles.map(() => '?').join(',')})`
    ).all(...handles);
    for (const r of rows) pseudonyms.set(r.handle, r.pseudonym);
  }

  // Comment counts per post (computed live so the export is self-consistent
  // even if the live cache drifts).
  const commentCount = new Map();
  for (const c of comments) commentCount.set(c.post_id, (commentCount.get(c.post_id) ?? 0) + 1);

  // Vote tallies per (target_type, target_id) — counts only, no voter handles.
  const voteRows = db.prepare(
    `SELECT target_type, target_id, value FROM votes
      WHERE (target_type = 'post' AND target_id IN (${postIds.map(() => '?').join(',') || "''"}))
         OR (target_type = 'comment' AND target_id IN (${comments.map(() => '?').join(',') || "''"}))`
  ).all(...postIds, ...comments.map((c) => c.id));
  const votes = {};
  for (const p of posts) votes[`post:${p.id}`] = { up: 0, down: 0, score: p.score };
  for (const c of comments) votes[`comment:${c.id}`] = { up: 0, down: 0, score: c.score };
  for (const v of voteRows) {
    const key = `${v.target_type}:${v.target_id}`;
    if (!votes[key]) continue;
    if (v.value > 0) votes[key].up++;
    else if (v.value < 0) votes[key].down++;
  }

  // ---- JSON files ----
  const subsJson = JSON.stringify([
    {
      name: sub.name,
      description: sub.description ?? '',
      owner_handle: sub.owner_handle ?? null,
      owner_pseudonym: sub.owner_handle ? (pseudonyms.get(sub.owner_handle) ?? null) : null,
      default_sort: sub.default_sort,
      created_at: sub.created_at,
      sensitive: !!sub.sensitive,
      flairs: JSON.parse(sub.flairs || '[]'),
      flairs_required: !!sub.flairs_required,
      flag_threshold: sub.flag_threshold,
      auto_uncollapse_post: sub.auto_uncollapse_post,
      auto_uncollapse_comment: sub.auto_uncollapse_comment,
    },
  ], null, 2);

  const postsJson = JSON.stringify(posts.map((p) => ({
    id: p.id,
    sub_name: p.sub_name,
    handle: p.handle,
    pseudonym: pseudonyms.get(p.handle) ?? null,
    title: p.title,
    created_at: p.created_at,
    edited_at: p.edited_at ?? null,
    score: p.score,
    sensitive: !!p.sensitive,
    flair_slug: p.flair_slug ?? null,
    collapsed_at: p.collapsed_at ?? null,
    removed_at: p.removed_at ?? null,
    score_at_collapse: p.score_at_collapse ?? null,
    comment_count: commentCount.get(p.id) ?? 0,
  })), null, 2);

  const commentsJson = JSON.stringify(comments.map((c) => ({
    id: c.id,
    post_id: c.post_id,
    parent_comment_id: c.parent_comment_id ?? null,
    handle: c.handle,
    pseudonym: pseudonyms.get(c.handle) ?? null,
    body: c.body,
    created_at: c.created_at,
    edited_at: c.edited_at ?? null,
    score: c.score,
    collapsed_at: c.collapsed_at ?? null,
    removed_at: c.removed_at ?? null,
    score_at_collapse: c.score_at_collapse ?? null,
  })), null, 2);

  const modlogJson = JSON.stringify(modActions.map((a) => ({
    id: a.id,
    sub_name: a.sub_name,
    mod_handle: a.mod_handle ?? null,
    mod_pseudonym: a.mod_handle ? (pseudonyms.get(a.mod_handle) ?? null) : null,
    action: a.action,
    target_type: a.target_type,
    target_id: a.target_id,
    reason: a.reason ?? null,
    created_at: a.created_at,
  })), null, 2);

  const votesJson = JSON.stringify(votes, null, 2);

  // ---- Per-post .md (read from disk) and .html (rendered) ----
  const postsForIndex = posts.map((p) => ({ ...p, comment_count: commentCount.get(p.id) ?? 0 }));
  const commentsByPost = new Map();
  for (const c of comments) {
    if (!commentsByPost.has(c.post_id)) commentsByPost.set(c.post_id, []);
    commentsByPost.get(c.post_id).push(c);
  }

  const indexHtml = htmlPage({
    title: `//${sub.name} archive`,
    cssHref: 'archive.css',
    body: renderIndexHtml({
      sub,
      posts: postsForIndex,
      pseudonyms,
      instance: { forum_name: branding.forumName, base_url: branding.baseUrl ?? '' },
    }),
  });

  const exportedAtIso = exportedAt.toISOString();
  const counts = { posts: posts.length, comments: comments.length, mod_actions: modActions.length, subs: 1 };
  const readmeMd = buildReadme({
    sub,
    instance: { forum_name: branding.forumName, base_url: branding.baseUrl ?? '' },
    exportedAtIso,
    counts,
  });

  // ---- Assemble file entries ----
  const files = [];
  // Markdown sources first (deterministic order). If a post's .md file is
  // missing from disk, throw — worker will retry, and a persistent failure
  // surfaces as a terminal-failed job rather than a silent broken archive.
  for (const p of posts) {
    const md = readFileSync(resolve(postsDir, p.file_path.replace(/^posts\//, '')), 'utf8');
    files.push({ path: `posts/${p.id}.md`, body: md });
    const renderedHtml = htmlPage({
      title: `${p.title} — //${sub.name}`,
      cssHref: '../archive.css',
      body: renderPostHtml({
        post: p,
        postBody: md.replace(/^---[\s\S]*?---\n+/, ''),
        comments: commentsByPost.get(p.id) ?? [],
        pseudonyms,
        subName: sub.name,
      }),
    });
    files.push({ path: `posts/${p.id}.html`, body: renderedHtml });
  }
  files.push({ path: 'posts.json', body: postsJson });
  files.push({ path: 'comments.json', body: commentsJson });
  files.push({ path: 'modlog.json', body: modlogJson });
  files.push({ path: 'votes.json', body: votesJson });
  files.push({ path: 'subs.json', body: subsJson });
  files.push({ path: 'index.html', body: indexHtml });
  files.push({ path: 'archive.css', body: ARCHIVE_CSS });
  files.push({ path: 'README.md', body: readmeMd });

  // Hash everything (utf8 strings), build manifest.
  const fileEntries = files.map((f) => {
    const buf = Buffer.from(f.body, 'utf8');
    return { path: f.path, sha256: sha256Hex(buf), size: buf.length };
  });
  const manifest = buildManifest({
    kind: 'sub',
    scope: { sub: sub.name },
    instance: {
      forum_name: branding.forumName,
      base_url: branding.baseUrl ?? '',
      pubkey_fingerprint: null,
    },
    exportedAt: exportedAtIso,
    platoVersion,
    counts,
    files: fileEntries,
  });
  const manifestJson = JSON.stringify(manifest, null, 2);

  // Manifest goes in last so it can describe everything that came before.
  // Spec doesn't constrain order; importers find it by name.
  const tarEntries = [
    ...files.map((f) => ({ path: f.path, body: f.body })),
    { path: 'manifest.json', body: manifestJson },
  ];
  return writeTar(tarEntries, { defaultMtime: exportedAt.getTime() });
}

export function archiveFilenameFor(subName, exportedAt = new Date()) {
  const yyyymmdd = exportedAt.toISOString().slice(0, 10);
  return `plato-export-${subName}-${yyyymmdd}.tar.gz`;
}
