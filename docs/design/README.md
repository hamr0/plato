# Visual samples — text-first, PRD-compatible

Open each in a browser side-by-side and pick which direction feels right. Same data, three aesthetics.

```
file:///home/hamr/PycharmProjects/plato/forum-poc/samples/1-terminal.html
file:///home/hamr/PycharmProjects/plato/forum-poc/samples/2-reader.html
file:///home/hamr/PycharmProjects/plato/forum-poc/samples/3-classic.html
```

## What gives each one richness *without* breaking the PRD

All three use the same six "richness levers" — none of which fetch content from linked pages, none of which host media, none of which violate the PRD:

1. **Identicons** — generated SVG avatars from handle (already in PRD). Visual variety per author, no uploads, no PII.
2. **Favicon hints** — tiny 16×16 domain glyph next to outbound links. Nothing fetched from the destination; favicons are constant per domain. Reader sees "→ youtube.com" / "→ legislature.ca.gov" at a glance. PRD-compatible.
3. **Account-age + new-account badges** — already in PRD §User Display. "5+ years" / "new account" / "1 month" colors information that's already there.
4. **Vote arrows + score** — already in PRD §Voting. Visual weight to community signal.
5. **Typography hierarchy** — title > meta > body. Single biggest visual differentiator and costs nothing.
6. **Color + space** — palette + line-height + max-width. Where most of "feels good" lives.

Notably absent (and staying that way):
- Link previews / OG cards
- Embedded video / image / audio players
- Hosted thumbnails of any kind
- Engagement metrics (view counts, time on page)
- Per-sub themes
- Profile photos / custom avatars

## What's different between the three

### 1. Terminal (gitdone-style)
Charcoal background, monospace throughout, JetBrains Mono / SF Mono. Phosphor-blue + amber + green accents. 720px column. Tight, technical, reads like a terminal session. Closest to gitdone, which you said you liked.

**Vibe:** discourse for people who run their own infra.

### 2. Reader (Medium-style serif)
Cream background, Charter/Iowan serif body, sans-serif UI. 640px narrow column, line-height 1.7. Brick-red accent. Reads like a literary magazine.

**Vibe:** discourse where the writing matters most. Slowest-feeling — and that's the point.

### 3. Classic forum (Discourse-trimmed)
White background, Inter/system-sans, two-column layout (posts + sidebar). Reddit-shaped vote arrows on the left, badge pills, blue accent. 800px main column, 240px sidebar.

**Vibe:** familiar to anyone who's used Reddit/Discourse. Lowest learning curve, highest "looks like a forum" recognition.

## Recommendation

You said you liked gitdone's style. **Sample 1 (terminal)** is gitdone-inspired and most aligned with the "small, durable, owned by its members, anti-platform" thesis. It signals "this is not Reddit-at-a-discount, this is something else" the moment a visitor lands.

But that aesthetic is polarizing — some readers find monospace hostile. If you want a wider audience and gentler on-ramp, sample 3 (classic) is the safe bet. Sample 2 (reader) is the dark horse — a real differentiator if you can commit to "writing-quality forum" as part of the brand.

## Notes on the favicon hints

In production, favicon URLs will come from a per-instance cache (one fetch per unique domain, stored locally). The `https://www.google.com/s2/favicons?domain=...` URLs in these samples are placeholders — Google's service is convenient for visualization but adds telemetry to every page load. M5 or M8 ships a self-hosted favicon cache.

## Notes on identicons

Same — `https://api.dicebear.com/9.x/...` is dicebear's CDN for visualization. The forum already generates these server-side via `@dicebear/core` (POC validated this). In production, identicons render to inline SVG from the handle — no external service involved.
