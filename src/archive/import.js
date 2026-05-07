// Sub-import builder (M7/B5).
//
// Takes a parsed archive (Map<path, Buffer>) and a destination DB; inserts
// the sub, its handles, posts, comments, mod actions, and writes the
// markdown post bodies to disk under postsDir.
//
// Pure-ish — does talk to the DB and the filesystem, but no HTTP, no
// signature verification, no cron. Worker (bin/run-import-queue.js) wraps
// this with the URL fetch + queue plumbing.
//
// The flow:
//   1. Parse manifest.json + posts.json + comments.json + modlog.json + subs.json + votes.json.
//   2. Verify per-file SHA-256 against the manifest (transit integrity).
//   3. Resolve destination sub name (rename_to or scope.sub); refuse if taken.
//   4. Insert handles for every (handle, pseudonym) pair the archive
//      references — preserving archived pseudonyms verbatim, OR wrapping
//      the lexical part in brackets on collision (donkey-tiger →
//      [donkey]-tiger). Imported handles are marked with
//      imported_from_fingerprint so they're permanently unclaimable.
//   5. Insert the sub row with imported_from_url / imported_from_fingerprint
//      / imported_at / imported_at_source set, owner_handle = importer.
//   6. Insert posts with original IDs, timestamps, scores. Copy
//      posts/<id>.md from the archive into postsDir.
//   7. Insert comments with original IDs.
//   8. Insert mod_actions with imported_from_fingerprint set so the
//      modlog renderer can prepend "[imported]" to the action label.
//
// Errors abort the whole import — the caller is responsible for wrapping
// in a transaction. We don't BEGIN here so the worker can choose its
// own boundaries.

import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { sha256Hex, validateManifest } from './manifest.js';
import { readTar } from './extract.js';
import { recordSubImport } from '../content/mod.js';

// Pseudonym format from src/identity/pseudonym.js: "<adjective>-<animal>"
// (two unique-names-generator words separated by a single hyphen). On
// collision with an existing pseudonym on this instance, wrap the
// whole pseudonym in brackets — donkey-tiger → [donkey-tiger]. The
// brackets are the visual signal "this name traveled from another
// instance"; full-bracket reads cleanly as one bracketed token rather
// than ambiguous half-decoration. PRD §Exit as the real check
// (M7 followup lock — full-bracket).
//
// Returns { value, bracketed: boolean }. If even the bracketed form
// collides, append a numeric suffix (e.g. [donkey-tiger]-2). Throws
// only on extreme exhaustion (>100 attempts), which is operationally
// impossible at hobby scale.
export function pseudonymForImport(db, archivedPseudonym) {
  const existing = db.prepare('SELECT 1 FROM handles WHERE pseudonym = ?').get(archivedPseudonym);
  if (!existing) return { value: archivedPseudonym, bracketed: false };

  const bracketed = `[${archivedPseudonym}]`;
  for (let i = 1; i < 100; i++) {
    const candidate = i === 1 ? bracketed : `${bracketed}-${i}`;
    const collide = db.prepare('SELECT 1 FROM handles WHERE pseudonym = ?').get(candidate);
    if (!collide) return { value: candidate, bracketed: true };
  }
  throw new Error(`pseudonymForImport: bracket-disambiguation exhausted for ${archivedPseudonym}`);
}

// Parse the archive bytes into the canonical structures + verify per-file
// SHA-256s against the manifest. Returns
// { manifest, sub, posts, comments, modlog, votes, postBodies: Map<id, Buffer> }.
// Throws on schema, hash, or shape failure.
export function parseAndVerifyArchive(tarBuf) {
  const entries = readTar(tarBuf);

  const manifestEntry = entries.get('manifest.json');
  if (!manifestEntry) throw new Error('import: archive has no manifest.json');
  let manifest;
  try { manifest = JSON.parse(manifestEntry.toString('utf8')); }
  catch (err) { throw new Error(`import: manifest.json is not valid JSON: ${err.message}`); }
  validateManifest(manifest);
  if (manifest.kind !== 'sub') {
    throw new Error(`import: only kind=sub archives are importable (got kind=${manifest.kind})`);
  }

  // Verify hashes for every file the manifest claims.
  for (const f of manifest.files) {
    const e = entries.get(f.path);
    if (!e) throw new Error(`import: manifest references missing file ${f.path}`);
    if (e.length !== f.size) {
      throw new Error(`import: ${f.path} size mismatch (manifest=${f.size}, actual=${e.length})`);
    }
    if (sha256Hex(e) !== f.sha256) {
      throw new Error(`import: ${f.path} sha256 mismatch — archive corrupt`);
    }
  }

  const subs = JSON.parse(entries.get('subs.json').toString('utf8'));
  if (!Array.isArray(subs) || subs.length !== 1) {
    throw new Error(`import: subs.json must have exactly one entry (got ${Array.isArray(subs) ? subs.length : 'non-array'})`);
  }
  const sub = subs[0];
  if (sub.name !== manifest.scope.sub) {
    throw new Error(`import: subs.json[0].name (${sub.name}) does not match manifest.scope.sub (${manifest.scope.sub})`);
  }

  const posts = JSON.parse(entries.get('posts.json').toString('utf8'));
  const comments = JSON.parse(entries.get('comments.json').toString('utf8'));
  const modlog = JSON.parse(entries.get('modlog.json').toString('utf8'));
  const votes = JSON.parse(entries.get('votes.json').toString('utf8'));

  const postBodies = new Map();
  for (const p of posts) {
    const body = entries.get(`posts/${p.id}.md`);
    if (!body) throw new Error(`import: posts/${p.id}.md is referenced in posts.json but missing from archive`);
    postBodies.set(p.id, body);
  }

  return { manifest, sub, posts, comments, modlog, votes, postBodies };
}

