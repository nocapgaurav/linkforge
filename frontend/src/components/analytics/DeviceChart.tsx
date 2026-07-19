'use client';

import { useMemo } from 'react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import { ChartCard, ChartEmptyNote, ChartTooltip } from '@/components/analytics/ChartCard';
import { capitalize, formatNumber } from '@/lib/format';
import type { LinkAnalytics } from '@/types/analytics';

/**
 * Validated categorical slots (dataviz palette): at most four — extra
 * device types fold into "Other" rather than minting new hues.
 */
const SLOTS = ['var(--chart-1)', 'var(--chart-2)', 'var(--chart-3)', 'var(--chart-4)'] as const;

/** Device split donut with a labeled legend (identity is never color-alone). */
export function DeviceChart({ devices }: { devices: LinkAnalytics['devices'] }) {
  const { data, total } = useMemo(() => {
    const named = devices.map(({ device, count }) => ({ label: capitalize(device), count }));
    const head = named.slice(0, SLOTS.length - 1);
    const tail = named.slice(SLOTS.length - 1);
    const folded =
      tail.length > 1
        ? [...head, { label: 'Other', count: tail.reduce((sum, d) => sum + d.count, 0) }]
        : named;
    return { data: folded, total: named.reduce((sum, d) => sum + d.count, 0) };
  }, [devices]);

  return (
    <ChartCard title="Devices" description="Device split for this range">
      {data.length === 0 ? (
        <ChartEmptyNote>No data in this range yet.</ChartEmptyNote>
      ) : (
        <div
          className="flex items-center gap-6"
          role="img"
          aria-label={`Donut chart of clicks by device: ${data
            .map((d) => `${d.label} ${d.count}`)
            .join(', ')}`}
        >
          <ResponsiveContainer width={160} height={160}>
            <PieChart>
              <Tooltip
                content={({ active, payload }) =>
                  active && payload?.[0] ? (
                    <ChartTooltip
                      label={String(payload[0].name)}
                      value={`${formatNumber(Number(payload[0].value))} clicks`}
                    />
                  ) : null
                }
              />
              <Pie
                data={data}
                dataKey="count"
                nameKey="label"
                innerRadius={48}
                outerRadius={72}
                paddingAngle={2}
                stroke="var(--background)"
                strokeWidth={2}
                isAnimationActive={false}
              >
                {data.map((entry, index) => (
                  <Cell key={entry.label} fill={SLOTS[index % SLOTS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
          <ul className="flex-1 space-y-2 text-sm">
            {data.map((entry, index) => (
              <li key={entry.label} className="flex items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: SLOTS[index % SLOTS.length] }}
                  aria-hidden="true"
                />
                <span className="flex-1 truncate">{entry.label}</span>
                <span className="tabular-nums text-muted-foreground">
                  {formatNumber(entry.count)}
                  <span className="ml-1.5 text-xs">
                    {total > 0 ? `${Math.round((entry.count / total) * 100)}%` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </ChartCard>
  );
}
