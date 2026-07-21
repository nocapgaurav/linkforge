import type { Request, RequestHandler } from 'express';
import { fail } from './response.js';

/**
 * Redis-backed, fail-open rate limiting.
 *
 * Fixed-window counter (INCR + EXPIRE-on-first-write): simple, one round
 * trip, well-understood bursty-at-the-boundary behavior that is entirely
 * acceptable for abuse protection (this is not a billing meter). A
 * sliding-window or token-bucket algorithm would be more precise and is
 * deliberately not built — it isn't needed to solve the actual problem
 * (bound abuse), and the project consistently prefers the boring option
 * (see docs/redis-cache-design.md's cache-stampede reasoning).
 *
 * Structural `RateLimitCommands`, not a direct ioredis import — the same
 * pattern as url.cache.ts's `RedisCommands`, so config/redis.ts stays the
 * only ioredis importer and tests never need a real Redis. `null` (no
 * Redis configured) is a valid input: the returned middleware then always
 * allows, exactly like NullRedirectCache — fail-open is the resting state,
 * not just the error path.
 */
export interface RateLimitCommands {
  incr(key: string): Promise<number>;
  expire(key: string, seconds: number): Promise<unknown>;
}

export interface RateLimitOptions {
  /** Window length; the counter resets `windowSeconds` after its first hit. */
  windowSeconds: number;
  /** Requests allowed per key per window. */
  max: number;
  /** Namespaces the Redis key so independent limits never collide. */
  keyPrefix: string;
  /** Identifies the subject being limited (e.g. IP, or an authenticated user id). */
  keyFn: (req: Request) => string;
}

/**
 * Build the rate-limit middleware factory. `redis` is `null` when
 * REDIS_URL is unconfigured — every limiter then becomes a pass-through,
 * matching the rest of the app's Redis-optional posture.
 */
export function createRateLimiter(redis: RateLimitCommands | null) {
  return function rateLimit(options: RateLimitOptions): RequestHandler {
    const { windowSeconds, max, keyPrefix, keyFn } = options;

    return (req, res, next) => {
      if (!redis) {
        next();
        return;
      }

      const now = Date.now();
      const window = Math.floor(now / (windowSeconds * 1000));
      const key = `ratelimit:${keyPrefix}:${keyFn(req)}:${window}`;
      // Seconds until this window rolls over, for the RateLimit-Reset header.
      const resetSeconds = Math.ceil(((window + 1) * windowSeconds * 1000 - now) / 1000);

      redis
        .incr(key)
        .then(async (count) => {
          if (count === 1) {
            // First hit in this window: arm the expiry. A crash between
            // INCR and EXPIRE leaves a key that never expires — self-heals
            // on the next window's different key, so it's a leaked-but-
            // harmless counter, not a stuck limiter.
            await redis.expire(key, windowSeconds);
          }
          // Spec §1.4: sent whenever Redis is actually enforcing the limit,
          // on the 429 itself as well as successful requests — omitted
          // entirely in the !redis branch above, since fail-open means no
          // limit is actually being enforced there.
          res.setHeader('RateLimit-Limit', String(max));
          res.setHeader('RateLimit-Remaining', String(Math.max(0, max - count)));
          res.setHeader('RateLimit-Reset', String(resetSeconds));
          if (count > max) {
            fail(res, 429, 'RATE_LIMITED', 'Too many requests. Please try again later.');
            return;
          }
          next();
        })
        .catch(() => {
          // Fail-open: a broken Redis must never block real traffic.
          next();
        });
    };
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
