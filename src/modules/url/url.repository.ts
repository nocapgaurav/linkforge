import { prisma } from '../../config/prisma.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import {
  ShortCodeConflictError,
  type CreateUrlInput,
  type UpdateUrlInput,
  type Url,
} from './url.types.js';

/**
 * Persistence contract for URL entities.
 *
 * This interface is what the rest of the application depends on; the Prisma
 * implementation lives below it. Soft-deleted rows are treated as gone at
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
   * Keyset-paginated listing of live rows, newest first
   * (created_at DESC, id DESC — id breaks same-millisecond ties). `before`
   * is the exclusive keyset position; rows strictly after it in sort order
   * are returned. Soft-deleted rows are excluded. Returns exactly the rows
   * asked for — page-size math (hasMore, cursors) is the caller's concern.
   */
  list(options: { limit: number; before?: { createdAt: Date; id: bigint } }): Promise<Url[]>;

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

const UNIQUE_VIOLATION = 'P2002';
const RECORD_NOT_FOUND = 'P2025';

/** Filter that hides soft-deleted rows from every operation. */
const notDeleted = { deletedAt: null } as const;

/**
 * Prisma-backed implementation of UrlRepository.
 *
 * This module is the only place in the application (besides the client
 * factory in src/config/prisma.ts) allowed to import Prisma. The client is
 * injected so tests can substitute a stub or a client bound to a test
 * database.
 */
export class PrismaUrlRepository implements UrlRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateUrlInput): Promise<Url> {
    try {
      return await this.db.url.create({ data: input });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new ShortCodeConflictError(input.shortCode);
      }
      throw error;
    }
  }

  findByShortCode(shortCode: string): Promise<Url | null> {
    return this.db.url.findFirst({ where: { shortCode, ...notDeleted } });
  }

  findById(id: bigint): Promise<Url | null> {
    return this.db.url.findFirst({ where: { id, ...notDeleted } });
  }

  list(options: { limit: number; before?: { createdAt: Date; id: bigint } }): Promise<Url[]> {
    const { limit, before } = options;
    return this.db.url.findMany({
      where: {
        ...notDeleted,
        // Keyset predicate: (created_at, id) < (before.createdAt, before.id)
        // in DESC order — strictly older, or same instant with a smaller id.
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });
  }

  async update(id: bigint, input: UpdateUrlInput): Promise<Url | null> {
    try {
      return await this.db.url.update({ where: { id, ...notDeleted }, data: input });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === RECORD_NOT_FOUND
      ) {
        return null;
      }
      throw error;
    }
  }

  async incrementClickCount(id: bigint): Promise<void> {
    await this.db.url.updateMany({
      where: { id, ...notDeleted },
      data: { clickCount: { increment: 1 } },
    });
  }

  async softDelete(id: bigint): Promise<Date | null> {
    const deletedAt = new Date();
    const result = await this.db.url.updateMany({
      where: { id, ...notDeleted },
      data: { deletedAt },
    });
    return result.count > 0 ? deletedAt : null;
  }
}

/** Application-wide repository instance wired to the shared Prisma client. */
export const urlRepository: UrlRepository = new PrismaUrlRepository(prisma);
