import { render, screen } from '@testing-library/react';
import { useSearchParams } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { LinkGoneView } from '@/components/links/LinkGoneView';

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }));
const mockedUseSearchParams = vi.mocked(useSearchParams);

function setReason(query: string) {
  mockedUseSearchParams.mockReturnValue(
    new URLSearchParams(query) as unknown as ReturnType<typeof useSearchParams>,
  );
}

describe('LinkGoneView', () => {
  it.each([
    ['reason=expired', 'Link expired'],
    ['reason=deleted', 'This link no longer exists'],
    ['reason=limit-reached', 'This link has reached its maximum number of visits'],
    ['reason=not-found', 'Link not found'],
  ])('shows the right message for %s', (query, message) => {
    setReason(query);
    render(<LinkGoneView shortCode="abc123" />);

    expect(screen.getByText(message)).toBeInTheDocument();
  });

  it('defaults to "Link not found" for a missing or unrecognized reason', () => {
    setReason('');
    render(<LinkGoneView shortCode="abc123" />);
    expect(screen.getByText('Link not found')).toBeInTheDocument();

    setReason('reason=something-unexpected');
    render(<LinkGoneView shortCode="abc123" />);
    expect(screen.getAllByText('Link not found')).toHaveLength(2);
  });

  it('shows the short code for context', () => {
    setReason('reason=deleted');
    render(<LinkGoneView shortCode="abc123" />);

    expect(screen.getByText('/abc123')).toBeInTheDocument();
  });

  it('links back to the homepage', () => {
    setReason('reason=deleted');
    render(<LinkGoneView shortCode="abc123" />);

    expect(screen.getByRole('button', { name: 'Back to home' })).toHaveAttribute('href', '/');
  });
});
