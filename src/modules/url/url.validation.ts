import { z } from 'zod';
import {
  BCRYPT_MAX_PASSWORD_BYTES,
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

/** Destination URL shape, shared by create and update (reused, not duplicated). */
const originalUrlSchema = z
  .string()
  .trim()
  .max(2048, 'Must be at most 2048 characters.')
  .pipe(z.httpUrl('Must be a valid http(s) URL.'));

/**
 * POST /api/v1/urls request body (spec §2).
 * strictObject: unknown fields are rejected to keep client typos loud.
 * expiresAt accepts null as an explicit "never expires" (spec §1.6).
 */
export const createUrlBodySchema = z.strictObject({
  originalUrl: originalUrlSchema,
  customAlias: customAliasSchema.optional(),
  expiresAt: futureDatetimeSchema.nullish(),
});

/**
 * Link-gate password (spec: link editing, password protection). A lower
 * bar than account passwords (auth.validation.ts's 8-char minimum) — this
 * gates a casually-shared link, not an account, so 4 characters is a
 * reasonable floor. Shares the bcrypt byte limit because that limit is a
 * property of bcrypt, not of what the password protects.
 */
const linkPasswordSchema = z
  .string()
  .min(4, 'Must be at least 4 characters.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES, {
    error: `Must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes (bcrypt limit).`,
  });

/**
 * PATCH /api/v1/urls/:shortCode request body. Every field optional — this
 * is a partial update. `shortCode` is deliberately absent (url.types.ts:
 * a link's public identity is immutable once issued); `expiresAt` reuses
 * the exact same "must be in the future" rule as create, so scheduling an
 * expiration always means "schedule a future one" — deactivate a link
 * immediately via `isActive: false` instead, not by back-dating expiresAt.
 * `expiresAt`/`maxClicks`/`password` all accept explicit `null` to clear
 * that restriction; omitting a field leaves it unchanged.
 */
export const updateUrlBodySchema = z.strictObject({
  originalUrl: originalUrlSchema.optional(),
  expiresAt: futureDatetimeSchema.nullable().optional(),
  maxClicks: z
    .number({ error: 'Must be a number.' })
    .int('Must be an integer.')
    .positive('Must be at least 1.')
    .max(1_000_000_000, 'Must be at most 1,000,000,000.')
    .nullable()
    .optional(),
  password: linkPasswordSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

/** Path parameters for every /:shortCode and /api/v1/urls/:shortCode route. */
export const shortCodeParamsSchema = z.strictObject({
  shortCode: shortCodeSchema,
});

/**
 * GET /api/v1/urls query parameters. The cursor is `<createdAtMs>_<id>` —
 * both parts of the keyset — parsed here into typed values so the service
 * never string-splits. Non-strict object: unknown query keys are stripped.
 */
const CURSOR_PATTERN = /^(\d{1,15})_(\d{1,19})$/;

const cursorSchema = z
  .string()
  .regex(CURSOR_PATTERN, 'Malformed pagination cursor.')
  .transform((raw) => {
    const [, createdAtMs, id] = CURSOR_PATTERN.exec(raw) as RegExpExecArray;
    return { createdAt: new Date(Number(createdAtMs)), id: BigInt(id) };
  });

export const listUrlsQuerySchema = z.object({
  // Query values arrive as strings, hence coerce.
  limit: z.coerce
    .number({ error: 'Must be a number.' })
    .int('Must be an integer.')
    .min(1, 'Must be at least 1.')
    .max(100, 'Must be at most 100.')
    .default(20),
  cursor: cursorSchema.optional(),
});

/** Inferred types — what the service layer receives after validation. */
export type CreateUrlBody = z.output<typeof createUrlBodySchema>;
export type UpdateUrlBody = z.output<typeof updateUrlBodySchema>;
export type ShortCodeParams = z.output<typeof shortCodeParamsSchema>;
export type ListUrlsQuery = z.output<typeof listUrlsQuerySchema>;

/** Validate the POST /api/v1/urls request body. */
export function validateCreateUrlBody(input: unknown): ValidationResult<CreateUrlBody> {
  return validateBody(createUrlBodySchema, input);
}

/** Validate :shortCode path parameters (redirect and management routes). */
export function validateShortCodeParams(input: unknown): ValidationResult<ShortCodeParams> {
  return validateParams(shortCodeParamsSchema, input);
}

/** Validate the PATCH /api/v1/urls/:shortCode request body. */
export function validateUpdateUrlBody(input: unknown): ValidationResult<UpdateUrlBody> {
  return validateBody(updateUrlBodySchema, input);
}

/** Validate GET /api/v1/urls query parameters. */
export function validateListUrlsQuery(input: unknown): ValidationResult<ListUrlsQuery> {
  return validateQuery(listUrlsQuerySchema, input);
}
