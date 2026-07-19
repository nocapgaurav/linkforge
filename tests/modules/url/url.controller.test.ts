import type { Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createUrlController } from '../../../src/modules/url/url.controller';
import { UrlNotFoundError } from '../../../src/modules/url/url.errors';
import type { Url } from '../../../src/modules/url/url.types';
import { RequestValidationError } from '../../../src/shared/http/error-handler';

function makeUrl(overrides: Partial<Url> = {}): Url {
  return {
    id: 1n,
    shortCode: 'aB3xK9q',
    isCustomAlias: false,
    originalUrl: 'https://example.com/',
    urlHash: 'a'.repeat(64),
    clickCount: 42n,
    isActive: true,
    expiresAt: null,
    createdBy: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makeService() {
  return {
    create: vi.fn(),
    getByShortCode: vi.fn(),
    getMetadata: vi.fn(),
    delete: vi.fn(),
  };
}

/**
 * Drives a handler (through asyncHandler) to completion: resolves when the
 * response is written or next() is called with an error.
 */
function run(handler: RequestHandler, req: Partial<Request>) {
  interface Captured {
    statusCode: number;
    headers: Record<string, string>;
    body: unknown;
    redirect?: { status: number; url: string };
    error?: unknown;
  }
  return new Promise<Captured>((resolve) => {
    const captured: Captured = { statusCode: 200, headers: {}, body: undefined };
    const res = {
      status(code: number) {
        captured.statusCode = code;
        return this;
      },
      json(payload: unknown) {
        captured.body = payload;
        resolve(captured);
        return this;
      },
      setHeader(name: string, value: string) {
        captured.headers[name.toLowerCase()] = value;
        return this;
      },
      redirect(status: number, url: string) {
        captured.redirect = { status, url };
        resolve(captured);
      },
    };
    const next = (error?: unknown) => {
      captured.error = error;
      resolve(captured);
    };
    handler(req as Request, res as unknown as Response, next);
  });
}

describe('urlController', () => {
  let service: ReturnType<typeof makeService>;
  let controller: ReturnType<typeof createUrlController>;

  beforeEach(() => {
    service = makeService();
    controller = createUrlController(service);
  });

  describe('createUrl', () => {
    it('rejects an invalid body with RequestValidationError and never calls the service', async () => {
      const { error } = await run(controller.createUrl, { body: { originalUrl: 'not a url' } });

      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).failure.error.code).toBe('VALIDATION_ERROR');
      expect(service.create).not.toHaveBeenCalled();
    });

    it('returns 201 with Location header and the public resource', async () => {
      service.create.mockResolvedValue(makeUrl());

      const result = await run(controller.createUrl, {
        body: { originalUrl: 'https://example.com' },
      });

      expect(result.statusCode).toBe(201);
      expect(result.headers['location']).toBe('/api/v1/urls/aB3xK9q');
      expect(result.body).toEqual({
        success: true,
        data: {
          shortCode: 'aB3xK9q',
          shortUrl: 'http://localhost:3000/aB3xK9q',
          originalUrl: 'https://example.com/',
          isCustomAlias: false,
          isActive: true,
          clickCount: 42,
          expiresAt: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      });
      expect(service.create).toHaveBeenCalledWith({ originalUrl: 'https://example.com' });
    });
  });

  describe('redirectToOriginalUrl', () => {
    it('302-redirects to the original URL with no-cache', async () => {
      service.getByShortCode.mockResolvedValue(makeUrl());

      const result = await run(controller.redirectToOriginalUrl, {
        params: { shortCode: 'aB3xK9q' },
      });

      expect(result.redirect).toEqual({ status: 302, url: 'https://example.com/' });
      expect(result.headers['cache-control']).toBe('private, no-cache');
    });

    it('treats a malformed code as 404, not 400 (redirect plane never explains)', async () => {
      const { error } = await run(controller.redirectToOriginalUrl, {
        params: { shortCode: 'x' },
      });

      expect(error).toBeInstanceOf(UrlNotFoundError);
      expect(service.getByShortCode).not.toHaveBeenCalled();
    });

    it('lets service errors bubble to the global handler', async () => {
      service.getByShortCode.mockRejectedValue(new UrlNotFoundError('aB3xK9q'));

      const { error } = await run(controller.redirectToOriginalUrl, {
        params: { shortCode: 'aB3xK9q' },
      });

      expect(error).toBeInstanceOf(UrlNotFoundError);
    });
  });

  describe('getUrlMetadata', () => {
    it('returns the resource in a success envelope', async () => {
      const expired = makeUrl({ expiresAt: new Date('2026-02-01T00:00:00Z'), isActive: false });
      service.getMetadata.mockResolvedValue(expired);

      const result = await run(controller.getUrlMetadata, { params: { shortCode: 'aB3xK9q' } });

      expect(result.statusCode).toBe(200);
      const body = result.body as { success: boolean; data: Record<string, unknown> };
      expect(body.success).toBe(true);
      expect(body.data.isActive).toBe(false);
      expect(body.data.expiresAt).toBe('2026-02-01T00:00:00.000Z');
      expect(body.data).not.toHaveProperty('id');
      expect(body.data).not.toHaveProperty('urlHash');
      expect(body.data).not.toHaveProperty('deletedAt');
    });

    it('rejects malformed params with RequestValidationError', async () => {
      const { error } = await run(controller.getUrlMetadata, { params: { shortCode: 'x' } });

      expect(error).toBeInstanceOf(RequestValidationError);
      expect(service.getMetadata).not.toHaveBeenCalled();
    });
  });

  describe('deleteUrl', () => {
    it('returns 200 with the deletion receipt', async () => {
      const deletedAt = new Date('2026-07-19T12:00:00Z');
      service.delete.mockResolvedValue(deletedAt);

      const result = await run(controller.deleteUrl, { params: { shortCode: 'aB3xK9q' } });

      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({
        success: true,
        data: { shortCode: 'aB3xK9q', deletedAt: '2026-07-19T12:00:00.000Z' },
      });
    });
  });
});
