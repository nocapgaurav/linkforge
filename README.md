# LinkForge

Most URL shortener tutorials stop at "insert a row, redirect on lookup."
LinkForge starts there and keeps going. It's a fully deployed, production-shaped
service built to explore what a shortener looks like once real traffic,
real failure modes, and real users enter the picture — authenticated
multi-tenant links, a Redis cache designed to survive an outage instead of
causing one, privacy-conscious analytics, and a deployment pipeline that
ships itself from GitHub to Azure with no stored cloud credentials.

**Live demo** — Frontend: [linkforge-web.azurewebsites.net](https://linkforge-web.azurewebsites.net) · Backend API: [linkforge-api.azurewebsites.net/api/v1](https://linkforge-api.azurewebsites.net/api/v1)

[![CI](https://github.com/nocapgaurav/linkforge/actions/workflows/ci.yml/badge.svg)](https://github.com/nocapgaurav/linkforge/actions/workflows/ci.yml)
![License](https://img.shields.io/badge/License-MIT-yellow)

---

## Highlights

- 🚀 Deployed to Azure App Service through a fully automated GitHub Actions pipeline
- 🔐 OIDC-authenticated CI/CD to GHCR and Azure — zero stored cloud secrets
- ⚡ Redis cache-aside for redirects, fail-open by design
- 🔑 JWT auth with rotating, theft-detected refresh tokens
- 📊 Privacy-conscious analytics — hashed, rotating-salt IPs, no raw PII
- 🐳 Multi-stage, non-root Docker builds with real health checks
- ✅ 250+ automated tests, run against real Postgres and Redis in CI

---

## Features

**Core**
- Custom or generated short links
- Time-based, click-based, and manual expiration
- Password-protected links
- Link editing and soft delete

**Auth**
- JWT access tokens with rotating refresh tokens
- bcrypt password hashing
- Full account management — profile, password, sessions

**Analytics**
- Per-link click analytics — time series and breakdowns by browser, device, country, referrer
- Privacy-conscious event model, no raw PII stored

**Platform**
- Redis-backed caching and rate limiting, fail-open by design
- Docker, GitHub Actions CI/CD, automated Azure deployment
- 250+ automated tests (unit + integration)

---

## Architecture

```mermaid
flowchart TD
    User(["User"])
    FE["Next.js Frontend<br/>App Router · TanStack Query"]
    API["Express API<br/>controller → service → repository"]
    Cache[("Redis<br/>cache-aside + rate limiting")]
    DB[("PostgreSQL<br/>source of truth")]
    Azure["Azure App Service<br/>two containers, one per app"]

    User -->|"browses the dashboard"| FE
    User -->|"opens a short link"| API
    FE -->|"REST, Bearer JWT"| API
    API -->|"cache-aside redirect lookup<br/>rate-limit counters"| Cache
    API -->|"Prisma + pg driver adapter"| DB
    FE -.->|"deployed as"| Azure
    API -.->|"deployed as"| Azure
```

The frontend never talks to Postgres or Redis directly — every request
goes through the Express API. The API is a layered, feature-module backend
(one vertical slice per domain: controller, service, repository), deployed
as two independent containers on Azure App Service. Full internals are in
[Documentation](#documentation) below.

---

## Getting Started

```bash
git clone https://github.com/nocapgaurav/linkforge.git
cd linkforge
cp .env.example .env   # set a real JWT_SECRET — openssl rand -hex 32
docker compose up --build
```

Open http://localhost:3001. See [`.env.example`](.env.example) and
[`frontend/.env.example`](frontend/.env.example) for the full variable
reference.

---

## Challenges Faced

Real problems hit while building and shipping this project — not
hypothetical ones.

**Prisma client generation missing in CI, but not locally.** The client is
generated to a gitignored custom output path. Locally it persisted from
repeated `prisma migrate dev` runs (which auto-generate as a side effect);
CI's production-safe `prisma migrate deploy` does not auto-generate, and
no explicit `prisma generate` step existed — so CI failed with a
missing-module error that never reproduced locally, until the asymmetry
between the two migrate commands was identified and an explicit generate
step was added in the right place (after install, before build — schema
generation needs no live database).

**A CI-only CORS and browser-redirect test failure.** Two integration
tests failed only in CI with `204` expected but `401` received on an
`OPTIONS` preflight. Cause: `FRONTEND_ORIGIN` existed in the local `.env`
(loaded automatically by `dotenv`) but was never set in CI's own
environment block — a fresh checkout has no `.env` file at all, so CORS
and the browser-redirect fallback both silently disabled themselves,
exactly as designed, in an environment that had simply never been given
the variable they depend on.

**A fire-and-forget write racing a test's own cleanup.** An integration
test's `afterAll` occasionally hit a Postgres foreign-key violation when
deleting its fixture rows. Click-event recording is deliberately
fire-and-forget in production (the redirect must never wait on an
analytics write) — but the test's cleanup sometimes ran before that last
insert completed, leaving a fresh row referencing a `urls` row about to be
deleted. Fixed with a short settle delay in teardown, a pattern already
used elsewhere in the same suite for the identical reason.

**Azure OIDC federated identity, and trusting the token over assumptions.**
An Azure login step failed with `AADSTS700213`, then `AADSTS70025`. Several
rounds of debugging initially proceeded on an unverified assumption about
the exact OIDC subject claim GitHub was issuing. The claim was ultimately
settled by adding a temporary diagnostic step that requested and decoded
the actual signed OIDC token during a real workflow run, rather than
trusting documentation or memory — the decoded token was the one artifact
that couldn't be wrong.

**Next.js build-time environment variables in a containerized deploy.**
After a successful deployment, registration failed with a `404` missing
the API's `/api/v1` prefix. The frontend code was correct;
`NEXT_PUBLIC_API_URL` is inlined at **build** time, not read at container
start, and the value used for that build was missing the `/api/v1` suffix.
Confirmed by pulling the deployed bundle and grepping the compiled output
for the inlined URL — proof from the shipped artifact, not inference from
the source.

---

## Future Improvements

- Custom domains for short links
- QR code generation per link
- Background workers / queue-based click ingestion
- Distributed / pre-aggregated analytics at high click volumes
- Multi-region deployment
- CDN in front of the redirect endpoint
- Published load-test benchmarks

---

## Project Structure

```
frontend/   Next.js dashboard
prisma/     Database schema and migrations
src/        Express API
tests/      Unit and integration tests
docs/       Design docs and API specification
.github/    CI and deployment workflows
```

---

## Documentation

Implementation details, design rationale, and operational runbooks live in
`docs/` rather than here:

- [Architecture & Codebase Walkthrough](docs/codebase-walkthrough.md)
- [API Specification](docs/api-v1-spec.md)
- [Database Design](docs/url-entity-design.md)
- [Cache Design](docs/redis-cache-design.md)
- [Analytics Design](docs/analytics-design.md)
- [Deployment](docs/azure-deployment.md)

---

## License

MIT — see [`LICENSE`](LICENSE).
