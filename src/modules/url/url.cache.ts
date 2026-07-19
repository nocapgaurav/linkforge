import { redisClient } from '../../config/redis.js';

/**
 * Redirect cache port and implementations (docs/redis-cache-design.md).
 *
 * The cache stores the redirect *view* of a link — never the full row and
 * never a decision: business rules (isActive, expiresAt) are re-evaluated
 * by the service on every hit, and clickCount is deliberately excluded so
 * future click counting never invalidates cache entries.
 *
 * Milestone 1: infrastructure only. The service does not consult the cache
 * yet; that wiring is the next milestone.
 */

/** The subset of a Url that the redirect decision needs. */
export interface CachedRedirect {
  /** Internal link id, carried so cache hits can attribute click events. */
  id: bigint;
  originalUrl: string;
  isActive: boolean;
  expiresAt: Date | null;
}

/**
 * 'negative' = we know this code does not resolve (cached 404);
 * null = the cache has no answer (miss or cache failure).
 */
export type CacheLookup = CachedRedirect | 'negative' | null;

/**
 * Port the service depends on. Implementations MUST be fail-open: no
 * method may ever throw — a broken cache degrades to v1 behavior, never
 * to a broken redirect.
 */
export interface RedirectCache {
  get(shortCode: string): Promise<CacheLookup>;
  set(shortCode: string, value: CachedRedirect): Promise<void>;
  setNegative(shortCode: string): Promise<void>;
  del(shortCode: string): Promise<void>;
}

/**
 * No-op implementation: every lookup is a miss, every write is ignored.
 * Used when REDIS_URL is not configured — this IS the degraded mode, and
 * it preserves v1 behavior exactly.
 */
export class NullRedirectCache implements RedirectCache {
  async get(): Promise<CacheLookup> {
    return null;
  }
  async set(): Promise<void> {}
  async setNegative(): Promise<void> {}
  async del(): Promise<void> {}
}

/**
 * Structural view of the Redis commands the cache needs. Lets the
 * implementation and its tests avoid importing ioredis (config/redis.ts
 * stays the only ioredis importer); the real client satisfies this shape.
 */
export interface RedisCommands {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: 'EX', seconds: number): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

// v2: payload gained `i` (link id) when analytics landed — bumping the key
// version instead of migrating entries; v1 keys simply age out via TTL.
const KEY_PREFIX = 'cache:url:v2:';
const POSITIVE_TTL_SECONDS = 3600;
const TTL_JITTER_RATIO = 0.1;
const NEGATIVE_TTL_SECONDS = 60;
const NEGATIVE_SENTINEL = '0';

/** Compact wire format: {i: id, u: originalUrl, a: isActive 0|1, e: epochMs|null}. */
interface WireEntry {
  i: string;
  u: string;
  a: 0 | 1;
  e: number | null;
}

function cacheKey(shortCode: string): string {
  return `${KEY_PREFIX}${shortCode}`;
}

/** ±10% jitter so a mass-populated key cohort never expires in unison. */
function jitteredPositiveTtl(): number {
  const jitter = 1 + (Math.random() * 2 - 1) * TTL_JITTER_RATIO;
  return Math.round(POSITIVE_TTL_SECONDS * jitter);
}

/**
 * Redis-backed implementation. Every command is wrapped: on any Redis
 * failure reads report a miss and writes become no-ops, with error logging
 * on state transitions only (a down Redis must not log per request).
 */
export class RedisRedirectCache implements RedirectCache {
  private failing = false;

  constructor(private readonly redis: RedisCommands) {}

  async get(shortCode: string): Promise<CacheLookup> {
    const raw = await this.safely('get', () => this.redis.get(cacheKey(shortCode)));
    if (raw === undefined || raw === null) return null;
    if (raw === NEGATIVE_SENTINEL) return 'negative';
    try {
      const entry = JSON.parse(raw) as WireEntry;
      if (typeof entry.i !== 'string' || typeof entry.u !== 'string') {
        return null;
      }
      return {
        id: BigInt(entry.i),
        originalUrl: entry.u,
        isActive: entry.a === 1,
        expiresAt: entry.e === null ? null : new Date(entry.e),
      };
    } catch {
      // Corrupt/foreign payload: treat as a miss; the next set overwrites it.
      return null;
    }
  }

  async set(shortCode: string, value: CachedRedirect): Promise<void> {
    const entry: WireEntry = {
      i: value.id.toString(),
      u: value.originalUrl,
      a: value.isActive ? 1 : 0,
      e: value.expiresAt === null ? null : value.expiresAt.getTime(),
    };
    await this.safely('set', () =>
      this.redis.set(cacheKey(shortCode), JSON.stringify(entry), 'EX', jitteredPositiveTtl()),
    );
  }

  async setNegative(shortCode: string): Promise<void> {
    await this.safely('setNegative', () =>
      this.redis.set(cacheKey(shortCode), NEGATIVE_SENTINEL, 'EX', NEGATIVE_TTL_SECONDS),
    );
  }

  async del(shortCode: string): Promise<void> {
    await this.safely('del', () => this.redis.del(cacheKey(shortCode)));
  }

  /** Fail-open guard: errors are logged (on state change) and swallowed. */
  private async safely<T>(op: string, command: () => Promise<T>): Promise<T | undefined> {
    try {
      const result = await command();
      if (this.failing) {
        this.failing = false;
        console.log(JSON.stringify({ level: 'info', event: 'redirect_cache_recovered' }));
      }
      return result;
    } catch (error) {
      if (!this.failing) {
        this.failing = true;
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'redirect_cache_error',
            op,
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      return undefined;
    }
  }
}

/**
 * Composition: Redis-backed when REDIS_URL is configured, no-op otherwise.
 * Consumed by the service in the next milestone.
 */
export const redirectCache: RedirectCache = redisClient
  ? new RedisRedirectCache(redisClient)
  : new NullRedirectCache();
