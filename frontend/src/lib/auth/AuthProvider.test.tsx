import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from '@/lib/auth/AuthProvider';
import { clearTokens, getAccessToken, getRefreshToken, setRefreshToken } from '@/lib/auth/token-storage';

/**
 * AuthProvider: session restoration on boot, login/register updating
 * shared state, and logout. Renders the real provider around a tiny probe
 * component (no Next.js router involved here — that's DashboardLayout's
 * concern) and drives it through @testing-library/react + a mocked fetch.
 */

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
const ok = <T,>(data: T) => jsonResponse(200, { success: true, data });
const unauthorized = () =>
  jsonResponse(401, { success: false, error: { code: 'UNAUTHORIZED', message: 'nope' } });

function Probe() {
  const { user, status, login, register, logout } = useAuth();
  return (
    <div>
      <p data-testid="status">{status}</p>
      <p data-testid="email">{user?.email ?? 'none'}</p>
      <button onClick={() => login({ email: 'a@b.com', password: 'secret123' })}>login</button>
      <button
        onClick={() => register({ email: 'a@b.com', displayName: 'A', password: 'secret123' })}
      >
        register
      </button>
      <button onClick={() => void logout()}>logout</button>
    </div>
  );
}

function renderProbe() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <Probe />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe('AuthProvider', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    clearTokens();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('session restoration on boot', () => {
    it('goes straight to unauthenticated when no refresh token is stored', async () => {
      renderProbe();

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('restores the session via refresh + /auth/me when a refresh token exists', async () => {
      setRefreshToken('stored-refresh-token');
      fetchMock
        .mockResolvedValueOnce(
          ok({ accessToken: 'restored-access', refreshToken: 'rotated-refresh', expiresIn: 900 }),
        )
        .mockResolvedValueOnce(
          ok({ user: { email: 'restored@example.com', displayName: 'R', emailVerifiedAt: null, createdAt: '2026-01-01T00:00:00Z' } }),
        );

      renderProbe();

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
      expect(screen.getByTestId('email')).toHaveTextContent('restored@example.com');
      expect(getAccessToken()).toBe('restored-access');
      expect(getRefreshToken()).toBe('rotated-refresh'); // rotation happened on restore too
    });

    it('lands on unauthenticated and clears storage when the stored refresh token is dead', async () => {
      setRefreshToken('dead-refresh-token');
      fetchMock.mockResolvedValueOnce(unauthorized());

      renderProbe();

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
      expect(getRefreshToken()).toBeNull();
    });
  });

  describe('login', () => {
    it('authenticates and stores tokens on success', async () => {
      fetchMock.mockResolvedValueOnce(
        ok({
          user: { email: 'a@b.com', displayName: 'A', emailVerifiedAt: null, createdAt: '2026-01-01T00:00:00Z' },
          accessToken: 'login-access',
          refreshToken: 'login-refresh',
          expiresIn: 900,
        }),
      );
      const user = userEvent.setup();
      renderProbe();
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

      await user.click(screen.getByText('login'));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
      expect(screen.getByTestId('email')).toHaveTextContent('a@b.com');
      expect(getAccessToken()).toBe('login-access');
      expect(getRefreshToken()).toBe('login-refresh');
    });
  });

  describe('register', () => {
    it('authenticates and stores tokens on success', async () => {
      fetchMock.mockResolvedValueOnce(
        ok({
          user: { email: 'a@b.com', displayName: 'A', emailVerifiedAt: null, createdAt: '2026-01-01T00:00:00Z' },
          accessToken: 'register-access',
          refreshToken: 'register-refresh',
          expiresIn: 900,
        }),
      );
      const user = userEvent.setup();
      renderProbe();
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));

      await user.click(screen.getByText('register'));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));
      expect(getAccessToken()).toBe('register-access');
    });
  });

  describe('logout', () => {
    it('clears tokens and state, and still logs out even if the server call fails', async () => {
      setRefreshToken('a-refresh-token');
      fetchMock
        .mockResolvedValueOnce(ok({ accessToken: 'a', refreshToken: 'a-refresh-token', expiresIn: 900 }))
        .mockResolvedValueOnce(
          ok({ user: { email: 'a@b.com', displayName: 'A', emailVerifiedAt: null, createdAt: '2026-01-01T00:00:00Z' } }),
        )
        .mockRejectedValueOnce(new Error('network blip')); // the logout call itself fails

      const user = userEvent.setup();
      renderProbe();
      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('authenticated'));

      await user.click(screen.getByText('logout'));

      await waitFor(() => expect(screen.getByTestId('status')).toHaveTextContent('unauthenticated'));
      expect(screen.getByTestId('email')).toHaveTextContent('none');
      expect(getAccessToken()).toBeNull();
      expect(getRefreshToken()).toBeNull();
    });
  });
});
