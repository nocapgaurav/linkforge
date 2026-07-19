import type { RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { RequestValidationError } from '../../shared/http/error-handler.js';
import { created, deleted, success } from '../../shared/http/response.js';
import { UrlNotFoundError } from './url.errors.js';
import { urlService } from './url.service.js';
import type { UrlService } from './url.service.interface.js';
import type { Url } from './url.types.js';
import {
  validateCreateUrlBody,
  validateShortCodeParams,
} from './validation/url.validation.js';

/**
 * Map a domain Url to the public API resource (api-v1-spec.md §1.6).
 * Internal fields (id, urlHash, createdBy, deletedAt) are dropped,
 * clickCount becomes a JSON-safe number, dates become ISO strings.
 */
function toUrlResource(url: Url) {
  return {
    shortCode: url.shortCode,
    shortUrl: `${env.baseUrl}/${url.shortCode}`,
    originalUrl: url.originalUrl,
    isCustomAlias: url.isCustomAlias,
    isActive: url.isActive,
    clickCount: Number(url.clickCount),
    expiresAt: url.expiresAt?.toISOString() ?? null,
    createdAt: url.createdAt.toISOString(),
    updatedAt: url.updatedAt.toISOString(),
  };
}

export interface UrlController {
  createUrl: RequestHandler;
  redirectToOriginalUrl: RequestHandler;
  getUrlMetadata: RequestHandler;
  deleteUrl: RequestHandler;
}

/** Factory so tests can inject a mocked service; wiring uses the real one. */
export function createUrlController(service: UrlService): UrlController {
  return {
    /** POST /api/v1/urls */
    createUrl: asyncHandler(async (req, res) => {
      const body = validateCreateUrlBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const url = await service.create(body.data);
      created(res, toUrlResource(url), `/api/v1/urls/${url.shortCode}`);
    }),

    /** GET /:shortCode */
    redirectToOriginalUrl: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) {
        // The redirect plane never explains itself: a malformed code is a
        // plain 404, not a 400 (spec §3).
        throw new UrlNotFoundError(String(req.params.shortCode));
      }
      const url = await service.getByShortCode(params.data.shortCode);
      // 302 + no-cache so clients re-resolve every time; a cached permanent
      // redirect would bypass deactivation, expiry, and click counting.
      res.setHeader('Cache-Control', 'private, no-cache');
      res.redirect(302, url.originalUrl);
    }),

    /** GET /api/v1/urls/:shortCode */
    getUrlMetadata: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) throw new RequestValidationError(params);
      const url = await service.getMetadata(params.data.shortCode);
      success(res, toUrlResource(url));
    }),

    /** DELETE /api/v1/urls/:shortCode */
    deleteUrl: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) throw new RequestValidationError(params);
      const deletedAt = await service.delete(params.data.shortCode);
      deleted(res, { shortCode: params.data.shortCode, deletedAt: deletedAt.toISOString() });
    }),
  };
}

/** Application-wide controller wired to the real UrlService. */
export const urlController = createUrlController(urlService);
