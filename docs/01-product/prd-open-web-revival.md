# PRD: plato — Open Web Forum

> **Companion docs.** This PRD is the *why* — the locked product decisions and their rationale. Day-to-day operator and integration guidance lives alongside it:
> - [Operator Guide](../02-features/operator-guide.md) — for humans running, customizing, or forking a plato instance: forkable / tunable / locked tiers, day-to-day operations, troubleshooting, FAQ.
> - [Integration Guide](../02-features/plato.context.md) — for AI assistants and developers: routes, settings reference, recipes, vocabulary cheat-sheet, forking checklist.
>
> If you're touching the implementation, read those two first; this PRD is the constitution they cite.

> **Historical note.** This document was originally drafted as "Open Web Revival — Two Products" alongside a sibling feed-reader product. The reader was cancelled (mature alternatives already exist in multiple shapes — NetNewsWire, Miniflux, FreshRSS, Reeder, etc.). plato remains the one product this PRD specifies. References below to "Product 2" or "the reader" survived for historical context but the codebase ships only the forum.

A rebuild of one piece of the pre-platform internet that still works and now matters more than it did in 2005: a **forum**. Shipped as a forkable repo with one-command deploy, no-account, gitdone-shaped (signed, timestamped, exportable, no platform owns your data).

The thesis: the open web's failures were never technical. The protocols still work. What died was the on-ramp and the defaults. plato restores both, with 2026 UX expectations baked in.

---

## Shared Principles

These apply to both products. Anything that violates a principle needs an explicit override decision.

- **No accounts.** Identity is email + magic link. No passwords, no signups, no profile to fill.
- **Web is the primary surface.** Email is a transport option, not the default experience.
- **Signed and timestamped.** Every post or assertion is verifiable: DKIM if it came by email, hash + signature if it came by web. OpenTimestamps anchor periodically.
- **Plain files are the source of truth.** Posts, threads, archives, subscription lists — all serializable as folders of plain files (markdown + JSON + standard formats).
- **One-command export, one-command import.** A user or community can leave any hosted instance with their full data and import it into a fork. This is the actual power-check, not voting or governance.
- **No algorithmic feed.** Chronological, reverse-chronological, or user-defined sorts only. No "for you," no engagement optimization, no recommendation engine.
- **No telemetry.** Server logs only. No third-party analytics, no pixels, no tracking.
- **Notifications are opt-in, per-source, and never the default.** Email digests and per-sub RSS feeds are available where they fit, but the default is *the user visits when they want*. No urgency engineering, no "you have 5 unread," no push-by-default. Notifications are a convenience the user explicitly turns on for specific sources, not a behavior the platform pushes onto them. Push channels (ntfy, web push, native push) are deliberately out of scope — see §Push notifications: deliberately not shipped.
- **Self-hostable in five minutes.** One docker-compose command or equivalent. Hosted version available for non-technical operators, with one-click migration in either direction.
- **Boring, mature dependencies.** PostgreSQL, SQLite, Caddy, standard libraries. No chasing the new shiny. External services (malicious-URL feeds, disposable-email lists) are opt-in transports, never required.

---

# plato

## What it is

A Reddit-shaped community platform without Reddit's ownership, algorithm, or fragility. Pseudonymous text-first discussion, hierarchical replies, upvote/downvote, sub-communities (sub-forums), magic-link auth. Replaces Discord, Slack, subreddits, and old-style mailing lists for groups that want to last decades.

## What it explicitly is not

- Not a microblog (no follow graph, no timeline).
- Not a chat app (no real-time pressure, no presence indicators).
- Not Substack (no creator monetization, no built-in newsletter).
- Not a federated social network (single-instance by default; federation is a v2 question).

## User Model

- **Identity**: email address. Required for posting and voting; not required for reading.
- **Display**: pseudonym chosen at first post, with optional default avatar (text initials only — no images allowed as avatars).
- **Email is private.** Pseudonym is public. Mapping is stored hashed; recovery uses email.
- **One pseudonym per email per instance.** No alts on the same instance. (Forking the instance is the alt-account mechanism.)
- **No following users.** No friend graph, no mutuals, no "who I know" features. Following users creates status games and the celebrity-account problem; we don't have it.
- **Subscribing to subs is allowed.** Following a sub is bookmarking a place, not idolizing a person. It's the RSS-shape of relationship — utility, not status. Subscriptions are private (no public follower lists), exportable, and produce no notifications by default. See *Front Page / Discovery* for how subscriptions surface.
- **No DMs (v1).** Removes the harassment vector and the scammer-messaging-victim attack surface.

## User Display

What appears next to a username and on a user's profile page is a deliberate design choice. The principle: show readers enough context to weight what they're reading, without creating metrics that turn the forum into a reputation casino.

### Shown next to every post and comment

- **Display name** (the chosen pseudonym).
- **Account age bucket**: "new account," "1 month," "1 year," "5+ years." Coarse buckets only — no precise dates. You can't game tenure, which is exactly what makes it the most honest signal available.
- **Sub tenure** (only on posts within a sub): "active here for X months." Localized — being well-regarded in /sub/woodworking shouldn't transfer to /sub/politics.
- **Per-post score**: the upvote/downvote total for *this specific post*, not career-wide.

### Shown on the user's profile page

- Display name, account age bucket, list of subs they're active in (without rank or stats).
- Recent posts and comments (chronological, last 30 days), each with their per-post scores.
- Optional one-line bio (text only, 200 char limit, no links — kills the "profile as billboard" trap).

### Shown on the user's profile, AND on hover from any post — only verdicts, never accusations

- **Mod-confirmed removals in the last 90 days, per-sub.** "3 posts removed in /sub/cooking, 1 in /sub/politics." This shows what a mod actually decided, not what other users accused. Old removals roll off — no permanent shame for behavior that may have been a phase.
- **Active sub-level bans, if any.** "Currently banned from /sub/news." Public so readers know context.

### Never shown — anywhere

