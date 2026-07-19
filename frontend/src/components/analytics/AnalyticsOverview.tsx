import { CalendarDays, CalendarRange, MousePointerClick, Sun } from 'lucide-react';
import { SummaryCard } from '@/components/dashboard/SummaryCard';
import { formatNumber } from '@/lib/format';
import type { AnalyticsSummary } from '@/types/analytics';

/** The four backend-computed headline windows, rendered verbatim. */
export function AnalyticsOverview({ summary }: { summary: AnalyticsSummary }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <SummaryCard
        icon={MousePointerClick}
        title="Total Clicks"
        value={formatNumber(summary.totalClicks)}
        subtitle="All time"
      />
      <SummaryCard
        icon={Sun}
        title="Today"
        value={formatNumber(summary.today)}
        subtitle="Since midnight UTC"
      />
      <SummaryCard
        icon={CalendarDays}
        title="Last 7 Days"
        value={formatNumber(summary.last7Days)}
        subtitle="Trailing week"
      />
      <SummaryCard
        icon={CalendarRange}
        title="Last 30 Days"
        value={formatNumber(summary.last30Days)}
        subtitle="Trailing month"
      />
    </div>
  );
}
