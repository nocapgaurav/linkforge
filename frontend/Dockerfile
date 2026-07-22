# syntax=docker/dockerfile:1

# Multi-stage build for the LinkForge frontend (Next.js standalone output).
#
# Build context is the REPO ROOT, not this directory — this is a pnpm
# workspace (see /pnpm-workspace.yaml), so the lockfile lives at the root
# and covers both projects; a frontend-only build context would have no
# lockfile to install from. See docker-compose.yml's `build.context`.
#
# NEXT_PUBLIC_* variables are inlined into the client bundle at BUILD time,
# not read at container start — so NEXT_PUBLIC_API_URL must be supplied as
# a build ARG (see docker-compose.yml's `build.args`), not a runtime
# `environment:` entry. This is a Next.js constraint, not a choice made
# here, and is worth calling out because it's a common Docker+Next.js
# mistake to get backwards.

ARG NODE_VERSION=22-alpine

FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@11.15.0 --activate

# ---- deps ----
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend/package.json ./frontend/package.json
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/frontend/node_modules ./frontend/node_modules
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
COPY frontend ./frontend
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
WORKDIR /app/frontend
RUN pnpm build

# ---- runtime: minimal final image (Next.js standalone server) ----
#
# The standalone output's node_modules are pnpm symlinks with relative
# targets (e.g. frontend/node_modules/next -> ../../node_modules/.pnpm/...)
# that assume the ORIGINAL monorepo nesting (frontend/ as a sibling of the
# hoisted root node_modules). Flattening frontend/'s contents up to /app
# shifts every relative symlink one level and breaks them all ("Cannot
# find module 'next'" at boot, despite the file listing looking correct).
# The fix is to preserve that nesting exactly — copy the whole
# .next/standalone tree as-is and run server.js from inside frontend/.
FROM node:${NODE_VERSION} AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=3001 HOSTNAME=0.0.0.0

RUN addgroup -S linkforge && adduser -S linkforge -G linkforge

COPY --from=build --chown=linkforge:linkforge /app/frontend/.next/standalone ./
COPY --from=build --chown=linkforge:linkforge /app/frontend/.next/static ./frontend/.next/static
COPY --from=build --chown=linkforge:linkforge /app/frontend/public ./frontend/public

USER linkforge

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3001)).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "frontend/server.js"]
