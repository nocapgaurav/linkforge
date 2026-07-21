import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import LoginPage from '@/app/login/page';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

/**
 * LoginPage: pure UI/form concern. useAuth is mocked so the test controls
 * exactly what `login()` does with its callbacks — the mutation's own
 * behavior (tokens, state) is AuthProvider's test file's job, not this one's.
 */

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

const push = vi.fn();
const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace }),
}));

const mockedUseAuth = vi.mocked(useAuth);

function baseAuth(overrides: Partial<ReturnType<typeof useAuth>> = {}) {
  return {
    user: null,
    status: 'unauthenticated',
    login: vi.fn(),
    register: vi.fn(),
    logout: vi.fn(),
    isLoggingIn: false,
    isRegistering: false,
    ...overrides,
  } as ReturnType<typeof useAuth>;
}

describe('LoginPage', () => {
  it('rejects an invalid email inline without calling login', async () => {
    const login = vi.fn();
    mockedUseAuth.mockReturnValue(baseAuth({ login }));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'not-an-email');
    await user.type(screen.getByLabelText('Password'), 'whatever');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Must be a valid email address.')).toBeInTheDocument();
    expect(login).not.toHaveBeenCalled();
  });

  it('submits valid credentials and redirects to /dashboard on success', async () => {
    const login = vi.fn((_input, options) => options?.onSuccess?.());
    mockedUseAuth.mockReturnValue(baseAuth({ login }));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'correct-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(login).toHaveBeenCalledWith(
      { email: 'a@b.com', password: 'correct-password' },
      expect.anything(),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
  });

  it('shows one generic message for INVALID_CREDENTIALS, attached to neither field', async () => {
    const login = vi.fn((_input, options) =>
      options?.onError?.(new ApiError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.')),
    );
    mockedUseAuth.mockReturnValue(baseAuth({ login }));
    const user = userEvent.setup();
    render(<LoginPage />);

    await user.type(screen.getByLabelText('Email'), 'a@b.com');
    await user.type(screen.getByLabelText('Password'), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Log in' }));

    expect(await screen.findByText('Incorrect email or password.')).toBeInTheDocument();
    // Neither field is individually flagged — only the form-level alert is shown.
    expect(screen.getByLabelText('Email')).not.toHaveAttribute('aria-invalid');
    expect(screen.getByLabelText('Password')).not.toHaveAttribute('aria-invalid');
  });

  it('disables the submit button while the login mutation is pending', () => {
    mockedUseAuth.mockReturnValue(baseAuth({ isLoggingIn: true }));
    render(<LoginPage />);

    expect(screen.getByRole('button', { name: 'Logging in…' })).toBeDisabled();
  });

  it('redirects to /dashboard immediately if already authenticated', async () => {
    mockedUseAuth.mockReturnValue(baseAuth({ status: 'authenticated' }));
    render(<LoginPage />);

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/dashboard'));
  });
});
