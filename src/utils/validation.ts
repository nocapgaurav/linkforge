import type { z } from 'zod';

/**
 * Generic request-validation helpers.
 *
 * Module-agnostic on purpose: every module (URL, and later Auth, Teams,
 * API Keys, Analytics) defines its own Zod schemas and funnels them through
 * these helpers so validation failures always match the public API error
 * contract (docs/api-v1-spec.md §1.3) without any per-module formatting code.
 *
 * This module knows nothing about Express, Prisma, or any domain — it maps
 * (schema, unknown input) to a structured result, nothing more.
 */

/** One invalid field, matching the API contract's `error.details[]` entries. */
export interface ValidationIssue {
  field: string;
  message: string;
}

/**
 * bcrypt only hashes the first 72 BYTES of input; accepting longer
 * passwords would silently ignore the tail, so every bcrypt-backed
 * password field rejects them instead. A genuine shared technical
 * constraint (not a business rule), so both account passwords
 * (auth.validation.ts) and link passwords (url.validation.ts) reference
 * this one constant rather than each hardcoding it.
 */
export const BCRYPT_MAX_PASSWORD_BYTES = 72;

/** Validation failure in the exact shape of the public API error envelope. */
export interface ValidationFailure {
  success: false;
  error: {
    code: 'VALIDATION_ERROR';
    message: string;
    details: ValidationIssue[];
  };
}

/** Discriminated union callers can narrow with `if (!result.success)`. */
export type ValidationResult<T> = { success: true; data: T } | ValidationFailure;

function toResult<S extends z.ZodType>(
  schema: S,
  input: unknown,
  message: string,
): ValidationResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (parsed.success) {
    return { success: true, data: parsed.data };
  }
  return {
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message,
      details: parsed.error.issues.map((issue) => ({
        // Root-level issues (e.g. "body is not an object") have an empty path.
        field: issue.path.map(String).join('.') || '(root)',
        message: issue.message,
      })),
    },
  };
}

/** Validate a JSON request body against a schema. */
export function validateBody<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ValidationResult<z.output<S>> {
  return toResult(schema, input, 'Invalid request body.');
}

/** Validate route path parameters against a schema. */
export function validateParams<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ValidationResult<z.output<S>> {
  return toResult(schema, input, 'Invalid path parameters.');
}

/** Validate query-string parameters against a schema. */
export function validateQuery<S extends z.ZodType>(
  schema: S,
  input: unknown,
): ValidationResult<z.output<S>> {
  return toResult(schema, input, 'Invalid query parameters.');
}
