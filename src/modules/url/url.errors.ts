/**
 * Domain errors for the URL module.
 *
 * Framework-free by design: no Express, no HTTP status codes. Controllers
 * map these to HTTP responses (UrlNotFoundError → 404 NOT_FOUND,
 * AliasAlreadyExistsError → 409 ALIAS_TAKEN, ShortCodeGenerationError →
 * 500 INTERNAL_ERROR) per docs/api-v1-spec.md.
 */

/** Base class so callers can catch all URL domain errors in one branch. */
export abstract class UrlDomainError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

/**
 * The short code does not resolve to a visible URL. Deliberately used for
 * every hidden state (missing, soft-deleted, and — on the redirect path —
 * inactive or expired) so callers cannot distinguish them (spec §3).
 */
export class UrlNotFoundError extends UrlDomainError {
  readonly shortCode: string;

  constructor(shortCode: string) {
    super(`No URL found for short code: ${shortCode}`);
    this.shortCode = shortCode;
  }
}

/** The requested custom alias is already in use (including tombstoned codes). */
export class AliasAlreadyExistsError extends UrlDomainError {
  readonly alias: string;

  constructor(alias: string) {
    super(`Alias already in use: ${alias}`);
    this.alias = alias;
  }
}

/**
 * Random code generation kept colliding past the retry budget. Statistically
 * near-impossible at 62^7 unless the code space is saturated or generation
 * is broken — treated as a server fault, not a client error.
 */
export class ShortCodeGenerationError extends UrlDomainError {
  readonly attempts: number;

  constructor(attempts: number) {
    super(`Failed to generate a unique short code after ${attempts} attempts`);
    this.attempts = attempts;
  }
}
