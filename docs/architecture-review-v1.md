# Architecture Review — v1 (2026-07-19)

Design review only; no code was changed. Scope: all 23 hand-written source
files (1,121 lines) plus tests. Verdict up front: **the layer boundaries are
correct and worth keeping; the file granularity is not.** The codebase has
one module's worth of code spread across a scaffold sized for ten modules.
The refactor below cuts 23 files → 14 with zero behavior change.

## Answers to the review questions

**1. Does every file deserve to exist?** No. Five files exist to satisfy a
pattern rather than a need: the two `.interface.ts` files, the
`validation/url.validation.ts` forwarder, `routes/health.routes.ts` (7
lines), and `shared/http/async-handler.ts` (redundant under Express 5).

**2. Mergeable without harming maintainability?** Seven merges, listed below.
Every one merges files that always change together or that split one concept
across two locations.

**3. Abstractions solving real problems vs. following patterns?**
- *Real:* the `UrlRepository` and `UrlService` **types** (they power mock
  injection in 23 tests and keep Prisma quarantined); the domain-vs-resource
  split in the controller; the response-envelope helpers; the generic
  validation helpers.
- *Pattern-following:* putting those interfaces in **separate files**. A
  `type`-only import from the implementation file is erased at compile time —
  the dependency-direction argument for separate files doesn't apply.
  `asyncHandler` is likewise ceremony: Express 5 forwards rejected promises
  to error middleware natively, and our integration tests already exercise
  that path (404-after-delete, 409 alias conflict).

**4. Duplication?** Minimal. Three findings: the `makeUrl()` fixture is
copy-pasted in two test files (extract to `tests/helpers.ts`); the
`console.log(JSON.stringify({...}))` idiom appears in three production files
(acceptable until the planned pino swap — a 6-line `shared/log.ts` is
optional); envelope construction is already centralized. No logic
duplication found.

**5. Unnecessary interfaces?** The interfaces are necessary; their *files*
are not. `UrlController` interface in url.controller.ts is borderline — it
types the factory return, which TypeScript would infer; harmless, keep.

**6. Tiny forwarding files?** Yes: `validation/url.validation.ts` (three
one-line functions delegating to the generic helpers) and
`routes/health.routes.ts`. Both fold into their consumers.

**7. Folder depth reducible?** Yes, three ways: `modules/url/validation/`
(one concept split into a subfolder), `shared/middleware/` vs `shared/http/`
(request-logger and request-id are the same kind of thing in two homes), and
`utils/` vs `shared/` (two junk drawers; a codebase needs at most one).
`routes/` shrinks to a single file and flattens to `src/routes.ts`.

**8. Naming improvements?** Two: `routes/index.ts` → `src/routes.ts`
(index.ts files are hostile to editor tab/search discoverability), and the
`url.schema.ts`/`url.validation.ts` pair → one `url.validation.ts` (today a
reader must open both to see what "validation" means).

**9. Files to keep exactly as-is?** `config/env.ts`, `config/prisma.ts`,
`url.types.ts`, `url.errors.ts` (plus one moved class), `response.ts`,
`server.ts`, `app.ts` (import paths change only), `prisma/schema.prisma`,
all documentation, and the integration test suite. The Prisma client factory
and the repository stay the only Prisma importers — that boundary is the
project's best decision and is preserved untouched.

**10. What a senior production team would change?** Exactly the merges
below — plus two process items outside src/: the workspace is still not
under Git (see the repo-mismatch investigation; fix before refactoring so
the refactor is a reviewable diff), and `tests/modules/` should be renamed
`tests/unit/` to match `tests/integration/`.

## Proposed directory tree (14 files, was 23)

