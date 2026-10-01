# syntax=docker/dockerfile:1.7

# Formcraft, as two images from one file.
#
#   runner   — the app. Slim, standalone output, plus Chromium because
#              rendering a submission to PDF is a first-class feature.
#   migrator — the same source with dev dependencies kept, so `tsx` and
#              drizzle-kit exist. Run once per deploy, then exits.
#
# They are separate because the runtime needs neither tsx nor the drizzle CLI,
# and a long-lived container should not carry a toolchain it never uses.

ARG NODE_VERSION=22-bookworm-slim

# ---------------------------------------------------------------------------
# deps — the pnpm store, cached across builds
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS deps
WORKDIR /repo

RUN corepack enable

# Only the manifests, so a source edit does not re-resolve the whole workspace.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
COPY packages/schema/package.json packages/schema/

# Chromium comes from the distribution, not from Playwright's downloader: the
# image already has to install system libraries for it, and two copies of a
# browser is 300MB nobody asked for.
ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1

RUN --mount=type=cache,id=pnpm,target=/pnpm/store \
    PNPM_HOME=/pnpm pnpm install --frozen-lockfile

# ---------------------------------------------------------------------------
# builder — `next build`
# ---------------------------------------------------------------------------
FROM deps AS builder
WORKDIR /repo

COPY . .

# next/font fetches the four families at build time and serves them from our
# own origin afterwards. That means **this stage needs outbound access to
# fonts.googleapis.com**. Without it the build fails, or worse succeeds with
# fallback metrics and every PDF stops matching its design.
RUN pnpm --filter web build

# ---------------------------------------------------------------------------
# migrator — applies migrations, then exits
# ---------------------------------------------------------------------------
FROM deps AS migrator
WORKDIR /repo

COPY . .

# Idempotent by construction: drizzle records what it has applied, and CI
# proves re-running is a no-op by doing it twice on every push.
CMD ["pnpm", "--filter", "web", "db:migrate"]

# ---------------------------------------------------------------------------
# runner — what actually serves traffic
# ---------------------------------------------------------------------------
FROM node:${NODE_VERSION} AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# chromium              — the PDF worker
# fonts-liberation,
#   fontconfig          — Chromium refuses to start without any font at all,
#                         even though the design's four families are served by
#                         the app itself
# ca-certificates       — TLS to Postgres and to Resend
# tini                  — PID 1 that reaps the zombie processes a browser
#                         leaves behind; without it they accumulate until the
#                         container cannot fork
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      chromium \
      fontconfig \
      fonts-liberation \
      ca-certificates \
      tini \
 && rm -rf /var/lib/apt/lists/*

ENV CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium

# Not root. The app writes only to the uploads volume, mounted below.
RUN groupadd --system --gid 1001 formcraft \
 && useradd --system --uid 1001 --gid formcraft formcraft

# Standalone output: the traced server, then the two things tracing leaves out.
COPY --from=builder --chown=formcraft:formcraft /repo/apps/web/.next/standalone ./
COPY --from=builder --chown=formcraft:formcraft /repo/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=formcraft:formcraft /repo/apps/web/public ./apps/web/public

# Uploaded logos and file answers. A volume in compose — without one they are
# lost on every deploy, because a container's filesystem is not storage.
ENV UPLOADS_DIR=/data/uploads
RUN mkdir -p /data/uploads && chown -R formcraft:formcraft /data
VOLUME ["/data/uploads"]

USER formcraft
EXPOSE 3000

# The PDF worker fetches its own pages over loopback, inside this container.
ENV RENDER_ORIGIN=http://127.0.0.1:3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "apps/web/server.js"]
