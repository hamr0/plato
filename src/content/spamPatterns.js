// Spam pattern loader + matcher — PRD §Spam Defenses 9.
//
// Patterns live in spam-patterns.txt at the project root. Each non-blank
// non-comment line is a JS regex source. Loader compiles once at boot;
// matchSpamPatterns runs the compiled set against post/comment text.
//
// On match:
//   1. Caller sets collapsed_at on the target.
//   2. Caller inserts a system-handle flag with category='spam' and
//      note='pattern: <regex source>'.
//   3. Target surfaces in /modlog open mode like any other flag.
//
// Patterns are case-insensitive. Multi-line input is collapsed for
// matching (so a pattern can match across an inline newline). The loader
// is forgiving — bad patterns log to stderr and skip rather than crash
// the boot.

import { existsSync, readFileSync } from 'node:fs';

// 64-char hex sentinel handle for system-attributed flags. Seeded by
// migration 007. Module exports it so callers can attribute flags.
export const SYSTEM_HANDLE = '0'.repeat(64);

export function loadSpamPatterns(filePath) {
  if (!filePath || !existsSync(filePath)) return [];
  const raw = readFileSync(filePath, 'utf8');
  const out = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    try {
      out.push({ source: trimmed, regex: new RegExp(trimmed, 'i') });
    } catch (err) {
      console.error(`spam-patterns: skipping invalid regex ${JSON.stringify(trimmed)}: ${err.message}`);
    }
  }
  return out;
}

// Collapse target + insert one system flag (UNIQUE-deduped) + write a
// system-attributed audit row when we actually flipped state.
import { randomBytes } from 'node:crypto';

const ID_BYTES = 8;

export function applySpamMatches(db, { targetType, targetId, subName, matched, now = Date.now() }) {
  if (!matched || matched.length === 0) return { hidden: false };
  const table = targetType === 'post' ? 'posts' : 'comments';
  const result = db
    .prepare(`UPDATE ${table} SET collapsed_at = ?, score_at_collapse = score WHERE id = ? AND collapsed_at IS NULL`)
    .run(now, targetId);
  const note = `pattern: ${matched.join(' | ')}`;
  db.prepare(
    `INSERT OR IGNORE INTO flags
       (id, target_type, target_id, flagger_handle, category, note, created_at)
     VALUES (?, ?, ?, ?, 'spam', ?, ?)`
  ).run(randomBytes(ID_BYTES).toString('hex'), targetType, targetId, SYSTEM_HANDLE, note, now);
  if (result.changes > 0 && subName) {
    db.prepare(
      `INSERT INTO mod_actions
         (id, sub_name, mod_handle, action, target_type, target_id, reason, created_at)
       VALUES (?, ?, ?, 'collapse', ?, ?, ?, ?)`
    ).run(randomBytes(ID_BYTES).toString('hex'), subName, SYSTEM_HANDLE, targetType, targetId, note, now);
  }
  return { hidden: true, matched };
}

// Returns the array of pattern sources that matched, in pattern order.
// Empty array means clean. Caller decides what to do with multiple
// matches (typically: collapse + one flag per matched pattern).
export function matchSpamPatterns(text, patterns) {
  if (!text || !patterns || patterns.length === 0) return [];
  // Collapse runs of whitespace so a pattern can match across breaks
  // without authors evading via inline newlines / extra spaces.
  const haystack = text.replace(/\s+/g, ' ');
  const matched = [];
  for (const p of patterns) {
    if (p.regex.test(haystack)) matched.push(p.source);
  }
  return matched;
}
