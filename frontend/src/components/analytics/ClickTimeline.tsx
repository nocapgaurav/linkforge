'use client';

import { useMemo } from 'react';
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartCard, ChartTooltip } from '@/components/analytics/ChartCard';
import { formatBucketDate, formatCompactNumber, formatNumber } from '@/lib/format';
import type { AnalyticsRange, SeriesBucket } from '@/types/analytics';
import { RANGE_CONFIG } from '@/types/analytics';

/** Clicks-over-time line for the selected range (backend zero-fills gaps). */
export function ClickTimeline({ series, range }: { series: SeriesBucket[]; range: AnalyticsRange }) {
  const data = useMemo(
    () => series.map((bucket) => ({ ...bucket, label: formatBucketDate(bucket.date) })),
    [series],
  );
  const total = useMemo(() => series.reduce((sum, bucket) => sum + bucket.count, 0), [series]);

  return (
    <ChartCard
      title="Clicks over time"
      description={`${formatNumber(total)} clicks in the last ${RANGE_CONFIG[range].label}`}
    >
      <div role="img" aria-label={`Line chart of clicks per ${RANGE_CONFIG[range].interval} over the last ${RANGE_CONFIG[range].label}`}>
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--border)" />
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              minTickGap={32}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <YAxis
              width={36}
              tickLine={false}
              axisLine={false}
              allowDecimals={false}
              tickFormatter={(value: number) => formatCompactNumber(value)}
              tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
            />
            <Tooltip
              cursor={{ stroke: 'var(--border)' }}
              content={({ active, payload }) =>
                active && payload?.[0] ? (
                  <ChartTooltip
                    label={String(payload[0].payload.label)}
                    value={`${formatNumber(Number(payload[0].value))} clicks`}
                  />
                ) : null
              }
            />
            <Line
              type="monotone"
              dataKey="count"
              stroke="var(--chart-1)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--background)' }}
              isAnimationActive={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}
