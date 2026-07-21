'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/**
 * Friendly failure state — no raw backend messages, always accurate.
 *
 * `notFound` distinguishes "this link doesn't resolve" (deleted, wrong
 * owner, never existed — a 404, per the anti-enumeration doctrine that
 * treats every dead state uniformly) from a genuinely transient failure
 * (network blip, 500). Retrying a 404 can never succeed, so it's hidden
 * there; a transient failure keeps its Retry.
 */
export function AnalyticsError({
  onRetry,
  notFound = false,
}: {
  onRetry: () => void;
  notFound?: boolean;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <AlertCircle className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">
          {notFound ? 'This link no longer exists.' : "Couldn't load analytics"}
        </h2>
        {!notFound && (
          <p className="text-sm text-muted-foreground">
            Something went wrong while fetching data for this link.
          </p>
        )}
      </div>
      {!notFound && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          <RotateCw className="size-4" aria-hidden="true" />
          Retry
        </Button>
      )}
    </div>
  );
}
