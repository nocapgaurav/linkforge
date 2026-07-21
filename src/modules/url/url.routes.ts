import { Router } from 'express';
import { rateLimit, urlController } from '../../composition.js';
import { requireUser } from '../auth/auth.middleware.js';

/**
 * Management-plane routes, mounted at /api/v1/urls by the API router.
 * Routing only — validation lives in controllers, rules in the service.
 */
export const urlRouter = Router();

// By authenticated user — `authenticate` is mounted ahead of this router at
// /api/v1/urls, so req.user is already set by the time this runs.
const createLimit = rateLimit({
  windowSeconds: 60,
  max: 30,
  keyPrefix: 'url-create',
  keyFn: (req) => requireUser(req).id.toString(),
});

urlRouter.post('/', createLimit, urlController.createUrl);
urlRouter.get('/', urlController.listUrls);
urlRouter.get('/:shortCode', urlController.getUrlMetadata);
urlRouter.patch('/:shortCode', urlController.updateUrl);
urlRouter.delete('/:shortCode', urlController.deleteUrl);

/**
 * The public redirect plane: GET /:shortCode at the domain root.
 * Kept as its own router so app.ts can mount it AFTER the API routes —
 * otherwise paths like /api/... could be captured as short codes.
 * (Express params match a single path segment only, so multi-segment
 * paths never land here regardless; the ordering makes it explicit.)
 */
export const redirectRouter = Router();

// By IP — public, unauthenticated. Generous enough for real traffic, tight
// enough to bound both enumeration scans and password-gate brute-forcing
// (a meaningful secondary benefit: this is the same gate a would-be
// attacker guessing a link's password has to get through, on top of
// bcrypt's inherent per-guess cost).
const redirectLimit = rateLimit({
  windowSeconds: 60,
  max: 60,
  keyPrefix: 'redirect',
  keyFn: (req) => req.ip ?? 'unknown',
});

redirectRouter.get('/:shortCode', redirectLimit, urlController.redirectToOriginalUrl);
