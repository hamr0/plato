#!/bin/sh
# Docker eval-image first-boot setup. Generates a fresh KNOWLESS_SECRET
# on first run (persisted to /app/data/knowless-secret if /app/data is a
# mounted volume; ephemeral otherwise), runs migrations, then execs the
# server. Production deploys do NOT go through this script — they use
# `npm start` directly with an operator-managed .env.
#
# /bin/sh because alpine ships busybox `ash`, not bash.

set -eu

SECRET_FILE="/app/data/knowless-secret"

if [ -z "${KNOWLESS_SECRET:-}" ]; then
  if [ -f "$SECRET_FILE" ]; then
    KNOWLESS_SECRET=$(cat "$SECRET_FILE")
  else
    # node --print is the cross-distro way; openssl/sha256sum aren't
    # guaranteed to be on a node:22-alpine image.
    KNOWLESS_SECRET=$(node --print "require('crypto').randomBytes(32).toString('hex')")
    echo "$KNOWLESS_SECRET" > "$SECRET_FILE"
    chmod 600 "$SECRET_FILE"
    echo "[entrypoint] generated KNOWLESS_SECRET → $SECRET_FILE" >&2
  fi
  export KNOWLESS_SECRET
fi

echo "[entrypoint] running migrations..." >&2
node bin/migrate.js

# Curated demo content for the eval image. The seed is itself
# idempotent (skips if //lobby already exists) so a restart with a
# persistent volume preserves whatever the evaluator did.
if [ "${PLATO_EVAL_SEED:-0}" = "1" ]; then
  echo "[entrypoint] seeding eval content..." >&2
  node bin/eval-seed.js || echo "[entrypoint] eval seed failed (non-fatal)" >&2
fi

echo "[entrypoint] starting plato on :${PORT:-8080}" >&2
exec node bin/server.js
