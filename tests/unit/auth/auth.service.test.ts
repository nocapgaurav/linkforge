import bcrypt from 'bcrypt';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvalidCredentialsError, UnauthorizedError } from '../../../src/modules/auth/auth.errors';
import { DefaultAuthService } from '../../../src/modules/auth/auth.service';
import { hashSessionToken, verifyAccessToken } from '../../../src/modules/auth/auth.tokens';
import type { Session, SessionRepository } from '../../../src/modules/auth/session.repository';
import type { UserRepository } from '../../../src/modules/user/user.repository';
import { EmailTakenError, type User } from '../../../src/modules/user/user.types';

/** Cheap work factor: these tests verify logic, not hash strength. */
const TEST_BCRYPT_COST = 4;

let passwordHash: string;

beforeAll(async () => {
  passwordHash = await bcrypt.hash('correct-password', TEST_BCRYPT_COST);
});

function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 42n,
    email: 'ada@example.com',
    displayName: 'Ada',
    passwordHash,
    emailVerifiedAt: null,
    createdAt: new Date('2026-07-01T00:00:00Z'),
    updatedAt: new Date('2026-07-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: 1n,
    userId: 42n,
    tokenHash: 'a'.repeat(64),
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
    lastUsedAt: new Date(),
    revokedAt: null,
    ...overrides,
  };
}

function makeUsers() {
  return {
    create: vi.fn(),
    findByEmail: vi.fn(),
    findById: vi.fn(),
    update: vi.fn(),
    softDelete: vi.fn(),
  } satisfies UserRepository;
}

function makeSessions() {
  return {
    create: vi.fn().mockImplementation(async (input) => makeSession(input)),
    findByTokenHash: vi.fn(),
    revokeById: vi.fn().mockResolvedValue(undefined),
    revokeAllForUser: vi.fn().mockResolvedValue(undefined),
  } satisfies SessionRepository;
}

