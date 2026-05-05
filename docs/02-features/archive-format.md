# plato archive format (v1)

This is the canonical specification for plato's export/import archive format. Everything an archive contains, everything it does not, and the file conventions you can rely on.

The audience is both humans and AI assistants. If you are an AI helping a user reconstruct or transform an archive, this document gives you the schema; you do not need to guess.

> **Status:** v1, M7/B1. Identity / signing / OpenTimestamps anchoring are deferred to M7/B4 and M7/B6 — see *Future layers* at the end of this doc. Adding them does not change the shapes defined here.

## Purpose

Plato is forkable, and a user's contribution to a forum is theirs. The archive is the interop affordance — a single artifact that lets you:

- **Migrate** to another plato instance (cross-instance import — M7/B5).
- **Back up** your contribution and read it offline forever, no plato install needed.
- **Audit** what was published and when, with cryptographic verification (M7/B4 onward).

Three audiences. Three affordances. The format below serves all three at once.

## Top-level shape

A plato archive is a directory tree, conventionally distributed as a tarball:

```
plato-export-<scope>-<YYYY-MM-DD>/
├── README.md                # in-archive spec (generated from this doc)
├── manifest.json            # inventory + per-file SHA-256
├── index.html               # static reader entry — open in any browser
├── archive.css              # static reader styling, ~100 lines, no JS
├── posts/
│   ├── <id>.md              # post source (frontmatter + markdown body)
│   ├── <id>.html            # post rendered for the static reader
│   └── ...
├── posts.json               # per-post DB metadata (score, sensitive, flair, edits)
├── comments.json            # flat array of all comments, threaded via parent_comment_id
├── modlog.json              # public moderator actions on the scoped content
├── votes.json               # vote tallies (NOT per-voter — see Privacy posture)
└── subs.json                # sub metadata (one entry per scoped sub)
```

The same shape is produced by per-sub and per-user exports. The difference is *what* the scope filter selects, not the file layout.

## Archive kinds

Two `kind` values are produced by the export endpoints:

- `kind: "sub"` — every published post, comment, mod action, and vote tally for one sub. `subs.json` has exactly one entry.
- `kind: "user"` — every published post and comment authored by one handle, across every sub. `subs.json` has one entry per sub the user posted in (with attribution-only metadata, since the export does not own those subs).

The manifest's `scope` field disambiguates which is which.

## File conventions

### `manifest.json`

The canonical inventory and the entry point for any importer. JSON, UTF-8, no comments.

```jsonc
{
  "format_version": 1,                          // bumps for breaking shape changes
  "plato_version": "0.6.0",                     // string, informational
  "kind": "sub",                                // "sub" | "user"
  "scope": { "sub": "lobby" },                  // {"sub": "<name>"} or {"handle_attribution": "<pseudonym>"}
  "exported_at": "2026-05-05T12:34:56Z",        // ISO 8601 UTC
  "instance": {
    "forum_name": "example forum",              // string, branding.forumName
    "base_url": "https://example.com",          // canonical instance URL
    "pubkey_fingerprint": null                  // populated in M7/B4; null in v1
  },
  "counts": {
    "posts": 142,
    "comments": 891,
    "mod_actions": 17,
    "subs": 1
  },
  "files": [
    { "path": "posts/abc123def4567890.md",   "sha256": "<64-hex>", "size": 1843 },
    { "path": "posts.json",                  "sha256": "<64-hex>", "size":  9217 },
    // ... every non-derived file in the archive
  ]
}
```

**Hashing rule:** `files[].sha256` is the SHA-256 of the file's bytes as written. `index.html`, `archive.css`, and `posts/<id>.html` are derived presentations and are listed in `files[]` for diagnostics but are NOT load-bearing for import — an importer ignores them.

**format_version contract:** v1 archives must remain readable by all future plato versions. Breaking changes to this spec increment the version and ship a new doc.

### `posts/<id>.md`

Source-of-truth post body. The on-disk format used by live plato, preserved verbatim.

```markdown
---
title: "post title with quotes if needed"
handle: <64-hex HMAC-derived handle>
sub_name: <sub-name>
created_at: 1762345678901
---

post body in markdown.

multiple paragraphs are fine.
```

- **Filename:** `<id>.md` where `<id>` is a 16-hex character post ID (URL-safe, lowercase). Stable across instances.
- **Frontmatter:** YAML-ish, four lines, machine-parseable. `title` is JSON-string-quoted (handles internal quotes); `handle`, `sub_name`, `created_at` are bare values.
- **Body:** plato-flavored markdown. Image-markdown was rewritten as a link at post time (plato does not host images; see operator-guide). HTML is escaped at render time, not at storage time — the raw markdown is what's in the file.

