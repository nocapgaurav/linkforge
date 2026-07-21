import bcrypt from 'bcrypt';
import type { UserRepository } from '../user/user.repository.js';
import type { User } from '../user/user.types.js';
import { InvalidCredentialsError, UnauthorizedError } from './auth.errors.js';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  generateSessionToken,
  hashSessionToken,
  sessionExpiry,
  signAccessToken,
} from './auth.tokens.js';
import type { SessionRepository } from './session.repository.js';
import type { ChangePasswordBody, LoginBody, RegisterBody } from './auth.validation.js';

/** What a successful register/login/refresh hands back. */
export interface AuthTokens {
  accessToken: string;
  /** The opaque session token (transported as "refreshToken" on the wire). */
  refreshToken: string;
  /** Access-token lifetime in seconds, for client scheduling. */
  expiresIn: number;
}

export interface AuthResult {
  user: User;
  tokens: AuthTokens;
}

/**
 * Business-logic contract for authentication. HTTP-agnostic; failures are
 * thrown as domain errors (auth.errors.ts, user.types.ts).
 */
export interface AuthService {
  /** Create an account and open its first session. Throws EmailTakenError. */
  register(input: RegisterBody): Promise<AuthResult>;

  /**
   * Verify credentials and open a session. Throws InvalidCredentialsError —
   * one error for unknown email AND wrong password, with hashing work done
   * in both paths so the two are timing-indistinguishable.
   */
  login(input: LoginBody): Promise<AuthResult>;

  /**
   * Rotate a session: the presented token is retired and a fresh pair is
   * issued. Presenting an already-revoked token is treated as theft — every
   * session of that user is revoked. Throws UnauthorizedError.
   */
  refresh(refreshToken: string): Promise<AuthTokens>;

  /**
   * Revoke the presented session. Deliberately silent for unknown tokens:
   * logout must be idempotent and reveal nothing.
   */
  logout(refreshToken: string): Promise<void>;

  /** Resolve an authenticated user id (from the access token) to the user. */
  getUser(userId: bigint): Promise<User>;

  /** Update the caller's display name. The only editable profile field. */
  updateDisplayName(userId: bigint, displayName: string): Promise<User>;

  /**
   * Change the caller's password. Verifies currentPassword first — a wrong
   * one throws InvalidCredentialsError, same code/shape as a failed login,
   * so this endpoint reveals nothing a login attempt wouldn't. Does not
   * revoke other sessions (that's the separate, explicit logoutAll).
   */
  changePassword(userId: bigint, input: ChangePasswordBody): Promise<void>;

  /** Revoke every session of the caller's — "log out of all devices." */
  logoutAll(userId: bigint): Promise<void>;

  /**
   * Soft-delete the caller's account and revoke every session. Mirrors
   * Url's tombstone pattern: the row is retained (Url.creator is
   * onDelete: Restrict), only login and authenticated reads treat it as
   * gone from then on. A still-valid access token issued before deletion
   * can keep working for its remaining ≤15-minute lifetime — the same
   * accepted trade-off stateless access tokens already have everywhere
   * else (e.g. session revocation doesn't retroactively invalidate one).
   */
  deleteAccount(userId: bigint): Promise<void>;
}

/**
 * Fixed-cost hash compared against when the email is unknown, so login
 * latency does not reveal whether an account exists.
 */
const TIMING_EQUALIZATION_HASH =
  '$2b$12$5vwJXE9Umgi5Fm2gITC8.O4Bwac4ePOjAc9gC2vJI6vLlICcbpVeS';

export class DefaultAuthService implements AuthService {
  private readonly bcryptCost: number;

  constructor(
    private readonly users: UserRepository,
    private readonly sessions: SessionRepository,
    options: { bcryptCost: number },
  ) {
    this.bcryptCost = options.bcryptCost;
  }

  async register(input: RegisterBody): Promise<AuthResult> {
    const passwordHash = await bcrypt.hash(input.password, this.bcryptCost);
    // Uniqueness is enforced by the database's unique index; the repository
    // translates the conflict (same race-free pattern as short codes).
    const user = await this.users.create({
      email: input.email,
      displayName: input.displayName,
      passwordHash,
    });
    return { user, tokens: await this.openSession(user.id) };
  }

  async login(input: LoginBody): Promise<AuthResult> {
    const user = await this.users.findByEmail(input.email);
    if (!user) {
      await bcrypt.compare(input.password, TIMING_EQUALIZATION_HASH);
      throw new InvalidCredentialsError();
    }
    const matches = await bcrypt.compare(input.password, user.passwordHash);
    if (!matches) {
      throw new InvalidCredentialsError();
    }
    return { user, tokens: await this.openSession(user.id) };
  }

  async refresh(refreshToken: string): Promise<AuthTokens> {
    const session = await this.sessions.findByTokenHash(hashSessionToken(refreshToken));
    if (!session) {
      throw new UnauthorizedError('Invalid session.');
    }
    if (session.revokedAt !== null) {
      // A retired token came back: either a very stale client or a stolen
      // token being replayed. Fail closed — kill every session.
      await this.sessions.revokeAllForUser(session.userId);
      throw new UnauthorizedError('Session is no longer valid.');
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedError('Session expired.');
    }
    await this.sessions.revokeById(session.id);
    return this.openSession(session.userId);
  }

  async logout(refreshToken: string): Promise<void> {
    const session = await this.sessions.findByTokenHash(hashSessionToken(refreshToken));
    if (session && session.revokedAt === null) {
      await this.sessions.revokeById(session.id);
    }
  }

  async getUser(userId: bigint): Promise<User> {
    const user = await this.users.findById(userId);
    if (!user) {
      // Valid token for a vanished user (deleted account, stale token).
      throw new UnauthorizedError('Account no longer exists.');
    }
    return user;
  }

  async updateDisplayName(userId: bigint, displayName: string): Promise<User> {
    return this.users.update(userId, { displayName });
  }

  async changePassword(userId: bigint, input: ChangePasswordBody): Promise<void> {
    const user = await this.getUser(userId);
    const matches = await bcrypt.compare(input.currentPassword, user.passwordHash);
    if (!matches) {
      throw new InvalidCredentialsError();
    }
    const passwordHash = await bcrypt.hash(input.newPassword, this.bcryptCost);
    await this.users.update(userId, { passwordHash });
  }

  async logoutAll(userId: bigint): Promise<void> {
    await this.sessions.revokeAllForUser(userId);
  }

  async deleteAccount(userId: bigint): Promise<void> {
    await this.users.softDelete(userId);
    await this.sessions.revokeAllForUser(userId);
  }

  /** Issue a fresh session row + access token for the user. */
  private async openSession(userId: bigint): Promise<AuthTokens> {
    const { token, tokenHash } = generateSessionToken();
    await this.sessions.create({ userId, tokenHash, expiresAt: sessionExpiry() });
    return {
      accessToken: await signAccessToken(userId),
      refreshToken: token,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    };
  }
}
