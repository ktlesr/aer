# Production image for the AER web app (apps/web) — pnpm monorepo, Next.js 16, Prisma 7.
# Build context MUST be the repo root (it needs pnpm-workspace.yaml + the lockfile + packages/).
# Prisma 7 uses driver adapters (pg), so there is NO native query-engine binary to ship.
#
#   docker build -t aer-web .
#   docker run -e DATABASE_URL=postgres://... -p 3000:3000 aer-web
# On Dokploy: Build Type = Dockerfile, context = repo root, exposed port = 3000.
# syntax=docker/dockerfile:1

FROM node:22-slim AS base
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"
# openssl: required by the Prisma migration engine (`migrate deploy`) on first deploy.
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# Build stage: install all deps, generate the Prisma client, build Next.
# ---------------------------------------------------------------------------
FROM base AS build
# A throwaway URL so module-level Prisma init during `next build` never throws.
# No DB connection is made at build time (dashboard pages are force-dynamic).
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build?schema=public"

# Manifests first for layer caching.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/web/package.json apps/web/package.json
COPY packages/collector-js/package.json packages/collector-js/package.json
COPY packages/demo-agent/package.json packages/demo-agent/package.json
RUN pnpm install --frozen-lockfile

# Source + build (the web `build` script runs `prisma generate` first).
COPY . .
RUN pnpm --filter web build

# ---------------------------------------------------------------------------
# Runner stage: production env, run migrations then start Next.
# ---------------------------------------------------------------------------
FROM base AS runner
ENV NODE_ENV=production
COPY --from=build /app /app
WORKDIR /app/apps/web
EXPOSE 3000
# Apply any pending migrations to the live DB, then serve.
CMD ["sh", "-c", "pnpm exec prisma migrate deploy && pnpm start"]
