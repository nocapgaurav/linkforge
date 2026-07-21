# LinkForge — End-to-End Integration Audit (2026-07-21)

QA pass ahead of Phase 3, following Phase 2.5 (frontend/auth integration).
Investigation only — no code changed. Baseline confirmed clean before
starting: backend 212/212 tests, frontend 25/25 tests, both typecheck/lint
clean, migrations in sync, env files consistent.

Method: static contract diffing (every backend route vs. every frontend API
call; every backend response shape vs. every frontend type), live
verification via curl and direct browser driving for the highest-risk
paths, and a deliberate live reproduction of the one finding serious enough
to demand it (concurrent refresh).

---

## Finding 1 — Concurrent session refresh causes false "theft" detection and can silently kill a legitimate session

**Severity: High**

**Reproduction** (deterministic, reproduced live):
```bash
# Register a user, capture the refresh token, then fire it twice AT ONCE:
curl -s -X POST $BASE/auth/register ... # get refreshToken=$RT
(curl -s -X POST $BASE/auth/refresh -d "{\"refreshToken\":\"$RT\"}" &)
(curl -s -X POST $BASE/auth/refresh -d "{\"refreshToken\":\"$RT\"}" &)
wait
```
Result observed: request A gets `200` with a fresh token pair; request B
gets `401 {"code":"UNAUTHORIZED","message":"Session is no longer valid."}`.
Then, using request A's *brand-new* refresh token immediately afterward,
that ALSO returns `401 "Session is no longer valid."` — the "loser"
request's replay-detection revoked every session for the user, including
the one the "winner" had just been issued in the same race. The winner's
JWT access token stays valid (stateless, unaffected) until it naturally
expires (≤15 min) — at which point the user is logged out with no warning
and no way to recover except logging in again.

**Root cause**: two layers compound.
- **Backend** (`src/modules/auth/auth.service.ts`, `refresh()`): correctly
  designed to treat replay of an *already-rotated-away* token as theft and
  revoke every session — but it cannot distinguish that from two
  *simultaneous, legitimate* uses of a token that hasn't rotated yet by
  either request's observation. Two concurrent requests both see
  `revokedAt === null`, both proceed, and whichever commits second finds
  the row already revoked by the first — indistinguishable from theft at
  this layer.
- **Frontend** (`src/lib/api/client.ts`): `refreshSession()`'s shared
  in-flight-promise guard (`refreshPromise`) is a **module-level variable,
  scoped to one JS execution context** — i.e., one browser tab. It
  correctly prevents two requests *within the same tab* from racing (and
  correctly survives React Strict Mode's double-effect-invocation in dev,
  verified by code inspection). It provides **zero cross-tab
  coordination**: two tabs of the same origin are two separate module
  instances, each with its own independent `refreshPromise`.

**Trigger conditions**: two browser tabs whose access tokens happen to
expire within the same narrow window (round-trip time, typically tens of
milliseconds locally) — most likely when both tabs restored or logged in
within a few seconds of each other, so both 15-minute timers run out
close together. This is not a contrived edge case — "open the dashboard in
two tabs" is completely ordinary browser use, and the audit's own
checklist calls it out explicitly.

**Files involved**: `src/modules/auth/auth.service.ts` (`refresh()`),
`frontend/src/lib/api/client.ts` (`refreshSession()`, module-scoped
`refreshPromise`), `frontend/src/lib/auth/AuthProvider.tsx` (boot-time
restoration calls the same function, same exposure).

**Suggested fix** (not implemented — audit only): cross-tab coordination
is the real fix, e.g. a `BroadcastChannel` so one tab's successful refresh
result is shared with sibling tabs before they attempt their own, or a
`navigator.locks` mutex keyed by origin. A cheaper partial mitigation:
have the backend's replay handler distinguish "already rotated but the
rotation happened within the last N seconds" (soft grace window) from
"rotated long ago" (hard theft signal) — reduces false positives without
full cross-tab plumbing, at the cost of a slightly longer window for
genuine token theft to go undetected.

