import type { Request, RequestHandler } from 'express';
import { env } from '../../config/env.js';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { RequestValidationError } from '../../shared/http/error-handler.js';
import { created, deleted, success } from '../../shared/http/response.js';
import { LinkPasswordRequiredError, UrlNotFoundError } from './url.errors.js';
import { requireUser } from '../auth/auth.middleware.js';
import { type UrlService } from './url.service.js';
import type { Url } from './url.types.js';
import {
  validateCreateUrlBody,
  validateListUrlsQuery,
  validateShortCodeParams,
  validateUpdateUrlBody,
} from './url.validation.js';

/**
 * Map a domain Url to the public API resource (api-v1-spec.md §1.6).
 * Internal fields (id, urlHash, createdBy, deletedAt, passwordHash) are
 * dropped — only `hasPassword` reveals that a password exists, never the
 * hash — clickCount becomes a JSON-safe number, dates become ISO strings.
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
    maxClicks: url.maxClicks,
    hasPassword: url.passwordHash !== null,
    createdAt: url.createdAt.toISOString(),
    updatedAt: url.updatedAt.toISOString(),
  };
}

/** Extract ?password= from the redirect query string; anything else is absent. */
function extractPassword(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

/**
 * True only when the request's Accept header explicitly names text/html —
 * a real browser's top-level navigation. Deliberately NOT Express's
 * `req.accepts()`, whose best-match algorithm returns the first candidate
 * (html, in our call) when the Accept header is absent or a wildcard —
 * exactly the shape of every existing API-client/test request (supertest, curl
 * with no -H), which must keep getting the unchanged JSON response this
 * route has always returned.
 */
function isBrowserNavigation(req: Request): boolean {
  return (req.headers?.accept ?? '').includes('text/html');
}

/**
 * Absolute frontend URL for a browser-facing redirect, or null if
 * FRONTEND_ORIGIN isn't configured (in which case callers fall back to the
 * existing JSON error — never construct a URL from an unconfigured origin).
 */
function frontendUrl(path: string): string | null {
  if (!env.frontendOrigin) return null;
  return `${env.frontendOrigin.replace(/\/+$/, '')}${path}`;
}

export interface UrlController {
  createUrl: RequestHandler;
  listUrls: RequestHandler;
  redirectToOriginalUrl: RequestHandler;
  getUrlMetadata: RequestHandler;
  updateUrl: RequestHandler;
  deleteUrl: RequestHandler;
}

/** Factory so tests can inject a mocked service; wiring uses the real one. */
export function createUrlController(service: UrlService): UrlController {
  return {
    /** POST /api/v1/urls */
    createUrl: asyncHandler(async (req, res) => {
      const body = validateCreateUrlBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const url = await service.create(body.data, requireUser(req).id);
      created(res, toUrlResource(url), `/api/v1/urls/${url.shortCode}`);
    }),

    /** GET /api/v1/urls */
    listUrls: asyncHandler(async (req, res) => {
      const query = validateListUrlsQuery(req.query);
      if (!query.success) throw new RequestValidationError(query);
      const page = await service.list(query.data, requireUser(req).id);
      success(res, {
        items: page.items.map(toUrlResource),
        pagination: { nextCursor: page.nextCursor, hasMore: page.hasMore },
      });
    }),

    /** GET /:shortCode */
    redirectToOriginalUrl: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      const shortCode = params.success ? params.data.shortCode : String(req.params.shortCode);
      const providedPassword = extractPassword(req.query.password);

      try {
        if (!params.success) {
          // The redirect plane never explains itself: a malformed code is a
          // plain 404, not a 400 (spec §3).
          throw new UrlNotFoundError(shortCode);
        }
        const url = await service.getByShortCode(shortCode, providedPassword);
        // 302 + no-cache so clients re-resolve every time; a cached permanent
        // redirect would bypass deactivation, expiry, and click counting.
        res.setHeader('Cache-Control', 'private, no-cache');
        res.redirect(302, url.originalUrl);
      } catch (error) {
        // Browser-facing pages instead of a raw JSON body, for the two
        // failure families a real user can hit. The JSON contract for every
        // other caller (API clients, tests, curl) is completely unchanged —
        // see isBrowserNavigation's doc comment for why that's safe, and
        // diagnoseDeadLink's doc comment for why this doesn't touch the
        // anti-enumeration property of the JSON API itself.
        if (isBrowserNavigation(req)) {
          if (error instanceof LinkPasswordRequiredError) {
            const target = frontendUrl(
              `/unlock/${encodeURIComponent(shortCode)}${providedPassword ? '?error=1' : ''}`,
            );
            if (target) {
              res.redirect(302, target);
              return;
            }
          }
          if (error instanceof UrlNotFoundError) {
            const reason = await service.diagnoseDeadLink(shortCode);
            const target = frontendUrl(`/link/${encodeURIComponent(shortCode)}?reason=${reason}`);
            if (target) {
              res.redirect(302, target);
              return;
            }
          }
        }
        throw error;
      }
    }),

    /** GET /api/v1/urls/:shortCode */
    getUrlMetadata: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) throw new RequestValidationError(params);
      const url = await service.getMetadata(params.data.shortCode, requireUser(req).id);
      success(res, toUrlResource(url));
    }),

    /** PATCH /api/v1/urls/:shortCode */
    updateUrl: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) throw new RequestValidationError(params);
      const body = validateUpdateUrlBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const url = await service.update(params.data.shortCode, body.data, requireUser(req).id);
      success(res, toUrlResource(url));
    }),

    /** DELETE /api/v1/urls/:shortCode */
    deleteUrl: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) throw new RequestValidationError(params);
      const deletedAt = await service.delete(params.data.shortCode, requireUser(req).id);
      deleted(res, { shortCode: params.data.shortCode, deletedAt: deletedAt.toISOString() });
    }),
  };
}
