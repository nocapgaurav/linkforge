import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import RegisterPage from '@/app/register/page';
import { ApiError } from '@/lib/api/client';
import { useAuth } from '@/lib/auth/AuthProvider';

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

describe('RegisterPage', () => {
  it('rejects a too-short password inline without calling register', async () => {
    const register = vi.fn();
    mockedUseAuth.mockReturnValue(baseAuth({ register }));
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'short');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Must be at least 8 characters.')).toBeInTheDocument();
    expect(register).not.toHaveBeenCalled();
  });

  it('submits valid input and redirects to /dashboard on success', async () => {
    const register = vi.fn((_input, options) => options?.onSuccess?.());
    mockedUseAuth.mockReturnValue(baseAuth({ register }));
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText('Name'), 'Ada Lovelace');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(register).toHaveBeenCalledWith(
      { email: 'ada@example.com', displayName: 'Ada Lovelace', password: 'a-strong-password' },
      expect.anything(),
    );
    await waitFor(() => expect(push).toHaveBeenCalledWith('/dashboard'));
  });

  it('attaches EMAIL_TAKEN to the email field specifically', async () => {
    const register = vi.fn((_input, options) =>
      options?.onError?.(
        new ApiError(409, 'EMAIL_TAKEN', 'An account with this email already exists.'),
      ),
    );
    mockedUseAuth.mockReturnValue(baseAuth({ register }));
    const user = userEvent.setup();
    render(<RegisterPage />);

    await user.type(screen.getByLabelText('Name'), 'Ada');
    await user.type(screen.getByLabelText('Email'), 'ada@example.com');
    await user.type(screen.getByLabelText('Password'), 'a-strong-password');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('This email is already registered.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
  });

  it('disables the submit button while the register mutation is pending', () => {
    mockedUseAuth.mockReturnValue(baseAuth({ isRegistering: true }));
    render(<RegisterPage />);

    expect(screen.getByRole('button', { name: 'Creating account…' })).toBeDisabled();
  });
});
