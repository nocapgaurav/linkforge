# LinkForge Public REST API — Version 1 Specification

Status: Implemented (all sections including §7 analytics as of 2026-07-19).
This document is the source of truth for the v1 HTTP layer. Frontend and
backend teams can build against it independently. Companion documents:
`url-entity-design.md` (storage model), `analytics-design.md` (analytics
system design).

---

## 1. Conventions

### 1.1 Base URL and versioning

- **Management API**: all management endpoints live under `/api/v1/…`.
  Breaking changes ship as `/api/v2`; `v1` remains stable once published.
- **Redirect endpoint**: `GET /:shortCode` lives at the domain root, outside
  `/api`, because short links must be as short as possible. It is a public,
  unversioned, browser-facing endpoint and is exempt from the JSON envelope
  (it responds with HTTP redirects).

### 1.2 Content type

Every request with a body MUST send `Content-Type: application/json`.
Every response except redirects is `application/json; charset=utf-8`.

### 1.3 Response envelope

Success:

```json
{
  "success": true,
  "data": { }
}
```

Error:

```json
{
  "success": false,
  "error": {
    "code": "MACHINE_READABLE_CODE",
    "message": "Human-readable explanation.",
    "details": [
      { "field": "originalUrl", "message": "Must be a valid http(s) URL." }
    ]
  }
}
```

- `error.code` is a stable, machine-readable string from the registry in §6.
  Clients branch on `code`, never on `message`.
- `error.details` is optional; present only for validation errors (one entry
  per invalid field).
- The envelope is additive-only: future versions may add sibling keys (e.g.
  `meta` for pagination) but will never remove or rename `success`, `data`,
  `error`.

### 1.4 Common headers

| Header | Direction | v1 behavior |
|---|---|---|
| `Content-Type: application/json` | request | Required on POST/PATCH |
| `Authorization: Bearer <token>` | request | **Reserved.** Ignored in v1; will scope requests to a user/team without any URL changes |
| `X-API-Key: <key>` | request | **Reserved.** Alternative machine credential, same forward-compat contract |
| `X-Request-Id` | response | Unique id per request, echoed for support/debugging |
| `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` | response | **Reserved.** Sent once rate limiting ships; clients should tolerate their presence |

### 1.5 Data conventions

- Timestamps: ISO 8601 UTC with `Z` suffix (`2026-07-19T12:00:00.000Z`).
- `clickCount` is serialized as a JSON number. (Stored as 64-bit int; values
  above 2^53 are unreachable in practice, and the analytics endpoint is the
  long-term home for counting.)
- Internal database ids are **never** exposed. `shortCode` is the public
  identifier of a link and the key used in every URL path.
- `shortCode` path matching is case-sensitive (`aB3` ≠ `ab3`).

### 1.6 The URL resource

The representation returned by every endpoint that returns a link:

```json
{
  "shortCode": "aB3xK9q",
  "shortUrl": "https://linkforge.example/aB3xK9q",
  "originalUrl": "https://example.com/some/very/long/path?with=params",
  "isCustomAlias": false,
  "isActive": true,
  "clickCount": 42,
  "expiresAt": null,
  "createdAt": "2026-07-19T12:00:00.000Z",
  "updatedAt": "2026-07-19T12:00:00.000Z"
}
```

Notes:
- `shortUrl` is computed server-side from the configured public domain. When
  custom domains ship, this field simply reflects the link's domain — no
  contract change.
- Not exposed: `id`, `urlHash`, `createdBy`, `deletedAt` (internal).
- Future additive fields (non-breaking): `domain`, `teamId`, `hasPassword`,
  `qrCodeUrl`, `tags`.

---

## 2. `POST /api/v1/urls` — Create a shortened URL

**Purpose**: Create a short link for an original URL, with an optional custom
alias and optional expiry.

**Method / Route**: `POST /api/v1/urls`

**Request headers**: `Content-Type: application/json` (required).
`Authorization` / `X-API-Key` reserved (see §1.4).

**Path parameters**: none. **Query parameters**: none.

**Request body**:

| Field | Type | Required | Description |
|---|---|---|---|
| `originalUrl` | string | yes | Destination to redirect to |
| `customAlias` | string | no | Caller-chosen short code. Omit for a generated code |
| `expiresAt` | string (ISO 8601) or null | no | Expiry instant; omit/null = never expires |

Reserved future body fields (will be additive, never repurposed): `domain`,
`password`, `teamId`, `tags`.

**Validation rules**:

