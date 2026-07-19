import { createHash, randomInt, randomUUID } from 'node:crypto';
import { clickSink, NullClickSink, type ClickSink } from '../analytics/click.sink.js';
import { urlRepository, type UrlRepository } from './url.repository.js';
import {
  NullRedirectCache,
  redirectCache,
  type CachedRedirect,
  type RedirectCache,
} from './url.cache.js';
import {
  AliasAlreadyExistsError,
  ShortCodeGenerationError,
  UrlNotFoundError,
} from './url.errors.js';
import { ShortCodeConflictError, type Url } from './url.types.js';
import type { CreateUrlBody, ListUrlsQuery } from './url.validation.js';

/** One page of the newest-first link listing. */
export interface UrlListPage {
  items: Url[];
  /** Opaque `<createdAtMs>_<id>` keyset cursor; null on the last page. */
  nextCursor: string | null;
  hasMore: boolean;
}

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
 * Business-logic contract for URL management. HTTP-agnostic: methods accept
 * already-validated input and return domain objects; failures are thrown as
 * domain errors from url.errors.ts.
 */
export interface UrlService {
  /**
   * Create a short link. Normalizes the original URL, computes its SHA-256
   * hash, and persists with either the caller's custom alias or a freshly
   * generated base62 code (retrying on the rare collision). Purges any
   * negative cache entry left by pre-creation lookups of the code.
   * Throws AliasAlreadyExistsError if the requested alias is taken,
   * ShortCodeGenerationError if generation exhausts its retry budget.
   */
  create(input: CreateUrlBody): Promise<Url>;

  /**
   * Resolve a short code for redirecting — the strict visibility rules,
   * served cache-aside (docs/redis-cache-design.md). Returns the redirect
   * view (a full domain Url on cache misses, the cached view on hits) only
   * when the link exists, is not soft-deleted, is active, and is not
   * expired; otherwise throws UrlNotFoundError. Rules are re-evaluated on
   * every cache hit, so expiry and deactivation are never served stale.
   * Never reveals WHY a code is dead.
   */
  getByShortCode(shortCode: string): Promise<CachedRedirect>;

  /**
   * Management-plane read. Inactive and expired URLs ARE returned (owners
   * see the truth); only missing/soft-deleted codes throw UrlNotFoundError.
   * Never cached: metadata must show fresh state (including clickCount).
   */
  getMetadata(shortCode: string): Promise<Url>;

  /**
   * Soft-delete a URL and return the tombstone timestamp. The short code is
   * retired permanently, and its cache entry is invalidated after the
   * database commit. Throws UrlNotFoundError if no live URL has the code.
   */
  delete(shortCode: string): Promise<Date>;

  /**
   * Cursor-paginated listing, newest first. Fetches one row beyond the
   * requested page to learn whether more exist; `nextCursor` encodes the
   * last returned row's (createdAt, id) keyset position.
   */
  list(query: ListUrlsQuery): Promise<UrlListPage>;
}

/**
 * Business logic for URL management. Persistence goes through the injected
 * UrlRepository, redirect caching through the injected RedirectCache —
 * this class never touches Prisma, Redis, or HTTP. The cache defaults to
 * the no-op implementation so the cache is strictly opt-in.
 *
 * Every cache interaction is additionally guarded here: even a cache
 * implementation that violates the never-throws contract cannot break a
 * request (fail-open, defense in depth).
 */
export class DefaultUrlService implements UrlService {
  constructor(
    private readonly urls: UrlRepository,
    private readonly cache: RedirectCache = new NullRedirectCache(),
    private readonly clicks: ClickSink = new NullClickSink(),
  ) {}

  async create(input: CreateUrlBody): Promise<Url> {
    const originalUrl = normalizeOriginalUrl(input.originalUrl);
    const urlHash = computeUrlHash(originalUrl);
    const expiresAt = input.expiresAt ?? null;

    if (input.customAlias) {
      // Uniqueness is enforced by the database's unique index, which also
      // covers tombstoned codes that finds cannot see. Attempting the insert
      // and translating the conflict is the only race-free check.
      try {
        const url = await this.urls.create({
          shortCode: input.customAlias,
          isCustomAlias: true,
          originalUrl,
          urlHash,
          expiresAt,
        });
        return await this.finishCreate(url);
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
        const url = await this.urls.create({
          shortCode,
          isCustomAlias: false,
          originalUrl,
          urlHash,
          expiresAt,
        });
        return await this.finishCreate(url);
      } catch (error) {
        if (error instanceof ShortCodeConflictError) {
          continue;
        }
        throw error;
      }
    }
    throw new ShortCodeGenerationError(MAX_GENERATION_ATTEMPTS);
  }

