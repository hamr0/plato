# Privacy-respecting discoverability — playbook

A guide for making privacy tools findable without working against what they stand for. Written for late.fyi and any sibling project under the same roof.

## The frame

"SEO" is two different things mashed together. Untangling them is the whole game.

| What it is                                  | Verdict                                                                 |
| ------------------------------------------- | ----------------------------------------------------------------------- |
| Declarative machine-readability             | Pure open-web. `<title>`, `<meta>`, `sitemap.xml`, OpenGraph, JSON-LD — all static head tags or static files. No scripts, no calls home. This is what made the web indexable in the first place. |
| Conversion-funnel growth-hacking            | What conflicts with privacy work. Analytics, AMP, doorway pages, keyword stuffing, tracking pixels, "engagement" instrumentation. |

The web-revival philosophy isn't anti-discoverable, it's anti-extractive. You can be maximally findable via (1) without ever touching (2). Sitemaps and `rel=me` are 1995 web tech; refusing them isn't principled, it's just leaving signal on the table.

## Tier 1 — declarative head tags (do these always)

In the document head, all static, all reversible:

- `<title>` — descriptive, includes the value prop. Not just the brand name.
- `<meta name="description">` — one sentence the search engine quotes verbatim. Mention what the tool *does* and the privacy posture in the same breath ("…no accounts, no analytics, open source") so the audience self-selects in the result snippet.
- `<link rel="canonical">` — the apex URL. Prevents www/apex split.
- `<meta name="theme-color">` — browser chrome on mobile.
- `<link rel="icon">` — favicon. Without it browsers show a default; with it the tab is recognizable in a forest.
- `<meta name="viewport">` — mobile rendering. Probably already there.
- `<html lang="…">` — accessibility + indexing hint.

OpenGraph (link-unfurl in chats, Slack, Signal, Discord, Mastodon, iMessage):

- `og:type` — `website` for marketing pages, `article` for posts.
- `og:title`, `og:description`, `og:url`, `og:site_name`.
- `og:image` — 1200×630 PNG. Without it, unfurl shows title+description only (still better than nothing).

Twitter Card:

- `twitter:card` — `summary` (no image needed) or `summary_large_image` if you have one.

JSON-LD (optional rich snippets, pure data, no executable JS — `type="application/ld+json"` is parsed, not run):

- `SoftwareApplication` schema for tools, `WebSite` for landing pages, `Article` for blog posts.
- Costs ~15 lines, gives Google enough structured data to render a richer card.
- Skippable if it feels grimy. Many privacy-respecting sites omit it on principle.

## Tier 2 — static files at the root

- `robots.txt` — three lines: `User-agent: *` + `Allow: /` + `Sitemap: https://example.com/sitemap.xml`. The Sitemap line is the part crawlers actually need.
- `sitemap.xml` — even a one-URL sitemap signals "yes please index". Use `<changefreq>` and `<priority>` if you want.
- `humans.txt` — optional, web-revival adjacent. Lists the people behind the project.
- `security.txt` (`.well-known/security.txt`) — declares how to report vulns. Doesn't help SEO but signals seriousness to the audience that cares.

## What to never add

- Google Analytics, Plausible-self-hosted-but-routes-through-cloudflare, or any analytics that touches a user's session. If you want metrics, use server-side aggregate logs you can't deanonymize.
- AMP — Google's attempt to host your content on their CDN. Conflicts with everything.
- Hreflang stuffing for languages you don't actually serve. Crawlers penalize this now anyway.
- Cookie banners — only required if you set tracking cookies. Don't set them. No banner needed.
- "Pop-up to subscribe" / Intercom widgets / Drift / any third-party JS for "engagement".
- Tag managers (GTM). They exist to load surveillance lazily.

## Tier 3 — distribution beats optimization

Search engines are downstream of where your audience already congregates. Get listed where the audience self-selects:

| Target                              | What to submit                                                                |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| **Privacy Guides** (privacyguides.org) | Forum post under the appropriate category. The "no accounts, deleted on terminal" angle lands. |
| **alternativeto.net**               | List as alternative to the big-brand version of your tool.                    |
| **awesome-privacy** / **awesome-selfhosted** (GitHub) | Open a PR adding your tool to the relevant section.                  |
| **Hacker News** / Show HN           | Once stable. Email-only / open-source / no-account combos do well. Submit Tuesday/Wednesday morning Pacific. |
| **lobste.rs**                       | Invite-only but `show` + `web` tag is great fit.                              |
| **IndieWeb wiki** (indieweb.org)    | Add your tool to the relevant page if there is one.                           |
| **r/privacy**, **r/selfhosted**, **r/europetravel** (or your audience-specific subreddit) | Tasteful posts only. Reddit's spam filter is harsh on first-time submitters; comment in the community first. |

The compounding move that beats every list: **write one philosophical post**. Examples for late.fyi:
- "Why late.fyi deletes your email when the trip ends" — make the privacy invariant a story.
- "An email instead of an app" — the web-revival argument.
- "Why no accounts" — the user-experience case for stateless tools.

Privacy communities link to *posts*, not landing pages. The post lives forever, ranks naturally, and seeds backlinks to the tool. One good post outranks any sitemap trick over 12 months.

## Audit checklist (per-site, run quarterly)

- [ ] `<title>` present, descriptive, includes value prop
- [ ] `<meta description>` present, one sentence, includes privacy stance
- [ ] `<link rel="canonical">` set to apex
- [ ] OpenGraph `og:title`, `og:description`, `og:url`, `og:type`, `og:site_name` present
- [ ] `og:image` present OR explicitly skipped (unfurl falls back to title+description)
- [ ] `twitter:card` present
- [ ] `<link rel="icon">` present and renders
- [ ] `robots.txt` exists at root, references sitemap
- [ ] `sitemap.xml` exists at root, lists every public URL
- [ ] No analytics scripts in the page source (`grep -i 'analytics\|gtag\|plausible\|fathom\|umami'` returns clean)
- [ ] No tracking cookies (DevTools → Application → Cookies, empty for first-party)
- [ ] No third-party JS at all (DevTools → Network → filter by domain, only own domain visible)
- [ ] Privacy claim copy on the landing page matches what the code actually does (audit yearly; the privacy claim is a contract).

## Per-project notes

### late.fyi

Implemented 2026-05-04 (commit TBD): tier 1 head tags + robots.txt + sitemap.xml. Skipped JSON-LD on principle for now. og-card.png deferred — design task.

The privacy-claim invariant is in `CLAUDE.md` (state/active/<msgid>.json deleted on terminal, no archive). The landing page section "What we don't do" must stay in sync; if retention changes, update the page first per CLAUDE.md.

### (other projects)

Add sections per project as they ship.
