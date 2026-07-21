import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnalyticsRepository } from '../../../src/modules/analytics/analytics.repository';
import { DefaultAnalyticsService } from '../../../src/modules/analytics/analytics.service';
import type { AnalyticsQuery } from '../../../src/modules/analytics/analytics.validation';
import { UrlNotFoundError } from '../../../src/modules/url/url.errors';
import type { UrlRepository } from '../../../src/modules/url/url.repository';
import type { Url } from '../../../src/modules/url/url.types';

const url: Url = {
  id: 42n,
  shortCode: 'aB3xK9q',
  isCustomAlias: false,
  originalUrl: 'https://example.com/',
  urlHash: 'a'.repeat(64),
  clickCount: 0n,
  isActive: true,
  expiresAt: null,
  createdBy: 7n,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
  deletedAt: null,
  passwordHash: null,
  maxClicks: null,
};

const summary = { totalClicks: 10, today: 1, last7Days: 4, last30Days: 9 };

function makeUrls(found: Url | null = url) {
  return {
    create: vi.fn(),
    findByShortCode: vi.fn().mockResolvedValue(found),
    findById: vi.fn(),
    update: vi.fn(),
    incrementClickCount: vi.fn(),
    softDelete: vi.fn(),
  } satisfies UrlRepository;
}

function makeAnalyticsRepo() {
  return {
    summary: vi.fn().mockResolvedValue(summary),
    series: vi.fn().mockResolvedValue([]),
    browserBreakdown: vi.fn().mockResolvedValue([]),
    deviceBreakdown: vi.fn().mockResolvedValue([]),
    countryBreakdown: vi.fn().mockResolvedValue([]),
    referrerBreakdown: vi.fn().mockResolvedValue([]),
  } satisfies AnalyticsRepository;
}

const query: AnalyticsQuery = {
  from: new Date('2026-07-03T00:00:00Z'),
  to: new Date('2026-07-07T00:00:00Z'),
  interval: 'day',
};

describe('DefaultAnalyticsService', () => {
  let analytics: ReturnType<typeof makeAnalyticsRepo>;

  beforeEach(() => {
    analytics = makeAnalyticsRepo();
  });

  it('throws UrlNotFoundError for unknown (or soft-deleted) codes without querying analytics', async () => {
    const service = new DefaultAnalyticsService(makeUrls(null), analytics);

    await expect(service.getUrlAnalytics('nope123', query, 7n)).rejects.toThrow(UrlNotFoundError);
    expect(analytics.summary).not.toHaveBeenCalled();
    expect(analytics.series).not.toHaveBeenCalled();
  });

  it('assembles all aggregations into one response, scoped to the link and range', async () => {
    const browsers = [{ browser: 'chrome', count: 5 }];
    analytics.browserBreakdown.mockResolvedValue(browsers);
    const service = new DefaultAnalyticsService(makeUrls(), analytics);

    const result = await service.getUrlAnalytics('aB3xK9q', query, 7n);

    const range = { urlId: 42n, from: query.from, to: query.to };
    expect(analytics.summary).toHaveBeenCalledWith(42n);
    expect(analytics.series).toHaveBeenCalledWith(range, 'day');
    expect(analytics.browserBreakdown).toHaveBeenCalledWith(range);
    expect(analytics.referrerBreakdown).toHaveBeenCalledWith(range);
    expect(result.summary).toEqual(summary);
    expect(result.browsers).toBe(browsers);
    expect(result.devices).toEqual([]);
  });

  it('zero-fills the daily series across the whole range', async () => {
    analytics.series.mockResolvedValue([{ date: '2026-07-05', count: 2 }]);
    const service = new DefaultAnalyticsService(makeUrls(), analytics);

    const result = await service.getUrlAnalytics('aB3xK9q', query, 7n);

    expect(result.series).toEqual([
      { date: '2026-07-03', count: 0 },
      { date: '2026-07-04', count: 0 },
      { date: '2026-07-05', count: 2 },
      { date: '2026-07-06', count: 0 },
    ]);
  });

  it('aligns week buckets to ISO Monday like date_trunc', async () => {
    analytics.series.mockResolvedValue([{ date: '2026-07-06', count: 3 }]);
    const service = new DefaultAnalyticsService(makeUrls(), analytics);

    // 2026-07-03 is a Friday; its ISO week starts Monday 2026-06-29.
    const result = await service.getUrlAnalytics('aB3xK9q', {
      ...query,
      to: new Date('2026-07-14T00:00:00Z'),
      interval: 'week',
    }, 7n);

    expect(result.series).toEqual([
      { date: '2026-06-29', count: 0 },
      { date: '2026-07-06', count: 3 },
      { date: '2026-07-13', count: 0 },
    ]);
  });

  it('aligns month buckets to the first of the month', async () => {
    analytics.series.mockResolvedValue([{ date: '2026-08-01', count: 7 }]);
    const service = new DefaultAnalyticsService(makeUrls(), analytics);

    const result = await service.getUrlAnalytics('aB3xK9q', {
      from: new Date('2026-07-15T12:00:00Z'),
      to: new Date('2026-09-02T00:00:00Z'),
      interval: 'month',
    }, 7n);

    expect(result.series).toEqual([
      { date: '2026-07-01', count: 0 },
      { date: '2026-08-01', count: 7 },
      { date: '2026-09-01', count: 0 },
    ]);
  });

  it("hides another owner's link as a plain 404 without querying analytics", async () => {
    const service = new DefaultAnalyticsService(makeUrls(), analytics);

    await expect(service.getUrlAnalytics('aB3xK9q', query, 999n)).rejects.toThrow(
      UrlNotFoundError,
    );
    expect(analytics.summary).not.toHaveBeenCalled();
  });
});
