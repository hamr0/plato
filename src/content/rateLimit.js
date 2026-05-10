// Per-account rate limits — PRD §Spam Defenses 2.
//
// Tiers by account age (handles.first_seen_at):
//   new         (<24h)       1 post/hour,  3 posts/day,  10 comments/day
//   recent      (1d-7d)      3 posts/hour, 10 posts/day, 30 comments/day
//   established (>7d)        6 posts/hour, 20 posts/day, 60 comments/day
//
// The established tier was originally uncapped on the theory that a 7d-
// old account had earned the floor off. In practice that left a single
// account free to fan out across many subs (each per-sub flood cap is
// 20/day, but no global cap caught the cross-sub spread). 20 posts/day
// = ~1/hour over 24h, which is the upper bound of "active heavy
// contributor" usage; anything past that reads as flooding.
//
// Owner carve-outs (in their own sub):
//   new         posts: skipHourly only (3/day cap unchanged — brigading
//                      via fresh-sub seeding is the actual abuse vector)
//               comments: 2× daily (20)
//   recent      posts: skipHourly + 2× daily (20 in own sub)
//               comments: 2× daily (60)
//   established posts: skipHourly + 2× daily (40 in own sub)
//               comments: 2× daily (120)
// All owners also bypass the per-sub topic-flood cap in their own sub
// (handlePostNew skips checkPostRatePerSub when isOwnerOfSub).
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

const MIN_MS  = 60 * 1000;
const HOUR_MS = 60 * MIN_MS;
const DAY_MS  = 24 * HOUR_MS;

// Map a millisecond duration to a coarse English bucket. The user gets a
// real expectation of when they're unblocked; an attacker probing the
// boundary sees the same bucket across a wide range of underlying
// values, so the cap-and-window pair stays opaque.
//
// 0.10.4: replaces "try again tomorrow" / "try again in an hour" wording
// that revealed the precise tier ladder + window. Operators still see
// precise reasons in modlog audit notes and server logs.
export function bucketTimeToUnblock(ms) {
  if (ms <= 5 * MIN_MS)        return 'shortly';
  if (ms <  60 * MIN_MS)       return 'in less than an hour';
  if (ms <  4 * 60 * MIN_MS)   return 'in a few hours';
  if (ms < 12 * 60 * MIN_MS)   return 'later today';
  if (ms < 36 * 60 * MIN_MS)   return 'tomorrow';
  return 'in a couple of days';
}

