/**
 * Wire types for GET /api/v1/urls/:shortCode/analytics
 * (docs/api-v1-spec.md §7), mirrored exactly.
 */

export interface AnalyticsSummary {
  totalClicks: number;
  today: number;
  last7Days: number;
  last30Days: number;
}

/** One time-series bucket; `date` is the UTC bucket start (YYYY-MM-DD). */
export interface SeriesBucket {
  date: string;
  count: number;
}

export interface LinkAnalytics {
  summary: AnalyticsSummary;
  series: SeriesBucket[];
  browsers: { browser: string; count: number }[];
  devices: { device: string; count: number }[];
  countries: { country: string; count: number }[];
  referrers: { referrerHost: string; count: number }[];
}

export type AnalyticsInterval = 'day' | 'week' | 'month';

/** The dashboard's range presets; persisted in the URL as ?range=… */
export const ANALYTICS_RANGES = ['7d', '30d', '90d', '365d'] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(value: string | null): value is AnalyticsRange {
  return value !== null && (ANALYTICS_RANGES as readonly string[]).includes(value);
}

/**
 * Preset → request parameters. Bucket size grows with the window so charts
 * keep a readable point count (7–90 points), matching what the backend's
 * interval option exists for.
 */
export const RANGE_CONFIG: Record<
  AnalyticsRange,
  { days: number; interval: AnalyticsInterval; label: string }
> = {
  '7d': { days: 7, interval: 'day', label: '7 days' },
  '30d': { days: 30, interval: 'day', label: '30 days' },
  '90d': { days: 90, interval: 'week', label: '90 days' },
  '365d': { days: 365, interval: 'month', label: '365 days' },
};
