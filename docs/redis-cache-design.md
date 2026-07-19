# Redis Caching Design — Redirect Path

Status: Approved design, not yet implemented. Companion docs:
`url-entity-design.md` (storage), `api-v1-spec.md` (contract),
`architecture-review-v1.md` (layering). No API, schema, or architectural
changes are proposed — this is an additive, fail-open cache for
`GET /:shortCode`.

## 0. What we are optimizing, honestly

A redirect today costs one indexed unique-key lookup in Postgres — already
fast (~1ms). Redis is not here to make one redirect faster; it is here to
(a) keep hot links from monopolizing Postgres connections under load,
(b) hold p99 latency flat when the DB is busy with management-plane writes,
and (c) become the substrate later features (click buffering, rate limiting)
will need anyway. If LinkForge never exceeds a few hundred redirects/sec,
this cache is optional — which is exactly why it must be **fail-open and
removable**: the system must behave identically (minus latency) with Redis
absent.

## 1. Cache strategy: cache-aside

**Why cache-aside** (vs the alternatives):

- *Read-through / write-through* need a cache layer that owns the data
  access path; that inverts our repository boundary and couples correctness
  to cache availability.
- *Write-behind* risks losing writes and is absurd for our write volume.
- *Cache-aside* keeps Postgres as the single source of truth, tolerates
  Redis being down (every operation degrades to today's behavior), and
  needs no framework — a `get`, a `set`, a `del`.

The trade-off cache-aside accepts: short windows of staleness between a DB
write and invalidation, bounded by TTL. For a URL shortener this is a good
trade — redirect targets change rarely; we bound the damage explicitly (§4).

**What is cached — the redirect *view*, not the row.** A cache entry holds
exactly what the redirect decision needs:

```
{ originalUrl, isActive, expiresAt }
```

Deliberately excluded: `clickCount` (changes on every click — caching it
would force invalidation-per-redirect, driving the hit rate to zero the
moment click counting ships), `id`, timestamps, ownership. Business rules
(`isActive`, `expiresAt > now`) are **re-evaluated on every cache hit** by
the service — the cache stores facts, never decisions, so a link that
expires while cached still dies at the right instant without any
invalidation.

**Read flow** (`getByShortCode`, the only cached path):

1. `GET cache:url:v1:{shortCode}`
2. **Hit (positive)** → apply redirect rules to the cached fields → 302 or 404.
3. **Hit (negative sentinel)** → 404 immediately (see §2).
4. **Miss** → repository `findByShortCode` → apply rules →
   `SET` positive entry (found) or negative sentinel (not found), with TTL →
   respond.
5. **Any Redis error at any step** → treat as miss, log, continue (§4).

**Write flow** (`create`): do nothing to the cache. The first redirect
populates it (pure cache-aside). One exception: `DEL` the key on create —
it may hold a *negative* entry from someone probing the code before it
existed (or from the alias's pre-creation 404s). Cheap and closes a
confusing "brand-new link 404s for 60s" bug.

**Delete flow** (`delete`) and future mutations (`update`, deactivation):
commit to Postgres first, then `DEL` the key. Invalidate-by-delete, never
write the new value from the mutation path — writing computed values from
two places (read path and write path) is how caches end up permanently
wrong from a lost race. Next read repopulates.

**Invalidation strategy**, in order of authority:
1. Explicit `DEL` after every mutating commit (delete, future update).
2. Rule re-evaluation on read (makes expiry and activation windows correct
   with zero invalidation traffic).
3. TTL as the backstop for the crash window between commit and `DEL`.

## 2. Redis key design

| Aspect | Decision | Rationale |
|---|---|---|
| Key | `cache:url:v1:{shortCode}` | `cache:` namespaces against future non-cache uses (queues, counters) in the same Redis; `v1` lets us change the payload shape by bumping the version instead of flushing; shortCode is the natural unique lookup key and is case-sensitive, matching the DB collation. |
| Positive value | JSON: `{"u":"https://…","a":1,"e":1893456000000}` (`e` null when no expiry) | JSON is debuggable (`redis-cli GET`); one-letter fields because this is the highest-cardinality object we'll store. Epoch millis for `e` avoids date parsing. |
| Negative value | the literal string `"0"` | Cheapest possible tombstone; unambiguous vs JSON object. |
| Positive TTL | **1 hour ± 10% jitter** | Long enough for a >95% hit rate on hot links; short enough that a missed invalidation (crash between commit and DEL) self-heals within an hour. Jitter prevents a synchronized refill herd after a mass-population event. |
| Negative TTL | **60 seconds** | Protects Postgres from 404-scan floods (code enumeration is a real traffic pattern for shorteners) while keeping the "alias created just after being probed" window tiny — and create() DELs it anyway. |
| Memory | ~150 B payload + ~90 B Redis overhead ≈ **~250 B/entry → 1M cached links ≈ 250 MB** | Configure `maxmemory` (e.g. 512 MB) with `maxmemory-policy allkeys-lru`: the cache holds the hot set, cold links fall out naturally, and eviction is safe because Postgres owns the truth. |

## 3. Service-layer integration

**Decision: the service owns caching, through a cache *port* — not a
repository decorator, and never Redis directly.**

The obvious-looking alternative — a `CachedUrlRepository` decorator that
wraps `findByShortCode` transparently — was rejected for a concrete reason:
the repository returns full domain rows. A transparent row cache must either
include `clickCount` (then click counting invalidates on every redirect and
the hit rate collapses) or serve stale counts to `getMetadata` (silent
correctness bug in the management API). The redirect view cache (§1) is a
*business-level* shape — deciding that redirect resolution is cacheable and
click counts are not is a business decision, which is precisely what the
service layer is for.

Boundaries preserved:

- **Repository**: untouched. Pure persistence, still the only Prisma importer.
- **Service**: gains a second injected dependency — a small port:

  ```
  RedirectCache {
    get(shortCode)             → CachedRedirect | 'negative' | null
    set(shortCode, entry, ttl) → void
    setNegative(shortCode)     → void
    del(shortCode)             → void
  }
  ```

  The service knows "a redirect cache exists"; it does not know Redis exists.
- **Infrastructure**: `RedisRedirectCache` (ioredis) lives beside
  `config/prisma.ts` as `config/redis.ts` + an adapter implementing the
  port. It is the only file that imports the Redis client, mirroring the
  Prisma quarantine.
- **Controllers / routes / API**: zero changes. The contract in
  `api-v1-spec.md` is unaffected.

**Dependency injection**: constructor injection, same pattern as the
repository — `new DefaultUrlService(urlRepository, redirectCache)`. The
composition root wires `RedisRedirectCache` when `REDIS_URL` is configured
and a **`NullRedirectCache`** (get→null, everything else no-op) when it
isn't. That null object is not just for tests: it *is* the degraded mode,
it makes Redis genuinely optional in dev, and it proves the fail-open
property by construction.

## 4. Failure scenarios

| Scenario | Behavior | Design mechanism |
|---|---|---|
| **Redis unavailable** (down, unreachable, auth failure) | Every redirect works, served from Postgres, exactly like today. | The Redis adapter never throws: every command is wrapped, errors are logged once per state change (not per request), `get` returns null, writes are no-ops. Aggressive timeouts — ~50ms command timeout, no retries on the hot path, no offline command queueing (`enableOfflineQueue: false`) — so a dead Redis costs at most one timeout, and a *disconnected* client costs ~0ms (fail immediately). ioredis reconnects in the background. |
| **Cache miss** | Normal path: one indexed PG read + one `SET`. | This is just cache-aside working; a miss is not a failure. |
| **Stale cache** | Two sources: (1) crash between DB commit and `DEL` — healed by the 1h TTL; (2) the classic read-repopulate race (reader fetches old row, mutation commits + DELs, reader SETs the old value) — a millisecond-scale window, also healed by TTL. Worst case: a deleted link redirects for up to ~1h. | Accepted and documented as the cache-aside trade-off. If the product later requires instant kill (abuse takedowns), add a second `DEL` a few seconds after the first (delayed double delete) — deliberately not built now. Expiry and deactivation windows are *never* stale because rules are evaluated at read time. |
| **Cache stampede** | A hot link's entry expires → N concurrent requests miss together and all hit Postgres. | Kept deliberately simple: the dogpile lands on a unique-index point read, which Postgres absorbs trivially at our scale; TTL jitter already prevents mass simultaneous expiry. Distributed locks/probabilistic early refresh are complexity without a problem — noted as the upgrade path (per-instance promise coalescing first) if DB metrics ever show miss bursts. |
| **Network latency** | Redis adds one RTT to every redirect (hit or miss). | Same-AZ/same-host deployment assumption; one persistent connection (ioredis pipelines concurrent commands on it); the 50ms timeout caps worst-case added latency; `SET`s are fire-and-forget (not awaited before responding) so only the `GET` sits on the critical path. |

## 5. Future compatibility

- **Analytics / click counting**: the cached payload excludes `clickCount`
  *by design*, so increments never touch the cache. The natural analytics
  path — `INCR analytics:clicks:{code}` buffered in Redis, flushed to PG in
  batches — lives in a separate keyspace (`analytics:*` vs `cache:*`) on the
  same instance until scale demands separation. Nothing in this design
  changes.
- **Background jobs**: the expiry-sweeper cron (flips `isActive` on expired
  links) needs **no cache coordination** — expiry is evaluated from `e` at
  read time. A future bulk-deactivation admin action iterates `DEL`s or, at
  worst, bumps the key version (`v1`→`v2`) for an O(1) logical flush.
- **Multiple application instances**: cache-aside against a shared Redis is
  multi-instance-correct with no extra machinery — any instance's mutation
  `DEL`s the shared key; there is no per-process cache state. The one rule
  that keeps this true: **no in-process caching layer** may be added in
  front of Redis without adding pub/sub invalidation (explicitly out of
  scope now, recorded so nobody adds a "quick LRU map" later).

## 6. Testing strategy

- **Unit tests** (extend `tests/unit/url/url.service.test.ts`): mock at the
  **port boundary** — a hand-rolled `FakeRedirectCache` (in-memory Map) and
  a `ThrowingRedirectCache`, never mocked ioredis internals. Scenarios:
  - hit → repository is *not* called; rules still applied (a cached entry
    whose `expiresAt` has passed → `UrlNotFoundError`);
  - negative hit → 404 without a repository call;
  - miss → repository called once, cache populated with correct TTL class;
  - miss on a dead link → negative entry written;
  - `delete()` → `del` called after `softDelete` resolves;
  - `create()` → `del` called (negative-entry purge);
  - `ThrowingRedirectCache` → every operation still succeeds via Postgres
    (fail-open proven at the unit level);
  - `NullRedirectCache` → behavior identical to v1 (regression guard).
- **Integration tests** (extend docker-compose with a `redis` service +
  `tests/integration/`): real Redis, real Postgres, Supertest lifecycle:
  create → first redirect (miss, key appears in Redis with TTL) → second
  redirect (hit; assert via repository spy or query-log that PG was not
  read) → DELETE → key gone → redirect 404. Plus the fail-open test: stop
  Redis (or point the adapter at a dead port), assert redirects still 302
  within latency budget.
- **What we deliberately don't test**: ioredis reconnection internals and
  Redis eviction behavior — that's the vendor's contract, not ours.

## 7. Rollout & configuration

`REDIS_URL` (optional) in env config; absent → `NullRedirectCache` (v1
behavior, zero risk). docker-compose gains `redis:7-alpine` with a small
`maxmemory` + `allkeys-lru`. Deploy dark (Redis wired, traffic identical),
watch hit rate and added latency in the request logs, then it simply stays
on. Rollback = unset `REDIS_URL`.
