# PRD: Forum — phpBB-Era Discourse, 2026 Substrate

A Reddit-shaped community platform owned by its members, not a company. Pseudonymous text-first discussion, hierarchical replies, upvote/downvote, sub-communities, passwordless auth via [knowless](../../../knowless). Replaces Discord, Slack, subreddits, and old-style mailing lists for groups that want to last decades.

The thesis: the open web's failures were never technical. The protocols still work. What died was the on-ramp and the defaults. Social media has corrupted attention, manufactured followers, weaponized algorithms, and turned discourse into surveillance. The phpBB era already had the right shape — small, durable, focused on what was said, not who said it. We rebuild that shape with 2026 expectations baked in: passwordless auth, no PII collection, no media hosting, exit-via-fork as the real check on power.

---

## Principles

These are load-bearing. Anything that violates a principle needs an explicit override decision.

- **No accounts in the platform-collection sense.** Identity is a knowless magic link. No passwords, no profile to fill, no PII stored.
- **No PII.** Plaintext email is never persisted — only HMAC-derived handles. No real names, no phone numbers, no birth dates, no profile photos.
- **Focus on what's said, not who said it.** Auto-generated two-word pseudonyms and small identicon avatars by design — no uploads, no personal pictures, no display-name vanity races.
- **No algorithmic feed.** Chronological, reverse-chronological, or user-defined sorts only. No "for you," no engagement optimization.
- **No follow graph.** Sub subscriptions only — bookmarking a place, not idolizing a person.
- **No telemetry.** Server logs only. No third-party analytics, no pixels.
- **No media hosting, ever.** Links only. Permanent design choice.
- **Plain files are the source of truth.** Posts, threads, archives are folders of markdown + JSON.
- **One-command export, one-command import.** Communities can fork off bad mods. This is the real power-check.
- **Self-hostable in five minutes.** docker-compose or equivalent.
- **Boring, mature dependencies.** PostgreSQL, SQLite, Caddy, knowless. No chasing the new shiny.

---

## What it explicitly is not

- Not a microblog (no follow graph, no timeline).
- Not a chat app (no real-time pressure, no presence indicators).
- Not Substack (no creator monetization, no built-in newsletter).
- Not a federated social network (single-instance by default; federation is a v2 question).
- Not a media host (text-only, links to external media).

---

## Identity Model

**Single mechanism: knowless passwordless auth.** Email is transient input, never persisted; HMAC-derived handle is identity.

```
pseudonym_id = HMAC-SHA256(instance_secret, normalize(email))
```

- **First-time user** types email → knowless sends magic link → user clicks → session cookie set → server generates two-word pseudonym + identicon → user can post.
- **Returning user** types email → magic link → same handle re-derived → existing pseudonym + history attached. No password, no recovery flow, no PII.
- **No plaintext email is ever stored**, by either knowless or the forum. The email is used to send the magic link, then discarded.
- **Forking property:** different instance has a different `instance_secret`, so the same email produces a *different* handle on a fork. Per-instance pseudonymity is part of the value.
- **Cross-instance migration**: per-user export contains the original handle; on the new instance, the user re-claims via magic link to the same email, and the new instance maps old-handle → new-handle in their export.
- **No password recovery**: losing access to your inbox is losing your account. By design. Stated in user-facing copy.

### Pseudonyms

- Two-word handle generated from a profanity-filtered adjective + noun list (≈500 each → 250k combos, +2-digit suffix on collision → 25M).
- User can re-roll up to 5 times at first signup, then pick one.
- Renamable once per 30 days from a fresh re-roll set, to prevent identity-laundering after a bad post.
- Unique per instance. Tied to the HMAC handle.

### Avatars

- Auto-generated identicon (jdenticon or dicebear-shapes) deterministically derived from the handle.
- Displayed at 32×32px max. Small by design — encourages focus on content over appearance.
- No uploads, ever. No URL field. No "set custom avatar" path.
- Cached server-side; regenerable from handle.

---

## User Display

What appears next to a username and on a profile page is a deliberate design choice. Show readers enough context to weight what they're reading without creating metrics that turn the forum into a reputation casino.