- **Career karma total** (the Reddit mistake). Invites optimization for the number, which corrupts the signal it was supposed to provide.
- **Raw flag counts.** A flag is an unverified accusation, not a verdict. Public flag counts enable brigading (anyone can damage a user's reputation by getting friends to flag), create chilling effects on legitimate dissent, and conflate "posts unpopular truths in active subs" with "posts spam." Show mod verdicts instead — they reflect actual rule-breaking.
- **Post counts** (invites volume-farming).
- **Reply counts** (invites engagement-farming).
- **Badges, levels, achievements, trophies.** Status games.
- **Leaderboards of any kind.** Status games at scale.
- **Follower / following counts.** No follow graph exists in the first place.
- **"Last seen" / "online now" indicators.** No presence pressure. People come and go.

### Why this combination

Readers get the signals they actually need — *is this person established here, has this specific post earned community approval, has a mod taken action against them recently* — without the metrics that turn forums into reputation casinos. The community can self-organize around quality without anyone optimizing for a number.

Account age is the only career-wide signal, and it's the one signal you can't game.

### The principle behind moderation balance

The PRD's moderation design — visible mods, public mod log, downvotes for opinion vs flags for rules, exit-via-fork as the real check — reaches for the balance the phpBB era found at its best: **moderation that is visible, accountable, and proportional**.

Two failure modes to avoid:

- **Over-regulation**: every post pre-screened, mods deleting on suspicion, no appeal. Communities feel sterile, contributors leave because they can't tell what's allowed. The platform becomes safe and dead.
- **Under-regulation**: anything goes, mods AWOL, "free speech" as a shield for harassment. Communities drive out the thoughtful and concentrate the inflammatory. The platform becomes alive but toxic.

The balance comes from three properties:

1. **Mods are visible and named.** Specific pseudonyms make specific decisions; the public mod log enforces this.
2. **Mod power is bounded by exit cost.** Overreach triggers fork. The fork mechanism is the actual constitution.
3. **Most enforcement is community-level.** Downvotes sink low-quality content automatically. Flags route to mods only for genuine violations. Mods handle exceptions, not volume.

This shape worked for phpBB-era forums of hundreds to thousands. It does not scale to millions, and that's a feature, not a bug. A forum that works well for 200-2000 people in a topic is exactly the right size for most communities. You don't need everyone, and trying to serve everyone is what corrupted the platform model.

## Content Model

- **Sub-forums** ("subs"): named topical spaces. Anyone can browse without an account. Posting requires email magic-link.
- **Posts**: text-first. Title + markdown body.
- **Media**: links only, never hosted. The forum holds zero media files, ever — not in v1, not in v2, not ever. Users link to YouTube, Vimeo, Imgur, their own domain, wherever. Links display as clickable text — no inline embeds, no preview cards, no auto-rendered video players. If the link target dies, the link dies; the post text remains. This is a permanent design choice, not a v1 limitation.
- **Comments**: hierarchical, unlimited depth, collapsible. Markdown.
- **Voting**: upvote / downvote on posts and comments. One vote per email per item. Vote tallies visible. Downvote = "I disagree / low quality." Has no moderation consequence — it's an opinion signal.
- **Flagging**: separate from voting. A flag is "this violates rules / is harmful." Requires selecting a category. Routes to mod queue. See *Anti-Abuse* section for the threshold and weighting rules.
- **Sorting**: hot (vote velocity), new (chronological), top (all-time votes), old (oldest first). User picks default per sub.

### Why links-only, forever

Hosting media means: storage costs that scale with usage, bandwidth bills, CSAM scanning obligations, copyright takedown handling, image-moderation queues, embed-rendering security surface (XSS via iframes), and a 50GB tarball when you export a sub instead of a folder of markdown files. None of that fits the "small, durable, forkable, text-first" goal.

Users who want reliable image hosting use a dedicated image host. Users who want video use YouTube or Vimeo. The forum is for the conversation. The conversation is text. This isn't a feature gap — it's the point.

## Front Page / Discovery

What users see when they land on the instance, and how they find their way to subs.

### The instance home page

Same page for everyone — logged in, logged out, no personalization. Two sections:

**Active subs (last 24h)**: list of subs ordered by post count in the last 24 hours, tiebreak by member count. Shows sub name, one-line description, post count, member count.

```
- /sub/woodworking (47 posts, 2.3k members) — "hand-tool woodworking"
- /sub/cooking (23 posts, 5.1k members) — "recipes and technique"
- /sub/sf-classifieds (18 posts, 412 members) — "buy/sell in SF Bay"
- ...
```

**Recent posts (chronological by default)**: a stream of posts from any sub on the instance, newest first. Shows time, sub, title, score. As of M5/B9 polish, no per-sub cap — one busy sub *can* dominate the feed; the reader's response is to use the date filter, click into a specific sub, or (M6) subscribe so the home becomes "their subs." A per-sub cap would be a small algorithmic intervention, and "no algorithm decides what you see" is load-bearing.

**Top-nav filters (M5/B8)**: the home feed exposes three orthogonal axes — `Posts | Comments` tab (comments tab shows `listRecentCommentsAcrossSubs`, removed-comments excluded), sort `new | old | top | hot` (hot is post-only; uses HN-shape `score / (age_hours + 2)^1.5`), and date `24h | week | all`. One feed shape: `listPostsAcrossSubs(sort, sinceMs)` for every combination, defaults `sort=new` + `date=all`. `Subscribed | All` toggle deferred to M6.

**`/subs` directory (M5/B8)**: a separate page listing every sub on the instance with description, owner pseudonym, post count, last-activity timestamp, and a subscribers column (placeholder `—` until M6 ships subscriptions). Sortable (`active | posts | name`), client-side prefix filter. Linked from the home subs strip as the `all` chip. The home page covers "what's lively right now"; `/subs` covers "what exists at all."

That's the home page. Two lists by default, both chronological, both deduped sensibly. No "for you," no algorithm, no ranking magic.

### The "my subs" page (logged-in users with subscriptions)

A logged-in user who has subscribed to one or more subs sees an additional surface: **My Subs** — recent posts from their subscribed subs, chronological, max 2 per sub, last 24-48 hours.

Same dedup rule as the home page. No algorithm. No "you might also like." If you're subscribed to 5 subs, you see those 5 subs' recent activity. That's it.

A user with no subscriptions sees only the regular home page. No empty-state pressure to subscribe.

### The sub page

Clicking a sub takes you to its posts. The user picks a sort order: **hot** (vote velocity), **new** (chronological), **top** (all-time votes), **old** (oldest first). The default is whatever the sub's mods set.

Hot is offered *within* a sub because that's where users want to see what their community is engaging with right now. It's not offered on the home page or the my-subs page because at those layers, chronological with per-sub dedup is dumber and harder to game.

### Why time-based ranking, no algorithmic cap

The simplest possible version that doesn't break:

- **Easy to reason about.** "Newest first, optionally filter by date or sort by top/hot" is one sentence. There are no tuning constants.
- **Hard to game.** No magic numbers, no decay function (except hot, which is opt-in), no early-vote concentration to exploit.
- **Doesn't hide slow-burn content.** A thoughtful post that accumulates votes over 3 days isn't punished by an algorithm that thinks it's "old."
- **Doesn't create a single point of optimization.** Hot ranking on the home page would mean every poster optimizes for hot. Chronological default removes that target.
- **No algorithmic per-sub cap (M5/B9 polish).** An earlier draft capped the default home feed at 2 posts per sub for diversity. That cap was itself a small unstated algorithm, and conflicted with "no algorithm decides what you see." The chips give the reader the levers; (M6) subscriptions will turn the home into "your subs" by user choice, not by code. The downside — a noisy sub dominating until M6 — is acceptable: it's *honest*. The reader can hop into a quieter sub or use the date filter.

### Sub subscription mechanics

- One click from any sub page to subscribe or unsubscribe.
- Subscriptions are **private**. Nobody can see who's subscribed to what. No "followers of this sub" page. Member counts can be displayed (they're a fact of the sub existing), but no leaderboard of who-subscribes-where.
- **Notification modes** are pull-only by design, three tiers:
  - **None (default)**: subscribe silently. Posts appear on the My Subs page when the user visits.
  - **Per-sub RSS** (`/sub/<name>/rss`, public): the sub's feed in any standard reader. Anyone with the URL can read it; no account required.
  - **All-subs RSS** (`/u/<token>/subs.rss`, token-gated): one feed merging new posts across every sub the user has subscribed to. Sub activity only.
  - **All-subs + notifications RSS** (`/u/<token>/rss`, token-gated): the all-subs feed plus the user's memlog signals (replies to their comments, mod actions on their content) interleaved by time.
- Subscription lists are **exportable** as part of user profile data. If the user forks to a new instance, they bring their list and can re-subscribe in one click.

### Outbound channels: pull-only, deliberately

Plato's default for "what happened in your subs / what mentions you" is **come back when it itches you**. The forum is not the senate; nothing here is time-sensitive enough to justify push channels or email digests, both of which drag a tail of urgency-engineering, opt-out plumbing, and (for email) plaintext-address storage that conflicts with plato's locked auth posture.

The outbound shapes plato supports are all pull, three tiers wide:

- **Per-sub RSS** at `/sub/<name>/rss` — public, anyone in any reader.
- **All-subs RSS** at `/u/<token>/subs.rss` — token-gated, merges posts across all the user's subscribed subs. Sub activity only.
- **All-subs + notifications RSS** at `/u/<token>/rss` — token-gated, the above plus memlog signals (replies, mod actions). The "everything tied to my account" feed.

The two token-gated feeds share **one** per-user token, shown on the memlog page with a "regenerate" affordance; rotating it invalidates both URLs at once. Subscription lists are private (PRD §Sub subscription mechanics), so neither aggregated feed can be public-readable.

Cut from the original M6 plan and not shipping:

- **Email digests.** Would have required either plato storing plaintext email (breaks the auth-layer lock) or coupling to a knowless feature that retains email for opted-in users. Either path hands plato an outbound-mail responsibility beyond magic-link delivery, plus deliverability, bounce handling, opt-out tokens, cadence config, and operator burden. The pull shapes above cover the same ground without any of that.
- **ntfy push.** Self-hosted ntfy can't deliver real iOS push (Apple's APNs gate routes only via `ntfy.sh`), so the experience would silently work on Android and feel broken on iOS. Platform-skew support cost too large for a hobby-scale forum.
- **Native web push / browser push.** Same urgency-engineering objection as ntfy, plus permission-prompt friction, plus an additional cryptographic-key surface. Not interesting.

Email is preserved as plato's auth floor (magic links via knowless) and **only** as the auth floor. There is no "email me when X happens" mode of any kind, anywhere in the product, deliberately.

### Per-sub RSS

Every sub publishes an Atom feed at `/sub/<name>/rss`. Users subscribe in any standard reader (NetNewsWire, Miniflux, FreshRSS, Reeder, etc.) alongside blogs, newsletters, and watched URLs. The "follow a sub" mechanism inside the forum and the "subscribe via RSS" mechanism outside it coexist; users pick whichever fits their workflow. RSS is the open-web staying-current pattern plato wires into by default — there's no in-house reader to ship.

plato's per-sub feeds are public; the two **personal aggregated feeds** at `/u/<token>/subs.rss` (subs only) and `/u/<token>/rss` (subs + notifications) are token-gated because the subscription list and the memlog they draw from are private. Together the three tiers cover "follow this sub publicly", "give me my whole subscription list as one feed", and "give me everything tied to my account" without ever pushing to the user.

## Authentication Flow

1. User clicks "Reply" or "Post" on the web.
2. Form asks for email + content.
3. User submits. Server emails a one-time link.
4. User clicks link within 24h. Post goes live, signed.
5. Browser stores a token (cookie or local) so subsequent posts in the same session don't require re-clicking.
6. Token expires after 30 days of inactivity. Magic-link required again.

For repeat users, posting feels almost as fast as logged-in posting. For first-timers, it's two clicks more than a session-based platform.

### Silent-miss extends to the link-click stage

Plato's auth flow (via knowless) treats unknown emails, rate-limited new-handle creation, and valid emails identically at the POST `/login` stage — same response shape, same timing, same sham-mailing path. This is anti-enumeration: an attacker probing whether `victim@example.com` is a registered user can't tell from the response.

The contract extends to the link-click stage. Sham, expired, and used-token clicks redirect to **home** (`/`), not to `/login`. A logged-out user landing on the home page after a sham click looks identical to a user arriving at the site for the first time — there is no observable signal that a login attempt occurred or was rejected. Adopters wrapping knowless must set `failureRedirect: '/'` (or any non-login destination); knowless's library default of `cfg.loginPath` is a partial leak.

