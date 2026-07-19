'use client';

import { useMemo } from 'react';
import { BreakdownBar } from '@/components/analytics/BreakdownBar';
import { ChartCard } from '@/components/analytics/ChartCard';
import { formatCountry } from '@/lib/format';
import type { LinkAnalytics } from '@/types/analytics';

/** Top countries by clicks in the selected range. */
export function CountryChart({ countries }: { countries: LinkAnalytics['countries'] }) {
  const data = useMemo(
    () => countries.map(({ country, count }) => ({ label: formatCountry(country), count })),
    [countries],
  );

  return (
    <ChartCard title="Countries" description="Where clicks come from">
      <BreakdownBar data={data} ariaLabel="Bar chart of clicks by country" />
    </ChartCard>
  );
}