### Shown next to every post and comment

- **Pseudonym** + **identicon** (32×32).
- **Account age bucket**: "new account," "1 month," "1 year," "5+ years." Coarse only.
- **Sub tenure** (only on posts within a sub): "active here for X months."
- **Per-post score**: upvote/downvote total for *this specific post*, not career-wide.

### Shown on the user's profile

- Pseudonym, avatar, account age bucket, list of subs they're active in (no rank or stats).
- Recent posts and comments (chronological, last 30 days), each with per-post scores.
- Optional one-line bio (text only, 200 char limit, **no links** — kills the "profile as billboard" trap).

### Shown on profile and on hover from any post — verdicts only, never accusations

- **Mod-confirmed removals in the last 90 days, per-sub.** "3 posts removed in /sub/cooking, 1 in /sub/politics." Old removals roll off.
- **Active sub-level bans, if any.** "Currently banned from /sub/news."

### Never shown — anywhere

- Career karma total (the Reddit mistake).
- Raw flag counts (unverified accusations enable brigading).
- Post counts (invites volume-farming).
- Reply counts (invites engagement-farming).
- Badges, levels, achievements, trophies.
- Leaderboards of any kind.
- Follower / following counts (no follow graph exists).
- "Last seen" / "online now" indicators.

### Why this combination

Readers get the signals they actually need — *is this person established, has this post earned approval, has a mod taken action against them recently* — without the metrics that turn forums into reputation casinos. Account age is the only career-wide signal, and the one signal you can't game.

---

## Content Model

- **Sub-forums** ("subs"): named topical spaces. Anyone can browse without an account. Posting requires knowless session.
- **Sub creation**: open to anyone. Creator becomes mod, can appoint co-mods, can transfer ownership. No tenure gate — equal right to fork is the constitution. (Revisit only if mass spam-creation appears.)
- **Posts**: text-first. Title + markdown body.
- **Media**: **links only, never hosted.** The forum holds zero media files, ever. Links display as clickable text — no inline embeds, no preview cards, no auto-rendered video. If a link target dies, the link dies; the post text remains.
- **Comments**: hierarchical, unlimited depth, collapsible. Markdown.
- **Voting**: upvote / downvote on posts and comments. One vote per handle per item. Tallies visible. Downvote = "I disagree / low quality." No moderation consequence — opinion signal only.
- **Flagging**: separate from voting. Categorized. Routes to mod queue. See *Spam & Abuse Defenses*.
- **Sorting**: hot (vote velocity), new (chronological), top (all-time votes), old (oldest first). User picks default per sub.

### Why links-only, forever

Hosted media means storage costs that scale with usage, bandwidth bills, CSAM scanning obligations, copyright takedown handling, image-moderation queues, embed-rendering security surface (XSS via iframes), and 50GB tarballs on export instead of folders of markdown. None of that fits "small, durable, forkable, text-first." Users who want image hosting use a dedicated host. Users who want video use YouTube/Vimeo. The forum is for the conversation. The conversation is text. **This isn't a feature gap — it's the point.**

---

## Front Page / Discovery

Same page for everyone — logged in or not. Two sections, no personalization, no algorithm.

### The instance home page

**Active subs (last 24h)**: list ordered by post count in the last 24 hours, tiebreak by member count. Sub name, one-line description, post count, member count.

**Recent posts (last 24h, chronological)**: stream of posts from any sub, newest first, **capped at 2 posts per sub** so a busy sub can't drown out everything else. Time, sub, title, score.

That's the home page. Two lists, both chronological, both deduped. No "for you," no algorithm, no ranking magic.

### My Subs (logged-in users with subscriptions)

Recent posts from subscribed subs, chronological, max 2 per sub, last 24-48 hours. Same dedup rule. No algorithm. No "you might also like." A user with no subscriptions sees only the regular home page — no empty-state pressure to subscribe.

### Sub page

Default sort is whatever the sub mods set. User picks: **hot** / **new** / **top** / **old**. Hot is offered *within a sub* because that's where users want to see current engagement; not on the home page or my-subs because at those layers chronological with per-sub dedup is dumber and harder to game.

