#!/usr/bin/env bash
# Generate a 32-byte hex secret suitable for KNOWLESS_SECRET in plato's .env.
#
# This is the single source of truth for "how do I generate the secret?".
# The deploy guide, .env.example, and preflight error messages all point
# here so operators don't have to paste a multi-line `node -e "..."`
# incantation that's easy to mangle in terminal pastes.
#
# Usage:
#   bin/gen-secret.sh                     # prints 64 hex chars + newline
#   SECRET=$(bin/gen-secret.sh)           # capture into a shell var
#   bin/gen-secret.sh > /tmp/secret.txt   # write to file
#
# IMPORTANT: the secret derives every user's identity hash. Generate it
# ONCE per instance, back it up somewhere safe, never rotate. Losing or
# changing the secret means every user looks like a new account.

set -euo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "gen-secret: node not on PATH" >&2
  exit 1
fi

node -e "process.stdout.write(require('crypto').randomBytes(32).toString('hex'))"
echo
