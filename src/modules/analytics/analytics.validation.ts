import { z } from 'zod';
import { validateQuery, type ValidationResult } from '../../utils/validation.js';

/**
 * Query validation for GET /api/v1/urls/:shortCode/analytics.
 *
 * Normalizes as it validates (module convention): the service always
 * receives a fully-resolved `{from, to, interval}` — defaults applied,
 * range checked — so no caller ever re-implements the windowing rules.
 */

const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;
const DAY_MS = 86_400_000;

/** ISO-8601 datetime (Z or explicit offset), normalized to a Date. */
const isoDatetimeSchema = z.iso
  .datetime({ offset: true, error: 'Must be an ISO-8601 datetime.' })
  .transform((value) => new Date(value));

export const analyticsQuerySchema = z
  .object({
    from: isoDatetimeSchema.optional(),
    to: isoDatetimeSchema.optional(),
    interval: z
      .enum(['day', 'week', 'month'], { error: 'Must be one of: day, week, month.' })
      .default('day'),
  })
  // Defaults: last 30 days ending now. Resolved here so the range rules
  // below always run against concrete instants.
  .transform((query) => {
    const to = query.to ?? new Date();
    const from = query.from ?? new Date(to.getTime() - DEFAULT_RANGE_DAYS * DAY_MS);
    return { from, to, interval: query.interval };
  })
  .refine((query) => query.to.getTime() > query.from.getTime(), {
    error: 'Must be after "from".',
    path: ['to'],
  })
  .refine((query) => query.to.getTime() - query.from.getTime() <= MAX_RANGE_DAYS * DAY_MS, {
    error: `Range must not exceed ${MAX_RANGE_DAYS} days.`,
    path: ['to'],
  });

export type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;
export type AnalyticsInterval = AnalyticsQuery['interval'];

/** Validate analytics query parameters. */
export function validateAnalyticsQuery(input: unknown): ValidationResult<AnalyticsQuery> {
  return validateQuery(analyticsQuerySchema, input);
}
