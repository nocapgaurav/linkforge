import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultUrlService } from '../../../src/modules/url/url.service';
import type { UrlRepository } from '../../../src/modules/url/url.repository';
import {
  AliasAlreadyExistsError,
  ShortCodeGenerationError,
  UrlNotFoundError,
} from '../../../src/modules/url/url.errors';
import { ShortCodeConflictError, type Url } from '../../../src/modules/url/url.types';
import type { CachedRedirect, RedirectCache } from '../../../src/modules/url/url.cache';
import type { ClickSink } from '../../../src/modules/analytics/click.sink';

const BASE62_CODE = /^[0-9A-Za-z]{7}$/;

function makeUrl(overrides: Partial<Url> = {}): Url {
  return {
    id: 1n,
    shortCode: 'aB3xK9q',
    isCustomAlias: false,
    originalUrl: 'https://example.com/',
    urlHash: 'a'.repeat(64),
    clickCount: 0n,
    isActive: true,
    expiresAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeRepo() {
  return {
    create: vi.fn(),
    findByShortCode: vi.fn(),
    findById: vi.fn(),
    list: vi.fn(),
    update: vi.fn(),
    incrementClickCount: vi.fn(),
    softDelete: vi.fn(),
  } satisfies UrlRepository;
}

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('DefaultUrlService', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: DefaultUrlService;

  beforeEach(() => {
    repo = makeRepo();
    service = new DefaultUrlService(repo);
  });

  describe('create', () => {
    it('creates with a generated base62 code, normalized URL, and SHA-256 hash', async () => {
      repo.create.mockImplementation(async (input) => makeUrl(input));

      const result = await service.create({ originalUrl: 'https://Example.COM/Path?q=1' });

      expect(repo.create).toHaveBeenCalledTimes(1);
      const input = repo.create.mock.calls[0][0];
      expect(input.shortCode).toMatch(BASE62_CODE);
      expect(input.isCustomAlias).toBe(false);
      expect(input.originalUrl).toBe('https://example.com/Path?q=1'); // host lowercased, path case kept
      expect(input.urlHash).toBe(sha256('https://example.com/Path?q=1'));
      expect(input.expiresAt).toBeNull();
      expect(result.shortCode).toBe(input.shortCode);
    });

    it('uses the custom alias verbatim and flags it', async () => {
      repo.create.mockImplementation(async (input) => makeUrl(input));

      const expiresAt = new Date('2030-01-01T00:00:00Z');
      await service.create({
        originalUrl: 'https://example.com',
        customAlias: 'My-Link_1',
        expiresAt,
      });

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ shortCode: 'My-Link_1', isCustomAlias: true, expiresAt }),
      );
    });

    it('throws AliasAlreadyExistsError on alias conflict without retrying', async () => {
      repo.create.mockRejectedValue(new ShortCodeConflictError('My-Link_1'));

      await expect(
        service.create({ originalUrl: 'https://example.com', customAlias: 'My-Link_1' }),
      ).rejects.toThrow(AliasAlreadyExistsError);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('retries generated-code collisions with a fresh code until an insert lands', async () => {
      repo.create
        .mockRejectedValueOnce(new ShortCodeConflictError('x'))
        .mockRejectedValueOnce(new ShortCodeConflictError('y'))
        .mockImplementation(async (input) => makeUrl(input));

      const result = await service.create({ originalUrl: 'https://example.com' });

      expect(repo.create).toHaveBeenCalledTimes(3);
      for (const [input] of repo.create.mock.calls) {
        expect(input.shortCode).toMatch(BASE62_CODE);
      }
      expect(result.shortCode).toMatch(BASE62_CODE);
    });

    it('throws ShortCodeGenerationError after exhausting the retry budget', async () => {
      repo.create.mockRejectedValue(new ShortCodeConflictError('x'));

      await expect(service.create({ originalUrl: 'https://example.com' })).rejects.toThrow(
        ShortCodeGenerationError,
      );
      expect(repo.create).toHaveBeenCalledTimes(5);
    });

    it('propagates non-conflict repository errors unchanged', async () => {
      const boom = new Error('connection lost');
      repo.create.mockRejectedValue(boom);

      await expect(service.create({ originalUrl: 'https://example.com' })).rejects.toBe(boom);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });
  });

  describe('getByShortCode (redirect rules)', () => {
    it('returns an active, unexpired URL', async () => {
      const url = makeUrl({ expiresAt: new Date(Date.now() + 60_000) });
      repo.findByShortCode.mockResolvedValue(url);

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
    });

    it('throws UrlNotFoundError for a missing code', async () => {
      repo.findByShortCode.mockResolvedValue(null);

      await expect(service.getByShortCode('nope123')).rejects.toThrow(UrlNotFoundError);
    });

    it('throws UrlNotFoundError for a disabled URL', async () => {
      repo.findByShortCode.mockResolvedValue(makeUrl({ isActive: false }));

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
    });

    it('throws UrlNotFoundError for an expired URL', async () => {
      repo.findByShortCode.mockResolvedValue(makeUrl({ expiresAt: new Date(Date.now() - 1000) }));

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
    });
  });

  describe('getMetadata (management rules)', () => {
    it('returns disabled and expired URLs', async () => {
      const disabled = makeUrl({ isActive: false });
      repo.findByShortCode.mockResolvedValue(disabled);
      await expect(service.getMetadata('aB3xK9q')).resolves.toBe(disabled);

      const expired = makeUrl({ expiresAt: new Date(Date.now() - 1000) });
      repo.findByShortCode.mockResolvedValue(expired);
      await expect(service.getMetadata('aB3xK9q')).resolves.toBe(expired);
    });

    it('throws UrlNotFoundError for a missing code', async () => {
      repo.findByShortCode.mockResolvedValue(null);

      await expect(service.getMetadata('nope123')).rejects.toThrow(UrlNotFoundError);
    });
  });

  describe('delete', () => {
    it('soft-deletes by id and returns the tombstone timestamp', async () => {
      const deletedAt = new Date();
      repo.findByShortCode.mockResolvedValue(makeUrl({ id: 42n }));
      repo.softDelete.mockResolvedValue(deletedAt);

      await expect(service.delete('aB3xK9q')).resolves.toBe(deletedAt);
      expect(repo.softDelete).toHaveBeenCalledWith(42n);
    });

    it('throws UrlNotFoundError for a missing code', async () => {
      repo.findByShortCode.mockResolvedValue(null);

      await expect(service.delete('nope123')).rejects.toThrow(UrlNotFoundError);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('throws UrlNotFoundError when the row was deleted concurrently', async () => {
      repo.findByShortCode.mockResolvedValue(makeUrl());
      repo.softDelete.mockResolvedValue(null);

      await expect(service.delete('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
    });
  });
});

function makeCache(lookup: CachedRedirect | 'negative' | null = null) {
  return {
    get: vi.fn().mockResolvedValue(lookup),
    set: vi.fn().mockResolvedValue(undefined),
    setNegative: vi.fn().mockResolvedValue(undefined),
    del: vi.fn().mockResolvedValue(undefined),
  } satisfies RedirectCache;
}

/** A cache that violates its never-throws contract on every method. */
function makeThrowingCache() {
  const boom = () => vi.fn().mockRejectedValue(new Error('redis exploded'));
  return { get: boom(), set: boom(), setNegative: boom(), del: boom() } satisfies RedirectCache;
}

/** Waits for fire-and-forget cache writes issued during the current tick. */
const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

describe('DefaultUrlService with RedirectCache (cache-aside)', () => {
  let repo: ReturnType<typeof makeRepo>;

  beforeEach(() => {
    repo = makeRepo();
  });

  describe('getByShortCode', () => {
    it('serves a valid positive hit from the cache without touching the repository', async () => {
      const view: CachedRedirect = {
        id: 9n,
        originalUrl: 'https://example.com/cached',
        isActive: true,
        expiresAt: null,
      };
      const cache = makeCache(view);
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(view);
      expect(repo.findByShortCode).not.toHaveBeenCalled();
    });

    it('re-evaluates rules on hits: an expired cached entry 404s without a DB read', async () => {
      const cache = makeCache({
        id: 9n,
        originalUrl: 'https://example.com/',
        isActive: true,
        expiresAt: new Date(Date.now() - 1000),
      });
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
      expect(repo.findByShortCode).not.toHaveBeenCalled();
    });

    it('re-evaluates rules on hits: an inactive cached entry 404s without a DB read', async () => {
      const cache = makeCache({
        id: 9n,
        originalUrl: 'https://example.com/',
        isActive: false,
        expiresAt: null,
      });
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
      expect(repo.findByShortCode).not.toHaveBeenCalled();
    });

    it('404s immediately on a negative hit without touching the repository', async () => {
      const cache = makeCache('negative');
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
      expect(repo.findByShortCode).not.toHaveBeenCalled();
      expect(cache.setNegative).not.toHaveBeenCalled();
    });

    it('on a miss, reads the repository and populates the cache with the redirect view', async () => {
      const cache = makeCache(null);
      const expiresAt = new Date(Date.now() + 60_000);
      const url = makeUrl({ expiresAt });
      repo.findByShortCode.mockResolvedValue(url);
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
      await flushAsync();
      expect(cache.set).toHaveBeenCalledWith('aB3xK9q', {
        id: 1n,
        originalUrl: 'https://example.com/',
        isActive: true,
        expiresAt,
      });
      expect(cache.setNegative).not.toHaveBeenCalled();
    });

    it('on a miss for a missing code, writes a negative entry and 404s', async () => {
      const cache = makeCache(null);
      repo.findByShortCode.mockResolvedValue(null);
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('nope123')).rejects.toThrow(UrlNotFoundError);
      await flushAsync();
      expect(cache.setNegative).toHaveBeenCalledWith('nope123');
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('does not cache a found-but-dead link (inactive or expired) at all', async () => {
      const cache = makeCache(null);
      repo.findByShortCode.mockResolvedValue(makeUrl({ isActive: false }));
      const service = new DefaultUrlService(repo, cache);

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
      await flushAsync();
      expect(cache.set).not.toHaveBeenCalled();
      expect(cache.setNegative).not.toHaveBeenCalled();
    });
  });

  describe('mutation invalidation', () => {
    it('create purges any negative entry for the new code (custom alias)', async () => {
      const cache = makeCache();
      repo.create.mockImplementation(async (input) => makeUrl(input));
      const service = new DefaultUrlService(repo, cache);

      await service.create({ originalUrl: 'https://example.com', customAlias: 'My-Link_1' });

      expect(cache.del).toHaveBeenCalledWith('My-Link_1');
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('create purges any negative entry for the new code (generated)', async () => {
      const cache = makeCache();
      repo.create.mockImplementation(async (input) => makeUrl(input));
      const service = new DefaultUrlService(repo, cache);

      const url = await service.create({ originalUrl: 'https://example.com' });

      expect(cache.del).toHaveBeenCalledWith(url.shortCode);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('delete invalidates the cache entry after a successful soft delete', async () => {
      const cache = makeCache();
      repo.findByShortCode.mockResolvedValue(makeUrl({ id: 42n }));
      repo.softDelete.mockResolvedValue(new Date());
      const service = new DefaultUrlService(repo, cache);

      await service.delete('aB3xK9q');

      expect(cache.del).toHaveBeenCalledWith('aB3xK9q');
    });

    it('delete does not invalidate when the soft delete found nothing', async () => {
      const cache = makeCache();
      repo.findByShortCode.mockResolvedValue(null);
      const service = new DefaultUrlService(repo, cache);

      await expect(service.delete('nope123')).rejects.toThrow(UrlNotFoundError);
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  describe('list (cursor pagination)', () => {
    it('over-fetches by one and reports no next page when the extra row is absent', async () => {
      const rows = [makeUrl({ id: 3n }), makeUrl({ id: 2n })];
      repo.list.mockResolvedValue(rows);
      const service = new DefaultUrlService(repo, makeCache());

      const page = await service.list({ limit: 2 });

      expect(repo.list).toHaveBeenCalledWith({ limit: 3, before: undefined });
      expect(page.items).toEqual(rows);
      expect(page.hasMore).toBe(false);
      expect(page.nextCursor).toBeNull();
    });

    it('slices the extra row off and encodes the last visible row as nextCursor', async () => {
      const createdAt = new Date('2026-07-19T10:00:00.000Z');
      repo.list.mockResolvedValue([
        makeUrl({ id: 9n }),
        makeUrl({ id: 8n, createdAt }),
        makeUrl({ id: 7n }),
      ]);
      const service = new DefaultUrlService(repo, makeCache());

      const page = await service.list({ limit: 2 });

      expect(page.items.map((u) => u.id)).toEqual([9n, 8n]);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(`${createdAt.getTime()}_8`);
    });

    it('passes the parsed cursor through as the keyset position', async () => {
      repo.list.mockResolvedValue([]);
      const service = new DefaultUrlService(repo, makeCache());
      const cursor = { createdAt: new Date('2026-07-01T00:00:00Z'), id: 5n };

      const page = await service.list({ limit: 20, cursor });

      expect(repo.list).toHaveBeenCalledWith({ limit: 21, before: cursor });
      expect(page).toEqual({ items: [], nextCursor: null, hasMore: false });
    });
  });

  describe('analytics emission (ClickSink)', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

    function makeSink() {
      return { record: vi.fn().mockResolvedValue(undefined) } satisfies ClickSink;
    }

    it('records a click on a cache hit, attributed via the cached id', async () => {
      const cache = makeCache({
        id: 9n,
        originalUrl: 'https://example.com/',
        isActive: true,
        expiresAt: null,
      });
      const sink = makeSink();
      const service = new DefaultUrlService(repo, cache, sink);

      await service.getByShortCode('aB3xK9q');
      await flushAsync();

      expect(sink.record).toHaveBeenCalledTimes(1);
      const event = sink.record.mock.calls[0][0];
      expect(event.urlId).toBe(9n);
      expect(event.eventId).toMatch(UUID);
      expect(event.occurredAt).toBeInstanceOf(Date);
      expect(repo.incrementClickCount).toHaveBeenCalledWith(9n);
    });

    it('records a click on a cache miss, attributed via the row id', async () => {
      const cache = makeCache(null);
      const sink = makeSink();
      repo.findByShortCode.mockResolvedValue(makeUrl({ id: 42n }));
      const service = new DefaultUrlService(repo, cache, sink);

      await service.getByShortCode('aB3xK9q');
      await flushAsync();

      expect(sink.record).toHaveBeenCalledTimes(1);
      expect(sink.record.mock.calls[0][0].urlId).toBe(42n);
      expect(repo.incrementClickCount).toHaveBeenCalledWith(42n);
    });

    it('emits distinct eventIds for successive redirects', async () => {
      const cache = makeCache({
        id: 9n,
        originalUrl: 'https://example.com/',
        isActive: true,
        expiresAt: null,
      });
      const sink = makeSink();
      const service = new DefaultUrlService(repo, cache, sink);

      await service.getByShortCode('aB3xK9q');
      await service.getByShortCode('aB3xK9q');
      await flushAsync();

      const [first, second] = sink.record.mock.calls.map((call) => call[0].eventId);
      expect(first).not.toBe(second);
    });

    it('never records for a missing link', async () => {
      const sink = makeSink();
      repo.findByShortCode.mockResolvedValue(null);
      const service = new DefaultUrlService(repo, makeCache(null), sink);

      await expect(service.getByShortCode('nope123')).rejects.toThrow(UrlNotFoundError);
      await flushAsync();
      expect(sink.record).not.toHaveBeenCalled();
      expect(repo.incrementClickCount).not.toHaveBeenCalled();
    });

    it('never records for an expired link (cached or from the database)', async () => {
      const expired = { expiresAt: new Date(Date.now() - 1000) };
      const sink = makeSink();

      const cachedService = new DefaultUrlService(
        repo,
        makeCache({ id: 9n, originalUrl: 'https://x.com/', isActive: true, ...expired }),
        sink,
      );
      await expect(cachedService.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);

      repo.findByShortCode.mockResolvedValue(makeUrl(expired));
      const missService = new DefaultUrlService(repo, makeCache(null), sink);
      await expect(missService.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);

      await flushAsync();
      expect(sink.record).not.toHaveBeenCalled();
      expect(repo.incrementClickCount).not.toHaveBeenCalled();
    });

    it('never records for an inactive link', async () => {
      const sink = makeSink();
      repo.findByShortCode.mockResolvedValue(makeUrl({ isActive: false }));
      const service = new DefaultUrlService(repo, makeCache(null), sink);

      await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
      await flushAsync();
      expect(sink.record).not.toHaveBeenCalled();
      expect(repo.incrementClickCount).not.toHaveBeenCalled();
    });

    it('redirects survive a failing sink (counter still increments)', async () => {
      const sink = { record: vi.fn().mockRejectedValue(new Error('sink down')) };
      const url = makeUrl();
      repo.findByShortCode.mockResolvedValue(url);
      const service = new DefaultUrlService(repo, makeCache(null), sink);

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
      await flushAsync();
      expect(repo.incrementClickCount).toHaveBeenCalledWith(url.id);
    });

    it('redirects survive a failing counter (event still recorded)', async () => {
      const sink = makeSink();
      const url = makeUrl();
      repo.findByShortCode.mockResolvedValue(url);
      repo.incrementClickCount.mockRejectedValue(new Error('lock timeout'));
      const service = new DefaultUrlService(repo, makeCache(null), sink);

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
      await flushAsync();
      expect(sink.record).toHaveBeenCalledTimes(1);
    });

    it('redirects survive both analytics writes failing', async () => {
      const sink = { record: vi.fn().mockRejectedValue(new Error('sink down')) };
      const url = makeUrl();
      repo.findByShortCode.mockResolvedValue(url);
      repo.incrementClickCount.mockRejectedValue(new Error('lock timeout'));
      const service = new DefaultUrlService(repo, makeCache(null), sink);

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
    });
  });

  describe('fail-open with a throwing cache (Redis unavailable)', () => {
    it('getByShortCode still resolves through the repository', async () => {
      const url = makeUrl();
      repo.findByShortCode.mockResolvedValue(url);
      const service = new DefaultUrlService(repo, makeThrowingCache());

      await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
    });

    it('getByShortCode still 404s correctly for missing codes', async () => {
      repo.findByShortCode.mockResolvedValue(null);
      const service = new DefaultUrlService(repo, makeThrowingCache());

      await expect(service.getByShortCode('nope123')).rejects.toThrow(UrlNotFoundError);
    });

    it('create and delete still succeed', async () => {
      repo.create.mockImplementation(async (input) => makeUrl(input));
      repo.findByShortCode.mockResolvedValue(makeUrl({ id: 42n }));
      const deletedAt = new Date();
      repo.softDelete.mockResolvedValue(deletedAt);
      const service = new DefaultUrlService(repo, makeThrowingCache());

      await expect(service.create({ originalUrl: 'https://example.com' })).resolves.toBeTruthy();
      await expect(service.delete('aB3xK9q')).resolves.toBe(deletedAt);
    });
  });
});
