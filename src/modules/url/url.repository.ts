import { prisma } from '../../config/prisma.js';
import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import type { UrlRepository } from './url.repository.interface.js';
import {
  ShortCodeConflictError,
  type CreateUrlInput,
  type UpdateUrlInput,
  type Url,
} from './url.types.js';

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
