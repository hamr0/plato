# M5 Mod Surface — Unified Spec

> Locks in the design discussed in the M4 round-3 review. This is the spec that M5 implements.
>
> **Companion docs.** See [PRD §Moderation](prd-open-web-revival.md) for the locked product principles this spec implements, and [build-plan.md](build-plan.md) for milestone ordering.

## What this is

A single mod surface that unifies pending flags, mod actions, and system events into one filterable inbox. Replaces the separate "flag-queue page" originally scoped for M5.

### The shape

```
[ open ]   [ inbox ]   [ audit ]            ← mode toggle (one at a time)
[ new (24h) ]   [ all-time ]                 ← date filter
[ flagged ]  [ banned ]  [ removed ]  [ all ] ← type filter
[ sub: all ▾ ]                                ← sub picker
[ mod: <chip> ✕ ]   [ user: <chip> ✕ ]       ← click-to-filter chips (when active)

| type | mod | user | target | when | status |
|------|-----|------|--------|------|--------|
| ...  | ... | ...  | ...    | ...  | [⚠]   |
   ↓ click row → native <details> expansion: full body + flag detail + last 5 events + action buttons
```

### Three modes

- **open** — pending flags and any items the system auto-hid awaiting review. Default landing for mods. *Falls back to inbox if there are zero open items.*
- **inbox** — deduped by target. One row per affected user (for bans) or per target post/comment (for collapse/remove). Each row shows current state + latest event + an event-count badge. Expand to see the per-target history.
- **audit** — flat chronological event stream. Every ban, every unban, every collapse, every uncollapse as its own row. This is the trust-mechanism view: anyone can see the full pattern.

The same data, three aggregations.

## Routes

| Route | Visibility | Modes available | Purpose |
|---|---|---|---|
| `/modlog` | mod-only (logged-in mod-of-something) | open, inbox, audit | Cross-sub mod inbox |
| `/sub/<name>/modlog` | **public, readonly** | audit only | Per-sub audit feed for trust property |

The cross-sub mod inbox is the working surface; the per-sub public audit is the trust surface. Same data, different access.

### What is NOT public

Pending flags and the contents of pending-flag-row expansions (flagger handles, flag categories, notes) are mod-only. Reasons:

- Flagger retaliation: a flagger's handle leaking before resolution invites pile-on.
- Vigilante coordination: telegraphed takedowns can be amplified before mods rule.
- Double jeopardy: public-before-decision implies guilt.

Once a mod resolves a flag (upheld → produces a `mod_actions` row, or dismissed → flag rows marked resolved), the resulting **resolution** appears in the public audit. The pending state itself never does.

## Filters

### Mode toggle (mutually exclusive)

- `open` — `flags WHERE resolution = 'pending'` ∪ `posts/comments WHERE collapsed_at IS NOT NULL AND not yet adjudicated`
- `inbox` — deduped target view of resolved events + current state for bans/soft-state
- `audit` — flat `mod_actions` query

### Date filter

- `new (24h)` — `created_at > now - 24h`
- `all-time` — no date scope (paginated)

### Type filter

- `flagged` — pending flags + the resolved actions that came from flags
- `banned` — `mod_actions WHERE action IN ('ban', 'unban')`
- `removed` — `mod_actions WHERE action IN ('collapse', 'uncollapse', 'remove', 'unremove')`
- `all` — no type scope

### Sub picker

Defaults to "all subs you mod" on `/modlog`. On `/sub/<name>/modlog` this filter is fixed to that sub.

### Click-to-filter — the source label is the toggle

Click a pseudonym in the **mod** column → adds `?mod=<handle>`. Click a pseudonym in the **user** column → adds `?user=<handle>`. Click `system` in the mod column → adds `?mod=system`. Filters compose.

A `[me]` quick-filter button in the bar sets `?mod=<currentHandle>` — replaces the originally-planned "my mod decisions" panel.

**Toggle, not chip.** When a filter is active, the source label that triggered it renders in `--accent-warm` (warm-highlighted). Clicking the warm label again drops the filter. There is no separate dismissible chip with an ✕. The label *is* the affordance; clicking on it the second time turns it off. Symmetric, one mental model.

A read-only summary line under the filter bar says what's currently scoped, e.g., *"showing: sub=cooking, user=spammer-x"* — useful when multiple filters compound. To clear, click the warm-highlighted source labels in the table or the filter bar.

Already shipped (commit 2119fa7+): the subs strip on `/modlog` uses this toggle pattern. The same pattern extends to mod and user labels in M5.

## Columns

| Column | Content |
|---|---|
| **type** | flagged \| banned \| removed \| system override \| ... |
| **mod** | pseudonym (clickable, filters by mod), or `system` for auto events |
| **user** | target user's pseudonym (clickable, filters by user) |
| **target** | post link or comment link or sub link (for ban events) |
| **when** | relative time (`6h ago`, `5m ago`) |
| **status** | badge (`[banned]`, `[lifted]`, `[collapsed]`, `[removed]`, `[pending]`) |

## Row expansion (the in-context decision flow)

Each row uses native `<details>` for expansion. Expanded view contains:

