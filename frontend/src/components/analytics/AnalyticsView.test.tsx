import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsView } from '@/components/analytics/AnalyticsView';
import { useLinkAnalytics } from '@/hooks/useLinkAnalytics';
import { ApiError } from '@/lib/api/client';

/**
 * Only the error-branching logic is under test here — a deleted/missing
 * link (404) must read as "gone" with no Retry (retrying a 404 can never
 * succeed), while a genuine transient failure keeps the old "couldn't
 * load" + Retry copy. useLinkAnalytics and next/navigation are mocked so
 * this exercises exactly that branch, not the real query/routing stack.
 */

vi.mock('@/hooks/useLinkAnalytics', () => ({ useLinkAnalytics: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

const mockedUseLinkAnalytics = vi.mocked(useLinkAnalytics);

describe('AnalyticsView error states', () => {
  afterEach(() => {
    mockedUseLinkAnalytics.mockReset();
  });

  it('shows "This link no longer exists." with no Retry button on a 404', () => {
    mockedUseLinkAnalytics.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(404, 'NOT_FOUND', 'Not found.'),
      data: undefined,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLinkAnalytics>);

    render(<AnalyticsView shortCode="deadcode" />);

    expect(screen.getByText('This link no longer exists.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry/i })).not.toBeInTheDocument();
  });

  it("shows \"Couldn't load analytics\" with a Retry button on a transient failure", () => {
    mockedUseLinkAnalytics.mockReturnValue({
      isPending: false,
      isError: true,
      error: new ApiError(0, 'NETWORK_ERROR', 'Could not reach the LinkForge API.'),
      data: undefined,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useLinkAnalytics>);

    render(<AnalyticsView shortCode="abc123" />);

    expect(screen.getByText("Couldn't load analytics")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });
});
