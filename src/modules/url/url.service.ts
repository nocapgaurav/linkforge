import { createHash, randomInt } from 'node:crypto';
import { urlRepository } from './url.repository.js';
import type { UrlRepository } from './url.repository.interface.js';
import type { UrlService } from './url.service.interface.js';
import {
  AliasAlreadyExistsError,
  ShortCodeGenerationError,
  UrlNotFoundError,
} from './url.errors.js';
import { ShortCodeConflictError, type Url } from './url.types.js';
import type { CreateUrlBody } from './validation/url.schema.js';

const BASE62_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

/** 62^7 ≈ 3.5 trillion codes — collisions stay negligible for years. */
const GENERATED_CODE_LENGTH = 7;

/**
 * With a healthy code space one retry virtually always suffices; hitting
 * this budget means something is systemically wrong, not bad luck.
 */
const MAX_GENERATION_ATTEMPTS = 5;

/**
 * Canonicalize a URL so equivalent spellings hash identically (lowercased
 * scheme/host, normalized percent-encoding, explicit path). Validation has
 * already guaranteed this parses as an absolute http(s) URL.
 */
function normalizeOriginalUrl(originalUrl: string): string {
  return new URL(originalUrl).toString();
}

/** SHA-256 hex digest (64 chars, matching the urls.url_hash column). */
function computeUrlHash(normalizedUrl: string): string {
  return createHash('sha256').update(normalizedUrl).digest('hex');
}

/**
 * Business logic for URL management. Persistence goes through the injected
 * UrlRepository interface — this class never touches Prisma or HTTP.
 */
export class DefaultUrlService implements UrlService {
  constructor(private readonly urls: UrlRepository) {}

  async create(input: CreateUrlBody): Promise<Url> {
    const originalUrl = normalizeOriginalUrl(input.originalUrl);
    const urlHash = computeUrlHash(originalUrl);
    const expiresAt = input.expiresAt ?? null;

    if (input.customAlias) {
      // Uniqueness is enforced by the database's unique index, which also
      // covers tombstoned codes that finds cannot see. Attempting the insert
      // and translating the conflict is the only race-free check.
      try {
        return await this.urls.create({
          shortCode: input.customAlias,
          isCustomAlias: true,
          originalUrl,
          urlHash,
          expiresAt,
        });
      } catch (error) {
        if (error instanceof ShortCodeConflictError) {
          throw new AliasAlreadyExistsError(input.customAlias);
        }
        throw error;
      }
    }

    for (let attempt = 1; attempt <= MAX_GENERATION_ATTEMPTS; attempt++) {
      const shortCode = this.generateShortCode();
      try {
        return await this.urls.create({
          shortCode,
          isCustomAlias: false,
          originalUrl,
          urlHash,
          expiresAt,
        });
      } catch (error) {
        if (error instanceof ShortCodeConflictError) {
          continue;
        }
        throw error;
      }
    }
    throw new ShortCodeGenerationError(MAX_GENERATION_ATTEMPTS);
  }

  async getByShortCode(shortCode: string): Promise<Url> {
    const url = await this.urls.findByShortCode(shortCode);
    if (!url || !this.isRedirectable(url)) {
      // One error for every dead state — the redirect plane never explains
      // whether a code is missing, deleted, disabled, or expired (spec §3).
      throw new UrlNotFoundError(shortCode);
    }
    return url;
  }

  async getMetadata(shortCode: string): Promise<Url> {
    const url = await this.urls.findByShortCode(shortCode);
    if (!url) {
      throw new UrlNotFoundError(shortCode);
    }
    return url;
  }

  async delete(shortCode: string): Promise<Date> {
    const url = await this.urls.findByShortCode(shortCode);
    if (!url) {
      throw new UrlNotFoundError(shortCode);
    }
    const deletedAt = await this.urls.softDelete(url.id);
    if (!deletedAt) {
      // The row was tombstoned between the find and the delete.
      throw new UrlNotFoundError(shortCode);
    }
    return deletedAt;
  }

  /** Redirect rule: active and (never expires or not yet expired). */
  private isRedirectable(url: Url): boolean {
    return url.isActive && (url.expiresAt === null || url.expiresAt.getTime() > Date.now());
  }

  /** Uniform random base62 code from a CSPRNG (crypto.randomInt). */
  private generateShortCode(): string {
    let code = '';
    for (let i = 0; i < GENERATED_CODE_LENGTH; i++) {
      code += BASE62_ALPHABET[randomInt(BASE62_ALPHABET.length)];
    }
    return code;
  }
}

/** Application-wide service instance wired to the Prisma-backed repository. */
export const urlService: UrlService = new DefaultUrlService(urlRepository);
