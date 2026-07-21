import { api } from '@/lib/api/client';
import type {
  AuthResponse,
  ChangePasswordInput,
  LoginInput,
  PublicUser,
  RegisterInput,
  UpdateProfileInput,
} from '@/types/auth';

/**
 * Auth endpoints, typed end to end. Pure request functions — no token
 * storage, no React, no redirects: that's AuthProvider's job. Mirrors
 * lib/api/links.ts's shape exactly.
 *
 * Deliberately NOT included here: a `refresh` function. Refreshing must
 * always go through client.ts's `refreshSession()`, the one place that
 * guarantees concurrent callers share a single in-flight refresh — the
 * backend rotates the refresh token on every use and treats a replayed
 * (already-rotated-away) token as theft, revoking the whole session. A
 * second, independent "just POST /auth/refresh" helper here would let two
 * callers (e.g. this module's caller and the API client's own 401
 * interceptor) race and trip that theft detection for a legitimate user.
 */

export function registerUser(input: RegisterInput): Promise<AuthResponse> {
  return api.post<AuthResponse>('/auth/register', input);
}

export function loginUser(input: LoginInput): Promise<AuthResponse> {
  return api.post<AuthResponse>('/auth/login', input);
}

export function logoutSession(refreshToken: string): Promise<{ loggedOut: boolean }> {
  return api.post('/auth/logout', { refreshToken });
}

export function getCurrentUser(): Promise<{ user: PublicUser }> {
  return api.get('/auth/me');
}

export function updateProfile(input: UpdateProfileInput): Promise<{ user: PublicUser }> {
  return api.patch('/auth/me', input);
}

export function changePassword(input: ChangePasswordInput): Promise<{ changed: boolean }> {
  return api.patch('/auth/password', input);
}

export function logoutAllSessions(): Promise<{ loggedOut: boolean }> {
  return api.post('/auth/logout-all', {});
}

export function deleteAccount(): Promise<{ deleted: boolean }> {
  return api.delete('/auth/me');
}
