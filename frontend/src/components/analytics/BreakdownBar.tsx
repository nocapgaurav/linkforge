'use client';

import { useMemo } from 'react';
import {
  Bar,
  BarChart,
  Cell,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { ChartEmptyNote, ChartTooltip } from '@/components/analytics/ChartCard';
import { formatNumber } from '@/lib/format';

export interface BreakdownDatum {
  label: string;
  count: number;
}

const ROW_HEIGHT = 34;

/**
 * Single-measure horizontal bar chart (one hue — identity lives in the row
 * labels, so a categorical rainbow would be noise). Shared by the country
 * and browser panels.
 */
export function BreakdownBar({ data, ariaLabel }: { data: BreakdownDatum[]; ariaLabel: string }) {
  const height = useMemo(() => Math.max(data.length * ROW_HEIGHT + 8, 80), [data.length]);

  if (data.length === 0) {
    return <ChartEmptyNote>No data in this range yet.</ChartEmptyNote>;
  }

  return (
    <div role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 40, bottom: 0, left: 0 }}>
          <XAxis type="number" hide />
          <YAxis
            type="category"
            dataKey="label"
            width={110}
            tickLine={false}
            axisLine={false}
            tick={{ fontSize: 12, fill: 'var(--foreground)' }}
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.4 }}
            content={({ active, payload }) =>
              active && payload?.[0] ? (
                <ChartTooltip
                  label={String(payload[0].payload.label)}
                  value={`${formatNumber(Number(payload[0].value))} clicks`}
                />
              ) : null
            }
          />
          <Bar dataKey="count" barSize={12} radius={[0, 4, 4, 0]} isAnimationActive={false}>
            {data.map((entry) => (
              <Cell key={entry.label} fill="var(--chart-1)" />
            ))}
            <LabelList
              dataKey="count"
              position="right"
              formatter={(value) => formatNumber(Number(value))}
              className="fill-muted-foreground"
              fontSize={11}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
