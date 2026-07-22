# LinkForge

[![CI](https://github.com/nocapgaurav/linkforge/actions/workflows/ci.yml/badge.svg)](https://github.com/nocapgaurav/linkforge/actions/workflows/ci.yml)

A production-oriented URL shortener: authenticated link management, Redis-backed
redirect caching and rate limiting, password-protected and click-limited links,
and per-link analytics — with a Next.js dashboard on top.

```
register → log in → create a short link → share it → open it anywhere
  → redirect (302) → view analytics → manage the link
```

## Stack

**Backend** — Node.js · Express 5 · TypeScript · PostgreSQL (via Prisma) · Redis
**Frontend** — Next.js 15 (App Router) · TypeScript · TanStack Query · Tailwind CSS v4 · shadcn/ui
**Engineering** — Vitest (both apps) · ESLint · GitHub Actions CI · Docker

The frontend lives in [`frontend/`](frontend) and has its own
[README](frontend/README.md) with its own setup/scripts detail. This document
covers the backend and the whole-stack (Docker) setup.

## Architecture

Layered, feature-module backend (`src/modules/<domain>/{controller,service,repository,validation,errors}.ts`),
one composition root (`src/composition.ts`) wiring everything together, a single
centralized error-to-HTTP mapping, and a Redis layer that's fail-open everywhere
it appears (cache and rate limiting both degrade to "as if Redis didn't exist"
rather than ever blocking a request). Refresh tokens rotate on every use with
theft/reuse detection; access tokens are short-lived and stateless.

Design and audit docs live in [`docs/`](docs) — start with
[`api-v1-spec.md`](docs/api-v1-spec.md) (the REST contract) and
[`codebase-walkthrough.md`](docs/codebase-walkthrough.md) (a request-lifecycle
tour: middleware → routing → controller → validation → service → repository →
Prisma).

## Running it

### Option A — Docker Compose (the whole stack)

```bash
cp .env.example .env        # then set a real JWT_SECRET (see below)
docker compose up --build
```

This builds and starts all four services — Postgres, Redis, the API
(`:3000`), and the frontend (`:3001`) — with migrations applied automatically
on backend startup. Open http://localhost:3001.

### Option B — Local dev (hot reload, no app containers)

```bash
pnpm install
pnpm db:up              # Postgres + Redis only (docker compose, just the dependencies)
cp .env.example .env     # then set a real JWT_SECRET
pnpm db:migrate
pnpm dev                 # backend on :3000

# in another terminal
cd frontend && pnpm install && pnpm dev   # frontend on :3001
```

Both paths read from the same `docker-compose.yml`; `pnpm db:up` deliberately
starts only `postgres`/`redis` (not the app services), so it stays fast and
unchanged whether or not you ever use the full Docker path.

## Environment variables

See [`.env.example`](.env.example) for the full, authoritative list (every
variable the backend reads is documented there). The one you must set
yourself: `JWT_SECRET` — generate one with `openssl rand -hex 32`. Everything
else has a sensible local-dev default.

`frontend/.env.example` documents the one frontend variable
(`NEXT_PUBLIC_API_URL`) — see [`frontend/README.md`](frontend/README.md).

## Seed data

`prisma/seed.ts` (`pnpm db:seed`) creates a demo account
(`demo@linkforge.local` / `demo-password`) for local exploration. It's
idempotent and **refuses to run when `NODE_ENV=production`** — a real
deployment never gets a demo account created automatically. This is a
deliberate design fix: an earlier migration used to seed this same account as
a side effect of a schema change; that migration is immutable (already
applied everywhere it's ever run) so it's left alone, and a later migration
(`remove_seeded_demo_user`) removes that one historical row going forward —
see that migration's comment for the full reasoning.

## Scripts

| Command | What it does |
|---|---|
| `pnpm dev` | Backend dev server (tsx watch), port 3000 |
| `pnpm build` | Compile TypeScript to `dist/` |
| `pnpm start` | Run the compiled server (`dist/server.js`) |
| `pnpm lint` | ESLint |
| `pnpm typecheck` | `tsc --noEmit` |
| `pnpm test` | Vitest (unit + integration; needs Postgres/Redis running) |
| `pnpm format` | Prettier, writes in place |
| `pnpm db:up` / `db:down` | Start/stop Postgres + Redis via Docker Compose |
| `pnpm db:migrate` | Apply Prisma migrations (dev) |
| `pnpm db:generate` | Regenerate the Prisma client |
| `pnpm db:seed` | Seed the local demo account |
| `pnpm db:studio` | Prisma Studio |

## Testing

```bash
pnpm test              # backend (needs `pnpm db:up` running)
cd frontend && pnpm test   # frontend
```

Integration tests run against a real Postgres and Redis (not mocks) —
including a test that stops the actual Redis container mid-test to verify
rate limiting fails open, not closed. CI (`.github/workflows/ci.yml`) runs
lint, typecheck, build, and the full test suite for both apps on every push
and PR.

## Security notes

JWT-signed short-lived access tokens (15 min) with rotating, hashed,
reuse-detected refresh tokens (30 days); bcrypt password hashing; Redis-backed
rate limiting (fail-open); an anti-enumeration doctrine (dead/other-owner
links return an identical `404`, never a `403` or a distinguishing message);
Helmet-applied security headers; CORS restricted to a single configured
origin. See `docs/api-v1-spec.md` §3–§4, §6, §10–§12 for the specifics.

## License

ISC — see [`LICENSE`](LICENSE).