- `originalUrl`: required; absolute URL; scheme must be `http` or `https`;
  max 2048 characters after trimming; must not resolve to the service's own
  short domain (redirect-loop prevention).
- `customAlias`: 3–32 characters; charset `[A-Za-z0-9_-]`; case-sensitive;
  must not collide with a reserved path segment (`api`, `health`, `docs`,
  `admin`, `assets`, and the published reserved-words list); uniqueness
  enforced against all existing short codes.
- `expiresAt`: valid ISO 8601; must be in the future.
- Unknown body fields are rejected (`VALIDATION_ERROR`) to keep typos loud.

**Success response**: `201 Created`
- Header `Location: /api/v1/urls/{shortCode}`
- Body: envelope with `data` = URL resource (§1.6).

**Error responses**:

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Any rule above fails (per-field `details`) |
| 400 | `MALFORMED_JSON` | Body is not parseable JSON |
| 409 | `ALIAS_TAKEN` | `customAlias` already in use (including tombstoned codes — codes are never recycled) |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | Missing/wrong `Content-Type` |
| 429 | `RATE_LIMITED` | Reserved for rate limiting |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

---

## 3. `GET /:shortCode` — Redirect

**Purpose**: The product's hot path. Resolve a short code and redirect the
client to the original URL.

**Method / Route**: `GET /:shortCode` (domain root, not under `/api`)

**Request headers**: none required. `User-Agent`, `Referer`, and IP are read
(not required) once analytics ships; this adds no contract requirements for
callers.

**Path parameters**:

| Param | Type | Rules |
|---|---|---|
| `shortCode` | string | 3–32 chars, `[A-Za-z0-9_-]`, case-sensitive |

**Query parameters**: none. Unknown query strings are ignored (links get
shared with tracking params appended; they must not break redirects).

**Request body**: none.

**Success response**: `302 Found`
- Header `Location: <originalUrl>`
- Header `Cache-Control: private, no-cache` — deliberately **not** `301`:
  a permanent redirect would let browsers/CDNs cache the hop, bypassing the
  server, which would silently kill click counting and make deactivation,
  expiry, and deletion unenforceable.
- No meaningful body.

**Error responses** (JSON envelope; these are not redirects):

| Status | `error.code` | When |
|---|---|---|
| 404 | `NOT_FOUND` | Code does not exist, is soft-deleted, is deactivated (`isActive: false`), **or** is expired |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

A link redirects only when the row exists, is not soft-deleted, `isActive`
is true, and `expiresAt` is null or in the future. All dead states return an
identical `404` on purpose: distinguishing "expired" from "deleted" from
"never existed" leaks information about the code space and about other
users' links. (A branded 404 page for browser clients is a presentation
concern and does not change this contract.)

**Validation rules**: a path segment that violates the `shortCode` shape is
still just a `404` — the redirect plane never explains itself.

---

## 4. `GET /api/v1/urls/:shortCode` — Retrieve link metadata

**Purpose**: Management-plane read of a link's full representation,
including states the redirect plane hides (inactive, expired).

**Method / Route**: `GET /api/v1/urls/:shortCode`

**Request headers**: none required in v1. `Authorization` reserved — once
auth ships, this endpoint returns only links the caller may view, with `404`
(not `403`) for other owners' links to avoid confirming code existence.

**Path parameters**: `shortCode` — same shape rules as §3.

**Query parameters**: none. **Request body**: none.

**Success response**: `200 OK` — envelope with `data` = URL resource (§1.6).
Inactive and expired links ARE returned (management plane shows the truth;
only the redirect plane hides them). Soft-deleted links are not.

**Error responses**:

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `shortCode` violates shape rules |
| 404 | `NOT_FOUND` | No live link with that code |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

---

## 5. `DELETE /api/v1/urls/:shortCode` — Soft delete a link

**Purpose**: Tombstone a link. The short code is retired permanently and is
never reissued (see entity design: recycled codes are a phishing vector).
The redirect plane starts returning `404` immediately.

**Method / Route**: `DELETE /api/v1/urls/:shortCode`

**Request headers**: none required in v1. **Security note**: until
authentication ships, anyone who knows a short code can delete it. This is
an accepted v1 gap, documented so it is not mistaken for a design intent —
the endpoint becomes owner-scoped the moment auth lands, with no contract
change.

**Path parameters**: `shortCode` — same shape rules as §3.

**Query parameters**: none. **Request body**: none.

**Success response**: `200 OK`

```json
{
  "success": true,
  "data": {
    "shortCode": "aB3xK9q",
    "deletedAt": "2026-07-19T12:34:56.000Z"
  }
}
```

