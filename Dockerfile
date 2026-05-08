# Evaluation image — for tinkering with plato in 30 seconds.
#
#   docker run --rm -p 8080:8080 ghcr.io/hamr0/plato:latest
#
# This is NOT a production deploy path. plato is single-process /
# single-SQLite / single-port and runs better as a systemd service
# than as a container. See docs/02-features/operator-guide.md
# §Why no docker for production for the reasoning.
#
# What this image does for an evaluator:
# - Boots a fresh forum at http://localhost:8080 with a yellow strip
#   at the top flagging "evaluation image".
# - Generates KNOWLESS_SECRET on first boot (persisted to /app/data
#   if a volume is mounted there; ephemeral otherwise).
# - Prints magic-link login URLs to docker logs (no SMTP needed).
# - Runs migrations automatically.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM node:22-alpine
WORKDIR /app

# Non-root for blast radius. node:22-alpine ships a `node` user (uid 1000).
COPY --from=deps --chown=node:node /app/node_modules ./node_modules
COPY --chown=node:node package.json package-lock.json* ./
COPY --chown=node:node bin ./bin
COPY --chown=node:node src ./src
COPY --chown=node:node disposable-domains.txt spam-patterns.txt ./

# Mountable persistence dir. Without -v plato-data:/app/data the
# container is fully ephemeral on restart; with it, forum.db +
# knowless.db + posts/ + exports/ + the generated KNOWLESS_SECRET
# survive across restarts.
RUN mkdir -p /app/data /app/data/posts /app/data/exports && \
    chown -R node:node /app/data
VOLUME /app/data

ENV PORT=8080 \
    KNOWLESS_BASE_URL=http://localhost:8080 \
    KNOWLESS_FROM=auth@plato.local \
    KNOWLESS_DEV_LOG_LINKS=true \
    DB_PATH=/app/data/forum.db \
    KNOWLESS_DB_PATH=/app/data/knowless.db \
    POSTS_DIR=/app/data/posts \
    EXPORTS_DIR=/app/data/exports \
    PLATO_EVAL_BANNER=1 \
    PLATO_EVAL_SEED=1 \
    NODE_ENV=production

USER node
EXPOSE 8080

# /healthz already exists (M8/B2) — Docker uses it for the platform-side
# readiness probe.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://localhost:8080/healthz || exit 1

ENTRYPOINT ["bin/docker-entrypoint.sh"]
