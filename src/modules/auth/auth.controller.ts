import type { RequestHandler } from 'express';
import { asyncHandler } from '../../shared/http/async-handler.js';
import { RequestValidationError } from '../../shared/http/error-handler.js';
import { success } from '../../shared/http/response.js';
import type { User } from '../user/user.types.js';
import { requireUser } from './auth.middleware.js';
import type { AuthService } from './auth.service.js';
import {
  validateChangePasswordBody,
  validateLoginBody,
  validateRegisterBody,
  validateSessionTokenBody,
  validateUpdateProfileBody,
} from './auth.validation.js';

/**
 * Map a domain User to the public resource. Internal id and passwordHash
 * never leave the server (same doctrine as toUrlResource).
 */
function toUserResource(user: User) {
  return {
    email: user.email,
    displayName: user.displayName,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    createdAt: user.createdAt.toISOString(),
  };
}

export interface AuthController {
  register: RequestHandler;
  login: RequestHandler;
  refresh: RequestHandler;
  logout: RequestHandler;
  me: RequestHandler;
  updateProfile: RequestHandler;
  changePassword: RequestHandler;
  logoutAll: RequestHandler;
  deleteAccount: RequestHandler;
}

/** Factory so tests can inject a mocked service; wiring lives in composition. */
export function createAuthController(service: AuthService): AuthController {
  return {
    /** POST /api/v1/auth/register */
    register: asyncHandler(async (req, res) => {
      const body = validateRegisterBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const result = await service.register(body.data);
      success(res, { user: toUserResource(result.user), ...result.tokens }, 201);
    }),

    /** POST /api/v1/auth/login */
    login: asyncHandler(async (req, res) => {
      const body = validateLoginBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const result = await service.login(body.data);
      success(res, { user: toUserResource(result.user), ...result.tokens });
    }),

    /** POST /api/v1/auth/refresh */
    refresh: asyncHandler(async (req, res) => {
      const body = validateSessionTokenBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const tokens = await service.refresh(body.data.refreshToken);
      success(res, tokens);
    }),

    /** POST /api/v1/auth/logout */
    logout: asyncHandler(async (req, res) => {
      const body = validateSessionTokenBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      await service.logout(body.data.refreshToken);
      success(res, { loggedOut: true });
    }),

    /** GET /api/v1/auth/me (behind authenticate) */
    me: asyncHandler(async (req, res) => {
      const user = await service.getUser(requireUser(req).id);
      success(res, { user: toUserResource(user) });
    }),

    /** PATCH /api/v1/auth/me (behind authenticate) */
    updateProfile: asyncHandler(async (req, res) => {
      const body = validateUpdateProfileBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      const user = await service.updateDisplayName(requireUser(req).id, body.data.displayName);
      success(res, { user: toUserResource(user) });
    }),

    /** PATCH /api/v1/auth/password (behind authenticate) */
    changePassword: asyncHandler(async (req, res) => {
      const body = validateChangePasswordBody(req.body);
      if (!body.success) throw new RequestValidationError(body);
      await service.changePassword(requireUser(req).id, body.data);
      success(res, { changed: true });
    }),

    /** POST /api/v1/auth/logout-all (behind authenticate) */
    logoutAll: asyncHandler(async (req, res) => {
      await service.logoutAll(requireUser(req).id);
      success(res, { loggedOut: true });
    }),

    /** DELETE /api/v1/auth/me (behind authenticate) */
    deleteAccount: asyncHandler(async (req, res) => {
      await service.deleteAccount(requireUser(req).id);
      success(res, { deleted: true });
    }),
  };
}
