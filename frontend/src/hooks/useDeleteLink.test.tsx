import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDeleteLink } from '@/hooks/useDeleteLink';
import { linksQueryKey } from '@/hooks/useLinks';

/**
 * Deletion must invalidate both the links list and this link's analytics —
 * every range variant, since useLinkAnalytics caches per (shortCode, range)
 * pair under ['analytics', shortCode, range]. A sibling link's analytics
 * must stay untouched.
 */
function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('useDeleteLink', () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let queryClient: QueryClient;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  }

  it('invalidates the links list and every cached analytics range for the deleted link only', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(200, {
        success: true,
        data: { shortCode: 'abc123', deletedAt: new Date(0).toISOString() },
      }),
    );

    queryClient.setQueryData(linksQueryKey, { pages: [], pageParams: [] });
    queryClient.setQueryData(['analytics', 'abc123', '7d'], { summary: {} });
    queryClient.setQueryData(['analytics', 'abc123', '30d'], { summary: {} });
    queryClient.setQueryData(['analytics', 'other-code', '7d'], { summary: {} });

    const { result } = renderHook(() => useDeleteLink(), { wrapper });
    result.current.mutate('abc123');
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(queryClient.getQueryState(linksQueryKey)?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['analytics', 'abc123', '7d'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['analytics', 'abc123', '30d'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['analytics', 'other-code', '7d'])?.isInvalidated).toBe(
      false,
    );
  });
});
