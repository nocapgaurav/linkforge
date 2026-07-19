# LinkForge — Codebase Walkthrough (v1, as of 2026-07-19)

Audience: a senior backend engineer joining the project. This document
describes what exists today — no proposals, no future features. Companion
design documents live in `docs/` (`url-entity-design.md`, `api-v1-spec.md`,
`architecture-review-v1.md`).

---

## 1. High-level architecture

LinkForge is a TypeScript/Express 5 backend with a strict layered
architecture. Each layer has one responsibility and depends only inward:

```
HTTP request
  │
  ▼
Middleware stack (app.ts)          assigns request id, logs, parses JSON
  │
  ▼
Routing (routes/index.ts,          maps method+path → controller handler;
         url.routes.ts)            contains zero logic
  │
  ▼
Controller (url.controller.ts)     validates raw input, calls the service,
  │                                maps domain objects → API resources
  ▼
Validation (url.validation.ts)     Zod schemas; wire input → typed values
  │
  ▼
Service (url.service.ts)           ALL business rules: hashing, code
  │                                generation, visibility rules, conflicts
  ▼
Repository (url.repository.ts)     persistence only; the ONLY module file
  │                                that imports Prisma
  ▼
Prisma client (config/prisma.ts)   connection factory (driver adapter)
  │
  ▼
PostgreSQL (docker, table: urls)
```

Errors flow the other way: the service throws domain errors
(`url.errors.ts`), controllers throw `RequestValidationError`, and a single
global error handler (`shared/http/error-handler.ts`) converts every thrown
error into the standard JSON envelope with the right status code.
Controllers contain no try/catch anywhere.

**Request lifecycle, concretely** (e.g. `POST /api/v1/urls`):

1. `requestId` middleware assigns a UUID, sets `X-Request-Id` header.
2. `requestLogger` hooks the response finish event.
3. `express.json()` parses the body (parse failure → 400 `MALFORMED_JSON`).
4. Router dispatches to `urlController.createUrl`.
5. Controller runs `validateCreateUrlBody(req.body)`; on failure throws
   `RequestValidationError` (→ 400 with per-field details).
6. Controller calls `urlService.create(validatedBody)`.
7. Service normalizes the URL, computes SHA-256, generates/uses a short
   code, calls `urlRepository.create(...)`.
8. Repository executes the Prisma insert; unique violations become
   `ShortCodeConflictError`, which the service translates to
   `AliasAlreadyExistsError` (→ 409) or a generation retry.
9. Controller maps the domain `Url` to the public resource and responds
   `201` via the `created()` helper with a `Location` header.
10. The logger emits one JSON line: method, path, status, durationMs,
    requestId.

## 2. Folder structure

```
linkforge/
├── docker-compose.yml      # postgres:17-alpine + persistent volume + healthcheck
├── prisma/
│   ├── schema.prisma       # datasource + Url model (source of truth for DB shape)
│   └── migrations/         # one migration: 20260718204947_init
├── prisma.config.ts        # Prisma 7 CLI config; loads .env, feeds DATABASE_URL
├── docs/                   # design documents (entity, API spec, reviews)
├── src/
│   ├── app.ts              # Express app assembly: middleware + routers, exported for tests
│   ├── server.ts           # process entry: listen + graceful shutdown (SIGINT/SIGTERM)
│   ├── config/
│   │   ├── env.ts          # typed env access; fails fast on missing DATABASE_URL
│   │   └── prisma.ts       # PrismaClient factory (adapter-pg) + disconnectPrisma()
│   ├── generated/prisma/   # generated Prisma client (gitignored, never hand-edited)
│   ├── modules/url/        # the single feature module (7 files, see §3)
│   ├── routes/index.ts     # health endpoint + versioned /api/v1 composition
│   ├── shared/
│   │   ├── http/           # response envelopes, error handler, async wrapper,
│   │   │                   #   request-id, 404 handler
│   │   └── middleware/     # request-logger
│   └── utils/validation.ts # generic Zod→envelope helpers (module-agnostic)
└── tests/
    ├── unit/url/           # service + controller tests (mocked boundaries)
    └── integration/        # supertest against real app + real Postgres
```

