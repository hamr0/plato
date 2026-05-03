// Per-account rate limits — PRD §Spam Defenses 2.
//
// Tiers by account age (handles.first_seen_at):
//   new         (<24h)       1 post/hour,  3 posts/day, 10 comments/day
//   recent      (1d-7d)      3 posts/hour, 10 posts/day, 30 comments/day
//   established (>7d)        no per-account limits (PRD §2 says "limits
//                            removed at >7d with no flags upheld" — the
//                            no-flags check lands when negative-history
//                            queries arrive; for v1 the >7d account
//                            unlocks regardless)
//
// We deliberately count from `posts` / `comments` directly rather than
// keeping a separate counter table — the source of truth is the actual
// content rows. A SQLite COUNT over an indexed (handle, created_at) is
// cheap up to the volume plato is built for. New tables can come if the
// numbers ever justify it.
//
// Wiring: handleFinalize (post publish) and handleAddComment call into
// checkPostRate / checkCommentRate before the write. A 429 with a
// human-readable retry hint is returned. Drafts are NOT rate-limited
// (they're an email-confirmation step, not a post yet).

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS  = 24 * HOUR_MS;

// RATE_LIMIT_FLOOR is the PRD-locked safe minimum for the entire forum.
// Operators of a plato fork can tighten via config (createApp({ rateLimits }))
// but cannot loosen — values above the floor reject at boot. The
// codebase ships with the floor as the default; that's intentional.
//
// Floor is per-forum, not per-sub. PRD §Spam 3 calls for per-sub
// override but plato v1 keeps the floor instance-wide and lets sub
// owners control auto-uncollapse on /sub/create instead. Per-sub spam
// limits land if a real fork operator asks for them.
export const RATE_LIMIT_FLOOR = Object.freeze({
  // Per-account, tier'd by handles.first_seen_at age.
  perAccount: Object.freeze({
    new:    { postsPerHour: 1, postsPerDay: 3,  commentsPerDay: 10 },
    recent: { postsPerHour: 3, postsPerDay: 10, commentsPerDay: 30 },
    // 'established' (>7d) has no per-account ceiling — see PRD §2.
  }),
  // Per-sub topic-flood cap (still per-account, but scoped to one sub).
  // Tighter for newish accounts (<30d) than for trusted (>=30d).
  perSubDay: Object.freeze({
    newish:  5,
    trusted: 20,
  }),
});

const TRUSTED_AGE_MS = 30 * DAY_MS;

// resolveRateLimitConfig merges operator overrides with the floor and
// validates that overrides are AT MOST as permissive as the floor (i.e.
// each numeric value must be <= the corresponding floor value). Throws
// on any violation; the operator sees the error at boot.
export function resolveRateLimitConfig(overrides = {}) {
  const out = {
    perAccount: {
      new:    { ...RATE_LIMIT_FLOOR.perAccount.new },
      recent: { ...RATE_LIMIT_FLOOR.perAccount.recent },
    },
    perSubDay: { ...RATE_LIMIT_FLOOR.perSubDay },
  };
  const checkLeq = (path, override, floor) => {
    if (override == null) return;
    if (typeof override !== 'number' || !Number.isFinite(override) || override < 0) {
      throw new Error(`rateLimits.${path}: must be a non-negative number, got ${override}`);
    }
    if (override > floor) {
      throw new Error(`rateLimits.${path}: ${override} exceeds floor of ${floor}; operator can only tighten`);
    }
  };
  if (overrides.perAccount) {
    for (const tier of ['new', 'recent']) {
      const tierOverride = overrides.perAccount[tier];
      if (!tierOverride) continue;
      for (const k of ['postsPerHour', 'postsPerDay', 'commentsPerDay']) {
        checkLeq(`perAccount.${tier}.${k}`, tierOverride[k], RATE_LIMIT_FLOOR.perAccount[tier][k]);
        if (tierOverride[k] != null) out.perAccount[tier][k] = tierOverride[k];
      }
    }
  }
  if (overrides.perSubDay) {
    for (const k of ['newish', 'trusted']) {
      checkLeq(`perSubDay.${k}`, overrides.perSubDay[k], RATE_LIMIT_FLOOR.perSubDay[k]);
      if (overrides.perSubDay[k] != null) out.perSubDay[k] = overrides.perSubDay[k];
    }
  }
  return Object.freeze({
    perAccount: Object.freeze({
      new:    Object.freeze(out.perAccount.new),
      recent: Object.freeze(out.perAccount.recent),
    }),
    perSubDay: Object.freeze(out.perSubDay),
  });
}

