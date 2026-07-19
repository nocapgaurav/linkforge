import {
  validateBody,
  validateParams,
  validateQuery,
  type ValidationResult,
} from '../../../utils/validation.js';
import {
  analyticsQuerySchema,
  createUrlBodySchema,
  shortCodeParamsSchema,
  type AnalyticsQuery,
  type CreateUrlBody,
  type ShortCodeParams,
} from './url.schema.js';

/**
 * One-call validators for the URL module — the single entry point future
 * controllers use. Each returns a discriminated result: on failure, `error`
 * is already in the public API envelope shape and can be serialized as-is
 * with a 400 status.
 */

/** Validate the POST /api/v1/urls request body. */
export function validateCreateUrlBody(input: unknown): ValidationResult<CreateUrlBody> {
  return validateBody(createUrlBodySchema, input);
}

/** Validate :shortCode path parameters (redirect and management routes). */
export function validateShortCodeParams(input: unknown): ValidationResult<ShortCodeParams> {
  return validateParams(shortCodeParamsSchema, input);
}

/** Validate analytics query parameters (endpoint ships post-v1; spec §7). */
export function validateAnalyticsQuery(input: unknown): ValidationResult<AnalyticsQuery> {
  return validateQuery(analyticsQuerySchema, input);
}

export type { AnalyticsQuery, CreateUrlBody, ShortCodeParams };
