'use client';

import { AlertCircle, RotateCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

/** Friendly failure state — no raw backend messages, always a way forward. */
export function AnalyticsError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-20 text-center">
      <span className="flex size-10 items-center justify-center rounded-lg border bg-muted text-muted-foreground">
        <AlertCircle className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold">Couldn&apos;t load analytics</h2>
        <p className="text-sm text-muted-foreground">
          Something went wrong while fetching data for this link.
        </p>
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="size-4" aria-hidden="true" />
        Retry
      </Button>
    </div>
  );
}
