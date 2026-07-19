import { Router } from 'express';
import { urlController } from './url.controller.js';

/**
 * Management-plane routes, mounted at /api/v1/urls by the API router.
 * Routing only — validation lives in controllers, rules in the service.
 */
export const urlRouter = Router();

urlRouter.post('/', urlController.createUrl);
urlRouter.get('/', urlController.listUrls);
urlRouter.get('/:shortCode', urlController.getUrlMetadata);
urlRouter.delete('/:shortCode', urlController.deleteUrl);

/**
 * The public redirect plane: GET /:shortCode at the domain root.
 * Kept as its own router so app.ts can mount it AFTER the API routes —
 * otherwise paths like /api/... could be captured as short codes.
 * (Express params match a single path segment only, so multi-segment
 * paths never land here regardless; the ordering makes it explicit.)
 */
export const redirectRouter = Router();

redirectRouter.get('/:shortCode', urlController.redirectToOriginalUrl);