### Dev/prod env split

Plato uses a two-file env layout so production-shaped config and dev-only knobs don't share a file:

- **`.env`** (gitignored) — secret + base config (`KNOWLESS_SECRET`, `KNOWLESS_BASE_URL`, `KNOWLESS_FROM`, `PORT`, `DB_PATH`). Looks the same in every environment.
- **`.env.dev`** (committed) — dev-only knobs that loosen security floors so localhost testing isn't blocked. Currently: `KNOWLESS_DEV_LOG_LINKS=true` (print magic links to stderr when SMTP fails), `KNOWLESS_MAX_NEW_HANDLES_PER_IP_PER_HOUR=100` (raise per-IP first-login cap from default 3), `KNOWLESS_MAX_LOGIN_REQUESTS_PER_IP_PER_HOUR=1000` (raise per-IP total-login cap from default 30 — past which knowless silently early-returns and the magic-link log fallback stops firing).

Two npm scripts:

- **`npm start`** — loads `.env` only. Production-shaped: floors at their secure defaults, no magic links printed, no caps loosened.
- **`npm run dev`** — loads `.env` then `.env.dev`. Node 22 multi-`--env-file` is left-to-right with later overriding earlier, so dev-knob values win.

`.env.dev` is safe to commit because it contains no secrets — only tunables that everyone running the dev recipe should share. Devs who need personal overrides can keep them in `.env` (already gitignored) since `.env.dev` is loaded second and would be overridden by neither — except that's exactly the wrong way around for this layout. The cleaner pattern when personal overrides are needed is to add a third `.env.local` (gitignored) loaded last via a second `--env-file` in a personal alias.

## Email-as-Transport (Optional Mode)

A user can also subscribe to a sub by email. Three modes:

- **Web-only** (default): no emails, visit the web to read.
- **Digest**: one email per day with thread roundup.
- **Firehose**: every post and reply as a separate email. Reply-by-email works (parsed and threaded into the web view).

Replies-by-email are DKIM-verified before posting. Originating address must match the registered email for the pseudonym.

## Moderation

Two-tier system, both visible to users.

### Tier 1: Soft removal (collapse)

- Mod marks a post or comment as "hidden."
- It appears as a `[+] [collapsed by mod]` chip in the thread; clicking the chip expands the body in place of the label.
- Any reader can click to expand.
- Vote tallies still show.
- Reason is **optional** (the act is reversible and visible; the audit log captures who collapsed what).
- Used for: opinions the mod disagrees with, off-topic posts, low-effort content, mild rule violations.
- Public modlog renders this as **`soft removal`** (and `soft removal undone` on revoke).
- **Community auto-revert**: if the soft-removed target accumulates **enough net upvotes** since the collapse landed, the system auto-uncollapses it without mod intervention. The audit log records this as `community overruled` with `mod_handle = NULL`. Score-snapshot at collapse time enables the comparison; vote-weight rules (new-account 0.5x, ban-checks) still apply to the votes that count toward the threshold. Mods see the override in their modlog (and in the M5 "my mod decisions" panel) but take no action — the system handles the reversal. Soft moderation thus has both a mod-driven undo path (manual `uncollapse` button) and a community-driven undo path (cumulative upvotes). Hard moderation has neither — see Tier 2.
- **Per-sub thresholds**: posts and comments have separate, mod-configurable auto-revert thresholds set at sub creation. Defaults match the floors below.
  - **Posts: floor of 50.** Posts surface in feeds and accumulate votes faster than comments — the bar must be high enough that a small brigade can't overturn a soft-removal.
  - **Comments: floor of 20.** Comments are downstream of a post, so their vote pool is naturally smaller; the bar is correspondingly lower.
  - The floors are enforced at sub creation (`createSub`) and on the `/sub/create` form. Mods can raise either threshold but never lower it below the floor. Subs created before migration 006 get the floors as defaults via the column DEFAULT clauses.

### Tier 2: Hard removal (remove)

- Post body is replaced with a `[−] [removed by mod]` static stub. Same shape as the collapsed chip, opposite sigil, no fold — content is genuinely gone from view.
- The slot still occupies its place in the tree so downstream replies don't show holes.
- Reason is **required** (the destructive direction needs a written justification — self-discipline gate, mod action visible in the public log).
- Original content viewable only via the log (or not at all for protocol-blocked content).
- Used for: targeted harassment, doxxing, illegal content, deliberate harm.
- Public modlog renders this as **`hard removal`** (and `hard removal undone` on revoke).
- **No community auto-revert**: hard removal is for content the mod doesn't want anyone seeing. Letting cumulative votes auto-undo a hard removal could revive abusive content. Hard removals are reversed only manually by a mod via the `unremove` button — and that reversal is itself a logged action.

### Mod structure

- Each sub has exactly one **mod** (the email that created it; stored in code as `subs.owner_handle`, surfaced in UI as "mod"). One per sub, always.
- Mod can promote any **subscriber of the sub** to **co-mod**. Subscription is plato's only "intent to engage" primitive; eligibility is checked at promotion time only. After promotion, the mod role and the subscription are independent — unsubscribing later does not auto-revoke mod status. Promoting a non-subscriber is rejected.
- Mod can demote any co-mod. Co-mods cannot demote each other or the mod.
- **Co-mods can demote themselves** (step down to regular member). The mod cannot — to leave the role, the mod transfers to a co-mod via step-down (see *Sub Lifecycle*).
- Mod can transfer the role to any current co-mod via step-down.
- All mod actions are logged with the actor's pseudonym and reason in the public modlog. The modlog does **not** carry a role badge per row — pseudonym is the actor identity; role at-time-of-action is intentionally not denormalized. Mods share one queue of pending actions and the first to act records the row.
- The mod queue is shared between the mod and all co-mods. There is no fan-out notification when a flag arrives — pending actions are visible to everyone with mod role on the sub. Reasoning: notification fan-out adds plumbing without changing the trust model. The shared queue is the channel.

### Sub Lifecycle

Subs have exactly two states: **active** and **read-only**. There is no third state — no archived, restricted, private, quarantined, or closed. Read-only is *state*, not *consequence* — a sub may cycle active ↔ read-only freely throughout its life with no cooldown, no escalation, and no aggregate count anywhere.

**What enters read-only:**
- The mod steps down with no co-mods present (in-app: the step-down form replaces successor selection with "disable sub" when there are zero co-mods).
- 30 days pass with no mod activity in the sub — measured as the latest of: any post, comment, or mod_action by any current mod (owner or co-mod). Threshold is **floor-locked at 30 days**; operators cannot override. The 28-day warning surfaces in a per-sub banner 48 hours before auto-disable, with explicit migration framing: *"this sub will become read-only in X hours. if you want to carry this community forward, create a new sub and post the link here now."* The auto-disable writes a synthetic mod_actions row (action `auto_disable_inactivity`, mod_handle `SYSTEM_HANDLE`) so the transition is auditable in the public modlog like every other action.

**What exits read-only:**
- Any current mod (owner or co-mod) can flip the sub back to active via `/sub/<name>/edit`. The action writes a `manual_reactivate` row in the modlog. No cooldown.
- If no mods exist (the step-down-with-no-co-mods case), the sub is **permanently read-only** as a historical record. The community migrates by creating a new sub via normal in-app affordances during the warning window; forward-pointing redirects from the new sub handle attribution.

