import { createHash } from 'node:crypto';
import bcrypt from 'bcrypt';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultUrlService } from '../../../src/modules/url/url.service';
import type { UrlRepository } from '../../../src/modules/url/url.repository';
import {
  AliasAlreadyExistsError,
  LinkPasswordRequiredError,
  ShortCodeGenerationError,
  UrlNotFoundError,
} from '../../../src/modules/url/url.errors';
import { ShortCodeConflictError, type Url } from '../../../src/modules/url/url.types';
import type { CachedRedirect, RedirectCache } from '../../../src/modules/url/url.cache';
import type { ClickSink } from '../../../src/modules/analytics/click.sink';

const BASE62_CODE = /^[0-9A-Za-z]{7}$/;

/** Owner used by every authenticated call in these tests. */
const OWNER = 7n;

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
    createdBy: OWNER,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    deletedAt: null,
    passwordHash: null,
    maxClicks: null,
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
    incrementIfUnderClickLimit: vi.fn(),
    softDelete: vi.fn(),
    findByShortCodeIncludingDeleted: vi.fn(),
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

      const result = await service.create({ originalUrl: 'https://Example.COM/Path?q=1' }, OWNER);

      expect(repo.create).toHaveBeenCalledTimes(1);
      const input = repo.create.mock.calls[0][0];
      expect(input.shortCode).toMatch(BASE62_CODE);
      expect(input.isCustomAlias).toBe(false);
      expect(input.originalUrl).toBe('https://example.com/Path?q=1'); // host lowercased, path case kept
      expect(input.urlHash).toBe(sha256('https://example.com/Path?q=1'));
      expect(input.expiresAt).toBeNull();
      expect(input.createdBy).toBe(OWNER);
      expect(result.shortCode).toBe(input.shortCode);
    });

    it('uses the custom alias verbatim and flags it', async () => {
      repo.create.mockImplementation(async (input) => makeUrl(input));

      const expiresAt = new Date('2030-01-01T00:00:00Z');
      await service.create({
        originalUrl: 'https://example.com',
        customAlias: 'My-Link_1',
        expiresAt,
      }, OWNER);

      expect(repo.create).toHaveBeenCalledWith(
        expect.objectContaining({ shortCode: 'My-Link_1', isCustomAlias: true, expiresAt }),
      );
    });

    it('throws AliasAlreadyExistsError on alias conflict without retrying', async () => {
      repo.create.mockRejectedValue(new ShortCodeConflictError('My-Link_1'));

      await expect(
        service.create({ originalUrl: 'https://example.com', customAlias: 'My-Link_1' }, OWNER),
      ).rejects.toThrow(AliasAlreadyExistsError);
      expect(repo.create).toHaveBeenCalledTimes(1);
    });

    it('retries generated-code collisions with a fresh code until an insert lands', async () => {
      repo.create
        .mockRejectedValueOnce(new ShortCodeConflictError('x'))
        .mockRejectedValueOnce(new ShortCodeConflictError('y'))
        .mockImplementation(async (input) => makeUrl(input));

      const result = await service.create({ originalUrl: 'https://example.com' }, OWNER);

      expect(repo.create).toHaveBeenCalledTimes(3);
      for (const [input] of repo.create.mock.calls) {
        expect(input.shortCode).toMatch(BASE62_CODE);
      }
      expect(result.shortCode).toMatch(BASE62_CODE);
    });

    it('throws ShortCodeGenerationError after exhausting the retry budget', async () => {
      repo.create.mockRejectedValue(new ShortCodeConflictError('x'));

      await expect(service.create({ originalUrl: 'https://example.com' }, OWNER)).rejects.toThrow(
        ShortCodeGenerationError,
      );
      expect(repo.create).toHaveBeenCalledTimes(5);
    });

    it('propagates non-conflict repository errors unchanged', async () => {
      const boom = new Error('connection lost');
      repo.create.mockRejectedValue(boom);

      await expect(service.create({ originalUrl: 'https://example.com' }, OWNER)).rejects.toBe(boom);
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
      await expect(service.getMetadata('aB3xK9q', OWNER)).resolves.toBe(disabled);

      const expired = makeUrl({ expiresAt: new Date(Date.now() - 1000) });
      repo.findByShortCode.mockResolvedValue(expired);
      await expect(service.getMetadata('aB3xK9q', OWNER)).resolves.toBe(expired);
    });

    it('throws UrlNotFoundError for a missing code', async () => {
      repo.findByShortCode.mockResolvedValue(null);

      await expect(service.getMetadata('nope123', OWNER)).rejects.toThrow(UrlNotFoundError);
    });
  });

  describe('delete', () => {
    it('soft-deletes by id and returns the tombstone timestamp', async () => {
      const deletedAt = new Date();
      repo.findByShortCode.mockResolvedValue(makeUrl({ id: 42n }));
      repo.softDelete.mockResolvedValue(deletedAt);

      await expect(service.delete('aB3xK9q', OWNER)).resolves.toBe(deletedAt);
      expect(repo.softDelete).toHaveBeenCalledWith(42n);
    });

    it('throws UrlNotFoundError for a missing code', async () => {
      repo.findByShortCode.mockResolvedValue(null);

      await expect(service.delete('nope123', OWNER)).rejects.toThrow(UrlNotFoundError);
      expect(repo.softDelete).not.toHaveBeenCalled();
    });

    it('throws UrlNotFoundError when the row was deleted concurrently', async () => {
      repo.findByShortCode.mockResolvedValue(makeUrl());
      repo.softDelete.mockResolvedValue(null);

      await expect(service.delete('aB3xK9q', OWNER)).rejects.toThrow(UrlNotFoundError);
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

      await service.create({ originalUrl: 'https://example.com', customAlias: 'My-Link_1' }, OWNER);

      expect(cache.del).toHaveBeenCalledWith('My-Link_1');
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('create purges any negative entry for the new code (generated)', async () => {
      const cache = makeCache();
      repo.create.mockImplementation(async (input) => makeUrl(input));
      const service = new DefaultUrlService(repo, cache);

      const url = await service.create({ originalUrl: 'https://example.com' }, OWNER);

      expect(cache.del).toHaveBeenCalledWith(url.shortCode);
      expect(cache.set).not.toHaveBeenCalled();
    });

    it('delete invalidates the cache entry after a successful soft delete', async () => {
      const cache = makeCache();
      repo.findByShortCode.mockResolvedValue(makeUrl({ id: 42n }));
      repo.softDelete.mockResolvedValue(new Date());
      const service = new DefaultUrlService(repo, cache);

      await service.delete('aB3xK9q', OWNER);

      expect(cache.del).toHaveBeenCalledWith('aB3xK9q');
    });

    it('delete does not invalidate when the soft delete found nothing', async () => {
      const cache = makeCache();
      repo.findByShortCode.mockResolvedValue(null);
      const service = new DefaultUrlService(repo, cache);

      await expect(service.delete('nope123', OWNER)).rejects.toThrow(UrlNotFoundError);
      expect(cache.del).not.toHaveBeenCalled();
    });
  });

  describe('list (cursor pagination)', () => {
    it('over-fetches by one and reports no next page when the extra row is absent', async () => {
      const rows = [makeUrl({ id: 3n }), makeUrl({ id: 2n })];
      repo.list.mockResolvedValue(rows);
      const service = new DefaultUrlService(repo, makeCache());

      const page = await service.list({ limit: 2 }, OWNER);

      expect(repo.list).toHaveBeenCalledWith({ createdBy: OWNER, limit: 3, before: undefined });
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

      const page = await service.list({ limit: 2 }, OWNER);

      expect(page.items.map((u) => u.id)).toEqual([9n, 8n]);
      expect(page.hasMore).toBe(true);
      expect(page.nextCursor).toBe(`${createdAt.getTime()}_8`);
    });

    it('passes the parsed cursor through as the keyset position', async () => {
      repo.list.mockResolvedValue([]);
      const service = new DefaultUrlService(repo, makeCache());
      const cursor = { createdAt: new Date('2026-07-01T00:00:00Z'), id: 5n };

      const page = await service.list({ limit: 20, cursor }, OWNER);

      expect(repo.list).toHaveBeenCalledWith({ createdBy: OWNER, limit: 21, before: cursor });
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

      await expect(service.create({ originalUrl: 'https://example.com' }, OWNER)).resolves.toBeTruthy();
      await expect(service.delete('aB3xK9q', OWNER)).resolves.toBe(deletedAt);
    });
  });
});

