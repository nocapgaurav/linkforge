import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useSearchParams } from 'next/navigation';
import { describe, expect, it, vi } from 'vitest';
import { UnlockLinkView } from '@/components/links/UnlockLinkView';

/**
 * The submission itself is a plain HTML GET form to the existing redirect
 * endpoint (see the component's doc comment) — not something this test can
 * observe end to end in jsdom, so it's covered instead by the backend's
 * redirect-browser-experience integration test. This file covers the UI:
 * the error/no-error branch and the submitting state.
 */

vi.mock('next/navigation', () => ({ useSearchParams: vi.fn() }));
const mockedUseSearchParams = vi.mocked(useSearchParams);

describe('UnlockLinkView', () => {
  it('shows the plain password prompt with no error message when ?error is absent', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    render(<UnlockLinkView shortCode="abc123" />);

    expect(screen.getByText('Password required')).toBeInTheDocument();
    expect(screen.queryByText('Incorrect password.')).not.toBeInTheDocument();
  });

  it('shows "Incorrect password." when ?error is present', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams('error=1') as unknown as ReturnType<typeof useSearchParams>,
    );
    render(<UnlockLinkView shortCode="abc123" />);

    expect(screen.getByText('Incorrect password.')).toBeInTheDocument();
  });

  it('submits as a plain GET form to the short URL, not a fetch call', () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    render(<UnlockLinkView shortCode="abc123" />);

    const form = screen.getByLabelText('Password').closest('form');
    expect(form).toHaveAttribute('method', 'GET');
    expect(form).toHaveAttribute('action', 'http://localhost:3000/abc123');
  });

  it('shows a submitting state once the form is submitted', async () => {
    mockedUseSearchParams.mockReturnValue(
      new URLSearchParams() as unknown as ReturnType<typeof useSearchParams>,
    );
    const user = userEvent.setup();
    render(<UnlockLinkView shortCode="abc123" />);

    await user.type(screen.getByLabelText('Password'), 'anything');
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('button', { name: 'Checking…' })).toBeDisabled();
  });
});