- **Full body** of the post or comment (or `n/a` for ban rows)
- **For pending flags:** the flagger pseudonyms and flag categories. *"flagged for: spam (2), harassment (1) by pseudo-a, pseudo-b, pseudo-c"*
- **Last 5 events** affecting this target (with "show all N" link if more)
- **Cross-sub user history** for ban rows: *"this user has N prior ban events in /sub/X, /sub/Y"* — only events from subs the current mod has visibility in
- **Action buttons:**
  - For pending flags: `[confirm soft-removal]`, `[confirm hard-removal (reason ↓)]`, `[dismiss flags]`
  - For ban rows: `[unban]` (if currently banned) or `[ban again]` (if previously unbanned)
  - For collapse/remove rows: `[uncollapse]` / `[unremove]` per current state
- **Reason field** (textarea, required for `remove` and `ban`, optional otherwise)

All buttons POST to existing mod handlers; redirect back to `/modlog` with the row updated.

## Pagination

- 50 rows per page (up from 25 — pending flags add volume).
- `?page=N` query param.
- Pager shows: `← prev | page X / Y · N total | next →`.

## Bans — Option C (status-bearing rows)

Each ban event row shows a **status badge** in the row itself: `[banned]` (amber, currently banned) or `[lifted]` (dim, has been unbanned). Implementation: per-page batched lookup of `bans WHERE sub_name IN (...) AND handle IN (...)`.

A mod scrolling `type=banned` sees who's currently in the banned set at a glance — the amber badges. Click any to expand and unban.

In the **inbox** mode (deduped), each user appears once with their current state + event count. In **audit** mode, every ban/unban event is its own row, flat chronological — making mod ping-pong patterns visible to anyone scrolling.

## Default behavior

- Default landing on `/modlog`: **open** mode if there are pending items; **inbox** otherwise.
- Default landing on `/sub/<name>/modlog`: **audit** mode (only mode available).
- Sub picker default: "all subs you mod" cross-sub; locked to one sub on per-sub page.

## What this collapses (existing M5 carryover)

- **My mod decisions panel** → collapses to `/modlog?mod=me`.
- **Per-sub flag-threshold override** → still ships, set on `/sub/create` and editable on a future `/sub/<name>/settings` page.

## What still needs separate work in M5 (not in this spec)

These M5 items live alongside the unified mod surface but in separate code:

- Per-sub flairs (closed list, owner-curated)
- Per-sub NSFW banner
- Per-account rate limits (posts/hour, comments/hour, votes/hour)
- Per-sub rate limits (configurable by owner)
- Link cap + URLhaus integration (hourly cron)
- Spam regex pattern file

## Implementation order

1. **Schema additions:** none required — existing `mod_actions`, `flags`, `bans` tables suffice. Add `flags.resolved_at` index if not already present for the dismissed-flag query.
2. **`/modlog` rewrite:** replace `renderMyModLog` with a unified renderer that takes mode + filters and dispatches.
3. **Inbox dedup query:** target-key-based grouping over events. SQL with `ROW_NUMBER() OVER (PARTITION BY target_type, target_id ORDER BY created_at DESC)`.
4. **Open-mode query:** UNION of pending flags + auto-hidden-not-yet-adjudicated targets.
5. **Filter bar UI:** mode toggle (3 buttons), date toggle, type segmented control, sub `<select>`, mod/user chip rendering.
6. **Click-to-filter:** wrap mod/user pseudonyms in `<a href="?mod=<handle>">` (or `?user=`).
7. **Row expansion:** native `<details>` per row. Expansion content: body fetch + flag detail + last-5 events + action form.
8. **Public per-sub modlog:** strip pending flags + flagger details from the existing `renderModLog` output. Add click-to-filter on mod/user pseudonyms.
9. **Tests:** dedupe correctness, public-modlog-omits-pending, filter composition, action-button POST flow.

## Test plan

Each row on the new surface has:
- Render correctness (right type, right pseudonyms, right badge).
- Permission gate (mod-only routes reject non-mods; public routes serve readonly without exposing pending).
- Filter composition (mode + date + type + sub + mod-chip + user-chip all combine cleanly).
- Action POST flow (each button produces correct mod_actions row + redirect).

## Open questions

None. All locked in this round.

## Decisions log

- 2026-05-01 — locked unified-surface (vs separate flag-queue page)
- 2026-05-01 — three modes (open/inbox/audit); inbox deduplicates, audit doesn't
- 2026-05-01 — public per-sub `/sub/<name>/modlog` is audit-only, resolved-only
- 2026-05-01 — pending flags + flagger identity stay mod-only
- 2026-05-01 — ban surfacing = Option C (status badge) over events-only or roster-page
- 2026-05-01 — column rename: mod + user (not acted/affected)
- 2026-05-01 — system is a clickable filter target (mod=`system`)
- 2026-05-01 — my-mod-decisions collapses into `?mod=me`
- 2026-05-01 — 50/page (up from 25, to accommodate pending-flag volume)
- 2026-05-01 — last 5 events in expansion, "show all N" if more
- 2026-05-01 — cross-sub user history line in ban-row expansion (scoped to subs the current mod sees)
- 2026-05-01 — click-to-filter is a TOGGLE (label is the affordance, click again to drop). No separate dismissible-chip UI.