Why each exists: `config/` isolates process-boundary concerns (env, DB
client); `modules/` groups code by feature so future modules (teams, auth)
land beside `url/` without touching it; `shared/` holds HTTP machinery any
module can use; `utils/` holds framework-free helpers; `generated/` keeps
machine-written code out of review; `docs/` records the contracts the code
implements.

## 3. The URL module (`src/modules/url/`)

| File | Responsibility |
|---|---|
| `url.routes.ts` | Two Express routers, routing only. `urlRouter`: `POST /`, `GET /:shortCode`, `DELETE /:shortCode` (mounted at `/api/v1/urls`). `redirectRouter`: root-level `GET /:shortCode`, kept separate so `app.ts` mounts it after the API routes. |
| `url.controller.ts` | `createUrlController(service)` factory returning four thin handlers (validate → service → respond), each wrapped in `asyncHandler`. Also holds `toUrlResource()`: domain `Url` → public API resource (drops `id`/`urlHash`/`createdBy`/`deletedAt`, converts `clickCount` bigint→number, dates→ISO strings, computes `shortUrl` from `env.baseUrl`). Exports the wired `urlController`. |
| `url.service.ts` | `UrlService` interface + `DefaultUrlService` (repository constructor-injected) + wired `urlService`. Owns every business rule: URL normalization (`new URL().toString()`), SHA-256 `urlHash`, 7-char base62 code generation via `crypto.randomInt` with a 5-attempt collision retry, alias conflict translation, redirect visibility rules (active AND not expired), management visibility rules (soft-deleted only hidden), soft delete returning the tombstone timestamp. |
| `url.repository.ts` | `UrlRepository` interface + `PrismaUrlRepository` (PrismaClient constructor-injected) + wired `urlRepository`. Six methods: `create`, `findByShortCode`, `findById`, `update`, `incrementClickCount` (atomic `increment: 1`), `softDelete`. Treats soft-deleted rows as gone (finds return null; writes refuse). Translates Prisma P2002 → `ShortCodeConflictError`, P2025 → `null`. The only module file importing Prisma. |
| `url.validation.ts` | Zod 4 schemas + one-call validators. `createUrlBodySchema` (strict object: `originalUrl` trimmed/≤2048/http(s); optional `customAlias` 3–32 `[A-Za-z0-9_-]` minus reserved words; optional future-dated `expiresAt`, null = never), `shortCodeParamsSchema`, `analyticsQuerySchema` (spec §7, validated but endpoint not implemented). Exports inferred types (`CreateUrlBody`, …). |
| `url.errors.ts` | Domain errors on a `UrlDomainError` base: `UrlNotFoundError`, `AliasAlreadyExistsError`, `ShortCodeGenerationError`. Framework-free; the global error handler maps them to 404/409/500. |
| `url.types.ts` | The persistence contract: domain `Url` (mirrors the table, no Prisma types), `CreateUrlInput`, `UpdateUrlInput`, and `ShortCodeConflictError` (the repo-level conflict error). |

**Interaction summary**: routes bind controller handlers; the controller
validates with `url.validation.ts`, calls the service, and shapes responses;
the service enforces rules and calls the repository through its interface;
the repository talks to Prisma. Errors defined in `url.errors.ts`/
`url.types.ts` cross layers upward and are mapped to HTTP exactly once, in
the global handler.

## 4. Infrastructure

- **Prisma (7.8.0)**: new Rust-free architecture. `prisma.config.ts` powers
  the CLI (loads `.env` via dotenv); the runtime client is generated into
  `src/generated/prisma` and connects through `@prisma/adapter-pg` with the
  connection string from env. `config/prisma.ts` builds the singleton
  (query logging in development, warn/error otherwise) and exports
  `disconnectPrisma()` for shutdown.
