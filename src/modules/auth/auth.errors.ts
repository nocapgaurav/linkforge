/**
 * Domain errors for authentication. Framework-free; the global error
 * handler maps them (InvalidCredentialsError → 401 INVALID_CREDENTIALS,
 * UnauthorizedError → 401 UNAUTHORIZED).
 */

export abstract class AuthDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * Login failed. One error for both unknown-email and wrong-password so
 * responses never reveal which half was wrong.
 */
export class InvalidCredentialsError extends AuthDomainError {
  constructor() {
    super('Invalid email or password.');
  }
}

/**
 * The request is not (or no longer) authenticated: missing/malformed/
 * expired access token, or an invalid/expired/revoked session token.
 */
export class UnauthorizedError extends AuthDomainError {
  constructor(message = 'Authentication required.') {
    super(message);
  }
}
