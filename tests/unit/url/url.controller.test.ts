import type { Request, RequestHandler, Response } from 'express';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../../src/config/env';
import { createUrlController } from '../../../src/modules/url/url.controller';
import { LinkPasswordRequiredError, UrlNotFoundError } from '../../../src/modules/url/url.errors';
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
    createdBy: 1n,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    deletedAt: null,
    passwordHash: null,
    maxClicks: null,
    ...overrides,
  };
}

function makeService() {
  return {
    create: vi.fn(),
    getByShortCode: vi.fn(),
    getMetadata: vi.fn(),
    delete: vi.fn(),
    diagnoseDeadLink: vi.fn(),
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
    const fullReq = { query: {}, ...req } as Request;
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
    handler(fullReq, res as unknown as Response, next);
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
      const { error } = await run(controller.createUrl, { user: { id: 1n }, body: { originalUrl: 'not a url' } });

      expect(error).toBeInstanceOf(RequestValidationError);
      expect((error as RequestValidationError).failure.error.code).toBe('VALIDATION_ERROR');
      expect(service.create).not.toHaveBeenCalled();
    });

    it('returns 201 with Location header and the public resource', async () => {
      service.create.mockResolvedValue(makeUrl());

      const result = await run(controller.createUrl, {
        user: { id: 1n },
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
          maxClicks: null,
          hasPassword: false,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
        },
      });
      expect(service.create).toHaveBeenCalledWith({ originalUrl: 'https://example.com' }, 1n);
    });
  });

  describe('redirectToOriginalUrl', () => {
    it('302-redirects to the original URL with no-cache', async () => {
      service.getByShortCode.mockResolvedValue(makeUrl());

      const result = await run(controller.redirectToOriginalUrl, {
        user: { id: 1n },
        params: { shortCode: 'aB3xK9q' },
      });

      expect(result.redirect).toEqual({ status: 302, url: 'https://example.com/' });
      expect(result.headers['cache-control']).toBe('private, no-cache');
    });

    it('treats a malformed code as 404, not 400 (redirect plane never explains)', async () => {
      const { error } = await run(controller.redirectToOriginalUrl, {
        user: { id: 1n },
        params: { shortCode: 'x' },
      });

      expect(error).toBeInstanceOf(UrlNotFoundError);
      expect(service.getByShortCode).not.toHaveBeenCalled();
    });

    it('lets service errors bubble to the global handler', async () => {
      service.getByShortCode.mockRejectedValue(new UrlNotFoundError('aB3xK9q'));

      const { error } = await run(controller.redirectToOriginalUrl, {
        user: { id: 1n },
        params: { shortCode: 'aB3xK9q' },
      });

      expect(error).toBeInstanceOf(UrlNotFoundError);
    });

    describe('browser-facing pages (Accept: text/html)', () => {
      const html = { accept: 'text/html,application/xhtml+xml' };

      beforeEach(() => {
        env.frontendOrigin = 'http://localhost:3001';
      });

      afterEach(() => {
        env.frontendOrigin = undefined;
      });

      it('a non-browser request (no Accept: text/html) still gets the unchanged JSON error', async () => {
        service.getByShortCode.mockRejectedValue(new LinkPasswordRequiredError('aB3xK9q'));

        const { error } = await run(controller.redirectToOriginalUrl, {
          params: { shortCode: 'aB3xK9q' },
        });

        expect(error).toBeInstanceOf(LinkPasswordRequiredError);
        expect(service.diagnoseDeadLink).not.toHaveBeenCalled();
      });

      it('password required, none given: redirects to /unlock/:shortCode with no error flag', async () => {
        service.getByShortCode.mockRejectedValue(new LinkPasswordRequiredError('aB3xK9q'));

        const result = await run(controller.redirectToOriginalUrl, {
          headers: html,
          params: { shortCode: 'aB3xK9q' },
        });

        expect(result.redirect).toEqual({
          status: 302,
          url: 'http://localhost:3001/unlock/aB3xK9q',
        });
      });

      it('wrong password given: redirects to /unlock/:shortCode?error=1', async () => {
        service.getByShortCode.mockRejectedValue(new LinkPasswordRequiredError('aB3xK9q'));

        const result = await run(controller.redirectToOriginalUrl, {
          headers: html,
          params: { shortCode: 'aB3xK9q' },
          query: { password: 'wrong' },
        });

        expect(result.redirect).toEqual({
          status: 302,
          url: 'http://localhost:3001/unlock/aB3xK9q?error=1',
        });
      });

      it.each([
        ['not-found', 'not-found'],
        ['deleted', 'deleted'],
        ['expired', 'expired'],
        ['limit-reached', 'limit-reached'],
      ])('dead link diagnosed as %s: redirects to /link/:shortCode?reason=%s', async (diagnosis, reason) => {
        service.getByShortCode.mockRejectedValue(new UrlNotFoundError('aB3xK9q'));
        service.diagnoseDeadLink.mockResolvedValue(diagnosis);

        const result = await run(controller.redirectToOriginalUrl, {
          headers: html,
          params: { shortCode: 'aB3xK9q' },
        });

        expect(service.diagnoseDeadLink).toHaveBeenCalledWith('aB3xK9q');
        expect(result.redirect).toEqual({
          status: 302,
          url: `http://localhost:3001/link/aB3xK9q?reason=${reason}`,
        });
      });

      it('falls back to the unchanged JSON error when FRONTEND_ORIGIN is not configured', async () => {
        env.frontendOrigin = undefined;
        service.getByShortCode.mockRejectedValue(new LinkPasswordRequiredError('aB3xK9q'));

        const { error } = await run(controller.redirectToOriginalUrl, {
          headers: html,
          params: { shortCode: 'aB3xK9q' },
        });

        expect(error).toBeInstanceOf(LinkPasswordRequiredError);
      });

      it('a malformed short code is still diagnosed and sent to the "not found" page', async () => {
        service.diagnoseDeadLink.mockResolvedValue('not-found');

        const result = await run(controller.redirectToOriginalUrl, {
          headers: html,
          params: { shortCode: 'x' },
        });

        expect(service.getByShortCode).not.toHaveBeenCalled();
        expect(service.diagnoseDeadLink).toHaveBeenCalledWith('x');
        expect(result.redirect).toEqual({
          status: 302,
          url: 'http://localhost:3001/link/x?reason=not-found',
        });
      });

      it('a successful redirect is unaffected by Accept: text/html', async () => {
        service.getByShortCode.mockResolvedValue(makeUrl());

        const result = await run(controller.redirectToOriginalUrl, {
          headers: html,
          params: { shortCode: 'aB3xK9q' },
        });

        expect(result.redirect).toEqual({ status: 302, url: 'https://example.com/' });
      });
    });
  });

  describe('getUrlMetadata', () => {
    it('returns the resource in a success envelope', async () => {
      const expired = makeUrl({ expiresAt: new Date('2026-02-01T00:00:00Z'), isActive: false });
      service.getMetadata.mockResolvedValue(expired);

      const result = await run(controller.getUrlMetadata, { user: { id: 1n }, params: { shortCode: 'aB3xK9q' } });

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
      const { error } = await run(controller.getUrlMetadata, { user: { id: 1n }, params: { shortCode: 'x' } });

      expect(error).toBeInstanceOf(RequestValidationError);
      expect(service.getMetadata).not.toHaveBeenCalled();
    });
  });

  describe('deleteUrl', () => {
    it('returns 200 with the deletion receipt', async () => {
      const deletedAt = new Date('2026-07-19T12:00:00Z');
      service.delete.mockResolvedValue(deletedAt);

      const result = await run(controller.deleteUrl, { user: { id: 1n }, params: { shortCode: 'aB3xK9q' } });

      expect(result.statusCode).toBe(200);
      expect(result.body).toEqual({
        success: true,
        data: { shortCode: 'aB3xK9q', deletedAt: '2026-07-19T12:00:00.000Z' },
      });
    });
  });
});
