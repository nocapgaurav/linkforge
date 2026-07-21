import type { PrismaClient } from '../../generated/prisma/client.js';

/** An authenticated session as stored (see schema: sessions). */
export interface Session {
  id: bigint;
  userId: bigint;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
}

export interface CreateSessionInput {
  userId: bigint;
  tokenHash: string;
  expiresAt: Date;
}

/**
 * Persistence contract for sessions. Deliberately returns rows in ANY
 * state (revoked/expired included): whether a session is still usable —
 * and what a revoked-token replay means — are business rules the auth
 * service owns. Rows are never deleted; revoked sessions are login
 * history and the raw material for reuse detection.
 */
export interface SessionRepository {
  create(input: CreateSessionInput): Promise<Session>;

  /** Exact-state lookup by token hash; null only when no row exists. */
  findByTokenHash(tokenHash: string): Promise<Session | null>;

  /** Stamp revokedAt (idempotent) and bump lastUsedAt. */
  revokeById(id: bigint): Promise<void>;

  /** Revoke every live session of a user (logout-everywhere, reuse response). */
  revokeAllForUser(userId: bigint): Promise<void>;
}

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: PrismaClient) {}

  create(input: CreateSessionInput): Promise<Session> {
    return this.db.session.create({ data: input });
  }

  findByTokenHash(tokenHash: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { tokenHash } });
  }

  async revokeById(id: bigint): Promise<void> {
    await this.db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date(), lastUsedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: bigint): Promise<void> {
    await this.db.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
