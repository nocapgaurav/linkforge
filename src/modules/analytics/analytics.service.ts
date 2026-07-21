import { UrlNotFoundError } from '../url/url.errors.js';
import { type UrlRepository } from '../url/url.repository.js';
import {
  type AnalyticsRange,
  type AnalyticsRepository,
  type AnalyticsSummary,
  type SeriesBucket,
} from './analytics.repository.js';
import type { AnalyticsInterval, AnalyticsQuery } from './analytics.validation.js';

/** The complete analytics read model for one link. */
export interface UrlAnalytics {
  summary: AnalyticsSummary;
  series: SeriesBucket[];
  browsers: { browser: string; count: number }[];
  devices: { device: string; count: number }[];
  countries: { country: string; count: number }[];
  referrers: { referrerHost: string; count: number }[];
}

export interface AnalyticsService {
  /**
   * Assemble the analytics read model for one of the owner's links.
   * Orchestration only: resolves the link (unknown, soft-deleted, AND
   * other-owner codes all → UrlNotFoundError — the anti-enumeration rule),
   * fans out the aggregation queries concurrently, and zero-fills the
   * time series so charts never gap-fill client-side.
   */
  getUrlAnalytics(
    shortCode: string,
    query: AnalyticsQuery,
    ownerId: bigint,
  ): Promise<UrlAnalytics>;
}

const DAY_MS = 86_400_000;

/** Truncate to the bucket start, mirroring Postgres date_trunc in UTC. */
function truncateUtc(date: Date, interval: AnalyticsInterval): Date {
  const day = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  switch (interval) {
    case 'day':
      return day;
    case 'week':
      // date_trunc('week') starts weeks on ISO Monday.
      return new Date(day.getTime() - ((day.getUTCDay() + 6) % 7) * DAY_MS);
    case 'month':
      return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  }
}

function nextBucket(bucket: Date, interval: AnalyticsInterval): Date {
  switch (interval) {
    case 'day':
      return new Date(bucket.getTime() + DAY_MS);
    case 'week':
      return new Date(bucket.getTime() + 7 * DAY_MS);
    case 'month':
      return new Date(Date.UTC(bucket.getUTCFullYear(), bucket.getUTCMonth() + 1, 1));
  }
}

/**
 * Expand the repository's sparse buckets into a dense series over
 * [from, to): every bucket present, empty ones at zero. Bounded by the
 * validation layer's 365-day range cap (≤ 366 day buckets).
 */
function zeroFillSeries(
  sparse: SeriesBucket[],
  from: Date,
  to: Date,
  interval: AnalyticsInterval,
): SeriesBucket[] {
  const counts = new Map(sparse.map((bucket) => [bucket.date, bucket.count]));
  const series: SeriesBucket[] = [];
  for (
    let cursor = truncateUtc(from, interval);
    cursor.getTime() < to.getTime();
    cursor = nextBucket(cursor, interval)
  ) {
    const date = cursor.toISOString().slice(0, 10);
    series.push({ date, count: counts.get(date) ?? 0 });
  }
  return series;
}

/**
 * Orchestration only — no SQL, no Prisma. Depends on the URL repository
 * (link resolution) and the analytics repository (aggregations), both
 * injected for testability.
 */
export class DefaultAnalyticsService implements AnalyticsService {
  constructor(
    private readonly urls: UrlRepository,
    private readonly analytics: AnalyticsRepository,
  ) {}

  async getUrlAnalytics(
    shortCode: string,
    query: AnalyticsQuery,
    ownerId: bigint,
  ): Promise<UrlAnalytics> {
    const url = await this.urls.findByShortCode(shortCode);
    if (!url || url.createdBy !== ownerId) {
      // Other-owner links look exactly like missing ones (anti-enumeration).
      throw new UrlNotFoundError(shortCode);
    }

    const range: AnalyticsRange = { urlId: url.id, from: query.from, to: query.to };
    const [summary, sparseSeries, browsers, devices, countries, referrers] = await Promise.all([
      this.analytics.summary(url.id),
      this.analytics.series(range, query.interval),
      this.analytics.browserBreakdown(range),
      this.analytics.deviceBreakdown(range),
      this.analytics.countryBreakdown(range),
      this.analytics.referrerBreakdown(range),
    ]);

    return {
      summary,
      series: zeroFillSeries(sparseSeries, query.from, query.to, query.interval),
      browsers,
      devices,
      countries,
      referrers,
    };
  }
}
