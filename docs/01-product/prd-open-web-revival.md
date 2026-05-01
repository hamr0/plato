# PRD: Open Web Revival — Two Products

A coordinated rebuild of two pieces of the pre-platform internet that still work and now matter more than they did in 2005: a **forum** and a **feed reader**. Both shipped as forkable repos with one-command deploy, both no-account, both gitdone-shaped (signed, timestamped, exportable, no platform owns your data).

The shared thesis: the open web's failures were never technical. The protocols still work. What died was the on-ramp and the defaults. These products restore both, with 2026 UX expectations baked in.

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
- **Notifications are opt-in, per-source, and never the default.** Email digests and ntfy push are available where they fit, but the default for both products is *the user visits when they want*. No urgency engineering, no "you have 5 unread," no push-by-default. Notifications are a convenience the user explicitly turns on for specific sources, not a behavior the platform pushes onto them.
- **Self-hostable in five minutes.** One docker-compose command or equivalent. Hosted version available for non-technical operators, with one-click migration in either direction.
- **Boring, mature dependencies.** PostgreSQL, SQLite, Caddy, standard libraries. No chasing the new shiny. External services (ntfy, malicious-URL feeds, disposable-email lists) are opt-in transports, never required.

---

# Product 1: Forum

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

**Recent posts (last 24h, chronological)**: a stream of posts from any sub on the instance, newest first, capped at 2 posts per sub so one busy sub doesn't drown out everything else. Shows time, sub, title, score.

That's the home page. Two lists, both chronological, both deduped sensibly. No "for you," no algorithm, no ranking magic.

### The "my subs" page (logged-in users with subscriptions)

A logged-in user who has subscribed to one or more subs sees an additional surface: **My Subs** — recent posts from their subscribed subs, chronological, max 2 per sub, last 24-48 hours.

Same dedup rule as the home page. No algorithm. No "you might also like." If you're subscribed to 5 subs, you see those 5 subs' recent activity. That's it.

A user with no subscriptions sees only the regular home page. No empty-state pressure to subscribe.

### The sub page

Clicking a sub takes you to its posts. The user picks a sort order: **hot** (vote velocity), **new** (chronological), **top** (all-time votes), **old** (oldest first). The default is whatever the sub's mods set.

Hot is offered *within* a sub because that's where users want to see what their community is engaging with right now. It's not offered on the home page or the my-subs page because at those layers, chronological with per-sub dedup is dumber and harder to game.

### Why time-based ranking with per-sub caps

The simplest possible version that doesn't break:

- **Easy to reason about.** "Posted in the last 24 hours, newest first, max 2 per sub" is one sentence. There are no tuning constants.
- **Hard to game.** No magic numbers, no decay function, no early-vote concentration to exploit.
- **Doesn't hide slow-burn content.** A thoughtful post that accumulates votes over 3 days isn't punished by an algorithm that thinks it's "old."
- **Doesn't create a single point of optimization.** Hot ranking on the home page would mean every poster optimizes for hot. Chronological removes that target.

The downside — a noisy sub dominating — is killed by the per-sub cap. If layering in a vote weighting later becomes necessary, that's a v2 conversation. v1 stays dumb on purpose.

### Sub subscription mechanics

- One click from any sub page to subscribe or unsubscribe.
- Subscriptions are **private**. Nobody can see who's subscribed to what. No "followers of this sub" page. Member counts can be displayed (they're a fact of the sub existing), but no leaderboard of who-subscribes-where.
- **Notification modes** (per-sub, user choice):
  - **None (default)**: subscribe silently. Posts appear on the My Subs page when the user visits.
  - **Email digest**: daily or weekly summary of new posts in subscribed subs.
  - **ntfy push**: real-time phone notification when a new post hits the sub. The user provides their own ntfy topic URL (see *ntfy integration* below). Useful for time-sensitive subs (classifieds, local emergencies, job postings) where a daily digest is too slow.
- Subscription lists are **exportable** as part of user profile data. If the user forks to a new instance, they bring their list and can re-subscribe in one click.

### ntfy integration

