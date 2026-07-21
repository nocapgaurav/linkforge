import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EditLinkDialog } from '@/components/links/EditLinkDialog';
import type { Link } from '@/types/link';

/**
 * Covers the PATCH payload the dialog actually builds — the load-bearing
 * part is that a blank password field omits `password` entirely (leaving
 * it unchanged server-side, since the backend never returns the real
 * value to prefill), while the "remove password protection" switch is the
 * only path that sends an explicit `password: null`.
 */

const link: Link = {
  shortCode: 'abc123',
  shortUrl: 'http://localhost:3000/abc123',
  originalUrl: 'https://example.com',
  isCustomAlias: false,
  isActive: true,
  clickCount: 10,
  expiresAt: null,
  maxClicks: 100,
  hasPassword: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function renderDialog(target: Link = link) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }
  return render(<EditLinkDialog link={target} />, { wrapper });
}

describe('EditLinkDialog', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('prefills existing values and omits password from the request when left blank', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: link }));

    renderDialog();
    await user.click(screen.getByRole('button', { name: `Edit link ${link.shortCode}` }));

    const urlInput = await screen.findByLabelText('Original URL');
    expect(urlInput).toHaveValue(link.originalUrl);
    expect(screen.getByLabelText(/click limit/i)).toHaveValue('100');

    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain(`/urls/${link.shortCode}`);
    expect(init.method).toBe('PATCH');
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ originalUrl: link.originalUrl, maxClicks: 100, isActive: true });
    expect(body).not.toHaveProperty('password');

    // Dialog closes on success.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument(),
    );
  });

  it('sends password: null when "Remove password protection" is toggled on', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: link }));

    renderDialog();
    await user.click(screen.getByRole('button', { name: `Edit link ${link.shortCode}` }));
    await screen.findByLabelText('Original URL');

    await user.click(screen.getByRole('switch', { name: /remove password protection/i }));
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.password).toBeNull();
  });

  it('sets a new password verbatim when typed (not "remove")', async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(jsonResponse(200, { success: true, data: link }));

    renderDialog();
    await user.click(screen.getByRole('button', { name: `Edit link ${link.shortCode}` }));
    await user.type(await screen.findByLabelText(/change password/i), 'new-secret');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.password).toBe('new-secret');
  });

  it('blocks submission and shows an error when the URL is invalid', async () => {
    const user = userEvent.setup();

    renderDialog();
    await user.click(screen.getByRole('button', { name: `Edit link ${link.shortCode}` }));

    const urlInput = await screen.findByLabelText('Original URL');
    await user.clear(urlInput);
    await user.type(urlInput, 'not-a-url');
    await user.click(screen.getByRole('button', { name: /save changes/i }));

    expect(await screen.findByText(/must be a valid http\(s\) url/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
