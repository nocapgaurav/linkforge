# syntax=docker/dockerfile:1

# Multi-stage build for the LinkForge API.
#
# Driver-adapter Prisma (@prisma/adapter-pg) means no native query-engine
# binary to worry about across build/runtime stages — pure JS, which is
# exactly why this pattern was chosen (see prisma/schema.prisma comments).
#
# `prisma` (the CLI) is a production dependency here, not a dev one: the
# runtime image runs `prisma migrate deploy` on boot before starting the
# server, so the CLI genuinely ships to production — it isn't dead weight.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate

# ---- deps: full install (dev+prod), reused only by the build stage ----
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build: generate the Prisma client, compile TypeScript ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json prisma.config.ts ./
COPY prisma ./prisma
COPY src ./src
RUN pnpm exec prisma generate
RUN pnpm build

# ---- prod-deps: production-only install for the runtime image ----
FROM base AS prod-deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --prod --frozen-lockfile

# ---- runtime: minimal final image ----
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup -S linkforge && adduser -S linkforge -G linkforge

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json prisma.config.ts ./
COPY prisma ./prisma

USER linkforge

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# migrate deploy is safe to run on every boot for this single-instance
# compose setup (no concurrent-replica race); it's a no-op when the schema
# is already current. Never seeds demo data — that's prisma/seed.ts, run
# explicitly and only outside production (see docs/environment.md).
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy && node dist/server.js"]
