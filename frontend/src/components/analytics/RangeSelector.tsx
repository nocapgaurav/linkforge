'use client';

import { Button } from '@/components/ui/button';
import { ANALYTICS_RANGES, RANGE_CONFIG, type AnalyticsRange } from '@/types/analytics';

/** Segmented range control; selection state lives in the URL (parent-owned). */
export function RangeSelector({
  value,
  onChange,
}: {
  value: AnalyticsRange;
  onChange: (range: AnalyticsRange) => void;
}) {
  return (
    <div
      role="group"
      aria-label="Analytics date range"
      className="flex items-center gap-0.5 rounded-lg border bg-muted/40 p-0.5"
    >
      {ANALYTICS_RANGES.map((range) => (
        <Button
          key={range}
          variant="ghost"
          size="sm"
          aria-pressed={value === range}
          onClick={() => onChange(range)}
          className={
            value === range
              ? 'bg-background shadow-xs hover:bg-background'
              : 'text-muted-foreground'
          }
        >
          {RANGE_CONFIG[range].label}
        </Button>
      ))}
    </div>
  );
}