```
src/
  app.ts                      # unchanged except imports
  server.ts                   # unchanged
  routes.ts                   # ← routes/index.ts + routes/health.routes.ts
  config/
    env.ts                    # unchanged
    prisma.ts                 # unchanged
  modules/
    url/
      url.controller.ts       # ← + url.routes.ts (handlers and their wiring co-change)
      url.service.ts          # ← + url.service.interface.ts
      url.repository.ts       # ← + url.repository.interface.ts
      url.validation.ts       # ← validation/url.schema.ts + validation/url.validation.ts
      url.types.ts            # minus ShortCodeConflictError
      url.errors.ts           # + ShortCodeConflictError (all module errors in one place)
  shared/
    http/
      response.ts             # unchanged
      error-handler.ts        # ← + not-found.ts (both terminal handlers)
      middleware.ts           # ← request-id.ts + middleware/request-logger.ts
    validation.ts             # ← utils/validation.ts (utils/ folder dies)

tests/
  helpers.ts                  # NEW: shared makeUrl() fixture
  unit/url.service.test.ts    # renamed from modules/url/
  unit/url.controller.test.ts
  integration/url.api.test.ts
```

Deleted outright: `shared/http/async-handler.ts` (Express 5 native async
error forwarding; controllers lose the wrapper call).

## Rationale per change

| # | Change | Rationale |
|---|--------|-----------|
| 1 | Merge `*.interface.ts` into implementations | Interfaces stay exported; `import type` is compile-time-erased so consumers gain no runtime coupling. One file per concept. |
| 2 | Merge `validation/` pair into `url.validation.ts`, drop subfolder | The forwarder file adds a hop with zero logic; the subfolder exists for two files about one concept. |
| 3 | Merge `url.routes.ts` into `url.controller.ts` | Routes and handlers co-change on every endpoint addition; both are "HTTP surface of the module". |
| 4 | `routes/` → `src/routes.ts`, absorb health route | 7-line file + 13-line file, one consumer each. Health endpoint is one line. |
| 5 | `shared/middleware/` + `request-id.ts` → `shared/http/middleware.ts` | Same kind of code in two homes today; discoverability. |
| 6 | `not-found.ts` → `error-handler.ts` | Both terminal, both build error envelopes, mounted adjacently. |
| 7 | `utils/validation.ts` → `shared/validation.ts` | One junk drawer, not two. |
| 8 | Delete `async-handler.ts` | Express 5 forwards rejections natively; wrapper is pure ceremony now. |
| 9 | `ShortCodeConflictError` → `url.errors.ts` | All module errors greppable in one file; url.types.ts becomes pure data shapes. |
| 10 | `tests/helpers.ts` fixture | Removes the one real duplication found. |

## Expected reduction

- **Source files: 23 → 14 (−39%)**
- **Folders: −4** (`modules/url/validation/`, `routes/`, `shared/middleware/`, `utils/`)
- Lines: roughly −60 (deleted wrapper/forwarder boilerplate); this is a
  navigation-cost refactor, not a line-count one.

## Risks

| Change | Risk | Mitigation |
|--------|------|------------|
| Delete asyncHandler (#8) | **The only real one.** Relies on Express 5 forwarding rejected promises; a future downgrade or router swap would silently break error handling. | Integration tests already cover async-rejection → error-handler paths (deleted-link 404, alias 409). Keep if the team prefers explicitness — it costs one small file. |
| Interface merges (#1) | None at runtime; import-path churn in service/tests. | Type-check + full suite. |
| File moves (#2–7, 9) | Import-path churn only; a missed path fails at compile time, not runtime. | `tsc --noEmit` catches 100% of mistakes; run integration suite after. |
| Test renames (#10, unit/) | None; vitest discovers by glob. | Run suite. |
| Overall | Refactoring while the workspace is not in Git means no reviewable diff and no rollback point. | **Fix the Git layout first, commit v1, then refactor as one commit.** |

## Explicitly rejected ideas

- **Collapsing repository into service** — would put Prisma imports in the
  business layer; the quarantine is worth one extra file.
- **Merging controller into service** — HTTP↔domain mapping vs. rules is the
  boundary that keeps the service unit-testable without req/res mocks.
- **A shared `log.ts` now** — three call sites, and pino replaces all of
  them later anyway; premature.
- **Barrel `index.ts` files per module** — adds indirection and re-export
  maintenance for zero navigation gain at this scale.
