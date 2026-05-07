// Per-user (cross-instance) archive builder (M7/B2-b).
//
// Pure function: given a DB connection and a user handle, returns a
// tarball Buffer of everything the user authored or did across the
// instance, plus the mod actions taken *on* their content. No HTTP, no
// disk-write, no signing — those concerns live in the worker and the
// download route.
//
// Hobby-scale: the entire archive is built in memory before being
// gzipped to disk. Plato's per-user contribution graph is bounded; if a
// real instance hits the wall we'll stream then.
//
// Privacy posture:
//   - The archive contains the user's *own* data: their posts, their
//     comments, their votes-cast, their subscriptions, mod actions they
//     took, mod actions taken on them.
//   - Per-voter handles still NEVER appear except as the requesting
//     user's own handle (which is theirs to receive).
//   - The user's email is, as ever, not stored in the DB and so cannot
//     leak into the archive.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildManifest, sha256Hex } from './manifest.js';
import { writeTar } from './tar.js';
import { renderMarkdown } from '../content/markdown.js';

// Same minimal monospace styling as the per-sub archive's static reader.
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
ul.posts, ul.comments { list-style: none; padding: 0; }
ul.posts > li, ul.comments > li { padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
ul.posts > li .meta, ul.comments > li .meta { color: var(--text-dim); font-size: 0.85rem; }
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

function renderIndexHtml({ pseudonym, handle, posts, comments, instance }) {
  const sourceLine = instance.base_url
    ? `exported from <a href="${escapeHtml(instance.base_url)}">${escapeHtml(instance.forum_name)}</a> · format v1`
    : `exported from ${escapeHtml(instance.forum_name)} · format v1`;

  const postItems = posts.length === 0
    ? '<p class="muted">no posts authored.</p>'
    : `<ul class="posts">${posts.slice().sort((a, b) => b.created_at - a.created_at).map((p) => {
        const tags = [];
        if (p.removed_at) tags.push('[mod removed]');
        if (p.collapsed_at) tags.push('[mod collapsed]');
        if (p.sensitive) tags.push('[!]');
        return `<li>
          <a href="posts/${escapeHtml(p.id)}.html">${escapeHtml(p.title)}</a>
          ${tags.length ? `<span class="muted">${escapeHtml(tags.join(' '))}</span>` : ''}
          <div class="meta">in //${escapeHtml(p.sub_name)} · ${fmtTimestamp(p.created_at)} · score ${p.score}</div>
        </li>`;
      }).join('\n')}</ul>`;

  const commentItems = comments.length === 0
    ? '<p class="muted">no comments authored.</p>'
    : `<ul class="comments">${comments.slice().sort((a, b) => b.created_at - a.created_at).slice(0, 100).map((c) => {
        const snippet = (c.body || '').replace(/\s+/g, ' ').slice(0, 140);
        return `<li>
          <div class="meta">on //${escapeHtml(c.sub_name)} · ${fmtTimestamp(c.created_at)} · score ${c.score}</div>
          <div>${escapeHtml(snippet)}${(c.body || '').length > 140 ? '…' : ''}</div>
        </li>`;
      }).join('\n')}${comments.length > 100 ? `<p class="muted">… ${comments.length - 100} more in <code>comments.json</code></p>` : ''}</ul>`;

  return `<h1>${escapeHtml(pseudonym || handle.slice(0, 8))} — personal archive</h1>
<p class="muted">${sourceLine}</p>
<p class="muted">handle: <code>${escapeHtml(handle.slice(0, 16))}…</code></p>
<p class="muted">offline static reader. no javascript. read-only. see README.md for the schema.</p>
<h2 class="section">// posts (${posts.length})</h2>
${postItems}
<h2 class="section">// comments (${comments.length})</h2>
${commentItems}`;
}

function renderPostHtml({ post, postBody, pseudonym, subName }) {
  const removedBanner = post.removed_at
    ? `<p class="banner">[mod removed] this post was removed by a moderator at ${fmtTimestamp(post.removed_at)}. body retained for the public archive.</p>`
    : '';
  const collapsedBanner = post.collapsed_at
    ? `<p class="banner">[mod collapsed] this post was soft-collapsed at ${fmtTimestamp(post.collapsed_at)}.</p>`
    : '';
  const sensitiveBanner = post.sensitive
    ? `<p class="banner">[!] sensitive content — use discretion</p>`
    : '';

  return `<p><a href="../index.html">← index</a></p>
<h1>${escapeHtml(post.title)}</h1>
<p class="muted">posted by ${escapeHtml(pseudonym || post.handle.slice(0, 8))} in //${escapeHtml(subName)} · ${fmtTimestamp(post.created_at)}${post.edited_at ? ' · edited' : ''} · score ${post.score}</p>
${sensitiveBanner}
${collapsedBanner}
${removedBanner}
<div class="post-body">${renderMarkdown(postBody)}</div>`;
}

function buildReadme({ pseudonym, handle, instance, exportedAtIso, counts }) {
  const source = instance.base_url
    ? `${instance.forum_name} (${instance.base_url})`
    : instance.forum_name;
  return `# personal archive — ${pseudonym || handle.slice(0, 8)}

This is a plato per-user archive (\`kind: "user"\`).

- **Pseudonym**: ${pseudonym || '(none on record)'}
- **Handle**: \`${handle}\`
- **Source instance**: ${source}
- **Exported at**: ${exportedAtIso}
- **Format version**: 1
- **Counts**: ${counts.posts} posts, ${counts.comments} comments, ${counts.votes_cast} votes cast, ${counts.subscriptions} subscriptions

## How to read

Open \`index.html\` in any browser. The archive is fully self-contained — no JavaScript, no external assets, no plato install needed.

## File layout

\`\`\`
manifest.json                # inventory + per-file SHA-256
index.html                   # static reader entry
archive.css                  # styling, ~80 lines
posts/<id>.md                # post source (frontmatter + markdown body)
posts/<id>.html              # rendered for the static reader
posts.json                   # cross-sub list of posts you authored
comments.json                # cross-sub list of comments you authored
votes_cast.json              # votes you cast (target_type:target_id → value)
subscriptions.json           # subs you were subscribed to at export time
subs_moderated.json          # subs where you are owner or co-mod
mod_actions_received.json    # public mod actions taken on your content
mod_actions_taken.json       # public mod actions you took as a moderator
\`\`\`

## What is NOT in this archive

- Email addresses (plato never stores them)
- Per-voter vote map for OTHER users (only your own votes-cast are listed)
- Other users' subscription lists or contributions
- IP addresses, session tokens, magic-link tokens, operator config
- Drafts (transient by design)

## Identity model

Pseudonyms are static attribution labels. Your handle (a 64-hex string) is derived from the source instance's master secret over your email; it cannot be re-derived on a different instance, so it doesn't bridge identity across forks. If you import this archive into a fork, your archived attribution appears as historical record — it cannot be "claimed" by re-deriving your handle.

## Reconstruction

The JSON files map directly to plato's DB schema (filtered to rows where you are author/voter/subscriber/mod). An importer reads them and inserts. Or: walk \`posts/*.md\` to extract plain markdown bodies; run them through any markdown engine for a static personal blog.

The canonical spec lives at \`docs/02-features/archive-format.md\` in the plato repository.
`;
}

// Main entry: build a per-user tarball Buffer.
//
// db          — open DB connection
// handle      — 64-hex user handle (the requester is the subject)
// options:
//   postsDir          — absolute path; resolves <post.file_path>
//   branding          — { forumName, baseUrl, ... }
//   platoVersion      — string from package.json
//   exportedAt        — Date instance (defaults to now)
//
// Throws if the handle has no row in `handles`.
export function buildUserArchiveBytes(db, handle, { postsDir, branding, platoVersion, exportedAt = new Date(), pubkeyFingerprint = null }) {
  const handleRow = db.prepare('SELECT * FROM handles WHERE handle = ?').get(handle);
  if (!handleRow) throw new Error(`buildUserArchiveBytes: handle ${handle.slice(0, 8)}… not found`);
  const pseudonym = handleRow.pseudonym;

  const posts = db.prepare(
    `SELECT * FROM posts WHERE handle = ? ORDER BY created_at ASC`
  ).all(handle);
  const comments = db.prepare(
    `SELECT c.*, p.sub_name AS sub_name
       FROM comments c JOIN posts p ON p.id = c.post_id
      WHERE c.handle = ? ORDER BY c.created_at ASC`
  ).all(handle);
  const votesCastRows = db.prepare(
    `SELECT target_type, target_id, value, created_at FROM votes WHERE handle = ?`
  ).all(handle);
  const subscriptions = db.prepare(
    `SELECT sub_name, created_at FROM subscriptions WHERE user_handle = ? ORDER BY sub_name ASC`
  ).all(handle);
  const subsOwned = db.prepare(
    `SELECT name AS sub_name, created_at, 'owner' AS role FROM subs WHERE owner_handle = ?`
  ).all(handle);
  const subsCoMod = db.prepare(
    `SELECT sub_name, role, NULL AS created_at FROM sub_mods WHERE handle = ?`
  ).all(handle);
  const subsModerated = [...subsOwned, ...subsCoMod];

  const modActionsReceived = db.prepare(
    `SELECT * FROM mod_actions WHERE target_type = 'handle' AND target_id = ?
       OR (target_type = 'post' AND target_id IN (SELECT id FROM posts WHERE handle = ?))
       OR (target_type = 'comment' AND target_id IN (SELECT id FROM comments WHERE handle = ?))
     ORDER BY created_at ASC`
  ).all(handle, handle, handle);
  const modActionsTaken = db.prepare(
    `SELECT * FROM mod_actions WHERE mod_handle = ? ORDER BY created_at ASC`
  ).all(handle);

  // Resolve mod-action actor pseudonyms (could be other mods).
  const otherHandles = new Set();
  for (const a of modActionsReceived) if (a.mod_handle && a.mod_handle !== handle) otherHandles.add(a.mod_handle);
  for (const a of modActionsTaken) if (a.target_type === 'handle') otherHandles.add(a.target_id);
  const otherPseudonyms = new Map();
  if (otherHandles.size > 0) {
    const list = [...otherHandles];
    const rows = db.prepare(
      `SELECT handle, pseudonym FROM handles WHERE handle IN (${list.map(() => '?').join(',')})`
    ).all(...list);
    for (const r of rows) otherPseudonyms.set(r.handle, r.pseudonym);
  }

  // ---- JSON files ----
  const postsJson = JSON.stringify(posts.map((p) => ({
    id: p.id,
    sub_name: p.sub_name,
    handle: p.handle,
    pseudonym,
    title: p.title,
    created_at: p.created_at,
    edited_at: p.edited_at ?? null,
    score: p.score,
    sensitive: !!p.sensitive,
    flair_slug: p.flair_slug ?? null,
    collapsed_at: p.collapsed_at ?? null,
    removed_at: p.removed_at ?? null,
  })), null, 2);

  const commentsJson = JSON.stringify(comments.map((c) => ({
    id: c.id,
    post_id: c.post_id,
    sub_name: c.sub_name,
    parent_comment_id: c.parent_comment_id ?? null,
    handle: c.handle,
    pseudonym,
    body: c.body,
    created_at: c.created_at,
    edited_at: c.edited_at ?? null,
    score: c.score,
    collapsed_at: c.collapsed_at ?? null,
    removed_at: c.removed_at ?? null,
  })), null, 2);

  // votes_cast.json — keyed by target, value = +1/-1, with cast_at.
  const votesCast = {};
  for (const v of votesCastRows) {
    votesCast[`${v.target_type}:${v.target_id}`] = { value: v.value, cast_at: v.created_at };
  }
  const votesCastJson = JSON.stringify(votesCast, null, 2);

  const subscriptionsJson = JSON.stringify(subscriptions, null, 2);
  const subsModeratedJson = JSON.stringify(subsModerated, null, 2);

  const modActionsReceivedJson = JSON.stringify(modActionsReceived.map((a) => ({
    id: a.id,
    sub_name: a.sub_name,
    mod_handle: a.mod_handle ?? null,
    mod_pseudonym: a.mod_handle ? (otherPseudonyms.get(a.mod_handle) ?? (a.mod_handle === handle ? pseudonym : null)) : null,
    action: a.action,
    target_type: a.target_type,
    target_id: a.target_id,
    reason: a.reason ?? null,
    created_at: a.created_at,
  })), null, 2);

  const modActionsTakenJson = JSON.stringify(modActionsTaken.map((a) => ({
    id: a.id,
    sub_name: a.sub_name,
    mod_handle: a.mod_handle ?? null,
    mod_pseudonym: pseudonym,
    action: a.action,
    target_type: a.target_type,
    target_id: a.target_id,
    target_pseudonym: a.target_type === 'handle' ? (otherPseudonyms.get(a.target_id) ?? null) : null,
    reason: a.reason ?? null,
    created_at: a.created_at,
  })), null, 2);

  // ---- Per-post .md (read from disk) and .html (rendered) ----
  const indexHtml = htmlPage({
    title: `${pseudonym || handle.slice(0, 8)} — personal archive`,
    cssHref: 'archive.css',
    body: renderIndexHtml({
      pseudonym, handle, posts, comments,
      instance: { forum_name: branding.forumName, base_url: branding.baseUrl ?? '' },
    }),
  });

  const exportedAtIso = exportedAt.toISOString();
  // Manifest's `counts` shape is fixed to {posts, comments, mod_actions, subs}
  // by the spec; mod_actions is the total observed (received + taken) and
  // subs is the union of subscribed + moderated, so the four numbers tell
  // the importer "how big is this archive."
  const counts = {
    posts: posts.length,
    comments: comments.length,
    mod_actions: modActionsReceived.length + modActionsTaken.length,
    subs: new Set([...subscriptions.map((s) => s.sub_name), ...subsModerated.map((s) => s.sub_name)]).size,
  };
  // Extended counts for the README only — not part of the manifest contract.
  const readmeCounts = {
    ...counts,
    votes_cast: votesCastRows.length,
    subscriptions: subscriptions.length,
    subs_moderated: subsModerated.length,
    mod_actions_received: modActionsReceived.length,
    mod_actions_taken: modActionsTaken.length,
  };
  const readmeMd = buildReadme({
    pseudonym, handle,
    instance: { forum_name: branding.forumName, base_url: branding.baseUrl ?? '' },
    exportedAtIso, counts: readmeCounts,
  });

  // ---- Assemble file entries ----
  const files = [];
  for (const p of posts) {
    const md = readFileSync(resolve(postsDir, p.file_path.replace(/^posts\//, '')), 'utf8');
    files.push({ path: `posts/${p.id}.md`, body: md });
    const renderedHtml = htmlPage({
      title: `${p.title} — //${p.sub_name}`,
      cssHref: '../archive.css',
      body: renderPostHtml({
        post: p,
        postBody: md.replace(/^---[\s\S]*?---\n+/, ''),
        pseudonym,
        subName: p.sub_name,
      }),
    });
    files.push({ path: `posts/${p.id}.html`, body: renderedHtml });
  }
  files.push({ path: 'posts.json', body: postsJson });
  files.push({ path: 'comments.json', body: commentsJson });
  files.push({ path: 'votes_cast.json', body: votesCastJson });
  files.push({ path: 'subscriptions.json', body: subscriptionsJson });
  files.push({ path: 'subs_moderated.json', body: subsModeratedJson });
  files.push({ path: 'mod_actions_received.json', body: modActionsReceivedJson });
  files.push({ path: 'mod_actions_taken.json', body: modActionsTakenJson });
  files.push({ path: 'index.html', body: indexHtml });
  files.push({ path: 'archive.css', body: ARCHIVE_CSS });
  files.push({ path: 'README.md', body: readmeMd });

  const fileEntries = files.map((f) => {
    const buf = Buffer.from(f.body, 'utf8');
    return { path: f.path, sha256: sha256Hex(buf), size: buf.length };
  });
  const manifest = buildManifest({
    kind: 'user',
    // scope.handle_attribution is the pseudonym (public identity), not the
    // handle (private derivation). Spec lock — see manifest.js validator.
    scope: { handle_attribution: pseudonym ?? handle.slice(0, 8) },
    instance: {
      forum_name: branding.forumName,
      base_url: branding.baseUrl ?? '',
      pubkey_fingerprint: pubkeyFingerprint,
    },
    exportedAt: exportedAtIso,
    platoVersion,
    counts,
    files: fileEntries,
  });
  const manifestJson = JSON.stringify(manifest, null, 2);

  const tarEntries = [
    ...files.map((f) => ({ path: f.path, body: f.body })),
    { path: 'manifest.json', body: manifestJson },
  ];
  return writeTar(tarEntries, { defaultMtime: exportedAt.getTime() });
}

// Filename for the user archive. Uses the first 8 hex chars of the handle
// as a stable but non-reversible identifier so the filename doesn't leak
// the full handle on disk listings or download URLs. Optional `jobId`
// (first 8 chars used) prevents two same-day builds for the same user
// from overwriting each other if the queue-side dedupe ever misses
// — defense-in-depth; the dedupe should normally make this redundant.
export function userArchiveFilenameFor(handle, exportedAt = new Date(), { jobId = null } = {}) {
  const yyyymmdd = exportedAt.toISOString().slice(0, 10);
  const tag = typeof jobId === 'string' && jobId.length >= 8
    ? `-${jobId.slice(0, 8)}`
    : '';
  return `plato-export-user-${handle.slice(0, 8)}-${yyyymmdd}${tag}.tar.gz`;
}
