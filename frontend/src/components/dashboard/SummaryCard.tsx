import type { LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

/**
 * One metric card: icon, title, primary number, contextual subtitle.
 * Shared by the dashboard stats row and the analytics overview.
 */
export function SummaryCard({
  icon: Icon,
  title,
  value,
  subtitle,
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <Card className="h-full gap-2 rounded-xl p-6 transition-[box-shadow,border-color] duration-150 hover:border-foreground/20 hover:shadow-sm">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="size-4" aria-hidden="true" />
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <p className="text-3xl font-semibold tracking-tight tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{subtitle}</p>
    </Card>
  );
}

/** Loading twin with identical geometry — zero layout shift on arrival. */
export function SummaryCardSkeleton() {
  return (
    <Card className="h-full gap-2 rounded-xl p-6">
      <div className="flex items-center gap-2">
        <Skeleton className="size-4 rounded" />
        <Skeleton className="h-4 w-20" />
      </div>
      <Skeleton className="h-9 w-16" />
      <Skeleton className="h-3 w-32" />
    </Card>
  );
}
