import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileCard } from '@/components/settings/ProfileCard';
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
  return render(<ProfileCard />, { wrapper });
}

describe('ProfileCard', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const updateUser = vi.fn();

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    mockedUseAuth.mockReturnValue({
      user: { email: 'a@b.com', displayName: 'Ada', emailVerifiedAt: null, createdAt: '' },
      updateUser,
    } as unknown as ReturnType<typeof useAuth>);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    updateUser.mockClear();
  });

  it('prefills the current display name', () => {
    renderCard();
    expect(screen.getByLabelText('Display name')).toHaveValue('Ada');
  });

  it('saves a new display name and syncs it into AuthProvider', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { user: { email: 'a@b.com', displayName: 'Ada Lovelace', emailVerifiedAt: null, createdAt: '' } },
      }),
    );
    renderCard();

    await user.clear(screen.getByLabelText('Display name'));
    await user.type(screen.getByLabelText('Display name'), 'Ada Lovelace');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ displayName: 'Ada Lovelace' }),
      ),
    );
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string)).toEqual({ displayName: 'Ada Lovelace' });
  });

  it('rejects an empty display name without calling the API', async () => {
    const user = userEvent.setup();
    renderCard();

    await user.clear(screen.getByLabelText('Display name'));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Must not be empty.')).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
