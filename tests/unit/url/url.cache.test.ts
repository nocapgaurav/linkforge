import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  NullRedirectCache,
  RedisRedirectCache,
  type CachedRedirect,
  type RedisCommands,
} from '../../../src/modules/url/url.cache';

const KEY = 'cache:url:v2:aB3xK9q';

const entry: CachedRedirect = {
  id: 1n,
  originalUrl: 'https://example.com/',
  isActive: true,
  expiresAt: null,
};

function makeRedis() {
  return {
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  } satisfies RedisCommands;
}

describe('NullRedirectCache', () => {
  const cache = new NullRedirectCache();

  it('always misses and never throws', async () => {
    await expect(cache.get('aB3xK9q')).resolves.toBeNull();
    await expect(cache.set('aB3xK9q', entry)).resolves.toBeUndefined();
    await expect(cache.setNegative('aB3xK9q')).resolves.toBeUndefined();
    await expect(cache.del('aB3xK9q')).resolves.toBeUndefined();
  });
});

describe('RedisRedirectCache', () => {
  let redis: ReturnType<typeof makeRedis>;
  let cache: RedisRedirectCache;

  beforeEach(() => {
    redis = makeRedis();
    cache = new RedisRedirectCache(redis);
  });

  describe('get', () => {
    it('parses a positive entry back into a CachedRedirect', async () => {
      redis.get.mockResolvedValue(
        JSON.stringify({ i: '1', u: 'https://example.com/', a: 1, e: null }),
      );

      await expect(cache.get('aB3xK9q')).resolves.toEqual(entry);
      expect(redis.get).toHaveBeenCalledWith(KEY);
    });

    it('revives id and expiresAt epoch millis, and isActive 0 as false', async () => {
      const epoch = Date.UTC(2030, 0, 1);
      redis.get.mockResolvedValue(
        JSON.stringify({ i: '7', u: 'https://x.com/', a: 0, e: epoch }),
      );

      const result = await cache.get('aB3xK9q');
      expect(result).toEqual({
        id: 7n,
        originalUrl: 'https://x.com/',
        isActive: false,
        expiresAt: new Date(epoch),
      });
    });

    it('treats a pre-analytics (v1-shaped) payload without id as a miss', async () => {
      redis.get.mockResolvedValue(JSON.stringify({ u: 'https://x.com/', a: 1, e: null }));

      await expect(cache.get('aB3xK9q')).resolves.toBeNull();
    });

    it("returns 'negative' for the negative sentinel", async () => {
      redis.get.mockResolvedValue('0');

      await expect(cache.get('aB3xK9q')).resolves.toBe('negative');
    });

    it('returns null on a miss', async () => {
      redis.get.mockResolvedValue(null);

      await expect(cache.get('aB3xK9q')).resolves.toBeNull();
    });

    it('returns null (miss) when Redis fails — fail-open', async () => {
      redis.get.mockRejectedValue(new Error('connection refused'));

      await expect(cache.get('aB3xK9q')).resolves.toBeNull();
    });

    it('returns null on a corrupt payload instead of throwing', async () => {
      redis.get.mockResolvedValue('not json{');

      await expect(cache.get('aB3xK9q')).resolves.toBeNull();
    });
  });

  describe('set', () => {
    it('writes the compact wire format with a jittered TTL (3600s ±10%)', async () => {
      redis.set.mockResolvedValue('OK');
      const expiresAt = new Date('2030-01-01T00:00:00Z');

      await cache.set('aB3xK9q', { ...entry, expiresAt });

      expect(redis.set).toHaveBeenCalledTimes(1);
      const [key, value, mode, ttl] = redis.set.mock.calls[0];
      expect(key).toBe(KEY);
      expect(JSON.parse(value)).toEqual({
        i: '1',
        u: 'https://example.com/',
        a: 1,
        e: expiresAt.getTime(),
      });
      expect(mode).toBe('EX');
      expect(ttl).toBeGreaterThanOrEqual(3240);
      expect(ttl).toBeLessThanOrEqual(3960);
    });

    it('never throws when Redis fails', async () => {
      redis.set.mockRejectedValue(new Error('timeout'));

      await expect(cache.set('aB3xK9q', entry)).resolves.toBeUndefined();
    });
  });

  describe('setNegative', () => {
    it('writes the sentinel with the 60s negative TTL', async () => {
      redis.set.mockResolvedValue('OK');

      await cache.setNegative('aB3xK9q');

      expect(redis.set).toHaveBeenCalledWith(KEY, '0', 'EX', 60);
    });

    it('never throws when Redis fails', async () => {
      redis.set.mockRejectedValue(new Error('timeout'));

      await expect(cache.setNegative('aB3xK9q')).resolves.toBeUndefined();
    });
  });

  describe('del', () => {
    it('deletes the namespaced key', async () => {
      redis.del.mockResolvedValue(1);

      await cache.del('aB3xK9q');

      expect(redis.del).toHaveBeenCalledWith(KEY);
    });

    it('never throws when Redis fails', async () => {
      redis.del.mockRejectedValue(new Error('timeout'));

      await expect(cache.del('aB3xK9q')).resolves.toBeUndefined();
    });
  });

  it('recovers after a failure without breaking subsequent operations', async () => {
    redis.get.mockRejectedValueOnce(new Error('down')).mockResolvedValue('0');

    await expect(cache.get('aB3xK9q')).resolves.toBeNull();
    await expect(cache.get('aB3xK9q')).resolves.toBe('negative');
  });
});
