import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionsCard } from '@/components/settings/SessionsCard';
import { useAuth } from '@/lib/auth/AuthProvider';

vi.mock('@/lib/auth/AuthProvider', () => ({ useAuth: vi.fn() }));
const mockedUseAuth = vi.mocked(useAuth);

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderCard() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<SessionsCard />, { wrapper });
}

describe('SessionsCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const clearSession = vi.fn();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockedUseAuth.mockReturnValue({ clearSession } as unknown as ReturnType<typeof useAuth>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    clearSession.mockClear();
  });

  it('logs out of every device and clears the local session after confirming', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { loggedOut: true } }));
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Log out of all devices' }));
    await user.click(screen.getByRole('button', { name: 'Log out everywhere' }));

    // clearSession() alone is correct here — DashboardLayout's own auth
    // gate (not this component) is what actually redirects to /login once
    // status flips to unauthenticated; see the component's doc comment.
    await waitFor(() => expect(clearSession).toHaveBeenCalled());
  });

  it('does not call the API until the confirmation dialog is confirmed', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.click(screen.getByRole('button', { name: 'Log out of all devices' }));
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(clearSession).not.toHaveBeenCalled();
  });
});
