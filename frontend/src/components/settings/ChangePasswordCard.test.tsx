import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ChangePasswordCard } from '@/components/settings/ChangePasswordCard';

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
  return render(<ChangePasswordCard />, { wrapper });
}

describe('ChangePasswordCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('changes the password and resets the form on success', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: { changed: true } }));
    renderCard();

    await user.type(screen.getByLabelText('Current password'), 'old-password');
    await user.type(screen.getByLabelText('New password'), 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveValue(''));
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({
      currentPassword: 'old-password',
      newPassword: 'a-new-strong-password',
    });
  });

  it('flags the current-password field for INVALID_CREDENTIALS', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(401, {
        success: false,
        error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password.' },
      }),
    );
    renderCard();

    await user.type(screen.getByLabelText('Current password'), 'wrong-password');
    await user.type(screen.getByLabelText('New password'), 'a-new-strong-password');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Incorrect password.')).toBeInTheDocument();
  });

  it('rejects a too-short new password without calling the API', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.type(screen.getByLabelText('Current password'), 'old-password');
    await user.type(screen.getByLabelText('New password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Change password' }));

    expect(await screen.findByText('Must be at least 8 characters.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
