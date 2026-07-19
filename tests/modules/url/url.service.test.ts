import { createHash } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DefaultUrlService } from '../../../src/modules/url/url.service';
import type { UrlRepository } from '../../../src/modules/url/url.repository.interface';
import {
  AliasAlreadyExistsError,
  ShortCodeGenerationError,
  UrlNotFoundError,
} from '../../../src/modules/url/url.errors';
import { ShortCodeConflictError, type Url } from '../../../src/modules/url/url.types';

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
