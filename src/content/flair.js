// Per-sub flair (M5/B10).
//
// Owner-curated closed list. Stored as a JSON array on subs.flairs:
//   [{slug, label, color}, ...]
// Posts reference a flair by slug. flairs_required = 1 forces every new
// post to carry one. Slugs are sub-scoped — same slug across subs is fine.

export const MAX_FLAIRS_PER_SUB = 12;
const FLAIR_SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,18}[a-z0-9])?$/;
export const FLAIR_LABEL_MAX = 24;

// Same guard as resolveBrandingColors in app.js: any CSS color string is
// fine (hex, rgb(), named) but reject characters that can break out of
// the style attribute and inject rules.
const COLOR_UNSAFE_RE = /[;{}<>"']/;

export function validateFlair({ slug, label, color }, index = 0) {
  if (typeof slug !== 'string' || !FLAIR_SLUG_RE.test(slug)) {
    throw new Error(`flair[${index}].slug must be lowercase alphanumeric with hyphens, 1–20 chars`);
  }
  if (typeof label !== 'string' || label.length === 0 || label.length > FLAIR_LABEL_MAX) {
    throw new Error(`flair[${index}].label must be 1–${FLAIR_LABEL_MAX} characters`);
  }
  if (typeof color !== 'string' || color.trim().length === 0) {
    throw new Error(`flair[${index}].color is required`);
  }
  const trimmedColor = color.trim();
  if (COLOR_UNSAFE_RE.test(trimmedColor)) {
    throw new Error(`flair[${index}].color contains invalid characters`);
  }
  if (trimmedColor.length > 32) {
    throw new Error(`flair[${index}].color too long`);
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

