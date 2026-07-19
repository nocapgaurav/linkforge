'use client';

import { useEffect, useState } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/**
 * Shared shell for every analytics panel: consistent padding/typography and
 * a gentle 200ms fade-in once content mounts (charts never pop in).
 */
export function ChartCard({
  title,
  description,
  children,
  className,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  return (
    <Card className={cn('gap-4 rounded-xl p-6', className)}>
      <div className="space-y-0.5">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      </div>
      <div
        className={cn(
          'transition-opacity duration-200',
          mounted ? 'opacity-100' : 'opacity-0',
        )}
      >
        {children}
      </div>
    </Card>
  );
}

/** Polished tooltip body shared by all Recharts tooltips. */
export function ChartTooltip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border bg-popover px-2.5 py-1.5 text-xs text-popover-foreground shadow-sm">
      <p className="font-medium">{label}</p>
      <p className="text-muted-foreground">{value}</p>
    </div>
  );
}

/** Muted in-panel message for panels with no rows in range. */
export function ChartEmptyNote({ children }: { children: string }) {
  return (
    <p className="flex h-24 items-center justify-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}
