/**
 * Token persistence — the ONE place tokens are read from or written to.
 * No React, no fetch: a plain module shared by the API client (which
 * attaches headers and drives refresh) and AuthProvider (which mirrors
 * state into React context). Neither layer touches storage directly.
 *
 * Storage split is deliberate:
 * - Access token: held in memory only (a module-level variable). It never
 *   touches localStorage, so it does not survive a full page reload —
 *   which is fine, since it's short-lived (15 min) and AuthProvider mints
 *   a fresh one on every app boot via the refresh token (see
 *   AuthProvider's session-restoration effect).
 * - Refresh token: persisted in localStorage. It's the one credential that
 *   must survive a reload for "stay logged in" to work at all. The
 *   backend already designed this token to rotate on every use and to be
 *   server-side revocable, which bounds the exposure of persisting it
 *   client-side (see docs/api-v1-spec.md §11 and the auth design notes —
 *   tokens travel in JSON, not cookies, a deliberate backend decision this
 *   frontend works with rather than around).
 */

const REFRESH_TOKEN_KEY = 'linkforge.refreshToken';

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null; // SSR guard
  return window.localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null): void {
  if (typeof window === 'undefined') return;
  if (token === null) {
    window.localStorage.removeItem(REFRESH_TOKEN_KEY);
  } else {
    window.localStorage.setItem(REFRESH_TOKEN_KEY, token);
  }
}

/** Clears both tokens — the client-side half of "the session is over." */
export function clearTokens(): void {
  setAccessToken(null);
  setRefreshToken(null);
}
