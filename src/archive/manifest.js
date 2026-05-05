// Archive manifest — plato's interop format (M7/B1).
//
// This module owns the manifest.json shape inside every plato archive.
// It does NOT pack the tarball, render HTML, or sign anything; those are
// separate concerns layered on top in B2/B3 (packing) and B4 (signing).
//
// The canonical spec lives in docs/02-features/archive-format.md. If the
// two ever drift, the doc wins; this module's job is to produce manifests
// that match the spec exactly.

import { createHash } from 'node:crypto';

export const FORMAT_VERSION = 1;
export const MANIFEST_FILENAME = 'manifest.json';

// Hash a buffer or string. Returns 64-char lowercase hex.
export function sha256Hex(bytes) {
  const h = createHash('sha256');
  h.update(typeof bytes === 'string' ? Buffer.from(bytes, 'utf8') : bytes);
  return h.digest('hex');
}

// Build a manifest from already-hashed file entries. Caller is responsible
// for hashing because file content may be streamed from disk in B2/B3 and
// we want hashing to happen at write-time (one pass) rather than re-reading.
//
// `files` is an array of { path, sha256, size } objects in any order;
// this function sorts by `path` for deterministic output.
//
// `scope` is { sub: <name> } for kind="sub", { handle_attribution: <pseudonym> }
// for kind="user". Validated below.
//
// `instance` is { forum_name, base_url } from the operator's branding;
// pubkey_fingerprint is null in v1 (M7/B4 will populate).
export function buildManifest({
  kind,
  scope,
  instance,
  exportedAt = new Date().toISOString(),
  platoVersion,
  counts,
  files,
}) {
  validateKind(kind);
  validateScope(kind, scope);
  validateInstance(instance);
  validateCounts(counts);
  validateFiles(files);

  const sortedFiles = [...files]
    .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
    .map((f) => ({ path: f.path, sha256: f.sha256, size: f.size }));

  return {
    format_version: FORMAT_VERSION,
    plato_version: platoVersion,
    kind,
    scope,
    exported_at: exportedAt,
    instance: {
      forum_name: instance.forum_name,
      base_url: instance.base_url,
      pubkey_fingerprint: instance.pubkey_fingerprint ?? null,
    },
    counts: {
      posts: counts.posts,
      comments: counts.comments,
      mod_actions: counts.mod_actions,
      subs: counts.subs,
    },
    files: sortedFiles,
  };
}

// Parse + validate a manifest object (typically read from manifest.json).
// Throws on any malformed shape so importers fail loudly, not silently.
// Returns the manifest unchanged if valid.
export function validateManifest(m) {
  if (!m || typeof m !== 'object') throw new Error('manifest: not an object');
  if (m.format_version !== FORMAT_VERSION) {
    throw new Error(`manifest: unsupported format_version ${m.format_version} (expected ${FORMAT_VERSION})`);
  }
  if (typeof m.plato_version !== 'string') throw new Error('manifest: plato_version must be a string');
  validateKind(m.kind);
  validateScope(m.kind, m.scope);
  if (typeof m.exported_at !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(m.exported_at)) {
    throw new Error('manifest: exported_at must be an ISO 8601 timestamp');
  }
  validateInstance(m.instance);
  validateCounts(m.counts);
  validateFiles(m.files);
  return m;
}

// Locate a file entry by path. Returns the entry or undefined.
export function findFile(manifest, path) {
  return manifest.files.find((f) => f.path === path);
}

// Verify a file's bytes match the manifest's recorded sha256. Used by
// importers and audit tools. Returns true/false; does not throw.
export function verifyFile(manifest, path, bytes) {
  const entry = findFile(manifest, path);
  if (!entry) return false;
  return sha256Hex(bytes) === entry.sha256;
}

// --- internal validators ---

function validateKind(kind) {
  if (kind !== 'sub' && kind !== 'user') {
    throw new Error(`manifest: kind must be 'sub' or 'user', got ${JSON.stringify(kind)}`);
  }
}

function validateScope(kind, scope) {
  if (!scope || typeof scope !== 'object') throw new Error('manifest: scope must be an object');
  if (kind === 'sub') {
    if (typeof scope.sub !== 'string' || scope.sub.length === 0) {
      throw new Error('manifest: scope.sub must be a non-empty string for kind=sub');
    }
  } else {
    if (typeof scope.handle_attribution !== 'string' || scope.handle_attribution.length === 0) {
      throw new Error('manifest: scope.handle_attribution must be a non-empty string for kind=user');
    }
  }
}

function validateInstance(instance) {
  if (!instance || typeof instance !== 'object') throw new Error('manifest: instance must be an object');
  if (typeof instance.forum_name !== 'string') throw new Error('manifest: instance.forum_name must be a string');
  if (typeof instance.base_url !== 'string') throw new Error('manifest: instance.base_url must be a string');
  if (instance.pubkey_fingerprint != null && typeof instance.pubkey_fingerprint !== 'string') {
    throw new Error('manifest: instance.pubkey_fingerprint must be null or a string');
  }
}

function validateCounts(counts) {
  if (!counts || typeof counts !== 'object') throw new Error('manifest: counts must be an object');
  for (const k of ['posts', 'comments', 'mod_actions', 'subs']) {
    if (!Number.isInteger(counts[k]) || counts[k] < 0) {
      throw new Error(`manifest: counts.${k} must be a non-negative integer`);
    }
  }
}

function validateFiles(files) {
  if (!Array.isArray(files)) throw new Error('manifest: files must be an array');
  const seen = new Set();
  for (const f of files) {
    if (!f || typeof f !== 'object') throw new Error('manifest: every files[] entry must be an object');
    if (typeof f.path !== 'string' || f.path.length === 0) throw new Error('manifest: file.path must be a non-empty string');
    if (f.path.includes('..') || f.path.startsWith('/')) {
      throw new Error(`manifest: file.path must be relative and not traverse parents: ${f.path}`);
    }
    if (typeof f.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(f.sha256)) {
      throw new Error(`manifest: file.sha256 must be 64-char lowercase hex: ${f.path}`);
    }
    if (!Number.isInteger(f.size) || f.size < 0) {
      throw new Error(`manifest: file.size must be a non-negative integer: ${f.path}`);
    }
    if (seen.has(f.path)) throw new Error(`manifest: duplicate file path: ${f.path}`);
    seen.add(f.path);
  }
}
