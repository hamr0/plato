// Sub-export eligibility gate (M7/B2-b).
//
// A handle may request a sub archive when either:
//   1. They moderate the sub (owner or co-mod), or
//   2. They have been *continuously* subscribed for at least 60 days.
//
// "Continuous" falls out of the schema: unsubscribe is a hard DELETE
// (src/content/subscription.js → unsubscribe), so re-subscribing
// inserts a fresh created_at and the clock restarts. No bookkeeping
// table needed.
//
// Personal exports have no gate beyond "logged-in" — the route handler
// checks that directly. This module is sub-export only.

import { canModerate } from '../content/mod.js';
import {
  hasSubExportTenure, subExportEligibleAt, SUB_EXPORT_TENURE_MS,
} from '../content/subscription.js';

export { SUB_EXPORT_TENURE_MS };

// True if `handle` may currently request a sub archive of `subName`.
// `handle` may be null/undefined for anonymous viewers; result is false.
export function canExportSub(db, handle, subName, { now = Date.now() } = {}) {
  if (!handle || !subName) return false;
  if (canModerate(db, subName, handle)) return true;
  return hasSubExportTenure(db, handle, subName, { now });
}

// Structured eligibility for the UI's 5-state pill. Returns one of:
//   { state: 'eligible' }                               — pill is live
//   { state: 'mod' }                                    — pill is live (mod path)
//   { state: 'not-subscribed' }                         — disabled, "subscribe to request"
//   { state: 'tenure-pending', eligibleAt: <ms> }       — disabled, "you can request on …"
//   { state: 'anon' }                                   — pill renders, click → /login
export function subExportEligibility(db, handle, subName, { now = Date.now() } = {}) {
  if (!handle) return { state: 'anon' };
  if (canModerate(db, subName, handle)) return { state: 'mod' };
  if (hasSubExportTenure(db, handle, subName, { now })) return { state: 'eligible' };
  const eligibleAt = subExportEligibleAt(db, handle, subName);
  if (eligibleAt == null) return { state: 'not-subscribed' };
  return { state: 'tenure-pending', eligibleAt };
}