(`200` + envelope rather than `204 No Content`: the spec's consistency rule
wins — every non-redirect response carries the envelope, and the deletion
timestamp is useful to clients.)

**Error responses**:

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `shortCode` violates shape rules |
| 404 | `NOT_FOUND` | No live link with that code (including already-deleted — DELETE is idempotent in effect; repeating it is safe and yields `404`) |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

---

## 6. Error code registry

Stable machine-readable codes. New codes may be added (clients must treat
unknown codes as generic failures of that HTTP class); existing codes are
never renamed or repurposed.

| Code | HTTP | Meaning |
|---|---|---|
| `VALIDATION_ERROR` | 400 | One or more request fields invalid (`details` lists them) |
| `MALFORMED_JSON` | 400 | Request body not parseable |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Wrong/missing Content-Type |
| `NOT_FOUND` | 404 | Resource absent (or hidden — see §3, §4) |
| `ALIAS_TAKEN` | 409 | Requested custom alias already in use |
| `RATE_LIMITED` | 429 | Reserved: request quota exceeded |
| `UNAUTHORIZED` | 401 | Reserved: missing/invalid credentials |
| `FORBIDDEN` | 403 | Reserved: authenticated but not allowed |
| `NOT_IMPLEMENTED` | 501 | Reserved: endpoint specified but not yet live (none currently) |
| `INTERNAL_ERROR` | 500 | Unexpected server failure; safe generic message |

---

## 7. `GET /api/v1/urls/:shortCode/analytics` — Link analytics

**Implemented** (2026-07-19). This contract supersedes the pre-implementation
draft that previously occupied this section — the endpoint had never shipped,
so the revision is not a breaking change. Changes from the draft: `hour`
interval and `limit` dropped; breakdowns are flat named-field lists instead
of `{value,label,clicks,percentage}`; a fixed-window `summary` block was
added; defaults and a maximum range were pinned down.

**Purpose**: Aggregated click analytics for one link. Aggregates only —
individual events are never exposed (privacy posture; see
`analytics-design.md`).

**Method / Route**: `GET /api/v1/urls/:shortCode/analytics`

**Request headers**: none required. **Known v1 gap** (same class as DELETE):
until authentication ships, anyone who knows a short code can read its
analytics; the endpoint becomes owner-scoped when auth lands, with no
contract change.

**Path parameters**: `shortCode` — same shape rules as §3; `404` for
unknown **or soft-deleted** links (management plane hides tombstones).

**Query parameters**:

| Param | Type | Default | Rules |
|---|---|---|---|
| `from` | ISO 8601 | `to` − 30 days | Start of window, inclusive |
| `to` | ISO 8601 | now | End of window, exclusive; must be > `from` |
| `interval` | enum | `day` | `day` \| `week` \| `month` — bucket size for `series` |

The window (`to` − `from`) must not exceed **365 days** → otherwise
`400 VALIDATION_ERROR`. Unknown query keys are ignored.

**Window semantics**: `series` and all breakdowns are scoped to
`[from, to)`. `summary` uses **fixed windows independent of the query
range** (all-time, since UTC midnight, trailing 7/30 days) so the headline
numbers are stable regardless of filtering.

**Example request**:

```
GET /api/v1/urls/aB3xK9q/analytics?from=2026-07-01T00:00:00Z&to=2026-07-19T00:00:00Z&interval=day
```

**Success response**: `200 OK`

```json
{
  "success": true,
  "data": {
    "summary": {
      "totalClicks": 1234,
      "today": 41,
      "last7Days": 310,
      "last30Days": 990
    },
    "series": [
      { "date": "2026-07-01", "count": 41 },
      { "date": "2026-07-02", "count": 0 },
      { "date": "2026-07-03", "count": 87 }
    ],
    "browsers":  [ { "browser": "chrome", "count": 800 } ],
    "devices":   [ { "device": "mobile", "count": 700 } ],
    "countries": [ { "country": "US", "count": 640 } ],
    "referrers": [ { "referrerHost": "t.co", "count": 300 } ]
  }
}
```

Contract properties:

- `series` buckets are aligned to the start of each `interval` in **UTC**
  (`week` starts ISO Monday, `month` on the 1st); `date` is the bucket
  start as `YYYY-MM-DD`. Empty buckets are included with `count: 0` —
  charts need no gap-filling.
- Breakdown lists are sorted by `count` descending, capped at **10**
  entries, and exclude events where the dimension is unknown (NULL) —
  e.g. direct visits do not appear under `referrers`.
- Enrichment (GeoIP, user-agent parsing) is not yet live, so breakdowns
  reflect only events that carry those dimensions; series and summary
  count every click.
