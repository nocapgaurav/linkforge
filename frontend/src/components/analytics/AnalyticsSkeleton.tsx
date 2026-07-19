import { SummaryCardSkeleton } from '@/components/dashboard/SummaryCard';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';

function PanelSkeleton({ bodyHeight }: { bodyHeight: string }) {
  return (
    <Card className="gap-4 rounded-xl p-6">
      <div className="space-y-1.5">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-3 w-40" />
      </div>
      <Skeleton className={bodyHeight} />
    </Card>
  );
}

/** Mirrors the loaded analytics layout exactly — no layout shift, no spinners. */
export function AnalyticsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true" aria-label="Loading analytics">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <SummaryCardSkeleton key={i} />
        ))}
      </div>
      <PanelSkeleton bodyHeight="h-[280px]" />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PanelSkeleton bodyHeight="h-40" />
        <PanelSkeleton bodyHeight="h-40" />
        <PanelSkeleton bodyHeight="h-40" />
        <PanelSkeleton bodyHeight="h-40" />
      </div>
    </div>
  );
}
