'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth/AuthProvider';
import { Navbar } from '@/components/layout/Navbar';
import { Sidebar } from '@/components/layout/Sidebar';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * Application shell: fixed sidebar (desktop) or hamburger sheet (mobile),
 * top navbar, scrollable main region. Pages render inside <main>.
 *
 * Also the auth gate for every page that uses it (dashboard, link
 * analytics, settings): redirects to /login once we know for certain
 * there's no session, and shows a shell skeleton — never a spinner, same
 * rule as every other loading state in this app — while that's still
 * being determined. One change here protects every route that renders
 * through this layout; no page needs its own guard.
 */
export function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { status } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.replace('/login');
    }
  }, [status, router]);

  if (status !== 'authenticated') {
    return (
      <div className="flex min-h-svh">
        <div className="hidden w-60 shrink-0 border-r bg-background lg:block" />
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="h-14 shrink-0 border-b" />
          <main className="mx-auto w-full max-w-6xl flex-1 space-y-6 px-4 py-8 lg:px-8">
            <Skeleton className="h-9 w-48" />
            <Skeleton className="h-32 w-full rounded-xl" />
            <Skeleton className="h-64 w-full rounded-xl" />
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-svh">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <Navbar />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
