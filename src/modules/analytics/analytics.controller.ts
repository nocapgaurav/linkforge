import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { RequestValidationError } from '../../shared/http/error-handler.js';
import { success } from '../../shared/http/response.js';
import { requireUser } from '../auth/auth.middleware.js';
import { validateShortCodeParams } from '../url/url.validation.js';
import type { AnalyticsService } from './analytics.service.js';
import { validateAnalyticsQuery } from './analytics.validation.js';

export interface AnalyticsController {
  getUrlAnalytics: RequestHandler;
}

/** Factory so tests can inject a mocked service; wiring uses the real one. */
export function createAnalyticsController(service: AnalyticsService): AnalyticsController {
  return {
    /** GET /api/v1/urls/:shortCode/analytics */
    getUrlAnalytics: asyncHandler(async (req, res) => {
      const params = validateShortCodeParams(req.params);
      if (!params.success) throw new RequestValidationError(params);
      const query = validateAnalyticsQuery(req.query);
      if (!query.success) throw new RequestValidationError(query);
      const analytics = await service.getUrlAnalytics(
        params.data.shortCode,
        query.data,
        requireUser(req).id,
      );
      success(res, analytics);
    }),
  };
}
