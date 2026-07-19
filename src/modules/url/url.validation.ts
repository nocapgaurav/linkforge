import { z } from 'zod';
import {
  validateBody,
  validateParams,
  validateQuery,
  type ValidationResult,
} from '../../utils/validation.js';

/**
 * Zod schemas and one-call validators for the URL module's v1 API surface
 * (docs/api-v1-spec.md).
 *
 * Pure validation: no Prisma, no repository, no framework imports. Schemas
 * transform raw wire input (JSON body, path params, query strings) into
 * typed, normalized values for the service layer. The validate* functions
 * are the single entry point controllers use — on failure the returned
 * `error` is already in the public API envelope shape and can be serialized
 * as-is with a 400 status.
 */

/** Short-code shape shared by generated codes and custom aliases (spec §3). */
export const SHORT_CODE_PATTERN = /^[A-Za-z0-9_-]{3,32}$/;

/**
 * Path segments that can never be aliases because they collide with real or
 * planned top-level routes. Checked case-insensitively even though aliases
 * are case-sensitive: `API` must be rejected alongside `api`, since some
 * clients and proxies normalize path case.
 */
const RESERVED_ALIASES = new Set([
  'api',
  'health',
  'docs',
  'admin',
  'assets',
  'static',
  'app',
  'www',
]);

export const shortCodeSchema = z
  .string()
  .regex(
    SHORT_CODE_PATTERN,
    'Must be 3-32 characters using only letters, digits, "-" and "_".',
  );

const customAliasSchema = shortCodeSchema.refine(
  (alias) => !RESERVED_ALIASES.has(alias.toLowerCase()),
  'This alias is reserved.',
);

/** ISO-8601 datetime (Z or explicit offset), normalized to a Date. */
const isoDatetimeSchema = z.iso
  .datetime({ offset: true, error: 'Must be an ISO-8601 datetime.' })
  .transform((value) => new Date(value));

/** Expiry must be strictly in the future at validation time. */
const futureDatetimeSchema = isoDatetimeSchema.refine(
  (date) => date.getTime() > Date.now(),
  'Must be in the future.',
);

/**
 * POST /api/v1/urls request body (spec §2).
 * strictObject: unknown fields are rejected to keep client typos loud.
 * expiresAt accepts null as an explicit "never expires" (spec §1.6).
 */
export const createUrlBodySchema = z.strictObject({
  originalUrl: z
    .string()
    .trim()
    .max(2048, 'Must be at most 2048 characters.')
    .pipe(z.httpUrl('Must be a valid http(s) URL.')),
  customAlias: customAliasSchema.optional(),
  expiresAt: futureDatetimeSchema.nullish(),
});

/** Path parameters for every /:shortCode and /api/v1/urls/:shortCode route. */
export const shortCodeParamsSchema = z.strictObject({
  shortCode: shortCodeSchema,
});

/**
 * GET /api/v1/urls/:shortCode/analytics query parameters (spec §7).
 * Plain (non-strict) object: unknown query keys are stripped, not rejected —
 * shared links accumulate stray tracking params and those must never 400.
 * `from` has no default here; it defaults to the link's createdAt, which
 * only the service layer knows.
 */
export const analyticsQuerySchema = z
  .object({
    from: isoDatetimeSchema.optional(),
    to: isoDatetimeSchema.optional(),
    interval: z
      .enum(['hour', 'day', 'week', 'month'], {
        error: 'Must be one of: hour, day, week, month.',
      })
      .default('day'),
    // Query values arrive as strings, hence coerce.
    limit: z.coerce
      .number({ error: 'Must be a number.' })
      .int('Must be an integer.')
      .min(1, 'Must be at least 1.')
      .max(100, 'Must be at most 100.')
      .default(10),
  })
  .refine((query) => !query.from || !query.to || query.to.getTime() > query.from.getTime(), {
    error: 'Must be after "from".',
    path: ['to'],
  });

/** Inferred types — what the service layer receives after validation. */
export type CreateUrlBody = z.output<typeof createUrlBodySchema>;
export type ShortCodeParams = z.output<typeof shortCodeParamsSchema>;
export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;

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