- **Environment (`config/env.ts`)**: loads dotenv, exposes `port`,
  `nodeEnv`, `databaseUrl` (required — process fails fast if missing), and
  `baseUrl` (from `PUBLIC_BASE_URL`; named that way because plain
  `BASE_URL` is a reserved Vite/Vitest builtin that shadows it in tests).
- **HTTP utilities (`shared/http/`)**:
  - `response.ts` — the only place envelopes are built: `success()`,
    `created()` (201 + Location), `deleted()`, `fail()`/`errorEnvelope()`.
  - `async-handler.ts` — wraps async handlers so rejections reach the error
    middleware (Express 5 also does this natively; the wrapper keeps the
    contract explicit).
  - `error-handler.ts` — global error→HTTP mapping (see §1) plus
    `RequestValidationError`, the throwable wrapper for validation
    failures. Unknown errors are logged (name, message, stack, requestId)
    and answered with a generic 500; internals never leak.
  - `not-found.ts` — terminal 404 envelope for unmatched routes.
  - `request-id.ts` — UUID per request on `req.requestId` (typed via
    declaration merging) + `X-Request-Id` response header.
- **Logging (`shared/middleware/request-logger.ts`)**: one structured JSON
  console line per response: `method, path, status, durationMs, requestId`
  (hrtime-based duration). Server lifecycle events (`server_started`,
  `shutdown_*`) log in the same style from `server.ts`.
- **Graceful shutdown (`server.ts`)**: SIGINT/SIGTERM → stop accepting
  connections → drain in-flight requests → `disconnectPrisma()` → exit 0,
  with a 10s unref'd watchdog that force-exits if anything hangs.

## 5. API surface (implemented today)

Envelope: every non-redirect response is
`{"success":true,"data":…}` or
`{"success":false,"error":{"code","message","details?"}}`.

| # | Endpoint | Behavior |
|---|---|---|
| 1 | `GET /health` | Liveness probe → `200 {"status":"ok"}`. |
| 2 | `POST /api/v1/urls` | Create a short link. Body: `originalUrl` (required), `customAlias?`, `expiresAt?`. Flow: validate → normalize+hash → alias or generated code → insert. `201` + `Location` + URL resource. Errors: 400 `VALIDATION_ERROR`/`MALFORMED_JSON`, 409 `ALIAS_TAKEN`. |
| 3 | `GET /:shortCode` | The redirect. Flow: validate shape (malformed → 404, never 400) → visibility rules (exists, not deleted, active, not expired) → `302` + `Location: originalUrl` + `Cache-Control: private, no-cache`. Every dead state → identical 404. |
| 4 | `GET /api/v1/urls/:shortCode` | Metadata. Inactive/expired links ARE returned; soft-deleted → 404. `200` + URL resource. |
| 5 | `DELETE /api/v1/urls/:shortCode` | Soft delete. `200` + `{shortCode, deletedAt}`. Codes are never reissued. Unauthenticated by design in v1 (documented gap in the spec). |

The URL resource: `shortCode, shortUrl, originalUrl, isCustomAlias,
isActive, clickCount, expiresAt, createdAt, updatedAt`. Internal `id`,
`urlHash`, `createdBy`, `deletedAt` are never exposed.

## 6. Database (PostgreSQL 17, table `urls`)

| Column | Type | Why it exists |
|---|---|---|
| `id` | bigserial PK | Internal surrogate key; never exposed (shortCode is the public identity), so bigint beats UUID on index size. |
| `short_code` | varchar(32), unique | The public identifier; holds generated code or custom alias in ONE column so the DB enforces global uniqueness with one index and the redirect is one lookup. Case-sensitive (base62). |
| `is_custom_alias` | boolean default false | Distinguishes user-chosen vs generated codes for validation/analytics semantics. |
| `original_url` | text | The destination. Unbounded text + app-level 2048 limit (a policy, not a schema constraint). |
| `url_hash` | char(64) | SHA-256 of the normalized URL; indexable proxy for dedup lookups so the long text column never needs an index. |
| `click_count` | bigint default 0 | Denormalized redirect counter, designed for atomic out-of-band increments. |
| `is_active` | boolean default true | Owner-controlled kill switch; inactive links 404 on redirect but keep their code. |
| `expires_at` | timestamptz null | Optional expiry; NULL = never. Evaluated at read time in the service. |
| `created_by` | bigint null | Future owner FK; nullable so anonymous creation works pre-auth. |
| `created_at` / `updated_at` | timestamptz | Audit + dashboard sorting; `updated_at` auto-set by Prisma. |
| `deleted_at` | timestamptz null | Soft-delete tombstone; rows are never physically deleted so codes are never recycled (link-hijack prevention). |

