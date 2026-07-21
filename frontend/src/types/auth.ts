/**
 * Wire types for the auth endpoints (docs/api-v1-spec.md §11), mirrored
 * exactly — same convention as types/link.ts and types/analytics.ts.
 */

/** The user resource: internal id and password hash are never exposed. */
export interface PublicUser {
  email: string;
  displayName: string;
  emailVerifiedAt: string | null;
  createdAt: string;
}

/** Shape returned by both register and login — tokens plus the profile. */
export interface AuthResponse {
  user: PublicUser;
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

/** Shape returned by refresh — no user profile; a separate /auth/me call gets that. */
export interface RefreshResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface RegisterInput {
  email: string;
  displayName: string;
  password: string;
}

export interface LoginInput {
  email: string;
  password: string;
}

/** PATCH /api/v1/auth/me request body. */
export interface UpdateProfileInput {
  displayName: string;
}

/** PATCH /api/v1/auth/password request body. */
export interface ChangePasswordInput {
  currentPassword: string;
  newPassword: string;
}
