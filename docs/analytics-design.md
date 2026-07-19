# LinkForge Analytics — System Design Proposal

Status: Design only, nothing implemented. Companion documents:
`api-v1-spec.md` (§7 fixed the analytics response contract in advance — this
design implements that contract, it does not replace it),
`redis-cache-design.md` (the cache deliberately excludes clickCount so that
this system never invalidates redirect cache entries),
`url-entity-design.md` (the `urls.click_count` denormalized counter and the
unused-but-tested `incrementClickCount()` repository method were built for
this moment).

Design invariant, stated once and assumed everywhere below: **the redirect
is the product**. Analytics may lose data; the redirect may not lose speed.
Every decision follows from that asymmetry.

---

## Part 1 — Product goals

Analytics answers one question for a link owner: *"is my link working?"* —
decomposed into:

| Question | Metric | Why it matters |
|---|---|---|
| Is anyone clicking? | Total clicks, clicks today / 7d / 30d | The headline number; the reason people use a shortener instead of a bare URL. |
| When do they click? | Daily/hourly time series | Reveals campaign spikes, decay curves, dead links worth pruning. |
| Where does traffic come from? | Top referrers (host only) | Attribution — "did Twitter or the newsletter drive this?" is the #1 marketing question. |
| Where are clickers? | Countries, cities | Geographic reach; informs localization and posting-time decisions. |
| On what? | Browser / OS / device breakdowns | Device mix drives landing-page decisions (mobile-heavy audience → mobile-first page). |
| Is traffic real? | Unique-visitor approximation (daily IP-hash) | Distinguishes 1,000 clicks from 1,000 people vs one bot. |

**Primary use cases**: link-owner dashboard (per-link stats), the
`GET /api/v1/urls/:shortCode/analytics` API for programmatic consumers, and
internal abuse detection (a link with 50k clicks/hour from one IP hash is a
signal).

