# Changelog

All notable changes to this project are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). plato has not yet shipped its first release; everything below is on the path to v1.

## [Unreleased]

(no entries yet — next: any post-0.12.1 fixes land here before the next bump)

## [0.12.1] - 2026-05-10 — post-0.12.0 mobile follow-ups: `[in]` on mod-subs, `edit` matches mod verbs, deploy-guide tightening

Three follow-ups surfaced once 0.12.0 was live on terribic. Each was a small fix that fell out of actually using the new mobile surface.

### Fixed — `[in]` chip now renders on subs you mod (you're subscribed to those too)

The 0.12.0 render condition was `subscribedSet.has(s.name) && !modSet.has(s.name)`, suppressing the chip for mod-subs on the reasoning that mods can't unsubscribe while modding (the unsubscribe button is disabled) so the chip "carries no actionable info." That reasoning ignored the data layer: mods are auto-subscribed at sub creation (`src/content/sub.js:113`) and stay subscribed if they step down (`mod.js:142`). So a mod-sub really is in your subscribed set; the UI was hiding a true fact. The `>` (you mod this) and `[in]` (you're subscribed) indicators carry orthogonal information and a mod-sub is both. Dropped the `!modSet.has(s.name)` clause — one-line template fix.

### Fixed — `edit` link rendered as outlined pill while `collapse · remove · ban` rendered as warm text verbs (visual mismatch in one strip)

The 0.12.0 mod-controls redesign updated `.mod-btn` to warm-accent text verbs but left `.action-link` (the broader sibling used by author `edit`, sub-admin verbs on `/sub/<n>/edit`, and the modlog `revoke` button) at its pre-redesign outlined-pill chrome. Result on a post-feed row where the viewer is both author and mod: `[edit]  collapse · remove · ban` — one strip, two visual registers. Unified `.action-link` with `.mod-btn`: drop the border/padding/radius, switch color from `--text-dim` to `--accent-warm`, dotted-underline hover. Scope note: `/sub/manage` action-links are wrapped in `.inline-confirm` which provides its own blue-pill chrome — those rules win on specificity, so that surface intentionally stays as blue pills (a deliberate separate visual family for sub-admin actions, not part of this change). Modlog audit `revoke` button has no wrapper, so it inherits the new warm-verb treatment — consistent with the rest of the modlog row's mod actions.

### Documented — deploy-guide gets a one-shot upgrade bundle option and a `?v=N` cache-token verify step

Two gaps surfaced from the 0.12.0 deploy session against terribic. (1) The stepwise upgrade form has 4 separate `sudo -u plato -H` invocations; routine bumps are cleaner as a single `&&`-chained bundle that short-circuits on failure. Added as an option after the stepwise form (the stepwise stays the canonical recipe for cautious deploys). (2) The verify block used `${DOMAIN}` shell-template form, which works during initial deploy when the var was set in earlier sections but silently resolves to `https://.healthz` for a routine bump months later in a fresh shell. Hardcoded `terribic.com` in the example (operators on other instances substitute, same convention as elsewhere in the guide). Also added a `?v=N` cache-token check — a 200 on the new style.css token after deploy proves the running server is serving the new CSS, not stale bytes from a CDN or local cache. Useful for CSS-bumping releases like 0.12.0 where "version says new but layout looks old" is the failure mode that worried users would report.

### Files touched

- `src/web/app.js` — drop `!modSet.has(s.name)` from `[in]` render condition, style.css cache `v=48 → v=49`
- `src/web/static/style.css` — `.action-link` switched from outlined pill to warm-accent text verb, matching `.mod-btn`
- `docs/02-features/deploy-guide.md` — one-shot bundle option + hardcoded verify URL + `?v=N` cache-token paragraph

## [0.12.0] - 2026-05-10 — mobile mod-surface pass: actions wrap below title, modlog card-stack, `[in]` chip, warm-accent verbs

Driven by a Firefox mobile-view session reviewing posts on terribic. Three mobile-readability gaps the desktop layout doesn't have: collapse/remove buttons crushed long titles into 4–5 lines next to a button column, `/modlog` tables side-scrolled and hid the reason/target columns behind a swipe gesture, and the subs index subscribe column ate horizontal space on an already-cramped table. None are correctness bugs; all are presentation-only fixes.

### Changed — mod-feed post titles get their full row back on mobile; collapse/remove drops to the next line

At ≤640px, `.post-title-line h1, h2` get `flex-basis: 100%` so `.post-actions` wraps below the title rather than competing for the same row. The 0.11.0 multilingual-posts feature was the trigger — `dir="auto"` happily wraps long Arabic/Greek/CJK titles to 5 vertical lines next to a button column on a phone, and the result is unreadable. Specificity fix: `.post .body h2 { flex: 1 }` further up beat a same-specificity override, so the mobile rule reads `.post .body .post-title-line h2`. Desktop unchanged. Title → mod tools → context → body is the mod's natural scan order; the row-stack restores it.

### Changed — `/modlog` tables card-stack at narrow widths; inline-flow with `·` separators replaces table chrome

Three modlog page renders (per-sub, `/modlog?mode=audit`, `/modlog?mode=inbox`) wrap their body in `.modlog-page`, and at ≤640px each `<tr>` becomes a `display: block` card with cells flowing inline separated by `·`. Reason gets its own line because it's the variable-length tail. Empty cells (null reason, single-event rows, non-revokable rows) drop entirely via `:empty`. Result: one or two visual lines per audit record instead of six, no horizontal scroll. The memlog page already had its own narrow-viewport treatment (column hide) — that path is preserved unchanged via `.memlog-page table.modlog { display: table }`.

### Added — `[in]` subscribed-state chip on the subs index (mobile only)

At ≤640px the subscribe column hides (it was the 7th column on a 6-collapsed table — too much horizontal pressure) and a passive `<span class="subscribed-mark">[in]</span>` renders inline after the sub name for subs the current user is subscribed to but does not mod. The chip is mobile-only via `display: none` on the base rule + `display: inline` inside the existing `@media (max-width: 640px)` block. Discovery flow shifts: tap a sub → land on its page → subscribe button sits in the sub's existing action strip. Costs one extra tap for a "from-directory subscribe" flow that essentially never happens in practice (users subscribe to subs they're already reading).

### Changed — mod controls render as warm-accent text verbs across all viewports