> Note: the on-disk frontmatter is intentionally minimal. Extended per-post metadata (score, sensitive flag, flair, edit timestamps, mod state) lives in `posts.json` keyed by `id`.

### `posts.json`

Array of objects, one per post in the archive. The DB row's full shape, minus columns derived elsewhere:

```jsonc
[
  {
    "id": "abc123def4567890",
    "sub_name": "lobby",
    "handle": "<64-hex>",                    // raw handle, for cross-referencing
    "pseudonym": "alice-2x9k",               // attribution label; see Identity model
    "title": "post title",
    "created_at": 1762345678901,             // unix ms
    "edited_at": null,                       // unix ms or null
    "score": 4.5,                            // cached vote sum (real, half-weights)
    "sensitive": false,                      // post-level sensitive flag (NOT sub-level)
    "flair_slug": null,                      // string or null
    "collapsed_at": null,                    // unix ms or null (mod soft-fold)
    "removed_at": null,                      // unix ms or null (mod hard-fold)
    "score_at_collapse": null,               // see auto-uncollapse migration 005
    "comment_count": 12                      // computed at export time, redundant but useful
  }
  // ...
]
```

**Mod state fields are preserved.** A removed post's body is in the archive (the file is still there), but `removed_at` is set so importers and readers can render it correctly. The public modlog (`modlog.json`) carries the *why*. This is consistent with plato's "removals are public, not memory-holed" posture.

### `comments.json`

Flat array of all comments. Threading is reconstructed by the reader via `parent_comment_id`.

```jsonc
[
  {
    "id": "<16-hex>",
    "post_id": "<16-hex>",
    "parent_comment_id": "<16-hex> | null",  // null = top-level reply
    "handle": "<64-hex>",
    "pseudonym": "alice-2x9k",
    "body": "comment text in markdown",
    "created_at": 1762345678901,
    "edited_at": null,
    "score": 1.0,
    "collapsed_at": null,
    "removed_at": null,
    "score_at_collapse": null
  }
  // ...
]
```

Comment bodies are stored inline in JSON (no per-comment file). At plato's hobby scale this is operationally simpler than a folder per post; a 100k-comment archive is still a single ~30MB JSON file.

### `modlog.json`

The public mod-actions log, scoped to the archive's content.

```jsonc
[
  {
    "id": "<16-hex>",
    "sub_name": "lobby",
    "mod_handle": "<64-hex>",                // handle of the moderator who acted
    "mod_pseudonym": "mod-name",
    "action": "remove",                      // see canonical list below
    "target_type": "post",                   // "post" | "comment" | "handle"
    "target_id": "<16-hex or 64-hex handle>",
    "reason": "off-topic" | null,
    "created_at": 1762345678901
  }
  // ...
]
```

**Canonical actions:** `collapse`, `uncollapse`, `remove`, `unremove`, `ban`, `unban`, `promote_mod`, `demote_mod`, `transfer_owner`. Importers must accept new action values without erroring (forward-compatibility).

### `votes.json`

**Tallies only — never per-voter.** Plato does not include the (handle → vote) mapping in archives; revealing it would let a recipient reconstruct who downvoted whom. The export carries enough to render scores and verify integrity, nothing more.

```jsonc
{
  "post:abc123def4567890": { "up": 6, "down": 1, "score": 4.5 },
  "comment:fed987abc6543210": { "up": 1, "down": 0, "score": 1.0 }
  // ...
}
```

