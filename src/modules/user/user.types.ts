/**
 * Domain types for the user module.
 *
 * The User entity lives here — NOT in the auth module — because future
 * features (API keys, teams, billing, organizations) all hang off users
 * while having nothing to do with password login. Auth is just the first
 * consumer.
 */

/** A user as stored. passwordHash never crosses the controller boundary. */
export interface User {
  id: bigint;
  /** Lowercased at validation time; the unique login key. */
  email: string;
  displayName: string;
  passwordHash: string;
  /** Null until an email-verification flow ships. */
  emailVerifiedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  /** Soft-delete tombstone, mirroring Url's pattern; non-null means deleted. */
  deletedAt: Date | null;
}

/** Fields required to persist a new user (hashing happens upstream). */
export interface CreateUserInput {
  email: string;
  displayName: string;
  passwordHash: string;
}

/** Mutable fields of an existing user — hashing (if any) happens upstream. */
export interface UpdateUserInput {
  displayName?: string;
  passwordHash?: string;
}

/**
 * Thrown by create() when the email is already registered. Translates the
 * database's unique-constraint violation, mirroring ShortCodeConflictError.
 */
export class EmailTakenError extends Error {
  readonly email: string;

  constructor(email: string) {
    super('An account with this email already exists.');
    this.name = 'EmailTakenError';
    this.email = email;
  }
}