**Tests currently miss it**: yes, completely. The existing backend test
`treats replay of a rotated token as theft` (`auth.api.test.ts`)
*sequentially* rotates then replays the old token — it never tests two
*simultaneous* uses of the same not-yet-rotated token, which is the actual
failure mode here. No frontend test exercises multi-tab behavior at all
(not feasible in jsdom without literally instantiating two module
registries).

**Documentation**: not documented anywhere as a known limitation — should
be, at minimum, until fixed.

**Production vs. development**: affects production equally or worse (real
users on real networks with real multi-tab habits; the race window is
wall-clock-bounded, not environment-specific).

---

## Finding 2 — Backend added `maxClicks`/`hasPassword` to the URL resource; frontend's `Link` type was never updated

**Severity: Low–Medium**

**Reproduction**: `curl -X POST .../urls ...` returns
`{..., "maxClicks": null, "hasPassword": false, ...}` (confirmed in
`src/modules/url/url.controller.ts`, `toUrlResource()`). Compare to
`frontend/src/types/link.ts`'s `Link` interface — it has no `maxClicks` or
`hasPassword` fields at all.

**Root cause**: Phase 2 (backend) added these two fields to the wire
resource; Phase 2.5 (frontend integration) was scoped to authentication
only and never revisited `types/link.ts`.

**Impact**: not a runtime crash (TypeScript's structural typing means the
extra JSON fields are simply present-but-inaccessible to typed frontend
code — nothing throws). But it is a genuine, confirmed frontend/backend
shape mismatch exactly matching what this audit asked to find: any future
UI wanting to show a password-protected badge or click-limit indicator on
a link row cannot do so without first fixing this type. It also means the
frontend has **no way to display** that a link is password-protected or
click-limited anywhere in the dashboard — compounding Finding 6 below.

**Files involved**: `frontend/src/types/link.ts`.

**Suggested fix**: add `maxClicks: number | null` and `hasPassword:
boolean` to `Link`.

**Tests currently miss it**: yes — no test asserts the full shape of a
`Link` object against the live API response; existing tests only check
individual fields they care about.

**Documentation**: `docs/api-v1-spec.md` §1.6 (URL resource) is correct and
current; the frontend type is what's stale, and nothing documents that
gap.

**Production vs. development**: both equally; purely a type/completeness
gap, not environment-specific.

---

## Finding 3 — Rate-limit response headers: documented, never implemented, and the spec contradicts itself

**Severity: Low**

**Confirmed**: `src/shared/http/rate-limit.ts` never sets
`RateLimit-Limit`, `RateLimit-Remaining`, or `RateLimit-Reset` on any
response (success or `429`), nor `Retry-After` on the `429` itself. Yet
`docs/api-v1-spec.md` §1.4 still reads *"Reserved. Sent once rate limiting
ships"* — while §12 (written in the same phase) states rate limiting
**is** implemented. The spec disagrees with itself, and neither statement
matches the code.

**Root cause**: §1.4 was written pre-implementation (correctly, as a
forward-looking reservation) and never revisited when §12 was added.

**Impact**: no functional breakage — nothing in the frontend reads or
depends on these headers (confirmed: zero references to `RATE_LIMITED` or
`429` anywhere in frontend source). Purely a documentation-accuracy and
API-completeness gap; a client trying to build a "you're rate limited,
retry in Xs" UI has no header to read from.

**Files involved**: `src/shared/http/rate-limit.ts`, `docs/api-v1-spec.md`
§1.4/§12.

**Suggested fix**: either implement the headers (cheap: the limiter
already knows `count`/`max`/window) or update §1.4 to say plainly "not
implemented" instead of "reserved... once it ships."

**Tests currently miss it**: N/A — nothing to test since it's a documented
promise, not a behavior; no test asserts these headers' absence either
(would be a reasonable regression guard once fixed).

**Documentation**: confirmed wrong / self-contradictory (see above) — this
finding **is** the documentation bug.