`collapse · remove · ban` now renders in `var(--accent-warm)` plain text instead of outlined pills with `var(--text-dim)` text. The palette comment in `style.css` already reserved `--accent-warm` for "flair pills, NSFW badges, **mod highlights**" — mod-controls were the one site not honoring that reservation. The temperature shift mirrors `read more →` (which uses `--accent` for "tap-to-read"): cool-accent = nav, warm-accent = mod tool. Hover: dotted underline (matches plato's existing `.sensitive-banner strong` idiom). Open-state on the confirm-details summary now uses `font-weight: 600` instead of the old border-color flip (the verb has no border now). Disabled fallback keeps the 0.4 opacity, no hover decoration. Removed `.mod-btn-warn` entirely along with the `warn` parameter on `modActionForm` and the call-site `warn: authorBanned` argument — the verb itself carries the state (`unban` vs `ban`), so duplicating it via underline was redundant chrome.

### Fixed — empty modlog reason cell rendered as 0-height block on mobile instead of collapsing

Specificity bug: `td[data-label="reason"] { display: block }` (0,3,2) beat the global `td:empty { display: none }` (0,2,2), so cells where `a.reason` was null rendered as 0-height blocks with `margin-top: 0.15rem` instead of falling through to the empty-cell hide. Added `:not(:empty)` to the block-treatment selector so empty reason cells collapse as intended.

### Fixed — `·` separator between mod-action verbs wasn't rendering

Initial selector targeted `.mod-controls .mod-form + .mod-form::before`, but the visible chip is `<summary class="mod-btn">` inside `<details class="mod-confirm">` — `.mod-form` lives further down and only renders when the details is open. Corrected to `.mod-controls > * + *::before` which targets direct-child siblings of the strip regardless of whether each is the active `<details>` or the disabled-state `<span>` fallback.

### Tests

829/829, unchanged. All changes are CSS-only or template-attribute-only (`data-label` on cells, `.modlog-page` wrapper div). Structural verification via `curl /sub/<name>/modlog` confirmed wrapper + `data-label` render on every cell. Visual verification on Firefox mobile view (≤640px viewport).

### Files touched

- `src/web/app.js` — `.modlog-page` wrappers on 3 modlog page renders, `data-label` attrs on every `<td>`, `.subscribed-mark` chip in subs-index row render, `warn` parameter dropped from `modActionForm` + call site, style.css cache `v=42 → v=48`
- `src/web/static/style.css` — mobile `flex-basis: 100%` on title-line, modlog card-stack at ≤640px, `.subscribed-mark` base + mobile reveal, mobile subscribe-column hide, mod-controls warm-accent + text-verb restyle in base (all viewports), `.mod-confirm[open]` open-state via `font-weight: 600`, `.mod-btn-warn` rule deleted

## [0.11.1] - 2026-05-10 — `/healthz` and `/static/*` answer HEAD as well as GET; deploy-guide gets a "dubious ownership" entry

A first-contact-with-monitoring hotfix found while validating the 0.11.0 deploy on terribic.com. Two real-world callers hit the gap.

### Fixed — `/healthz` returned 404 to `HEAD` requests (uptime monitors, `curl -I`, healthcheck dashboards)

The route guard at `app.js:5530` was `method === 'GET'`, so any `HEAD` request fell through to the catch-all 404. Most uptime monitors (UptimeRobot, Better Stack, internal Prometheus blackbox-exporter at default config) use HEAD by default to avoid pulling response bodies. They were getting 404s on a perfectly healthy instance. Same shape as `/static/*` (handler at `static.js:18` had `req.method !== 'GET'`), which had bitten us during local validation when `curl -sI http://localhost:8080/static/og.png` returned 404 — link-preview validators that probe `og.png` with HEAD before fetching the image were getting the same 404. Both routes now accept GET and HEAD; Node's HTTP server auto-strips the response body on HEAD so headers stay identical between methods. Two new tests pin the contract: `HEAD /healthz` returns 200 with the same `Content-Type` as GET and an empty body; `HEAD /static/og.png` returns 200 with `image/png` and an empty body.

### Documented — deploy-guide troubleshooting: "fatal: detected dubious ownership in repository"

This release's terribic.com deploy ran git as `root` while `/opt/plato` is owned by `plato:plato`, tripping git's CVE-2022-24765 ownership check. The deploy-guide upgrade recipe already uses `sudo -u plato -H bash -c '...'` for git/npm/migrate steps — keeping all writes under one uid avoids the cascade where root-git-pulls and plato-user-npm-runs step on each other's working tree (the symptom of which is `error: Your local changes to package-lock.json would be overwritten by merge`). Added a Troubleshooting entry pointing back to the canonical recipe and noting the `git config --global --add safe.directory /opt/plato` exit hatch for single-user boxes only. Also added a `/healthz returns 404` troubleshooting entry so the failure mode self-documents for older instances.

## [0.11.0] - 2026-05-10 — multilingual posts, og:image link-preview banner, modlog audit-string fix, post-title immutability lock

A capability-bearing release. Two new user-visible features (post in any language; rich link-preview banners), one bugfix (modlog "→ mod: null"), one design lock (post titles immutable). The review pass added three hardening adjustments: sticky-note bidi parity, fork-correct `og:image:alt`, and a defensive `dir="ltr"` on the site header so the chrome doesn't follow user-content direction.

### Added — `og:image` so WhatsApp/Slack/Twitter render a banner card, not the chain-icon fallback

Every page now emits `<meta property="og:image">` pointing to a static 1200×630 PNG of plato's three-dot mark on `--bg`, served from `/static/og.png`. Previously plato emitted `og:title`/`og:description`/`og:url` but no image, so link-preview clients that prefer banner cards (WhatsApp, Slack) fell back to the compact chain-icon shape. The image is part of plato's identity (same dots as the favicon) and ships with the repo — no per-fork config knob; every instance carries it. `twitter:card` upgraded from `summary` to `summary_large_image` to match. `og:image:alt` reads from `branding.forumName` so a fork rebranded to "lobby" emits `og:image:alt="lobby"` (review fix from initial hard-coded `"plato"`). WhatsApp caches previews ~7 days globally per URL, so existing terribic.com previews will refresh after the cache window or via the FB sharing debugger.

### Added — post in any language: every Unicode script the browser can render, no locale list, no chrome translation

Seven user-content render sites carry `dir="auto"`: post-page `<h1>` title, post-page `<article>` body, feed-view `<h2>` titles, feed-view body excerpts, comment-page `.comment-body`, comments-tab preview `.comment-body`, and the per-sub mod sticky-note (review fix — initially missed). The browser auto-detects writing direction per element from the first strong character: Arabic / Hebrew / Persian / Urdu flip RTL, Latin / CJK (Chinese / Japanese / Korean) / Cyrillic / Greek / Devanagari / Tamil / Bengali / Thai / and every other Unicode script stay LTR. Paired with `article > *, .comment-body > *, .preview > *, .sub-sticky-note > * { unicode-bidi: plaintext; }` in `style.css` so each block-level child of a markdown-rendered body detects independently — a post mixing English and Arabic paragraphs renders each paragraph in its own direction. The boundary is sharp: **post in any language; the UI speaks one** — chrome strings (header, action pills, vote arrows, modlog labels, error pages, timestamps) stay English-LTR. The site header now carries an explicit `dir="ltr"` (review fix) so the truncated post title injected into the wordmark via `brandTitleTruncated` doesn't reorder logo + text on Arabic post pages. No locale switcher, no translation pipeline, no plural-rule engine, no font shipping; that's a separate product. PRD §Permanently out documents this as a deliberate scope lock. Style version bumped to v=42 to bust the CSS cache. Two `seo.test.js` tests pin the contract: one assertion-only smoke check on `<h1 dir="auto">` / `<article dir="auto">`, plus an end-to-end test that seeds a post with Arabic title `مرحبا بالعالم` + Arabic body, fetches the post page, and verifies the title round-trips inside `<h1 dir="auto">` *and* the chrome carries `dir="ltr"`.

### Fixed — `null` rendered literally in modlog reason when a mod dismissed a system auto-collapse without typing an explanation

The 0.10.4 audit-trail enrichment built the audit reason as `system: <note> → mod: ${trimmedReason}`. Dismissals don't require a typed reason (only hard removals do), so `trimmedReason` was `null` whenever the mod just clicked dismiss — and JS template literals interpolate `null` as the literal string `"null"`. Result on /modlog: `system: blocked-url: github.com → mod: null`. The "→ mod:" leg now falls back to `dismissed without reason` when the mod typed nothing, keeping the same skeleton across the dismissal corpus while making the absence-of-comment a visible, scannable signal rather than a programmer-language null. The mod's pseudonym in the actor cell was never affected — that always rendered correctly; the bug was purely in the formatted reason string.

### Documented — post titles are immutable; only `body` and `sensitive` are editable inside the 24h edit window

No code change — the existing `editPost(db, { postId, handle, body, sensitive, ... })` signature already accepts no `title` parameter. This release promotes that behavior from incidental-implementation to a PRD-locked design decision under §Permanently out. Reasoning: title is the post's contract (shows in feeds, RSS, sub indexes, archive snapshots, is what early voters cast on), so a mutable title would open a 24h bait-and-switch lane invisible at the surface where the title was originally read. Asymmetry vs body-edit is deliberate: body edits are local to the post page, titles propagate. Typo'd titles → delete and re-post (the modlog records the deletion). A defensive comment in `src/content/post.js` flags the omission so future "fix the asymmetry" PRs re-read the lock first.

## [0.10.4] - 2026-05-10 — UX-honesty wave: opaque rate-limit messaging, CRLF body cap, audit-trail enrichment, regex tightening

Four user-visible fixes from a single terribic.com session of "what just happened?" surprises. Each one is a different UX-honesty paper-cut: the user thought they were within a limit, the system thought they weren't, and the message didn't help reconcile the two. None of these are scope expansions; they're alignment passes.

### Changed — rate-limit messages stop revealing the cap and the tier name

Old shape: *"posts limited to 3/day for new accounts. try again tomorrow."* The cap (3) and the tier label (new) are operational details a spammer wants — and "try again tomorrow" implies a calendar-day reset, but the actual model is rolling 24h. New shape: *"you've hit a posting limit. try again in a few hours."*

The time-to-unblock is computed from observable state (oldest in-window post ages out, plus tier-flip eligibility) and bucketed into six coarse English ranges (`shortly`, `in less than an hour`, `in a few hours`, `later today`, `tomorrow`, `in a couple of days`). Each bucket covers a wide range of underlying durations, so probing the boundary doesn't reveal the rolling-window length precisely. Cap and tier stay internal — operators still see precise reasons through the new `block.reason` return field (`{ tier, capField, cap, count, msUntilUnblocked }`), so server-side logging and tests retain full diagnostic precision while the user-facing message goes opaque.

Same shape for: `checkPostRate` (per-hour + per-day), `checkPostRatePerSub`, `checkCommentRate`, `checkLinkCap`. The link-cap message stays content-shaped (no time component — the user trims links and re-tries; that's not a wait): *"this post has too many links (N). trim and try again."* *(`<commit-after-cut>`)*

### Fixed — `<textarea>` body cap rejected at-cap submissions due to CRLF/LF mismatch

The user's client-side counter (`charcount.js`) read `ta.value.length`, which uses LF line breaks (textareas internally normalize values to LF on read). Browsers then submit form-encoded textarea content with CRLF line breaks per the HTML spec, so a body the user wrote at exactly 40 000 chars (LF-counted) arrived at the server as 40 000 + N chars (CRLF-counted, where N = number of newlines) and tripped the `body exceeds 40000 characters` guard while the user's counter still read under cap.

Fix: `submitDraft`, `editPost`, `addComment`, `editComment` all normalize CRLF → LF before the length check AND before storage. The on-disk markdown file and the DB row both end up LF-only — markdown rendering doesn't care about line-ending choice, and uniformity simplifies archive/export byte counts. Two new regression tests in `test/integration/post.test.js` lock the LF-counted view as the authoritative measurement, including a 100-line body at exactly `BODY_MAX` after normalization. *(`<commit-after-cut>`)*

### Fixed — phone-shape spam regex was matching dates and version strings

Line 38 of `spam-patterns.txt` (the "phone-number-with-text-me" rule) used `[\d\s().-]{8,}` to match the phone-number portion. That character class accepts any 10-char string of digits and separators — including 10-char dates (`2026-05-09`) and version-shaped tokens (`v1.2.3.4.5.6.7`). On a real terribic.com beeperbox post that listed messengers ("WhatsApp, Signal, iMessage, Telegram, Instagram, Messenger") within 30 chars of a date elsewhere in the body, the regex tripped — auto-collapse + system flag for what was unambiguously legitimate prose.

Fix: replace `[\d\s().-]{8,}\d` with `\d(?:[\s().-]*\d){8,}` — same shape, but every separator must be followed by a digit, so the captured phone-shape is guaranteed to contain ≥9 actual digits. International phone numbers are 8–15 digits; 9 is the safe lower bound. Dates have at most 8 digits, version strings rarely cross 9, ISBNs (10 digits) almost never abut "telegram"/"whatsapp" within 30 chars. New test in `test/integration/spamPatterns.test.js` loads the shipped pattern file and pins both the positive (real phone-spam shapes) and negative (beeperbox-style messenger lists, dates, version tokens) cases. *(`<commit-after-cut>`)*

### Added — modlog audit reason enriched when a mod overrules a system auto-collapse

When a mod dismisses flags on a target that was auto-collapsed by either spam-pattern matching (`pattern: <regex>`) or URLhaus (`blocked-url: <host>`), the resulting `uncollapse` `mod_actions` row now carries the original system note in its `reason` column. Before: the audit row read only the mod's typed reply (often empty for routine false-positive uncollapses), and the future reader of `/modlog` had to cross-reference the earlier system-attributed `collapse` row to see why the target was flagged in the first place. After: the audit row reads `system: blocked-url: github.com → mod: false positive — github is fine` — both halves visible in one place, the false-positive trail honest.

Mechanism: in the dismiss branch of the `/modlog/resolve` handler, look up the most recent `flags` row for the target whose `flagger_handle = SYSTEM_HANDLE`. If found, prepend `system: <flag.note> → mod: <reason>` to the recorded action's reason. No-op when no system flag exists (mod-initiated soft-removes that other mods later overrule still record only the dismissing mod's text). *(`<commit-after-cut>`)*

### Tests

819 → 825 (+6 new):
- `spamPatterns.test.js` (+1) — phone-shape regex regression on shipped file.
- `rateLimit.test.js` (+2) — `bucketTimeToUnblock` ladder boundaries; opacity check on the post-block message.
- `post.test.js` (+2) — CRLF body normalization, including a body at exactly `BODY_MAX` after normalization.
- `modlog-http.test.js` (+1) — system-flag audit-reason enrichment on dismiss.

## [0.10.3] - 2026-05-09 — magic-link email body reordered + per-instance footer stub

Real terribic.com sign-in surfaced two ergonomics issues with the magic-link mail. First, the security warning ("This link expires in 15 minutes. If you didn't request this, ignore this email.") sat at the **bottom** of the body — readers who got an unsolicited link had to scroll past the click target to find the "ignore this email" instruction. Second, the operator footer carried only the civility rules; there was no per-instance attribution showing which plato instance the mail came from or where to send feedback.

Both fixes land in plato. knowless stayed at v1.1.5 with a single doc-only paragraph (the GUIDE.md "composing the security signal under bodyOverride" recipe). Walk-away preserved on the library side: zero source change, the discoverability bug was the actual gap.

### Changed — magic-link body order: warning leads, URL follows, security signal stays

plato now composes the entire magic-link body via knowless's `bodyOverride` mechanism (AF-26, shipped in knowless v0.2.2). The new shape:

```
This link expires in 15 minutes. If you didn't request this,
ignore this email.

Click to sign in:

<URL>

Last sign-in: 2026-05-09T16:57:05.667Z.
If that wasn't you, do not click the link above.

-- 
a plato instance hosted by @<branding.hostedBy> . <branding.feedbackEmail>
<civility rule 1>
<civility rule 2>
<civility rule 3>
<civility rule 4>
```

The Last-sign-in security-signal block is preserved end-to-end. Under `bodyOverride` knowless doesn't auto-append it — instead plato follows the v1.1.5 GUIDE.md recipe: open a parallel read-only `createStore(KNOWLESS_DB_PATH)` handle in `bin/server.js`, derive the handle from the submitted email via `auth.deriveHandle(email)`, look up `lastLoginAt` via the parallel store, pass the value into `composeMailBody` through the per-call closure. `bodyFooter` was dropped from `createAuth`'s config — the override owns the whole tail now, including the `-- ` signature delimiter.

The Last-sign-in wording is duplicated verbatim from knowless's default `composeBody` (`mailer.js`). Drift note in `composeMailBody`'s comment: if knowless ever revises that exact phrasing, plato emits stale wording until someone updates the helper. Recoverable, contained, the cost of having taken the wheel. *(`<commit-after-cut>`)*

### Added — per-instance attribution line in the magic-link footer

When `branding.hostedBy` and/or `branding.feedbackEmail` are set in `config.json`, the magic-link footer's first line reads:

```
a plato instance hosted by @terribic . feedback@terribic.com
```

Rendered as the first line *under* the `-- ` delimiter, above the existing civility rules. If either field is unset, the line collapses gracefully — only the populated half shows; if both are unset, the stub is omitted entirely and the footer falls back to the existing civility-rules-only shape. No knowless-side limit relaxation needed: under `bodyOverride` plato owns the whole footer block and knowless's 4-line / 240-char `bodyFooter` cap doesn't apply (only the broader 2048-char `bodyOverride` cap, which the worst-case body comes nowhere near). *(`<commit-after-cut>`)*

### Internal — `composeMailBody` exported as a pure helper for test isolation

`src/web/app.js` exports `composeMailBody({url, lastLoginAt, hostedBy, feedbackEmail, rules})` — pure function, no I/O, no dependencies. The wired path inside `createApp` builds a per-email closure that calls `auth.deriveHandle` + `lookupLastLoginAt` and threads the resulting `lastLoginAt` into `composeMailBody`. 10 new tests in `test/integration/mail-body.test.js` pin output shape: warning leads, URL on its own line (knowless invariant), Last-sign-in block present/absent, stub composition under `--`, ASCII-only output, length within knowless's `bodyOverride` 2048-char cap. *(`<commit-after-cut>`)*

### Not changed — knowless

knowless stayed at v1.1.5 (the doc-only release that added the recipe paragraph). I drafted a callback-arg-widening change first (extend `bodyOverride({url})` to `bodyOverride({url, lastLoginAt})`) and the maintainer rejected it as out-of-shape under walk-away — callback-arg widening normalizes "every adopter who needs one more value" as a default-yes precedent, which is what walk-away exists to refuse. The recipe was already there; the discoverability bug was the actual gap. plato hardcoding the security-line wording is the agreed cost. *(`<commit-after-cut>`)*

### Tests

809 → 819 (10 new in `test/integration/mail-body.test.js`).

## [0.10.2] - 2026-05-09 — mobile-safe `<pre>` rendering for prose-shaped code blocks

Single-issue patch from a real terribic.com post. Fenced code blocks (and 4-space-indented blocks) containing long prose lines were rendering with `overflow-x: auto`, so on narrow viewports the `<pre>` extended past the right edge of the viewport with an internal horizontal scrollbar. Inside a forum that's prose-first and where users reach for ` ``` ` to pull-quote essays, the default was wrong: it preserved horizontal layout fidelity at the cost of readability on phones.

### Fixed — `<pre>` blocks now soft-wrap inside the column

Switched `article pre` from `overflow-x: auto` to `white-space: pre-wrap; overflow-wrap: anywhere;`. Intentional newlines inside real code blocks are still preserved (that's what `pre-wrap` does); long lines wrap at word boundaries to fit the column; unbreakable strings (URLs, hashes) break to fit instead of forcing horizontal scroll. The trade-off — actual code with critical column-alignment loses that alignment when wrapped on a 320px viewport — is the right one for a prose-first forum: the alignment was already lost the moment the content didn't fit, and soft-wrap is the better failure mode. *(`c39bd38`)*

### Cache-buster

`style.css?v=40 → v=41`. Mobile users will see the new behavior on next page load without a hard refresh; the bumped query string forces a fresh CSS fetch.

### Eval image — refreshed for the first time since v0.1.1

The `ghcr.io/hamr0/plato:latest` evaluation image was massively stale — the publish workflow only fires on `v*.*.*` tag pushes, and no version tag had been cut since `v0.1.1` on 2026-05-08. That meant anyone running `docker run --rm -p 8080:8080 ghcr.io/hamr0/plato:latest` got code from before M5 spam defenses, M6 RSS, M7 archives, M8 theme, the deploy guide, and every 0.10.x mobile fix. Pushed `v0.10.2` as the first proper release tag aligned to `package.json` semver — workflow built and published `sha256:b9afea0…` with both `:v0.10.2` and `:latest`. Convention going forward: every `release(0.X.Y)` commit gets a matching `git tag v0.X.Y && git push origin v0.X.Y` so the eval image stays current with main.

## [0.10.1] - 2026-05-09 — mobile theme-toggle hardening + status-row layout

Reactive-fix wave from a long mobile testing session against terribic.com on iOS Safari, Firefox Focus (iOS WebKit), regular Firefox (mobile), and desktop browsers. The light-theme toggle had a series of layered bugs that each looked like a different problem and required separate fixes — they only became visible end-to-end on a real production deploy. Also folds in the mobile header status-row left-align decision from the same testing window.

### Fixed — mobile header status row left-aligned under brand

`align-self: flex-end` and `justify-content: flex-end` on `.status` in the mobile media query were tucking the status block (avatar + handle + subs + modlog + logout + theme toggle) against the right viewport edge. When the row got long enough to wrap, a single trailing item like `light` ended up alone on its own line at the right edge with empty space to the left — orphan-token in space. Removed both alignment overrides so the status block flows under the brand block on the same left edge. Matches what every mobile-shaped site does once columns collapse to one column. Block-level right-tuck was a desktop pattern; on mobile there's no second column to anchor against.

### Fixed — iOS Safari light palette wasn't applying after click

Reported on terribic mobile Safari: clicking the `light` toggle flipped the button label to `dark` (so theme.js click handler ran and `data-theme="light"` was set on `<html>`), but the page stayed dark. The light-palette CSS used `[data-theme="light"]:root` (attribute selector first, pseudo-class second). Both forms parse and match per spec, but iOS Safari's CSS-variable resolution path treats the two compound forms differently — chained pseudo selectors after attribute selectors don't always trigger a re-cascade when the attribute value changes mid-page-life via `setAttribute`. Initial fix: swap to `:root[data-theme="light"]` (the conventional form). Cascade reapplication then worked across browsers. *(`bc7239a`, `ab1d90d`)*

### Fixed — iOS Safari theme stopped repainting after navigation

Even with the selector swap, a deeper class of bug surfaced: toggling in-place worked, but after clicking the home logo (or any internal link) the toggle would flip the button label without repainting the page. iOS Safari has chronic CSSOM-invalidation bugs around `[attr]` selectors when attribute values churn on bfcache-restored or post-navigation pages.

Switched the entire theme persistence model from the `data-theme` attribute to two mutually-exclusive classes (`.theme-light` / `.theme-dark`). Class selectors (`:root.theme-light`) don't have this bug in any rendering engine — classes are first-class citizens of the cascade machinery; attribute selectors hit a different code path with historical invalidation bugs. Affected files: `style.css`, `theme.js`, the inline anti-flash script in `app.js`, and `themePaletteOverrides()` for operator color overrides. localStorage value shape unchanged (string `'light'` / `'dark'`) so existing toggled state survives the upgrade. *(`8743639`)*

### Added — first-party cookie as a fallback persistence layer for the theme

Mobile Firefox testing surfaced one more failure mode: regular Firefox (not Focus) was flipping the button label between `dark` and `light` on every page refresh. The inline anti-flash script's `localStorage.getItem('theme')` was returning inconsistent values across reloads — Firefox's privacy mode / Total Cookie Protection sometimes session-clears localStorage between page refreshes while preserving first-party cookies.

Added `plato_theme=light|dark` cookie persistence alongside localStorage. Cookie is set on every toggle (`path=/; max-age=31536000; SameSite=Lax`) by the click handler in `theme.js`. The inline anti-flash script reads localStorage first (warm path), falls back to the cookie if localStorage is empty or throws. Either persistence layer surviving across the refresh is enough to keep the theme stable. First-party functional cookie, no tracking value, parallel to the existing magic-link auth cookie pattern. *(`34800dc`, `67b164d`)*

### Added — bfcache-restoration handler for mobile Firefox pull-to-refresh

Mobile Firefox's pull-to-refresh restores the page from **bfcache**, which means the inline anti-flash script in `<head>` doesn't re-run on that path — the page comes back with whatever theme state was cached at navigation time. Added a `pageshow` event listener in `theme.js` gated on `event.persisted === true` (the bfcache-restoration signal) that re-reads localStorage with cookie fallback and re-applies the theme + label. `event.persisted` is `false` on a fresh navigation, so this code path only fires on actual bfcache restoration — no overhead on normal page loads. *(`d5a7638`)*

### Known — mobile Firefox refresh occasionally drops the persisted theme

After all of the above, the toggle works correctly across iOS Safari, Firefox Focus, regular Firefox normal navigation, and every desktop browser. **One residual edge case**: on regular mobile Firefox, F5 / pull-to-refresh occasionally restores the page to dark even when the user toggled to light. The cause is a Firefox-specific cache code path for refresh that bypasses both the inline anti-flash script *and* the bfcache `pageshow` event. Recoverable with a single tap on the toggle. Documented in operator-guide § Known limitations.

### Cache-buster

`style.css?v=37 → v=40`, `theme.js?v=1 → v=5`. Deploys spanning 0.10.0 → 0.10.1 should fully refresh on phones; users still seeing stale layout/theme behavior should close-and-reopen their tab (browser cache for plato is sticky on mobile).

## [0.10.0] - 2026-05-09 — rate-limit floor extension + post-launch polish

Post-canonical-deploy polish wave. The largest single change is **closing the cross-sub fan-out hole**: the `established` per-account tier was previously uncapped, leaving a 7-day-old account free to fan out across many subs and dominate the home feed. The new floor caps it at 6 posts/hour, 20 posts/day, 60 comments/day. Owner-in-own-sub carve-out also extended from comments-only to posts: `recent` and `established` owners get the daily post cap doubled in their own sub (10→20, 20→40); `new`-tier owners stay at 3/day to preserve the brigade-guard against "fresh account → fresh sub → flood seed posts."

Also: Apache 2.0 LICENSE is now in the repo (was implied by README; GitHub's license detector now picks it up); mobile post-page overflow fix; brand-area title truncation on the post-detail page; dead CSS cleanup from the v0.9.0 header iteration.

### Added — `established` per-account rate-limit floor (closes cross-sub fan-out hole)

`RATE_LIMIT_FLOOR.perAccount.established = { postsPerHour: 6, postsPerDay: 20, commentsPerDay: 60 }`. Previously the established tier (>7d) had no per-account ceiling on the theory that handle reputation + modlog history + community votes were defense enough. In practice that left a single voice free to fan out: 5 posts in each of 4 subs at the trusted-newish per-sub flood cap = 20 posts/day from one account in the cross-sub home feed, with no cap to bind. The new ceiling holds the floor so a single voice contributes at most ~1 post/hour to the home feed in any 24h window.

The curve across tiers now reads as a clean build-up: 1/3/10 → 3/10/30 → 6/20/60 (posts/hour, posts/day, comments/day). Per-sub flood cap unchanged (5/day under 30d, 20/day for trusted ≥30d). `resolveRateLimitConfig` now iterates `['new', 'recent', 'established']` for the override-validation loop. PRD §Spam Defenses 2 + operator-guide caps table + plato.context numeric reference all refreshed with the new tier.

### Added — owner per-day post cap doubling on `recent` + `established` tiers

`checkPostRate` gains a `doubledForOwner` flag mirroring `checkCommentRate`. When the poster owns the destination sub AND the tier is not `new`, the daily post cap is doubled (10→20 for recent, 20→40 for established). Wired in `handleDraft` and `handleFinalize` alongside the existing `skipHourly` flag. Comments are doubled across every tier (10→20, 30→60, 60→120) per existing pattern; posts are gated by `tier !== 'new'` because the brigading vector for new accounts is "fresh account → fresh sub → flood seed posts" and doubling 3 to 6 here opens it. Recent and established already have community history, so the post-side carve-out reads as engagement, not seeding.

Doubled budget is "spent in own-sub only": the same global `dayCount` is checked against either the doubled cap (when posting into own sub) or the base cap (when posting elsewhere), so once an owner exceeds the base cap they can only continue posting in their own sub. Same pattern as the existing comment doubling.

3 new tests in `test/integration/rateLimit.test.js`: established-tier 20/day cap, new-tier owner does NOT get post-cap doubling (brigade guard), recent-tier owner gets 20/day (2× of 10), established-tier owner gets 40/day (2× of 20). 806 → 809 green.

### Fixed — post-detail page horizontal scroll on mobile

`.post` was a CSS grid with `grid-template-columns: auto 1fr`, and `1fr` tracks have `min-width: auto` by default. On a post-detail page with a long title, the `<h1>` inside the body track forced the grid wider than the viewport — and every `<p>` inside the rendered article then wrapped at the inflated column width rather than at viewport width, producing page-level horizontal scroll. Switched to `auto minmax(0, 1fr)` + `min-width: 0` on `.post > .body` so the body track shrinks to fit. Added `flex-wrap: wrap`, `min-width: 0`, `font-size: 1.6rem`, and `overflow-wrap: anywhere` to `.post-title-line h1` so titles can wrap (or break a single unbreakable token) rather than overflow. Mobile media query tightens h1 to 1.25rem so a 25-char title still fits on a 320px iPhone SE viewport. Found during first canonical post creation at terribic.com.

### Added — brand-area post-title truncation on the post-detail page

The page brand wordmark on the post-detail route used to render the full post title — a 300-char title would otherwise blow out the header. New `brandTitleTruncated(title, words = 3)` helper renders the first 3 whitespace-separated tokens followed by a trailing ellipsis. The full title still appears in `<title>`, `og:title`, and the article body's own h1 — the brand wordmark is page chrome, not the canonical title display. Wired in the post-detail route via `titleHtml: html\`${brandTitleTruncated(post.title)}\`` while `title:` keeps the full string for HTML head + meta tags.

### Added — Apache 2.0 LICENSE file + SPDX field in `package.json`

Project's license declaration was previously README-only ("Apache 2.0. Fork without asking.") with no `LICENSE` file at repo root. GitHub's license detector and any third-party license scanner saw the project as un-licensed. Dropped the canonical Apache 2.0 text from `apache.org/licenses/LICENSE-2.0.txt` into `LICENSE` byte-for-byte (including the leading blank line — that's apache.org's canonical form). Added `"license": "Apache-2.0"` SPDX field to `package.json` so `npm` tooling and the GitHub license badge both pick it up. README license badge switched from `shields.io/github/license` (which read "unspecified" before the LICENSE file) to a static `shields.io/badge/license-Apache%202.0` URL — works regardless of GitHub's auto-detection state.

### Fixed — dead CSS from the v0.9.0 header iteration

`header .nav` and `header .nav a` rules at `style.css:605-614` styled the `<div class="nav muted">` brand-subtitle that was removed when the subtitle was inlined into the brand h1 in 6460f05. The remaining `.nav`-class elements (`home-nav`, `page-nav`, `sort-nav`) all live outside `<header>`, so the selector matched nothing. Deleted.

## [0.9.0] - 2026-05-09 — first canonical deploy + version visibility

The post-M8 deploy hardening arc, validated against the first canonical plato deploy at terribic.com (RackNerd VPS, Route 53, Gmail recipient). plato itself is now an operating instance, not just a build. Adds version visibility on three surfaces (footer, startup log, README badge) so operators can verify the running code matches what's on disk after a `git pull`.

Versioning note: prior to 0.9.0 the project shipped `0.1.0` in `package.json` while milestones M5–M8 closed in the changelog. This release retroactively maps to 0.9.0 — it captures all post-M8 deploy work. Earlier milestone-close points (M5, M6, M7, M8) are tagged retroactively below at 0.5.0, 0.6.0, 0.7.0, 0.8.0 so the changelog version trail matches the actual development arc. Where milestone work spilled into the next window (most notably the M5/B12 smoke-polish wave that landed during the M6 development cycle), the version bump that shipped first wins — those entries ride 0.6.0 rather than spawning a 0.5.1.

### Fixed — home-nav filter chips snake-wrap on narrow viewports

The home-page filter chips (`posts | comments`, `new/old/top/hot`, `24h/week/all`) used `.filter-group` wrapper spans with `display: inline-flex`, which made each group a single layout unit. On narrow viewports each group claimed its own row with empty trailing space rather than chips wrapping individually as siblings. Setting `.home-nav .filter-group { display: contents }` makes the wrapper transparent for layout while preserving the DOM grouping — chips and separators now snake-wrap left-to-right, then to the next line, like words in a paragraph. No change on desktop where everything fits in one row anyway. Found during the first canonical mobile-Safari smoke at terribic.com.

### Added — deploy-guide hardening from first canonical deploy at terribic.com

First end-to-end deploy of the guide against a real RackNerd VPS + Route 53 + Gmail recipient surfaced ~15 small gaps. Every one now has a guide edit (the "fix the source, not the session" pattern):

- **Step 0** — explicit handling for Ubuntu's `/etc/ssh/sshd_config.d/50-cloud-init.conf` re-enabling `PasswordAuthentication yes` (overrides the main config edit). Hostname rename block (`hostnamectl set-hostname $DOMAIN`). SSH private key backup callout (pass: `plato/vps/$DOMAIN/ssh-private-key`).
- **Prerequisites** — env vars (DOMAIN/ADMIN_EMAIL/PLATO_PORT) now persisted to `/root/.bashrc` instead of one-shot `export` (didn't survive SSH reconnects, silently produced malformed configs across multiple steps). Added `FORUM_NAME` for `KNOWLESS_FROM` display name.
- **Step 1** — `NEEDRESTART_MODE=a` to stop `apt -y upgrade` hanging on Ubuntu 24.04's needrestart prompt. Explicit "From this step onward, every command runs on the VPS" callout (caught a paste-on-laptop foot-gun mid-deploy).
- **Step 4** — corrected `/opt/plato` mode prediction to `0750` (Ubuntu's `HOME_MODE` default) instead of `0700`.
- **Step 5** — env-var sanity guard at top of step (Step 5.2/5.3 silently produced malformed `KeyTable`/`SigningTable` when `$DOMAIN` was empty after a reconnect). DKIM private key backup callout (pass: `plato/vps/$DOMAIN/dkim-default-private`).
- **Step 5.3** — opendkim `Socket inet:8891@localhost` (Ubuntu defaults to UNIX socket; postfix's `inet:` milter URI can't use it). Neutralize `/etc/default/opendkim` SOCKET= override. `enable + restart` instead of `enable --now` (no-op when service is already running from package install).
- **Step 5.5** — optional MX record callout while at registrar (saves a second trip if Step 14 inbound aliases is on the roadmap).
- **Step 7** — friendly `KNOWLESS_FROM=$FORUM_NAME <auth@$DOMAIN>` template (recipients see "terribic" rather than just the email address). `KNOWLESS_SECRET` backup callout (pass: `plato/vps/$DOMAIN/knowless-secret`).
- **Step 8** — clearer optional `tagline` field with concrete examples instead of generic placeholder.
- **Step 11** — disable Ubuntu's stock `/etc/nginx/sites-enabled/default` (catchall `server_name _; listen 80 default_server;` was intercepting requests in some configurations).
- **NEW Step 14** — inbound aliases (`abuse@`/`postmaster@`/`feedback@`/`security@` → `$ADMIN_EMAIL` via postfix `virtual_alias_maps` + MX record). RFC 2142 compliance + DMARC report inbox + domain-branded `feedback@`. Optional, post-deploy.
- **NEW Step 15** — sender reputation monitoring signups: Google Postmaster Tools, Microsoft SNDS, Microsoft JMRP. Free, web-only, gives early warning when domain reputation drifts.
- **Throughout** — `/var/log/mail.log` (Ubuntu/Debian) replaces `/var/log/maillog` (RHEL convention) wherever the path appeared.

### Added — Ubuntu 24.04 primary path + Step 0 SSH hardening (post-M8, deploy/5)

The deploy guide privileged AlmaLinux 9 as the primary distro, but Ubuntu
is the actual default on every budget VPS provider (RackNerd, Hetzner,
DigitalOcean, Linode, Vultr) — including the RackNerd box plato is now
tested against. The guide's framing was backwards relative to where
operators actually land. Also: the guide assumed key-based SSH was
already in place when the typical RackNerd-shape delivery is `root` +
password, leaving the box exposed to credential-stuffing during setup.

- **Title + stack + prerequisites flipped to Ubuntu primary.** Ubuntu
  24.04 LTS (apt + ufw + AppArmor) is the named primary path; AlmaLinux
  9 / RHEL 9 (dnf + firewalld + SELinux) and Fedora live in parallel
  blocks at Steps 1–3. Steps 4–13 are unchanged (already distro-
  agnostic) — bootstrap.sh handles the SELinux check via
  `command -v setsebool || skip` so it works on Ubuntu without edits.
- **NEW Step 0 — SSH hardening.** Generate an ed25519 key on the
  laptop, copy via `ssh-copy-id`, then disable `PasswordAuthentication`
  and set `PermitRootLogin prohibit-password` in `/etc/ssh/sshd_config`.
  Distro-agnostic. Verified in a second terminal before closing the
  first session (the safety-net pattern). Unit name fallback handles
  Ubuntu (`ssh`) vs RHEL (`sshd`).
- **Step 1 — apt block as primary.** Pre-seeds postfix via
  `debconf-set-selections` to skip the interactive Internet Site dialog,
  installs nginx + sqlite3 + ufw + postfix + opendkim in one
  non-interactive run. NodeSource for Node 22 (Ubuntu's apt repo lags).
  AlmaLinux/RHEL and Fedora dnf blocks moved below as alternatives.
- **Step 2 — ufw as primary.** `ufw allow OpenSSH` + `ufw allow 'Nginx
  Full'`. firewalld block kept as RHEL alternative.
- **Step 3 — AppArmor as primary.** Ubuntu's nginx ships unconfined, so
  the step is a sanity-check (`aa-status | grep nginx`) rather than a
  config change. SELinux `setsebool` block kept as RHEL alternative.
- **Troubleshooting + security checklist updated** to reference
  "firewall (ufw or firewalld)" and the AppArmor fallback when 502s
  appear on Ubuntu (no SELinux boolean to flip — log-dive instead).
- **operator-guide §Hosting** updated to name Ubuntu 24.04 as RackNerd's
  default and the deploy guide's primary, with AlmaLinux 9 as the
  supported alternative.

### Changed — `/about` defines the operator role (post-M8, docs/about)

The word "operator" appeared twice on `/about` (the read-only carve-out
and the "if you don't trust this operator" fork section) but was never
defined positively. Readers had to infer the trust contract from the
negative space. Added a one-line `**the operator.**` paragraph at the
top of "how this place works" stating the operator runs the server but
has no in-app privilege — no admin role, no override of sub mods, no
quiet removals. Closes the trust loop the existing copy was gesturing
at; one sentence, no new section.

### Changed — drop empty `general` sub on fresh installs (post-M8, schema/general)

PRD §Permanently out has always said "no default catch-all sub" — and
the route layer has always enforced it (POST /draft rejects
`subName=general`, home/sub-picker queries filter `WHERE name !=
'general'`). But migration 002 still INSERTed a `general` sub row as
the FK target for backfilling M1-era posts, so every fresh install
ended up carrying a NULL-owner row that nothing pointed at and that
every code path had to special-case. Cruft, with archaeology value
only on instances that actually have M1 archives.

- **NEW migration `024_drop_empty_general.sql`** — DELETEs `general`
  if no `posts` / `drafts` / `sub_mods` reference it. Fresh installs:
  002 creates the row → 024 immediately drops it → no `general` sub
  exists. Archive-bearing installs (real M1-era posts in `general`):
  024 sees real references, leaves the row alone. Idempotent.
- **`submitDraft` no longer defaults `subName` to `'general'`.** Made
  the parameter required; throws "submitDraft: subName is required"
  if missing. Production callers (`src/web/app.js`, `bin/eval-seed.js`)
  always passed it explicitly; the default was a footgun masking
  test-only usage.
- **Route-layer carve-outs preserved.** `WHERE name != 'general'`
  filters and `subName === 'general'` rejection in POST /draft stay
  in place — they're still load-bearing for archive-bearing installs
  and harmless on fresh ones (always-pass / dead-branch respectively).
- **PRD §Permanently out tightened.** Now reads "fresh installs have
  no `general` sub at all" + the archaeology carve-out for legacy
  archive-bearing installs. operator-guide and plato.context.md
  match.
- **Tests updated** (~25 assertions): schema/post/app/sub integration
  tests now seed a `'test'` sub in their `freshDb()` helpers; INSERTs
  into posts/drafts pass `sub_name='test'` explicitly. Three obsolete
  tests deleted (the schema-default test, the "general exists with
  NULL owner" test, the "getSubByName finds general" test); replaced
  with one new "general does NOT exist after migrations on a fresh
  DB" assertion. Suite size 807 → 806.

### Changed — deploy-guide polish; ship disable-nginx-default-server.sh (post-M8, deploy/4)

Postmortem from a homeserver smoke against the new deploy/3 stack
surfaced four friction points; this entry collects all four.

- **§9 ↔ §10 reorder.** Old guide ran preflight before bootstrap;
  bootstrap creates `posts/`, `exports/`, `data/` so preflight always
  FAILed those checks. New order: bootstrap (creates dirs + system
  files) → migrate + preflight + start plato as one capstone.
  Renumbered remaining steps so the sequence flows cleanly.
- **§8 (config.json) expanded.** Was a heredoc + one paragraph; now
  opens with the .env-vs-config.json split table (mode 600 secret-
  bearing config vs editable forum-shape config), per-field
  walkthrough, optional sections to add later, and a JSON-parse
  verify command. Operators can now read §8 and understand WHY the
  file exists, not just paste it.
- **Log-path split documented everywhere.** plato app output
  (mail-outcome hooks, knowless lines, request errors) goes to
  `/var/log/plato.log`; `journalctl -u plato` shows only systemd
  lifecycle events. Routine-ops table, troubleshooting "won't
  start", magic-link debugging, and the homeserver appendix all
  call this out explicitly. Bit us mid-smoke when the diagnostic
  pointed at journalctl, which had nothing.
- **Homeserver appendix promoted to Steps A1–A8.** Was three short
  paragraphs; now a full copy-paste walkthrough with expected-
  output markers per step, mirroring the production guide's shape.
  Calls out what carries over to the VPS migration vs what gets
  redone. Validates auth-flow + UI + observability hooks in dev
  mode (`KNOWLESS_DEV_LOG_LINKS=true`); real mail validation
  remains the VPS's job.
- **deploy/disable-nginx-default-server.sh** (NEW, ~80 LOC bash) —
  idempotent script that comments out Fedora's stock
  `server { listen 80; }` block in `/etc/nginx/nginx.conf` for
  boxes where :80 is already taken (AdGuard, Pi-hole, another
  tenant). Backs up to `nginx.conf.preplato`, runs `nginx -t` to
  verify the result. **Production VPS deploys do NOT need this** —
  nginx owning :80 with HTTP→HTTPS redirect is the default and
  correct setup. Referenced only from the homeserver appendix.
- **Expected-output sweep.** Step blocks that previously left it to
  inference now show the shape of expected output (`useradd` perms
  line, postfix/opendkim service-active lines, milter port
  listener). docs/02-features/plato.context.md updated to clarify
  log destinations + dev-mode magic-link fallback.

### Changed — knowless owns plato's mail end-to-end; postfix + opendkim replace msmtp wrapper (post-M8, deploy/3)

- **Removed `src/mail/transport.js`** + its 9 unit tests. plato no
  longer overrides knowless's transport. knowless connects to
  `localhost:25` directly, postfix (with opendkim milter) handles
  delivery + DKIM signing.
- **Removed `PLATO_SENDMAIL_PATH`** from `.env.example`. Replaced
  with `KNOWLESS_SMTP_HOST` / `KNOWLESS_SMTP_PORT` documentation
  pointing at the postfix loopback.
- **Wired knowless v0.2.1 observability hooks** in `bin/server.js`:
  `onMailerSubmit` / `onTransportFailure` / `onSuppressionWindow`
  log structured `[plato mail.*]` lines to stderr, captured by
  systemd into `/var/log/plato.log`. Health-watch can grep for
  success/failure rates without parsing knowless's stderr noise.
- **deploy/bootstrap.sh** drops the per-user `.msmtprc` sync; warns
  when postfix or opendkim are missing.
- **deploy/preflight.sh** drops the `PLATO_SENDMAIL_PATH` /
  `/etc/msmtprc` / per-user `.msmtprc` checks; replaces with
  postfix (`postconf` + listener on :25) and opendkim (binary +
  daemon presence) checks.
- **deploy/teardown.sh** keeps the `/etc/msmtprc` cleanup branch
  for legacy deploys but no longer expects it.
- **deploy/msmtprc.example deleted.** Operator config for the new
  path lives entirely in deploy-guide.md §5 (postfix `main.cf`,
  opendkim setup, registrar DNS records).
- **deploy/plato.logrotate** drops `/var/log/msmtp.log`. Postfix
  has its own logrotate config; we don't duplicate.
- **docs/02-features/deploy-guide.md §5 rewritten** — postfix +
  opendkim + DNS walkthrough (SPF / DKIM / DMARC TXT records, PTR
  at provider, header-based smoke test). The msmtp dual-file model
  is gone.
- **docs/02-features/cron-jobs.md** mail-section updated: cron's
  `/usr/sbin/sendmail` is now postfix's, inheriting the same
  opendkim signing path as user-facing mail. One MTA, one queue,
  one set of logs.
- **README.md + operator-guide.md** stack-summary lines updated:
  msmtp → postfix + opendkim.
- **Suite size:** 816 → 807 (dropped mail.test.js's 9 tests; no
  other test changes).

**Why:** msmtp was a residential-homeserver workaround that leaked
into the production design. The blessed knowless path is
"nodemailer → localhost postfix + opendkim → direct delivery,
DKIM-signed at your domain." No vendor SMTP relay, no `.env` SMTP
password, no dual-file `.msmtprc` model. Fewer moving parts, better
deliverability (proper DKIM signing on every message), and the same
OPS.md §5 reference both knowless and plato can point at.

### Added — deploy/ scaffold + cert-expiry watcher + preflight (post-M8, deploy/2)

- **`deploy/` directory (NEW)** — extracts the inlined heredocs from
  the deploy guide into checked-in template files so operators have
  one source of truth for everything that lands in `/etc/`:
  - `plato.service.template` — systemd unit (substitutes
    `${INSTALL_DIR}` / `${PLATO_USER}`).
  - `plato.nginx.template` — nginx site (substitutes only `${DOMAIN}`
    so nginx's own `$host`/`$remote_addr` survive envsubst).
  - `plato.cron` — `/etc/cron.d/plato`, all 9 jobs ready to render
    with `${INSTALL_DIR}` / `${ADMIN_EMAIL}` / `${DOMAIN}` /
    `${BACKUP_DIR}` substitution. Cert-expiry line is uncommented.
  - `plato.logrotate` — daily, 14-day retention, gzip, copytruncate.
    Covers `/var/log/plato*.log` + `/var/log/msmtp.log`.
  - `msmtprc.example` — four commented account blocks (Gmail App
    Password / Fastmail / Proton Bridge / generic STARTTLS), 600-perm
    reminder.
  - `bootstrap.sh` — idempotent mechanical installer. Creates the
    `plato` system user + `BACKUP_DIR`, renders all four templates
    with envsubst, sets SELinux `httpd_can_network_connect` when
    enforcing, runs `systemctl daemon-reload`. Does NOT install
    packages, write secrets, or run certbot — those are the
    operator-decision steps in the guide. Re-runnable.
- **`bin/check-cert.sh` (NEW)** — daily TLS cert-expiry watcher.
  `openssl s_client` against `${DOMAIN}:${PORT}`, parses `notAfter`,
  silent ≥ 14 days; daily one-line stamp + email when below;
  `URGENT` subject prefix below 3 days. Recipient resolution
  mirrors `bin/health-watch.sh`: `HEALTH_ALERT_EMAIL` env →
  `config.json:operator.email` → log-only. Probe-failure path
  (DNS / port / firewall) emits a distinct alert with diagnostic
  hints. The `certbot.timer` renewal layer remains the actual
  renewer; this is the operator-side alarm for "renewal silently
  stopped working."
- **`bin/preflight.sh` (NEW)** — pre-start sanity check. One line per
  check: Node ≥ 22.5, sqlite3 CLI, `/usr/sbin/sendmail` present,
  `/etc/msmtprc` mode 600, `.env` mode 600, `KNOWLESS_SECRET` length,
  `KNOWLESS_BASE_URL` set, `PLATO_SENDMAIL_PATH` executable when
  set, `config.json` parses, `operator.email` + `branding.baseUrl`
  set, DB/posts/exports paths writable, port free. OK / WARN / FAIL,
  exit 1 on any FAIL.
- **`docs/02-features/deploy-guide.md`** — refactored to reference
  `deploy/` files instead of inlining heredocs. New "Step 10:
  bootstrap.sh" replaces three steps (systemd / nginx / cron /
  logrotate) with one command, plus a manual-rendering block for
  operators who want to audit the substitution. Step 9 gains a
  `bin/preflight.sh` invocation. Cert-renewal troubleshooting
  section now points at `bin/check-cert.sh`. Routine-operations
  table grows preflight + check-cert + bootstrap-rerun rows.
- **`docs/02-features/cron-jobs.md`** — removed postfix-as-MTA
  recommendation; now points at msmtp via the deploy guide. Cron
  scripts still call `/usr/sbin/sendmail -t` (msmtp's symlink),
  so no script changes were needed.

### Added — SMTP unification via msmtp + comprehensive deploy guide (post-M8, deploy/1)

- **`src/mail/transport.js`** — single source of truth for plato's
  outbound mail transport. Reads `PLATO_SENDMAIL_PATH` from env and
  returns a nodemailer sendmail transport pointed at the binary. When
  the env var is unset (dev), returns `null` — knowless keeps its
  SMTP-localhost:1025 default which fails fast and falls back to the
  `KNOWLESS_DEV_LOG_LINKS` stderr path. Production sets
  `PLATO_SENDMAIL_PATH=/usr/sbin/sendmail` (the symlink installed by
  the `msmtp-mta` package) so plato pipes magic-link mail through
  msmtp; relay credentials live in `/etc/msmtprc` (root, mode 600)
  and never enter the plato process. +9 unit tests (807 → 816).
- **`bin/server.js`** — passes the constructed transport to knowless
  via the existing `transportOverride` knob. knowless package
  unchanged.
- **`.env.example`** — documents `PLATO_SENDMAIL_PATH` with a pointer
  to the deploy guide for the matching `/etc/msmtprc` setup.
- **`docs/02-features/deploy-guide.md`** (NEW) — single, opinionated,
  end-to-end path from a fresh AlmaLinux 9 VPS to a running plato
  instance with TLS, mail, monitoring, and backups. AlmaLinux + nginx
  + certbot + msmtp + systemd + `/etc/cron.d/plato` + logrotate.
  Includes per-step commands, an "inner wiring" diagram, a
  troubleshooting section, and a security checklist. Designed to be
  followable by an operator with AI assistance and zero plato
  background.
- **Why msmtp instead of postfix/SaaS:** msmtp is a single OSS binary
  (~2 MB, no daemon, no spool), provides the `/usr/sbin/sendmail`
  symlink so cron's `MAILTO=` and plato's transport both work without
  code, and fails synchronously on relay rejection (no silent queue).
  knowless's "refuses SMTP auth" security default is preserved as a
  side effect — knowless still talks to a local binary via nodemailer's
  sendmail transport, never speaks SMTP, never holds creds.

### Added — eval-image curated seed + README "What plato gives you" rewrite (post-M8)

- **`bin/eval-seed.js`** runs from the docker entrypoint when
  `PLATO_EVAL_SEED=1` AND `//lobby` doesn't already exist. Coverage
  is shaped to put every visible plato concept on the front page
  for an evaluator. Creates:
  - 4 native personas (alice/bob/carol/dave) + 2 imported personas
    (zed/yann) — pseudonymized handles derived from the container's
    `KNOWLESS_SECRET`, so a visitor who types `alice@plato.eval`
    lands in alice's populated session.
  - 3 subs: `//lobby` (sticky note set), `//field-notes` (with
    project / question / writeup flairs), and `//ham-archive` (an
    *imported* sub — `imported_from_url` + `imported_from_fingerprint`
    + `imported_at` set, imported handles render with the muted-italic
    treatment, [imported] chip on the sub link, imported-banner on
    the sub page).
  - 13 native posts + 3 imported posts, with realistic content
    covering markdown (bold/italic/inline code/code blocks), links,
    and the auto-link rendering for outbound URLs.
  - 8 comments including 2-deep reply threads.
  - 17 votes for score variance.
  - **1 soft-removal + 1 hard-removal** (with reasons) so the
    public `/modlog` shows both moderation tiers; soft = collapsed
    with body still expandable, hard = removed with a stub.
  - **5 notifications and 3 posts of activity** for alice — when a
    visitor logs in as `alice@plato.eval`, `/memlog?mode=notifications`
    is non-empty (header unread chip is non-zero), `?mode=activity`
    shows her posts, `?mode=all` shows the union.
  Sticky note on `//lobby` documents the alice@plato.eval login path.
  Idempotent: re-running on a persistent volume skips because
  `//lobby` already exists. Production deploys never set the env
  var, so the seed never executes there.
- **README "What plato gives you" rewrite.** The section was prose-
  heavy with multi-sentence value propositions buried inside long
  paragraphs. Rewritten to one bolded headline + 2-3 supporting
  lines per item. Same set of values, faster to skim.

### Added — evaluation Docker image (post-M8)

`docker run --rm -p 8080:8080 ghcr.io/hamr0/plato:latest` boots a
fresh forum at `http://localhost:8080`. A yellow strip at the top of
every page flags it as evaluation-only and links to
[operator-guide §Why no docker for production](docs/02-features/operator-guide.md#why-no-docker-for-production).

Workflow for an evaluator:
1. `docker run …` (one command, no cloning, no env setup)
2. Click *log in*, enter any email
3. Watch `docker logs` for the magic-link URL, paste into browser
4. You're in.

Pass `-v plato-data:/app/data` to persist `forum.db` + `posts/` +
the auto-generated `KNOWLESS_SECRET` across restarts; without it
the container is fully ephemeral.

Implementation: `Dockerfile` (multi-stage, `node:22-alpine`, runs as
non-root `node` user, ~241 MB), `bin/docker-entrypoint.sh` for
first-boot setup (generates secret, runs migrations, execs server),
`.dockerignore` to keep the build context lean, and
`.github/workflows/publish-eval-image.yml` that pushes to GHCR on
`v*.*.*` tag (with `latest` always tracking). Docker's
`HEALTHCHECK` directive wires through `/healthz` (M8/B2) so
`docker ps` reports plato's own readiness signal.

The production deploy path stays no-docker. plato is single-process
/ single-SQLite / single-port; container orchestration adds friction
without solving anything plato needs. New operator-guide section
**Why no docker for production** captures the full reasoning.

App-side: new `evalBanner` option on `createApp` (off by default).
`bin/server.js` flips it on when `PLATO_EVAL_BANNER=1` is set in the
env. +3 tests covering off-by-default, on-everywhere when on, and
the strip's position above the page header. 804 → 807 green.

## [0.8.0] - 2026-05-08 — M8 closeout (operator surface)

M8 — "operator surface + UX polish." Closes the operator-facing arc: light/dark theme toggle (B0), `/healthz` readiness probe (B2), `bin/backup.sh` local snapshot script (B3), `bin/health-watch.sh` cron-side `/healthz` watcher (B4), daily stats + weekly digest (B5), sticky note per sub (B1), plus Reddit-aligned content-cap locks and the comment "read more / show less" toggle. Also lands the import-dedupe-fails-fast fix that closes a lingering M7 retry foot-gun.

### Closed — M8 stats + alert-recipient cleanup (M8/B5 + B4 follow-up)

- `bin/stats.js` daily snapshot now includes `votes` (count of cast
  votes in `forum.db`; toggle-off DELETEs the row so total-row-count
  is the right "currently in effect" measure). `bin/stats-weekly.js`
  table gains a `votes` column with the same WoW Δ formatting; legacy
  snapshots that pre-date the votes field render as `0` rather than
  `NaN`.
- `bin/health-watch.sh` recipient resolution unified with the rest of
  plato's cron surface: `HEALTH_ALERT_EMAIL` env wins (route alerts
  to a dedicated PagerDuty / Opsgenie inbox if you want), falls back
  to `config.json:operator.email` (the same address `bin/stats-weekly.js`
  + the disposable-domains + URLhaus refresh jobs use). When neither
  is set, the log stamp at `$BACKUP_DIR/health.log` is the artifact —
  no email, no swallow.
- Operator-guide: new "If something breaks" entry at the top of the
  *When something goes wrong* section points at the GitHub issue
  tracker and notes that the B4 alert email contains a paste-ready
  issue body. New logs-reference table covers everything plato writes
  itself (small, no rotation needed) vs. operator-redirected cron
  logs (`logrotate.d` snippet in `cron-jobs.md`).

This closes M8.

### Added — sticky note per sub (M8/B1)

Mods (owner or co) now have a single short text field per sub —
`subs.sticky_note` — that renders above the feed on `/sub/<name>`.
≤ 200 chars, markdown via the same `renderMarkdown` pipeline that
posts use (so raw HTML stays escaped, image syntax becomes a link,
dangerous URL schemes get filtered). One note per sub; no history;
edits overwrite; empty submit clears. Visually a warm-accent
left-rule block — readers register it as "moderator speaking",
not another post.

Editable from `/sub/<name>/edit` (visible to any mod role) via a
new `POST /sub/<name>/sticky` route — separate from `/edit` so
co-mods retain the mod-voice slot without inheriting the
owner-only settings surface (description, flairs, thresholds).
Disabled subs reject the edit (409) so a read-only sub can't gain
a fresh mod-voice block during the silence window.

Locks: one note per sub, mods only, 200-char max, no algorithmic
feed promotion (sticky note is the *only* mod-voice slot above the
feed; post-pinning remains permanently out — see PRD §Permanently
out). Migration 023 adds the column. +18 tests; 786 → 804 green.

### Added — `bin/health-watch.sh` cron-side `/healthz` watcher (M8/B4)

Pairs with the B2 readiness probe. Curls `/healthz` from cron; silent
on `200` so cron mail stays quiet. On non-2xx (or curl-level failure,
pseudo-status `000`):

- Appends one structured line to `$BACKUP_DIR/health.log` —
  `<ISO ts> host=<h> status=<code> reason=<...>`. If the response was
  JSON the reason names which checks failed (e.g.
  `db_writable=false,exports_dir_writable=false`); if not, it tags
  `unparseable_body`.
- If `$HEALTH_ALERT_EMAIL` is set, sends an email via `mail` or
  `sendmail` (whichever is on PATH; if neither, the alert is logged
  to stderr instead of swallowed). Email body has five sections —
  failure summary, response-body excerpt (first 20 lines so HTML 404
  pages don't drown the message), last 30 lines of `$PLATO_LOG`,
  last 5 rows of `health.log`, and a paste-ready GitHub issue
  template. The intent: when something breaks at 3am, the operator
  wakes up with a ready-to-paste issue body, not a raw stack trace.

Tunables: `PLATO_URL` (default `http://localhost:8080`),
`HEALTH_TIMEOUT_S` (curl `--max-time`, default 5). Sample crontab in
the operator-guide.

### Added — `bin/backup.sh` local snapshot script (M8/B3)

`bin/backup.sh` writes a single tarball per run to `$BACKUP_DIR`
(default `./backups`) named `plato-backup-<YYYY-MM-DD-HHMMSS>.tar.gz`.
The DB is snapshotted via `sqlite3 .backup`, which uses SQLite's
online-backup API — concurrent writers continue, the copy is
internally consistent, the server doesn't need to stop. Auxiliary
files (`posts/`, `exports/`, `config.json`, `spam-patterns.txt`,
`data/urlhaus.txt`, `disposable-domains.txt`) are staged and tarred
alongside; missing optional files are skipped silently so fresh
installs work.

Rotation keeps the newest `$BACKUP_KEEP` archives (default 7) and
deletes older ones. Off-host copy is operator-opt-in via a commented
`rsync` stanza at the bottom — we don't bake SSH key management into
plato.

Operator-guide gets a sample crontab entry (`30 3 * * * cd /opt/plato
&& BACKUP_DIR=/var/lib/plato-backups bin/backup.sh ...`) and the
restore procedure (stop → unpack → copy `forum.db` + `posts/` into
place → ensure `KNOWLESS_SECRET` matches the original deploy → start).

### Added — `/healthz` operator probe (M8/B2)

New public, unauthenticated `GET /healthz` returns JSON
`{ok, version, uptime_s, db_writable, exports_dir_writable, last_migration}`
with `Cache-Control: no-store`. Status code is `200` when both
writability checks pass and `503` when either fails — so an external
watcher (a curl in cron, a Pingdom-style probe, the B4 health-watcher
cron coming next) can alarm on non-2xx without parsing the body.

`db_writable` runs `BEGIN IMMEDIATE; ROLLBACK;` so the probe acquires
the same reserved lock real writes do (read-only mounts and stale
handles surface here, not just at the next user POST).
`exports_dir_writable` is an `accessSync(W_OK)` against the configured
`exportsDir`; not-configured counts as false. `version` is read from
`package.json` once at module load. `last_migration` reads the
`schema_migrations` tail and returns null when the table is absent
(fresh installs, or test fixtures that bypass `bin/migrate.js`).

Operator-guide section under recurring operations explains the curl
one-liner. The B4 watcher cron will tail this route and email the
operator on non-2xx; B2 is the surface, B4 is the consumer.

### Locked — post + comment length caps stay at Reddit's numbers

Server-side caps `TITLE_MAX = 300` / `BODY_MAX = 40 000` / `COMMENT_BODY_MAX = 10 000` are now PRD-locked at Reddit's exact numbers (PRD §Content Model → Length limits). Plato's audience overlap with Reddit is the largest of the forum-shaped peers, so a Redditor pasting an existing post over should just work. HN/Lobsters tighten via social pressure; plato's visual layer already nudges shorter without constraining the cap (`COMMENT_PREVIEW_CHARS = 280` auto-folds long comments, feed previews truncate post bodies to one paragraph). If real usage shows runaway thread sprawl, drop `COMMENT_BODY_MAX` to 5 000 — that's the next stop along the HN direction. Don't tighten preemptively.

### Added — comment "read more" / "show less" toggle

Long comments fold behind a 280-char preview. Old behavior hid the entire `<summary>` element when expanded, so once a user clicked `read more` there was no visible affordance to fold the comment back — clicking the summary again worked structurally but the click target was invisible. Summary now renders three children (`<span class="comment-preview">…truncated… </span>`, `<span class="read-more">read more</span>`, `<span class="show-less">show less</span>`); CSS toggles which two are visible based on `[open]`. Pure native `<details>` behavior with CSS adornment, no JS.

### Fixed — import dedupe collision now fails fast instead of retrying

When a sub-import URL points at an archive that's already been imported
on this instance (same `(source_sub, source_exported_at)` key), the
worker used to swallow the dedupe error and re-queue the job up to
three times. Same source archive, same lock — three wasted ticks
before the user saw the failure in /memlog.

Dedupe collisions now mark the import job terminal-failed on the
first attempt. The `import_failed` notification fires immediately
("import failed: already imported as //x on YYYY-MM-DD" — no
"after 3 attempts" wording). `failImport(db, jobId, { terminal: true })`
is the new escape hatch for errors guaranteed to recur on retry; the
worker tags the dedupe error and the queue forces `failed_at` now.

### Added — light/dark theme toggle (M8/B0)

A two-state theme button now sits last in the header right-cluster.
Default behavior follows the OS hint via `@media (prefers-color-scheme:
light)`; once the user clicks, that choice is sticky in `localStorage`
and the OS hint stops applying for that browser. An anti-flash inline
`<script>` in `<head>` stamps the saved `data-theme` on `<html>` before
first paint so reloads don't strobe. Without JS the toggle button is
hidden via CSS (`html:not(.has-js) .theme-toggle`), so users on no-JS
browsers get prefers-color-scheme behavior without dead chrome.

Active defaults: dark = **tokyo-night** (`#1a1b26` bg, `#c0caf5` text —
modern deep navy with soft blues, settled on after eyeballing nine
candidates side-by-side), light = **zinc-cool** (`#eef0f2` bg,
`#202428` text — soft cool gray, lowest brightness of the light
options for long sessions).

`style.css` ships drop-in palette presets — copy any commented
`:root { ... }` block over the active one and reload, no config touch
needed. **Dark presets** (9): tokyo-night, github-dark, warm-amber,
cool-cyan, mocha-purple, monokai-pro, nord, gruvbox-dark, night-owl.
**Light presets** (5): zinc-cool, github-light, notion-cream,
solarized-light, stone-warm.

Operators can override the light palette the same way they already
override the dark palette — `branding.colors` (existing) sets `--up`
and `--down` for dark; the new `branding.colorsLight` sets the same
variables for light. Both are validated by the same
`resolveBrandingColors` (CSS-injection guard, ASCII-clean values),
emitted as inline `<style>` blocks scoped to `:root`,
`[data-theme="light"]:root`, and the media query.

Added `src/web/static/theme.js` (~30 LOC, defer-loaded). The
sub-create / sub-import submit buttons (`.sub-create-form button`)
were also restyled as pill chips matching the create/import tab strip
above them — the `/sub/create` action row reads as one consistent
button family. No schema change.

## [0.7.0] - 2026-05-07 — M7 closeout (archives)

M7 — "archives + portability." Closes the data-portability arc: per-sub archive builder (B2-a) and HTTP routes / personal export (B2-b), Ed25519 archive signing (B4), URL-fetch sub-import with bracket-collision pseudonyms (B5), OpenTimestamps anchor (B6), plus the followup polish wave: imported-author render lock, sub-import + sub-export modlog rows, paginated static reader inside large archives, and the cross-side / auto-flip / clear-all overhaul of `/memlog` filters that the import surfaces drove.

### Added — sub-archive paginated reader mirrors personal archive

The offline static reader inside per-sub archive tarballs now scales
the same way the personal-archive reader does. When `posts.length`
crosses 100, `index.html` becomes a chip navigator (`posts (N, Mp)` +
one chip per `<year> (N)`) plus a "// recent activity" preview of the
20 newest posts; subpages `posts.html` (paginated 100 per page) and
`<year>.html` render the filtered lists. Below the threshold the
single-page render is preserved unchanged. Comments stay nested
inside per-post HTML pages — sub archives are post-centric, not flat
streams of comments.

The pagination primitives (`PAGINATION_THRESHOLD`/`PAGE_SIZE`,
`bucketByYear`, `paginateBucket`, `pagerHtml`, `PAGINATION_CSS`) are
extracted into `src/archive/reader-pagination.js` and shared between
`user-export.js` and `sub-export.js` so future tweaks land in lockstep.
The `.tar.gz` shape is unchanged from an importer's perspective: the
new HTML subpages are just additional inert files alongside the
existing `index.html`/`posts/<id>.html`. URL-import remains the same
URL — importers consume `*.json` + `posts/<id>.md` and ignore the
HTML.

Adds `bin/m7-seed-bigsub.sh` smoke seed (120 posts + 60 threaded
comments) so the reader's round-trip can be eyeballed end-to-end
without reconstructing inline node from a stash.

### Memlog filters: cross-side chips + auto-flip + showing/clear-all footer

Three changes that compose into a much friendlier `/memlog`:

- **Multi-select kind chips with cross-side semantics**. Each chip
  declares both halves it touches: `notifKinds` (notification kinds)
  and `contentKinds` (activity content types — `post` / `comment`).
  The `comments` chip is cross-side: in any mode it matches both
  received-comment notifications AND comments the user authored.
  Same for `posts` (activity-only). Mode-specific chips (`replies`,
  `mod-actions`, `archives`, `imports`) narrow only their half.
  URLs encode the multi-select as `?kind=archives,comments`.
- **Auto-flip empty unread**. When `show: unread` returns 0 rows but
  read history exists, `/memlog` flips to `show: all` and surfaces a
  "no unread match — showing read history. <back to unread>" hint.
  Saves the user from chasing a "broken" filter that was actually
  just narrowing past read items.
- **Filter-aware empty state**. "no `<comments + archives>`
  notifications." beats the misleading "no unread notifications."
  when a filter genuinely has zero matches.
- **Modlog-style "showing: X · clear all" footer** below the chip row
  whenever the selection differs from defaults. One click clears.
- **Filter chips stay visible across all modes**. Was: hidden in
  activity mode, which read as vanishing. Now: chips always render;
  visibility per-chip narrows to those that touch the active mode's
  half (notifications mode hides activity-only chips, activity mode
  hides notification-only chips, all mode shows everything).
- **all-mode inclusion rule keys on side-touching**. Selecting a chip
  that touches only one half drops the other half (otherwise activity
  rows dominate and notif filters look ineffective). Selecting a
  cross-side chip shows both halves filtered.

`my-posts` / `my-comments` slugs collapse to plain `posts` / `comments`
— the `my-` namespacing was the source of the conflict the user
flagged ("comments" was ambiguous between received vs authored).
Single migration: pre-v1, no compat shim; old URLs with `my-posts`
silently degrade to no filter (the slug isn't recognized).

772 green; tests cover the new chip rendering and filter combos.

### Polish — [i] chip on sub index header + listing surfaces; titleHtml split; manage-sub layout

Round of small fixes after the C-render lock and pagination shipped:

- **`[i]` chip surfaces** beyond the inner sub-scoped pages: now renders
  on the sub index page brand row, in the home active-subs strip, and
  in the /subs directory rows. `listSubsForNav` and `listAllSubs`
  queries now select `imported_from_url` + `imported_at` so the chip
  helper has the data.
- **Chip styling**: bare `[i]` glyph in `--text-dim` (gray), no border,
  no padding. Distinct from the amber `--accent-warm` `[!]` sensitive
  marker so the two carry different meanings unambiguously.
- **`pageView` titleHtml split**: an earlier attempt embedded the chip
  inside the `title` param. That broke `<title>` (which is RCDATA — the
  `<span>` rendered as visible text in the browser tab) and `og:title`
  meta (the chip's own `title="..."` attribute closed the meta's
  `content="..."` early). Added an optional `titleHtml` param: plain
  `title` (string) flows into `<title>` + `og:title`; `titleHtml`
  (raw HTML) flows into the body brand-row h1. Backwards compatible —
  every existing caller keeps its current render.
- **`/sub/<name>/edit` flag-threshold row**: `distinct flaggers (≥ 3)`
  was wrapping because the label column was fixed at 8.5rem. Bumped
  to 11rem + `white-space: nowrap`. Same `.threshold-row` is shared
  with `/sub/create`; both benefit.

770 green; CSS-only and additive render changes.

### Added — personal-archive reader: filter chips + pagination

The offline static reader now scales to large archives without a single
giant index page. When total items (posts + comments) exceeds 100, the
landing page becomes a chip-based navigator and the actual lists move
into pre-rendered subpages. Below the threshold, the reader keeps the
single-page render — small archives don't benefit from clicking through.

- **Landing page (paginated mode)**: pseudonym + active-in line +
  filter chips: `posts (N, Mp)` / `comments (N, Mp)` / one chip per
  year `<YYYY> (N)`. Plus a "// recent activity" preview of the last
  20 items mixed. No JS, all chips are plain `<a>` links.
- **Subpages**: `posts.html`, `comments.html`, `<year>.html` —
  paginated to 100 items per page (`posts-2.html`, `posts-3.html`, …
  when needed). Each page links back to `index.html` and carries
  prev/next pagination at top and bottom. Year pages mix posts +
  comments authored in that year, ordered newest-first.
- **No text search** — the static reader's "no JavaScript, fully
  offline" lock holds. Browser ctrl-F still works within a page.
- **Page size 100, threshold 100**: archives with 1 post and 1
  comment render the same as before; 1000-item archives get ~10
  pages per filter. +2 tests in `test/integration/user-export.test.js`
  (768 → 770 green).

### Changed — M7 followup: imported authors render dim+italic with aria-label, persistent [i] sub chip

Final lock on the imported-author signal after a side-by-side comparison
of four render options (brackets, dagger, dim+italic, bracket+dim).
The worry — a reader replying to an archived author whose reply will
never arrive — is now carried by two parallel signals on every imported
pseudonym, driven from one render rule:

1. **Visual.** Span wrapped in `class="imported-author"` styled
   `opacity: 0.6; font-style: italic`. Two channels (color + style)
   so the signal survives colorblind / high-contrast modes — italic
   is the non-color hook.
2. **Assistive tech.** `aria-label="imported author alice-tiger"` on
   the wrapping span. Screen readers announce "imported author
   alice-tiger" so the dim styling isn't lost on non-visual readers.

A `-N` numeric suffix on a colliding pseudonym (collision plumbing for
the UNIQUE constraint) is stripped at render time *only* for imported
handles. Native HMAC pseudonyms ending in `-N` are unaffected — the
strip is gated on `imported_from_fingerprint`.

`pseudonymsByHandle` returns an `AuthorView` value: plain string for
native handles, raw-html object with a `toString` fallback for imported.
Templates interpolate the html; string concat and `escapeXml` get the
bare display name (no extra glyph) by design — option C is
visual-styling-only. Plain-text contexts (RSS, mod-filter summary
strings) get the bare name. The imported-banner on the sub index and
the persistent `[i]` chip on inner pages carry provenance where styling
can't reach.

- **`.imported-author` CSS class** added — `opacity: 0.6;
  font-style: italic`. One rule, two visual channels.
- **Imported-banner copy** on `/sub/<name>` index reads
  `[imported] from <host> on <date> · imported by <pseudo>. posts, comments, votes, and modlog are preserved verbatim from the source archive.`
  No symbol-key footnote — the dim/italic styling speaks for itself
  alongside the explicit banner.
- **Compact `[i]` chip** persistent on inner sub-scoped pages (post
  detail, public modlog, sub-edit). `title` attribute carries
  `imported from <host> on <date>` on hover.
- **`pseudonymForImport`** unchanged — `-2`/`-3`/… collision suffix
  storage was already correct.
- Bracket-everywhere render and dagger-render iterations are both
  superseded. Tests rewritten to assert
  `<span class="imported-author" aria-label="imported author <name>">`
  shape + display strip on imported / no-strip on native + chip
  presence + native-no-chip + banner copy without dagger explainer.
  +5 tests in `test/integration/import-routes.test.js` (763 → 768
  green).

### Added — M7 followup: sub-archive import surfaces in public modlog

Parallel to the export-side modlog row shipped earlier this session.
Closes the modlog symmetry — the destination instance now records
the import as a native action alongside the historical
`[imported]`-tagged rows from the archive.

- **Migration 022** adds `'import'` to the `mod_actions` action
  CHECK enum (rebuild pattern as 017 / 021).
- **`recordSubImport(db, { subName, importedBy, now })`** in
  `src/content/mod.js` mirrors `recordSubExport`. Wired into
  `importSubArchive` after the imported sub + handles + posts +
  comments + (archived) mod_actions all land.
- **Native row, no `[imported]` tag.** The import act happened on
  this instance, not in the archive being imported, so
  `imported_from_fingerprint` stays NULL. Together with the
  archive's historical `[imported]`-tagged rows, the destination
  modlog tells the full migration story for the sub.
- **Renderer label**: `MOD_ACTION_LABELS.import = 'sub imported'`.
- +1 test in `test/integration/import-queue.test.js`
  (762 → 763 green).

### Changed — M7 followup: imported pseudonyms render bracketed everywhere

Final lock on the bracket question. Brackets move from storage to
render time, and apply to every imported handle — not only on
collision. The signal a live reader needs ("this user is from
another instance, replies won't reach them") now surfaces wherever
an imported pseudonym appears: post author, comment author, modlog
mod_handle, /memlog actor cell.

- **`pseudonymForImport`** simplified: no brackets at storage
  time; on collision append a numeric suffix
  (`alice-tiger-2`, `alice-tiger-3`, …) so the UNIQUE constraint
  holds. The `bracketed` field on the return shape is renamed
  `disambiguated` since brackets are no longer stored. Internal
  API only — no caller change beyond the rename + the counts
  field name.
- **`pseudonymsByHandle`** in `src/web/app.js` now selects
  `imported_from_fingerprint` and pre-bracket-wraps the display
  pseudonym for imported handles. Every render site that already
  consumed this Map gets the bracket signal automatically — no
  per-template change needed. The chrome's logged-in-user
  pseudonym (which is always native) goes through `pseudonymFor`
  (single-handle) and stays unbracketed.
- DB pseudonym stays canonical: URLs, search filters, future
  @-mentions all see `alice-tiger`, not `[alice-tiger]`.
- PRD §Cross-instance imports → Identity model rewritten to lock
  render-time bracketing; archive-format.md, operator-guide,
  plato.context updated. +1 test verifies the wrap surfaces in
  /sub/<name>/modlog (763 → 764 green).

### Fixed — POSTS_DIR honored in bin/server.js

Server.js had `POSTS_DIR` hardcoded to `ROOT/posts`, ignoring the
env var that workers and the manual-smoke scripts already use.
On any deployment with `POSTS_DIR` pointed elsewhere (multi-
instance dev pair, custom production install layout) the running
server would 500 on `/sub/<name>/post/<id>` with ENOENT because it
read from the dev repo's directory instead of the configured one.
Now reads `process.env.POSTS_DIR` like `DB_PATH` and
`EXPORTS_DIR` already did.

### Added — M7 followup: sub-archive export surfaces in public modlog

Sub-exports leaving the instance are public-facing transparency
events; the community deserves to know who has taken a copy. Closes
the loop on M7's "export is honest because the bytes leave" by
making the act itself visible in the same audit log that already
shows collapses, removals, and bans.

- **Migration 021** rebuilds `mod_actions` with `'export'` added to
  the `action` CHECK enum (existing imported_from_fingerprint
  column from migration 020 is preserved). SQLite can't ALTER a
  CHECK in place — same rebuild pattern as 017.
- **`recordSubExport(db, { subName, requestedBy, now })`** in
  `src/content/mod.js` writes a row directly without going through
  `recordAction`'s mod-role gate. Sub-export eligibility (mod OR
  60-day continuous subscriber) is checked at request time by
  `canExportSub`; the modlog row is the transparency receipt.
- **Wired into all three completion paths** in
  `src/archive/queue.js`:
  1. `completeJob` parent — worker finished a build.
  2. `completeJob` sentinel fan-out — each sibling sharing the
     artifact gets credit for its own requester.
  3. `enqueueSubExport` same-day shared-artifact dedupe path
     (`insertSharedCompletedRow`) — second user requesting the
     same sub same day reuses the bytes but still gets a row.
- **Personal exports (`kind='user'`) explicitly do NOT write a
  modlog row.** Personal archives are private; surfacing the act
  on a public log would leak who is leaving.
- **Failed exports do not write a row.** The modlog records what
  actually happened, not what was attempted.
- **Renderer label**: `MOD_ACTION_LABELS.export = 'archive
  exported'` in `src/web/app.js`. Imported sub-archives carry
  historical export rows verbatim with the existing `[imported]`
  tag pattern (M7/B5) — no extra wiring on the import side.
- +5 tests in `test/integration/export-queue.test.js`
  (757 → 762 green).

### Added — M7 followup: bearer URL is click-to-copy on /memlog

Before this change the bearer URL on `export_ready` /memlog rows
was hidden behind the chain-of-custody `/memlog/go/<id>` redirect.
Operators who wanted to share or paste the URL into another
instance had no surface to copy from.

- **Per-row click-to-copy button** under the snippet on every
  `export_ready` row, rendered through the existing `.rssvp-copy`
  styling. The time-cell still routes through `/memlog/go/<id>`
  (download path); the new button surfaces the URL as text.
- **Personal-archive `<details>` block** now lists the bearer URL
  as click-to-copy when a completed personal archive is on hand,
  mirroring the rssvp-list pattern further down the page.
- **Cursor fix**: `.memlog-export > summary` got the same
  `cursor: pointer` rule the rssvp summary already had.
- Style version bumped to `?v=26`.

### Added — operator-side smoke scripts

- `bin/m7-smoke-real.sh` — full HTTP round-trip across two real
  `bin/server.js` instances on free ports. Drives login via the
  dev-stderr magic-link path, POST `/sub/<name>/export-request`,
  the `/memlog/go/<id>` chain-of-custody resolution, POST
  `/sub/import` on the destination, and renderer assertions
  on `/sub/<name>` + `/sub/<name>/modlog`. Complements the
  existing worker-pipeline smoke (`bin/m7-smoke.sh`).
- `bin/m7-manual-smoke-up.sh` + `bin/m7-manual-smoke-down.sh` —
  stage a persistent two-instance dev pair on :8081/:8082 with
  realistic seed content (//lobby, //bytes, four posts, two
  comments, one mod action) for the human eyeball pass. Idempotent
  re-run; teardown wipes state.

### Locked — M8 spec (operator surface + UX polish)

Folded into the build-plan as five locked B-items: B0 light/dark
theme toggle (CSS variables, anti-flash inline script,
operator-overridable palettes), B1 sticky note (one mod-editable
note per sub, max 200 chars, the *only* mod-voice slot above the
feed — post-pinning stays permanently out per PRD), B2 `/healthz`
endpoint, B3 local backup script (atomic SQLite `.backup` + tarball
of posts/exports/config; rotates last N), B4 health-watch cron with
optional email + GitHub-issue diagnostic block, B5 weekly stats
report (handles, subs, posts, comments, votes; week-over-week
deltas; plain-text email). All operator-side tooling is shell
scripts and a `/healthz` JSON route — no built-in supervisor, no
Docker images, no Prometheus exporter, no clustering. See
`docs/01-product/build-plan.md → M8 [LOCKED]`.

### Added — M7/B6: OpenTimestamps anchor (operator-opt-in)

Closes the trust loop on archives. B4's Ed25519 signature proves
"these bytes weren't tampered with after the source signed them";
B6's OpenTimestamps proof anchors the archive's hash to a Bitcoin
block, so anyone with a Bitcoin node can prove "this archive existed
no later than block N's timestamp" without trusting plato or the
source operator. Useful precisely when the source instance is dead
and someone disputes when the content existed.

- **Zero new npm dependencies.** plato keeps its "five runtime deps"
  posture intact. Operators who want OTS install the official
  `opentimestamps-client` Python CLI once (`apt install
  opentimestamps-client` or `pipx install opentimestamps-client`)
  and wire two cron lines (one for stamp at export time is automatic
  from the export worker; one for daily upgrades against
  `bin/run-ots-upgrade.js`).
- **Pattern lifted from gitdone**
  (`~/PycharmProjects/gitdone/app/src/ots.js` +
  `app/bin/ots-upgrade.js`). Plato's `src/archive/timestamp.js` is
  the same shape: `spawn('ots', ['stamp', file])` for stamping,
  `spawn('ots', ['upgrade', proof])` for daily upgrades. Both are
  ENOENT-tolerant — if the binary is missing, they return
  `{ error: 'ots not found' }` and the export worker logs + proceeds.
  Stamping is best-effort polish, never load-bearing.
- **`bin/run-ots-upgrade.js`** is the daily upgrade cron. Walks
  `EXPORTS_DIR/*.tar.gz.ots`, runs `ots upgrade` on each, uses the
  bytes-changed signal as the authoritative "got anchored to
  Bitcoin" event (mirrors gitdone). Idempotent; safe to run any
  frequency. Logs structured: `<count anchored>, <count
  pending/already-anchored>, <count errored>`.
- **`GET /export/<token>.tar.gz.ots`** — token-bearer download
  matching the `.sig` route. Same posture: token IS the credential,
  no auth check. 404 message explicitly says "operator may not have
  opted in" so importers can distinguish "stamp not present" from
  "stamp failed verification."
- **`/about`** gains a paragraph in the archive-signing section
  explaining the .ots file when present, including the
  `ots verify <archive>.tar.gz.ots` recipe and a link to
  opentimestamps.org.
- **+11 tests** (746 → 757): timestamp wrapper unit tests with stub
  `ots` binaries (success / non-zero exit / ENOENT / timeout / proof
  missing after stamp / upgrade success / upgrade non-zero / upgrade
  ENOENT); .ots route end-to-end (served when present, 404 with
  hint when absent, bad token rejected).

### Added — M7/B5: sub-import (URL-fetch model)

The fork-and-go promise made loud in the PRD's §Exit as the real check
becomes mechanical: a community can leave one plato instance and arrive
on another with all posts, comments, votes, and modlog history intact.
The trust anchor is the URL itself — forum-B fetches the bytes from the
URL the user pastes; if you trust the URL enough to paste it, you trust
the bytes. No uploads, no chain-of-custody, no operator-only gate.

- **Schema (migration 020).** New `import_jobs` table mirrors
  `export_jobs`'s shape (pending → in-progress → succeeded | failed via
  three timestamps + retry_count); idempotence index on
  `(source_scope_sub, source_exported_at) WHERE completed_at IS NOT NULL`
  so the same source archive only succeeds once. New columns:
  `subs.imported_from_url|fingerprint|at|at_source` for the imported
  badge; `handles.imported_from_fingerprint` for synthetic
  non-claimable rows; `mod_actions.imported_from_fingerprint` for the
  `[imported]` modlog tag.
- **`src/archive/extract.js`.** POSIX USTAR reader, mirror of `tar.js`'s
  writer. Validates header checksums, rejects path traversal,
  dispatches `Map<path, Buffer>`. Hobby-scale, single-pass.
- **`src/archive/import.js`.** Pure builder: parse + verify per-file
  SHA-256 against the manifest, refuse `kind=user` archives outright,
  insert handles under their original 64-hex with archived pseudonyms
  (preserved verbatim unless they collide on the destination's UNIQUE
  pseudonym constraint, in which case the lexical part is wrapped in
  brackets — `clever-tiger` → `[clever]-tiger`; further collisions get
  numeric disambiguators), insert the sub with the importing user as
  owner, insert posts (preserving original IDs / timestamps / scores /
  flair / sensitive / soft-state), copy `posts/<id>.md` to disk, insert
  comments threaded by `parent_comment_id`, insert mod_actions tagged
  `imported_from_fingerprint`. Refuses on destination sub-name conflict
  unless `renameTo` is provided.
- **`src/archive/import-queue.js`.** State-machine helpers parallel to
  the export queue: `enqueueSubImport`, `claimNextPendingImport`,
  `completeImport`, `failImport`, `markStaleImportsAsFailed`,
  `findCompletedImportBySource`, `findLatestImportJob`. SLA = 3 days.
- **`bin/run-import-queue.js`.** Off-peak worker (env `IMPORT_OFFPEAK_*`
  mirroring export env). Per tick: size-capped streamed fetch (env
  `IMPORT_MAX_BYTES` default 500MB; 120s timeout via `AbortController`);
  gunzip; `parseAndVerifyArchive`; idempotence check via
  `findCompletedImportBySource`; transactional `importSubArchive`;
  memlog notification (`import_ready` linking to
  `/sub/<imported_sub_name>`, or `import_failed` carrying the reason
  in the snippet).
- **HTTP surface.** `GET /sub/create` becomes a two-tab page —
  `?mode=create` (default) renders the existing create form,
  `?mode=import` renders the import form (URL field + optional "import
  as" rename). `POST /sub/import` validates auth + URL + rename name,
  enqueues, redirects to `/memlog?import=queued`. Idempotent on
  `(source_url, requested_by)` while pending.
- **Modlog rendering.** Every mod action with non-null
  `imported_from_fingerprint` now renders with an `[imported]` tag
  prefix (new `modActionCell()` helper used in all three modlog views:
  `/sub/<name>/modlog`, `/modlog` audit mode, `/modlog` inbox mode).
  Existing `listModActions*` SQL extended to select the column so the
  flag is available everywhere it's rendered.
- **Imported-sub banner.** `/sub/<name>` now renders an
  `.imported-banner` chrome row above the sub-state banner whenever
  `imported_from_url` is non-null: source host (linked), import date,
  importer pseudonym. Visually quieter than `.sensitive-banner` —
  informational, not warning.
- **CSS.** New `.imported-banner`, `.imported-tag`, `.sub-create-tabs`
  classes — every color references existing `--*` variables (no new
  hex literals; forks rebrand without touching B5).
- **+33 tests** (700 → 733): import-queue state machine + builder
  end-to-end + tar reader + pseudonym bracket-wrap; HTTP routes
  (auth gates, URL validation, idempotence, both tabs); imported
  banner + `[imported]` modlog tag rendering.
- **§Permanently out** locks (already in PRD before code lands):
  cross-instance import of personal (kind=user) archives, file
  uploads anywhere in the import flow.

### Added — M7/B4: Ed25519 archive signing

Every archive this instance produces is now cryptographically attributable.
A detached Ed25519 signature ships next to the gzipped tarball, the public
key is discoverable at a well-known URL, and the manifest carries the
fingerprint so importers can match archive ↔ instance ↔ key in one step.

- **Instance keypair, lazy + persistent.** Migration 019 adds a single-row
  `instance_keypair` table (`CHECK (id = 1)`). The keypair is generated on
  first call to `getOrCreateInstanceKeypair(db)` — either at worker boot,
  on first `/.well-known/plato-pubkey` hit, or on first `/about` render —
  and reused forever after. Privkey lives in the DB, honoring plato's
  "one process, one SQLite file" rule. Operators back it up by backing
  up `forum.db`; never rotated in v1.
- **`src/archive/signing.js`** — pure module: `generateInstanceKeypair`,
  `getOrCreateInstanceKeypair`, `signBytes`, `verifyBytes`,
  `fingerprintFromPublicKey`. Built on `node:crypto` Ed25519 primitives;
  no new deps. Fingerprint format is `"sha256:" + sha256(raw 32-byte
  pubkey).hex()`.
- **Worker signs on completion.** `bin/run-export-queue.js` loads the
  keypair once at boot, threads `pubkeyFingerprint` into both
  `buildSubArchiveBytes` and `buildUserArchiveBytes` (so manifest's
  `instance.pubkey_fingerprint` is populated, not null), and after
  gzipping the tar, writes a sibling `<archive>.tar.gz.sig` containing
  the raw 64-byte signature over the gzipped bytes.
- **`GET /.well-known/plato-pubkey`** — JSON response shape:
  `{algorithm, public_key_hex, fingerprint, created_at, instance:{forum_name, base_url}}`.
  `Cache-Control: public, max-age=300`. Lazy-creates the keypair on
  first hit (so a never-exported instance still has a discoverable
  pubkey).
- **`GET /export/<token>.tar.gz.sig`** — sibling download route.
  Token-bearer, same posture as the `.tar.gz` route (token IS the
  credential, no auth check). 404s if the sig file is missing on disk
  (e.g. archive predates B4).
- **`/about` surfaces the fingerprint** with a link to
  `/.well-known/plato-pubkey` and a one-paragraph explanation of the
  verification flow.
- **Spec lock.** `docs/02-features/archive-format.md` moves M7/B4 out
  of "Future layers" into a "Signing" section: signed bytes = the
  gzipped tarball, format is raw 64 bytes, manifest's
  `pubkey_fingerprint` matches `/.well-known`, importers refuse on
  fingerprint mismatch by default. Verification recipe is explicit so
  third-party tools can check archives without a plato install.
- **+21 tests** (signing module unit + builder fingerprint plumbing +
  three new HTTP routes end-to-end). 700/700 green.

### Added — M7/B2-b: HTTP routes, UX, memlog wiring, personal export

The B2-a offline core (queue, builder, worker, tar) is now reachable
from the browser. Both kinds of archive — per-sub and per-user — can
be requested through forms, watched on `/memlog`, and downloaded via
bearer-token URLs.

- **Sub-export eligibility (PRD §Exit as the real check, locked).**
  `canExportSub(handle, sub)` returns true if the handle moderates the
  sub OR has been *continuously* subscribed for ≥60 days. "Continuous"
  is inherent to the schema: unsubscribe is a hard `DELETE`, so
  resubscribing inserts a fresh `created_at` and the clock restarts.
  Activity is intentionally NOT a gate — lurkers are real members.
- **Personal-export eligibility.** Any logged-in user, any time, no
  tenure. Their own data is theirs from day one.
- **Per-kind production SLA + download TTL.** SLA from request →
  terminal-fail: **sub 7d, user 3d**. Download TTL from completion:
  **3d for both** (chosen for disk-pressure, not policy). The worker's
  pre-tick `markStaleAsFailed` sweep terminal-fails any pending row
  past its kind's SLA window. Retry policy unchanged: 3 attempts then
  terminal-fail.
- **`POST /sub/<name>/export-request`** — gated by `canExportSub`,
  idempotent (re-submits collapse onto the existing pending row),
  redirects to `/memlog?export=queued`. Anon → 401, ineligible → 403,
  missing sub → 404.
- **`POST /export-request`** — personal archive request. Auth-only,
  no tenure check.
- **`GET /export/<token>.tar.gz`** — token-bearer streaming download.
  No auth check. The 64-hex `download_token` IS the credential — same
  posture as `/u/<token>/rss` from M6/B6. Headers:
  `Content-Type: application/gzip`, `Content-Disposition: attachment`,
  `Cache-Control: private, no-store`. 404 on missing/expired token,
  malformed token, or file removed from disk.
- **Sub-page action pill (`/sub/<name>` header, 5 visual states).**
  Anon → live "request archive" link to `/login?next=…`. Logged-in
  non-subscriber → disabled "subscribe to //<name> for 60 days to
  request an archive". Subscriber <60d → disabled "you can request
  this archive on YYYY-MM-DD". Mod or 60d+ subscriber → live form.
  Pending job → disabled "archive queued". Recent completed-not-
  expired job → disabled "archive ready in your memlog (expires
  YYYY-MM-DD)". The pill uses a new `.export-btn` class (sibling to
  `.subscribe-btn`) so future CSS evolution can diverge without
  touching subscribe.
- **`/memlog` personal-export block** — collapsible `<details>` with
  the same 3-state pill (live → queued → ready). The `?export=queued`
  query-param surfaces an inline confirmation after a fresh request.
- **`src/archive/user-export.js`** — per-user (cross-instance) archive
  builder. Files: `posts.json`, `comments.json`, `votes_cast.json`
  (the user's *own* votes only; never other voters' handles),
  `subscriptions.json`, `subs_moderated.json`,
  `mod_actions_received.json`, `mod_actions_taken.json`, plus the
  static reader (`index.html`, `archive.css`), `README.md`, and the
  per-post `.md` + `.html` for every post the user authored. Manifest's
  `scope.handle_attribution` carries the public *pseudonym*, never
  the secret handle. Filename uses an 8-char handle prefix:
  `plato-export-user-<handle8>-<date>.tar.gz`.
- **Memlog notification kinds: `export_ready` and `export_failed`.**
  The worker emits a row when a job completes or terminal-fails. Ready
  rows link directly through the bearer token (`/memlog/go/<id>` →
  302 → `/export/<token>.tar.gz`); failure rows show the reason in
  the snippet. New `archives` filter chip narrows `/memlog` to both.
- **53 new tests** (623 → 679 across the B2-b chain): per-kind TTL/SLA
  + SLA sweep (queue), 60-day continuous-tenure gate (gate), 5 sub-
  export route paths + 5-state pill rendering (export-routes), user-
  export builder + cross-handle leakage check + manifest scope shape +
  HTTP route + /memlog pill (user-export), memlog `export_ready` /
  `export_failed` rendering + filter chip.

### Added — M7/B2-a: async export-job queue + per-sub archive builder

Offline core of the per-sub export feature. No HTTP routes or UI yet —
those land in B2-b. Builds on M7/B1's manifest format.

- **Migration 018** introduces `export_jobs(id, kind, scope, requested_by,
  requested_at, started_at, completed_at, failed_at, retry_count,
  error_message, archive_filename, archive_size_bytes, download_token,
  expires_at)`. State machine: pending → in-progress → succeeded | failed
  (terminal). Unique partial index on `(kind, scope, requested_by) WHERE
  pending` dedupes double-clicks on "request export". Token lookup +
  expiry indexes for the upcoming download route.
- **`src/archive/queue.js`** — pure-function helpers: `enqueueSubExport`
  (idempotent for pending), `claimNextPendingJob` (transactional pop),
  `completeJob` / `failJob` (3-attempt retry, terminal-fail with error
  message preserved), `findCompletedJobByToken`, `findLatestJob`,
  `pruneExpiredJobs`. 7-day download TTL.
- **`src/archive/tar.js`** — minimal POSIX USTAR writer (~80 LOC, zero
  new dependencies). Builds in-memory `Buffer`; sufficient for hobby-
  scale archives.
- **`src/archive/sub-export.js`** — `buildSubArchiveBytes(db, subName,
  …)` returns a tar `Buffer` containing every file the canonical archive
  spec lists: posts/<id>.md (read from postsDir, byte-exact), posts/
  <id>.html (rendered through the existing `marked` pipeline), posts.json
  / comments.json / modlog.json / votes.json (tally-only — never per-
  voter handles) / subs.json, an index.html static reader, README.md,
  archive.css, and manifest.json (last, so it can checksum every file
  before it). On a missing post .md the builder throws so the worker
  retries instead of producing a quietly-broken archive.
- **`bin/run-export-queue.js`** — system-cron worker (suggested wiring:
  `*/15 * * * *`). Picks one pending job per tick, builds + gzips +
  writes to `./exports/`, completes the row with a 64-hex token.
  Off-peak gating defaults to **01:00–06:00 server time**, overridable
  via `EXPORT_OFFPEAK_START` / `EXPORT_OFFPEAK_END` (hour 0–23) or
  disabled with `EXPORT_OFFPEAK_DISABLE=1`. Prunes expired download
  artifacts at the start of each tick.
- **Privacy posture preserved end-to-end.** `votes.json` carries only
  `{up, down, score}` per `(target_type, target_id)` key; voter handles
  never appear in the archive. Verified by an explicit test asserting
  the rendered JSON does not contain the seeded voter handle bytes.
- **Static reader polish.** `index.html` titles as `//<sub> archive`;
  per-post pages title as `<post title> — //<sub>`. Empty
  `branding.baseUrl` no longer renders an empty `<a href="">` link or
  trailing `()` parens — the source line drops gracefully. Comment
  indent is CSS-driven (`.comment .comment { margin-left: 0.6rem }`)
  rather than per-comment inline `style="margin-left: depth * 0.6rem"`,
  fixing both the float-precision artifact (`1.7999999999999998rem`) and
  the compounding nested-margin bug (depth 3 was 3.6rem, should be
  1.8rem).
- **27 new tests** (619 → 620 with one polish-pass addition): tar
  writer (round-trip, padding, EOF marker, error paths), queue state
  machine (enqueue idempotency, claim ordering, completeJob, failJob
  requeue/terminal, dedupe-slot release after terminal fail, token
  lookup, prune), and per-sub builder (file layout, manifest hashes
  match bodies, posts/comments/modlog shapes, votes tally-only, .md
  byte-exact preservation, missing-sub error, missing-md error
  propagation, filename helper, gzip round-trip).

Smoke-verified end-to-end against the live forum.db: enqueue → worker
claim → builder → tarball → gzip → extract → static reader renders;
retry path fires (requeue × 2, terminal fail × 1, error message
preserved on the row).

Operator note: set `branding.baseUrl` in `config.json` to the public
URL so exported archives self-describe their origin in the README and
index.html. Falls back to plain text when unset.

## [0.6.0] - 2026-05-06 — M6 closeout (subscriptions + RSS) + final M5/B12 polish

M6 — "subscriptions + pull-shape feeds." Sub subscriptions (B2), home-feed `subscribed | all` toggle (B3), per-sub Atom feed at `/sub/<name>/rss` (B4), inline subscribe on `/subs` (B5), token-gated personal RSS at `/u/<token>/{rss,subs.rss}` (B6), `/about` opening rebrand, default community rules baked-in. The original push channels — email digest and ntfy — are PRD-locked under §Permanently out; three-tier pull RSS replaces them.

Also folds the M5/B12 smoke-polish wave that landed in this window: co-mod model + sub state lifecycle (commit 1+2), three smoke-pass polish rounds, daily inactivity cron, `/humans.txt` + `/.well-known/security.txt`, and the sensitive-flag / subscribe-count fixes that crossed the M5/M6 boundary. Chronologically these shipped after M6 closed but before M7 began, so they ride 0.6.0 rather than spawning a 0.5.1.

### Changed — M5/B12 smoke-pass UX polish

Follow-up to M5/B12 after the first smoke run. All behavior locks; the
underlying mod model and sub-state lifecycle are unchanged.

- **Self-flag rejected.** `submitFlag` now refuses when the flagger is the
  target's author, and the flag affordance is hidden on your own posts and
  comments. Self-flag would only pollute the audit trail; authors edit or
  remove their own content directly.
- **Modlog labels.** Rows for `promote_mod`, `demote_mod`, `transfer_owner`,
  `auto_disable_inactivity`, and `manual_reactivate` now render with
  human-readable labels instead of raw enum strings.
- **Mod-management forms re-styled as inline `<details>` confirms.** Demote,
  step-down, disable-sub, and transfer-owner triggers no longer use browser-
  native `confirm()` popups; they're rounded-blue pills (matching the
  promote / save / reactivate buttons) that expand inline to reveal the
  confirmation text + submit button + cancel link. Cancel hard-refreshes
  the manage page so a half-typed picker can't get stuck open across
  navigations.
- **Pseudonym-typeahead pickers.** Promote and successor pickers swapped
  `<select>` for `<input list>` + `<datalist>` so long subscriber lists are
  filterable. Handler resolves typed pseudonyms → handles via the UNIQUE
  constraint on `handles.pseudonym`; still accepts 64-char handles for
  back-compat.
- **Mods are implicitly subscribed to subs they moderate.** `createSub`
  auto-inserts a subscription row for the owner, and `transfer_owner` does
  the same for the new owner. The subscribe / unsubscribe toggle is hidden
  on `/sub/<name>` when the current user has any mod role — mod role is a
  stickier relationship than subscription, and unsubscribing while modding
  would just hide the sub from the feed they need to monitor. Subscriptions
  remain personal-preference-toggleable for non-mod users (PRD lock).
- **Sub-mod link in header survives transfers.** `listSubsModeratedBy` now
  UNIONs `subs.owner_handle` so the new owner of a transferred sub still
  sees their `/modlog` link in the page header. (`transfer_owner` removes
  the new owner's `sub_mods` row — owner_handle is the source of truth, but
  the listing query was only reading `sub_mods`.)
- **`>` indicator** prefixed to subs the current user moderates in the
  `/subs` directory and the home active-subs block.
- **Browser-side maxlength + live char counter** on every post and comment
  textarea (new post, post edit, top-level comment, comment reply, comment
  edit). The browser refuses keystrokes past `BODY_MAX` (40000) /
  `COMMENT_BODY_MAX` (10000) and a small "<used> / <max>" counter goes
  accent-warm at 90% so users aren't surprised by the cap. Server-side
  validation in `submitDraft` / `editPost` / `addComment` / `editComment`
  remains the backstop.
- **`subs.owner_handle` UNION fix is regression-tested** in
  `test/integration/sub-state.test.js`. Self-flag also has an integration
  test in `test/integration/flag.test.js`. 573/573.

### Changed — second smoke pass (post-573)

- **Active-subs block sorts by recency first.** `listSubsForNav`
  changed `ORDER BY post_count DESC, name ASC` to
  `ORDER BY MAX(p.created_at) DESC, post_count DESC, name ASC` so a
  freshly-created sub with one new post bubbles above older subs with
  higher volume. Fixes the "I just posted in lobby and it's not in the
  top 4" smoke report.
- **Transfer button reworded.** "transfer & step down" implied two
  sequential operations but it's actually a single atomic transaction.
  Renamed to **"transfer mod role"** on both trigger and submit; the
  inline explanation spells out that you become a co-mod automatically
  and can step down as co-mod afterwards if you also want to leave.
- **All inline-confirm submit buttons now wear `.mod-action-pill`.**
  yes-demote, yes-step-down, yes-disable-sub, transfer-mod-role,
  reactivate, and save all share the rounded-blue look so the
  mod-management surface reads as one consistent action family.
- **`friendlyError(message)` helper** strips the
  `<funcName>:` prefix from any mechanism throw and rewrites the
  cross-action read-only-sub case ("//<sub> is read-only — no new
  posts, comments, votes, or flags until a mod reactivates it").
  Wired into vote, comment, and flag handlers (post handler already
  had its own `friendlyPostError` translator). No more raw
  `castVote: //x is read-only` surfacing to users.
- **Post-retry view** now uses `friendlyPostError` (no more raw
  `finalizeDraft: <64hex> is banned from <sub>`), exposes the full
  sub dropdown when the rejection is sub-specific (banned, read-only,
  flair) so the draft can be re-targeted, and adds an inline **"copy
  your draft"** pill in the error banner backed by
  `/static/uxbits.js`. Same script handles the bfcache restore: on
  `pageshow.persisted=true`, closes any `[open]` `inline-confirm`
  `<details>` so mod-management forms read as fresh after a
  back-navigation. Cancel links inside each inline-confirm form do
  the same on a click.
- **Role chip on `/sub/<name>/edit`.** After a successful transfer,
  the previous mod becomes a co-mod and the manage page collapses to
  "step down" as the only action. That's the design but reads as
  stuck without context. New chip at the top reads `you are: <role>
  of //<sub>` and, for co-mods, explains why the action set is
  scoped — "only the mod can promote / demote / transfer; your one
  mod-management action here is to step down as co-mod."
- **Test gap-fill** in `test/integration/sub-state-ui.test.js`: HTTP
  coverage for action-row label flips, disable_sub end-to-end,
  subscribe-on-read-only-sub, /subs `[read-only]` chip, banner copy
  variants, self-flag UI hide, and pseudonym→handle resolution in
  the picker. /about test extended for the "how this place works"
  block. 584/584.

### Changed — third smoke pass (post-584)

- **Manage page now lists the mod above co-mods.** `/sub/<name>/edit` gains
  a `// mod` heading rendering the owner's pseudonym so a co-mod can see
  who their mod actually is. Owner viewing their own manage page sees
  themselves with a `(you)` suffix. Drops the previously-defensive
  "owner unowned" branch — `disable_sub` is the only path that nulls
  `owner_handle` and it's gated to zero-co-mod subs, so `canModerate`
  returns null for everyone in that state and the access guard 403s
  before the owner block renders. Dead code removed.
- **Mod-can't-unsubscribe state unified across `/subs` and `/sub/<name>`.**
  `subscribeForm` now takes `modRole` and renders a disabled,
  struck-through `unsubscribe` button with an explanatory tooltip when
  set, replacing the previous silent-omit on the sub-page header. Same
  visual treatment as the `/subs` directory row, which already had the
  pattern. The PRD lock (mod role implies subscribership; toggle locked
  for mods) is unchanged in intent — only the surface treatment shifts
  from "hidden" to "visible-but-disabled" so the lock is legible.
- **28-day inactivity banner branches by role.** Mods/co-mods now see
  `<strong>you mod this sub.</strong> any post, comment, or mod action
  you take here resets the timer.`; non-mods keep the migration framing
  pointing at `/sub/create`. Reason: the un-branched copy read as advice
  to a member and mods skipped past it. `<strong>` lead phrase gets a
  dotted underline (0.2em offset) via `.sensitive-banner strong` so the
  actionable subject stands out.
- **Composer comment button.** Bottom-of-post sticky composer's submit
  button picked up `.mod-action-pill` so it visually matches the rest
  of the primary action set (save / reactivate / promote). Pinned
  bottom-right via `align-self: center` + `margin-left: auto` against
  the textarea-wrap; idle composer stays single-row tall.
- **`config.json` rules dropped.** The four lines previously duplicated in
  `branding.rules` matched `DEFAULT_BRANDING_RULES` byte-for-byte;
  removing the override lets the resolver's `undefined →
  [...DEFAULT_BRANDING_RULES]` fallback handle it. Operator intent in
  `config.json` is now legible: silence is `"rules": []`, custom is a
  populated array, absence means defaults.
- **9 new HTTP tests** in `test/integration/sub-state-ui.test.js` cover:
  disabled-unsubscribe rendering on `/subs` for owner + co-mod;
  sub-page header disabled-button vs live-form; banner copy variants
  (owner / co-mod / non-mod); `// mod` heading + owner pseudonym on the
  manage page (owner self-view + co-mod view of owner). New
  `seedStaleModActivity` helper backdates pre-existing mod_actions and
  inserts a stale anchor row so banner tests don't depend on real-time
  inactivity. 593/593.

### Added — `/humans.txt` and `/.well-known/security.txt`

Closes the tier-1+2 portion of `docs/04-process/privacy-seo.md` for plato. The headline OG / canonical / robots.txt / sitemap.xml work was already in place; this adds the two cheap signals the playbook recommends and notes as "optional but valuable" for privacy-positioned projects.

- **`GET /humans.txt`** — terse, ASCII, no third-party links. Names the operator (from `branding.hostedBy`), the project (`plato` + GitHub URL + Apache-2.0), and a "what we don't do" stance: no analytics, no third-party JS, no tracking pixels, no email retention, no algorithmic feed. The audience that opens humans.txt is the audience that values the gesture.
- **`GET /.well-known/security.txt`** (RFC 9116) — Contact field uses `branding.feedbackEmail` if set, else falls back to the GitHub issues URL. Expires field auto-renews 365 days from each request so an instance that just keeps running doesn't surface stale dates. Preferred-Languages: en. Acknowledgments points at `/about`.

Both endpoints serve `text/plain; charset=utf-8`. No new branding fields or config keys — fully derives from existing operator config.

Deferred to M8 polish (matches the same posture as late.fyi): `og:image` (a 1200×630 PNG card for richer link unfurls). Without it, link unfurls fall back to title+description, which still works. JSON-LD remains explicitly skipped on principle, per the privacy-seo.md guidance.

2 new integration tests in `test/integration/seo.test.js`. 571/571 (was 569).

### Added — M5/B12: daily inactivity cron + about-page guide (commit 2 of 2)

Closes the M5/B12 arc. Commit 1 shipped the data model, write-path enforcement, and UI; this commit ships the cron that exercises the 30-day rule and the docs/UX surface that makes it legible to mods and members.

**Cron job:**
- `bin/check-sub-inactivity.js` — daily script that walks every active sub, computes `lastModActivity` per sub (max across post/comment/mod_action by any current mod), and auto-disables any sub older than `SUB_INACTIVITY_THRESHOLD_MS` (30 days, floor-locked). Synthesizes a public modlog row (`action=auto_disable_inactivity`, `mod_handle=SYSTEM_HANDLE`) so the transition is visible alongside human mod actions. Subs with zero mods are skipped (different failure mode; cron isn't the right intervention). Idempotent — already-disabled subs are not re-processed. `--dry-run` lists what would be disabled without writing.
- `runInactivitySweep` exported from `src/content/mod.js` so the sweep is testable without spawning a process.
- Cron entry added to `docs/02-features/cron-jobs.md` with the install line, manual-verify command, and the explainer.

**`/about` page additions:**
- New "how this place works" section above the data-handling block, written in plain language for new mods and new members. Covers: posting (anyone can post in any sub, no membership), subs (any signed-in user can create one), mods (mod + co-mod model, public modlog), flags (shared mod queue, no fan-out), read-only subs (the M5/B12 lifecycle, including operator-out-of-sub-governance), and leaving (M7 archive export, in progress).
- Read this once and the social contract is legible — no docs hunting required.

**Doc updates (no behavior change):**
- `docs/02-features/plato.context.md` gets a new "Sub state model" section describing the two-state lifecycle, entry/exit paths, warning surface, marker placement, and the `disabled_at` row in the per-sub settings table; plus a new "Mod model" section reflecting the M5/B12 decisions (one mod, subscriber-eligibility, self-demote, shared queue, no role badge in modlog).
- `docs/02-features/operator-guide.md` adds an entry to the "What's locked in" list capturing the operators-don't-arbitrate-sub-governance posture (with the authority-coercion-defense framing) and updates the cron-block reference from 5 → 6 lines.
- `README.md` headline gets a fourth bullet about read-only subs and the operator-out posture — the public-facing one-liner that mirrors the PRD's deepest commitment.

5 new integration tests in `test/integration/sub-state.test.js` covering the cron sweep: no-disable when fresh, disable after 30d, any-mod-restarts-the-clock, skip-zero-mod-subs, idempotency. 569/569 total (was 564).

### Added — M5/B12: co-mod model + sub state lifecycle (commit 1 of 2; cron deferred)

Plato's two-tier mod model is now usable end-to-end. Previously the data layer supported owner + co-mod roles (migration 002, sub_mods table) but there was no UI to actually create co-mods — they could only be added via direct SQL. This commit ships the management surface, plus the read-only state mechanism that closes off the operator-as-arbiter posture for sub governance.

**New on `/sub/<name>/edit` (now accessible to all mods, was owner-only):**
- Co-mod list with promote/demote forms for the owner.
- Promote dropdown lists current subscribers; non-subscribers cannot be promoted (eligibility check at promotion time only — unsubscribing later does not auto-revoke mod status).
- Self-demote button for co-mods (step down without owner action).
- Step-down section for the owner: with co-mods, picks a successor and transfers ownership; without co-mods, replaces the form with "disable sub" — the only way out of being the only mod.
- Reactivate button surfaces when the sub is in read-only state and the user is a current mod.
- Owner-only fields (description, flairs, sensitive, threshold) hidden from co-mods. Page title flips from "edit" to "manage" to reflect the broader scope.
- Sub-page action row now shows "manage" (instead of owner-only "edit sub") for any mod role.

**New sub state — read-only:**
- Migration 016: `subs.disabled_at INTEGER NULL`. Active = NULL; read-only = unix-ms timestamp of disable.
- Migration 017: extends `mod_actions.action` CHECK with `auto_disable_inactivity` and `manual_reactivate`; extends `target_type` CHECK to include `'sub'` so sub-state changes record cleanly in the public modlog.
- Read-only sub rejects all writes: post finalize, comment, vote, flag, and mod actions other than `manual_reactivate`. Reads stay fully open. Subscribe/unsubscribe stay open (subscription is a personal preference, not content).
- Recovery: any current mod flips it back via the reactivate button. If no mods exist (the disable-on-step-down case), the sub is permanently read-only — no operator override path exists. Members migrate by creating a successor sub via normal in-app affordances. The PRD's *Permanently out* list now locks both the lack of operator authority over sub governance and the lack of any "close my sub" button.

**Banner surface:**
- Per-sub banner (computed from current state, no DB column) renders at the top of `/sub/<name>` in three modes: read-only-with-mods (prompts mod to reactivate), read-only-without-mods (member-fork only, no operator), and 28-day-warning (active sub, mods inactive 28+ days, surfaces a "this will become read-only in ~Nh, create a successor sub now" prompt with the explicit migration framing).
- `/subs` directory marks read-only subs with a `[read-only]` chip next to the name (alongside the existing `[!]` for sensitive).

**Mod content layer (`src/content/mod.js`):**
- `MOD_ACTIONS` extended to 11 entries (was 9): adds `auto_disable_inactivity` and `manual_reactivate`.
- `recordAction` enforces: subscriber-eligibility on `promote_mod`, self-demote carve-out on `demote_mod`, system-handle requirement on `auto_disable_inactivity`, read-only gate on every action except reactivate.
- New helpers: `isDisabled`, `modsOfSub`, `listCoMods`, `lastModActivity` (max across posts/comments/mod_actions by any current mod, the cron's input next commit), `listDisabledSubs`. `SUB_INACTIVITY_THRESHOLD_MS` (30d) and `SUB_INACTIVITY_WARNING_MS` (28d) exported as floor-locked constants.

**PRD updates:**
- Rewrote "Mod structure" with the M5/B12 model: one mod per sub, subscriber-eligibility, self-demote, no fan-out (shared queue is the channel), no role badge in modlog rendering.
- New "Sub Lifecycle" section: two states only (active, read-only), entry paths (step-down-no-successor, 30d cron — cron in commit 2), exit paths, operator-out-of-sub-governance posture. Marker on `/subs`, not `/about` (refined from earlier draft).
- Five new entries in *Permanently out*: sub rename, more-than-two-states, "close my sub" affordance, auto-archive on post age, operator authority over sub-level governance (with the operator-coercion-via-authority defense framing), fan-out push notifications.

**What ships in commit 2 (deferred):**
- The daily cron that runs `lastModActivity` and auto-disables subs at 30d. Without this, the warning banner still surfaces (computed from current state) but auto-disable doesn't fire — still safe, just manual-step-down only for now.

15 new integration tests in `test/integration/sub-state.test.js`: subscriber-eligibility, self-demote semantics, owner-immune-to-other-co-mod-demote, isDisabled state transitions, manual_reactivate clears state + writes modlog, read-only rejects post/comment/vote/mod-action paths, reactivate exception path, lastModActivity max-across-mods, listCoMods excludes owner, transfer_owner round-trip. Existing modlog/sub-edit/mod-revoke fixtures updated to seed subscriptions before promotion. 564/564 total.

### Fixed — Subscribe / unsubscribe now updates the visible mem count without a reload

The progressive-enhancement subscribe button (`static/subscribe.js`) flips its label in place to kill the post-redirect flicker, but until now it never touched the adjacent `mem` column number — so on `/subs` and the home `// active subs` strip, the count stayed stale until the next full page load. Without JS the 302 redirect rendered fresh counts and it worked; the JS path was the regression.

Fix: every mem-count cell now carries `data-mem-count="<subname>"` (`/subs` directory `<td>`, home active-subs strip `<strong>`). On submit, `subscribe.js` does an optimistic ±1 on every matching cell — no new server endpoint, no JSON contract, no reload. Server is still the source of truth on next load. Without JS, nothing changes — the no-JS path was already correct.

Cache-busting bumped on the `<script src=...?v=2>` tag so cached browsers pick up the new behavior.

### Changed — Sensitive flag on a sub now propagates to every post under it

Marking a sub as sensitive (`/sub/<name>/edit` → sensitive checkbox) now causes every post in that sub to render the `[!]` badge in lists and the sensitive banner on the post detail page — without touching `posts.sensitive` in the DB. The rule is a render-time derivation: `effective_sensitive = post.sensitive OR sub.sensitive`. Flipping the sub flag back unmarks all the posts; never sticky, never denormalized.

The new-post form on a sensitive sub renders the `mark as sensitive` checkbox `checked` + `disabled` with a one-line explainer (`this sub is marked sensitive — all posts inherit the [!] badge`), so authors see why the badge is being applied. The edit-post form does the same when the post's sub is currently sensitive.

Implementation:
- `listPostsAcrossSubs` and `listPostsInSub` now `LEFT JOIN subs` and expose `sub_sensitive` on each row.
- `postRowsView` and the post detail page use `post.sensitive || sub.sensitive` for both the inline `[!]` and the full-width banner.
- `postFormFor` accepts a `subSensitive` flag; pinned-sub callers (sub page, retry view) and the edit-post form pass it through.

5 new tests in `test/integration/sensitive.test.js` and `test/integration/app.test.js` cover: `sub_sensitive` exposed across all sort modes, list+detail rendering inheriting the badge, the badge disappearing when the sub flag is flipped off, and the disabled-checkbox UI on a sensitive sub's new-post form.

### Added — M6 closeout: default community rules ship baked-in

`DEFAULT_BRANDING_RULES` exported from `src/web/app.js`. A fresh instance with no `branding.rules` configured surfaces the canonical four-line default on `/about` and at the foot of every magic-link email:

```
be civil, especially when disagreeing. no racism, sexism, ableism, homophobia, or transphobia.
no porn, no illegal content.
no ads, spam, scams, or doxxing.
mods are accountable; the modlog is public, and votes can reverse soft removes.
```

Lowercase + ASCII to fit plato voice and the validator (anti-phishing on the email body). 236 chars joined, under the 240-char knowless cap. Operators override via `config.json: branding.rules`; operators who want **no** rules surface anywhere set `branding.rules: []` (or `null`) explicitly — the empty/null case is the documented opt-out. Bad shape (too many entries, non-ASCII, contains a URL, joined length over 240) still throws at boot.

This closes the original M6 "outbound-mail signature + default rules" item: the validator and config wiring shipped in M5, only the baked-in defaults were missing.

### Changed — Per-sub `rssvp` link is now click-to-copy (consistent with `/memlog`)

The per-sub `rssvp` link in the sub-page action row used to be a plain anchor (click → opens Atom XML in browser); the personal feeds on `/memlog` were already click-to-copy buttons. That asymmetry is gone — both surfaces now copy on click and flash a transient `copied!` affordance.

New `src/web/static/rssvp.js` (~50 LOC, defer-loaded in chrome) handles both surfaces with one delegated click listener:

- `.rssvp-copy` (button on `/memlog`, `data-copy=URL`)
- `.rssvp-link` (anchor in sub-page action row, copies `href`)

Modifier-clicks bypass the handler — `cmd`/`ctrl`/`shift`/`alt`/middle-click all do their normal browser thing (new tab, new window, aux button), so power users keep `open feed in new tab` via context menu / cmd-click. Without JS, `.rssvp-link` still works as a plain link (browser opens the feed) and `.rssvp-copy` text inside `<code>` is selectable. The inline script that previously lived at the bottom of `/memlog` is dropped — `rssvp.js` covers both selectors. CSS adds a dotted-underline hover hint on `.rssvp-link` mirroring `.rssvp-copy` and a green-flash on `.rssvp-copied`.

### Changed — Subscribe / unsubscribe button: drop the static underline

Was rendering `subscribe`/`unsubscribe` as underlined accent text; now no underline at rest, dotted underline on hover. Matches the rhythm of the other accent-colored interactive bits in the action row (`rssvp` link, rssvp copy buttons) — the `·` separators carry enough button-as-text affordance without a static underline.

### Changed — Subscribe in-place via fetch (kills below-the-fold flicker)

Subscribe / unsubscribe was a full POST → 302 → reload cycle, which caused a visible flicker as below-the-fold content reflowed and scroll reset to the top. New `src/web/static/subscribe.js` (~50 LOC, defer-loaded alongside `vote.js` / `comment.js` / `flair.js`) intercepts the form submit, fetches the POST in place, flips the button label + hidden action input. No full reload, no scroll reset, no flicker. Pure progressive enhancement: without JS the form still POSTs the standard way and the server's 302 still lands the user correctly. 401 (session expired) and network errors fall back to a normal `form.submit()` so the user always gets through.

### Fixed — Sub-page action row no longer wraps subscribe to a new line

The action row (`← home · public //modlog · rssvp · subscribe · edit sub`) was wrapping the subscribe form to a new line because `<form>` is flow content, not phrasing content — HTML5 forbids it inside `<p>`, and the parser was auto-closing the `<p>` at the form boundary. Changed the row to `<div class="sub-action-row">` with `margin: 1em 0` matching the default paragraph rhythm. Subscribe now stays on the same line as `rssvp`.

### Changed — Sub-page action row reorder + `/subs` column polish

- **Sub-page action row**: `subscribe` moved to sit immediately after `rssvp` (before `edit sub` for owners). Reads as the "follow this sub" cluster, and shortens the row when `edit sub` is present.
- **`/subs` directory**: `subscribers` column header renamed `mem` (frees ~6 chars of horizontal real estate so wider columns breathe); `active` and `owner` columns get `white-space: nowrap` so relative-time strings ("3 days ago") and two-word pseudonyms ("lonely-opossum") stay single-line.

### Changed — `/about` opening: "plato instance" not "<forumName> instance"

The opening line on `/about` previously read `this is a <forumName> instance, hosted by <handle>` — redundant ("this is a terribic instance, hosted by @terribic"). Now reads `this is a plato instance, hosted by <handle>`: project name on the left tells visitors what software is running; handle on the right tells them who runs it. Cleaner branding, no operator surface lost (the forumName still appears in the page wordmark, footer, and `<title>`).

### Added — M6/B6: token-gated personal RSS feeds at `/u/<token>/...`

Two new pull-only feed URLs tied to the logged-in user, sharing a single per-user token:

- `/u/<token>/subs.rss` — latest 50 posts merged across every sub the user has subscribed to (newest first, hard-removed + soft-collapsed both excluded, same drama-shape filter as per-sub RSS). The "give me my whole subscription list as one feed" channel.
- `/u/<token>/rss` — the above plus the user's memlog notifications (replies to their comments, mod actions on their content) interleaved by time. The "everything tied to my account" channel.

Token is opaque random hex (32 bytes → 64 chars), generated lazily on first `/memlog` visit, regenerable from a button at the bottom of `/memlog`. Rotation invalidates **both** URLs at once. The token *is* the credential — no handle in the URL — which keeps the pseudonym out of reader app logs, corporate proxies, screenshots, and support tickets. Headers: `Content-Type: application/atom+xml; charset=utf-8`, `Cache-Control: private, no-store` (personal feeds shouldn't be cached by intermediaries). 404 on bad/missing token (hex shape validated before any DB hit). Disallowed in `robots.txt` (`Disallow: /u/`).

Migration 015 adds nullable `handles.rss_token TEXT` with a UNIQUE partial index. New module `src/content/rss-token.js` exposes `getOrCreateRssToken / regenerateRssToken / handleByRssToken`.

UX polish on the same surface:

- **Visible labels rebranded to "rssvp"** — plato voice. The per-sub action-row link is now `rssvp` (was `rss`) and the `/memlog` heading is "personal rssvp feed", both accent-colored. URL paths stay `/sub/<name>/rss` and `/u/<token>/{rss,subs.rss}` so any already-copied feed URL keeps working — only the visible label flips. Substring "rss" is still in "rssvp" so reader users still recognize the feed affordance.
- **Click-to-copy URL buttons** on `/memlog`. Plain inline text (matches surrounding `<code>` style) with a dotted-underline hover hint; click triggers `navigator.clipboard.writeText` and a transient "copied!" flash in success-green. Falls back to selecting the URL text inside `<code>` on permission/insecure-context denial. Plain text selection still works without JS.
- **Stay-open after regen.** `POST /memlog/rss-regenerate` redirects to `/memlog?rssvp=open` and the server adds the `open` attribute to the `<details>` so the panel doesn't snap shut on the user. No JS for this part — fits "every form works without JS."
- **Bold descriptions** on the URL list ("new posts across your subscribed subs", "the above plus your memlog notifications") so they read distinctly against the surrounding muted prose without competing with the accent-colored heading.

### Changed — M6 scope: email digest and ntfy push both cut, three-tier RSS replaces them

Both push channels are now PRD-locked under §Permanently out, not v1 limitations.

- **ntfy push** would silently work on Android and feel broken on iOS (Apple's APNs gate routes self-hosted ntfy only via `ntfy.sh`). Plato's audience is too small to absorb that platform-skew support cost.
- **Email digest** would have required either plato persisting plaintext addresses (breaks the auth-layer "never stored" lock) or coupling to a knowless email-retention feature; either path drags scheduler / cadence config / opt-out tokens / footer rendering / bounce handling / operator deliverability burden into a forum that explicitly rejects urgency engineering. Magic-link auth is preserved as plato's only outbound email — and **only** as the auth floor.

The replacement is a three-tier pull-shape RSS surface: per-sub at `/sub/<name>/rss` (public, M6/B4), all-subs aggregate at `/u/<token>/subs.rss` (token-gated, M6/B6), all-subs + notifications at `/u/<token>/rss` (token-gated, M6/B6). Same ground covered, none of the email or push surface.

### Added — M6/B5: inline subscribe form on `/subs` directory

New per-row column on `/subs` with an inline `subscribe`/`unsubscribe` text-link button (logged-in users only). Reuses the existing POST `/sub/<name>/subscribe` endpoint and the same `.subscribe-form` / `.subscribe-btn` styling as the sub-page header button — the directory becomes a one-screen subscription manager: browse, follow, no need to click into each sub. Hidden for anonymous (same precedent as the chip strip + sub-page header button).

### Added — M6/B4: per-sub Atom feed at `/sub/<name>/rss`

Atom 1.0 feed of the latest 50 posts in the sub, newest-first. **Excludes both hard-removed and soft-collapsed posts** — RSS bridges plato to readers in feed shape, not in drama shape; feed readers have no "this is collapsed" affordance, so a soft-collapsed entry would land too loud. Title + author pseudonym (not raw handle) + body excerpt (≤600 chars, same shape as the modlog target preview). Headers: `Content-Type: application/atom+xml; charset=utf-8`, `Cache-Control: public, max-age=300`. The sub HTML page advertises the feed via `<link rel="alternate" type="application/atom+xml">` (autodiscovery for reader extensions) plus a visible `rss` text link in the action row. 404 for missing subs. PRD §M6 → per-sub RSS feeds.

### Added — M6/B3: home-feed `subscribed | all` toggle

Replaces the placeholder chip pair on the home top-nav. `?feed=subscribed` filters both the posts and comments tabs to authored content from subs the user follows. Chip pair renders for logged-in users only (anonymous + `?feed=subscribed` is normalized to `all` so chip URLs don't carry sticky filters anonymous can't even see). Logged-in user with zero subscriptions sees an empty-state pointing at `/subs` instead of "no posts." `listPostsAcrossSubs` and `listRecentCommentsAcrossSubs` gained an optional `subNames` parameter (null = no restriction; [] = no rows, query short-circuited).

### Added — M6/B2: sub subscriptions

Migration 014 added `subscriptions(user_handle, sub_name, created_at)` with composite PK + index on `sub_name`. Inline subscribe/unsubscribe button in the sub-page header (logged-in only); POST `/sub/<name>/subscribe` is idempotent (form `action=subscribe|unsubscribe`, missing action toggles current state). `/subs?filter=mine` filters the directory to subscribed subs (anonymous silently falls back to `all`); the previously placeholder subscribers column now shows real counts. Subscriber identities are never exposed publicly — only aggregate counts. Disallowed in `robots.txt` (`Disallow: /sub/*/subscribe`). Per PRD §Front Page → Sub subscription mechanics: private (no public follower lists), exportable (M7 archive), no notifications by default — every later M6 surface (digest, ntfy, RSS preferences) keys off these rows.

## [0.5.0] - 2026-05-04 — M5 closeout (mod surface + defenses)

M5 — "mod surface + spam-defense floor + branding." The biggest single milestone in plato's pre-v1 arc. Unified `/modlog` with three modes (open/inbox/audit), public modlog + footer + `/about` page, operator cron jobs, memlog activity unification (M6/B0–B1 lived here originally before being pulled into M6), spam-defense modules with PRD-locked floors (rate limits, link cap, regex patterns, URLhaus auto-collapse), system-attributed audit rows for spam triggers (B6), security & correctness audit fixes (B7), branding surface (B8 + B9: forumName / tagline / hostedBy / colors), per-sub flairs (B10), per-sub sensitive flag (B11), per-sub flag-threshold override + co-mod model + sub state lifecycle (B12), my-mod-decisions panel (B13), guest comment composer (B14), sub-description cap (B15), `[new]` tag in mod queue (B16). Plus cross-cutting polish: dev/prod env split, mobile-responsive layout, owner rate-cap carve-out, login popover layout, sham-token redirect leak.

### Added — M5/B16: `[new]` tag in `/modlog?mode=open` for fresh-account authors and flaggers

Triaging the mod queue is faster when mods can see at-a-glance whether the actor (target author or any flagger) is brand-new. The same 7-day window `vote.js` uses for half-weight + comment-vote block now drives a muted `[new]` chip rendered next to fresh-account pseudonyms. New `newAccountHandles(db, handles, now)` batch helper in `vote.js` returns a `Set` so one indexed query covers every handle on the page. Highest-signal use: a brigade of fresh accounts converging on the same target reads as `[new] · [new] · [new]` in the breakdown line.

### Changed — Flairs: server-validator cap 12 → 6, color-validator allowlist hex-only

Two stale-state cleanups in `src/content/flair.js`, both now matching what the editor actually emits:

- `MAX_FLAIRS_PER_SUB`: **12 → 6**. The form has rendered 6 rows since M5/B9 simplified the editor; the validator never tightened to match. No UI path reached values 7–12, so nothing is lost — the constant just stops lying. Drops three doc caveats about "legacy headroom."
- Color validator: replaced the `;{}<>"'` blocklist with allowlist `^#[0-9a-f]{6}$`. The 8 preset swatches and the free-form `<input type="color">` both emit `#rrggbb`, so an allowlist matches what the form can send and removes the inline-style XSS surface that `rgb()` / named / CSS-keyword colors carried (a CSS parser has more side doors than a five-char blocklist; allowlist is simpler and tighter). Error message clarified: "must be a 6-digit hex like `#3b82f6`."

Pre-v1, no migration shim: existing flair JSON in any DB that uses `rgb()` / named / short-hex would now fail validation on edit (per CLAUDE.md "don't add backwards-compat shims for code that isn't shipped yet"). Operators with pre-existing non-hex flairs re-pick from the swatches once.

### Changed — PRD: lock cross-instance identity non-portability

Identity does not travel across plato instances; history does. New instance = new pseudonym derived under the new master secret; archived posts and comments carry their origin-instance pseudonym strings as static attribution labels. **No "claim my old handle" flow, no email→pseudonym mapping in the archive, no magic-link reclaim**, all now explicit and rejected with rationale.

Three PRD edits: (a) §Identity Model → Forking / moving instances rewritten away from the prior "claim old pseudonym" path; (b) §Permanently out gains an explicit "Cross-instance identity portability" bullet naming each rejected mechanism (the privacy property: per-instance HMAC keeps email from being a cross-forum tracking key; the social property: "leaving is a fresh start" stays honest); (c) §Federation (Future) drops the contradicting "identity is portable via Ed25519 pubkey" sketch — the lock holds in a federated world too. Side effect: M7 export format simplifies (no email→pseudonym mapping, no claim ceremony).

### Changed — `/about` opening line: "questions or feedback" link replaces bare email; merged onto hosted-by line

Same pattern as the recent plato-repo link (`768250f`): the address sits behind the link text rather than being printed in plain. Also folds the feedback line into the hosted-by paragraph so the about page opens with one sentence, not two:

`this is a <forumName> instance, hosted by <hostedBy>. questions or feedback.`

### Docs — Config surface map + fix stale `hostedBy` / `feedbackEmail` paragraphs

Operator-guide gains a single "Config surface map" table at the top of Tier 1 enumerating every `config.json` key (branding.\*, urlDisplayMax, feedPageSize, operator.\*) and every place it reflects — UI surfaces, magic-link emails, cron-job recipients. Closing line names the two `/about` paragraphs that are deliberately NOT operator-tunable so the fork-vs-config boundary is visible in one place.

Patched two stale paragraphs that pre-dated the about-page rewrite: `branding.hostedBy` now names both surfaces (footer + `/about` opening, with the `@<forumName>` fallback rule); `branding.feedbackEmail` now names both surfaces (footer + `/about` link) and notes both are `mailto:` with the address hidden behind link text. `plato.context.md` recipe rows for forumName/tagline/hostedBy and feedbackEmail enumerate every reflection surface and point at the new operator-guide table.

### Added — Privacy-led SEO (head meta, OpenGraph, robots.txt, sitemap.xml)

Implements [`docs/04-process/privacy-seo.md`](docs/04-process/privacy-seo.md) for plato. Tier 1 declarative head tags + Tier 2 static-files-at-root, no analytics, no tracking. The privacy posture is what self-selects the right audience in search snippets.

- **`/robots.txt` route** — declarative crawl policy: `Allow: /` plus `Disallow:` on auth callbacks (`/auth/`), POST-only endpoints (`/draft`, `/vote`, `/flag`, `/login`, `/logout`, `/verify`), the per-user `/memlog`, and `/modlog/resolve`. Public reads (homepage, sub feeds, post pages, `/about`, `/modlog`, `/subs`) are crawlable. Sitemap line points at `/sitemap.xml`.
- **`/sitemap.xml` route** — dynamic. Lists `/`, `/about`, `/modlog`, `/subs`, every sub at `/sub/<name>`, every non-removed post at `/sub/<name>/post/<id>`. `lastmod` from DB timestamps; `changefreq` + `priority` per page type. Removed posts excluded — won't reappear in indexes after a hard removal. Pagination + filter params excluded; canonical pages only.
- **`<head>` per-page** — every page now emits `<meta name="description">`, `<link rel="canonical">`, `<meta name="theme-color">`, OpenGraph (`og:type`, `og:title`, `og:description`, `og:url`, `og:site_name`), and `<meta name="twitter:card" content="summary">`. Skipped intentionally per the playbook: `og:image` (defer until a design pass), JSON-LD ("skippable on principle"), `humans.txt`, `security.txt`.
- **`branding.metaDescription`** in `config.json` (optional, ASCII, ≤200 chars). Falls back to `"a {forumName} instance: Reddit-shaped forum, magic-link auth, no tracking, no analytics, public modlog — {tagline}."` so a fresh fork's search snippet surfaces the privacy posture without operator effort. `resolveBrandingMetaDescription` exported for tests.
- **Per-page customization** — `/about` description: "what {forumName} keeps about its users — and what it doesn't"; `/modlog` description: "every moderation action on {forumName}, public and audited"; `/subs` description: "every sub on {forumName}"; `/sub/<name>` description: from `sub.description` when set, otherwise default; `/sub/<name>/post/<id>` description: first ~155 chars of post body with markdown stripped, `og:type=article`, canonical = post permalink. Removed posts get a minimal fallback description so an indexed snippet never quotes a body the operator already retracted.
- **`postExcerpt(body, max)` + `escapeXml(s)` helpers** — markdown-stripping for snippets; XML-attribute-safe escaping for sitemap output.
- **No analytics, no tracking pixels, no third-party JS, no cookie banner** — already true; this commit doesn't change that and the audit checklist is in `privacy-seo.md` for quarterly re-verification.

### Fixed — Hardening pass on cron scripts + branding resolvers

- **Atomic tarball write** in `scripts/cron-backup-db.sh` — writes to `$ARCHIVE.tmp` then `mv` on success, so a tar failure never leaves a half-written file under the canonical name (was the one Important issue from the QA review). Retention can no longer pick a corrupt newest archive.
- **Tmpfs-safe staging** — SQLite `.backup` snapshots stage inside `BACKUP_DIR` rather than `/tmp`. Small VPS often has tmpfs `/tmp`; multi-GB knowless.db could OOM the staging dir.
- **`CONFIG` / `FIELD` via env in `node -e`** — both cron scripts now read `config.json` with the JS source containing zero shell interpolation. Defence in depth even though both inputs are derived from the script's own location.
- **Sendmail-failure escape hatch** in both cron scripts (`} | sendmail -t || printf 'sendmail failed' >&2`). When sendmail itself dies, cron's own MAILTO surfaces the stderr instead of the failure being lost.
- **Upper bound on `disposable-domains.txt` refresh** (50000 lines). Defends against upstream compromise dumping a list that flags every legitimate provider; the lower bound (1000) was already there.
- **`branding.rules` URL ban broadened** — was http(s) only, now blocks any `[a-z]+://` scheme (`mailto://`, `data://`, `javascript://`, `ftp://`, …) AND bare-domain shapes (`example.com`, `host.io/path`) that mail clients auto-link. Phishing-vector defence depth on the magic-link email signature.
- **ASCII regex modernized** — `/[\x00-\x1f\x7f-￿]/` → `/[^\x20-\x7e]/` in both `resolveBrandingFeedbackEmail` and `resolveBrandingRules`. Same behaviour, drops the eslint-disable, far more readable.
- **Logged-out / non-mod `?mod=me` strips the param at dispatch** rather than silently rendering an unfiltered audit. Was a UX trap (chip looked active in URL but did nothing).
- **`PRUNE_COUNT` portability** — `printf '%s' "$PRUNED" | grep -c .` handles both empty-input (returns 0) and the leading-whitespace some `wc -l` builds emit. Empty `printf '%s\n'` no longer falsely reports 1.
- **ISO-week algorithm reference** in `bin/stats-weekly.js` (Wikipedia link to ISO 8601 week-date) + load-bearing `byWeek` string-compare invariant documented (depends on `bin/stats.js` always emitting trailing `Z`).

### Fixed — Footer separator before feedback / about / modlog

The footer-links span sat directly adjacent to the hosted-by span with no delimiter, rendering as `hosted by @x feedback · about · modlog`. Prepend `· ` to the footer-links span so the chain reads `… hosted by @x · feedback · about · modlog`. Works whether `feedbackEmail` is set or not.

### Fixed — Modlog filter-bar layout + non-mod chip state

- **Sub `<select>` now renders inline with the filter chips** (next to `date · type · my decisions`), not on its own row above the table. `subFilterControl()` returns `{ inline, strip }`; the >20-subs branch hands `inline` to `modlogFilterBar` and skips the strip, the ≤20 branch leaves `inline` null and renders the chip strip as a separate `<p>` below the bar (chips would wrap awkwardly inline).
- **`modlogFilterBar` container changed from `<p>` to `<div>`** so the inline `<form>` is valid HTML — `<form>` inside `<p>` auto-closes the paragraph at parse time. `.modlog-filters` was already `display: flex`; nothing visual changes for the small-N path.
- **"my decisions" filter chip is disabled for non-mods** (logged-out OR logged-in without any moderated subs). Renders as a `<span class="filter-btn filter-btn-disabled">` with `title="mod-only: you have no actions to filter"` instead of a clickable `<a>`. Existing `.filter-btn-disabled` style (opacity 0.35, no pointer events) reused. `isMod` threaded through `renderMyModLog → renderModlogAudit`; `open`/`inbox` renderers always pass `true` since those modes are mod-gated upstream.

### Added — Public modlog, /about page, footer module, operator-supplied rules

- **`/modlog` is now public.** Logged-out and non-mod visitors get the instance-wide audit view (every mod action across every sub, newest-first, paginated, fully filterable). The "public modlog" pitch is now actually visible from the footer of every page rather than gated behind a mod login. `mode=open` and `mode=inbox` stay mod-only (those are the pending-queue + inbox views). When `?sub=` is set in `mode=open`/`inbox`, plato re-clamps to subs the viewer moderates so a mod can't peek at another sub's queue via URL editing.
- **Top-right "modlog" nav link defaults to `?mod=me`.** A mod's primary entry point lands on "my decisions" — the public footer link points at bare `/modlog` (everyone's actions). One page, two entry points, zero divergence in renderer.
- **Sub filter collapses to a `<select>` dropdown above 15 subs** (`MODLOG_SUB_CHIP_LIMIT`). Below that the inline chip strip stays — chips read better at a glance for small instances, and the row would wrap into a wall of names at higher counts. Default option is `all (N)`; `?sub=<name>` preselects. JS-on path auto-submits on change; JS-off path uses the `filter` button. Same control rendered in audit / inbox / open views via the new `subFilterControl()` helper.
- **`/about` page** rendered at `/about`. Operator-authored prelude (forum name + hosted-by) plus an optional rules section, plus project-baked sections that aren't operator-edited: data handling (what plato keeps, doesn't keep — replaces a "privacy policy" without lying about how minimal plato actually is) and the "if you don't trust this operator" fork escape hatch. Project-baked sections are uniform across forks by design — the public-honesty contract isn't operator-tunable.
- **`branding.feedbackEmail`** in `config.json` (optional). When set, footer renders `feedback · about · modlog`; when unset, footer drops `feedback`. Boot-time validation: ASCII, has-`@`-and-domain shape, ≤120 chars, no quotes/CRLF. `resolveBrandingFeedbackEmail` exported for tests.
- **`branding.rules`** in `config.json` (optional, ≤4 strings, total ≤240 chars when joined, ASCII, no URLs). Rendered as a list on `/about` AND injected into the magic-link email signature via knowless `bodyFooter`. Single source of truth — operators edit one config field, both surfaces stay in sync. URL ban is a phishing-vector defense (mirrors knowless validateBodyFooter AF-8.2). `resolveBrandingRules` exported for tests.
- **Footer is one global module.** `siteFooter()` already rendered on every page via `layout()`; now carries `feedback · about · modlog · — quote` plus the locked-mark + hosted-by line. Same DOM on every page, no per-route wiring.

### Added — Operator cron jobs (autoconfig + email)

- **`config.json operator` block** — top-level `{ email, service }` for cron tooling. The forum process ignores it; cron scripts read it instead of hardcoding paths or notify addresses. `email` falls back to stderr when unset; `service` defaults to `plato`.
- **Disposable-domains quarterly refresh** — `scripts/refresh-disposable-domains.sh` (atomic curl + sanity check, refuses upstream <1000 lines) + `scripts/cron-refresh-disposable.sh` (autoconfig, sha256-gated `systemctl restart`, sendmail report). Snapshot refreshed from 16 → 5437 domains (upstream `disposable-email-domains`, MIT). List is never fetched at runtime — a remote change can't silently expand the block surface.
- **Daily full-state backup** — `scripts/cron-backup-db.sh` tars `forum.db` + `knowless.db` + `posts/` (WAL-safe via SQLite `.backup`) to `data/backups/plato-YYYY-MM-DD.tar.gz`. 7-day retention with auto-prune; `BACKUP_KEEP_DAYS` env override. Mails operator only on failure or prune events — silent success on quiet days.
- **Daily stats snapshot + weekly digest** — `bin/stats.js` appends `{snapshot_at, users, subs, posts, comments}` JSONL to `data/stats.log` (append-only, never rewrites). `bin/stats-weekly.js` reads the log, groups by ISO week (latest snapshot per week), takes the most recent 4 weeks, renders a fixed-width WoW-delta table, mails to `operator.email`. Both support `--dry-run`. Counter definitions: users = `knowless.db.handles` (anyone who ever requested a magic link), posts/comments exclude `removed_at`.
- **`docs/02-features/cron-jobs.md`** — single source for all 5 cron jobs (URLhaus hourly + the 4 above), including a copy-paste 5-line root crontab block, manual verification recipe, sendmail preflight, disk-pressure escape hatch, and per-cadence rationale. Operator-guide gets Tier 1 entries for backup + stats + operator block; plato.context gets table rows mirroring the same surfaces (these are part of setup, not optional polish). Cross-linked from operator-guide, plato.context, and README.

### Added — Memlog activity unification

- **Memlog gains a top-level `mode:` axis** — `notifications` (default, prior behavior), `activity` (your authored posts + comments, removed content excluded), `all` (both streams merged by created_at desc, capped 200 rows). Mirrors the modlog mode pattern (`open / inbox / audit`) so memlog is one surface for everything personal: things done *to* the user, things done *by* the user. New `listActivityForHandle()` in `src/content/notification.js` returns posts + comments shaped to match the notification row contract; renderer slots them into the same table.
- **First column `type`** with values `ntfy` (notification rows) / `actv` (activity rows). At-a-glance discriminator, especially in `all` mode where rows are mixed.
- **Show / kind / mark-all-read chips hidden in activity mode** — own posts aren't unread, and the notification kind axis (comments/replies/mod actions) doesn't apply to authored content.
- **Page header rewritten** to position memlog as a unified personal log; mode-specific second line tells the user what they're looking at.
- **Activity-row navigation** routes directly via `memlogTargetLink` (no /memlog/go redirect — there's no read-state to mark on your own content).

### Fixed — `/modlog` 500 on `auto_uncollapse_community` rows

- **`modCell` rendering crashed on `mod_handle = NULL`** — the auto-uncollapse-community insert (`src/content/vote.js:140`) writes NULL by design (the event isn't a moderator decision, it's the community threshold firing), but all three modlog renderers (`renderModlogAudit`, `renderModlogInbox`, public per-sub `renderModLog`) called `mod_handle.slice(0, 8)` unconditionally. Now NULL renders as italic-muted `community` so the row distinguishes itself from a system-handle action without crashing the page.

### Changed — Mobile responsive layout pass

- **Mobile breakpoint at ≤640px** added as a single `@media` block at the bottom of `style.css`. Targets the three actual pain points: header overlap, table overflow, full-page horizontal scroll.
- **Header (brand + status)** now flex-wraps so it stacks instead of overlapping on phones.
- **Memlog table** drops `from` and `where` columns on narrow viewports; remaining `type/when/kind/snippet` fit one line per row.
- **Subs index table** drops `description`, `subscribers` (placeholder anyway), and `owner` columns; keeps `sub / posts / active` — the navigational essentials.
- **Wide tables generally** (audit modlog, inbox) get `overflow-x: auto` *within their own block*, so any residual horizontal scroll is contained inside the table, never the full page.
- **Filter chip rows** wrap to multiple lines instead of overflowing.
- **Form inputs** capped at 100% width; **login popover** anchored to viewport edge with adjusted min-width.

### Changed — `/modlog` page title

- **Top banner reads `modlog`** instead of `/modlog`. The leading slash conflated URL syntax with display; banner is now consistent with `// modlog` body H2 (the `//` is plato's section marker, kept on the H2; the H1 / browser tab title gets the clean form).

### Fixed — Sham/expired-token redirect leak

- **Anti-enumeration silent-miss now extends to the link-click stage.** Knowless's POST `/login` flow takes pains to make valid/invalid/rate-limited responses indistinguishable, but `failureRedirect` defaulted to `loginPath` (`/login`) — meaning a user clicking a sham/expired/used token landed on a "Sign in" page that telegraphed the failure. Plato now passes `failureRedirect: '/'` to knowless (`src/auth/index.js`); rejected clicks now land on home, looking identical to any logged-out visit. The home page reveals nothing about whether a login attempt occurred.

### Added — Branded `/login` page

- **GET `/login` rendered with plato chrome** instead of knowless's bare fallback form. New `renderLogin()` uses `pageView` + `siteHeader` + `siteFooter` so deliberate navigation to `/login` (bookmark, "Sign in" link, popover-escape) lands on a styled page rather than a stylesheet-less standalone HTML. Already-logged-in users see a "you're already signed in" notice with a home link. The `?next=` param round-trips through `return_to` for post-login destination.

### Added — Auto-uncollapse round-trip on flag-collapsed targets

- **Flag-count auto-collapse now snaps `score_at_collapse`** alongside `collapsed_at` (`src/content/flag.js`). Without this, posts/comments collapsed by 3+ distinct flaggers could never auto-uncollapse since `vote.js` gates the threshold check on `score_at_collapse != null`. Mirrors the urlhaus + spam-pattern paths. The third community-signal collapse path now has the symmetric reversibility: community-flag-down can be community-upvote-up. Mod-collapses still don't auto-undo (by design — `score_at_collapse` stays NULL on manual mod actions).

### Added — Modlog open-items counter chip

- **Header now surfaces an open-items counter next to `modlog`** for active mods. New `countPendingTargetsAcrossSubs(db, subNames)` in `flag.js` counts distinct (target_type, target_id) pairs with pending flags across the calling mod's subs. Renders as ` · modlog (N)` when N > 0, links to `/modlog?mode=open`. Same `.memlog-chip` styling as the unread-notifications counter. `style.css?v=20`.

### Added — Dev/prod env split

- **`npm run dev` loads `.env` then `.env.dev`** via Node 22 multi-`--env-file`, so dev-only knobs override base config. `.env.dev` (committed) holds `KNOWLESS_DEV_LOG_LINKS=true`, `KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR=100`, and `KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR=1000`; `.env` (gitignored) keeps the secret + production-shaped config. `npm start` does NOT read `.env.dev`, so prod stays prod. New env wiring in `src/auth/index.js` for both per-IP cap overrides — the total-login cap (default 30/hour) silently early-returns without an SMTP attempt when exceeded, so dev sessions cross it quickly and lose the magic-link log fallback; bumped to 1000 in `.env.dev`.

### Fixed — Back-button stale-auth + login popover layout

- **`Cache-Control: no-store` is now the default** for every HTML response and redirect (`src/web/request.js`). Browser bfcache no longer revives a logged-in page after logout. Static assets and avatars bypass `send()` so their long cache stays.
- **Login form is an absolute-positioned popover** (`style.css`) instead of an in-flow flex item; opening the `<details>` no longer pushes surrounding nav chips onto a second line.
- **Memlog filter wrapper switched from `<p>` to `<div>`** so the inline `<form>` for "mark all read" sits on the same line as the `show:` / `kind:` chips. The HTML5 spec auto-closes `<p>` on a child `<form>`, which was visibly breaking the layout.
- **Header pseudonym no longer rendered bold** — `<strong>` removed from the markup; pseudonym now reads as part of the nav weight, not an emphasis.
- **Subs page "last activity" column relabeled `active`** — single word, fits the table row without wrapping.

### Changed — Owner comment cap doubled in own sub

- **Sub owners get 2× the daily comment cap when commenting in their own sub** — engagement carve-out for leading discussion. New owner: 10/day → 20/day. Recent: 30/day → 60/day. Established: still uncapped. The cap is *doubled, not lifted* — a compromised owner can't drop unlimited comments. `checkCommentRate` gained a `{ doubledForOwner }` option; `handleAddComment` passes it when `canModerate(...) === 'owner'`. One new test in `rateLimit.test.js` verifies the doubling and that the doubled cap also bites at 20.

### Fixed — Self-ban footgun

- **Mods can no longer ban themselves out of their own sub.** UI: the ban form is hidden (not dimmed) on a mod's own posts/comments — dimming would suggest "could become available." Server: `recordAction` rejects any handle-targeted action (`ban`/`unban`/`promote_mod`/`demote_mod`/`transfer_owner`) where `targetId === modHandle` with a clear error. Belt-and-suspenders for any future caller that bypasses the UI. Collapse/remove on your own content stay visible — mod-removing your own old post is the only path after the 24h author edit window. Two new tests in `mod.test.js` verify both the ban and unban guard.

### Changed — Owner carve-out from per-sub + per-hour rate caps

- **Sub owners bypass two rate caps when posting in their own sub**: (a) `checkPostRatePerSub` (5/20 by tier — the topic-flood defense, meaningless when you own the sub) and (b) the per-hour portion of `checkPostRate` (1/3/∞ by tier — the burst-pacing defense, symbolic friction for an owner seeding their freshly-created sub). The global **per-day** cap (3/10/∞ by tier) still applies, so a compromised owner account can't drain the day's quota across the instance — the spam-floor defense holds. `checkPostRate` gained a `{ skipHourly }` option; `handleDraft` and `handleFinalize` pass it when the actor owns the destination sub via `canModerate(...) === 'owner'`. Solves the founder-bootstrap UX where a fresh owner would hit "1/hour" between each post in their own sub. operator-guide and plato.context updated to mark the carve-out alongside the other anti-spam rules.

### Changed — Chrome enforcement (post-M6/B0 polish)

- **Every page now goes through `pageView`** — single canonical chrome helper. Renderers no longer compose their own header; passing `title` to `pageView` doubles as the document title *and* the wordmark replacement in `siteHeader`. ~30 bare `layout(...)` error blurbs migrated to a `quickPage(req, ctx, title, body)` sugar that wraps `pageView` so short responses stay readable. Three handlers (`handleLogin`, `handleLogout`, `redirectLegacyPost`) picked up `db` in their context so chrome reaches auth + legacy-redirect pages too. Convention is now codified in code: `layout()` and `siteHeader()` are internal to the helpers; renderers must use `pageView` or `quickPage`.
- **Header pseudonym restyled** — accent-colored (same blue as sub links) so the "click your name → memlog" affordance is visible at a glance, with hover underline. `style.css?v=17`.
- **Memlog deep-link click expands enclosing details on hash jump** — `comment.js` now walks up from `location.hash`, opens any `<details>` (long-collapsed body, score-collapsed comment, depth-folded subtree), re-scrolls, and pulses the highlight so the eye lands on the body the user was notified about. Works on every page that loads `comment.js` (which is every page). `comment.js?v=3`.
- **`/sub/create` uses the shared `siteHeader`** (via `pageView`) — was rendering a bare `<header><h1>` with no logo or login affordance.
- **`flair-form-row[hidden]` respects the hidden attribute** — `display: inline-flex` was overriding the browser-default `[hidden] { display: none }`, so the cross-sub flair picker stayed visible when the user picked a sub without flairs. Explicit override added.

### Added — M6/B0 memlog (per-user notifications)

- **New table `notifications`** (migration 013) — recipient, kind, sub_name, target, actor, snippet, created_at, read_at. One row per event the user should know about. Composite index `(recipient_handle, read_at, created_at DESC)` covers the unread-count and feed queries. `target_id` is TEXT to fit both integer post/comment ids and 64-char ban handles.
- **Three notification kinds**: `comment_on_post` (top-level comment on your post), `reply_to_comment` (someone replied to your comment), `mod_action` (your content/handle was acted on by a mod). Vote events are deliberately not recorded — score is the visible signal; per-vote pings are an engagement-bait surface plato refuses.
- **Insert sites** wired in `handleAddComment` (post author for top-level, parent-comment author for replies) and via a new `notifyModAction` helper called after every successful `recordAction` in `handleModAction` and `handleModlogResolve`. Owner-only sub-management actions (promote/demote/transfer) are intentionally not notified — those land in the public modlog where co-mods see them directly. Self-notifications are skipped at the `recordNotification` call.
- **`/memlog` route** — recipient-only personal feed, 401 to logged-out visitors. Same `table.modlog` chrome as the modlog audit view (one mental model). Filter row: `show: unread / all` × `kind: all / comments / replies / mod actions` plus a `mark all read` button that respects the active kind filter. Rows older than 90 days are lazily pruned on every GET regardless of read-state — bounded table, predictable retention.
- **`/memlog/go/<id>`** — single-click follow-through. Marks that one notification read server-side, then 302s to the deep link (`/sub/x/post/y#comment-z` for content events, `/sub/x/modlog` for ban events).
- **Header chip** — pseudonym in the top-right is now a link to `/memlog`. Non-zero unread count renders as a colored `(N)` chip next to the name, recomputed per-request via `unreadCount`. No JS, no polling.
- **CSS**: `.memlog-link` (subtle hover), `.memlog-chip` (accent-colored unread count), `tr.memlog-row-read td { opacity: 0.55 }` so read rows visually recede in the `all` view.
- **Tests**: 9 new (`notification.test.js`) covering insert/skip-self/unknown-kind/snippet-trim, listNotifications filters, mark-read scoping, mark-all kind filter, and prune retention.

### Added — M5/B15 Sub description length cap

- **Sub description capped at 200 chars.** New `validateSubDescription` rejects oversize input at `createSub` and `setSubDescription`. Form inputs on `/sub/create` and `/sub/<name>/edit` carry `maxlength="200"` so the no-JS path can't trip the server check accidentally. Closes a small but real abuse vector — long descriptions could inflate every sub-listing row.

### Added — M5/B14 Guest comment composer

- **Always-visible composer on post pages** — the `// comments` composer renders for every visitor, logged in or out. The "log in to comment" placeholder is gone. Without JS the form posts normally and the existing 401 page catches it (honest fallback). Replies still require auth-first; only the top-level composer is guest-friendly in v1.
- **Login-deferred submit (localStorage stash)** — when a logged-out visitor types a comment and hits *comment*, JS stashes `{postPath, body, ts}` under `plato:pendingComment` (24h TTL), opens the header `log in` details, focuses the email field, scrolls it into view, and shows an inline `.guest-notice` banner on the composer: *saved — sign in above to post it*. Nothing reaches the server; the comment endpoint still 401s anonymous POSTs. No new schema, no anonymous-content abuse surface.
- **Auto-submit on magic-link return** — on every page load `comment.js` checks the stash; if the user is now signed in, the path matches, and a non-guest composer is on the page, it fills the textarea and `requestSubmit()`s through the existing JSON splice path. The new comment lands in place with the same loading-dots wave as a normal logged-in submit.
- **Login `return_to`** — header login form now carries a hidden `return_to` field; `comment.js` fills it with `location.pathname + location.search` so the magic-link `nextUrl` lands the visitor back on the post they tried to comment on (instead of `/`). Validated server-side with the existing `safeLocalRedirect` helper. No new endpoint.

### Added — M5/B9 Branding + UI polish (in progress)

- **Vote widget** — single rule: arrows default grey, hover brightens to text; voted-up arrow holds green (`--up`), voted-down arrow holds blue (`--down`). Score number is the primary signal: green if positive, blue if negative, grey at zero. JS handler updates the score class live so a vote that flips the sign re-colors the number without a page reload.
- **Operator-replaceable vote colors** — `branding.colors.up` and `branding.colors.down` in `config.json`; injected into `:root` at boot via a `<style>` block. Boot-time validation rejects CSS-injection characters (`;{}<>"'`) and non-strings; bad config throws before serving any request. 8 unit tests.
- **Outbound-link badges simplified** — `BRAND_ICONS` SVG palette removed; every detected host now renders as a plain `.lh` text badge. Smaller surface, no per-domain styling, easier to fork.
- **Action button unification** — `edit` link converted from plain text to a pill matching `flag` and `collapse/remove/ban` (border, padding, radius). All action buttons now sit in `.post-actions` at the top-right of the row: feed (next to `<h2>`), post detail page (next to `<h1>`), and comments (next to the comment header). Comment header gains `flex: 1` on `.meta` so actions push right.
- **Sub page consistency** — `+ new post` button uses the same `<details class="new-post-toggle">` collapsed pattern as the home page (was an expanded form with `<h3>` heading).
- **Pill height alignment** — `.action-link`, `.flag-trigger`, and `.mod-controls .mod-btn` now share `display: inline-flex; align-items: center; line-height: 1.2; padding: 0.15rem 0.5rem; font-size: 0.78rem; border-radius: 3px`. Edit / collapse / remove / ban / flag pills align cleanly across post and comment rows.
- **Reply-count visibility** — root cause was `.meta a { color: var(--text-dim) }` outranking `.reply-count` by specificity; both zero and non-zero painted grey. Re-qualified rules as `a.reply-count` (0,2,1) so non-zero counts show `var(--accent)` + `font-weight: 600` (an active-conv signal at a glance), zero stays muted at normal weight.
- **Flair editor simplified** — slug input removed from `/sub/create` and `/sub/<name>/edit`; operators only fill **label** + **color**. New `slugifyFlairLabel()` derives the URL slug server-side (a–z, 0–9, hyphen, ≤20 chars; auto-deduped with `-2`/`-3` on collision). Color now uses native `<input type="color">` plus an 8-color preset palette (clickable swatches via `flair.js`). New `contrastTextFor(hex)` picks black or white text per pill so labels stay readable on any operator-chosen background; replaces the hardcoded `--flair-text` constant. Help text links to htmlcolorcodes.com for hex picking.
- **Flair preview on post form** — `flair.js` paints a live colored pill next to the flair `<select>` so authors see the destination tag before submitting. `data-flair-colors` JSON on the wrapper carries the slug→color map, no extra round-trip. No-JS path still works (plain select).
- **Sensitive content per-post** — migration `012_post_sensitive.sql` adds `posts.sensitive` and `drafts.sensitive` (default 0). `submitDraft` / `finalizeDraft` / `editPost` thread the flag through with default `false` so existing callers/tests are unaffected. New post form has a checkbox; edit form too. Render: full `[!] sensitive content — use discretion` banner above the post body on the post page; `[!]` mark next to the title on feed rows. Stacks with the existing per-sub flag — either source triggers the advisory; PRD's no-age-verification rule stays.
- **Form prefill on rejection** — when a logged-in user's `/draft` POST trips the link cap, post-rate, per-sub-rate, ban, or flair-mismatch checks, the page re-renders with `postRetryView` instead of redirecting to an error page. Title, body, flair, and sensitive checkbox are preserved (HTML form values, no draft-table involvement); inline `.post-error-banner` shows the reason. Status codes preserved (400 / 429). Anonymous email-magic-link flow is untouched.
- **Bare URL truncation** — markdown link renderer truncates the *visible text* of bare auto-linked URLs (where `text === href`) past `urlDisplayMax` chars to `prefix...`; `href` and a new `title="full URL"` attribute keep navigation and hover-preview intact. `[label](url)` markdown with explicit labels is left alone — operators chose that text. New operator config `urlDisplayMax` (default 30, integer 10–200) wired through `createApp` → `setUrlDisplayMax()` → module-scoped `URL_DISPLAY_MAX`. Bad value throws at boot.
- **Comment count cleanup** — removed redundant `(${comments.length})` from the `// comments · sort:` H3 on the post page; the comments are right below.
- **Flair filter location** — moved the per-sub flair filter strip below `// posts · sort:` so it sits right above the post list as a sub-filter, not between the new-post toggle and the heading.
- **Pagination — server-side pages, no infinite scroll** — every feed (home posts, home comments, sub) now over-fetches `limit + 1`, slices to `feedPageSize`, and renders a centered `← prev | page N | next 50 →` footer below the list. Disabled prev on page 1, "end" stub on the last page so the layout stays stable. `?page=N` stacks cleanly with existing `?sort=`/`?date=`/`?flair=` params, so deep positions are URL-shareable and back-button-honest. New `parsePage` / `sliceForPage` / `paginationFooter` helpers; new `offset` param threaded through `listRecentPosts`, `listRecentPostsCappedPerSub`, `listPostsAcrossSubs`, `listPostsInSub`, and `listRecentCommentsAcrossSubs` (defaults preserved — backwards compatible). No JS auto-scroll: terminal-honest pause beat, matches HN / lobste.rs / old Reddit. CSS `.page-nav` block uses bordered pill links.
- **Operator config: `feedPageSize`** — top-level integer in `config.json` (default 50, valid range 10–200). Wired through `createApp` → `resolveFeedPageSize` → module-scoped `FEED_PAGE_SIZE`. Smaller pages = more pause beats but more clicks; larger pages strain previews + link-badge build per render. Bad value throws at boot.
- **Unified home feed (per-sub diversity cap removed)** — default home no longer routes through `listRecentPostsCappedPerSub` (cap of 2 newest posts per sub). One feed shape now: `listPostsAcrossSubs` with `sort=new`/`old`/`top`/`hot` × `date=24h`/`week`/`all`. The cap was a small algorithmic intervention that conflicts with "no algorithm decides what you see"; the chips give the reader the levers, and (M6) subscriptions will turn the home into "your subs". Helper deleted from `src/content/post.js`. Test updated: `M2: home page caps recent posts to 2 per sub` → `M5/B9 polish: home page is one unified feed (no per-sub cap)`.
- **Cache busting** — `style.css?v=8`, `flair.js?v=1`.

### Changed — Locked decision: body typeface

- Added "Operator-configurable typeface" to PRD §Permanently out: the body font (`'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` at `style.css:62`) is locked. Mono-by-default is part of plato's voice; an open-ended `fontStack` string invites a typography decision operators didn't ask to make. Same precedent as HN, lobste.rs, old.reddit. Mirrored in operator-guide §What's locked in.

### Added — M5/B10 Flairs (per-sub)

- **Migration 009** — `subs.flairs` JSON column (default `'[]'`), `subs.flairs_required INTEGER NOT NULL DEFAULT 0`, nullable `posts.flair_slug` and `drafts.flair_slug`.
- **Content module `src/content/flair.js`** — `parseFlairs(json)`, `serializeFlairs`, `validateFlair`, `findFlair`. Floors: max 12 flairs per sub, slug `[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?`, label ≤ 24 chars, color is any CSS string with the same injection guard as `branding.colors`.
- **`sub.js`** — `createSub` accepts `flairs` and `flairsRequired`; new `setSubFlairs(db, name, { flairs, flairsRequired })` and `getSubFlairs(db, name)`. `flairs_required` cannot be set when no flairs are defined.
- **`post.js`** — `submitDraft` and `finalizeDraft` thread `flairSlug`. `finalizeDraft` validates the slug against the sub's current list at finalize time (a flair removed between draft and finalize rejects the post). `listPostsInSub` accepts an optional `flairSlug` filter.
- **Routes** — `/sub/create` form has a 6-row flair editor (slug / label / color) plus a "require a flair" checkbox; new owner-only `GET/POST /sub/<name>/edit` for editing flairs (and description) after creation; `/sub/<name>?flair=<slug>` filters the feed; sub-pinned post form shows a flair `<select>` (required attribute set when `flairs_required`).
- **Display** — `flair-pill` rendered in `authorMeta` next to the sub link (clickable to filter); flair filter strip at top of sub page (`all` + each flair as a colored pill); owner sees an `edit sub` link in the sub-page nav.
- **24 new tests** — `flair.test.js` (16): valid/invalid hex/rgb/named, empty→null, label/slug/color floors, duplicate slugs, CSS-injection in color, `findFlair`, `validateFlair` index in error. `flair.test.js` integration (8): persists flairs as JSON, `flairsRequired` requires flairs, invalid flair rejects whole sub creation, `setSubFlairs` replaces list, unknown sub throws, `finalizeDraft` rejects unknown/missing flair, writes `flair_slug` onto post, `listPostsInSub` filters.

### Added — M5/B11 Sensitive content per-sub flag

- **Migration 010** — `subs.sensitive INTEGER NOT NULL DEFAULT 0`. Generic content advisory; intentionally NOT labeled "NSFW" (porn is banned by default rules — labeling something NSFW in a porn-banned forum invites the very content the rules forbid).
- **`sub.js`** — `createSub` accepts `sensitive`; new `setSubSensitive(db, name, bool)`; `listActiveSubs` and `listAllSubs` return the flag.
- **UI** — checkbox in `/sub/create` and `/sub/<name>/edit`. Sub page renders an amber `[!] sensitive content — use discretion` banner under the nav row. Home active-subs strip and `/subs` directory show a small amber `[!]` mark next to the sub name. No age verification (PRD §Permanently out).
- **6 new tests** — defaults to 0, persists 1, toggles, unknown sub throws, list functions return the flag.

### Added — M5/B12 Per-sub flag-threshold override

- **Migration 011** — `subs.flag_threshold INTEGER NOT NULL DEFAULT 3`.
- **`flag.js`** — new `FLAG_THRESHOLD_FLOOR = 3` (raising allowed, lowering forbidden — a single flagger collapsing a target would defeat the "distinct flaggers" defense). New `resolveFlagThreshold(db, targetType, targetId)` resolves the effective threshold per-target (comments inherit their post's sub setting). `submitFlag` now uses the resolved value instead of the global constant.
- **`sub.js`** — `createSub` accepts `flagThreshold` (validates ≥ floor); new `setSubFlagThreshold(db, name, threshold)`.
- **UI** — number input (`min=3, step=1`) on `/sub/create` and `/sub/<name>/edit`.
- **11 new tests** — floor enforcement on create + setter, raising allowed, comment threshold inherits from post's sub, per-sub auto-hide fires at the right count, default still fires at 3.

### Added — M5/B13 My mod decisions panel

Folded into the existing `/modlog` audit surface rather than a separate page. The `[me]` filter button is renamed **my decisions** for discoverability.

- **Inline `revoke` buttons** in the audit table, only on rows where the current handle is the actor AND the action's effect is still in place.
- **`buildRevokeMap(db, actions, currentHandle)`** — batches lookups for posts (`collapsed_at`/`removed_at`), comments (same), and bans (`bans` table existence). Returns `Map<actionId, inverseAction>`.
- **`REVOKE_MAP`** — `collapse → uncollapse`, `remove → unremove`, `ban → unban`. Sub-keys-of-the-kingdom actions (`promote_mod`, `demote_mod`, `transfer_owner`) intentionally NOT one-click revocable — those changes route through the explicit mod-management surface so they require deliberate action.
- **POST flow** — buttons POST to the existing `/sub/<sub>/mod` endpoint with the inverse action; `return_to` carries the audit URL so the page comes back to where it was.
- **7 new tests** — own-active collapse offers uncollapse, no offer when target already uncollapsed, no offer for someone else's action, comment remove offers unremove, ban → unban while still banned then drops, empty when not logged in, `promote_mod` is not one-click revocable.

### Changed — M5 doc updates

- **`build-plan.md`** — B10/B11/B12/B13 marked SHIPPED with implementation details. NSFW per-sub flag renamed to "Sensitive content per-sub flag" with rationale (porn banned → NSFW label invites what the rules forbid). Obsolete favicon-cache section removed (M5/B9 rolled back the brand-icon palette in favor of plain hostname text).
- **PRD §Permanently out** — added "NSFW labeling" entry: `sensitive` is the generic primitive; the NSFW label is excluded specifically because it invites porn that the default rules ban. Forks that want porn can rename/repurpose.

### Tests
- 340 → 408 (68 new): branding colors (8), flair unit (16), flair integration (8), sensitive (6), per-sub flag threshold (11), mod-revoke (7), plus existing pass-through.

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

### Added — M1 Integration (M1 done)
- HTTP request helpers (body reader, form/cookie parsers, send/redirect).
- Application factory `createApp({db, auth, disposableDomains, postsDir, baseUrl})` wires every M1 module behind the routes: `GET /`, `POST /draft`, `GET /draft/<id>/finalize`, `GET /post/<id>`, `GET /avatar/<handle>.svg`. Knowless handlers mounted at `/login`, `/auth/callback`, `/verify`, `/logout`.
- Terminal-aesthetic styles for posts, votes, author meta, and post-body article rendering.
- End-to-end integration test: a stranger posts via the form, the magic link is captured by an injected mailer, the click flow drives the redirect chain, and the finished post renders with pseudonym + identicon. Cookie jar preserves the session across hops.

### Added — M2 Multi-tenant content
- Schema migration `002_subs.sql`: `subs` (name PK, nullable owner, default sort) and `sub_mods` (composite PK on sub_name/handle). `posts.sub_name` and `drafts.sub_name` gain real foreign-key constraints to `subs(name)` via SQLite's table-rebuild dance with `defer_foreign_keys`. Existing rows backfill into a `general` sub created by the migration with NULL owner.
- `src/content/sub.js`: validator (lowercase + alphanumeric + hyphen, 3–30 chars, no leading/trailing hyphen), reserved namespace (`admin`, `mod`, `system`, `api`, `auth`, `assets`, `static`, `health`), transactional `createSub`, `getSubByName`, `listActiveSubs` (24h post count). Names are locked at creation per PRD §subs.
- Front page (`GET /`) now shows active subs (last-24h post count) and recent posts capped at 2 per sub via SQL `ROW_NUMBER() OVER (PARTITION BY sub_name)`.
- `GET /sub/<name>` lists posts in a sub and offers a contextual post form. `GET /sub/create` and `POST /sub/create` cover sub creation (logged-in only). `POST /draft` accepts a `sub_name` field and validates against existing subs.
- `applyAllMigrations` test helper replaces the per-file MIGRATION_001 constant — future migrations are picked up automatically.

### Changed — home subs nav: horizontal strip with progressive disclosure
- Active subs moved out of a vertical list into a horizontal strip at the top of the home page (phpBB/HN-style nav row). Top 3 subs by last-24h post count are always inline; the remainder hide behind `+ show all (N)`, a native `<details>` that expands into a wrapped grid (`auto-fill, minmax(180px, 1fr)`) — 3-across on desktop, 2 on tablet, 1 on phone, no media query needed. Keeps the M1-locked 720px column. Logged-in users see a `+ new` link aligned right; the strip prints a friendly "none yet" with the same `+ new` when no subs exist.
- The 24h-with-zero-fallback ordering surfaces what's lively today and quietly buries dead subs at the tail of the show-all grid.
- `static.js` Content-Type table gains `.html` and `.js` (was falling back to `application/octet-stream`, which made browsers download instead of render).
- 2 new integration tests: top-3-and-show-all rendering, and hide-show-all when ≤ 3 subs.

### Added — M3 Discussion (comments, voting, sorting)
- **Schema** (migration 003): `comments` table (post_id FK, nullable parent_comment_id self-ref, score REAL cached), `votes` table (composite PK on target_type+target_id+handle, value REAL with CHECK locking the four legal magnitudes), `posts.score` column.
- **Vote module** (`src/content/vote.js`): `castVote` toggles same-direction votes off, switches opposite-direction votes, inserts fresh votes; transactionally updates the cached score column. New-account rules per PRD §Voting: half weight (0.5), posts only (not comments), and only on posts < 24h old. Tested across full-weight, half-weight, toggle, switch, and multi-voter cache integrity.
- **Comment module** (`src/content/comment.js`): `addComment` with explicit FK validation (post exists, parent exists if specified, parent belongs to the same post). `buildCommentTree` reconstructs the hierarchy at read time in O(n); orphans (parent removed by mod in M4) surface as roots so they don't vanish.
- **Sort module** (extended `post.js`): `listPostsInSub` gains `sort: 'new' | 'old' | 'top' | 'hot'`. Hot is the HN-shaped formula `score / (age_hours + 2)^1.5` computed in-query via SQLite's POWER — no recurring rank job. Time inputs injectable for deterministic tests.
- **Routes**: `GET /sub/<name>/post/<id>` (full post + threaded comments + reply forms), `POST /sub/<name>/post/<id>/comment` (add comment), `POST /vote` (toggle/switch with `return_to` whitelisted to local paths). `?sort=` query on sub pages with a tab-style nav.
- **UI**: real vote arrows (no JS — each arrow is its own POST form), active arrow highlighted in green/amber, score formatted as integer or one decimal. Comments render hierarchically with CSS depth indents (capped at 8 levels). Reply forms collapse into native `<details>` summaries (no JS). Score ≤ −3 collapses a comment behind a `<details>` (default threshold; per-sub override planned for M4).
- **Legacy URL**: `/post/<id>` 301-redirects to `/sub/<name>/post/<id>` so any external links keep working.
- 191/191 tests (8 new schema, 11 vote, 9 comment, 8 sort, 8 M3 route). Tree assembly, tree orphan handling, `return_to` open-redirect rejection all covered.

### Added — Operator + integration documentation
- **[Operator Guide](docs/02-features/operator-guide.md)** for humans: what plato is and isn't, who it's for, three tiers of customization (forkable / tunable / locked), day-to-day operations, troubleshooting, moderation philosophy, brand identity, FAQ, how-to-fork. Calibrated for non-developer operators considering whether to run an instance.
- **[Integration Guide](docs/02-features/plato.context.md)** for AI assistants and developers: full routes table, settings reference (env vars, per-sub knobs with floors, per-handle locked rules), DB schema, eight recipes (re-skin in a minute, sub-name reservation, threshold tuning, co-mod insertion, flag-queue SQL, hot-fix constants, backup/restore, build status), vocabulary cheat-sheet, forking checklist. Mirrors the structure of [bareagent's integration guide](https://github.com/hamr0/bareagent/blob/main/bareagent.context.md) so agents wiring multiple projects see consistent shape.
- Both docs cross-reference: forkable surfaces (color tokens, logo, tagline, reservations, env, per-sub thresholds), tunable constants (`MAX_DEPTH`, `COLLAPSE_THRESHOLD`, `AUTO_HIDE_THRESHOLD`, etc.), and locked-in product decisions (magic-link auth, no uploads, HMAC handles, locked sub names, two-tier mod with public log, no tags, no private subs, no NSFW age verification). Each entry names the file and line it lives at so a fork knows the cost before it starts.

### Added — M4 Moderation (two-tier mod, flag system, public mod log)
- **Schema** (migration 004): `mod_actions` (audit log), `flags` (user reports), `bans` (per-sub), plus soft-state columns `posts.collapsed_at` / `posts.removed_at` and the matching pair on `comments`.
- **Two-tier moderation**:
  - **Soft removal (collapse).** Body folds behind a `[+] [collapsed by mod]` chip; clicking the chip expands the original content in place. Reason optional. Reversible with `uncollapse`. Modlog renders this as `soft removal`.
  - **Hard removal (remove).** Body replaced with a static `[−] [removed by mod]` stub, no fold. Reason required. Reversible only by mod via `unremove`. Modlog renders this as `hard removal`.
  - Both display side by side in the public modlog at `/sub/<name>/modlog` so the community can audit mod patterns.
- **Mod module** (`src/content/mod.js`): `MOD_ACTIONS` enum, `canModerate` (owner/co-mod resolution), transactional `recordAction` that applies state alongside writing the audit row, `isBanned` for write-path checks. Owner-only actions (`promote_mod`, `demote_mod`, `transfer_owner`) gated separately from collapse/remove/ban.
- **Ban enforcement on write paths**: `castVote`, `addComment`, and `finalizeDraft` reject banned handles in the target sub before any DB write. Resolves the sub via post (direct) or comment → post (one hop).
- **Flag module** (`src/content/flag.js`): five categories (`spam`, `harassment`, `illegal`, `off_topic`, `other`); `submitFlag` writes the flag and auto-collapses at threshold (default 3 distinct flaggers). Re-flagging is idempotent (UNIQUE collision swallowed). UI: inline flag trigger with category dropdown, no JS.
- **Public modlog**: `/sub/<name>/modlog` lists every action chronologically with mod handle, action label, target type+id, optional reason, and timestamp. System-driven actions render `mod_handle` as `<em>system</em>`.

### Added — M4 polish: community auto-uncollapse with per-sub thresholds
- **Score-snapshot at collapse** (migration 005): `posts.score_at_collapse` and `comments.score_at_collapse`. `mod_handle` made nullable so system actors can write audit rows. New `auto_uncollapse_community` action added to the action enum (rebuild via the FK-deferred table-rebuild dance).
- **Cumulative-vote auto-revert**: when a soft-removed target accumulates enough net upvotes since the collapse landed, the system lifts the collapse and writes a `mod_handle = NULL` audit row (rendered as `community overruled` in the modlog). Vote-weight rules (new-account 0.5×, ban-checks) apply to the votes that count toward the threshold. Hard removals are *never* eligible — letting cumulative votes auto-undo a hard removal could revive abusive content.
- **Per-sub, per-target thresholds with floors** (migration 006): `subs.auto_uncollapse_post` (default & floor 50) and `subs.auto_uncollapse_comment` (default & floor 20). `createSub` enforces the floors; `/sub/create` exposes both as number inputs with `min` set to the floor. Rationale: posts surface in feeds and accumulate votes faster than comments — a higher floor on posts ensures a small brigade can't overturn a soft-removal. PRD §Moderation Tier 1 documents the design.

### Changed — modlog vocabulary
- `collapse` / `uncollapse` → display as `soft removal` / `soft removal undone`.
- `remove` / `unremove` → display as `hard removal` / `hard removal undone`.
- `auto_uncollapse_community` → display as `community overruled`.
- The DB action enum stays mechanical; the user-facing labels are mapped at render time.

### Added — comment progressive enhancement
- `comment.js` static asset (~95 lines) intercepts the comment submit, fetches with `Accept: application/json`, splices the rendered fragment into the tree, bumps the count badge, and scroll-flashes the new comment. Falls back gracefully without JS — the same handler returns HTML for non-JSON requests.
- Loading-dots wave animation on the logo mark while the request is in flight (the same animation re-used at any future "loading" surface). Honors `prefers-reduced-motion`.

### Changed — kill default sub
- The legacy `general` catch-all is hidden from new-post forms. Posts must land in a sub with a real owner-mod, per PRD §Permanently out. Existing posts at `/sub/general` remain readable for archaeology; the operator can later delete the sub or rename it. First-run on a fresh instance shows an empty state until someone creates the first sub.
- Anonymous users now see a real sub picker (no hidden `general` fallback). If no postable subs exist, both anon and logged-in users see "create a sub first" instead of a post form. `POST /draft` rejects `sub_name=general` with a 400 explaining the archive-only status.
- PRD §Permanently out and §Front Page updated. Added a new §Age verification and NSFW section locking that as an operator-layer concern, not a forum feature.

### Changed — sub-page preview length
- Sub-page post previews dropped from ~1500 to ~600 chars. The 1500-char inline body produced unscrollable sub pages on busy subs; 600 is roughly double the home preview, fits a short reply or a long post's lede, and keeps the permalink as the read-and-(M3+)-comment destination. PRD §Front Page reflects this.

### Changed — UX iteration on M2
- After publishing, redirect lands on `/sub/<name>` instead of `/post/<id>`. Posts appear in their sub feed in context; the permalink stays canonical for sharing.
- Header restructured: title left, login status (avatar + pseudonym + logout) floats right via flex layout. Anonymous users see a single muted hint line; logged-in users see a compact status block. Frees the page strip for content.
- Post lists render a body preview: home shows ~280 chars (first paragraph) with `read more →` when truncated, sub pages show up to ~1500 chars (effectively full body for typical posts). `/post/<id>` continues to render the full body. Reads markdown files on demand — fine at M2 scale; revisit when post counts justify a `body_preview` column.
- `getPostPreview` is tolerant of missing files (returns empty preview rather than 500), so DB/file-tree drift never breaks a list view.
- `finalizeDraft` now returns `subName` alongside `postId` so the redirect doesn't need a follow-up DB query.
- PRD §Front Page and §Authentication Flow updated to match.

### Fixed
- Logged-in users no longer re-do the magic-link round trip on every post. The `/draft` form omits the email input when a session exists, and the handler short-circuits to `submitDraft` + `finalizeDraft` inline — matching PRD §post-flow step 6 ("Subsequent posts in the same session use the cookie. No re-click required."). Two integration tests cover the new path.

### Changed
- Repository renamed from `plato-forum` to `plato`. Documentation and code now live in one repository.
- POC graduated and was archived. Phase 2 implementation started in a clean repository per AGENT_RULES POC discipline.

### Added — M5 Mod surface (unified `/modlog` with three modes)
- **Spec**: `docs/01-product/m5-mod-surface-spec.md` locks the design — open / inbox / audit modes, click-to-filter as toggle (not chip), 50/page, native `<details>` row expansion, public per-sub modlog stays audit-only.
- **Audit mode**: filtered chronological event stream over `mod_actions`. Filters: date (24h/all-time), type (flagged/banned/removed/all), sub picker, mod click-to-filter (with `system` for NULL), user click-to-filter (works across post/comment authors via author-handle join, plus ban targets directly). Filters compose; pager preserves them.
- **Inbox mode**: deduped target view via `ROW_NUMBER() OVER (PARTITION BY target_type, target_id)` plus an event-count column. One row per affected user/post/comment with `Nx` warm-colored badge when there's mod ping-pong. Pager counts targets, not events.
- **Open mode**: pending-flag list grouped by target. Each row is a vertical `<details>` with the entire summary line clickable. Expanded body shows the post/comment body inline (~600-char markdown preview for posts, full body for comments), flag breakdown ("flagged for: spam (2), harassment (1) · by alpha-x, beta-y"), and a three-button decision form. Default mode = open when pending exist, else audit.
- **`POST /modlog/resolve`** (one-shot decision endpoint): `uphold-soft` calls `recordAction(collapse)` + `resolveFlagsForTarget(upheld)`; `uphold-hard` does `remove` + `upheld` and requires a reason; `dismiss` resolves flags as `dismissed` and emits an `uncollapse` audit row when the target had been auto-hidden.
- **Public per-sub modlog** (`/sub/<name>/modlog`) refactored to match the audit table shape: same columns including a `user` column (target author resolved via post.handle/comment.handle), date + type filter bar, mod and user click-to-filter. Heading reads `// modlog`. Sub-feed page links to it as `← home · public //modlog`.
- **`flaggedTargetsByHandle`** filters by `resolution = 'pending'` so the flagger's button stops dimming after resolution.

### Added — M5 Defenses (forum-wide config with floor-only tightening)
- **Per-account rate limits** (`src/content/rateLimit.js`, PRD §Spam 2): account-age tiers (`new` <24h, `recent` 1-7d, `established` >7d). New: 1 post/hour, 3/day, 10 comments/day. Recent: 3/hour, 10/day, 30/day. Established: no per-account ceiling. Wired into `handleFinalize`, `handleDraft` (logged-in path), `handleAddComment` with 429 + recovery link.
- **Per-sub topic-flood limits** (PRD §Spam 3): 5 posts/day per sub for accounts <30d, 20/day for established. Stacks on top of per-account checks.
- **Outbound link cap per post** (`src/content/linkCap.js`, PRD §Spam 6): tier'd cap (1/3/5 links). Counts bare and markdown URLs, dedupes. Rejects pre-publish with cap + actual count.
- **Spam regex pattern file** (`spam-patterns.txt` + `src/content/spamPatterns.js`, PRD §Spam 9): version-controlled regex set. Conservative starter (crypto, fake jobs, wire fraud, romance scams, phone-text). Match → collapse + system flag (category=spam, note=`pattern: <source>`). Surfaces in `/modlog` open mode.
- **URLhaus blocklist** (`src/content/urlhaus.js` + `bin/refresh-urlhaus.js`, PRD §Spam 6): hourly cron fetches `urlhaus.abuse.ch`'s text feed to `data/urlhaus.txt`; app loads the host set at boot. Match by host (operators rotate paths) → collapse + system flag with note `blocked-url: <host>`.
- **Migration 007**: seeds the `SYSTEM_HANDLE` row (`'0'.repeat(64)`, pseudonym `system`) used by every system-attributed flag. Re-uses the existing flags table — no new schema for system events.
- **System-attributed audit rows (M5/B6)**: `applySpamMatches` and `applyUrlhausMatches` now write a `mod_actions` row attributed to `SYSTEM_HANDLE` with the pattern source / blocked host as the reason whenever they actually flip state. Auto-collapses now appear in `/modlog` audit + inbox modes and in the public `/sub/<name>/modlog` as `system` events — completing the public-modlog leg of the trust model. `?mod=system` filter wired across all three modlog renderers.
- **Operator config (`config.json`)**: `bin/server.js` reads optional config from project root or `PLATO_CONFIG` env. Sections: `rateLimits`, `linkCaps`, `spamPatternsFile`, `urlhausCacheFile`. Each spam knob has a PRD-locked floor; overrides must be ≤ floor (operator can tighten, never loosen). Bad config throws at boot. Per-sub overrides are intentionally **not** supported — spam limits live at the forum level; sub owners only control auto-uncollapse thresholds via `/sub/create`.

### Added — Friendly error UX
- New `errorPage(req, ctx, { title, message, links })` helper renders every error inside the full site chrome (top `siteHeader` + bottom `siteFooter`). Banned-from-sub errors parse the sub name and surface a `← back to /sub/<name>` link. Sweep applied to: login required, post failed, comment failed, rate limited, sub-create errors, mod failures, resolve failures.
- Immediate-post catch (`handleDraft` logged-in path) was missed in the original sweep; M5/B6 converts it to `errorPage` with the same ban-message back-link parsing as the finalize path.

### Changed — Header consistency
- `siteHeader` defaults to home-page chrome (`plato` wordmark + `a forum that lives at one URL`) when a page passes neither `title` nor `subtitle`. Stripped six `title: 'plato · forum'` overrides — every cross-sub view now matches the home page. Per-sub feed keeps its own identity (`/sub/<name>` + description).

### Security & correctness — M1–M4 audit fixes (M5/B7)

A code-review audit of M1–M4 (the pre-M5 surface) flagged a handful of issues that earlier review missed. Fixed before any public trial:

- **Open-redirect partial bypass** — `safeLocalRedirect()` helper rejects `//evil.com` (protocol-relative) and `/\evil` shapes in `?return_to=` across `/vote`, `/flag`, `/sub/*/mod`, `/modlog/resolve`. Prior `startsWith('/')` accepted both.
- **Atomic post finalize** — `finalizeDraft` now writes `<id>.md.tmp-<rand>`, runs the DB transaction, renames inside the success path. INSERT failure unlinks the temp; no orphan markdown ever exists under its permanent name. Previously the file was written before BEGIN, so a rolled-back INSERT left the body on disk forever.
- **Frontmatter sentinel parser** — `parseFrontmatter` now anchors on the leading `---\n…\n---\n` block and requires every interior line to look like `key: value`. A user body whose paragraph contains its own `---\n…\n---\n` no longer gets re-stripped on read.
- **Length caps on user input** — server-side: `TITLE_MAX = 300`, `BODY_MAX = 40000` in `submitDraft`; `COMMENT_BODY_MAX = 10000` in `addComment`; `NOTE_MAX = 280` in `submitFlag`. Forms had `maxlength` but a crafted POST bypassed it; the schema columns were unbounded TEXT.
- **Fresh-user first action** — `pseudonymFor()` at the top of `castVote` and `submitFlag` so a logged-in user whose first action is a vote or flag (no post yet) doesn't crash on the FK or `isNewAccount` lookup.
- **Comment under removed parent** — `addComment` now rejects when the parent post or parent comment is hard-removed. Previously, replies were accepted under `[removed by mod]` stubs.
- **Comment cycle / deep recursion** — `buildCommentTree` detects parent-chain cycles (a→a, a→b→a) and surfaces cycle nodes as roots. `commentNodeView` enforces `HARD_DEPTH = 64` so a pathological thread can't blow the render stack.
- **`transfer_owner` validation** — explicit existence check on the target handle with a clean error, before the FK fires; transactionally rolls back on failure.
- **Avatar regex** — tightened from `[0-9a-f]{1,128}` to `{64}`. Prior regex accepted 1-char "handles" producing nonsense identicons.
- **`pendingFlagCount`** — `count(DISTINCT flagger_handle)`, spelling the PRD "3 distinct flaggers" intent (equivalent under the current UNIQUE).
- **CSRF / SameSite** — verified knowless sets `SameSite=Lax; HttpOnly` on every session cookie (`node_modules/knowless/src/handlers.js:217`). No code change needed; documented for the threat model.

### Added — UX pass (M5/B8)

A small read-the-design-mockups + close-the-feedback-loop pass:

- **`/subs` directory page.** Sortable list of every sub (most recent / most posts / a-z) with description, owner pseudonym, post count, **subscribers** column (placeholder `—` until M6), and last-activity timestamp. Client-side prefix filter via the search input. Linked from the subs strip as the `all` chip.
- **`//<sub>` display style.** Replaced `/sub/<x>` text in feed post-meta, comment-feed context line, post-page breadcrumb, sub-page heading, post-form dropdown, and back-to-sub error links with `//<x>` (Reddit-shape with a leaner sigil). The actual route stays `/sub/<x>`; only display text changed.
- **Reply-count link on feed.** "47 replies" / "1 reply" / "0 replies" text link replacing the SVG bubble experiment (icon felt foreign to the terminal aesthetic; text is denser and reads in any column-width). Zero-reply state stays muted but readable.
- **Sub color accent on feed.** `/sub/<x>` links in post-meta and the communities directory now use a deterministic 8-color palette indexed by hash of the sub name (`subColorIndex` in `app.js`). Same sub keeps the same color across renders — visual anchor without an avatar / image / icon. Forks override the palette in one place (`--sub-color-0..7` on `:root`).
- **Domain hint after outbound links.** `markdown.js` link renderer now appends a `↗ host.com` span after every absolute http(s) link. Pure text, no favicon image (the design mocks had favicons via `s2/favicons` but that proxy leaks viewer→Google; self-hosting favicons reintroduces the no-uploads exception). Reader sees where each link goes before clicking.
- **Home top-nav: Posts | Comments + sort + date.** Tab strip above the home feed:
  - **Posts** (default, capped per-sub on the unfiltered feed; switches to global `listPostsAcrossSubs` when any filter is active) | **Comments** (`listRecentCommentsAcrossSubs`, `removed_at IS NULL`).
  - Sort chips: **new** (default, `created_at DESC`) | **old** (`created_at ASC`) | **top** (`score DESC`) | **hot** (post-only, HN-shape `score / (age_hours + 2)^1.5`).
  - Date chips: **24h** | **week** | **all** (default).
  - `Subscribed | All` toggle deferred to **M6** (subscriptions table doesn't exist yet).
- **Width tightening.** Body `max-width` 720px → 880px globally — comment trees + modlog table + post-meta now breathe at 4-deep nesting without wrapping. Reading column inside `<article>` bodies is unchanged.
- **Operator branding (`config.json:branding`).** Three knobs — `forumName` (top + footer wordmark + page title), `tagline` (home-page subtitle), `hostedBy` (footer line `a <forumName> instance hosted by <hostedBy>`, line hidden when empty). The 3-blue-dot logo and the footer quote `— "opinion is the medium between knowledge and ignorance."` are locked across all forks. Wired through `createApp({ branding })` and `bin/server.js`.

### Tests
- 245 → 340 (95 new): rate limits (9 + 5 config), per-sub rate (3), modlog resolve flow (5), spam patterns (13), link cap (12), URLhaus (11), `modlog-http.test.js` (22) covering /modlog dispatcher modes + filter chain, `POST /modlog/resolve` decisions/permissions, end-to-end defense firing through `POST /draft`, `errorPage` chrome on banned-from-sub, the open-redirect fallback (3 cases: `//evil`, `/\evil`, legit `/sub/x`), and the M5/B8 UX wiring (`/communities` listing, `/?tab=comments` feed, `/?sort=top&date=24h` filtering). M5/B7 audit fixes (15) covering title/body/note/comment caps, atomic finalize, frontmatter round-trip, fresh-user vote/flag, removed-parent rejection, comment-tree cycle detection, transfer_owner validation.