Keys are `<target_type>:<target_id>`. `up` and `down` are integer counts; `score` is the cached real (per plato's half-weight rule for new accounts).

### `subs.json`

Array of one or more sub-metadata objects.

```jsonc
[
  {
    "name": "lobby",
    "description": "the general lobby",
    "owner_handle": "<64-hex> | null",
    "owner_pseudonym": "owner-name | null",
    "default_sort": "new",
    "created_at": 1762345678901,
    "sensitive": false,
    "flairs": [
      { "slug": "discussion", "label": "Discussion", "color": "#cccccc" }
    ],
    "flairs_required": false,
    "flag_threshold": 3,
    "auto_uncollapse_post": 50,
    "auto_uncollapse_comment": 20
  }
]
```

For `kind: "user"` exports, each sub the user posted in appears here with attribution-only fields (the operator's settings still belong to that operator, but a reader needs the description and flair definitions to render the user's content correctly).

### `index.html`, `posts/<id>.html`, `archive.css`

Generated at export time from the source `.md`/`.json` files. The static reader.

- **No JavaScript.** No vote widgets, no forms, no interactivity. Read-only.
- **No external assets.** Self-contained; works offline.
- **Single CSS file.** `archive.css` is ~100 lines, monospace-by-default, plato-voice but reduced. Forks rebrand by overwriting it.
- **`index.html`** lists posts (newest-first by default), with title, pseudonym, date, and comment count linking to `posts/<id>.html`.
- **`posts/<id>.html`** renders the full post body (markdown → HTML through plato's allow-list pipeline, identical to the live forum) followed by the threaded comment tree.

The HTML layer is a *presentation* of the source files. An importer or transformer never reads them; only humans do.

### `README.md`

Auto-generated at export time. Contains a condensed version of this spec, written for the user opening the archive *and* for any AI assistant they paste the README into. Sections:

1. What this is, who exported it, when.
2. File tree with cardinality.
3. Schemas (the same JSON shapes documented above, inline).
4. Identity model (pseudonyms are attribution labels, not portable accounts).
5. What is NOT in the archive (privacy posture — see below).
6. How to view: open `index.html`.
7. Reconstruction recipes (paste-ready prompts for "convert to a static blog", "render as PDF", "extract post bodies as plain text", etc.).
8. Verification (how to check signature — populated when M7/B4 ships).

The README is the single document a user or AI needs in order to understand and transform the archive without reading anything else.

## Identity model in archives

Pseudonyms are **deliberately not portable across instances** (see PRD §Permanently out → "Cross-instance identity portability"). A handle in this archive is an HMAC-SHA256 of the source instance's master secret over the user's email. A different instance has a different master secret, so the handle hex string is meaningless on import.

What this means for archives:

- **`handle` fields are preserved** in `posts.json`, `comments.json`, and `modlog.json`. They are *opaque identifiers* on the source instance. An importer treats them as such — they may correlate authorship within the archive but never bridge to handles on a different instance.
- **`pseudonym` fields are preserved** as static attribution labels. "alice-2x9k said: ..." stays in the export. On import, those pseudonyms appear as historical attribution; they cannot be claimed.
- **No email, ever.** Plato never stores email plaintext (PRD §Authentication). The archive cannot reveal one.

A user moving to a new plato instance gets a fresh pseudonym derived under that instance's master secret. Their old archive's pseudonym appears only as historical attribution.

## Privacy posture: what is NOT in this archive

Explicitly missing, by design:

- **Email addresses.** Not stored anywhere in plato; cannot be exported.
- **Per-voter vote map.** `votes.json` carries tallies, not the (voter → target) mapping. Revealing who downvoted what is out of scope.
- **Subscriber lists.** Subscriptions are personal preferences, not part of the public record.
- **Drafts.** Unpublished content is not part of the user's contribution.
- **Flag entries.** Flags are private mod queue state. The `modlog.json` carries *resolved* mod actions only.
- **IP addresses, session tokens, magic-link tokens.** None of these are part of plato's persisted state in any form an export could touch.
- **Operator config.** `config.json`, branding, rate-limit overrides — all instance-operator concerns, not user content.

If a recipient or importer wants any of the above, they will not find it. The archive's silence on these is itself a security property.

## Reconstruction patterns (informative)

These are not required by the format. They illustrate what the schema enables.

- **Static blog.** Walk `posts.json` newest-first; for each post, render `posts/<id>.md` body through any markdown engine; threading the comment tree from `comments.json`. The provided `index.html` already does this; this is the same path adapted to a different theme.
- **PDF / EPUB.** Same walk; emit to a paginated format. AI assistants can do this directly from the README + the source files.
- **SQL re-import.** The four JSON files (`posts.json`, `comments.json`, `modlog.json`, `votes.json`) plus `subs.json` map directly to plato's DB schema. An importer reads them, re-derives handles under its own master secret, and inserts.
- **Plain text.** `cat posts/*.md` after stripping frontmatter gives a plaintext concatenation in filename order.

## Future layers (deferred)

Not part of v1. Documented here so the format is forward-compatible.

- **M7/B4 — signing.** A detached Ed25519 signature `<archive-name>.tar.gz.sig` will accompany the tarball. The signed bytes are the tarball's bytes (not its file contents). A `pubkey_fingerprint` field in `manifest.json.instance` will be populated; the corresponding public key surfaces at `/.well-known/plato-pubkey` on the source instance. Verification is independent: the v1 archive shape does not need to know that signing exists.
- **M7/B6 — OpenTimestamps anchor.** The hash anchored to Bitcoin is at the operator's discretion: per-archive (single anchor proves the whole bundle existed before timestamp T) or per-file via the manifest's `files[].sha256` (more granular, more anchors to manage). The format accommodates either; the manifest's per-file hashes already exist for diagnostics, so adding per-file anchoring later is purely additive.

The choice of granularity (per-archive vs per-md vs per-post) is deferred and does not affect this spec.

---

**Format version:** 1
**Spec last updated:** 2026-05-05 (M7/B1)
**Authoritative source:** this file. The in-archive `README.md` is generated from it; if the two ever disagree, this file wins.