**Out of scope, deliberately**: cross-link visitor journeys, user-level
tracking or identity stitching, session replay, conversion tracking on the
destination page (we don't control it), real-time (<1 min) dashboards, and
A/B testing. Every one of these either requires tracking individuals
(privacy posture change) or infrastructure (stream processing) far beyond
the product's needs. Adding them later is additive; building them now is
speculation.

## Part 2 — Event model

A **click event** is one successful redirect decision: it is recorded when
the service resolves a short code to a 302 — not on 404s (those are noise
and an enumeration-attack amplifier), not on management-plane reads.

| Field | Recorded | Why |
|---|---|---|
| `id` | yes (surrogate) | Append-only row identity. |
| `eventId` (UUID) | yes | Generated at redirect time; the idempotency key that makes retries safe (Part 7). |
| `urlId` | yes | The link this click belongs to — the primary query dimension. The internal bigint id, not the shortCode: survives nothing (codes are immutable) but is 8 bytes vs a string and joins cleanly. |
| `occurredAt` | yes | Event time, stamped by the app server at redirect time (not insert time — with a queue, insert can lag by seconds/minutes). |
| `ipHash` | yes | `SHA-256(ip + daily rotating salt)`, truncated to 16 bytes. Enables unique-visitor counts and bot/abuse detection **within a day** while being useless for long-term tracking: the salt rotation breaks linkability across days by construction, and the raw IP is never persisted. |
| `country`, `city` | yes | Resolved from the IP **at ingest** via a local GeoIP database, then the IP is discarded. Storing the resolution instead of the IP is the privacy-preserving order of operations. |
| `browser`, `browserVersion` (major only), `os`, `device` | yes | Parsed from the User-Agent at ingest into low-cardinality slugs (`chrome`, `ios`, `mobile`…). |
| `referrerHost` | yes | **Host only**, normalized (`t.co`, `news.ycombinator.com`) — never the full Referer URL, which routinely carries query-string tokens, search terms, and private paths. |
| `requestId` | yes | Correlates an event with the request log line for debugging ("why does this click have no country?"). |
| Raw IP | **no** | PII. Retention would make us a surveillance dataset and drag the whole system into a heavier compliance regime. Everything we need from it (geo, uniqueness) is extracted at ingest. |
| Raw User-Agent | **no** | High-cardinality, fingerprint-grade data. Cost: we cannot re-parse history when parsers improve — accepted; breakdowns are directional, not forensic. |
| Full referrer URL | **no** | Token/PII leakage (see above). |
| Cookies / visitor IDs | **no** | We do not identify people. This single decision is what keeps LinkForge analytics in the "anonymous aggregate statistics" category rather than behavioral tracking. |

**Privacy summary**: no persistent identifiers, no raw IPs, no cross-day
linkability, host-only referrers, aggregate-only exposure through the API
(the API returns breakdowns, never individual events). The event table is
still pseudonymous data for its 24-hour ipHash window, so it is treated as
sensitive: not exposed publicly, covered by retention (Part 3).

## Part 3 — Database design: `click_events`

| Column | Type | Notes |
|---|---|---|
| `id` | bigserial PK | Order-ish, compact. |
| `event_id` | uuid, **unique** | Idempotency key; `ON CONFLICT DO NOTHING` target. |
| `url_id` | bigint, **FK → urls(id)**, NOT NULL | `ON DELETE RESTRICT` — urls are soft-deleted, rows never vanish, so the FK never blocks anything; it exists purely to make orphan events impossible. |
| `occurred_at` | timestamptz, NOT NULL | Event time (Part 2). |
| `ip_hash` | bytea(16), NOT NULL | Truncated salted hash. |
| `country` | char(2), NULL | ISO 3166-1; NULL = unresolvable. |
| `city` | varchar(80), NULL | |
| `browser` / `os` / `device` | varchar(32), NULL | Parsed slugs; NULL = unknown. |
| `browser_version` | varchar(16), NULL | Major version only. |
| `referrer_host` | varchar(255), NULL | NULL = direct/none. |
| `request_id` | uuid, NULL | |

No `updated_at`, no `deleted_at`: **append-only by construction**. Events
are facts about the past — an event is never edited (there is no correct
"update" to a click) and never individually deleted (only aged out by
retention). Append-only is what makes every downstream property cheap:
aggregation is incremental (new rows only), replication and partitioning
are trivial, there are no update locks contending with the insert firehose,
and an audit question ("why does the count say X?") always has a stable
answer.

**Indexes** — exactly two, both justified by a query:

1. `(url_id, occurred_at DESC)` composite — *the* analytics query shape:
   "events for link L in range [from, to)". Serves totals, series, and
   breakdown scans without a sort. `url_id` first because every query
   filters on it; `occurred_at` second for the range.
2. Unique on `event_id` — idempotency enforcement, nothing else.

Deliberately absent: indexes on country/browser/etc. (breakdowns always
scan within a link+range via index 1; dimension indexes would bloat the
write path that must stay cheap), and any index on `ip_hash` (abuse queries
are rare and can scan).

**Retention**: raw events kept **90 days** (configurable), then dropped;
aggregates (Phase 3) keep the long-tail history forever at negligible size.
Rationale: >95% of dashboard queries are last-30-days; 90d covers quarterly
reporting; bounded raw data is also the honest end of the privacy story.

**Partitioning (future, designed-for now)**: native range partitions by
month on `occurred_at`. Not needed until tens of millions of rows; the
design keeps the door open by (a) always querying with an `occurred_at`
range so partition pruning works, and (b) making retention = `DROP
PARTITION` (instant) instead of `DELETE WHERE` (a vacuum storm). The
`event_id` uniqueness constraint becomes per-partition then — acceptable,
since retried inserts land in the same partition (same `occurred_at`).

## Part 4 — Redirect flow with analytics

**Phase 1 (synchronous process, asynchronous request):**

```
GET /:code
  → RedirectCache (Redis)  → hit: rules re-evaluated
  → miss: Postgres         → populate cache
  → 302 sent to client                        ← latency budget ends HERE
  → fire-and-forget, after the response:
      • enrich (GeoIP, UA parse, ipHash)
      • INSERT click_event (ON CONFLICT DO NOTHING)
      • urls.click_count increment (existing incrementClickCount())
```

The INSERT is issued in the same process but **never awaited by the request
path** — same pattern, same rationale, and same helper discipline as the
cache's fire-and-forget SETs. If the insert fails (DB blip), the event is
dropped and a counter/log line records the drop. Losing an event is
acceptable; delaying a redirect is not.

**Phase 2 (BullMQ):**

```
GET /:code → Redis/Postgres resolve → enqueue raw event to BullMQ → 302
Worker (separate process): dequeue → enrich → INSERT → increment counter
```

**Why this evolution makes sense** — what actually changes and when it's
worth it:

- Phase 1's weaknesses are precise: enrichment (GeoIP lookup, UA parsing)
  burns web-process CPU; a Postgres outage silently drops events; a crash
  loses in-flight inserts. All tolerable at low volume.
- Phase 2 fixes exactly those: enrichment moves to a worker (web process
  does only a Redis LPUSH-equivalent, ~zero CPU), the queue **buffers
  through DB outages** (events persist in Redis until the worker drains
  them), retries with backoff come free, and workers scale independently of
  web instances.
- The migration is small *because* Phase 1 is shaped for it: the service
  already emits a raw event to a `ClickSink` port (see below); Phase 1's
  sink enriches-and-inserts in-process, Phase 2's sink enqueues. The
  service, controllers, and event model do not change — only the sink
  implementation and a new worker process.
- BullMQ specifically: it runs on the Redis we already operate, is the
  Node-ecosystem default (boring is good), and its at-least-once semantics
  match our idempotent insert (Part 7). Caveat owned: Redis is now
  durability-relevant for *queued* events (cache loss was always free) —
  AOF persistence on the queue's Redis, or accepting small loss windows, is
  a deployment decision documented at Phase 2 rollout.

**Architectural placement** (aligned with the existing module pattern): a
new `modules/analytics/` module (repository, service, controller, routes,
types — same file shapes as `modules/url/`). The URL module gains one
injected port, `ClickSink.record(rawEvent): void` (fire-and-forget by
signature), consumed at the single point where a redirect is approved. A
`NullClickSink` default preserves current behavior exactly, mirroring
`NullRedirectCache` — analytics is opt-in by composition, and the URL
module never imports the analytics module's internals (ports only, no
cycles).

