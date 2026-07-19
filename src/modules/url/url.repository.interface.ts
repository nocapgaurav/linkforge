import type { CreateUrlInput, UpdateUrlInput, Url } from './url.types.js';

/**
 * Persistence contract for URL entities.
 *
 * This interface is what the rest of the application depends on; the Prisma
 * implementation lives behind it. Soft-deleted rows are treated as gone at
 * this layer: finds return null for them and writes refuse to touch them.
 * All other visibility rules (isActive, expiresAt) are business decisions
 * and are NOT applied here — rows are returned as stored.
 */
export interface UrlRepository {
  /**
   * Persist a new URL row and return it as stored (with generated id and
   * timestamps). Throws ShortCodeConflictError if the short code is taken.
   */
  create(input: CreateUrlInput): Promise<Url>;

  /**
   * Look up a URL by its public short code — the redirect hot path.
   * Returns null if no live row has that code.
   */
  findByShortCode(shortCode: string): Promise<Url | null>;

  /**
   * Look up a URL by its internal id.
   * Returns null if no live row has that id.
   */
  findById(id: bigint): Promise<Url | null>;

  /**
   * Apply a partial update to a live URL row and return the updated row,
   * or null if the row does not exist or is soft-deleted.
   */
  update(id: bigint, input: UpdateUrlInput): Promise<Url | null>;

  /**
   * Atomically increment the denormalized click counter by one. A no-op if
   * the row is missing or soft-deleted. Returns nothing so callers can
   * fire-and-forget it off the redirect's critical path.
   */
  incrementClickCount(id: bigint): Promise<void>;

  /**
   * Tombstone a URL by setting deletedAt. The row (and its short code) is
   * retained forever so codes are never recycled. Idempotent: returns the
   * tombstone timestamp if a live row was deleted, null if it was already
   * gone.
   */
  softDelete(id: bigint): Promise<Date | null>;
}