**Operator is not in the loop for sub governance.** plato's operators run the instance, not its communities. They never assign new mods, never reactivate subs, never rename them. The only operator-layer concerns are infrastructure (uptime, backups, branding, spam config). The escape hatch when a community disagrees with a mod is *forking the sub* — create a new one, the operator has no say. This refusal is a cultural lock matching the rest of plato's "no admin-authority surface" posture; it is also the load-bearing defense against operator-coercion-via-authority (a lawful order to install a chosen mod has nothing in plato's data layer to attach to).

The marker for read-only subs surfaces on `/subs` (the directory), not `/about` — `/subs` is where users browse to make decisions. The sub's own page also carries an in-context banner so direct-URL visitors aren't confused about why posting is blocked.

The only operator interventions that exist at all are infrastructure-level recipes documented in the operator-guide: branding edits, spam knob tightening, killing the process to apply a config change. Sub-level state never appears in those recipes.

### Protocol-level hard blocks

A small, conservative set of content is rejected at the relay before it reaches mods: known CSAM hashes (PhotoDNA), confirmed malware URLs, doxxing patterns matching reported targets. These blocks are versioned and publicly documented. No moderator can override; no moderator can opt in to allow them.

### Exit as the real check

If a community decides the mod is bad, the export-and-fork mechanism is the answer. Any member can export the full sub archive (all posts, all comments, all metadata, member pseudonym list with their consent). A new instance can be spun up with the same archive in one command. Members who want to follow re-subscribe with their email. Old instance keeps running for whoever wants to stay.

This is not theoretical. The export must be one-click and complete, tested before launch, documented in user-facing copy. Without working exit, all the other moderation talk is decoration.

## Spam Defenses

Layered, all standard practice. Each rule below has explicit criteria and a source for the data it depends on.

### Build status (M5)

| Rule | Status | Notes |
|---|---|---|
| 1. Magic-link to post | shipped (M1) | knowless library |
| 2. Per-account rate limits | shipped (M5/B1) | tier'd by account age; `RATE_LIMIT_FLOOR` in `rateLimit.js`; per-instance tighten via `config.json` |
| 3. Per-sub rate limits | shipped (M5/B2) | newish 5/day, trusted 20/day; same tighten-only floor |
| 4. Disposable email blocking | shipped (M1) | `disposable-domains.txt` |
| 5. Honeypot fields | deferred | low ROI; bots that fill posting fields are also bots that fill honeypots |
| 6. Outbound link cap | shipped (M5/B4) | 1/3/5 by tier; `LINK_CAP_FLOOR` |
| 6b. URL malicious-domain check | shipped (M5/B5) | URLhaus hourly cron via `bin/refresh-urlhaus.js` |
| 7. Flag button | shipped (M4/M5) | five categories, flagThreshold per-sub, floor 3 (M5/B12) |
| 8. Velocity alerts | deferred | post-trial; manual /modlog scrolling suffices for unannounced trial |
| 9. Spam pattern file | shipped (M5/B3) | `spam-patterns.txt` operator-editable, version-controlled |
| 10. Bayesian filter | deferred | not v1; regex covers the campaign-reuse pattern |
| 11. Hashcash | deferred | the rate limit + link cap stack already costs an attacker more than hashcash adds |
| 12. Ban evasion correlation | deferred | post-v1; needs IP /24 grouping infrastructure |
| 13. No DMs in v1 | locked | DM is permanently out |
| 14. No media hosting | locked | text-only is permanent |
| 15. Public mod log | shipped (M4) | `/sub/<name>/modlog`; M5 added unified `/modlog` (now **public** for the audit mode — instance-wide, no login required, linked from the footer of every page; `mode=open` and `mode=inbox` stay mod-only); M5/B6 surfaces system auto-actions as `system`-attributed audit rows |

### Build status (M5 per-sub structure)

| Feature | Status | Notes |
|---|---|---|
| B9: branding colors override + vote recolor + edit window + action-pill unification | shipped (M5/B9) | `resolveBrandingColors`; 24h edit window (`EDIT_WINDOW_MS`); `BRAND_ICONS` removed |
| B10: per-sub flairs | shipped (M5/B10) | max 6, owner-curated, 6-digit hex color, optional `flairs_required` |
| B11: per-sub sensitive flag | shipped (M5/B11) | amber banner, not NSFW labeling |
| B11.1: per-post sensitive flag | shipped (M5/B9 polish, migration 012) | author-set; stacks with per-sub flag |
| B9.1: flair editor simplified | shipped (M5/B9 polish) | label + color only; slug auto-derived; native picker + 8-color palette; auto-contrast text |
| B9.2: post-form prefill on rejection | shipped (M5/B9 polish) | typed content survives link-cap / rate-limit / ban / flair-mismatch; status codes preserved |
| B9.3: bare-URL truncation | shipped (M5/B9 polish) | visual-only; `urlDisplayMax` operator config (default 30) |
| B9.4: feed pagination | shipped (M5/B9 polish) | server-side pages, no infinite scroll; `feedPageSize` operator config (default 50); `?page=N` shareable |
| B12: per-sub flag-threshold | shipped (M5/B12) | raise-only, floor 3 |
| B13: inline revoke in /modlog | shipped (M5/B13) | actor-only, sub-keys excluded |
| B14: guest comment composer | shipped (M5/B14) | logged-out post page renders the composer; submit stashes `{postPath, body, ts}` in `localStorage` (key `plato:pendingComment`, 24h TTL), opens header login, focuses email; magic-link `return_to` lands user back on the post; `comment.js` autoposts via existing JSON splice. No server schema; comment endpoint still 401s anonymous POSTs. Top-level only — replies still require auth-first. |
| B15: sub description ≤200 chars | shipped (M5/B15) | server-validated in `validateSubDescription`; form `maxlength` mirrors. Closes inflate-every-listing-row vector. |
| B16: `[new]` tag in mod queue | shipped (M5/B16) | `/modlog?mode=open` marks the flagged target's author and each flagger with a muted `[new]` chip when their handle is inside the 7-day new-account window (same window `vote.js` uses for half-weight + comment-vote block). Batch `newAccountHandles(db, handles)` so one indexed query covers the whole page. Highest-signal use: triaging brigades where multiple fresh accounts converge on the same target. |

### Build status (M6)

| Feature | Status | Notes |
|---|---|---|
| B0: memlog (per-user notifications) | shipped (M6/B0) | migration 013 `notifications` table; three kinds (`comment_on_post`, `reply_to_comment`, `mod_action`) — vote events deliberately not recorded. Recipient-only `/memlog` route with same `table.modlog` chrome and `show × kind` filters; click-redirect via `/memlog/go/<id>` marks one read; mark-all-read respects active filter. 90-day lazy-prune on every GET regardless of read-state — bounded retention. Header pseudonym is now a link (accent color, mirroring sub-link affordance) with an unread-count chip. Self-notifications skipped at insert. Owner-only sub-management mod actions (promote/demote/transfer) are not notified — they live in the public modlog where co-mods see them directly. Hash-jump on landing auto-opens any enclosing `<details>` (long-collapsed, score-collapsed, depth-folded) so the user lands on the body, not the summary. |
| B1: memlog activity unification | shipped (M6/B1) | top-level `mode:` axis = `notifications` (default, prior behavior) / `activity` (own posts + comments) / `all` (both merged by created_at desc, capped 200 rows). Mirrors modlog mode pattern (`open / inbox / audit`) so memlog is one personal-log surface. New `listActivityForHandle(db, handle, { kinds, limit, offset })` in `notification.js` UNIONs `posts` + `comments` authored by handle, removed content excluded, shaped to the notification row contract. First column `type` (`ntfy` / `actv`) is the at-a-glance discriminator, especially in `all` mode. Show / kind / mark-all-read chips hidden when `mode=activity`. Activity rows route directly via `memlogTargetLink` (no read-state to mark). |
| polish: mobile responsive | shipped | `@media (max-width: 640px)` block in `style.css`. Header brand + status flex-wraps. Memlog table drops `from`/`where` columns, keeps `type/when/kind/snippet`. Subs index drops `description / subscribers / owner`, keeps `sub / posts / active`. Wide tables generally get `overflow-x: auto` *within their block* — page-level horizontal scroll is eliminated. Filter chip rows wrap. Login popover anchors to viewport edge. |
| chrome enforcement (post-B0) | shipped | every user-facing page goes through `pageView({db, currentHandle, title, subtitle}, body)` or its short-error sugar `quickPage(req, ctx, title, body)`. `title` doubles as the document title and the wordmark replacement in `siteHeader`. Renderers must not call `layout()` or `siteHeader()` directly — both are internal to the helpers. Migration touched ~50 call sites. The rule "every subpage uses the home format with the forum name replaced by the page action" now lives in code, not convention. |
| B2: sub subscriptions | shipped (M6/B2) | migration 014 `subscriptions(user_handle, sub_name, created_at)` composite PK + index on `sub_name`. POST `/sub/<name>/subscribe` idempotent toggle; inline button on the sub-page header (logged-in only). `/subs?filter=mine` filters the directory; subscribers column shows live counts (was a placeholder). Subscriber identities never publicly exposed — only aggregate counts. Disallowed in `robots.txt`. |
| B3: home `subscribed | all` toggle | shipped (M6/B3) | replaces the placeholder chip pair on the home top-nav. `?feed=subscribed` filters posts + comments tabs to authored content from subscribed subs; chip rendered for logged-in only; anonymous + `?feed=subscribed` normalized to `all` so chip URLs stay clean. Logged-in zero-subs renders an empty-state pointing at `/subs`. `listPostsAcrossSubs` / `listRecentCommentsAcrossSubs` gained `subNames` option (null = no restriction; [] = no rows). |
| B4: per-sub Atom feed | shipped (M6/B4) | `/sub/<name>/rss`. Latest 50 posts (newest-first), excluding **both** hard-removed and soft-collapsed (RSS bridges in feed shape, not drama shape). `application/atom+xml`, `Cache-Control: public, max-age=300`. Sub HTML page advertises via `<link rel="alternate">` + a visible `rss` link in the action row. |
| B5: inline subscribe on /subs | shipped (M6/B5) | per-row inline `subscribe`/`unsubscribe` text-link button in the directory (logged-in only); reuses the same POST endpoint and `.subscribe-form`/`.subscribe-btn` styling as the sub-page header button. Makes `/subs` a one-screen subscription manager. |

The deferred items aren't blockers for an unannounced public trial; the shipped layer is enough that an attacker who gets through magic-link → tiered rate limit → link cap → spam regex → URLhaus has already done more work than spamming a typical small instance is worth.

### 1. Magic-link to post

**Criteria**: every first-time post from a new email requires clicking a magic link in the inbox. Subsequent posts in the same browser session use a cookie token that expires after 30 days of inactivity.

**Why it works**: raises the cost of bot spam to "have a working deliverable inbox per identity." Kills the bulk of casual automated spam.

**Source**: no external dependency. Built in.

### 2. Per-account rate limits with new-account scarlet letter

**Criteria**:
- Account age < 24 hours: 1 post/hour, 3 posts/day, 10 comments/day. All posts surface in mod queue with a "new account" tag.
- Account age 1-7 days: 3 posts/hour, 10 posts/day, 30 comments/day.
- Account age > 7 days with no flags upheld: limits removed, normal use.
- Account age > 30 days with positive history: trusted, can pre-empt mod queue.

**Why it works**: most spam comes from accounts created within hours of posting. Treating new accounts with extra scrutiny without blocking them outright catches the volume problem without alienating real new users.

**Owner carve-outs (in own sub only)**:
- **Posts**: per-hour burst-pacing cap is skipped (`checkPostRate(..., { skipHourly: true })`); per-day cap still applies — a fresh owner can burst their daily 3 posts into their own freshly-created sub instead of waiting an hour between each.
- **Comments**: daily cap is **doubled** (10→20 new, 30→60 recent); established stays uncapped — engagement-leading carve-out, not a lift. `checkCommentRate(..., { doubledForOwner: true })`.

Both carve-outs only apply when the actor `canModerate(...) === 'owner'` of the destination sub. The global per-day floors (post + comment) are intentionally preserved so a compromised owner account can't drain the day's quota across the instance. See §3 for the matching per-sub topic-flood carve-out.

**Source**: no external dependency. Account-age timestamps are stored at signup.

### 3. Per-sub rate limits

**Criteria**: rate limits apply per-sub, not just per-account. An account that posts 5 times in 5 different subs is normal; 5 times in 1 sub triggers the per-sub limit (default: 5 posts/day per sub for accounts under 30 days old, 20/day for established).

**Why it works**: catches "topic floods" — a single user spamming one community while looking innocuous globally.

**Owner carve-out**: when the poster owns the destination sub, two caps are lifted — (a) the per-sub topic-flood cap (5/20 by tier) and (b) the global per-hour burst-pacing cap (1/3/established by tier). The global per-day cap (3/10/established by tier) still applies, so the spam-floor defense holds. Topic-flooding a sub you own is a contradiction, and the per-hour burst defense is symbolic friction for an owner seeding their own freshly-created sub. Solves the founder-bootstrap UX: a new owner can burst their daily 3 posts into their own sub immediately instead of waiting an hour between each. Wired in `handleDraft` and `handleFinalize` via `canModerate(...) === 'owner'` plus `checkPostRate(..., { skipHourly: true })`.

**Comment-side carve-out**: when commenting in a sub you own, the daily comment cap is **doubled** (20/60/established by tier) — engagement carve-out for an owner leading discussion in their own sub. The cap is doubled, not lifted: a compromised owner account can't drop unlimited comments. Wired in `handleAddComment` via `checkCommentRate(..., { doubledForOwner: true })`.

**Source**: no external dependency.

### 4. Disposable email domain blocking

**Criteria**: signup attempts from email addresses on a maintained list of disposable / temporary email providers are rejected with a message asking for a real email address.

**Why it works**: most automated spam accounts use disposable email providers (Mailinator, Guerrilla Mail, 10MinuteMail, hundreds of others). Blocking these is one of the highest-leverage spam reductions available.

**Source**: subscribe to a maintained public list. Recommended sources, in order of preference:
- `disposable-email-domains/disposable-email-domains` on GitHub (community-maintained, widely-used, MIT license, updated frequently)
- `ivolo/disposable-email-domains` (older, larger, less actively maintained)
- For commercial-grade detection: Kickbox, ZeroBounce, or similar APIs (paid, not recommended for v1)

**Implemented as**: ship a snapshot of `disposable_email_blocklist.conf` (~5400 domains) at `disposable-domains.txt`. Refresh via `scripts/cron-refresh-disposable.sh` quarterly — the script autoconfigs from `config.json operator.{email,service}`, restarts the service only if the sha256 changed, and emails the operator (success and failure both). Quarterly cadence — not weekly — because the upstream churns slowly and operator email volume should stay low (4/year, not 52). The list is intentionally **not** fetched at runtime so a remote list change can't silently expand the block surface; updates require a deliberate cron run + service restart, both auditable in the operator's inbox. Allow the operator to override (whitelist a domain that's incorrectly flagged).

### 5. Honeypot fields in post forms

**Criteria**: every post and comment form contains 1-2 hidden form fields (CSS `display:none` or off-screen positioning). The fields have plausible-sounding names (`website`, `phone`). If any honeypot field is non-empty on submission, the post is silently dropped — the bot receives a 200 response and never knows it failed.

**Why it works**: most form-spamming bots fill every field they find. Silent drop (rather than error) prevents the bot from learning to avoid the trap.

**Source**: no external dependency. Built in.

### 6. Outbound link cap per post

**Criteria**:
- Account age < 24 hours: 1 link per post maximum.
- Account age 1-7 days: 3 links per post maximum.
- Account age > 7 days: 5 links per post maximum (configurable per sub).
- Posts exceeding the cap: rejected with an error explaining the limit.

Additionally, every URL in every post is checked against a maintained malicious-domain list before the post is accepted. URLs matching a known-bad domain are stripped, and the post is auto-flagged for mod review.

**Why it works**: link spam is the highest-volume fraud vector. Capping links per post and screening the ones that get through catches both shotgun-spam and targeted phishing campaigns.

**Source for malicious domains**, in order of preference:
- **URLhaus** (`urlhaus.abuse.ch`): free, community-maintained, focused on malware-distributing URLs. Provides hourly-updated text and CSV feeds. No API key required for the public feeds. Ideal for v1.
- **PhishTank** (`phishtank.org`): focused on phishing URLs. Free with registration, hourly updates.
- **Spamhaus DBL** (`spamhaus.org`): the canonical domain blocklist. Free for low-volume use, paid above thresholds.

Pull URLhaus's text feed (`https://urlhaus.abuse.ch/downloads/text/`) hourly. Cache locally; check posted URLs against the cache before accepting.

### 7. Flag button (separate from downvote)

**Criteria**:
- Every post and comment has both a downvote button AND a flag button. They are visually distinct and serve different purposes.
- **Downvote** = "I disagree / low quality / off-topic to my taste." Affects sort order. No moderation consequence. No reason required. Free to use.
- **Flag** = "this violates rules / is harmful." Routes the post to mod queue. Requires selecting a category (spam, harassment, illegal content, off-topic-rule-violation, other) and optionally a short explanation.
- 3 flags from distinct accounts (distinct emails AND distinct IP /24 ranges AND each account at least 7 days old) auto-hides the post pending mod review.
- A user whose flags are repeatedly dismissed by mods has their flag weight reduced over time. After 5 dismissed flags in 30 days, their flags become advisory only (don't count toward the auto-hide threshold).

**Why they're separate**:
- Downvote is opinion; flag is rule enforcement. Conflating them creates tyranny-of-majority moderation where unpopular posts get treated as rule violations.
- Different abuse profiles: downvote brigading is a sort-order problem; flag brigading is an attack on moderation itself.
- Different friction by design: downvote is one click; flag requires choosing a reason. The friction itself is the design.
- Reddit's history shows what happens when these collapse together: subs end up auto-removing posts below downvote thresholds, which means the community's dislike becomes the moderation rule. Worth avoiding from day one.

**Source**: no external dependency. Built in.

### 8. Velocity alerts to mods

**Criteria**: a per-sub dashboard shows mods:
- Posts per hour, comments per hour, signups per hour. Spikes above 3x the rolling 7-day average trigger an in-dashboard alert.
- Posts originating from the same /24 IP subnet within a short window (5+ posts from one /24 in 1 hour) trigger an alert.
- Posts from accounts created in the last 24 hours, surfaced as a queue.

**Why it works**: coordinated attacks (raids, brigades, spam waves) almost always show up as velocity anomalies before they show up as flags. Catching them at the velocity stage shortens response time from hours to minutes.

**Source**: no external dependency. Built from server logs.

### 9. Spam pattern file

**Criteria**: each instance maintains a version-controlled file (`spam-patterns.txt`) of regex patterns for known spam phrases, formats, and clusters. Posts matching any pattern auto-hide pending mod review. Mods append new patterns as they encounter new spam waves.

The default file ships with conservative starter patterns:
- Cryptocurrency scam phrasings ("guaranteed returns", "double your investment in 24 hours", common wallet-address formats with "send to")
- Fake-job-offer language ("work from home $5000/week", common scam recruiter phrasings)
- Wire-fraud language ("Western Union", "MoneyGram", "wire transfer only")
- Romance-scam openers (a small set of well-documented openers from the community-maintained scammer-language databases)
- Phone-number-with-asking-to-text patterns

**Why it works**: regex catches things Bayesian filters miss because spammers reuse exact phrasings across campaigns. Unglamorous, version-controlled, transparent (the file is reviewable), and trivial to maintain.

**Source**: ship a starter file. Operators add to it. Optionally, instances can subscribe to a community-maintained pattern file (similar to spam blocklists for email) — but make this opt-in.

### 10. Bayesian content filter

**Criteria**: trained on each sub's removal history (posts that mods removed = spam-class; posts that survived 30 days = ham-class). Posts above a confidence threshold are suggested for mod review (NOT auto-blocked — humans decide). Threshold tunable per sub.

**Why it works**: catches novel spam that doesn't match regex patterns yet, by recognizing distributional patterns in the text.

**Source**: standard library implementation. SpamAssassin-style. No external service.

### 11. Hashcash on first post

**Criteria**: before the very first post from a new account is accepted, the user's browser does a small proof-of-work computation (target: ~2 seconds of compute on a normal device). Subsequent posts skip this step.

**Why it works**: invisible to humans (browsers do compute fast and the user is reading the post-success page anyway), expensive at bot scale (a spam farm that wants to create 10,000 accounts pays 10,000 × 2 seconds of compute per posting domain).

**Source**: standard JavaScript implementations of Hashcash exist; pick one with no dependencies.

### 12. Ban evasion correlation

**Criteria**: when an account is banned (sub-level or instance-level), the system records the email HMAC, IP /24, browser user-agent, and posting time-of-day distribution. New signups within 30 days that match 2+ of these dimensions are flagged for mod review (not auto-blocked).

**Why it works**: most ban evaders are not sophisticated. Same ISP, same browser, same posting hours, slightly different email — easily caught.

**Source**: no external dependency. Built from existing logs.

### 13. No DMs in v1

**Criteria**: no direct messages between users in v1. (Already documented in *What's out of v1*.)

**Why it works**: removes the entire "scammer messages user privately" attack surface. The vast majority of romance scams, fraud schemes, and harassment campaigns rely on private channels. No private channels = no attack surface.

**Source**: design choice. Built in.

### 14. No media hosting

**Criteria**: text-only posts with linked media. (Already documented in *Content Model*.)

**Why it works**: removes duplicate-image fraud, CSAM scanning obligations, malware-via-image-format vectors, image-based phishing, and copyright takedown overhead. The single largest security win available.

**Source**: design choice. Built in.

### 15. Public mod log

**Criteria**: every mod action (collapse, remove, ban) is logged to a public page with mod pseudonym, action, target, reason, and timestamp. (Already documented in *Moderation*.)

**Why it works**: discourages mod abuse (the whole community sees the patterns), gives users evidence when forking is needed, and lets users calibrate trust in a sub's moderation before joining.

**Source**: design choice. Built in.

### Combined effect

These rules are multiplicative. Most automated attackers don't get past three of them; very few get past six. The cost of building all 15 is small (most are tens to hundreds of lines of code each, plus subscribing to two public feeds). The maintenance is light: weekly cron pull of the disposable-email and malicious-URL lists, occasional regex additions to the spam pattern file, and mod attention to the velocity dashboard.

What these rules *don't* solve: the determined human attacker with patience. That's an ineliminable cost of running any community. The answer is human moderators with discretion, the public mod log to keep them honest, and the cheap-exit fork mechanism for when the moderators themselves go bad. Don't promise users protection from determined human malice. Promise them a place where most of the noise is filtered out and the rest is handled by humans who can be replaced if they fail.

## Technical Stack

Boring and proven. No exotic protocols.

- **Backend**: Go or Python (whichever the maintainer prefers; reference impl in Go for single-binary deploy).
- **Database**: PostgreSQL (multi-instance) or SQLite (single-instance hosting).
- **Web server**: Caddy (auto-TLS) in front of the app.
- **Email in**: Postfix or a hosted relay (SES, Postmark, etc.) handling inbound DKIM verification.
- **Email out**: same; DKIM-signed outbound.
- **Storage**: posts as markdown files in a per-sub git repo. Database is an index over the files, regenerable from the repo.
- **Cryptography**: HMAC-SHA256 for deriving pseudonym IDs from email under a server-wide secret (same shape as addypin's salt). One server-side Ed25519 keypair for signing archive exports. No per-user keys. See Identity Model.
- **Timestamping**: OpenTimestamps anchored daily.

## Identity Model

**One mechanism, one secret: salted HMAC of the email.** Same shape as addypin and gitdone.

The server holds a single master secret. From that secret plus the user's email, the pseudonym ID is derived deterministically:

```
pseudonym_id = base32(HMAC(master_secret, email))[:16]
```

Same email always produces the same pseudonym ID. Nothing per-user is stored as a secret. The server holds one secret (same shape as addypin's salt) and re-derives identity on demand.

How it works in practice:

- **First-time user**: types email, gets a magic link, clicks it. The server derives their pseudonym ID. They pick a display name (the human-readable label attached to their ID). They post.
- **Returning user**: types email, gets a magic link, clicks it. Same derivation runs again. Same pseudonym, attached to their full post history. No password, no key file, no recovery flow.
- **Posts via email**: inbound emails are DKIM-verified. The originating address must match the registered email for the pseudonym (after HMAC). DKIM provides genuinely portable, third-party-verifiable proof that the post came from the claimed domain.
- **Posts via web**: authenticated by the magic-link session. Standard, mature, no keys.
- **Forking / moving instances**: the new instance has a different master secret, so re-registering the same email produces a *different* pseudonym ID. **This is intentional and locked.** Identity does not travel across instances; history does. On import (M7), archived posts and comments retain their origin-instance pseudonym strings as static attribution labels — they are not re-derived under the new secret and there is no "claim my old handle" flow. The user's new pseudonym on the new instance starts fresh. Same person, new label, full history visible as archive content.
- **Casual users**: re-register on the new instance with the same email; the import attaches archived authorship as origin-instance labels; the user posts forward under their new pseudonym.

Cross-instance identity is *deliberately not portable*. A user's pseudonym on Forum A is unrelated to their pseudonym on Forum B because the master secrets differ, and no claim-back mechanism bridges them. This keeps the email a non-trackable key across forks (the privacy property) and keeps the about-page promise *"leaving is a fresh start, not a sticky identity transplant"* honest (the social property). See *Permanently out* for the lock.

### Why we are not signing posts

We considered signing each post with a deterministic Ed25519 keypair derived from the same HMAC. We rejected it. The reasoning:

- **No consumer.** Nothing in the current design verifies per-post signatures. Posts render from the database. Forks rely on email re-claim, not signature chains. Adding signatures with no consumer is dead code.
- **Bad security property.** With a server-derived key, the server can forge any user's posts at any time. The signatures would *appear* to prove user authorship while actually proving only "the master key signed this." That's a misleading guarantee — worse than no guarantee, because it invites trust that isn't earned.
- **Feature creep.** Signed posts invite "verified user" badges, cross-instance identity portability without email, signed-vote chains, federation primitives. None of those are in scope. None should be. The substrate for them shouldn't exist.
- **The threats are already handled.** DKIM authenticates email-submitted posts, third-party-verifiable. Magic-link sessions authenticate web-submitted posts. Both are mature, both are sufficient for the threat model this product actually defends against.

### What about archive integrity?

Tamper-evidence at the *archive* level (not per-post) is useful and honest. On export, the server signs the archive as a whole with a single Ed25519 public key it publishes. This proves "this archive was produced by this server" — a claim the server actually can back up. It does not claim per-user authorship.

A forked instance that imports the archive can verify "this came from the original server unmodified." That's the real, achievable property. OpenTimestamps anchor the archive periodically for additional tamper-evidence.

### What we're NOT building on

- **Not AT Protocol.** Active dependency on Bluesky's roadmap, microblog-shaped primitives, relay layer is operationally one company today. Forum semantics don't fit cleanly into AT's lexicons.
- **Not Nostr.** We considered borrowing Nostr's pubkey-as-identity model and rejected it. Without per-user key holding, the cryptography would be theatre. With per-user key holding, the UX collapses for non-technical users. Either way it's wrong for this product.
- **Not NNTP/Usenet.** Dead ecosystem, no signing layer, 40 years of accumulated crud.
- **Not ActivityPub.** Federation is out of scope for v1; if added, probably in a Usenet-style pull model rather than ActivityPub's push model.
- **Not PGP/age for user auth.** PGP is too heavy for non-technical users; age is encryption-only, not signatures.

The substrate is: email + DKIM + magic-link sessions + HMAC for pseudonyms + a single server-side Ed25519 keypair for archive signing + OpenTimestamps + git for storage. Every component is mature, open, not owned by anyone, and will still work in 30 years.

## Federation (Future / Optional)

v1 is single-instance. Federation is a v2 question, not v1.

If/when federated:

- Instances pull from each other (Usenet-shaped), not push (ActivityPub-shaped). Servers subscribe to subs from other servers; new posts replicate when polled.
- Votes count instance-locally (or aggregate by mutual trust between known-good instances).
- Each instance applies its own mod rules to incoming federated content.
- Identity remains per-instance — federated content keeps its origin-instance pseudonym as a static attribution label, with no cross-instance claim path. The non-portability lock from *Identity Model* holds in a federated world too: the master-secret-per-instance property is what keeps email from becoming a cross-forum tracking key, and federation must not break that.

Not building this in v1 because most communities don't need it and it triples the protocol surface.

## Export Format

Two separate exports: **per-sub** (for forking a community) and **per-user** (for migrating an individual). Both one-command.

### Per-sub export (community fork)

```
sub-export/
  sub.json              # name, description, owners, mod log
  posts/
    2026-01-15-abc123.md  # frontmatter + markdown body
    2026-01-15-abc123.meta.json  # timestamps, votes, pseudonym ID
    ...
  comments/
    2026-01-15-abc123/
      def456.md
      def456.meta.json
      ...
  members/
    pseudonyms.json     # pseudonym → opt-in re-invite email
  moderation/
    log.json            # all mod actions, public
    rules.md            # current rules
  archive.sig           # Ed25519 signature over the archive contents
  server-pubkey.pem     # the public key the archive is signed against
  archive.ots           # OpenTimestamps proof for archive.sig
```

Importable into a fresh instance with `forum import-sub sub-export/`. The new instance verifies `archive.sig` against `server-pubkey.pem` (which the original server publishes at a stable URL) to confirm the archive came from the original host unmodified.

### Per-user export (individual migration)

```
user-export/
  profile.json          # display name, account-age timestamp, bio
  subscriptions.json    # list of subscribed subs (with original instance URLs)
  posts.json            # references to all posts authored, by sub
  comments.json         # references to all comments authored, by sub
  mod-log.json          # mod actions taken against this account, last 90 days
```

Importable into any instance with `forum import-user user-export/`. The new instance:
- Creates the same display name (or suggests an alternative if taken).
- Re-establishes the subscription list — for subs hosted on the new instance, subscribes directly; for subs on other instances, stores them as external bookmarks the user can RSS-subscribe to.
- Carries forward the account-age timestamp so the user doesn't lose their tenure on migration.

## What's in v1

- Single instance, no federation
- Subs, posts, comments, voting, sorting
- Magic-link auth, three email subscription modes
- Sub subscriptions (private, exportable, pull-only: none / per-sub RSS / personal aggregated RSS at `/u/<token>/rss`)
- Front page with active subs + recent posts (chronological, 2/sub cap); "my subs" page for subscribed users
- User display: account age bucket, sub tenure, per-post score, mod-confirmed removal history (90 days). No karma, no flag counts, no leaderboards.
- Two-tier moderation with public log
- Spam and abuse defenses: 15-rule layered system (magic-link, rate limits, disposable email blocking, honeypots, link caps, flag system, velocity alerts, regex patterns, Bayesian filter, hashcash, ban-evasion correlation). See *Anti-Abuse* section.
- One-command per-sub export and per-user export
- Self-hostable docker-compose, plus reference hosted version
- Search (Postgres full-text)
- Dark mode, mobile-responsive web
- RSS feed per sub (subscribable in any standard reader)

## What's explicitly out of v1

- Direct messages
- Following users (only sub subscriptions are allowed)
- Karma / reputation scores
- Federation
- Mobile apps (web works on mobile)
- Push notifications (email digests only)
- Custom themes per sub
- AI-assisted moderation
- **Light-mode auto-toggle (deferred to M8 polish, not v1).** The `@media (prefers-color-scheme: light)` block — auto-flip palette based on user OS preference — ships with M8 (`build-plan.md:22, 251`). The user-facing toggle isn't ready until the dark palette has shipped to real users and the light palette can be designed against actual usage signals.

  However: **fork-customizable colors are a v1 requirement.** The "if mod goes bad, fork the archive" PRD principle extends to brand. Forks need to rebrand without grepping the codebase — a different operator name, a different accent, a different mood. Every color in `src/web/static/style.css` lives as a `--*` variable on `:root` from now on, with role-named tokens (`--accent`, `--accent-warm`, `--bg`, `--bg-soft`, etc.). Forks override only those variable values; structure stays intact. Inline SVGs (the logo mark) reference the same variables via `currentColor` or `var(--*)` so the brand follows. The one exception is `favicon.svg` (served standalone, can't reach CSS variables) — forks copy and recolor that one file. M8 then ships light-mode auto-toggle as a single `@media` block addition, not a codebase audit.

## Permanently out (not a v1 limitation, a design choice)

- Hosted media (images, videos, files). Links only. See Content Model.
- Inline embeds, link previews, auto-rendered video players.
- Following users. Sub subscriptions are allowed; user-following is not.
- Public follower / subscriber lists.
- Algorithmic feed of any kind.
- Engagement metrics surfaced to users (no view counts, no time-on-page).
- **Hashtags / user-created tags.** Tagging is voluntary, inconsistent, and creates a parallel taxonomy that competes with subs. The "subs are universes" model breaks if `#laptop` exists in five subs. Search (M8 FTS5) covers the discovery need that hashtags would have served. Sub owners get **per-sub flairs** (curated, closed list — see M5 in build-plan.md) as the structured-categorization escape valve. Flairs are removable; tags would not be.
- **Private subs (membership-gated read access).** Inverts every load-bearing forum claim: lives at one URL (no longer browseable), public mod log (invisible to non-members), fork-the-archive (members-only export). Also a moderation blind spot — abuse compounds in private spaces because random readers can't report. The WhatsApp-/mailing-list-replacement opportunity is real but is a separate product (different UX shape: real-time vs canonical, room vs sub) and would need its own PRD. Not a flag on existing subs.
- **Age verification / ID checks.** Operator-layer concern, not forum feature. Forum exposes a per-sub `sensitive` flag (M5/B11) as a generic content advisory; if a jurisdiction requires age gates, the operator runs them in a reverse proxy or content gateway in front of the forum. Forum never sees IDs.
- **NSFW labeling.** Plato uses a generic `sensitive` flag (M5/B11), not "NSFW." Reason: plato's default community rules ban porn, so labeling something "NSFW" in a porn-banned forum invites the very content the rules forbid. `sensitive` is the operator/community-defined catch-all (graphic violence, abuse discussions, intense political topics, suicide/eating-disorder threads, etc.). A fork that wants to allow porn can rename/repurpose the flag — that's a fork concern, not plato's.
- **Filter to hide sensitive content from the main feed (per-user *or* operator default).** Neither variant ships. Per-user case: the `[!]` badge is the entire UX contract — an honest signal, not a gate. A "hide sensitive" toggle quietly redefines the badge as a pre-gate warning and edges toward the curation-layer culture that *no algorithmic feed* and *no NSFW age verification* both refuse. The personalization knob already exists: don't subscribe to sensitive subs and use the home `subscribed` view. Operator-default-hide case is worse: a sub visible only to viewers who know the toggle exists is a private sub by another name, which *Private subs (membership-gated read access)* already locks out — the toggle would re-introduce membership-gated read state through a config flag instead of an auth check. If a jurisdiction or workplace context genuinely requires sensitive content to be hidden by default, that belongs in the operator's reverse proxy or content gateway (same layer as age verification), not in the forum. Revisiting either variant is a fork, not a feature.
- **Cross-instance identity portability.** A user moving to a new instance gets a new pseudonym, derived under the new instance's master secret. History is portable via M7 archive export/import; identity is not. Reason: per-instance HMAC of email is the entire identity mechanism, and the per-instance master secret is precisely what makes the same email yield different pseudonyms across forks. Building any "claim my old pseudonym on the new instance" path (signed handle export, federation primitive, email→pseudonym mapping in the archive, magic-link reclaim flow — all considered, all rejected) re-introduces the cross-forum tracking key the HMAC design refuses, and turns the social property *"leaving is a fresh start"* into a lie. Old pseudonyms travel with the archive as static attribution labels, never as claimable accounts. See *Identity Model → Forking / moving instances*.
- **Email digests / "email me when X happens" of any kind.** Plato's only outbound email is the magic-link auth flow via knowless. Adding a digest channel would require either plato persisting plaintext addresses (breaks the auth-layer "never stored" lock) or coupling to a knowless email-retention feature; either path drags scheduler, cadence config, opt-out tokens, footer rendering, bounce handling, and operator deliverability burden into a forum that explicitly rejects urgency engineering ("come back when it itches"). Pull-shape RSS — per-sub at `/sub/<name>/rss` and personal aggregated at `/u/<token>/rss` — covers the same ground without any of that surface. Revisiting this is a fork, not a feature.
- **Push notifications of any kind** (ntfy, web push, browser push, native push). Same urgency-engineering objection as email digests. ntfy specifically: self-hosted ntfy can't deliver real iOS push (Apple's APNs gate routes only via `ntfy.sh`), so the experience would silently work on Android and feel broken on iOS — a platform-skew support cost too large for a hobby-scale forum. Web push adds a permission-prompt friction surface and a cryptographic-key store. The forum is not the senate; nothing here is time-sensitive enough to justify any push channel.
- **Operator-configurable typeface.** The body font (`'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace` at `style.css:62`) is locked. Mono-by-default is part of plato's voice — terminal-honest, scannable, line-aligned. Offering a serif/sans preset dilutes the identity for a feature nobody's asked for; an open-ended `fontStack` config string invites a typography decision operators didn't ask to make. Operators who actually want a different typeface fork the CSS — same path as the logo and the literal "plato" footer attribution. Same precedent as HN, lobste.rs, old.reddit (locked) vs Discourse/Lemmy (theme systems with strong defaults). Revisit only if a real operator pushes back; do not pre-build presets.
- **Sub rename.** Sub names are immutable after creation. URLs, RSS feeds, archive scope keys, modlog cross-references, and (eventually) third-party links would all break or have to ship with a redirect layer that's pure tech debt. The `subs.name` column is the natural primary key for a reason. If a sub's framing changes, edit the description (which is mutable along with sensitive flag, flairs, thresholds, and default sort — those are the only mutable fields on a sub). Otherwise create a new sub.
- **More than two sub states.** Subs are either *active* or *read-only*. There is no archived, restricted, private, quarantined, closed, hidden, or unlisted state. Reddit-shaped state proliferation served Reddit-shaped problems (vote brigading on years-old posts, sitewide topic gating). plato is hobby-scale; those problems don't exist here, and adding states for them pre-builds tooling for failure modes we have not seen. The two-state model covers every shape we've validated: active is the normal life of a sub; read-only is the honest transition out of being moderated, whether by step-down or 30-day auto-disable. See *Sub Lifecycle*.
- **"Close my sub" affordance for owners.** No button to unilaterally lock a sub on demand. The only paths to read-only are (a) step-down with no co-mods, or (b) 30-day inactivity auto-disable. Both require *not moderating* over time. A unilateral close button lets a single mod silence a community their co-mods may still want to use; once delegated, the community has its own life. To leave, step down to a co-mod (transfer-on-step-down) or stop showing up (the sub auto-disables in 30 days). Don't burn it down on the way out.
- **Auto-archive on post age.** No "posts older than N months are frozen against new comments." This was a Reddit defense against vote-brigading on resurfaced old threads at scale. plato will not have that scale or that problem; pre-building the freeze mechanism solves nothing and adds state to track. A 5-year-old post getting a single new comment is normal hobby-forum behavior, not an attack pattern.
- **Operator authority over sub-level governance.** Operators do not assign mods, do not reactivate read-only subs, do not rename subs, do not arbitrate sub disputes. The operator runs the *instance* (uptime, backups, branding, spam-knob tightening); the *community* runs itself or fails to. This is a cultural lock — technically the operator has DB access and can override anything (this is true of every self-hosted forum), but the design does not put the operator in the loop for community decisions, does not give them an admin UI surface to do so, and does not document recipes for sub-reassignment-via-SQL. The escape hatch when a community disagrees with a mod is *forking the sub* — members create a new sub and migrate during the warning window or after the original goes read-only. This refusal is the load-bearing defense against operator-coercion-via-authority: a lawful order to install a chosen mod has no admin path in plato to attach to. Operators who do override at the DB layer in defiance of this posture are forking; users who don't trust them fork further.
- **Fan-out push notifications on flag arrival.** Mods share a single queue of pending actions, visible to everyone with mod role on the sub. The first mod to act records the row. There is no per-mod memlog ping when a flag arrives, and no role badge ("mod" / "co-mod") rendered next to actions in the modlog — pseudonym is the actor identity, role at-time-of-action is intentionally not denormalized. Adding fan-out adds plumbing without changing the trust model; the shared queue is the channel.
- **Self-flag.** A user cannot flag their own post or comment. The flag affordance is hidden in render and `submitFlag` rejects the call defensively if it leaks through. Self-flag has no legitimate use — authors edit or delete their own content directly — and accepting it would only pollute the audit trail and give a single user a way to inflate the distinct-flagger count on their own thread. The same defensive posture as self-ban (already locked at the mod layer).
- **Subscribe / unsubscribe toggle for mods on subs they moderate.** Mod role implies subscribership: `createSub` auto-subscribes the owner, `transfer_owner` re-establishes the subscription for the new owner, and the `/sub/<name>` action row hides the subscribe / unsubscribe button when the current user has any mod role on that sub. Reason: mod role is a stickier relationship than subscription (mod sees flag queue, must monitor activity, gets the modlog header chip), and unsubscribing while modding would just remove the sub from the feed they need to be watching anyway. Subscriptions remain personal-preference-toggleable for non-mod users — that lock (PRD §Sub subscription mechanics) is unchanged. The exception is narrow: only mods of *the sub being viewed* lose the toggle; everywhere else, subscription is the same per-user bit.

## Needs further discussion (parked, not decided)

- **Unlisted subs (obscurity, not privacy).** Toggle that hides a sub from /home, /sub directory, search index, and robots.txt — but keeps `/sub/<name>` URL-readable, mod log public, no membership table. Use cases: book clubs, neighborhood councils, niche hobbies that don't want to be discovered casually. Risk surface: lower than private subs (no auth changes in read path; mod log + flag still work; operator dashboard sees everything), but non-zero — slower spontaneous abuse detection because random readers don't stumble across it, and users may misunderstand "unlisted" as "private" and over-share. Hard NO on adding a membership table — that's the trapdoor to private subs through the side door. Open question: does the obscurity-not-privacy distinction hold up in practice, or does it confuse users badly enough to be net-negative? Revisit before M5.

## Success Criteria

- A small group (10-50 people) can move off Discord and not regret it within a month.
- One technical operator can host a sub for 1000 users on a $5/month VPS.
- A community can fork off a bad mod with a working archive in under an hour.
- Spam stays under 1% of total posts with default settings.
- The product description fits in one tweet: *"A forum that lives at one URL. Magic-link to post. Search and read on the web. Owner moderates; mod actions are public; if it goes bad, fork the archive."*

## Public-trial readiness

The first public deployment is a **demonstration of the architecture**, not a permanent home. The domain plato runs at on day one is interchangeable; the software is the product. Three rules govern launch:

- **Two-name framing.** The software is *plato*. The site is whatever URL it happens to live at this week. Tagline copy and footer line reinforce the split: *"plato — running at terribic.com today, your fork tomorrow."* The impermanence of the domain is the message, not an accident.
- **Two instances on day one, even if the second one is empty.** Hosting at exactly one URL collapses the message back to "this is a forum at this URL," which is what every other platform also says. A second running instance — even with three posts and no users — is the structural proof that the domain is chrome and the software is the product. Set up before announcing the first.
- **M5 closes before public trial.** Per-sub flag-threshold override, rate limits, link-cap with URLhaus, regex spam patterns, mod flag-queue UI, per-sub flairs, sensitive-content banner, my-mod-decisions panel. Without these, day-one public traffic surfaces problems the UI can't yet handle. M4 made plato safe for an invited beta; M5 makes it safe for an unannounced URL on the open web.

---

# Other Old-Web Things Worth Rebuilding

These didn't make this PRD because the conversation focused on the forum, but they sit in the same family and would compose with plato if built. Listed in rough order of leverage.

## Personal homepage as a service

Domain + static site + RSS feed + Webmentions inbox + bookmark publishing, all in one opinionated bundle. One-click setup. Real ownable HTML on a domain you control. Replaces LinkedIn, link-in-bio services, Substack for writers who don't want to be locked in. The keystone for everything else — without personal sites, RSS has nothing to subscribe to and the open web has no addresses.

## Public bookmark federation

Anyone publishes a `bookmarks.json` at a known location on their site. A search service crawls these files and lets you search across the bookmarks of people whose taste you trust. Trust attaches to the *file*, not the *person* — no follower count, no faces, no social trap. Cold-start is solved by ingesting GitHub awesome-lists, Pinboard archives, HN submissions as existing bookmark corpora. A genuine alternative to googling-for-anything as Google fills with AI slop.

## Webmentions made trivial

The W3C federated comment standard is real and works but the on-ramp is developer-shaped. A hosted service that any blog or static site can drop in, handling spam filtering and storage, with no server config required. Brings cross-site conversation back to the open web. Composes with the personal-homepage product.

## Mailing-list-as-archive (technical communities only)

A pure mailing list with great web archive and search, aimed at technical communities that don't want a forum (kernel devs, IETF-style working groups). Smaller market than the forum but the existing tooling (mailman 3, sourcehut lists) is grim. Probably not worth a separate product unless someone in that world specifically wants it — the forum's firehose-email mode covers most needs.

## Verifiable physical actions (gitdone v2)

Already discussed at length. Package handoffs, walkthroughs, repair drop-offs, donation chains. Same gitdone substrate plus media + location + proximity in step payloads. Sibling product to gitdone, not a separate codebase.

## Time-locked / deadman release

Send something to your future self or to specific people, automatically, even if you're not around. Encrypted payload + check-in cadence + auto-release. Composes with gitdone's signing and timestamping. The current alternatives (Google Inactive Account Manager, sketchy SaaS) all require trusting a company to still exist when you need it.

## Mutual signed receipts

For informal agreements, lent items, verbal deals, freelance milestones. Two parties exchange a signed timestamped acknowledgment by email. No platform. Useful for everyone who's been screwed by a handshake deal. Already 80% of what gitdone does — needs a one-page front-end that pre-fills the right fields.

## Consent receipts

For likeness, quotes, recordings, content use. Same primitive as mutual receipts, different fields. Especially useful for journalists, podcasters, photographers. Genuinely unsolved despite being a recurring pain point.

---

# Pattern Across Everything

The unifying frame for this entire family of work:

> Protocols, not platforms. Plain files, not databases someone else owns. Cryptographic verification, not platform vouching. Email and HTTP as the universal substrate. Cheap exit as the real check on power. Defaults that are durable rather than slick.

Everything in this PRD and in the follow-up list shares that DNA. They're not a coordinated suite — each is independently useful — but a user who adopts several of them ends up with a complete substitute for most of what platforms currently mediate.

The bet isn't that everyone will adopt these. It's that the people who do will be better off, and the people who watch them will gradually realize the platforms aren't required.