## Part 5 — API design

One endpoint, exactly as reserved in `api-v1-spec.md` §7:

`GET /api/v1/urls/:shortCode/analytics` — auth required from day one
(click data is owner-sensitive), 404 for unknown/unowned codes, standard
envelope. Query params as specced: `from`, `to`, `interval`
(hour|day|week|month), `limit` (1–100, breakdown list size). The
already-written Zod schema (`analyticsQuerySchema`) validates this today.

Response = the §7 contract (range, totals, firstClickAt/lastClickAt,
zero-filled `timeSeries`, uniform `{value,label,clicks,percentage}`
breakdowns for countries/cities/browsers/OS/devices/referrers) **plus one
additive block** the spec explicitly permits:

```json
"summary": {
  "allTime": 1234,
  "today": 41,
  "last7Days": 310,
  "last30Days": 990
}
```

`summary` answers Part 1's headline questions without forcing clients to
issue four range queries; `totals` stays range-scoped as specced. A future
`totals.uniqueVisitors` (distinct ipHash per day, summed) is additive too.

**Pagination & filtering**: none for breakdowns — `limit` (top-N) is the
product feature; nobody pages to the 400th referrer. The `timeSeries` is
bounded instead of paginated: range ÷ interval is capped (~400 buckets);
a range/interval combination exceeding it → 400 `VALIDATION_ERROR` telling
the caller to coarsen the interval. A raw-event export endpoint is
explicitly *not* offered (privacy posture: aggregates only).

## Part 6 — Aggregation strategy

**Option A — query raw events per request.** One indexed range scan +
GROUP BYs per breakdown. *Simplicity*: maximal — no second dataset, no
drift possible, filters/intervals are free. *Correctness*: perfect by
construction. *Storage*: raw events only. *Performance*: linear in events-
per-link-per-range; with index 1, a 100k-click link over 30 days answers in
tens of milliseconds; a 10M-click link does not.

**Option B — maintained aggregates** (e.g. `click_stats_daily(url_id, day,
country, browser, …, count)` upserted per event or per batch). *Performance*:
constant-time reads at any scale. *Costs*: a second write path that can
drift from the truth, upsert contention on hot (url, day) rows, a backfill
story, dimensional rigidity (every new breakdown = schema + backfill), and
meaningful implementation surface.

**Recommendation: Option A at launch — verbatim.** The deciding argument is
that correctness bugs in Option B are silent (numbers just look plausible),
while Option A's failure mode is loud and benign (a slow query). At current
scale (counter never even wired yet), buying Option B's complexity now is
premature optimization by definition. Option B is not rejected — it is
**scheduled**: it becomes Phase 3 when observed p95 analytics latency
exceeds ~500ms or any link crosses ~1M events in a hot window. Its design
constraint is fixed now: aggregates are a *cache of Option A* — rebuildable
from raw events at any time, never the source of truth, so drift is
repairable and the API needs no changes (same contract, faster backend).

## Part 7 — Failure modes

