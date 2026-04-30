# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). plato has not yet shipped its first release; everything below is on the path to v1.

## [Unreleased]

### Added — M1 Foundation
- Project scaffolding: layered repo structure, idempotent SQL migrations runner, vanilla `node:http` server.
- HTML rendering: tagged-template `html\`\`` helper with safe-by-default escaping and `raw()` opt-out for trusted output (rendered markdown, inline SVG).
- Static-asset handler at `/static/*` with path-traversal protection.
- Initial schema (`handles`, `posts`, `drafts`) with foreign-key enforcement and STRICT typing.

### Added — M1 Auth
- Knowless library-mode integration. Forum derives identity via HMAC-SHA256 of the email; plaintext email is never stored.
- Configuration validation at boot: missing required environment fails fast with clear errors.
- Forking property: each instance has its own master secret, so the same email yields different pseudonym IDs across instances by design.

### Added — M1 Identity
- Deterministic two-word pseudonym generation, cached per handle, UNIQUE per instance.
- Collision retry uses crypto-random seeds (deterministic suffix retries had pathological collision chains in `unique-names-generator`'s seed→combo mapping).
- Deterministic identicon avatars (32×32 dicebear bottts-neutral SVG) — no uploads, ever.

### Added — M1 Markdown
- Secure rendering of post bodies. Raw HTML in source is escaped, never executed; image markdown is rewritten as a link (PRD §no inline embeds); URL schemes are allow-listed (`http(s)`, `mailto`, fragments, relatives) — `javascript:`, `data:`, `vbscript:`, `file:` are dropped.
- 11 lock-in security tests guard against silent regressions when marked upgrades.

### Added — M1 Content
- Post lifecycle: submit a draft, finalize after magic-link click, read posts back. Markdown body lives on disk as `posts/<date>-<id>.md` with frontmatter; the database is the index, regenerable from the file tree.
- Atomic finalize: post insert + draft update happen in a single transaction. Idempotent — re-finalizing an already-finalized draft returns the existing post id.
- XSS protections from `renderMarkdown` carry through end-to-end (verified by an integration test that puts `<script>` and `javascript:` URLs through the full draft → finalize → render path).

### Added — M1 Disposable-domain blocklist
- Forum-side disposable-email domain check (PRD spam rule 7). Blocked at form submission, before knowless is invoked. Operator owns the blocklist file; M5 adds the cron sync to the upstream community-maintained list.

### Changed
- Repository renamed from `plato-forum` to `plato`. Documentation and code now live in one repository.
- POC graduated and was archived. Phase 2 implementation started in a clean repository per AGENT_RULES POC discipline.