describe('DefaultAuthService', () => {
  let users: ReturnType<typeof makeUsers>;
  let sessions: ReturnType<typeof makeSessions>;
  let service: DefaultAuthService;

  beforeEach(() => {
    users = makeUsers();
    sessions = makeSessions();
    service = new DefaultAuthService(users, sessions, { bcryptCost: TEST_BCRYPT_COST });
  });

  describe('register', () => {
    it('stores a bcrypt hash (never the password) and opens a session', async () => {
      users.create.mockImplementation(async (input) => makeUser(input));

      const result = await service.register({
        email: 'ada@example.com',
        displayName: 'Ada',
        password: 'hunter2hunter2',
      });

      const stored = users.create.mock.calls[0][0];
      expect(stored.passwordHash).not.toContain('hunter2');
      await expect(bcrypt.compare('hunter2hunter2', stored.passwordHash)).resolves.toBe(true);
      expect(sessions.create).toHaveBeenCalledTimes(1);
      await expect(verifyAccessToken(result.tokens.accessToken)).resolves.toBe(42n);
      expect(result.tokens.refreshToken.length).toBeGreaterThanOrEqual(40);
    });

    it('propagates EmailTakenError from the repository', async () => {
      users.create.mockRejectedValue(new EmailTakenError('ada@example.com'));

      await expect(
        service.register({ email: 'ada@example.com', displayName: 'Ada', password: 'longenough' }),
      ).rejects.toThrow(EmailTakenError);
      expect(sessions.create).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('returns the user and fresh tokens for correct credentials', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      const result = await service.login({
        email: 'ada@example.com',
        password: 'correct-password',
      });

      expect(result.user.id).toBe(42n);
      await expect(verifyAccessToken(result.tokens.accessToken)).resolves.toBe(42n);
    });

    it('rejects a wrong password with InvalidCredentialsError', async () => {
      users.findByEmail.mockResolvedValue(makeUser());

      await expect(
        service.login({ email: 'ada@example.com', password: 'wrong-password' }),
      ).rejects.toThrow(InvalidCredentialsError);
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rejects an unknown email with the SAME error (no account enumeration)', async () => {
      users.findByEmail.mockResolvedValue(null);

      await expect(
        service.login({ email: 'ghost@example.com', password: 'whatever' }),
      ).rejects.toThrow(InvalidCredentialsError);
    });
  });

  describe('refresh (session rotation)', () => {
    it('retires the presented session and issues a fresh pair', async () => {
      const live = makeSession({ id: 9n, tokenHash: hashSessionToken('old-token') });
      sessions.findByTokenHash.mockResolvedValue(live);

      const tokens = await service.refresh('old-token');

      expect(sessions.findByTokenHash).toHaveBeenCalledWith(hashSessionToken('old-token'));
      expect(sessions.revokeById).toHaveBeenCalledWith(9n);
      expect(sessions.create).toHaveBeenCalledTimes(1);
      expect(tokens.refreshToken).not.toBe('old-token');
      await expect(verifyAccessToken(tokens.accessToken)).resolves.toBe(42n);
    });

    it('treats a revoked-token replay as theft: revokes every session', async () => {
      sessions.findByTokenHash.mockResolvedValue(
        makeSession({ revokedAt: new Date(), userId: 42n }),
      );

      await expect(service.refresh('stolen-token')).rejects.toThrow(UnauthorizedError);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42n);
      expect(sessions.create).not.toHaveBeenCalled();
    });

    it('rejects expired sessions without the theft response', async () => {
      sessions.findByTokenHash.mockResolvedValue(
        makeSession({ expiresAt: new Date(Date.now() - 1000) }),
      );

      await expect(service.refresh('stale-token')).rejects.toThrow(UnauthorizedError);
      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });

    it('rejects unknown tokens', async () => {
      sessions.findByTokenHash.mockResolvedValue(null);

      await expect(service.refresh('nope')).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('logout', () => {
    it('revokes the presented session', async () => {
      sessions.findByTokenHash.mockResolvedValue(makeSession({ id: 5n }));

      await service.logout('some-token');

      expect(sessions.revokeById).toHaveBeenCalledWith(5n);
    });

    it('is silent for unknown tokens (idempotent, reveals nothing)', async () => {
      sessions.findByTokenHash.mockResolvedValue(null);

      await expect(service.logout('nope')).resolves.toBeUndefined();
      expect(sessions.revokeById).not.toHaveBeenCalled();
    });
  });

  describe('getUser', () => {
    it('resolves the token subject to the user', async () => {
      users.findById.mockResolvedValue(makeUser());

      await expect(service.getUser(42n)).resolves.toMatchObject({ email: 'ada@example.com' });
    });

    it('rejects tokens for vanished users', async () => {
      users.findById.mockResolvedValue(null);

      await expect(service.getUser(42n)).rejects.toThrow(UnauthorizedError);
    });
  });

  describe('updateDisplayName', () => {
    it('delegates the update to the repository and returns the updated user', async () => {
      users.update.mockResolvedValue(makeUser({ displayName: 'Ada Lovelace' }));

      const result = await service.updateDisplayName(42n, 'Ada Lovelace');

      expect(users.update).toHaveBeenCalledWith(42n, { displayName: 'Ada Lovelace' });
      expect(result.displayName).toBe('Ada Lovelace');
    });
  });

  describe('changePassword', () => {
    it('hashes and stores the new password when currentPassword is correct', async () => {
      users.findById.mockResolvedValue(makeUser());
      users.update.mockResolvedValue(makeUser());

      await service.changePassword(42n, {
        currentPassword: 'correct-password',
        newPassword: 'a-brand-new-password',
      });

      expect(users.update).toHaveBeenCalledTimes(1);
      const [id, patch] = users.update.mock.calls[0];
      expect(id).toBe(42n);
      expect(patch.passwordHash).not.toContain('a-brand-new-password');
      await expect(bcrypt.compare('a-brand-new-password', patch.passwordHash)).resolves.toBe(
        true,
      );
    });

    it('rejects a wrong currentPassword with InvalidCredentialsError, same as login', async () => {
      users.findById.mockResolvedValue(makeUser());

      await expect(
        service.changePassword(42n, {
          currentPassword: 'totally-wrong',
          newPassword: 'a-brand-new-password',
        }),
      ).rejects.toThrow(InvalidCredentialsError);
      expect(users.update).not.toHaveBeenCalled();
    });

    it('does not revoke other sessions — that is the separate, explicit logoutAll', async () => {
      users.findById.mockResolvedValue(makeUser());
      users.update.mockResolvedValue(makeUser());

      await service.changePassword(42n, {
        currentPassword: 'correct-password',
        newPassword: 'a-brand-new-password',
      });

      expect(sessions.revokeAllForUser).not.toHaveBeenCalled();
    });
  });

  describe('logoutAll', () => {
    it('revokes every session for the user', async () => {
      await service.logoutAll(42n);

      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42n);
    });
  });

  describe('deleteAccount', () => {
    it('soft-deletes the user and revokes every session', async () => {
      await service.deleteAccount(42n);

      expect(users.softDelete).toHaveBeenCalledWith(42n);
      expect(sessions.revokeAllForUser).toHaveBeenCalledWith(42n);
    });
  });
});
