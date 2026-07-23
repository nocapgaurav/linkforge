# LinkForge

LinkForge is a URL shortener with authenticated link management, per-link
analytics, and Redis-backed caching and rate limiting. It's built as a
full-stack app — an Express API and a Next.js dashboard — to explore how a
small product like this is put together end to end, not just how a redirect
works.

Secure links • Analytics • Redis caching • Dockerized • Fully tested

---

## Features

- JWT authentication with rotating, reuse-detected refresh tokens
- Password-protected short links
- Click-limited links (auto-expire after N clicks)
- Redis cache-aside redirects
- Redis-backed rate limiting (fails open if Redis is unavailable)
- Per-link analytics: clicks over time, countries, browsers, devices, referrers
- Dockerized development and deployment (Postgres, Redis, API, frontend)
- Automated test suite (Vitest, backend + frontend)
- GitHub Actions CI (lint, typecheck, build, test on every push/PR)

## Architecture

```
Next.js Dashboard
        │
        ▼
 Express API
        │
 ┌──────┴─────────┐
 ▼                ▼
Redis        PostgreSQL
(Cache)      (Source of Truth)
```

The frontend talks only to the Express API. Postgres is the source of truth;
Redis sits in front of it as a cache for redirects and as the store for rate
limiting — if Redis goes down, both degrade to "as if Redis didn't exist"
rather than blocking requests. Further design notes live under
[`docs/`](docs).

## Repository Structure

```
frontend/   Next.js dashboard (App Router)
prisma/     Database schema, migrations, seed script
src/        Express API (routes, modules, services, repositories)
tests/      Backend unit + integration tests
docs/       API spec, architecture and design notes
```

## Getting Started

### Option A — Docker Compose (whole stack)

Requires Docker running locally.

```bash
git clone https://github.com/nocapgaurav/linkforge.git
cd linkforge
cp .env.example .env        # then set a real JWT_SECRET, see below
docker compose up --build
```

This builds and starts all four services — Postgres, Redis, the API
(`:3000`), and the frontend (`:3001`) — and applies migrations automatically
on backend startup.

Open http://localhost:3001.

### Option B — Local dev (hot reload)

Backend and frontend run in separate terminals.

**1. Clone and install**

```bash
git clone https://github.com/nocapgaurav/linkforge.git
cd linkforge
pnpm install
```

**2. Configure environment variables**

```bash
cp .env.example .env
```

Set `JWT_SECRET` in `.env` — generate one with `openssl rand -hex 32`.
Everything else in `.env.example` has a working local-dev default.

**3. Start Postgres and Redis** (Docker must be running)

```bash
pnpm db:up
```

This starts only the `postgres` and `redis` services from
`docker-compose.yml` — not the app containers.

**4. Run database migrations**

```bash
pnpm db:migrate
```

**5. Seed the database** (optional)

```bash
pnpm db:seed
```

Creates a demo account (`demo@linkforge.local` / `demo-password`).

**6. Start the backend**

```bash
pnpm dev
```

Runs on http://localhost:3000.

**7. Start the frontend** (in a second terminal)

```bash
cd frontend
pnpm install
cp .env.example .env.local
pnpm dev
```

Runs on http://localhost:3001.

**8. Open the app**

http://localhost:3001

## Running Tests

```bash
# Backend (needs `pnpm db:up` running)
pnpm test
pnpm lint
pnpm typecheck

# Frontend
cd frontend
pnpm test
pnpm lint
pnpm typecheck
```

## Documentation

- [API Specification](docs/api-v1-spec.md)
- [Codebase Walkthrough](docs/codebase-walkthrough.md)
- [URL Entity Design](docs/url-entity-design.md)
- [Redis Cache Design](docs/redis-cache-design.md)
- [Analytics Design](docs/analytics-design.md)

## License

MIT — see [`LICENSE`](LICENSE).