- A link with no clicks returns zeroed `summary`, a fully zero-filled
  `series`, and empty breakdown lists.

**Error responses**:

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Bad `from`/`to`/`interval`, `to` ≤ `from`, or range > 365 days |
| 404 | `NOT_FOUND` | No live link with that code |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

## 8. Forward-compatibility design notes

How each planned feature lands without breaking v1 clients:

- **Authentication / API keys**: credentials travel in already-reserved
  headers (`Authorization`, `X-API-Key`). Endpoints keep their routes and
  shapes; they gain ownership scoping. Anonymous creation can remain
  permitted or return `401` by deployment policy — both are within contract.
- **Teams**: new resources under `/api/v1/teams/…`; the URL resource gains
  an additive `teamId` field.
- **Custom domains**: `shortUrl` already carries the full absolute URL, so
  per-link domains require only an additive `domain` field on create and on
  the resource.
- **QR codes**: sibling sub-resource `GET /api/v1/urls/:shortCode/qr`
  (mirrors the analytics pattern).
- **Link expiration**: already first-class in v1 (`expiresAt` in the create
  body and resource).
- **Password-protected links**: additive `password` field on create;
  resource gains boolean `hasPassword` (never the password itself); the
  redirect plane serves an interstitial instead of `302` for such links —
  new behavior on new links only.
- **Link updates**: `PATCH /api/v1/urls/:shortCode` is the reserved route
  (repository `update()` already supports it); not part of v1's public
  surface.
- **Listing**: shipped — see §9. (Pagination landed inside `data` as a
  `pagination` key rather than the once-sketched envelope-level `meta`; the
  envelope stays untouched.) Becomes owner-scoped when auth lands.
- **Versioning discipline**: within `v1`, changes are additive-only — new
  endpoints, new optional request fields, new response fields, new error
  codes. Anything else is `v2`.

---

## 9. `GET /api/v1/urls` — List links

**Implemented** (2026-07-19).

**Purpose**: Newest-first listing of live (non-deleted) links with cursor
pagination, for the dashboard.

> **Public demo limitation**: LinkForge has no authentication yet, so this
> endpoint lists **every** link in the deployment — the same accepted-gap
> class as unauthenticated DELETE (§5), but broader, since it exposes
> original URLs without knowing any code. Acceptable for local/demo use
> only; do not expose a public deployment with this endpoint enabled. When
> auth ships the route is unchanged and results simply become owner-scoped.

**Method / Route**: `GET /api/v1/urls`

**Query parameters**:

| Param | Type | Default | Rules |
|---|---|---|---|
| `limit` | int | 20 | 1–100; page size |
| `cursor` | string | — | Opaque keyset cursor from a previous page's `pagination.nextCursor` |

**Cursor format**: `<createdAtMs>_<id>` — the epoch-millisecond `createdAt`
and internal id of the last row of the previous page. Treat it as opaque:
the format may change; only ever pass back a `nextCursor` the API returned.
Malformed cursors → `400 VALIDATION_ERROR`.

**Pagination semantics**: keyset (a.k.a. cursor) pagination over
`ORDER BY created_at DESC, id DESC`. A page contains rows strictly *after*
the cursor position in that order; `hasMore` is computed by over-fetching
one row. Pages are stable under concurrent inserts (new links prepend
before your cursor; they never shift or duplicate rows in subsequent
pages). A cursor pointing past the oldest row yields an empty page with
`hasMore: false` — not an error.

**Success response**: `200 OK`

```json
{
  "success": true,
  "data": {
    "items": [ { "…": "URL resource (§1.6)" } ],
    "pagination": {
      "nextCursor": "1753000000000_42",
      "hasMore": true
    }
  }
}
```

`nextCursor` is `null` on the last page. Soft-deleted links never appear.

**Error responses**:

| Status | `error.code` | When |
|---|---|---|
| 400 | `VALIDATION_ERROR` | `limit` out of range/non-integer, malformed `cursor` |
| 500 | `INTERNAL_ERROR` | Unexpected failure |

## 10. CORS

Cross-origin browser access is opt-in per deployment via the
`FRONTEND_ORIGIN` environment variable (exactly one origin; never
hardcoded). When set, responses to that origin carry
`Access-Control-Allow-Origin` (+ `Vary: Origin`), and `OPTIONS` preflights
answer `204` allowing `GET,POST,DELETE` with `Content-Type`. When unset,
no CORS headers are emitted and browsers cannot call the API cross-origin —
the pre-CORS behavior.
