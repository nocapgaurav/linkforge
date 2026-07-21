import { clearTokens, getAccessToken, getRefreshToken, setAccessToken, setRefreshToken } from '@/lib/auth/token-storage';
import type { ApiEnvelope, ApiFieldError } from '@/types/api';
import type { RefreshResponse } from '@/types/auth';

/**
 * Typed wrapper around the LinkForge REST API.
 *
 * The backend wraps every response in a `{success, data|error}` envelope;
 * this client unwraps it so callers deal in plain typed payloads and one
 * error class. All failure modes — network failures, non-JSON bodies,
 * HTTP errors, `success: false` envelopes — surface as ApiError, so
 * feature hooks never need their own response plumbing.
 *
 * Also owns the whole auth-refresh lifecycle for every request: attaching
 * the access token, detecting an expired one, refreshing exactly once
 * (shared across concurrent callers — see refreshSession), retrying the
 * original request, and reporting a dead session upward. Components and
 * hooks never see any of this; they just call api.get/post/delete/patch.
 */

const BASE_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3000/api/v1').replace(
  /\/+$/,
  '',
);

export class ApiError extends Error {
  /** HTTP status; 0 when the request never reached the server. */
  readonly status: number;
  /** Machine-readable code from the API's error registry (spec §6). */
  readonly code: string;
  /** Per-field validation errors, when the API provided them. */
  readonly details: ApiFieldError[];

  constructor(status: number, code: string, message: string, details: ApiFieldError[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Normalize an unknown thrown value into an ApiError for display. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  return new ApiError(0, 'UNKNOWN_ERROR', 'Something went wrong. Please try again.');
}

/**
 * The raw call: attach whatever access token we currently hold, fetch,
 * unwrap the envelope, throw ApiError on any failure. No refresh/retry
 * logic here — `request()` below is the only thing allowed to catch and
 * react to what this throws, so refresh handling exists in exactly one
 * place.
 */
async function performRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  const accessToken = getAccessToken();
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Could not reach the LinkForge API.');
  }

  const envelope = (await response.json().catch(() => null)) as ApiEnvelope<T> | null;

  if (envelope === null) {
    throw new ApiError(
      response.status,
      'INVALID_RESPONSE',
      'The API returned a response that was not valid JSON.',
    );
  }
  if (!response.ok || !envelope.success) {
    const error = envelope.success ? undefined : envelope.error;
    throw new ApiError(
      response.status,
      error?.code ?? 'UNKNOWN_ERROR',
      error?.message ?? `Request failed with status ${response.status}.`,
      error?.details ?? [],
    );
  }
  return envelope.data;
}

/**
 * Registered once by AuthProvider on mount. Called when a session turns
 * out to be unrecoverable (refresh failed) so React state can clear and
 * the user can be routed to /login — the one seam between this
 * framework-free module and the React auth layer.
 */
type SessionExpiredHandler = () => void;
let onSessionExpired: SessionExpiredHandler | null = null;

export function setSessionExpiredHandler(handler: SessionExpiredHandler | null): void {
  onSessionExpired = handler;
}

/**
 * Cross-tab mutual exclusion name for refreshSession(). Every tab of this
 * origin requests the SAME named lock, so the browser serializes their
 * critical sections — see refreshSession() for why this matters beyond
 * same-tab deduplication.
 */
const REFRESH_LOCK_NAME = 'linkforge-refresh-session';

/**
 * The actual refresh: read whatever refresh token is CURRENTLY stored,
 * exchange it, store the rotated result. Deliberately reads
 * getRefreshToken() at call time, not before — see refreshSession()'s
 * cross-tab reasoning for why that timing is load-bearing.
 */
async function performRefresh(): Promise<boolean> {
  const refreshToken = getRefreshToken();
  if (!refreshToken) return false;
  try {
    const data = await performRequest<RefreshResponse>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    });
    setAccessToken(data.accessToken);
    setRefreshToken(data.refreshToken); // rotation: the old token is now dead
    return true;
  } catch {
    return false;
  }
}