// Strip the YAML-ish frontmatter from a post body before persisting on
// disk under THIS instance's posts/ tree. The frontmatter from the source
// instance includes its handle (HMAC-derived under a different secret)
// and its sub_name; we'd need to rewrite both. Instead we keep the
// frontmatter as part of the on-disk file — it's the source-of-truth
// snapshot, and live plato reads body via DB columns rather than
// re-parsing the file. The .md is preserved as-is for archive-of-archive
// consistency.
function postFilePathFor(post) {
  // Mirrors the live plato path shape: posts/<YYYY-MM-DD>-<id>.md.
  // This makes posts.file_path UNIQUE constraint hold even if two
  // imported posts share an id (which they shouldn't, but if they do
  // the ID PK collision will fire first).
  const ymd = new Date(post.created_at).toISOString().slice(0, 10);
  return `posts/${ymd}-${post.id}.md`;
}

// Insert a single sub-archive into `db`. Caller wraps in a transaction.
//
// Returns { subName, counts: {handles, posts, comments, modActions, bracketed} }.
// Throws on:
//   - destination sub name taken (and no rename_to provided),
//   - PK collision on imported post/comment/mod_action ID,
//   - bracket-disambiguation exhaustion (extremely rare).
//
// `sourceUrl` is the URL the worker actually fetched (the chain-of-
// custody record). Stored as subs.imported_from_url so the imported
// banner can display where the bytes came from. Optional — falls back
// to the manifest's instance.base_url when omitted, which may be empty
// if the source operator hadn't set branding.baseUrl.
export function importSubArchive(db, { parsed, postsDir, importerHandle, renameTo = null, sourceUrl = null, now = Date.now() }) {
  const { manifest, sub, posts, comments, modlog, postBodies } = parsed;
  const sourceFp = manifest.instance.pubkey_fingerprint ?? null;

  // 1. Resolve destination name.
  const destName = renameTo ?? sub.name;
  if (!/^[a-z0-9-]{3,30}$/.test(destName)) {
    throw new Error(`import: destination name "${destName}" doesn't match plato sub-name format`);
  }
  const collide = db.prepare('SELECT 1 FROM subs WHERE name = ?').get(destName);
  if (collide) throw new Error(`import: destination sub name "${destName}" is already in use on this instance`);

  // 2. Insert handles for every author that appears in the archive.
  // Uses pseudonymForImport for collision handling. A handle that already
  // exists on this instance (e.g., from a previous import of a different
  // sub from the same source) is reused as-is; we don't double-insert.
  const handlesNeeded = new Set();
  for (const p of posts) handlesNeeded.add(p.handle);
  for (const c of comments) handlesNeeded.add(c.handle);
  for (const a of modlog) if (a.mod_handle) handlesNeeded.add(a.mod_handle);
  if (sub.owner_handle) handlesNeeded.add(sub.owner_handle);

  const archivedPseudonyms = new Map(); // handle → archived pseudonym
  for (const p of posts) archivedPseudonyms.set(p.handle, p.pseudonym ?? p.handle.slice(0, 8));
  for (const c of comments) archivedPseudonyms.set(c.handle, c.pseudonym ?? c.handle.slice(0, 8));
  for (const a of modlog) {
    if (a.mod_handle && !archivedPseudonyms.has(a.mod_handle)) {
      archivedPseudonyms.set(a.mod_handle, a.mod_pseudonym ?? a.mod_handle.slice(0, 8));
    }
  }
  if (sub.owner_handle && !archivedPseudonyms.has(sub.owner_handle)) {
    archivedPseudonyms.set(sub.owner_handle, sub.owner_pseudonym ?? sub.owner_handle.slice(0, 8));
  }

  let bracketedCount = 0;
  let insertedHandles = 0;
  const handleInsert = db.prepare(
    `INSERT INTO handles (handle, pseudonym, first_seen_at, imported_from_fingerprint)
     VALUES (?, ?, ?, ?)`
  );
  for (const h of handlesNeeded) {
    const exists = db.prepare('SELECT 1 FROM handles WHERE handle = ?').get(h);
    if (exists) continue;
    const archivedPs = archivedPseudonyms.get(h) ?? h.slice(0, 8);
    const { value: ps, bracketed } = pseudonymForImport(db, archivedPs);
    if (bracketed) bracketedCount++;
    handleInsert.run(h, ps, now, sourceFp);
    insertedHandles++;
  }

  // 3. Insert sub row. Owner is the importing user. Imported metadata is
  // recorded so /sub/<name> can render the imported badge.
  const sourceExportedAtMs = Date.parse(manifest.exported_at);
  if (!Number.isFinite(sourceExportedAtMs)) {
    throw new Error(`import: manifest.exported_at is not a valid timestamp (${manifest.exported_at})`);
  }
  db.prepare(
    `INSERT INTO subs (
       name, description, owner_handle, default_sort, created_at,
       sensitive, flairs, flairs_required, flag_threshold,
       auto_uncollapse_post, auto_uncollapse_comment, disabled_at,
       imported_from_url, imported_from_fingerprint, imported_at, imported_at_source
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    destName,
    sub.description ?? '',
    importerHandle,
    sub.default_sort ?? 'new',
    sub.created_at ?? now,
    sub.sensitive ? 1 : 0,
    JSON.stringify(sub.flairs ?? []),
    sub.flairs_required ? 1 : 0,
    sub.flag_threshold ?? 3,
    sub.auto_uncollapse_post ?? 50,
    sub.auto_uncollapse_comment ?? 20,
    null, // not disabled — the importer is now the active mod
    sourceUrl ?? manifest.instance.base_url ?? null,
    sourceFp,
    now,
    sourceExportedAtMs,
  );
  // Importer becomes the sub's mod via sub_mods (matching the
  // create-flow shape).
  db.prepare(
    `INSERT INTO sub_mods (sub_name, handle, role) VALUES (?, ?, 'owner')`
  ).run(destName, importerHandle);

  // 4. Posts. Preserve IDs, scores, all flags. Files written to disk.
  mkdirSync(postsDir, { recursive: true });
  const postInsert = db.prepare(
    `INSERT INTO posts (
       id, sub_name, handle, title, file_path, created_at,
       score, edited_at, flair_slug, sensitive,
       collapsed_at, removed_at, score_at_collapse
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const p of posts) {
    const filePath = postFilePathFor(p);
    const bodyBuf = postBodies.get(p.id);
    writeFileSync(resolve(postsDir, filePath.replace(/^posts\//, '')), bodyBuf);
    postInsert.run(
      p.id, destName, p.handle, p.title, filePath, p.created_at,
      p.score ?? 0, p.edited_at ?? null, p.flair_slug ?? null,
      p.sensitive ? 1 : 0,
      p.collapsed_at ?? null, p.removed_at ?? null, p.score_at_collapse ?? null,
    );
  }

  // 5. Comments. Threaded; SQLite handles parent_comment_id self-FK
  // ordering as long as parents come before children. The archive's
  // comments.json is already in created_at ASC order so parents land
  // first, but we don't depend on that — defer_foreign_keys = ON during
  // migration apply but live import runs with FKs enforced. Re-sort
  // defensively so the FK never fires.
  const sortedComments = [...comments].sort((a, b) => a.created_at - b.created_at);
  const commentInsert = db.prepare(
    `INSERT INTO comments (
       id, post_id, parent_comment_id, handle, body, created_at,
       score, edited_at, collapsed_at, removed_at, score_at_collapse
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const c of sortedComments) {
    commentInsert.run(
      c.id, c.post_id, c.parent_comment_id ?? null, c.handle, c.body, c.created_at,
      c.score ?? 0, c.edited_at ?? null,
      c.collapsed_at ?? null, c.removed_at ?? null, c.score_at_collapse ?? null,
    );
  }

  // 6. Mod actions. Each row carries imported_from_fingerprint so
  // /modlog can render "[imported]" prefixes.
  const modActionInsert = db.prepare(
    `INSERT INTO mod_actions (
       id, sub_name, mod_handle, action, target_type, target_id, reason, created_at,
       imported_from_fingerprint
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  for (const a of modlog) {
    modActionInsert.run(
      a.id, destName, a.mod_handle ?? null, a.action,
      a.target_type, a.target_id, a.reason ?? null, a.created_at,
      sourceFp,
    );
  }

  // Native modlog row crediting the importer for the import act
  // itself. Parallel to the export-side row written by recordSubExport
  // on completeJob (M7 followup). imported_from_fingerprint stays NULL
  // because this row was authored on this instance, not in the
  // incoming archive.
  recordSubImport(db, { subName: destName, importedBy: importerHandle, now });

  return {
    subName: destName,
    counts: {
      handles: insertedHandles,
      posts: posts.length,
      comments: comments.length,
      modActions: modlog.length,
      bracketed: bracketedCount,
    },
  };
}