Indexes: **unique on `short_code`** (the redirect hot path — the only index
that path touches); PK on `id`; **`url_hash`** (dedup at creation);
**`expires_at`** (for a future cleanup job; the design doc wanted a partial
index, Prisma can't declare one — documented compromise); composite
**(`created_by`, `created_at` DESC)** (future "my links" listing without a
sort step). Deliberately unindexed: `is_active` (low cardinality, always
checked after the unique lookup) and `click_count`.

## 7. Testing (32 tests, all passing)

- **Service unit tests** (`tests/unit/url/url.service.test.ts`, 15): mock
  the `UrlRepository` interface with `vi.fn()` objects. Cover creation
  (normalization, hashing, generated-code shape), alias conflict (no
  retry), collision retry (fail twice, succeed third, 5-attempt
  exhaustion), redirect visibility (missing/disabled/expired), metadata
  visibility, delete (including the concurrent-delete race), and error
  passthrough.
- **Controller tests** (`tests/unit/url/url.controller.test.ts`, 8): inject
  a mocked `UrlService` via the `createUrlController` factory; drive
  handlers through `asyncHandler` with a hand-rolled req/res harness.
  Assert status codes, envelopes, `Location`/`Cache-Control` headers,
  resource shape (internal fields absent), and that validation failures
  produce `RequestValidationError` without touching the service — plus the
  redirect-plane rule (malformed code → 404-style error, not 400).
- **Integration tests** (`tests/integration/url.api.test.ts`, 9): Supertest
  against the real `app` with the real Postgres from docker-compose. Full
  lifecycle: create (row verified in DB), redirect (302 + headers),
  metadata, delete (tombstone matches response timestamp), redirect-after-
  delete 404, validation 400 with field details, unknown-route 404,
  malformed JSON 400, duplicate alias 409. Tests track their rows and
  hard-delete them in `afterAll`.
- **Mocking strategy**: mock only at owned interface boundaries
  (repository, service) — never Prisma internals, never Express internals.
  Integration tests mock nothing.

## 8. Current production characteristics

**Production-oriented today**: strict TypeScript (ESM, NodeNext) with clean
typecheck/lint; consistent response envelope and machine-readable error
codes; centralized error handling that never leaks internals; per-request
IDs surfaced in headers and logs; structured JSON logging; graceful
shutdown; health endpoint; containerized Postgres with a persistent volume
and healthcheck; migration-managed schema; fail-fast env validation;
security-conscious details (CSPRNG non-enumerable codes, uniform 404s,
tombstoned codes, case-sensitive collation, reserved aliases, strict body
parsing, `x-powered-by` disabled); and a 3-tier test suite exercising the
stack down to the real database.

**Current limitations (facts, not proposals)**:
- No authentication or authorization — anyone with a short code can delete
  the link (documented as an accepted v1 gap in the API spec).
- `clickCount` is never incremented: `incrementClickCount()` exists in the
  repository and is tested, but no caller invokes it — redirects do not
  count clicks today. The field is always 0.
- No rate limiting; `RATE_LIMITED` is reserved in the spec only.
- Logging is console-based JSON (no log shipping/levels config).
- No CI pipeline; checks (tsc, eslint, vitest) run manually.
- **The workspace is not under Git** — the repo/workspace mismatch
  (documented in the review) is still unfixed; nothing built here is
  committed anywhere.
- The `expires_at` index is full rather than partial (Prisma limitation,
  documented in the schema).
- Expired links are only hidden at read time; no job flips `is_active`, so
  expired rows accumulate as "active but dead".
- Single-instance assumptions nowhere violated, but also untested beyond
  one process.

**Intentionally absent** (deferred by the sprint plan, designed-for but not
built): authentication/API keys, analytics, caching, background jobs, rate
limiting, teams/custom domains/QR codes, the reserved `PATCH` and list
endpoints.

## 9. Architecture decisions on record

1. **Layered module architecture with DI at every boundary** — repository
   and service are constructor-injected interfaces; tests mock the
   interface, never the vendor library.
2. **Prisma quarantine** — exactly two files import Prisma
   (`config/prisma.ts`, `url.repository.ts`); everything else sees domain
   types.
3. **One `shortCode` column** for generated codes and aliases — one unique
   index, one hot-path lookup, DB-enforced global uniqueness.
4. **Random CSPRNG base62 codes with insert-retry**, not encoded row IDs —
   codes are non-enumerable; the DB unique index is the only collision
   authority (check-by-insert, race-free, also covers tombstones).
5. **Soft delete with permanent code retirement** — recycled short links
   are a phishing vector.
6. **302 (never 301) redirects + no-cache** — permanent redirects would be
   cached by browsers/CDNs and defeat deactivation, expiry, and counting.
7. **Uniform 404 on the redirect plane** — missing/deleted/disabled/expired
   are indistinguishable to avoid information leaks; management plane shows
   inactive/expired truthfully.
8. **Expiry evaluated at read time**, not by background enforcement —
   instant-correct without machinery.
9. **Error translation at each boundary** — Prisma P2002 →
   `ShortCodeConflictError` (repo) → `AliasAlreadyExistsError` (service) →
   409 `ALIAS_TAKEN` (handler); no layer handles a lower layer's vendor
   errors.
10. **Envelope built in exactly one place**; controllers throw, the global
    handler responds; controllers contain zero try/catch.
11. **Validation normalizes, not just checks** — trimmed URLs, Date
    objects, coerced numbers; strict bodies (typos fail loudly) vs lenient
    query strings (stray tracking params never 400).
12. **Internal identifiers never exposed** — `shortCode` is the public
    identity; solves BigInt JSON serialization by construction.
13. **`clickCount` increments designed to be atomic and off the response
    path** (single-statement `increment`), ready for wiring without locks.
14. **URL normalization before hashing** (`new URL().toString()`) so
    equivalent spellings dedup identically.
15. **App/server split** — `app.ts` is importable by Supertest without
    binding a port; `server.ts` owns process lifecycle.
16. **`PUBLIC_BASE_URL`** env name — plain `BASE_URL` collides with a
    Vite/Vitest builtin (discovered via a real test failure).

## 10. Current project status

v1 feature-complete per the API spec: all five endpoints live end-to-end
and verified against a running server; 32/32 tests green; typecheck and
lint clean; conservative file-structure refactor applied (19 source files).
Not yet under version control (workspace/repo mismatch pending fix). Design
documents exist for the entity, the API contract, and the architecture
review.

---

## Summary

| Metric | Value |
|---|---|
| Implemented endpoints | **5** (health, create, redirect, metadata, delete) |
| Layers | **6** (middleware → routing → controller → validation → service → repository) + persistence |
| Tests | **32** (15 service unit, 8 controller unit, 9 integration) — all passing |
| Technologies | TypeScript 5.9 (ESM/NodeNext), Node 26, Express 5.2, Zod 4.4, Prisma 7.8 (+adapter-pg), PostgreSQL 17 (Docker), Vitest 4, Supertest, pnpm |
| Capabilities | Create short links (generated or custom alias, optional expiry), safe 302 redirects with strict visibility rules, metadata reads, soft deletion with permanent code retirement, uniform error contract, request tracing, graceful shutdown |
| Limitations | No auth (open delete), clicks not counted (counter never wired), console-only logging, no rate limiting, no CI, **not under Git**, expired rows not swept |