**Production vs. development**: both — this is a public API contract gap,
not environment-specific.

---

## Finding 4 — Analytics page shows a misleading "Retry" for a permanent 404

**Severity: Medium**

**Reproduction**: navigate to `/dashboard/links/:shortCode` for a code
that is deleted, never existed, or belongs to another user. The analytics
`useLinkAnalytics` query fails with a `404 NOT_FOUND` `ApiError`.
`AnalyticsView` (`frontend/src/components/analytics/AnalyticsView.tsx`,
line 78) routes **any** `isError` state — regardless of status code —
through the same `AnalyticsError` component: *"Couldn't load analytics...
Something went wrong... [Retry]"*. Clicking Retry re-runs the identical
query against the identical permanently-404ing endpoint and fails again,
forever.

**Root cause**: `AnalyticsView`'s conditional rendering only checks
`analytics.isError`, never `toApiError(analytics.error).status` or
`.code`. Contrast with `LinkTable`'s error branch (`components/links/
LinkTable.tsx`), which at least distinguishes `status === 0` (network
unreachable) from other failures — the analytics page has *less* nuance
than the list page despite being *more* likely to hit a permanent 404 in
normal use (any deleted or foreign link lands here).

**Files involved**: `frontend/src/components/analytics/AnalyticsView.tsx`,
`frontend/src/components/analytics/AnalyticsError.tsx`.

**Suggested fix**: branch on the error: a 404 should render something like
"This link doesn't exist or isn't yours" with a link back to the
dashboard (no Retry button, since retrying can't help); reserve the
current "Couldn't load analytics / Retry" copy for genuine 5xx/network
failures.

**Tests currently miss it**: yes — no frontend test exists for
`AnalyticsView`'s error states at all (only `AnalyticsError`'s rendering
in isolation, if that).

**Documentation**: not documented as a known gap anywhere.

**Production vs. development**: both; will be hit by any real user who
deletes a link while its analytics tab is open, or follows a stale
bookmark/shared link to someone else's deleted link.

---

## Finding 5 — Deleting a link doesn't invalidate its analytics cache; a stale analytics tab can outlive the link indefinitely

**Severity: Medium**

**Confirmed by code inspection**: `frontend/src/hooks/useDeleteLink.ts`
invalidates only `queryClient.invalidateQueries({ queryKey: linksQueryKey
})` — never the corresponding `['analytics', shortCode, range]` key. If a
link's analytics page is open in one tab (or was visited and its query is
still "fresh" under the 30s global `staleTime`) and the link is deleted —
from the same tab's dashboard, another tab, or another device — the
analytics view keeps rendering the **stale cached data indefinitely**,
because `refetchOnWindowFocus` is globally disabled and nothing else
prompts a refetch of an already-mounted query. The user only discovers the
link is gone by manually changing the date range or reloading the page.

**Root cause**: `useDeleteLink`'s invalidation list was written before the
analytics query key existed as a per-link cache entry it would need to
know about; no coupling was added when analytics landed.

**Files involved**: `frontend/src/hooks/useDeleteLink.ts`,
`frontend/src/hooks/useLinkAnalytics.ts` (defines the key shape it should
invalidate).

**Suggested fix**: also invalidate `queryClient.invalidateQueries({
queryKey: ['analytics', shortCode] })` (prefix match, all ranges) in
`useDeleteLink`'s `onSuccess`.

**Tests currently miss it**: yes — no test asserts cross-hook cache
invalidation.

**Documentation**: not documented.

**Production vs. development**: both.

---

## Finding 6 — Password-protected links and click-limit expiration are fully backend-complete but have zero UI

**Severity: Informational / confirmed known gap, restated**

Confirmed still true: no component, hook, or page anywhere in the frontend
calls `PATCH /api/v1/urls/:shortCode` (the endpoint that sets password/
maxClicks) or reads the `password`/`maxClicks` fields for editing. This
was an explicit, disclosed scope decision at the end of Phase 2.5 ("no
edit-link UI was built"), not a regression — restating it here because the
audit specifically asks about these two features end-to-end, and the
honest end-to-end answer is: **the backend works perfectly (verified by
its own test suite and live curl testing in Phase 2), but no real user can
reach either feature through the shipped product.** For a live demo, this
means "show password protection" or "show click limits" can only be
demonstrated via `curl`/Postman against the API directly, not through the
UI.

**Files involved**: none missing per se — `api.patch` exists in
`frontend/src/lib/api/client.ts` unused, ready for a future edit form.

**Production vs. development**: both; this is a product-completeness gap,
not a bug.

---

## Finding 7 — `shortUrl` is computed by two independent, divergence-prone code paths

**Severity: Low (already a disclosed trade-off; restated for completeness)**

Backend computes `shortUrl` authoritatively from `PUBLIC_BASE_URL` in
`toUrlResource()`. The frontend, wherever it only has a `shortCode` and no
full `Link` object (specifically `AnalyticsView`, since it never fetches
link metadata — see below), **independently re-derives** the same value by
string-stripping `/api/v1` off `NEXT_PUBLIC_API_URL`
(`shortUrlFor()` in `frontend/src/lib/api/links.ts`). These happen to
agree today because both env vars point at `localhost:3000`, but they are
two separately-configured environment variables with no enforced
relationship — a production deployment with the API and redirect service
on different domains, or behind a path-prefixed proxy, would make
`shortUrlFor()` compute the wrong origin while the backend's own value
stays correct. Root cause of the duplication: `AnalyticsView` never calls
`GET /api/v1/urls/:shortCode` (confirmed — the metadata endpoint has **zero
frontend callers** anywhere), so it has no access to the authoritative
`shortUrl` the backend already computed, and falls back to reconstructing
it. Fixing that (fetching metadata on the analytics page) would eliminate
the duplication as a side effect. This was already called out as a known
trade-off when `shortUrlFor()` was first written; restated here since nothing
has changed and the audit specifically asks about "localhost generation"
and "redirect generation."

**Files involved**: `frontend/src/lib/api/links.ts` (`shortUrlFor`),
`frontend/src/components/analytics/AnalyticsView.tsx`.

**Production vs. development**: development-safe today; a real risk only
once API and redirect domains diverge in a real deployment.

---

## Finding 8 — Operational hazard: stale compiled `dist/server.js` can silently shadow a dev server on the same port

**Severity: Low (process hygiene, not a code bug)**

While setting up this audit, a leftover `node dist/server.js` process from
an earlier, unrelated `pnpm build`/`pnpm start` was still bound to port
3000 (`lsof -ti:3000` found it, `ps` confirmed the command). It responded
to `/health` with `200` exactly like a correctly-running dev server would,
which is precisely what makes it dangerous: a health check alone cannot
tell you which build is actually serving traffic. This exact failure mode
already caused wasted diagnostic time once in Phase 2.5 (a CORS fix
appeared not to work because the stale process was serving pre-fix code).
Not a code defect — a repo/tooling gap: nothing prevents `dist/` from going
stale relative to `src/`, and nothing surfaces which one is actually
listening.

**Suggested fix**: none required in code; a process-hygiene note for
whoever runs this locally (e.g., always check `ps -p $(lsof -ti:PORT)
-o command` before trusting a health check, or add a `/health` field like
`{"source": "tsx" | "dist"}` derived from `import.meta.url` to make this
observable without `ps`).

**Production vs. development**: development-only (production presumably
runs exactly one built artifact via a process manager, not both a tsx dev
server and a stale build simultaneously).

---

## Areas investigated and found consistent (no bug)

For completeness, since the brief asked me not to stop at the first bug,
here is what was specifically checked and is **not** broken:

- **Route/contract coverage**: every frontend `api.get/post/patch/delete`
  call maps to a real, currently-registered backend route; no orphaned
  calls to removed endpoints; no frontend assumption of an endpoint that
  doesn't exist.
- **Auth types** (`PublicUser`, `AuthResponse`, `RefreshResponse`) match
  the backend's `toUserResource()`/token responses exactly, field for
  field.
- **Analytics types** (`LinkAnalytics`, `AnalyticsSummary`, `SeriesBucket`,
  breakdown shapes) match `UrlAnalytics` exactly, field for field.
- **CORS**: the Phase 2.5 fix (`Authorization` header, `PATCH` method) is
  live and correct; verified via a real preflight request.
- **Env files and Docker**: `.env.example` (root and frontend) list every
  variable the running code actually reads, nothing stale or missing;
  `docker-compose.yml` services (Postgres, Redis) both healthy; `prisma
  migrate status` reports the schema fully in sync with all 4 applied
  migrations — no drift.
- **Fail-open Redis (rate limiting and redirect cache)**: both have
  dedicated, currently-passing automated integration tests that
  physically stop the Redis container mid-test and assert the request
  still succeeds — not re-verified manually since the automated coverage
  is already authoritative and green.
- **Expired vs. revoked refresh token**: the backend throws the same
  `UnauthorizedError`/`UNAUTHORIZED` for both, and the frontend correctly
  treats any refresh failure identically (clear session, log out) —
  verified by code reading; no special-casing needed or missing.
- **React Strict Mode double-invocation**: `AuthProvider`'s boot-time
  restoration effect is safe under dev-mode double-invocation — the shared
  `refreshPromise` guard (Finding 1) correctly absorbs the second call
  *within one tab*; this is not an additional dev-only bug, it's the same
  single-instance protection working as designed.
- **Optimistic updates**: none are implemented anywhere (`onMutate` has
  zero usages) — so there is nothing to be "broken" here; UI updates only
  after server confirmation via cache invalidation. Noted as a design
  characteristic, not a defect.
- **UserMenu dropdown crash**: this was a real bug (`DropdownMenuLabel`
  used without its required `DropdownMenuGroup` ancestor) — but it was
  found and fixed during Phase 2.5 itself and is confirmed still fixed
  (verified live: menu opens cleanly, no runtime error). Listed here only
  so it isn't mistaken for a currently-open issue.

## Documentation staleness summary

- **Root `README.md` is a single line** (`# linkforge`) — unchanged since
  the very first commit, despite four completed backend phases and a full
  frontend. This was already the single highest-leverage gap identified in
  the last project-wide audit and remains completely unaddressed; it is
  now stale relative to even more functionality than before.