[ntfy](https://ntfy.sh) is a generic HTTP-based push notification service: subscribe to a topic URL with the ntfy phone app, anyone (or anything) that can `curl` to that URL pushes notifications to your phone. No accounts on either side. Self-hostable. Open source.

The forum supports ntfy as an opt-in notification channel:

- **The user provides their own topic URL.** They install the ntfy app, pick a private-ish topic name (`https://ntfy.sh/my-forum-pings-x9k2-q7p4`), and paste that URL into the forum's notification settings per-sub. The forum doesn't operate ntfy infrastructure or assign topics — the user owns that side.
- **The forum's only job is one HTTP POST per notification.** When a new post hits a sub the user has marked for ntfy push, the forum POSTs the title and a click-back URL to the user's topic. That's the entire integration. No ntfy SDK, no library, one `curl`-equivalent call.
- **Self-hosted ntfy is fully supported.** Users (or instance operators) can point at their own ntfy server. The forum doesn't care which.
- **No state beyond the user's preference.** If ntfy.sh (or the user's chosen ntfy host) disappears tomorrow, the forum keeps working; the user just doesn't get phone pushes.

ntfy is **never the default** and **never used for sensitive content**. Email remains the floor for anything that must reach the user (account events, mod notifications, magic links, password-equivalent flows). ntfy is opt-in convenience for "something I care about happened in this sub."

### Per-sub RSS

Every sub publishes an RSS feed at `/sub/<name>/feed.xml`. This composes with the reader product (Product 2) — a user can subscribe to forum subs in their RSS reader alongside blogs, newsletters, and watched URLs. The "follow a sub" mechanism inside the forum and the "subscribe via RSS" mechanism outside the forum coexist; users pick whichever fits their workflow.

This is the clean composition of the two products: the forum's job ends at "publish RSS for each sub"; the reader picks up from there if the user wants cross-source aggregation. Most users will use sub subscriptions for the forum and RSS for everything else. Power users can do either. Both work.

## Authentication Flow

1. User clicks "Reply" or "Post" on the web.
2. Form asks for email + content.
3. User submits. Server emails a one-time link.
4. User clicks link within 24h. Post goes live, signed.
5. Browser stores a token (cookie or local) so subsequent posts in the same session don't require re-clicking.
6. Token expires after 30 days of inactivity. Magic-link required again.

For repeat users, posting feels almost as fast as logged-in posting. For first-timers, it's two clicks more than a session-based platform.

## Email-as-Transport (Optional Mode)

A user can also subscribe to a sub by email. Three modes:

- **Web-only** (default): no emails, visit the web to read.
- **Digest**: one email per day with thread roundup.
- **Firehose**: every post and reply as a separate email. Reply-by-email works (parsed and threaded into the web view).

Replies-by-email are DKIM-verified before posting. Originating address must match the registered email for the pseudonym.

## Moderation

Two-tier system, both visible to users.

### Tier 1: Collapse (soft moderation)

- Mod marks a post or comment as "hidden."
- It appears collapsed in the thread with a one-line reason ("off-topic," "low quality," "rule 3," etc.).
- Any reader can click to expand.
- Vote tallies still show.
- Used for: opinions the mod disagrees with, off-topic posts, low-effort content, mild rule violations.

### Tier 2: Remove (hard moderation)

- Post is removed from the thread entirely.
- Listed in a public moderation log page with reason and timestamp.
- Original content viewable only via the log (or not at all for protocol-blocked content).
- Used for: targeted harassment, doxxing, illegal content, deliberate harm.

### Mod structure

- Each sub has one **owner** (the email that created it).
- Owner can appoint **co-mods** (any number).
- Owner can transfer ownership.
- Co-mods can be promoted to owner only by current owner.
- All mod actions are logged with the mod's pseudonym and reason.

### Protocol-level hard blocks

A small, conservative set of content is rejected at the relay before it reaches mods: known CSAM hashes (PhotoDNA), confirmed malware URLs, doxxing patterns matching reported targets. These blocks are versioned and publicly documented. No moderator can override; no moderator can opt in to allow them.

### Exit as the real check

If a community decides the mod is bad, the export-and-fork mechanism is the answer. Any member can export the full sub archive (all posts, all comments, all metadata, member pseudonym list with their consent). A new instance can be spun up with the same archive in one command. Members who want to follow re-subscribe with their email. Old instance keeps running for whoever wants to stay.

