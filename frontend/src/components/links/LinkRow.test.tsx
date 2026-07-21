import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { LinkCard, LinkRow } from '@/components/links/LinkRow';
import { Table, TableBody } from '@/components/ui/table';
import type { Link } from '@/types/link';

/**
 * linkStatus()'s precedence mirrors the backend's own redirect gate order
 * (isActive → expiry → click-limit), so this covers each status alone and
 * the precedence when more than one condition applies at once. LinkCard
 * (mobile) is used for most cases since it needs no table wrapper; one
 * LinkRow (desktop) case confirms both renderings share the same logic.
 */

function makeLink(overrides: Partial<Link> = {}): Link {
  return {
    shortCode: 'abc123',
    shortUrl: 'http://localhost:3000/abc123',
    originalUrl: 'https://example.com',
    isCustomAlias: false,
    isActive: true,
    clickCount: 0,
    expiresAt: null,
    maxClicks: null,
    hasPassword: false,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function wrapper({ children }: { children: ReactNode }) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}

function renderCard(link: Link) {
  return render(<LinkCard link={link} />, { wrapper });
}

describe('link status badge', () => {
  it('shows "Active" for a live, unexpired, under-limit link', () => {
    renderCard(makeLink());
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('shows "Disabled" for a manually deactivated link', () => {
    renderCard(makeLink({ isActive: false }));
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('shows "Expired" for a link past its expiresAt', () => {
    renderCard(makeLink({ expiresAt: '2020-01-01T00:00:00.000Z' }));
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('shows "Click Limit Reached" once clickCount reaches maxClicks', () => {
    renderCard(makeLink({ maxClicks: 5, clickCount: 5 }));
    expect(screen.getByText('Click Limit Reached')).toBeInTheDocument();
  });

  it('does not show "Click Limit Reached" while still under the limit', () => {
    renderCard(makeLink({ maxClicks: 5, clickCount: 4 }));
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('prioritizes "Disabled" over expiry and click-limit (matches the backend gate order)', () => {
    renderCard(
      makeLink({
        isActive: false,
        expiresAt: '2020-01-01T00:00:00.000Z',
        maxClicks: 1,
        clickCount: 1,
      }),
    );
    expect(screen.getByText('Disabled')).toBeInTheDocument();
  });

  it('prioritizes "Expired" over click-limit', () => {
    renderCard(
      makeLink({ expiresAt: '2020-01-01T00:00:00.000Z', maxClicks: 1, clickCount: 1 }),
    );
    expect(screen.getByText('Expired')).toBeInTheDocument();
  });

  it('LinkRow (desktop table) shows the same status as LinkCard', () => {
    render(
      <Table>
        <TableBody>
          <LinkRow link={makeLink({ maxClicks: 3, clickCount: 3 })} />
        </TableBody>
      </Table>,
      { wrapper },
    );
    expect(screen.getByText('Click Limit Reached')).toBeInTheDocument();
  });
});
