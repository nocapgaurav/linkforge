import { z } from 'zod';
import {
  BCRYPT_MAX_PASSWORD_BYTES,
  validateBody,
  type ValidationResult,
} from '../../utils/validation.js';

/**
 * Zod schemas for the auth endpoints. Module convention: schemas normalize
 * as they validate (emails arrive lowercased and trimmed at the service).
 */

const emailSchema = z
  .email({ error: 'Must be a valid email address.' })
  .trim()
  .toLowerCase()
  .max(255, 'Must be at most 255 characters.');

const passwordSchema = z
  .string()
  .min(8, 'Must be at least 8 characters.')
  .refine((value) => Buffer.byteLength(value, 'utf8') <= BCRYPT_MAX_PASSWORD_BYTES, {
    error: `Must be at most ${BCRYPT_MAX_PASSWORD_BYTES} bytes (bcrypt limit).`,
  });

const displayNameSchema = z
  .string()
  .trim()
  .min(1, 'Must not be empty.')
  .max(80, 'Must be at most 80 characters.');

export const registerBodySchema = z.strictObject({
  email: emailSchema,
  displayName: displayNameSchema,
  password: passwordSchema,
});

export const loginBodySchema = z.strictObject({
  email: emailSchema,
  // Existence checks only — the stored hash decides, not length rules.
  password: z.string().min(1, 'Must not be empty.'),
});

/** Shared by refresh and logout: the opaque session token. */
export const sessionTokenBodySchema = z.strictObject({
  refreshToken: z.string().min(1, 'Must not be empty.'),
});

/** PATCH /api/v1/auth/me — profile update (display name only, spec's Task 4). */
export const updateProfileBodySchema = z.strictObject({
  displayName: displayNameSchema,
});

/** PATCH /api/v1/auth/password — change password. */
export const changePasswordBodySchema = z.strictObject({
  currentPassword: z.string().min(1, 'Must not be empty.'),
  newPassword: passwordSchema,
});

export type RegisterBody = z.output<typeof registerBodySchema>;
export type LoginBody = z.output<typeof loginBodySchema>;
export type SessionTokenBody = z.output<typeof sessionTokenBodySchema>;
export type UpdateProfileBody = z.output<typeof updateProfileBodySchema>;
export type ChangePasswordBody = z.output<typeof changePasswordBodySchema>;

export function validateRegisterBody(input: unknown): ValidationResult<RegisterBody> {
  return validateBody(registerBodySchema, input);
}

export function validateLoginBody(input: unknown): ValidationResult<LoginBody> {
  return validateBody(loginBodySchema, input);
}

export function validateSessionTokenBody(input: unknown): ValidationResult<SessionTokenBody> {
  return validateBody(sessionTokenBodySchema, input);
}

export function validateUpdateProfileBody(input: unknown): ValidationResult<UpdateProfileBody> {
  return validateBody(updateProfileBodySchema, input);
}

export function validateChangePasswordBody(
  input: unknown,
): ValidationResult<ChangePasswordBody> {
  return validateBody(changePasswordBodySchema, input);
}
