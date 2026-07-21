import { Prisma, type PrismaClient } from '../../generated/prisma/client.js';
import {
  EmailTakenError,
  type CreateUserInput,
  type UpdateUserInput,
  type User,
} from './user.types.js';

const UNIQUE_VIOLATION = 'P2002';

/** Filter that hides soft-deleted users from every read — mirrors url.repository.ts. */
const notDeleted = { deletedAt: null } as const;

/**
 * Persistence contract for users. Persistence only — password verification,
 * session issuance, and every other business rule live in services.
 */
export interface UserRepository {
  /** Persist a new user. Throws EmailTakenError if the email is registered. */
  create(input: CreateUserInput): Promise<User>;

  /** Look up by the (lowercased) login email. Hides soft-deleted accounts. */
  findByEmail(email: string): Promise<User | null>;

  /**
   * Look up by internal id (e.g. resolving an access token's subject).
   * Hides soft-deleted accounts.
   */
  findById(id: bigint): Promise<User | null>;

  /** Apply a partial update (display name and/or password hash). */
  update(id: bigint, input: UpdateUserInput): Promise<User>;

  /**
   * Tombstone a user by setting deletedAt — never a hard delete (Url.creator
   * is onDelete: Restrict, so a user with any links can't be removed from
   * Postgres without an explicit purge decision this feature doesn't make).
   */
  softDelete(id: bigint): Promise<void>;
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly db: PrismaClient) {}

  async create(input: CreateUserInput): Promise<User> {
    try {
      return await this.db.user.create({ data: input });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === UNIQUE_VIOLATION
      ) {
        throw new EmailTakenError(input.email);
      }
      throw error;
    }
  }

  findByEmail(email: string): Promise<User | null> {
    return this.db.user.findFirst({ where: { email, ...notDeleted } });
  }

  findById(id: bigint): Promise<User | null> {
    return this.db.user.findFirst({ where: { id, ...notDeleted } });
  }

  update(id: bigint, input: UpdateUserInput): Promise<User> {
    return this.db.user.update({ where: { id }, data: input });
  }

  async softDelete(id: bigint): Promise<void> {
    await this.db.user.update({ where: { id }, data: { deletedAt: new Date() } });
  }
}
