import type { CreateUrlBody } from './validation/url.schema.js';
import type { Url } from './url.types.js';

/**
 * Business-logic contract for URL management. HTTP-agnostic: methods accept
 * already-validated input and return domain objects; failures are thrown as
 * domain errors from url.errors.ts.
 */
export interface UrlService {
  /**
   * Create a short link. Normalizes the original URL, computes its SHA-256
   * hash, and persists with either the caller's custom alias or a freshly
   * generated base62 code (retrying on the rare collision).
   * Throws AliasAlreadyExistsError if the requested alias is taken,
   * ShortCodeGenerationError if generation exhausts its retry budget.
   */
  create(input: CreateUrlBody): Promise<Url>;

  /**
   * Resolve a short code for redirecting — the strict visibility rules.
   * Returns the URL only when it exists, is not soft-deleted, is active,
   * and is not expired; otherwise throws UrlNotFoundError. Never reveals
   * WHY a code is dead.
   */
  getByShortCode(shortCode: string): Promise<Url>;

  /**
   * Management-plane read. Inactive and expired URLs ARE returned (owners
   * see the truth); only missing/soft-deleted codes throw UrlNotFoundError.
   */
  getMetadata(shortCode: string): Promise<Url>;

  /**
   * Soft-delete a URL and return the tombstone timestamp. The short code is
   * retired permanently. Throws UrlNotFoundError if no live URL has the code.
   */
  delete(shortCode: string): Promise<Date>;
}
