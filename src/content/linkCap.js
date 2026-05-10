// Outbound link cap per post — PRD §Spam Defenses 6.
//
// Tiers by account age (handles.first_seen_at), same shape as
// rateLimit.js but a separate config namespace because the rule is a
// content-shape gate (count URLs and reject), not a rate window.
//
// Floor (PRD-locked):
//   new      (<24h)  1 link/post
//   recent   (1-7d)  3 links/post
//   established >7d  5 links/post
//
// Operator can tighten via config; floor is ceiling. Same tighten-only
// pattern as rateLimit.js.
//
// PRD also mentions per-sub override at >7d. Per the v1 plato decision
// (spam limits are per-forum, subs inherit), we ship instance-wide only.
// Per-sub becomes a follow-up if a fork operator asks for it.

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

export const LINK_CAP_FLOOR = Object.freeze({
  new:         1,
  recent:      3,
  established: 5,
});

export function resolveLinkCapConfig(overrides = {}) {
  const out = { ...LINK_CAP_FLOOR };
  for (const tier of ['new', 'recent', 'established']) {
    const v = overrides[tier];
    if (v == null) continue;
    if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      throw new Error(`linkCaps.${tier}: must be a non-negative number, got ${v}`);
    }
    if (v > LINK_CAP_FLOOR[tier]) {
      throw new Error(`linkCaps.${tier}: ${v} exceeds floor of ${LINK_CAP_FLOOR[tier]}; operator can only tighten`);
    }
    out[tier] = v;
  }
  return Object.freeze(out);
}

const DEFAULT_CONFIG = resolveLinkCapConfig({});

// Count distinct URLs in the given text. Catches bare http(s) URLs and
// Markdown-link URLs `[text](http...)`. We don't try to be smart about
// near-URLs (www.foo without scheme); an attacker who omits the scheme
// loses click-ability for legitimate readers anyway.
const URL_RE = /https?:\/\/[^\s)\]]+/gi;

export function countLinks(text) {
  if (!text) return 0;
  const matches = text.match(URL_RE);
  if (!matches) return 0;
  return new Set(matches).size;
}

function tierFor(db, handle, now) {
  const row = db.prepare('SELECT first_seen_at FROM handles WHERE handle = ?').get(handle);
  if (!row) return 'new';
  const ageMs = now - row.first_seen_at;
  if (ageMs < DAY_MS)     return 'new';
  if (ageMs < 7 * DAY_MS) return 'recent';
  return 'established';
}

// Returns null when the post is allowed; otherwise { message } describing
// the cap. Caller renders 400 (or 429) with the message.
export function checkLinkCap(db, handle, text, now = Date.now(), config = DEFAULT_CONFIG) {
  const count = countLinks(text);
  if (count === 0) return null;
  const tier = tierFor(db, handle, now);
  const cap = config[tier];
  if (count <= cap) return null;
  return {
    message: `this post has too many links (${count}). trim and try again.`,
    reason: { tier, cap, count },
  };
}
