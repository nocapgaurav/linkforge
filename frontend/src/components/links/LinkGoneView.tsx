'use client';

import { AlertCircle, Ban, Clock, MousePointerClick, type LucideIcon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';

/**
 * The four dead-link messages this task asked for. The backend diagnoses
 * WHICH of these applies only to pick this page's `?reason=`; the JSON API
 * itself stays a uniform 404 for every one of these cases (unchanged
 * anti-enumeration behavior for API/programmatic callers).
 */
const REASONS: Record<string, { icon: LucideIcon; message: string }> = {
  expired: { icon: Clock, message: 'Link expired' },
  deleted: { icon: Ban, message: 'This link no longer exists' },
  'limit-reached': {
    icon: MousePointerClick,
    message: 'This link has reached its maximum number of visits',
  },
  'not-found': { icon: AlertCircle, message: 'Link not found' },
};

export function LinkGoneView({ shortCode }: { shortCode: string }) {
  const searchParams = useSearchParams();
  const reason = REASONS[searchParams.get('reason') ?? ''] ?? REASONS['not-found'];
  const Icon = reason.icon;

  return (
    <main className="flex min-h-svh flex-col items-center justify-center gap-4 px-4 text-center">
      <span className="flex size-12 items-center justify-center rounded-full border bg-muted text-muted-foreground">
        <Icon className="size-5" aria-hidden="true" />
      </span>
      <h1 className="text-2xl font-semibold tracking-tight">{reason.message}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        <span className="font-mono">/{shortCode}</span> is not available.
      </p>
      <Button render={<Link href="/" />} nativeButton={false} variant="outline">
        Back to home
      </Button>
    </main>
  );
}