- **Duplicate events**: the redirect path fires exactly one `record()` per
  302, but retries (Phase 2) and at-least-once delivery can replay it. The
  `eventId` UUID minted at redirect + unique index + `ON CONFLICT DO
  NOTHING` makes ingestion **idempotent**: replays are free. The
  `click_count` increment is *not* idempotent — accepted for the
  denormalized counter (it is a display convenience; the events table is
  the truth, and Phase 3 can reconcile drift), documented so nobody
  "fixes" it into a distributed transaction. In Phase 2 the increment can
  move behind the same idempotent insert (increment only when the insert
  actually inserted), upgrading it to effectively-once.
- **Lost events**: Phase 1 loses events during DB outages and process
  crashes (bounded by fire-and-forget volume in flight). Explicitly
  accepted and *measured* (a dropped-events counter in logs), never silent.
  Phase 2 shrinks the loss window to Redis durability.
- **Clock skew**: `occurredAt` is stamped by the web instance, so
  multi-instance skew (NTP-bounded, ms–s) lands inside single buckets —
  irrelevant for hour+ granularity. What matters is *consistency of
  source*: never mix DB `now()` and app time, or Phase 2's insert lag would
  silently shift events into wrong buckets.
- **Retries**: writes to the sink are try-once in Phase 1 (retrying inside
  the web process trades redirect capacity for analytics completeness —
  wrong trade). Phase 2: BullMQ exponential backoff, capped attempts, then
  a dead-letter queue that is monitored, not auto-replayed.
- **Database outage**: redirects keep working (cache + eventually PG
  recovery — analytics never joins the redirect's failure domain). Phase 1
  drops events for the duration; Phase 2 buffers them in the queue and
  drains on recovery — this is the single biggest operational win of the
  queue.
- **Exactly-once vs at-least-once**: exactly-once end-to-end is a myth
  across process boundaries; we choose **at-least-once delivery +
  idempotent ingestion**, which yields exactly-once *effects* for the
  events table. That is the strongest guarantee actually purchasable, and
  it costs one UUID and one unique index.

## Part 8 — Testing strategy

Same three-tier shape as the existing suite, same mocking rule (own
interfaces only):

- **Unit — URL module**: with a `FakeClickSink`, assert `record()` fires
  exactly once per approved redirect (cache hit AND miss paths), never on
  404/inactive/expired, never on metadata reads; with a `ThrowingClickSink`,
  redirects still succeed (fail-open, mirroring the cache tests).
- **Unit — analytics module**: enrichment is pure-function testing —
  UA-string table tests → expected slugs; GeoIP resolver behind a port with
  a fake; ipHash determinism within a salt window and divergence across
  windows; aggregation service tested against a mocked repository
  (zero-filling, percentage math, limit truncation, range validation).
- **Integration** (real stack, extending the existing pattern): redirect →
  poll for the `click_events` row with correct urlId/dimensions; duplicate
  `eventId` inserted twice → one row (idempotency proven at the DB);
  analytics endpoint over seeded events → exact §7 contract shape,
  zero-filled series, correct top-N; sink pointed at a dead DB → redirect
  still 302s (observable fail-open); events for soft-deleted links remain
  queryable (history survives link death).
- **Worker tests (Phase 2)**: job replay idempotency (process the same job
  twice → one row), retry-then-succeed, poison message → DLQ after N
  attempts, and a drain test (enqueue during simulated DB outage → all
  events present after recovery). The worker is a thin shell around the
  same ingestion service the unit tests already covered — by design, so
  worker tests stay few.

## Part 9 — Evolution

- **Phase 1 — synchronous analytics** (one sprint-sized change): `ClickSink`
  port + in-process enriching sink, `click_events` migration, wire
  `incrementClickCount`, analytics module with Option-A queries behind the
  §7 endpoint (behind auth, or feature-flagged until auth ships). Ships
  user-visible value immediately; every later phase is invisible to the API.
- **Phase 2 — BullMQ** (trigger: enrichment CPU visible in web-process
  profiles, or event loss during any DB incident): swap the sink for an
  enqueueing sink + worker process; add DLQ monitoring; move the counter
  increment behind the idempotent insert. No API, schema, or service
  changes.
- **Phase 3 — aggregates** (trigger: analytics p95 > ~500ms or ~1M-event
  hot links): worker additionally maintains rollup tables as a rebuildable
  cache; API backend switches query source; raw-event retention can then
  shorten. No contract changes.
- **Phase 4 — advanced dashboards**: uniqueVisitors (additive field),
  hourly heatmaps, comparison ranges, webhooks/exports — all consumers of
  the same event stream and aggregates; by here the pipeline is a stable
  platform and features are additive products on top.

Each phase has a *measured trigger*, not a date — the system earns its next
stage of complexity with evidence, which is the same discipline that kept
the redirect cache design honest.