- **`frontend/README.md`** has zero mentions of login, register,
  `AuthProvider`, or protected routes — it describes a pre-auth frontend
  even though auth is now the frontend's most architecturally significant
  layer.
- **`docs/api-v1-spec.md` §1.4 vs §12** contradict each other on rate
  limiting's implementation status (Finding 3).

## Summary table

| # | Finding | Severity | Prod-affecting |
|---|---|---|---|
| 1 | Concurrent refresh → false theft detection, silent logout | **High** | Yes |
| 2 | Frontend `Link` type missing `maxClicks`/`hasPassword` | Low–Medium | Yes |
| 3 | Rate-limit headers documented but not implemented; spec self-contradicts | Low | Yes |
| 4 | Analytics 404 shows misleading "Retry" | Medium | Yes |
| 5 | Delete doesn't invalidate analytics cache | Medium | Yes |
| 6 | Password/click-limit features have no UI (known, restated) | Informational | Yes (product gap) |
| 7 | `shortUrl` computed twice, divergence risk off-localhost | Low | Only in non-local deploys |
| 8 | Stale `dist/` process can shadow dev server | Low | Dev-only |
| — | Root README / frontend README staleness | — | N/A (docs) |

No critical (data-loss or security-breach) defects were found. Finding 1
is the one item I'd fix before any further feature work — it's a real,
demo-reachable reliability bug hiding behind completely ordinary two-tab
usage, and it isn't covered by any existing test.