### Why time-based ranking with per-sub caps

- **Easy to reason about.** "Last 24h, newest first, max 2 per sub" is one sentence. No tuning constants.
- **Hard to game.** No magic numbers, no decay function.
- **Doesn't hide slow-burn content.** A thoughtful post that gathers votes over 3 days isn't punished by an algorithm.
- **No single optimization target.** Hot ranking on the home page would make every poster optimize for hot. Chronological removes that target.

The downside — a noisy sub dominating — is killed by the per-sub cap. Vote weighting at the home-page layer is a v2 conversation.

---

## Sub Subscriptions

- One click from any sub page to subscribe / unsubscribe.
- **Private.** No "followers of this sub" page. Member counts can be displayed (a fact of existence), but no leaderboard of who-subscribes-where.
- **Notification modes** (per-sub, user choice):
  - **None (default)**: subscribe silently. Posts appear on the My Subs page when the user visits.
  - **Email digest**: daily or weekly summary of new posts. (Reuses the magic-link mailer infrastructure.)
  - **ntfy push**: real-time phone notification. User provides their own ntfy topic URL; forum POSTs to it. See *ntfy integration*.
- Subscription lists are **exportable** as part of user profile data. Forking to a new instance brings the list with one-click re-subscribe.

### ntfy integration

[ntfy](https://ntfy.sh) is generic HTTP-based push: the user installs the ntfy app, picks a private topic URL like `https://ntfy.sh/my-forum-pings-x9k2-q7p4`, pastes it into the forum's per-sub settings. The forum's only job is one HTTP POST per notification — title and click-back URL. No SDK, no library, one `curl`-equivalent call.

- Self-hosted ntfy fully supported (point at any ntfy server).
- No state beyond the user's preference. If ntfy goes away, forum still works; user just doesn't get pushes.
- **Never the default. Never required. Never used for sensitive content** (account events, mod notifications stay on email).

### Per-sub RSS

Every sub publishes `/sub/<name>/feed.xml`. Composes with any RSS reader. The forum's job ends at "publish RSS"; aggregation happens elsewhere.

---

## Authentication Flow (knowless)

1. User clicks "Reply" or "Post" on the web.
2. Form asks for email + content (or just email if not yet posting).
3. Knowless sends magic link (15-minute TTL).
4. User clicks within 15 min → session cookie set (30-day TTL).
5. Forum derives handle from the verified knowless session via `X-User-Handle` header (forward-auth) or `auth.handleFromRequest(req)` (library mode).
6. Subsequent posts in the same session use the cookie. No re-click required.
7. Cookie expires after 30 days → magic link required again.

For repeat users, posting feels almost as fast as logged-in posting. For first-timers, it's two clicks more than a session-based platform.

### Auth integration mode

**Standalone forward-auth** (recommended). Architecture:

```
Browser → Caddy → /login,/auth/callback,/verify,/logout → knowless-server
                → /*                                    → forum app (auth-naïve, reads X-User-Handle)
```

The forum app is auth-naïve. Caddy verifies the session via knowless `/verify`, injects `X-User-Handle`, the forum trusts the header. This lets the forum be in any language and keeps auth a single concern in a single box.

---

## Moderation

Two-tier system, both visible to users.

### Tier 1: Collapse (soft)

- Mod marks a post or comment "hidden."
- Appears collapsed with a one-line reason ("off-topic," "rule 3," etc.).
- Reader can click to expand. Vote tallies still show.
- For: opinions the mod disagrees with, off-topic, low-effort, mild rule violations.

### Tier 2: Remove (hard)

- Post removed from thread entirely.
- Listed in a public mod log with reason and timestamp.
- Original viewable only via the log (or not at all for protocol-blocked content).
- For: targeted harassment, doxxing, illegal content, deliberate harm.

### Mod structure

- Each sub has one **owner** (the handle that created it).
- Owner appoints **co-mods** (any number, drawn from sub members).
- Owner can transfer ownership.
- All mod actions logged with mod's pseudonym and reason.

### Protocol-level hard blocks (instance-wide)

Conservative set rejected at the relay before reaching mods:
- Known CSAM hashes (PhotoDNA)
- Confirmed malware URLs
- Doxxing patterns matching reported targets

Versioned, publicly documented. No mod can override; no mod can opt in to allow them.

### No instance-level moderation above sub mods

Each sub is its own universe. There is no platform-level "remove this sub" authority — only the protocol-level blocks above. If a sub is bad in ways that don't hit those blocks, the answer is fork-and-leave, not instance-wide takedown. **Revisit if instance-poisoning is observed in practice.**

### Exit as the real check

If a community decides the mod is bad, the export-and-fork mechanism is the answer. Any member can export the full sub archive (posts, comments, metadata, member pseudonym list with consent). A new instance spins up with the archive in one command. Members re-subscribe with their email. The old instance keeps running for whoever stays.

This is not theoretical. Export must be one-click, complete, tested before launch, documented in user-facing copy. Without working exit, all the other moderation talk is decoration.

---

## Spam & Abuse Defenses

Layered, all standard practice. Knowless covers the auth-layer rules; the forum covers content-layer rules.

### Covered by knowless (no forum work needed)

1. **Magic-link to post.** First-time post requires email click. Subsequent posts use 30-day session cookie. Knowless built-in.
2. **Per-IP rate limits** (signup floods, login floods). Knowless built-in.
3. **Per-handle token cap** (email-bombing). Knowless built-in.
4. **Honeypot fields** on login form. Knowless built-in.
5. **Email enumeration prevention.** Sham-work timing equivalence. Knowless built-in.

### Covered by perimeter (Caddy / IP-rep)

6. **Per-IP hashcash if observed need.** Off-the-shelf Caddy modules; not in knowless, not in the forum app. Defer until observed bot signup actually saturates `maxNewHandlesPerIpPerHour`.

### Forum-layer rules — v1

7. **Disposable-domain check.** Forum runs the check at form-handler time, before calling knowless `startLogin`. Operator subscribes to `disposable-email-domains/disposable-email-domains` list (weekly cron, hot-reloadable, override-able). Timing leak is acceptable — the blocklist is a public GitHub repo, so timing reveals nothing the attacker can't already query directly. Mechanism + list + override + cron all live forum-side.

8. **Per-account rate limits with new-account scrutiny.**
   - Account age < 24h: 1 post/hour, 3 posts/day, 10 comments/day. All surface in mod queue with "new account" tag.
   - 1–7 days: 3 posts/hour, 10 posts/day, 30 comments/day.
   - 7+ days with no upheld flags: limits removed.
   - 30+ days with positive history: trusted, can pre-empt mod queue.

9. **Per-sub rate limits.** Default 5 posts/day per sub for accounts < 30 days, 20/day for established. Catches topic floods.

10. **Outbound link cap per post.**
    - <24h: 1 link max.
    - 1–7 days: 3 links max.
    - 7+ days: 5 links max (configurable per sub).
    - Every URL checked against URLhaus (`urlhaus.abuse.ch`, hourly cron). Bad URLs stripped, post auto-flagged.

11. **Flag system (separate from downvote).**
    - Downvote = opinion. Affects sort. No mod consequence. One click.
    - Flag = rule violation. Routes to mod queue. Requires category + optional explanation.
    - 3 flags from distinct accounts (distinct handles AND IP /24 AND each ≥7 days old) auto-hides pending mod review.
    - Repeatedly dismissed flagger → flag weight reduced. After 5 dismissed in 30 days, advisory only.

12. **Velocity alerts to mods.** Per-sub dashboard:
    - Posts/hour, comments/hour, signups/hour. >3× rolling 7-day average → alert.
    - Same /24 subnet posting 5+ times in 1 hour → alert.
    - New-account posts surfaced as a queue.

13. **Spam pattern file.** Version-controlled `spam-patterns.txt` of regex. Posts matching → auto-hide pending mod review. Mods append. Ships with conservative starter (crypto-scam phrasings, fake-job, wire-fraud, romance-scam openers, phone-with-text patterns).

14. **No DMs.** Removes the entire scammer-private-message attack surface.

15. **No media hosting.** Removes duplicate-image fraud, CSAM scanning load, malware-via-image, image-phishing, copyright takedown overhead. Already in *Content Model*.

16. **Public mod log.** Discourages mod abuse, gives users evidence when forking is needed, lets users calibrate trust before joining.

### Deferred to v1.1 (don't pre-build)

- **Bayesian content filter** — needs training data the v1 instance won't have.
- **Ban evasion correlation by IP /24 + UA** — knowless gives handle-level evasion-detection automatically; add IP/UA correlation only if observed evasion shows up.
- **Per-account vote velocity limits** — defer until brigading is observed.

### Combined effect

Rules are multiplicative. Most automated attackers don't get past three; very few past six. Maintenance is light: weekly cron pulls of disposable-email and URLhaus lists, occasional regex additions, mod attention to the velocity dashboard.

What these rules *don't* solve: the determined human attacker with patience. That's an ineliminable cost of running any community. The answer is human moderators with discretion, the public mod log to keep them honest, and the cheap-exit fork mechanism for when the moderators themselves go bad. Don't promise users protection from determined human malice. Promise them a place where most of the noise is filtered out and the rest is handled by humans who can be replaced if they fail.

---

## Voting

- One vote per handle per item.
- **New account (<7 days): vote weight 0.5, only on posts <24h old.**
- **7+ days: full weight, all posts.**
- Per-account vote velocity limits deferred to v1.1.
- Vote tallies visible. Sort orders use raw or time-weighted tallies depending on sort.

Per-IP hashcash at the Caddy perimeter (off-the-shelf modules) is the primary defense against vote-farming via mass account creation, **deployed only if observed need**. Don't add per-vote PoW; it's user-hostile. Don't pre-build perimeter defenses for unobserved abuse.

---

## Technical Stack

Boring and proven. No exotic protocols.

- **Auth**: [knowless](../../../knowless) v0.2+, standalone forward-auth mode. Caddy in front, knowless handles `/login`, `/auth/callback`, `/verify`, `/logout`. Forum app reads `X-User-Handle`.
- **Backend**: Node.js, Go, or Python. Reference impl TBD — pick at build start. (Knowless being Node doesn't constrain the forum.)
- **Database**: SQLite (single-instance) or PostgreSQL (multi-instance hosting).
- **Web server**: Caddy (auto-TLS) in front of everything.
- **Email out (magic links + digests)**: Postfix on localhost (knowless requirement). No vendor SMTP.
- **Storage**: posts as markdown files in a per-sub directory (optionally a git repo). Database is an index over the files, regenerable.
- **Cryptography**: knowless handles HMAC-SHA256 handle derivation. One server-side Ed25519 keypair for signing archive exports. No per-user keys.
- **Timestamping**: OpenTimestamps anchored daily on archive exports.
- **Avatars**: identicon library (jdenticon or dicebear). Server-generated, deterministic, cached.

### Why we are not signing posts

Considered and rejected:

- **No consumer.** Nothing in the design verifies per-post signatures. Posts render from the database. Forks rely on email re-claim.
- **Bad security property.** With a server-derived key, the server can forge any user's posts. The signature would *appear* to prove authorship while only proving "the master key signed this." Misleading guarantee — worse than no guarantee.
- **Feature creep.** Signed posts invite verified-user badges, cross-instance identity, federation primitives. None in scope.
- **Threats already handled.** Magic-link sessions authenticate web posts. Mature, sufficient.

### Archive integrity (the achievable property)

On export, the server signs the archive *as a whole* with one Ed25519 key it publishes. This proves "this archive was produced by this server" — a claim the server can actually back up. Forked instance imports → verifies signature → confirms origin unmodified. OpenTimestamps anchor the archive periodically.

---

## Export Format

Two exports: per-sub (community fork) and per-user (individual migration). Both one-command.

### Per-sub export

```
sub-export/
  sub.json              # name, description, owners, mod log
  posts/
    2026-04-15-abc123.md           # frontmatter + markdown body
    2026-04-15-abc123.meta.json    # timestamps, votes, handle
    ...
  comments/
    2026-04-15-abc123/
      def456.md
      def456.meta.json
  members/
    pseudonyms.json     # handle → opt-in re-invite email (hashed)
  moderation/
    log.json            # all mod actions, public
    rules.md            # current rules
  archive.sig           # Ed25519 signature
  server-pubkey.pem     # public key archive is signed against
  archive.ots           # OpenTimestamps proof
```

Importable with `forum import-sub sub-export/`. New instance verifies `archive.sig` against `server-pubkey.pem` (published at a stable URL by the original server).

### Per-user export

```
user-export/
  profile.json          # pseudonym, account-age timestamp, bio, avatar seed
  subscriptions.json    # subscribed subs (with original instance URLs)
  posts.json            # references to all posts authored, by sub
  comments.json         # references to all comments authored, by sub
  mod-log.json          # mod actions taken against this account, last 90 days
```

Importable with `forum import-user user-export/`. New instance:
- Re-creates pseudonym (or suggests an alternative if taken).
- Re-establishes subscriptions — local subs subscribed directly; external subs stored as RSS bookmarks.
- Carries forward account-age timestamp so tenure isn't lost on migration.

---

## What's in v1

- Single instance, no federation.
- Subs, posts, comments, voting, sorting.
- Knowless-backed magic-link auth (forward-auth mode).
- Auto-generated two-word pseudonyms + identicon avatars.
- Sub subscriptions (private, exportable, three notification modes: none / email digest / ntfy push).
- Front page (active subs + recent posts, chronological, 2/sub cap) + my-subs page.
- User display: account age bucket, sub tenure, per-post score, mod-confirmed removal history (90 days). No karma, no flag counts, no leaderboards.
- Two-tier moderation with public log.
- Spam and abuse defenses: rules 1-5 (knowless), 6 (perimeter, deferred), 7-16 (forum). See *Spam & Abuse Defenses*.
- One-command per-sub export and per-user export.
- Self-hostable docker-compose.
- Search (Postgres full-text or SQLite FTS5).
- Dark mode, mobile-responsive web.
- RSS feed per sub.

## What's explicitly out of v1

- Direct messages.
- Following users (only sub subscriptions are allowed).
- Karma / reputation scores.
- Federation.
- Mobile apps (web works on mobile).
- Custom themes per sub.
- AI-assisted moderation.
- Bayesian filter, ban-evasion correlation beyond what knowless does, vote-velocity limits — all deferred until observed need.

## Permanently out (design choice, not v1 limitation)

- Hosted media (images, videos, files). Links only.
- Inline embeds, link previews, auto-rendered video players.
- Following users. Sub subscriptions allowed; user-following is not.
- Public follower / subscriber lists.
- Algorithmic feed of any kind.
- Engagement metrics surfaced to users (no view counts, no time-on-page).
- Profile photos, custom avatars, avatar uploads.
- Real names, phone numbers, any PII collection.

---

## Knowless Integration Spec

Forum depends on knowless v0.2.1+ in standalone forward-auth mode. The integration surface is small by design — knowless handles identity, the forum handles everything else.

### What forum consumes from knowless

1. **Forward-auth `/verify` endpoint** returning `X-User-Handle` for a valid session. Caddy passes the header through to the forum app. Forum is auth-naïve.
2. **Magic-link round-trip** at `/login`, `/auth/callback`, `/logout`. Forum links to `/login?next=<forum-url>`; knowless redirects back after the click.
3. **Three operator-visibility hooks** (knowless v0.2.1) the forum operator can subscribe to for monitoring:
   - `onMailerSubmit({messageId, handle, timestamp})` — per-event, real submissions only
   - `onTransportFailure({error, timestamp})` — per-event, no identity data
   - `onSuppressionWindow({sham, rateLimited, windowMs})` — batched aggregate; per-event sham/rate-limit hooks intentionally not exposed (would re-open the enumeration channel sham-work was built to close)
4. **`verifyTransport()`** — opt-in startup check that Postfix is reachable. Forum's docker-compose calls it at boot.
5. **`openRegistration: true`** configuration. Forum is open-registration by default.

### What forum does NOT depend on knowless for

- **Disposable-domain blocking.** Lives in the forum (rule 7). The blocklist is public, the policy is per-instance, the cron is operator-side — mechanism follows policy.
- **Account age / tenure.** Forum tracks its own `(handle, first_seen_at)` keyed on first post. Forum-tenure ≠ knowless-registration-age (a user can register with knowless and never post). Forum-derived tenure is the more accurate signal for forum behavior.
- **Hashcash / PoW.** Perimeter concern (Caddy), deployed only if observed need.
- **Vote velocity, content rules, mod log, flag system, link caps, URL blocklists.** All forum-layer.

### The principle behind this split

Policy lives with mechanism. Knowless is *who*; forum is *what they did*. Every feature that has its policy / list / cron / override curated by the forum operator should also have its mechanism in the forum app. Splitting policy from mechanism across the library boundary is the wrong seam — the adopter ends up plumbing data through the library to enforce its own rules.

Knowless walks away at v1.0.0 (maintenance mode after that). Every config option / hook / method shipped before then is frozen forever, so the surface stays small.

---

## Success Criteria

- A small group (10-50 people) can move off Discord and not regret it within a month.
- One technical operator can host a sub for 1000 users on a $5/month VPS.
- A community can fork off a bad mod with a working archive in under an hour.
- Spam stays under 1% of total posts with default settings.
- No PII is collected anywhere in the system. Verifiable by reading the schema.
- The product fits in one tweet: *"A forum that lives at one URL. Magic-link to post (no password, no PII). Pseudonyms and identicons by default. Search and read on the web. Owner moderates; mod actions are public; if it goes bad, fork the archive."*

---

## Build Plan

### Phase 0: Knowless v0.2.1
Knowless team lands the three operator-visibility hooks + `verifyTransport()` + startLogin docs. Independent of forum work. No blockers — the forum POC can begin in parallel against knowless v0.2.0 and migrate to v0.2.1 when it ships (the new hooks are additive).

### Phase 1: Forum POC
Validate the core loop end-to-end with knowless forward-auth. Single sub, post + comment + vote, magic-link login, identicon avatars, two-word pseudonym generation. Hardcoded values, manual setup. See *POC Plan* below. ~1-2 weekends.

### Phase 2: Forum v1
Full feature set above. Subs, mod tools, exports, RSS, ntfy, spam defenses, docker-compose. ~3-4 months focused work.

### Phase 3: Hosted instance
Operator-friendly hosted version. One-click migration in either direction. Donation-funded.

---

## POC Plan

The POC validates **one question**: can a stranger land on the home page, post, get a magic link, click it, and have their post appear under a generated pseudonym + identicon — end-to-end through Caddy → knowless → forum app, with no PII stored?

If yes, the architecture is sound and Phase 2 builds out from this skeleton. If no, we learn what's wrong before writing the full feature set.

### What the POC must prove

1. **Forward-auth works end-to-end.** Caddy in front, knowless `/verify` returns `X-User-Handle`, forum reads it, posts attribute correctly.
2. **HMAC handle is the only identity.** Schema has zero plaintext-email columns. `grep email` returns nothing in the forum DB.
3. **Pseudonym + identicon generation is deterministic from handle.** Same handle always renders same pseudonym + same avatar. Cache works.
4. **Disposable-domain check runs forum-side, before knowless.** Test with a `mailinator.com` address; rejected before knowless ever sees it.
5. **A post round-trips through markdown storage.** Posts are markdown files on disk; DB is the index, regenerable from disk.

### What the POC explicitly skips

- Subs (single hardcoded global sub for now)
- Comments, voting, sorting (just posts + chronological list)
- Moderation, flag system, mod log
- Email digests, ntfy push, RSS
- Per-account / per-sub rate limits (hardcoded global limit OK)
- URL blocklist (URLhaus integration), spam pattern file, velocity dashboard
- Export / import
- Search
- Dark mode, mobile polish
- ALL spam rules 8-16 (forum-layer rules — defer to Phase 2 once architecture is proven)

If the POC tries to ship more than the five validation points above, kill scope. Per AGENT_RULES: ~15 min of POC, hardcoded values fine, manual steps fine, no tests yet, never ship the POC — rewrite for Phase 2.

### POC architecture

```
Browser
  ↓
Caddy (auto-TLS, single domain forum.local for POC)
  ├─ /login, /auth/callback, /verify, /logout → knowless-server (npx knowless-server)
  └─ /*                                       → forum-app (Node | Go | Python — pick one)
                                                  ↓
                                                SQLite (forum.db)
                                                  ↓
                                                posts/*.md (filesystem)
```

Postfix on localhost for magic-link delivery. `transport_maps` configured per knowless OPS.md to discard sham recipients.

### POC flow (the one validation path)

1. Stranger visits `forum.local/`. Sees empty home page, "Post" button.
2. Clicks Post. Form: email + title + markdown body.
3. Submits. Forum runs disposable-domain check (rejects if hit). On pass, calls knowless `startLogin({email, nextUrl: '/post-callback?draft=<id>'})`. Forum stashes the draft post in a temp table keyed by a draft ID.
4. Knowless sends magic link. User clicks. Knowless `/auth/callback` → session cookie set → 302 to `/post-callback?draft=<id>`.
5. Forum's `/post-callback` reads `X-User-Handle` from Caddy, looks up the draft, derives or fetches pseudonym + identicon for the handle, writes the post to `posts/<date>-<id>.md` + indexes in SQLite, redirects to the post URL.
6. Post page renders with pseudonym + 32×32 identicon. Refresh from a different browser shows the same post (state is persistent).

### POC success criteria

- All five validation points above pass.
- DB schema has no plaintext email column. (`sqlite3 forum.db .schema | grep -i email` returns empty.)
- Total code: under ~500 lines forum-app (excluding html templates). If it's bigger, scope crept.
- Time-to-build: 1-2 weekends. If longer, the architecture is wrong, not the implementation.

### POC graduation criteria

When the POC works end-to-end and all five points are green: stop. Do not iterate features on the POC. Open a fresh Phase 2 branch, design the full schema, write tests for the data layer, then port the validation path into the real codebase. Never ship the POC.

---

## Locked Decisions (POC scope)

1. **Backend: Node.js.** Single-language stack with knowless. `node:sqlite`, `node:http`, `node:fs` cover the POC; `marked` (one dep) for markdown rendering. No framework — vanilla `node:http` per AGENT_RULES "vanilla over frameworks."
2. **Disposable-domain check: included in POC.** ~30 lines, proves the forum-side identity-policy seam at the cheapest moment.
3. **Pseudonym word list: `unique-names-generator`.** Zero curation cost for POC. Phase 2 curates our own list for brand voice.
4. **Identicon library: `dicebear` (`bottts` or `shapes` style).** Matches "funny avatars" PRD intent. Server-rendered, deterministic from handle.
5. **POC deploy: bare-metal local processes.** No Docker. Knowless via `npx knowless-server`, forum app via `node app.js`, Caddy via `caddy run`, Postfix via system service. `forum.local` in `/etc/hosts`. HTTP only. Per AGENT_RULES: containerize only when necessary — POC isn't necessary, Phase 2 deployment is.
6. **Solo development.** Phase 1 is one person.
7. **POC is throwaway.** Per AGENT_RULES — graduate to a clean Phase 2 repo. POC is for learning, not for code.

---

## Pre-POC Checklist

Before writing line one of forum code:

- [ ] Knowless v0.2.0 cloned at `~/PycharmProjects/knowless`, runs locally
- [ ] `npx knowless-server` boots and `/verify` returns 401 unauthenticated, 200 + `X-User-Handle` after a magic-link round-trip
- [ ] Caddy installed, can route to knowless and a stub forum app
- [ ] Postfix on localhost configured per knowless OPS.md (transport_maps for sham recipient)
- [ ] Real email inbox available for magic-link clicks (use a real address you control)
- [ ] Backend language locked (question 1 above)
- [ ] Pseudonym + identicon library choices locked (questions 3, 4)
- [ ] Disposable-domain list pulled to local file once (the cron is a Phase 2 concern; for POC, manual pull is fine)
- [ ] Empty git repo for forum app

When all checked: start the POC. ~1-2 weekend's work to the validation points above.