describe('DefaultUrlService ownership (anti-enumeration)', () => {
  const STRANGER = 8n;
  let repo: ReturnType<typeof makeRepo>;
  let service: DefaultUrlService;

  beforeEach(() => {
    repo = makeRepo();
    service = new DefaultUrlService(repo);
  });

  it("getMetadata hides another owner's link as a plain 404", async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ createdBy: OWNER }));

    await expect(service.getMetadata('aB3xK9q', STRANGER)).rejects.toThrow(UrlNotFoundError);
  });

  it("delete refuses another owner's link without touching it", async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ createdBy: OWNER }));

    await expect(service.delete('aB3xK9q', STRANGER)).rejects.toThrow(UrlNotFoundError);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('list is always scoped to the requesting owner', async () => {
    repo.list.mockResolvedValue([]);

    await service.list({ limit: 20 }, STRANGER);

    expect(repo.list).toHaveBeenCalledWith({ createdBy: STRANGER, limit: 21, before: undefined });
  });

  it('redirect resolution stays ownerless (public plane)', async () => {
    const url = makeUrl({ createdBy: OWNER });
    repo.findByShortCode.mockResolvedValue(url);

    await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);
  });

  it("update refuses another owner's link without touching it", async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ createdBy: OWNER }));

    await expect(service.update('aB3xK9q', { isActive: false }, STRANGER)).rejects.toThrow(
      UrlNotFoundError,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });
});