/**
 * Shared in-flight refresh, so concurrent 401s (several hooks all
 * discovering an expired token near-simultaneously) await the SAME call
 * instead of each firing their own. This isn't just an efficiency nicety:
 * the backend rotates the refresh token on every use and treats presenting
 * an already-rotated-away token as theft, revoking every session for that
 * user. Two independent refresh calls racing on the same stored token
 * would trip exactly that, logging a legitimate user out.
 *
 * `refreshPromise` alone only dedupes calls WITHIN one tab — it's a
 * module-level variable, and two browser tabs are two separate module
 * instances with no shared state. Two tabs whose access tokens expire
 * within the same round-trip window can each independently read the same
 * not-yet-rotated refresh token and both call the backend, and the loser
 * gets flagged as replaying an already-rotated token — theft detection
 * revoking a legitimate session (confirmed live: two truly concurrent
 * `curl` calls with the same token reproduce exactly this).
 *
 * The fix is the Web Locks API (`navigator.locks`), which every modern
 * browser shares across all tabs of one origin: wrap performRefresh() in
 * a named lock so sibling tabs' attempts serialize instead of racing. No
 * "did someone else already refresh?" branch is needed — performRefresh()
 * already reads getRefreshToken() as its first step, and because that read
 * now happens INSIDE the lock's exclusive section, whichever tab's turn
 * it is always sees whatever is currently stored: either the original
 * token (first refresh) or the sibling's already-rotated one (second
 * tab's turn) — never a stale copy. Each tab still performs its own
 * network round trip (one extra call per additional open tab, only once
 * per ~15-minute token lifetime), trading a little redundancy for
 * correctness — the theft check never sees a superseded token from a
 * legitimate client again.
 *
 * Older browsers without `navigator.locks` (pre-2022 roughly) fall back to
 * the same-tab-only guard — the original race remains possible there, but
 * degrades no worse than before this fix.
 *
 * AuthProvider's boot-time session restoration calls this exact function
 * too — there is only ever one refresh code path in the whole app.
 */
let refreshPromise: Promise<boolean> | null = null;

export function refreshSession(): Promise<boolean> {
  if (!refreshPromise) {
    const hasWebLocks = typeof navigator !== 'undefined' && 'locks' in navigator;
    refreshPromise = (
      hasWebLocks
        ? // lib.dom.d.ts types LockGrantedCallback<T>'s return as exactly T,
          // not `T | PromiseLike<T>`, so an async callback infers
          // T = Promise<boolean> and request() appears to return
          // Promise<Promise<boolean>> — a type-only gap (the Web Locks
          // spec itself awaits a returned promise before resolving). The
          // trailing .then(r => r) flattens it back to Promise<boolean>
          // using Promise#then's own (correct) PromiseLike unwrapping.
          navigator.locks.request(REFRESH_LOCK_NAME, () => performRefresh()).then((r) => r)
        : performRefresh()
    ).finally(() => {
      refreshPromise = null; // a future 401 can trigger a fresh attempt
    });
  }
  return refreshPromise;
}

/**
 * Endpoints that must never trigger a refresh-and-retry on 401:
 * - register/login 401s are credential problems (INVALID_CREDENTIALS),
 *   never a token-expiry problem — there is no token yet to refresh.
 * - refresh/logout are refresh's own machinery; retrying them through the
 *   same mechanism they'd be reacting to is circular.
 */
const REFRESH_EXEMPT_PATHS = ['/auth/register', '/auth/login', '/auth/refresh', '/auth/logout'];

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  try {
    return await performRequest<T>(path, init);
  } catch (error) {
    const isExpiredToken = error instanceof ApiError && error.code === 'UNAUTHORIZED';
    const exempt = REFRESH_EXEMPT_PATHS.some((p) => path.startsWith(p));
    if (!isExpiredToken || exempt) {
      throw error;
    }

    const refreshed = await refreshSession();
    if (!refreshed) {
      clearTokens();
      onSessionExpired?.();
      throw error;
    }
    return performRequest<T>(path, init); // retry exactly once, with the fresh token
  }
}

export const api = {
  get<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'GET' });
  },
  post<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
  },
  patch<T>(path: string, body: unknown): Promise<T> {
    return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
  },
  delete<T>(path: string): Promise<T> {
    return request<T>(path, { method: 'DELETE' });
  },
};