// Oldest in-window content timestamp. Used to compute "when does the
// rolling cap free up" without revealing the cap to the user.
function oldestSince(db, table, handle, since, subName = null) {
  const sql = subName
    ? `SELECT MIN(created_at) AS oldest FROM ${table} WHERE handle = ? AND sub_name = ? AND created_at >= ?`
    : `SELECT MIN(created_at) AS oldest FROM ${table} WHERE handle = ? AND created_at >= ?`;
  const row = subName
    ? db.prepare(sql).get(handle, subName, since)
    : db.prepare(sql).get(handle, since);
  return row?.oldest ?? null;
}

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
    new:         { postsPerHour: 1, postsPerDay: 3,  commentsPerDay: 10 },
    recent:      { postsPerHour: 3, postsPerDay: 10, commentsPerDay: 30 },
    established: { postsPerHour: 6, postsPerDay: 20, commentsPerDay: 60 },
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
      new:         { ...RATE_LIMIT_FLOOR.perAccount.new },
      recent:      { ...RATE_LIMIT_FLOOR.perAccount.recent },
      established: { ...RATE_LIMIT_FLOOR.perAccount.established },
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
    for (const tier of ['new', 'recent', 'established']) {
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
      new:         Object.freeze(out.perAccount.new),
      recent:      Object.freeze(out.perAccount.recent),
      established: Object.freeze(out.perAccount.established),
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
export function checkPostRate(db, handle, now = Date.now(), config = DEFAULT_CONFIG, { skipHourly = false, doubledForOwner = false } = {}) {
  const tier = accountAgeTier(db, handle, now);
  const limits = config.perAccount[tier];
  if (!limits) return null;
  if (!skipHourly) {
    const hourCount = countSince(db, 'posts', handle, now - HOUR_MS);
    if (hourCount >= limits.postsPerHour) {
      const oldest = oldestSince(db, 'posts', handle, now - HOUR_MS);
      const ms = oldest != null ? Math.max(0, oldest + HOUR_MS - now) : HOUR_MS;
      return {
        message: `you've hit a posting limit. try again ${bucketTimeToUnblock(ms)}.`,
        reason: { tier, capField: 'postsPerHour', cap: limits.postsPerHour, count: hourCount, msUntilUnblocked: ms },
      };
    }
  }
  // Owner of the destination sub gets 2× the daily post cap on the
  // recent + established tiers. The new tier does NOT double — the
  // brigading vector is "create fresh account → create fresh sub →
  // flood with 6 posts in 24h"; doubling here opens it. Recent +
  // established already have community history so the carve-out
  // reads as engagement, not seed flooding.
  const dailyCap = (doubledForOwner && tier !== 'new')
    ? limits.postsPerDay * 2
    : limits.postsPerDay;
  const dayCount = countSince(db, 'posts', handle, now - DAY_MS);
  if (dayCount >= dailyCap) {
    // Time-to-unblock is the soonest of: (a) oldest in-window post falls
    // off the rolling 24h window, (b) account ages into the next tier
    // whose cap admits the current count. New tier's 3/day count of 3
    // is well under recent's 10/day, so the tier flip path matters.
    const oldest = oldestSince(db, 'posts', handle, now - DAY_MS);
    const windowMs = oldest != null ? Math.max(0, oldest + DAY_MS - now) : DAY_MS;
    const tierFlipMs = msUntilTierFlipThatLifts({ tier, db, handle, now, currentCount: dayCount, capField: 'postsPerDay', config });
    const ms = Math.min(windowMs, tierFlipMs);
    return {
      message: `you've hit a posting limit. try again ${bucketTimeToUnblock(ms)}.`,
      reason: { tier, capField: 'postsPerDay', cap: dailyCap, count: dayCount, msUntilUnblocked: ms, doubledForOwner },
    };
  }
  return null;
}

// When the cap is binding because of the *current* tier, but a near-
// future tier flip would lift the user above the count, return how long
// until that flip. Otherwise return Infinity (only the rolling-window
// path can free them). Independent of the current rolling-window math —
// caller takes min of the two.
function msUntilTierFlipThatLifts({ tier, db, handle, now, currentCount, capField, config }) {
  if (tier === 'established') return Infinity; // no further tier
  const row = db.prepare('SELECT first_seen_at FROM handles WHERE handle = ?').get(handle);
  if (!row) return Infinity;
  if (tier === 'new') {
    // new → recent at first_seen_at + 24h
    if (currentCount < config.perAccount.recent[capField]) {
      return Math.max(0, row.first_seen_at + DAY_MS - now);
    }
  } else if (tier === 'recent') {
    // recent → established at first_seen_at + 7d
    if (currentCount < config.perAccount.established[capField]) {
      return Math.max(0, row.first_seen_at + 7 * DAY_MS - now);
    }
  }
  return Infinity;
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
    // Time-to-unblock: rolling 24h window expiry on the per-sub count, OR
    // (when newish AND the trusted limit would admit the current count)
    // the 30-day "trusted" tier flip — whichever's sooner.
    const oldest = oldestSince(db, 'posts', handle, now - DAY_MS, subName);
    const windowMs = oldest != null ? Math.max(0, oldest + DAY_MS - now) : DAY_MS;
    let ms = windowMs;
    if (ageMs < TRUSTED_AGE_MS && count < config.perSubDay.trusted) {
      ms = Math.min(ms, Math.max(0, handleRow.first_seen_at + TRUSTED_AGE_MS - now));
    }
    const tierLabel = ageMs < TRUSTED_AGE_MS ? 'newish' : 'trusted';
    return {
      message: `you've hit a posting limit in /sub/${subName}. try again ${bucketTimeToUnblock(ms)}, or post in a different sub.`,
      reason: { tier: tierLabel, capField: 'perSubDay', cap: limit, count, msUntilUnblocked: ms, subName },
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
    const oldest = oldestSince(db, 'comments', handle, now - DAY_MS);
    const windowMs = oldest != null ? Math.max(0, oldest + DAY_MS - now) : DAY_MS;
    const tierFlipMs = msUntilTierFlipThatLifts({ tier, db, handle, now, currentCount: dayCount, capField: 'commentsPerDay', config });
    const ms = Math.min(windowMs, tierFlipMs);
    return {
      message: `you've hit a commenting limit. try again ${bucketTimeToUnblock(ms)}.`,
      reason: { tier, capField: 'commentsPerDay', cap, count: dayCount, msUntilUnblocked: ms, doubledForOwner },
    };
  }
  return null;
}
