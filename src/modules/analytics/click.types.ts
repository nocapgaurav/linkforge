/**
 * Domain types for the analytics module (docs/analytics-design.md §2).
 *
 * Persistence contract only — no Prisma types leak out of the repository.
 * Enrichment fields are nullable/optional: Phase 1 records whatever the
 * caller already knows; GeoIP and user-agent enrichment arrive later and
 * only fill in more of the same shape.
 */

/** A click event as stored: one approved redirect, append-only. */
export interface ClickEvent {
  id: bigint;
  /** Idempotency key minted at redirect time (UUID). */
  eventId: string;
  urlId: bigint;
  /** Event time (when the redirect happened), not insert time. */
  occurredAt: Date;
  /**
   * Salted, truncated SHA-256 of the client IP; null until enrichment.
   * (Uint8Array<ArrayBuffer> to match Prisma 7's Bytes typing exactly.)
   */
  ipHash: Uint8Array<ArrayBuffer> | null;
  country: string | null;
  city: string | null;
  browser: string | null;
  browserVersion: string | null;
  os: string | null;
  device: string | null;
  referrerHost: string | null;
  requestId: string | null;
}

/**
 * Input for recording a click. Only the identity of the click is required;
 * every dimension is optional so un-enriched Phase 1 events are valid.
 */
export interface NewClickEvent {
  eventId: string;
  urlId: bigint;
  occurredAt: Date;
  ipHash?: Uint8Array<ArrayBuffer> | null;
  country?: string | null;
  city?: string | null;
  browser?: string | null;
  browserVersion?: string | null;
  os?: string | null;
  device?: string | null;
  referrerHost?: string | null;
  requestId?: string | null;
}