const DEFAULT_CONFIG = resolveRateLimitConfig({});

// All checks honor the same accountAgeTier mapping. Per-account limits
// are looked up by tier; per-sub limit is looked up by the 30d trusted
// cutoff (separate threshold).
export function accountAgeTier(db, handle, now = Date.now()) {
  if (!handle) return 'new';
  const row = db.prepare('SELECT first_seen_at FROM handles WHERE handle = ?').get(handle);
  if (!row) return 'new';
  const ageMs = now - row.first_seen_at;
  if (ageMs < DAY_MS)     return 'new';
  if (ageMs < 7 * DAY_MS) return 'recent';
  return 'established';
}

function countSince(db, table, handle, since) {
  return db
    .prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE handle = ? AND created_at >= ?`)
    .get(handle, since).n;
}

// Return null if the user may post; otherwise a { message } describing
// the limit that triggered. Caller renders 429 with the message.
// `config` defaults to the floor; createApp threads operator overrides
// through.
export function checkPostRate(db, handle, now = Date.now(), config = DEFAULT_CONFIG, { skipHourly = false } = {}) {
  const tier = accountAgeTier(db, handle, now);
  const limits = config.perAccount[tier];
  if (!limits) return null;
  if (!skipHourly) {
    const hourCount = countSince(db, 'posts', handle, now - HOUR_MS);
    if (hourCount >= limits.postsPerHour) {
      return { message: `posts limited to ${limits.postsPerHour}/hour for ${tier} accounts. try again in an hour.` };
    }
  }
  const dayCount = countSince(db, 'posts', handle, now - DAY_MS);
  if (dayCount >= limits.postsPerDay) {
    return { message: `posts limited to ${limits.postsPerDay}/day for ${tier} accounts. try again tomorrow.` };
  }
  return null;
}

// Per-sub variant — catches the topic-flood pattern where one account
// hits one sub repeatedly. Limit is 5/day for accounts under 30 days
// and 20/day for older accounts. Returns null (ok) or { message }.
export function checkPostRatePerSub(db, handle, subName, now = Date.now(), config = DEFAULT_CONFIG) {
  if (!handle || !subName) return null;
  const handleRow = db.prepare('SELECT first_seen_at FROM handles WHERE handle = ?').get(handle);
  if (!handleRow) return null;
  const ageMs = now - handleRow.first_seen_at;
  const limit = ageMs < TRUSTED_AGE_MS ? config.perSubDay.newish : config.perSubDay.trusted;
  const count = db
    .prepare('SELECT COUNT(*) AS n FROM posts WHERE handle = ? AND sub_name = ? AND created_at >= ?')
    .get(handle, subName, now - DAY_MS).n;
  if (count >= limit) {
    return {
      message: `posts in /sub/${subName} limited to ${limit}/day per account. try a different sub or wait it out.`,
    };
  }
  return null;
}

export function checkCommentRate(db, handle, now = Date.now(), config = DEFAULT_CONFIG, { doubledForOwner = false } = {}) {
  const tier = accountAgeTier(db, handle, now);
  const limits = config.perAccount[tier];
  if (!limits) return null;
  // Owner of the destination sub gets 2× the daily comment cap. Mirrors
  // the post carve-out — owners get more rope in their own sub for
  // engagement/discussion-leading without lifting the ceiling entirely.
  const cap = doubledForOwner ? limits.commentsPerDay * 2 : limits.commentsPerDay;
  const dayCount = countSince(db, 'comments', handle, now - DAY_MS);
  if (dayCount >= cap) {
    return { message: `comments limited to ${cap}/day for ${tier} accounts. try again tomorrow.` };
  }
  return null;
}
