import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DashboardLayout } from '@/components/layout/DashboardLayout';
import { useAuth } from '@/lib/auth/AuthProvider';

/**
 * DashboardLayout doubles as the auth gate for every route it wraps
 * (dashboard, link analytics, settings) — one component to test rather
 * than one guard per page. useAuth and next/navigation are mocked so this
 * exercises exactly the gate's redirect/loading/render logic in isolation.
 */

vi.mock('@/lib/auth/AuthProvider', () => ({
  useAuth: vi.fn(),
}));

const replace = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace }),
}));

// The real Sidebar/Navbar pull in usePathname, next-themes, etc. — none of
// that is what this test is about, so stub them to keep the test focused
// on the gate itself.
vi.mock('@/components/layout/Sidebar', () => ({ Sidebar: () => <nav>sidebar</nav> }));
vi.mock('@/components/layout/Navbar', () => ({ Navbar: () => <header>navbar</header> }));

const mockedUseAuth = vi.mocked(useAuth);

describe('DashboardLayout (protected route gate)', () => {
  afterEach(() => {
    replace.mockClear();
  });

  it('renders the protected content when authenticated', () => {
    mockedUseAuth.mockReturnValue({ status: 'authenticated' } as ReturnType<typeof useAuth>);

    render(
      <DashboardLayout>
        <p>secret dashboard content</p>
      </DashboardLayout>,
    );

    expect(screen.getByText('secret dashboard content')).toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('shows a loading shell (no redirect yet) while status is still being determined', () => {
    mockedUseAuth.mockReturnValue({ status: 'loading' } as ReturnType<typeof useAuth>);

    render(
      <DashboardLayout>
        <p>secret dashboard content</p>
      </DashboardLayout>,
    );

    expect(screen.queryByText('secret dashboard content')).not.toBeInTheDocument();
    expect(replace).not.toHaveBeenCalled();
  });

  it('redirects to /login once unauthenticated is confirmed', async () => {
    mockedUseAuth.mockReturnValue({ status: 'unauthenticated' } as ReturnType<typeof useAuth>);

    render(
      <DashboardLayout>
        <p>secret dashboard content</p>
      </DashboardLayout>,
    );

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/login'));
    expect(screen.queryByText('secret dashboard content')).not.toBeInTheDocument();
  });
});
