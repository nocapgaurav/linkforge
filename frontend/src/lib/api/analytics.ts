import { api } from '@/lib/api/client';
import { RANGE_CONFIG, type AnalyticsRange, type LinkAnalytics } from '@/types/analytics';

/** Fetch analytics for one link over a preset range (resolved at call time). */
export function getLinkAnalytics(
  shortCode: string,
  range: AnalyticsRange,
): Promise<LinkAnalytics> {
  const { days, interval } = RANGE_CONFIG[range];
  const from = new Date(Date.now() - days * 86_400_000).toISOString();
  const query = new URLSearchParams({ from, interval });
  return api.get<LinkAnalytics>(
    `/urls/${encodeURIComponent(shortCode)}/analytics?${query.toString()}`,
  );
}
