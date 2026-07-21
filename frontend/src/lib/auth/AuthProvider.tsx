'use client';

import { useMutation } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { getCurrentUser, loginUser, logoutSession, registerUser } from '@/lib/api/auth';
import { refreshSession, setSessionExpiredHandler } from '@/lib/api/client';
import { clearTokens, getRefreshToken, setAccessToken, setRefreshToken } from '@/lib/auth/token-storage';
import type { AuthResponse, LoginInput, PublicUser, RegisterInput } from '@/types/auth';

/**
 * The single authentication layer: every other file in the app learns who
 * is logged in, and changes that, only through useAuth(). No component
 * touches tokens, localStorage, or the auth endpoints directly — that
 * discipline is what keeps auth logic from scattering.
 *
 * `status` has three states, not a boolean, because "we don't know yet"
 * (checking a stored refresh token on boot) is a real, distinct state from
 * "definitely logged out" — collapsing them would either flash a login
 * form before a valid session restores, or flash protected content before
 * we've confirmed there's a reason to show it.
 */
type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated';

interface AuthContextValue {
  user: PublicUser | null;
  status: AuthStatus;
  login: (input: LoginInput, options?: MutationCallbacks) => void;
  register: (input: RegisterInput, options?: MutationCallbacks) => void;
  logout: () => Promise<void>;
  /** Sync a freshly-updated profile into local state (e.g. Settings saving a new display name). */
  updateUser: (user: PublicUser) => void;
  /**
   * Clear the local session without calling the network logout endpoint —
   * for flows where the server-side session is already gone (Settings'
   * "log out everywhere" and "delete account"), so callers don't
   * redundantly revoke a session that's already dead.
   */
  clearSession: () => void;
  isLoggingIn: boolean;
  isRegistering: boolean;
}

interface MutationCallbacks {
  onSuccess?: () => void;
  onError?: (error: unknown) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/** Shared by login/register success: land the response in state + storage. */
function applySession(
  data: AuthResponse,
  setUser: (user: PublicUser) => void,
  setStatus: (status: AuthStatus) => void,
): void {
  setAccessToken(data.accessToken);
  setRefreshToken(data.refreshToken);
  setUser(data.user);
  setStatus('authenticated');
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<PublicUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  // Session restoration: on every fresh page load the access token is gone
  // (it was never persisted — see token-storage.ts), but a stored refresh
  // token can mint a new one. Goes through the SAME refreshSession() the
  // API client's 401 interceptor uses — one refresh code path, no race
  // between "app boot" and "a request happened to 401 at the same time."
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!getRefreshToken()) {
        setStatus('unauthenticated');
        return;
      }
      const refreshed = await refreshSession();
      if (cancelled) return;
      if (!refreshed) {
        clearTokens();
        setStatus('unauthenticated');
        return;
      }
      try {
        const { user: restoredUser } = await getCurrentUser();
        if (cancelled) return;
        setUser(restoredUser);
        setStatus('authenticated');
      } catch {
        if (cancelled) return;
        clearTokens();
        setStatus('unauthenticated');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The API client's escape hatch for "a request's refresh attempt failed
  // mid-session" — reacts exactly like an explicit logout.
  useEffect(() => {
    setSessionExpiredHandler(() => {
      setUser(null);
      setStatus('unauthenticated');
    });
    return () => setSessionExpiredHandler(null);
  }, []);

  const loginMutation = useMutation({
    mutationFn: loginUser,
    onSuccess: (data) => applySession(data, setUser, setStatus),
  });
  const registerMutation = useMutation({
    mutationFn: registerUser,
    onSuccess: (data) => applySession(data, setUser, setStatus),
  });

  const clearSession = useCallback(() => {
    clearTokens();
    setUser(null);
    setStatus('unauthenticated');
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = getRefreshToken();
    if (refreshToken) {
      // Best-effort: the session is over client-side regardless of whether
      // the server-side revocation call itself succeeds.
      await logoutSession(refreshToken).catch(() => undefined);
    }
    clearSession();
  }, [clearSession]);

  const value: AuthContextValue = {
    user,
    status,
    login: (input, options) => loginMutation.mutate(input, options),
    register: (input, options) => registerMutation.mutate(input, options),
    logout,
    updateUser: setUser,
    clearSession,
    isLoggingIn: loginMutation.isPending,
    isRegistering: registerMutation.isPending,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider.');
  }
  return context;
}
