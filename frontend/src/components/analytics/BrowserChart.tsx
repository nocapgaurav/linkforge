'use client';

import { useMemo } from 'react';
import { BreakdownBar } from '@/components/analytics/BreakdownBar';
import { ChartCard } from '@/components/analytics/ChartCard';
import { capitalize } from '@/lib/format';
import type { LinkAnalytics } from '@/types/analytics';

/** Top browsers by clicks in the selected range. */
export function BrowserChart({ browsers }: { browsers: LinkAnalytics['browsers'] }) {
  const data = useMemo(
    () => browsers.map(({ browser, count }) => ({ label: capitalize(browser), count })),
    [browsers],
  );

  return (
    <ChartCard title="Browsers" description="What visitors click with">
      <BreakdownBar data={data} ariaLabel="Bar chart of clicks by browser" />
    </ChartCard>
  );
}
