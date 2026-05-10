// Per-sub flair (M5/B10).
//
// Owner-curated closed list. Stored as a JSON array on subs.flairs:
//   [{slug, label, color}, ...]
// Posts reference a flair by slug. flairs_required = 1 forces every new
// post to carry one. Slugs are sub-scoped — same slug across subs is fine.

export const MAX_FLAIRS_PER_SUB = 6;
const FLAIR_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?$/;
export const FLAIR_LABEL_MAX = 24;

// 6-digit hex only. The flair editor's <input type="color"> always emits
// `#rrggbb`, so an allowlist matches what the form can send and shrinks
// the inline-style XSS surface (no rgb()/named/CSS-keyword side doors).
const FLAIR_COLOR_RE = /^#[0-9a-f]{6}$/i;

export function validateFlair({ slug, label, color }, index = 0) {
  if (typeof slug !== 'string' || !FLAIR_SLUG_RE.test(slug)) {
    throw new Error(`flair[${index}].slug must be lowercase alphanumeric with hyphens, 1–20 chars`);
  }
  if (typeof label !== 'string' || label.length === 0 || label.length > FLAIR_LABEL_MAX) {
    throw new Error(`flair[${index}].label must be 1–${FLAIR_LABEL_MAX} characters`);
  }
  if (typeof color !== 'string' || !FLAIR_COLOR_RE.test(color.trim())) {
    throw new Error(`flair[${index}].color must be a 6-digit hex like #3b82f6`);
  }
}

export function parseFlairs(json) {
  if (json == null || json === '') return [];
  let parsed;
  try {
    parsed = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('flairs JSON is malformed');
  }
  if (!Array.isArray(parsed)) {
    throw new Error('flairs must be an array');
  }
  if (parsed.length > MAX_FLAIRS_PER_SUB) {
    throw new Error(`flairs: max ${MAX_FLAIRS_PER_SUB} per sub`);
  }
  const seen = new Set();
  parsed.forEach((f, i) => {
    validateFlair(f, i);
    if (seen.has(f.slug)) throw new Error(`flair[${i}].slug "${f.slug}" is duplicated`);
    seen.add(f.slug);
  });
  return parsed.map(({ slug, label, color }) => ({ slug, label: label.trim(), color: color.trim() }));
}

export function serializeFlairs(flairs) {
  return JSON.stringify(parseFlairs(flairs));
}

// Compute cascade operations needed when the flair editor regenerates a
// sub's flair list. Row identity is preserved: row i before the edit maps
// to row i after, so a slug change at the same row index is a "rename"
// and that row's old slug should cascade to the new slug on posts and
// drafts. A row whose label was cleared (or whose slug isn't preserved
// anywhere in the new list) is a "remove" — those rows' old slugs
// cascade to NULL.
//
// Inputs:
//   oldSlugs: array length = number of editor rows; value is slug at row i
//             before edit, '' if row was empty
//   newSlugByRow: Map<rowIndex, slug> for rows that have a slug after edit
//
// Returns: { renames: [{fromSlug, toSlug}], removes: [slug] }
//
// Carry-over rule: if an old slug appears at any new row position, no
// cascade fires for it (it's just been moved — same identity). Renames
// require row-position match AND new slug not used at any other row's
// old slug position, so swap-style edits don't trigger spurious cascades.
export function computeFlairChanges(oldSlugs, newSlugByRow) {
  const oldSlugSet = new Set(oldSlugs.filter(Boolean));
  const newSlugSet = new Set(newSlugByRow.values());
  const renames = [];
  for (let i = 0; i < oldSlugs.length; i++) {
    const oldSlug = oldSlugs[i];
    const newSlug = newSlugByRow.get(i);
    if (oldSlug && newSlug && oldSlug !== newSlug && !oldSlugSet.has(newSlug)) {
      renames.push({ fromSlug: oldSlug, toSlug: newSlug });
    }
  }
  const renameFroms = new Set(renames.map((r) => r.fromSlug));
  const removes = [];
  for (const oldSlug of oldSlugSet) {
    if (!newSlugSet.has(oldSlug) && !renameFroms.has(oldSlug)) {
      removes.push(oldSlug);
    }
  }
  return { renames, removes };
}

