# URL Entity Design

Status: Approved design, not yet implemented. This document is the source of truth
for the future Prisma `Url` model. No SQL or Prisma schema here by design.

## Design goals

1. The redirect path (`GET /:code` → original URL) is the hot path. It must resolve
   with a single indexed lookup on one table.
2. Short codes are the public identity of a link. They must never be guessable from
   internal IDs and must never be recycled.
3. Everything else (analytics, expiry, ownership) must not slow the hot path down.

## Fields

| Field          | Type                        | Required | Unique | Indexed | Purpose |
|----------------|-----------------------------|----------|--------|---------|---------|
| `id`           | bigint, auto-increment      | yes      | yes (PK) | PK    | Internal surrogate key. Never exposed publicly. |
| `shortCode`    | string (varchar 32, case-sensitive) | yes | yes | unique index | The public identifier used in the short URL. Holds either a generated base62 code (6–8 chars) or a user-chosen custom alias. |
| `isCustomAlias`| boolean, default `false`    | yes      | no     | no      | Whether `shortCode` was user-supplied or system-generated. Drives validation rules and analytics. |
| `originalUrl`  | text (app-validated ≤ 2048) | yes      | no     | no      | The destination URL to redirect to. Not unique: many users may shorten the same URL. |
| `urlHash`      | string (fixed-length SHA-256 hex/base64) | yes | no | non-unique index | Hash of `originalUrl` for cheap "have we seen this URL before?" dedup lookups without indexing a long text column. |
| `clickCount`   | bigint, default 0           | yes      | no     | no      | Denormalized total redirect count. Written asynchronously/batched, never inside the redirect transaction. |
| `isActive`     | boolean, default `true`     | yes      | no     | no      | Soft on/off switch. Inactive links return 404/410 but keep their code reserved. |
| `expiresAt`    | timestamptz, nullable       | no       | no     | partial index (`WHERE expiresAt IS NOT NULL`) | Optional expiry. `NULL` = never expires. Checked lazily at redirect time; the index serves the cleanup/deactivation job. |
| `createdBy`    | bigint / uuid, nullable (future FK to User) | no | no | composite with `createdAt` | Owner of the link. Nullable so anonymous shortening works before auth lands. |
| `createdAt`    | timestamptz, default now    | yes      | no     | see composite | Audit + dashboard sorting. |
| `updatedAt`    | timestamptz, auto-updated   | yes      | no     | no      | Audit trail for edits (destination change, deactivation). |
| `deletedAt`    | timestamptz, nullable       | no       | no     | no      | Soft delete. Codes are tombstoned, never freed, so a deleted link's code can't be re-registered to hijack old traffic. |

## Indexes

1. **Unique index on `shortCode`** — the redirect lookup. This is the only index the
   hot path touches. Must use a case-sensitive collation (base62 distinguishes
   `aB` from `ab`; a case-insensitive collation would nearly halve the keyspace and
   cause false collisions).
2. **Primary key on `id`** — internal joins and FK references.
3. **Non-unique index on `urlHash`** — dedup check at creation time ("return the
   existing short link for this URL/owner instead of minting a new one").
4. **Partial index on `expiresAt` (non-null rows only)** — lets the periodic cleanup
   job find expired links without scanning the table. Partial because most links
   never expire; indexing the NULLs would be wasted space and write overhead.
5. **Composite index on (`createdBy`, `createdAt` DESC)** — "my links" dashboard
   listing, newest first, without a sort step.

Deliberately **not** indexed: `isActive` (boolean, low cardinality — always checked
after the `shortCode` lookup has already narrowed to one row), `clickCount` (only
needed if a global "top links" leaderboard ships; add a partial/covering index then),
`originalUrl` (long text; `urlHash` is its index proxy).

## Key decisions and trade-offs

**One `shortCode` column instead of separate `shortCode` + `customAlias` columns.**
A separate nullable-unique `customAlias` column means the redirect handler must check
two indexes (`WHERE shortCode = ? OR customAlias = ?`) and enforce uniqueness *across*
two columns, which the database can't do declaratively — a generated code could
collide with someone's alias. Folding both into one column gives one unique index,
one lookup, and database-enforced global uniqueness. The `isCustomAlias` flag
preserves the distinction for validation and analytics. The cost: a link can't have
both a generated code *and* an alias simultaneously — acceptable, since a
user-supplied alias makes the generated code redundant.

**Random generation with collision retry, not base62-encoding the row ID.**
Encoding the auto-increment ID is tempting (guaranteed unique, no retries) but makes
codes sequential and enumerable — anyone can walk the entire link space and scrape
destinations. Generate codes from a CSPRNG over the base62 alphabet; at 7 chars
(62⁷ ≈ 3.5 trillion) collisions are rare enough that "insert, catch unique violation,
retry" is cheap. The column is varchar(32) rather than exactly 7 so custom aliases
and future code-length growth need no migration.

**`clickCount` denormalized on the row, incremented out-of-band.**
The alternative — a `Click` events table with `COUNT(*)` — is the right long-term
analytics design (per-referrer, per-day, per-geo stats all need it), but counting on
read gets slow fast. We keep the denormalized counter for cheap display, with the
rule that increments happen *after* the redirect response is sent (fire-and-forget
update or batched flush), never in the request's critical path, because a viral link
would otherwise serialize all its redirects on one row lock. Accepting slight
undercount on crash is the trade. A `Click` event table can be added later as a
separate entity without touching this one.

**Expiry is checked lazily, enforced eventually.**
The redirect handler treats a link as dead when `isActive = false`, `deletedAt` is
set, or `expiresAt < now()` — so expiry is instant-correct without any background
machinery. The cron job that flips expired links to `isActive = false` (via the
partial index) is a hygiene task, not a correctness requirement. This avoids the
classic bug where a link stays live between cron runs.

**Soft delete only; codes are never recycled.**
Old short links live in emails, PDFs, and printed QR codes forever. If a deleted
code were re-issued, the new owner inherits that residual traffic — a phishing
vector. `deletedAt` tombstones the row and the unique index keeps the code reserved
permanently. The cost is table growth from dead rows, which is negligible at URL-row
sizes and can be archived if it ever matters.

**`originalUrl` as unbounded text with application-level 2048 validation.**
A hard varchar(2048) puts a data constraint in the schema that's really a product
policy; changing it later means a table rewrite on some engines. Text + app
validation keeps the limit adjustable. The `urlHash` column exists precisely so we
never need to index or compare the long column directly.

**`bigint` auto-increment PK, not UUID.**
The ID is never exposed (that's `shortCode`'s job), so UUID's unguessability buys
nothing here, while bigint halves index size and keeps inserts append-ordered. If
LinkForge later goes multi-region with independent writers, switch to UUIDv7 —
that's the one scenario that would flip this decision.

## Redirect-path contract (for the future service layer)

Lookup: single query by `shortCode`. A link redirects only if the row exists,
`deletedAt IS NULL`, `isActive = true`, and (`expiresAt IS NULL` or
`expiresAt > now()`). Otherwise return 404 (never reveal whether a code is
deleted vs never existed). Click counting happens after the response.
