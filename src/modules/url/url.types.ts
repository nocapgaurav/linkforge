/**
 * Domain types for the URL module.
 *
 * These types are the persistence contract exposed to the rest of the
 * application. They intentionally mirror the fields of the `urls` table
 * (see docs/url-entity-design.md) without referencing Prisma, so callers
 * never depend on generated database types.
 */

/** A shortened URL as stored in the database. */
export interface Url {
  /** Internal surrogate key. Never exposed publicly. */
  id: bigint;
  /** Public identifier: generated base62 code or user-chosen alias. */
  shortCode: string;
  /** Whether shortCode was user-supplied rather than generated. */
  isCustomAlias: boolean;
  /** Destination the short link redirects to. */
  originalUrl: string;
  /** SHA-256 hex of originalUrl, used for dedup lookups. */
  urlHash: string;
  /** Denormalized total redirect count. */
  clickCount: bigint;
  /** Soft on/off switch; inactive links keep their code reserved. */
  isActive: boolean;
  /** Expiry timestamp; null means the link never expires. */
  expiresAt: Date | null;
  /** Owning user; null for anonymously created links. */
  createdBy: bigint | null;
  createdAt: Date;
  updatedAt: Date;
  /** Soft-delete tombstone; a non-null value means the row is deleted. */
  deletedAt: Date | null;
}

/**
 * Fields required to persist a new URL. Code generation and hashing happen
 * upstream — the repository stores exactly what it is given.
 */
export interface CreateUrlInput {
  shortCode: string;
  isCustomAlias?: boolean;
  originalUrl: string;
  urlHash: string;
  expiresAt?: Date | null;
  createdBy?: bigint | null;
}

/**
 * Mutable fields of an existing URL. `shortCode` is deliberately absent:
 * a link's public identity is immutable once issued.
 */
export interface UpdateUrlInput {
  originalUrl?: string;
  urlHash?: string;
  isActive?: boolean;
  /** Pass null to clear the expiry (link never expires). */
  expiresAt?: Date | null;
}

/**
 * Thrown by create() when the short code is already taken. Translates the
 * database's unique-constraint violation so callers can handle conflicts
 * without knowing which ORM or database produced them.
 */
export class ShortCodeConflictError extends Error {
  readonly shortCode: string;

  constructor(shortCode: string) {
    super(`Short code already in use: ${shortCode}`);
    this.name = 'ShortCodeConflictError';
    this.shortCode = shortCode;
  }
}
