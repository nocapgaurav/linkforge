'use client';

import { useMemo } from 'react';
import { ChartCard, ChartEmptyNote } from '@/components/analytics/ChartCard';
import { formatNumber } from '@/lib/format';
import type { LinkAnalytics } from '@/types/analytics';

/**
 * Compact ranked list — a table-shaped fact, not a chart. The thin
 * proportional bar underneath each row supports scanning without turning
 * hostnames into a color exercise.
 */
export function ReferrerList({ referrers }: { referrers: LinkAnalytics['referrers'] }) {
  const rows = useMemo(() => {
    const max = referrers[0]?.count ?? 0;
    return referrers.map((referrer, index) => ({
      ...referrer,
      rank: index + 1,
      share: max > 0 ? referrer.count / max : 0,
    }));
  }, [referrers]);

  return (
    <ChartCard title="Referrers" description="Traffic sources (direct visits excluded)">
      {rows.length === 0 ? (
        <ChartEmptyNote>No referrer data in this range yet.</ChartEmptyNote>
      ) : (
        <ol className="space-y-3">
          {rows.map((row) => (
            <li key={row.referrerHost} className="space-y-1">
              <div className="flex items-baseline gap-2 text-sm">
                <span className="w-5 text-xs tabular-nums text-muted-foreground">
                  {row.rank}
                </span>
                <span className="flex-1 truncate font-mono text-[13px]" title={row.referrerHost}>
                  {row.referrerHost}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(row.count)}
                </span>
              </div>
              <div className="ml-7 h-1 overflow-hidden rounded-full bg-muted" aria-hidden="true">
                <div
                  className="h-full rounded-full"
                  style={{ width: `${row.share * 100}%`, backgroundColor: 'var(--chart-1)' }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </ChartCard>
  );
}