This is not theoretical. The export must be one-click and complete, tested before launch, documented in user-facing copy. Without working exit, all the other moderation talk is decoration.

## Spam Defenses

Layered, all standard practice. Each rule below has explicit criteria and a source for the data it depends on.

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

**Source**: no external dependency. Account-age timestamps are stored at signup.

### 3. Per-sub rate limits

**Criteria**: rate limits apply per-sub, not just per-account. An account that posts 5 times in 5 different subs is normal; 5 times in 1 sub triggers the per-sub limit (default: 5 posts/day per sub for accounts under 30 days old, 20/day for established).

**Why it works**: catches "topic floods" — a single user spamming one community while looking innocuous globally.

**Source**: no external dependency.

### 4. Disposable email domain blocking

**Criteria**: signup attempts from email addresses on a maintained list of disposable / temporary email providers are rejected with a message asking for a real email address.

**Why it works**: most automated spam accounts use disposable email providers (Mailinator, Guerrilla Mail, 10MinuteMail, hundreds of others). Blocking these is one of the highest-leverage spam reductions available.

**Source**: subscribe to a maintained public list. Recommended sources, in order of preference:
- `disposable-email-domains/disposable-email-domains` on GitHub (community-maintained, widely-used, MIT license, updated frequently)
- `ivolo/disposable-email-domains` (older, larger, less actively maintained)
- For commercial-grade detection: Kickbox, ZeroBounce, or similar APIs (paid, not recommended for v1)