describe('DefaultUrlService.update (edit links, partial updates)', () => {
  let repo: ReturnType<typeof makeRepo>;
  let cache: RedirectCache;
  let service: DefaultUrlService;

  beforeEach(() => {
    repo = makeRepo();
    cache = { get: vi.fn(), set: vi.fn(), setNegative: vi.fn(), del: vi.fn() };
    service = new DefaultUrlService(repo, cache);
  });

  it('throws UrlNotFoundError for a missing short code without writing', async () => {
    repo.findByShortCode.mockResolvedValue(null);

    await expect(service.update('nope123', { isActive: false }, OWNER)).rejects.toThrow(
      UrlNotFoundError,
    );
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('patches only the provided fields (partial update)', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockImplementation(async (_id, patch) => makeUrl({ id: 9n, ...patch }));

    await service.update('aB3xK9q', { isActive: false }, OWNER);

    expect(repo.update).toHaveBeenCalledWith(9n, { isActive: false });
  });

  it('re-normalizes and re-hashes the destination when originalUrl changes', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockImplementation(async (_id, patch) => makeUrl({ id: 9n, ...patch }));

    await service.update('aB3xK9q', { originalUrl: 'https://Example.COM/New' }, OWNER);

    const patch = repo.update.mock.calls[0][1];
    expect(patch.originalUrl).toBe('https://example.com/New');
    expect(patch.urlHash).toBe(sha256('https://example.com/New'));
  });

  it('expiresAt: passes a value through, and explicit null clears it', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockImplementation(async (_id, patch) => makeUrl({ id: 9n, ...patch }));
    const expiresAt = new Date('2030-01-01T00:00:00Z');

    await service.update('aB3xK9q', { expiresAt }, OWNER);
    expect(repo.update).toHaveBeenLastCalledWith(9n, { expiresAt });

    await service.update('aB3xK9q', { expiresAt: null }, OWNER);
    expect(repo.update).toHaveBeenLastCalledWith(9n, { expiresAt: null });
  });

  it('maxClicks: passes a value through, and explicit null clears it', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockImplementation(async (_id, patch) => makeUrl({ id: 9n, ...patch }));

    await service.update('aB3xK9q', { maxClicks: 100 }, OWNER);
    expect(repo.update).toHaveBeenLastCalledWith(9n, { maxClicks: 100 });

    await service.update('aB3xK9q', { maxClicks: null }, OWNER);
    expect(repo.update).toHaveBeenLastCalledWith(9n, { maxClicks: null });
  });

  it('password: hashes a provided value, and explicit null removes it', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockImplementation(async (_id, patch) => makeUrl({ id: 9n, ...patch }));

    await service.update('aB3xK9q', { password: 'gate-1234' }, OWNER);
    const setPatch = repo.update.mock.calls[0][1];
    expect(setPatch.passwordHash).toMatch(/^\$2b\$/);
    expect(setPatch.passwordHash).not.toContain('gate-1234');

    await service.update('aB3xK9q', { password: null }, OWNER);
    expect(repo.update).toHaveBeenLastCalledWith(9n, { passwordHash: null });
  });

  it('omitted fields never appear in the repository patch', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockResolvedValue(makeUrl({ id: 9n }));

    await service.update('aB3xK9q', {}, OWNER);

    expect(repo.update).toHaveBeenCalledWith(9n, {});
  });

  it('invalidates the cache entry after a successful update', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockResolvedValue(makeUrl({ id: 9n, isActive: false }));

    await service.update('aB3xK9q', { isActive: false }, OWNER);

    expect(cache.del).toHaveBeenCalledWith('aB3xK9q');
  });

  it('throws UrlNotFoundError if the row was deleted between find and write', async () => {
    repo.findByShortCode.mockResolvedValue(makeUrl({ id: 9n }));
    repo.update.mockResolvedValue(null);

    await expect(service.update('aB3xK9q', { isActive: false }, OWNER)).rejects.toThrow(
      UrlNotFoundError,
    );
  });
});

