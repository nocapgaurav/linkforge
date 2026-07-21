import type { PrismaClient } from '../../generated/prisma/client.js';
import type { AnalyticsInterval } from './analytics.validation.js';

/**
 * Read-side persistence for click analytics. Aggregation-only: every method
 * is a single SQL aggregation over click_events served by the existing
 * (url_id, occurred_at DESC) composite index — raw events are never loaded
 * into memory, and no business/assembly logic lives here.
 */

export interface AnalyticsSummary {
  totalClicks: number;
  today: number;
  last7Days: number;
  last30Days: number;
}

/** One sparse time-series bucket; zero-filling is the service's concern. */
export interface SeriesBucket {
  date: string; // bucket start, 'YYYY-MM-DD' (UTC)
  count: number;
}

export interface AnalyticsRange {
  urlId: bigint;
  from: Date;
  to: Date; // exclusive
}

/** Breakdown lists are capped to bound response size; ordered by count desc. */
const BREAKDOWN_LIMIT = 10;
const DAY_MS = 86_400_000;

export interface AnalyticsRepository {
  /** All-time, since UTC midnight, and trailing 7/30-day click counts. */
  summary(urlId: bigint): Promise<AnalyticsSummary>;

  /** Clicks bucketed by date_trunc(interval) over [from, to); sparse. */
  series(range: AnalyticsRange, interval: AnalyticsInterval): Promise<SeriesBucket[]>;

  /** Per-dimension counts over [from, to); NULL dimensions excluded. */
  browserBreakdown(range: AnalyticsRange): Promise<{ browser: string; count: number }[]>;
  deviceBreakdown(range: AnalyticsRange): Promise<{ device: string; count: number }[]>;
  countryBreakdown(range: AnalyticsRange): Promise<{ country: string; count: number }[]>;
  referrerBreakdown(range: AnalyticsRange): Promise<{ referrerHost: string; count: number }[]>;
}

export class PrismaAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly db: PrismaClient) {}

  async summary(urlId: bigint): Promise<AnalyticsSummary> {
    const now = new Date();
    const todayStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const count = (since?: Date) =>
      this.db.clickEvent.count({
        where: { urlId, ...(since ? { occurredAt: { gte: since } } : {}) },
      });

    const [totalClicks, today, last7Days, last30Days] = await Promise.all([
      count(),
      count(todayStart),
      count(new Date(now.getTime() - 7 * DAY_MS)),
      count(new Date(now.getTime() - 30 * DAY_MS)),
    ]);
    return { totalClicks, today, last7Days, last30Days };
  }

  async series(range: AnalyticsRange, interval: AnalyticsInterval): Promise<SeriesBucket[]> {
    // Raw SQL: Prisma's groupBy cannot express date_trunc bucketing.
    // AT TIME ZONE 'UTC' pins buckets to UTC regardless of session timezone;
    // count(*)::int keeps the driver from returning BigInt.
    const rows = await this.db.$queryRaw<{ date: string; count: number }[]>`
      SELECT to_char(date_trunc(${interval}::text, occurred_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date,
             count(*)::int AS count
      FROM click_events
      WHERE url_id = ${range.urlId}
        AND occurred_at >= ${range.from}
        AND occurred_at < ${range.to}
      GROUP BY 1
      ORDER BY 1`;
    return rows;
  }

  async browserBreakdown(range: AnalyticsRange) {
    const groups = await this.db.clickEvent.groupBy({
      by: ['browser'],
      where: { ...this.rangeWhere(range), browser: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { browser: 'desc' } },
      take: BREAKDOWN_LIMIT,
    });
    return groups.map((g) => ({ browser: g.browser as string, count: g._count._all }));
  }

  async deviceBreakdown(range: AnalyticsRange) {
    const groups = await this.db.clickEvent.groupBy({
      by: ['device'],
      where: { ...this.rangeWhere(range), device: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { device: 'desc' } },
      take: BREAKDOWN_LIMIT,
    });
    return groups.map((g) => ({ device: g.device as string, count: g._count._all }));
  }

  async countryBreakdown(range: AnalyticsRange) {
    const groups = await this.db.clickEvent.groupBy({
      by: ['country'],
      where: { ...this.rangeWhere(range), country: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { country: 'desc' } },
      take: BREAKDOWN_LIMIT,
    });
    return groups.map((g) => ({ country: g.country as string, count: g._count._all }));
  }

  async referrerBreakdown(range: AnalyticsRange) {
    const groups = await this.db.clickEvent.groupBy({
      by: ['referrerHost'],
      where: { ...this.rangeWhere(range), referrerHost: { not: null } },
      _count: { _all: true },
      orderBy: { _count: { referrerHost: 'desc' } },
      take: BREAKDOWN_LIMIT,
    });
    return groups.map((g) => ({ referrerHost: g.referrerHost as string, count: g._count._all }));
  }

  private rangeWhere(range: AnalyticsRange) {
    return { urlId: range.urlId, occurredAt: { gte: range.from, lt: range.to } };
  }
}