Pull the list at install time and re-pull weekly via cron. Allow the operator to override (whitelist a domain that's incorrectly flagged).

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
- **Forking**: the new instance has a different master secret, so re-registering the same email produces a *different* pseudonym ID on the new instance. To preserve the old identity, the export contains the email→pseudonym mapping, and the user proves email ownership on the new instance via magic link to claim their old pseudonym. Same email, same access.
- **Casual users**: re-register on the new instance with the same email; the new instance auto-suggests their old pseudonym (matched via the export); their post history attaches.

Cross-instance identity is *opt-in by design*. A user's pseudonym on Forum A is unrelated to their pseudonym on Forum B because the master secrets differ. This is the right shape for forums — pseudonymity per community is part of the value.

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
- Identity is portable via the Ed25519 pubkey — a user can be the same pseudonym across federated instances if they choose.

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
- Sub subscriptions (private, exportable, three notification modes: none / email digest / ntfy push)
- Front page with active subs + recent posts (chronological, 2/sub cap); "my subs" page for subscribed users
- User display: account age bucket, sub tenure, per-post score, mod-confirmed removal history (90 days). No karma, no flag counts, no leaderboards.
- Two-tier moderation with public log
- Spam and abuse defenses: 15-rule layered system (magic-link, rate limits, disposable email blocking, honeypots, link caps, flag system, velocity alerts, regex patterns, Bayesian filter, hashcash, ban-evasion correlation). See *Anti-Abuse* section.
- One-command per-sub export and per-user export
- Self-hostable docker-compose, plus reference hosted version
- Search (Postgres full-text)
- Dark mode, mobile-responsive web
- RSS feed per sub (composes with Product 2)

## What's explicitly out of v1

- Direct messages
- Following users (only sub subscriptions are allowed)
- Karma / reputation scores
- Federation
- Mobile apps (web works on mobile)
- Push notifications (email digests only)
- Custom themes per sub
- AI-assisted moderation
- **Light mode (deferred to M8 polish, not v1).** `build-plan.md:22, 251` already place dark-mode-via-CSS-variables in M8 production polish, and light mode comes free with the same work — extracting hardcoded hex into a `:root` palette and adding a `@media (prefers-color-scheme: light)` block. Doing it now means doing it twice (current palette → audited palette at M8). Brand identity is still settling (logo + `--accent-warm` locked this milestone, terminal aesthetic locked at M1) — adding light mode today forces a parallel palette decision before the dark palette has shipped to real users. **Working rule until M8:** every new color goes in as a `--*` CSS variable, never hardcoded — that way M8's light-mode work is "add a `@media` block," not "grep the codebase for `#58a6ff`." If a user explicitly asks for light mode before M8, revisit.

## Permanently out (not a v1 limitation, a design choice)

- Hosted media (images, videos, files). Links only. See Content Model.
- Inline embeds, link previews, auto-rendered video players.
- Following users. Sub subscriptions are allowed; user-following is not.
- Public follower / subscriber lists.
- Algorithmic feed of any kind.
- Engagement metrics surfaced to users (no view counts, no time-on-page).
- **Hashtags / user-created tags.** Tagging is voluntary, inconsistent, and creates a parallel taxonomy that competes with subs. The "subs are universes" model breaks if `#laptop` exists in five subs. Search (M8 FTS5) covers the discovery need that hashtags would have served. Sub owners get **per-sub flairs** (curated, closed list — see M5 in build-plan.md) as the structured-categorization escape valve. Flairs are removable; tags would not be.
- **Private subs (membership-gated read access).** Inverts every load-bearing forum claim: lives at one URL (no longer browseable), public mod log (invisible to non-members), fork-the-archive (members-only export). Also a moderation blind spot — abuse compounds in private spaces because random readers can't report. The WhatsApp-/mailing-list-replacement opportunity is real but is a separate product (different UX shape: real-time vs canonical, room vs sub) and would need its own PRD. Not a flag on existing subs.
- **Age verification / ID checks for NSFW.** Operator-layer concern, not forum feature. Forum exposes per-sub NSFW flags (M5); if a jurisdiction requires age gates, the operator runs them in a reverse proxy or content gateway in front of the forum. Forum never sees IDs.

## Needs further discussion (parked, not decided)

- **Unlisted subs (obscurity, not privacy).** Toggle that hides a sub from /home, /sub directory, search index, and robots.txt — but keeps `/sub/<name>` URL-readable, mod log public, no membership table. Use cases: book clubs, neighborhood councils, niche hobbies that don't want to be discovered casually. Risk surface: lower than private subs (no auth changes in read path; mod log + flag still work; operator dashboard sees everything), but non-zero — slower spontaneous abuse detection because random readers don't stumble across it, and users may misunderstand "unlisted" as "private" and over-share. Hard NO on adding a membership table — that's the trapdoor to private subs through the side door. Open question: does the obscurity-not-privacy distinction hold up in practice, or does it confuse users badly enough to be net-negative? Revisit before M5.

## Success Criteria

- A small group (10-50 people) can move off Discord and not regret it within a month.
- One technical operator can host a sub for 1000 users on a $5/month VPS.
- A community can fork off a bad mod with a working archive in under an hour.
- Spam stays under 1% of total posts with default settings.
- The product description fits in one tweet: *"A forum that lives at one URL. Magic-link to post. Search and read on the web. Owner moderates; mod actions are public; if it goes bad, fork the archive."*

---

# Product 2: Reader

## What it is

A feed aggregator for the post-algorithm web. Take a list of URLs (your daily reading), get a chronological reader. Subscribe to newsletters as feeds. Generate feeds for sites that don't publish them. Filter by user-defined rules. Export everything as a standard OPML file. No algorithm, no follow graph, no engagement metrics.

## What it explicitly is not

- Not social ("see what your friends are reading" rebuilds the follower trap).
- Not algorithmic (no recommendations, no "for you").
- Not a read-it-later app (those exist; integrate, don't rebuild).
- Not a notification system (you visit when you want).

## User Model

- **Identity**: email + magic link, or fully local (no account at all if self-hosted).
- **Subscription list**: an OPML file. Yours, exportable, portable into any standard reader.
- **Read state**: synced via a portable file you control. Stored server-side if hosted, locally if self-hosted.

## Core Features

### Feed sources

- **Direct RSS/Atom URLs**: the standard case.
- **Site URLs without explicit feed**: the reader auto-discovers (most CMSes still expose feeds even when the site doesn't link to them).
- **Sites with no feed at all**: scraper generates one. The user gives a homepage URL; the reader figures out the post pattern and produces a feed. (RSS-Bridge is the open-source reference for this; we bake it in rather than asking users to set it up.)
- **Email newsletters**: each user gets a unique inbox address (e.g. `you-x7k2@reader.example`). Subscribe to Substack/Beehiiv/whatever with that address. Newsletters arrive as feed items in the reader.
- **Watched URLs (change monitor)**: for pages that have no feed, no post pattern, and just *change in place* — a product page, a policy page, a single paragraph, a PDF on a council site. The reader fetches the page on a schedule, diffs it against the last fetch, and treats meaningful changes as new feed items. See the *Change Monitor* section below for mechanics.
- **Other readers' OPML**: import any OPML file to add its feeds to yours.

### Change Monitor (folded into the reader, not a separate product)

When a user adds a URL, the reader first tries the standard pipeline: explicit feed → auto-discover → generated feed. If none of those produce useful results, the reader offers: *"This page has no feed. Watch it for changes instead?"*

If yes, the URL becomes a watched source. Same UI, same notifications as feeds, different mechanism underneath.

**Design discipline: keep it as dumb as RSS.**

RSS worked for 25 years because it was simple — fetch a URL, parse the response, compare to last time. No browsers, no DOM walking, no rendering. The watcher follows the same rule. Anything that requires a headless browser or fancy parsing is out of scope.

**How it works:**

1. **Fetch.** Plain HTTP GET with a normal user-agent. Same as `curl`. Same as any feed reader.
2. **Strip.** Remove `<script>`, `<style>`, and HTML tags. What's left is plain text.
3. **Compare.** Diff the new plain text against the last fetch's plain text.
4. **Notify.** If different, generate a feed item showing what changed (added text, removed text). Save the new version as the baseline.

That's the whole loop. Maybe 100 lines of code.

**Per-URL options the user can set:**

- **Cadence**: how often to re-fetch. Default daily; user can pick hourly or weekly.
- **Match string**: optional substring or simple regex. The watcher only notifies if the matching part of the text changed. Kills 95% of false positives without needing CSS selectors. Examples: `In stock`, `Updated:`, `\$[0-9]+\.[0-9]{2}`.
- **Minimum change size**: ignore changes smaller than N characters (filters typo fixes on long pages).

**What's intentionally not handled:**

- **JavaScript-rendered pages.** If `curl` can't see the content, the watcher can't either. That's fine — most pages worth watching (government sites, blogs, docs, Wikipedia, council PDFs, retailer pages) render content in plain HTML. JS-rendered pages tend to be ad-tech-heavy modern sites that are hostile to readers anyway.
- **Auth-protected pages.** Out of scope for v1. The user can put a public URL behind a watcher; private pages they can read themselves.
- **Visual changes.** A pixel-diff watcher is a different product. This one watches text.

**PDFs**: if the URL ends in `.pdf`, run `pdftotext` after fetching, then proceed normally. Single shell call, no library, no fancy handling.

**Why this lives in the reader, not as a separate product:**

The user-facing question is the same — "tell me when something on the web has new stuff for me." Whether the underlying mechanism is RSS parsing, feed generation, newsletter intake, or page diffing is plumbing the user shouldn't have to think about. One UI, four mechanisms, all routed to the same chronological reading surface.

**Use cases this unlocks that pure RSS doesn't:**

- Product back-in-stock alerts (with a match string for `In stock`).
- Government policy page edits (whole-page diff).
- Council/school-board PDF replacements.
- A specific person's bio or homepage updating.
- Job listings on company career pages that don't publish feeds.
- Wikipedia article changes (whole article; for paragraph-level use Wikipedia's own watch tool).

### ntfy push (opt-in, per-source)

By default, the reader has no notifications. You visit when you want. That's the principle and it stays.

For users who want immediate alerts on specific sources — most often a watched URL where timing matters (back-in-stock, breaking change to a watched policy page) — the reader supports [ntfy](https://ntfy.sh) as an opt-in push channel.

Same model as in the forum:

- The user installs the ntfy app, picks a private-ish topic name, and pastes their topic URL into the reader's per-feed or per-watcher settings.
- When the trigger fires (new feed item, watcher detects a change), the reader does one HTTP POST to the user's topic URL with a title and click-back link.
- That's the entire integration. No ntfy SDK, no library, no state beyond the user's preference.
- The user can mark each feed and each watched URL independently for ntfy push. Most stay silent; a few that genuinely matter get push.

This preserves the "you check when you want" default for the bulk of reading, while letting users opt specific sources into immediate alerts. Same protocol-shaped, no-account, self-hostable discipline as everything else in the stack.

ntfy is **never the default** and **never required**. The reader works fully without it.

### Reading

- **Chronological by default**, reverse-chronological optional. No other sort.
- **Full-text fetched**: where the feed publishes only excerpts, the reader fetches the full article and inlines it. (Mercury / Readability extraction.)
- **Reading view**: distraction-free, user-controlled fonts and width.
- **Mark-as-read** is the only interaction. No likes, no shares, no annotations in v1.

### Filters (user-defined, not algorithmic)

- Per-feed filters: "from this feed, only items containing X" or "hide items containing Y."
- Per-feed cadence: tag a feed as real-time, daily-digest, or weekly-summary. High-volume feeds don't drown low-volume ones.
- Per-feed trust: mark a feed as low-trust to apply heavier slop-filtering.

### Slop defenses (2026-specific)

- AI-generated content detection (heuristic, not perfect): flagged in the UI, not auto-removed.
- User-curated slop-domain blocklist (subscribable, not mandatory). One way to opt into community-shared lists without a follower graph.
- Per-feed "this is mostly slop, hide" toggle.

### Export

- OPML export of subscriptions: always, one click.
- Read-state export as a portable JSON file.
- Full archive export (every item ever fetched) as a folder of HTML or markdown.

## Authentication

- Self-hosted: no auth at all if running locally on your own machine.
- Hosted: magic-link to email, same as the forum. Session token persists 30 days.

## What's in v1

- All of the above.
- Mobile-responsive web reader (no app).
- Per-feed and per-user filtering.
- Newsletter inbox (one address per user).
- Auto-discovery and feed generation.
- Watched URLs (change monitoring): plain HTTP fetch, strip-and-diff, optional match string, optional PDF support. No headless browser.
- Optional ntfy push per feed and per watched URL. Off by default. User provides their own ntfy topic URL.
- OPML import/export.
- Full-text fetching.
- Self-hostable in one command.
- Optional hosted version.

## What's out of v1

- Mobile apps
- Push notifications
- Social features (friends, sharing, likes)
- Recommendations
- Built-in payments / micropayments to creators
- Real-time websocket updates (poll-based is fine)
- Browser extension (v2)
- AI summarization of articles (sounds nice, adds dependency, killable later)

## Technical Stack

Same boring choices as the forum.

- **Backend**: Go or Python.
- **Database**: SQLite for self-hosted single-user; PostgreSQL for hosted multi-user.
- **Feed parsing**: standard libraries (feedparser, gofeed).
- **Article extraction**: Readability port.
- **Email inbound**: per-user addresses on a single inbound domain, parsed and converted to feed items.
- **Change monitoring**: scheduled `curl`-equivalent fetch, HTML tag stripping (regex or standard library), text diff library, `pdftotext` shell-out for PDFs. No headless browser, no DOM parser, no selector engine.
- **Storage**: feed items as markdown + JSON in a per-user directory. Watched-page snapshots as plain text alongside their metadata. Database indexes over files.

## Success Criteria

- A user with a list of 10 sites they check daily can replace that ritual with the reader in 5 minutes.
- A user can subscribe to 5 newsletters via the reader and read them outside their email inbox in the same session.
- A user can watch 10 feed-less pages (product pages, policy pages, PDFs) and only get notified on real changes, not noise.
- The reader runs on a Raspberry Pi at home with 100 feeds and 10 watched pages and zero noticeable lag.
- One-sentence description: *"Take back your information diet from the algorithm. Your sites, your newsletters, the pages that just change in place — all in chronological order, no recommendations."*

---

# Shared Build Plan

## Phase 1: Reader (smaller, ships first)

The reader has fewer moving parts, no community to bootstrap, immediate single-user value, and proves the deployment / forkability pattern. Ship in 4-6 weekends.

## Phase 2: Forum

The forum is bigger, harder, has moderation surface, has community-bootstrapping problem. Reuse deployment and forkability patterns from the reader. Ship in 3-4 months of focused work.

## Phase 3: Cross-pollination

Once both ship: forum's per-sub RSS feed becomes a first-class subscription source in the reader. A user can read their favorite subs in their reader, post via the forum web, and never touch a third-party platform.

---

# Other Old-Web Things Worth Rebuilding

These didn't make this PRD because the conversation focused on RSS and forums, but they sit in the same family and would compose with these two if built. Listed in rough order of leverage.

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