describe('DefaultUrlService.getByShortCode — password protection', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: DefaultUrlService;

  beforeEach(() => {
    repo = makeRepo();
    service = new DefaultUrlService(repo);
  });

  it('redirects with the correct password, and does not populate the cache', async () => {
    const cache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn(),
      setNegative: vi.fn(),
      del: vi.fn(),
    };
    service = new DefaultUrlService(repo, cache);
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    repo.findByShortCode.mockResolvedValue(makeUrl({ passwordHash }));

    await expect(service.getByShortCode('aB3xK9q', 'correct-horse')).resolves.toMatchObject({
      shortCode: 'aB3xK9q',
    });
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('rejects with LinkPasswordRequiredError when no password is provided', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    repo.findByShortCode.mockResolvedValue(makeUrl({ passwordHash }));

    await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(LinkPasswordRequiredError);
  });

  it('rejects with the SAME error for a wrong password (no distinguishing signal)', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    repo.findByShortCode.mockResolvedValue(makeUrl({ passwordHash }));

    const missing = await service.getByShortCode('aB3xK9q').catch((e) => e);
    const wrong = await service.getByShortCode('aB3xK9q', 'wrong-guess').catch((e) => e);

    expect(missing).toBeInstanceOf(LinkPasswordRequiredError);
    expect(wrong).toBeInstanceOf(LinkPasswordRequiredError);
    expect(missing.message).toBe(wrong.message);
  });

  it('never counts a failed password attempt as a click', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    repo.findByShortCode.mockResolvedValue(makeUrl({ passwordHash }));

    await service.getByShortCode('aB3xK9q', 'wrong-guess').catch(() => undefined);

    expect(repo.incrementClickCount).not.toHaveBeenCalled();
  });

  it('an inactive password-protected link 404s before ever checking the password', async () => {
    const passwordHash = await bcrypt.hash('correct-horse', 4);
    repo.findByShortCode.mockResolvedValue(makeUrl({ passwordHash, isActive: false }));

    await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
  });
});

