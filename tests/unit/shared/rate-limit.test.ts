import type { NextFunction, Request, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRateLimiter,
  type RateLimitCommands,
} from '../../../src/shared/http/rate-limit';

/** In-memory fake honoring the same fixed-window semantics as Redis. */
function makeFakeRedis(): RateLimitCommands & { store: Map<string, number> } {
  const store = new Map<string, number>();
  return {
    store,
    async incr(key) {
      const next = (store.get(key) ?? 0) + 1;
      store.set(key, next);
      return next;
    },
    async expire() {
      return 1;
    },
  };
}

function runMiddleware(handler: ReturnType<ReturnType<typeof createRateLimiter>>, ip = '1.2.3.4') {
  return new Promise<{
    status?: number;
    body?: unknown;
    nextCalled: boolean;
    headers: Record<string, string>;
  }>((resolve) => {
    const req = { ip } as Request;
    let status: number | undefined;
    let body: unknown;
    const headers: Record<string, string> = {};
    const res = {
      setHeader(name: string, value: string) {
        headers[name] = value;
        return this;
      },
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        resolve({ status, body, nextCalled: false, headers });
        return this;
      },
    } as unknown as Response;
    const next: NextFunction = () => resolve({ nextCalled: true, headers });
    handler(req, res, next);
  });
}

describe('createRateLimiter', () => {
  const byIp = (req: Request) => req.ip ?? 'unknown';

  it('allows requests up to the limit, within one window', async () => {
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 3, keyPrefix: 'test', keyFn: byIp });

    for (let i = 0; i < 3; i++) {
      const result = await runMiddleware(handler);
      expect(result.nextCalled).toBe(true);
    }
  });

  it('blocks the (max+1)th request with 429 RATE_LIMITED, and never calls next()', async () => {
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 2, keyPrefix: 'test', keyFn: byIp });

    await runMiddleware(handler);
    await runMiddleware(handler);
    const blocked = await runMiddleware(handler);

    expect(blocked.nextCalled).toBe(false);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      success: false,
      error: { code: 'RATE_LIMITED', message: 'Too many requests. Please try again later.' },
    });
  });

  it('keys independently per keyFn result (e.g. per IP)', async () => {
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    const first = await runMiddleware(handler, '1.1.1.1');
    const second = await runMiddleware(handler, '1.1.1.1');
    const differentIp = await runMiddleware(handler, '2.2.2.2');

    expect(first.nextCalled).toBe(true);
    expect(second.nextCalled).toBe(false);
    expect(differentIp.nextCalled).toBe(true);
  });

  it('keys independently per keyPrefix (independent limits per endpoint)', async () => {
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const loginLimit = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'login', keyFn: byIp });
    const registerLimit = rateLimit({
      windowSeconds: 60,
      max: 1,
      keyPrefix: 'register',
      keyFn: byIp,
    });

    await runMiddleware(loginLimit);
    const loginBlocked = await runMiddleware(loginLimit);
    const registerStillAllowed = await runMiddleware(registerLimit);

    expect(loginBlocked.nextCalled).toBe(false);
    expect(registerStillAllowed.nextCalled).toBe(true);
  });

  it('fails open when Redis rejects a command', async () => {
    const redis: RateLimitCommands = {
      incr: vi.fn().mockRejectedValue(new Error('connection refused')),
      expire: vi.fn(),
    };
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    const result = await runMiddleware(handler);

    expect(result.nextCalled).toBe(true);
  });

  it('fails open (always allows) when Redis is not configured (null)', async () => {
    const rateLimit = createRateLimiter(null);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    const first = await runMiddleware(handler);
    const second = await runMiddleware(handler);

    expect(first.nextCalled).toBe(true);
    expect(second.nextCalled).toBe(true);
  });
});

describe('createRateLimiter — RateLimit-* response headers (spec §1.4/§12)', () => {
  const byIp = (req: Request) => req.ip ?? 'unknown';

  it('sets Limit/Remaining on an allowed request', async () => {
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 3, keyPrefix: 'test', keyFn: byIp });

    const first = await runMiddleware(handler);
    expect(first.headers['RateLimit-Limit']).toBe('3');
    expect(first.headers['RateLimit-Remaining']).toBe('2'); // 1 request used

    const second = await runMiddleware(handler);
    expect(second.headers['RateLimit-Remaining']).toBe('1');
  });

  it('sets Remaining to 0 (never negative) on the request that trips 429', async () => {
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    await runMiddleware(handler);
    const blocked = await runMiddleware(handler);

    expect(blocked.nextCalled).toBe(false);
    expect(blocked.headers['RateLimit-Remaining']).toBe('0');
    expect(blocked.headers['RateLimit-Limit']).toBe('1');
  });

  it('omits every RateLimit-* header when Redis is not configured (no limiting is actually enforced)', async () => {
    const rateLimit = createRateLimiter(null);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    const result = await runMiddleware(handler);

    expect(result.headers).toEqual({});
  });

  it('omits every RateLimit-* header when Redis errors mid-request', async () => {
    const redis: RateLimitCommands = {
      incr: vi.fn().mockRejectedValue(new Error('connection refused')),
      expire: vi.fn(),
    };
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    const result = await runMiddleware(handler);

    expect(result.headers).toEqual({});
  });

  it('sets Reset to the exact number of seconds remaining in the current window', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-07-20T00:00:15.000Z')); // 15s into a 60s window
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: byIp });

    const result = await runMiddleware(handler);

    expect(result.headers['RateLimit-Reset']).toBe('45');
    vi.useRealTimers();
  });
});

describe('createRateLimiter — window rollover', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('resets the count in a new time window', async () => {
    vi.setSystemTime(new Date('2026-07-20T00:00:00.000Z'));
    const redis = makeFakeRedis();
    const rateLimit = createRateLimiter(redis);
    const handler = rateLimit({ windowSeconds: 60, max: 1, keyPrefix: 'test', keyFn: () => 'x' });

    const first = await runMiddleware(handler);
    const blocked = await runMiddleware(handler);

    vi.setSystemTime(new Date('2026-07-20T00:01:01.000Z')); // next window
    const afterRollover = await runMiddleware(handler);

    expect(first.nextCalled).toBe(true);
    expect(blocked.nextCalled).toBe(false);
    expect(afterRollover.nextCalled).toBe(true);

    vi.useRealTimers();
  });
});
