import { readFileSync } from 'node:fs';

// PRD spam rule 7: forum-side check. Reject disposable email domains at form
// submission, before calling knowless.startLogin. List + override + cron all
// owned by the forum operator (see docs/01-product/build-plan.md §Knowless
// Integration Spec — "policy lives with mechanism" principle).

export function loadDisposableDomains(filePath) {
  const raw = readFileSync(filePath, 'utf8');
  const set = new Set();
  for (const line of raw.split('\n')) {
    const cleaned = line.trim().toLowerCase();
    if (!cleaned || cleaned.startsWith('#')) continue;
    set.add(cleaned);
  }
  return set;
}

export function isDisposableEmail(email, domains) {
  if (typeof email !== 'string') return false;
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email.slice(at + 1).toLowerCase().trim();
  return domains.has(domain);
}