  async getByShortCode(shortCode: string): Promise<CachedRedirect> {
    const cached = await this.cacheGet(shortCode);

    if (cached === 'negative') {
      // Cached 404: we recently confirmed this code does not resolve.
      throw new UrlNotFoundError(shortCode);
    }
    if (cached !== null) {
      // Positive hit: the cache stores facts, not decisions — business
      // rules are re-evaluated so expiry/deactivation are never stale.
      if (!this.isRedirectable(cached)) {
        throw new UrlNotFoundError(shortCode);
      }
      this.recordClick(cached.id);
      return cached;
    }

    // Miss: Postgres is the source of truth.
    const url = await this.urls.findByShortCode(shortCode);
    if (!url) {
      this.fireAndForget(() => this.cache.setNegative(shortCode));
      throw new UrlNotFoundError(shortCode);
    }
    if (!this.isRedirectable(url)) {
      // Found but dead (inactive/expired): not cached — only live links
      // get positive entries, and a dead-but-present row is not a 404 fact.
      throw new UrlNotFoundError(shortCode);
    }
    this.fireAndForget(() =>
      this.cache.set(shortCode, {
        id: url.id,
        originalUrl: url.originalUrl,
        isActive: url.isActive,
        expiresAt: url.expiresAt,
      }),
    );
    this.recordClick(url.id);
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
    // Invalidate AFTER the commit; awaited so the link is dead in the cache
    // by the time the client sees the deletion response.
    await this.invalidate(shortCode);
    return deletedAt;
  }

  async list(query: ListUrlsQuery): Promise<UrlListPage> {
    // Over-fetch by one: the extra row proves a next page exists without a
    // second COUNT query, and is never returned to the caller.
    const rows = await this.urls.list({ limit: query.limit + 1, before: query.cursor });
    const hasMore = rows.length > query.limit;
    const items = hasMore ? rows.slice(0, query.limit) : rows;
    const last = items.at(-1);
    const nextCursor = hasMore && last ? `${last.createdAt.getTime()}_${last.id}` : null;
    return { items, nextCursor, hasMore };
  }

  /**
   * Emit analytics for one APPROVED redirect — called only after the
   * visibility rules have passed, so dead links never produce events.
   * Both writes are fire-and-forget: the redirect never waits on
   * analytics, and failures are dropped (the sink and the guard both
   * swallow). The eventId minted here is the idempotency key that makes
   * any future replay of this event safe. clickCount is an approximate
   * display counter; click_events is the source of truth.
   */
  private recordClick(urlId: bigint): void {
    const eventId = randomUUID();
    this.fireAndForget(() =>
      this.clicks.record({ eventId, urlId, occurredAt: new Date() }),
    );
    this.fireAndForget(() => this.urls.incrementClickCount(urlId));
  }

  /** Redirect rule: active and (never expires or not yet expired). */
  private isRedirectable(target: CachedRedirect): boolean {
    return (
      target.isActive && (target.expiresAt === null || target.expiresAt.getTime() > Date.now())
    );
  }

  /** Uniform random base62 code from a CSPRNG (crypto.randomInt). */
  private generateShortCode(): string {
    let code = '';
    for (let i = 0; i < GENERATED_CODE_LENGTH; i++) {
      code += BASE62_ALPHABET[randomInt(BASE62_ALPHABET.length)];
    }
    return code;
  }

  /**
   * Post-insert step: purge any negative cache entry left by lookups that
   * 404'd before this code existed. Never populates the cache — the first
   * redirect does that (pure cache-aside).
   */
  private async finishCreate(url: Url): Promise<Url> {
    await this.invalidate(url.shortCode);
    return url;
  }

  /** Cache read with defense in depth: any cache error is a miss. */
  private async cacheGet(shortCode: string): Promise<CachedRedirect | 'negative' | null> {
    try {
      return await this.cache.get(shortCode);
    } catch {
      // Fail-open: a broken cache degrades to a Postgres read.
      return null;
    }
  }

  /** Awaited best-effort invalidation used on the mutation paths. */
  private async invalidate(shortCode: string): Promise<void> {
    try {
      await this.cache.del(shortCode);
    } catch {
      // Fail-open: the TTL is the backstop for a missed invalidation.
    }
  }

  /**
   * Cache population is off the critical path: the response never waits on
   * a cache write, and write failures are swallowed (design §4).
   */
  private fireAndForget(write: () => Promise<void>): void {
    void (async () => {
      try {
        await write();
      } catch {
        // Cache writes are best-effort by contract.
      }
    })();
  }
}

/** Application-wide service: Prisma repository, redirect cache, click sink. */
export const urlService: UrlService = new DefaultUrlService(
  urlRepository,
  redirectCache,
  clickSink,
);
