import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, setSessionExpiredHandler } from '@/lib/api/client';
import {
  clearTokens,
  getAccessToken,
  getRefreshToken,
  setAccessToken,
  setRefreshToken,
} from '@/lib/auth/token-storage';

/**
 * The API client's auth interceptor: header attachment, expired-token
 * detection, single shared refresh, retry-once, and session-death
 * reporting. `fetch` is mocked directly (no MSW) so exact request
 * sequencing — the property that actually matters here — is easy to
 * assert precisely, consistent with how the backend suite prefers plain
 * mocks over heavier tooling.
 *
 * Static imports throughout (no vi.resetModules): the access token lives
 * in a module-level variable, so resetting modules mid-file would split
 * it across separate instances. clearTokens()/setSessionExpiredHandler(null)
 * in beforeEach/afterEach give clean isolation without that hazard.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

const ok = <T>(data: T) => jsonResponse(200, { success: true, data });
const unauthorized = () =>
  jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'nope' } });
const invalidCredentials = () =>
  jsonResponse(401, { success: false, error: { code: 'INVALID_CREDENTIALS', message: 'nope' } });

describe('api client', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTokens();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    setSessionExpiredHandler(null);
    vi.unstubAllGlobals();
  });

  it('attaches the Authorization header when an access token is set', async () => {
    setAccessToken('token-123');
    fetchMock.mockResolvedValue(ok({ hello: 'world' }));

    await api.get('/urls');

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token-123');
  });

  it('sends no Authorization header when there is no access token', async () => {
    fetchMock.mockResolvedValue(ok({ hello: 'world' }));

    await api.get('/urls');

    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers as Record<string, string>).not.toHaveProperty('Authorization');
  });

  it('does not attempt a refresh for INVALID_CREDENTIALS (login) even though it is a 401', async () => {
    setRefreshToken('some-refresh-token');
    fetchMock.mockResolvedValue(invalidCredentials());

    await expect(
      api.post('/auth/login', { email: 'a@b.com', password: 'x' }),
    ).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh attempt, no retry
  });

  it('on UNAUTHORIZED, refreshes once and retries the original request', async () => {
    setRefreshToken('old-refresh-token');
    fetchMock
      .mockResolvedValueOnce(unauthorized()) // original request
      .mockResolvedValueOnce(
        ok({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }),
      ) // refresh
      .mockResolvedValueOnce(ok({ items: [] })); // retried original request

    const result = await api.get('/urls');

    expect(result).toEqual({ items: [] });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1][0]).toContain('/auth/refresh');
    // Rotation: the new refresh token replaced the old one, and the retried
    // request used the newly-issued access token.
    expect(getRefreshToken()).toBe('new-refresh');
    expect(getAccessToken()).toBe('new-access');
    const retryInit = fetchMock.mock.calls[2][1];
    expect((retryInit.headers as Record<string, string>).Authorization).toBe('Bearer new-access');
  });

  it('concurrent 401s share exactly one refresh call, not one per request', async () => {
    setRefreshToken('old-refresh-token');
    // Every non-refresh path 401s the first time it's seen, then succeeds —
    // simulating "several hooks discover the expired token at once, each
    // gets retried after the one shared refresh completes."
    const seen = new Set<string>();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes('/auth/refresh')) {
        return Promise.resolve(
          ok({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }),
        );
      }
      if (seen.has(url)) return Promise.resolve(ok({ ok: true }));
      seen.add(url);
      return Promise.resolve(unauthorized());
    });

    const results = await Promise.all([
      api.get('/urls'),
      api.get('/urls/abc'),
      api.get('/urls/def'),
    ]);

    expect(results).toEqual([{ ok: true }, { ok: true }, { ok: true }]);
    const refreshCalls = fetchMock.mock.calls.filter(([url]) => url.includes('/auth/refresh'));
    expect(refreshCalls).toHaveLength(1);
  });

  it('clears tokens and reports session death when refresh itself fails', async () => {
    setRefreshToken('old-refresh-token');
    const onExpired = vi.fn();
    setSessionExpiredHandler(onExpired);
    fetchMock
      .mockResolvedValueOnce(unauthorized()) // original request
      .mockResolvedValueOnce(unauthorized()); // refresh attempt fails too

    await expect(api.get('/urls')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });

    expect(onExpired).toHaveBeenCalledTimes(1);
    expect(getRefreshToken()).toBeNull();
    expect(getAccessToken()).toBeNull();
  });

  it('never attempts a refresh when there is no stored refresh token at all', async () => {
    // clearTokens() in beforeEach already ensures none is set.
    fetchMock.mockResolvedValueOnce(unauthorized());

    await expect(api.get('/urls')).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(fetchMock).toHaveBeenCalledTimes(1); // no refresh call attempted
  });

  describe('cross-tab refresh coordination (Web Locks)', () => {
    afterEach(() => {
      delete (navigator as unknown as { locks?: unknown }).locks;
    });

    it('serializes refresh through navigator.locks under the shared lock name when available', async () => {
      setRefreshToken('old-refresh-token');
      const request = vi.fn((_name: string, callback: () => Promise<boolean>) => callback());
      Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });

      fetchMock
        .mockResolvedValueOnce(unauthorized()) // original request
        .mockResolvedValueOnce(
          ok({ accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 }),
        ) // refresh
        .mockResolvedValueOnce(ok({ items: [] })); // retried original request

      // Regression guard: LockManager.request's TS types don't unwrap a
      // Promise-returning callback (see client.ts), which previously broke
      // the build. Asserting a plain, non-thenable boolean here (not a
      // Promise) proves the .then(r => r) flatten actually works at runtime.
      const result = await api.get('/urls');

      expect(result).toEqual({ items: [] });
      expect(request).toHaveBeenCalledTimes(1);
      expect(request.mock.calls[0]?.[0]).toBe('linkforge-refresh-session');
      expect(getRefreshToken()).toBe('new-refresh');
      expect(getAccessToken()).toBe('new-access');
    });

    it('reads the refresh token inside the lock callback, not before acquiring it', async () => {
      // Simulates the two-tab race: by the time this tab's callback actually
      // runs, a sibling tab has already rotated the token. Reading
      // getRefreshToken() inside the callback (not before navigator.locks.request
      // is called) means this tab sees the rotated value, not a stale one.
      setRefreshToken('token-before-lock-acquired');
      const request = vi.fn(async (_name: string, callback: () => Promise<boolean>) => {
        setRefreshToken('rotated-by-other-tab');
        return callback();
      });
      Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });

      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes('/auth/refresh')) {
          const body = JSON.parse(init?.body as string) as { refreshToken: string };
          expect(body.refreshToken).toBe('rotated-by-other-tab');
          return Promise.resolve(
            ok({ accessToken: 'new-access', refreshToken: 'final-refresh', expiresIn: 900 }),
          );
        }
        return Promise.resolve(unauthorized());
      });
      fetchMock.mockResolvedValueOnce(unauthorized()); // original request 401s first

      await api.get('/urls').catch(() => {}); // retry also 401s in this mock; only the refresh call matters here

      expect(getRefreshToken()).toBe('final-refresh');
    });
  });
});