describe('DefaultUrlService.getByShortCode — click-limit expiration', () => {
  let repo: ReturnType<typeof makeRepo>;
  let cache: RedirectCache;
  let service: DefaultUrlService;

  beforeEach(() => {
    repo = makeRepo();
    cache = { get: vi.fn().mockResolvedValue(null), set: vi.fn(), setNegative: vi.fn(), del: vi.fn() };
    service = new DefaultUrlService(repo, cache);
  });

  it('redirects while under the limit, atomically incrementing (not the approximate counter)', async () => {
    const url = makeUrl({ maxClicks: 10, clickCount: 3n });
    repo.findByShortCode.mockResolvedValue(url);
    repo.incrementIfUnderClickLimit.mockResolvedValue(true);

    await expect(service.getByShortCode('aB3xK9q')).resolves.toBe(url);

    expect(repo.incrementIfUnderClickLimit).toHaveBeenCalledWith(url.id, 10);
    expect(repo.incrementClickCount).not.toHaveBeenCalled();
    expect(cache.set).not.toHaveBeenCalled();
  });

  it('404s once the pre-check sees the limit already reached — no atomic call made', async () => {
    const url = makeUrl({ maxClicks: 10, clickCount: 10n });
    repo.findByShortCode.mockResolvedValue(url);

    await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
    expect(repo.incrementIfUnderClickLimit).not.toHaveBeenCalled();
  });

  it('404s when the atomic increment loses a race, even though the pre-check passed', async () => {
    const url = makeUrl({ maxClicks: 10, clickCount: 9n });
    repo.findByShortCode.mockResolvedValue(url);
    repo.incrementIfUnderClickLimit.mockResolvedValue(false);

    await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
  });

  it('analytics remain historically available for a click-exhausted link', async () => {
    // getMetadata / analytics both read the raw row regardless of exhaustion —
    // click-limit rules apply only to the redirect decision.
    const url = makeUrl({ maxClicks: 1, clickCount: 1n });
    repo.findByShortCode.mockResolvedValue(url);

    await expect(service.getByShortCode('aB3xK9q')).rejects.toThrow(UrlNotFoundError);
    await expect(service.getMetadata('aB3xK9q', OWNER)).resolves.toBe(url);
  });
});

describe('DefaultUrlService.diagnoseDeadLink', () => {
  let repo: ReturnType<typeof makeRepo>;
  let service: DefaultUrlService;

  beforeEach(() => {
    repo = makeRepo();
    service = new DefaultUrlService(repo);
  });

  it('reports "not-found" when no row exists at all, even including deleted', async () => {
    repo.findByShortCodeIncludingDeleted.mockResolvedValue(null);

    await expect(service.diagnoseDeadLink('ghost')).resolves.toBe('not-found');
  });

  it('reports "deleted" for a soft-deleted (tombstoned) row', async () => {
    repo.findByShortCodeIncludingDeleted.mockResolvedValue(
      makeUrl({ deletedAt: new Date('2026-01-01T00:00:00Z') }),
    );

    await expect(service.diagnoseDeadLink('aB3xK9q')).resolves.toBe('deleted');
  });

  it('reports "not-found" (not a distinct "disabled" bucket) for a manually deactivated link', async () => {
    repo.findByShortCodeIncludingDeleted.mockResolvedValue(makeUrl({ isActive: false }));

    await expect(service.diagnoseDeadLink('aB3xK9q')).resolves.toBe('not-found');
  });

  it('reports "expired" for a time-expired, still-active link', async () => {
    repo.findByShortCodeIncludingDeleted.mockResolvedValue(
      makeUrl({ expiresAt: new Date('2020-01-01T00:00:00Z') }),
    );

    await expect(service.diagnoseDeadLink('aB3xK9q')).resolves.toBe('expired');
  });

  it('reports "limit-reached" for a click-exhausted, still-active, unexpired link', async () => {
    repo.findByShortCodeIncludingDeleted.mockResolvedValue(
      makeUrl({ maxClicks: 5, clickCount: 5n }),
    );

    await expect(service.diagnoseDeadLink('aB3xK9q')).resolves.toBe('limit-reached');
  });

  it('deletion takes priority over expiry/click-limit when a tombstoned row also looks expired', async () => {
    repo.findByShortCodeIncludingDeleted.mockResolvedValue(
      makeUrl({
        deletedAt: new Date('2026-01-01T00:00:00Z'),
        expiresAt: new Date('2020-01-01T00:00:00Z'),
      }),
    );

    await expect(service.diagnoseDeadLink('aB3xK9q')).resolves.toBe('deleted');
  });
});
