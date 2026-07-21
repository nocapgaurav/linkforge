import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { analyticsRepository } from '../../src/composition';

/**
 * Aggregation queries against real Postgres. One url with a fixed event
 * fixture; a second url proves scoping (its events must never leak in).
 */

const DAY_MS = 86_400_000;
const now = new Date();
const ago = (days: number, extraMs = 0) => new Date(now.getTime() - days * DAY_MS - extraMs);

let ownerId: bigint;
let urlId: bigint;
let otherUrlId: bigint;

async function seed(
  target: bigint,
  occurredAt: Date,
  dims: { browser?: string; device?: string; country?: string; referrerHost?: string } = {},
) {
  await prisma.clickEvent.create({
    data: { eventId: randomUUID(), urlId: target, occurredAt, ...dims },
  });
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `repo-${randomUUID()}@test.linkforge.local`,
      displayName: 'Repo Fixture',
      passwordHash: 'x'.repeat(60),
    },
  });
  ownerId = owner.id;
  const [a, b] = await Promise.all(
    ['ana', 'anb'].map((prefix) =>
      prisma.url.create({
        data: {
          shortCode: `${prefix}${Date.now().toString(36)}`,
          originalUrl: 'https://example.com/analytics',
          urlHash: 'd'.repeat(64),
          createdBy: ownerId,
        },
      }),
    ),
  );
  urlId = a.id;
  otherUrlId = b.id;

  // Fixture: 1s ago (today+7d+30d), 3d, 10d, 40d ago — plus dimensions.
  await seed(urlId, ago(0, 1000), { browser: 'chrome', device: 'mobile', country: 'US', referrerHost: 't.co' });
  await seed(urlId, ago(3), { browser: 'chrome', device: 'desktop', country: 'US', referrerHost: 't.co' });
  await seed(urlId, ago(10), { browser: 'firefox', device: 'mobile', country: 'DE' });
  await seed(urlId, ago(40));
  // Noise on another link that must never appear in results.
  await seed(otherUrlId, ago(1), { browser: 'safari', country: 'FR', referrerHost: 'fr.example' });
});

afterAll(async () => {
  await prisma.clickEvent.deleteMany({ where: { urlId: { in: [urlId, otherUrlId] } } });
  await prisma.url.deleteMany({ where: { id: { in: [urlId, otherUrlId] } } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await disconnectPrisma();
});

describe('PrismaAnalyticsRepository', () => {
  it('summary buckets clicks into total/today/7d/30d windows', async () => {
    const summary = await analyticsRepository.summary(urlId);

    expect(summary.totalClicks).toBe(4);
    expect(summary.last7Days).toBe(2);
    expect(summary.last30Days).toBe(3);
    // The 1s-ago event is "today" unless the test runs within 1s of UTC midnight.
    expect(summary.today).toBeGreaterThanOrEqual(0);
    expect(summary.today).toBeLessThanOrEqual(1);
  });

  it('series returns sparse per-day buckets within [from, to) only', async () => {
    const series = await analyticsRepository.series(
      { urlId, from: ago(12), to: now },
      'day',
    );

    // 3 events in range (1s, 3d, 10d ago) on 3 distinct days; sparse (no zeros).
    expect(series).toHaveLength(3);
    expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(3);
    for (const bucket of series) {
      expect(bucket.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(bucket.count).toBe(1);
    }
    // Ordered ascending.
    expect([...series.map((b) => b.date)].sort()).toEqual(series.map((b) => b.date));
  });

  it('date filtering: a narrower range excludes older events', async () => {
    const series = await analyticsRepository.series(
      { urlId, from: ago(5), to: now },
      'day',
    );

    expect(series.reduce((sum, bucket) => sum + bucket.count, 0)).toBe(2);
  });

  it('browser breakdown counts, orders descending, and ignores NULLs', async () => {
    const browsers = await analyticsRepository.browserBreakdown({
      urlId,
      from: ago(50),
      to: now,
    });

    // The 40d-ago event has browser NULL and is excluded.
    expect(browsers).toEqual([
      { browser: 'chrome', count: 2 },
      { browser: 'firefox', count: 1 },
    ]);
  });

  it('device breakdown counts and ignores NULLs', async () => {
    const devices = await analyticsRepository.deviceBreakdown({ urlId, from: ago(50), to: now });

    expect(devices).toEqual([
      { device: 'mobile', count: 2 },
      { device: 'desktop', count: 1 },
    ]);
  });

  it('country breakdown counts and ignores NULLs', async () => {
    const countries = await analyticsRepository.countryBreakdown({
      urlId,
      from: ago(50),
      to: now,
    });

    expect(countries).toEqual([
      { country: 'US', count: 2 },
      { country: 'DE', count: 1 },
    ]);
  });

  it('referrer breakdown counts and ignores NULLs (direct visits)', async () => {
    const referrers = await analyticsRepository.referrerBreakdown({
      urlId,
      from: ago(50),
      to: now,
    });

    expect(referrers).toEqual([{ referrerHost: 't.co', count: 2 }]);
  });

  it('never leaks events from other links', async () => {
    const browsers = await analyticsRepository.browserBreakdown({
      urlId,
      from: ago(50),
      to: now,
    });

    expect(browsers.map((b) => b.browser)).not.toContain('safari');
  });

  it('returns empty aggregations for a link with no events', async () => {
    const summary = await analyticsRepository.summary(otherUrlId + 999_999n);
    expect(summary).toEqual({ totalClicks: 0, today: 0, last7Days: 0, last30Days: 0 });

    const series = await analyticsRepository.series(
      { urlId: otherUrlId + 999_999n, from: ago(30), to: now },
      'day',
    );
    expect(series).toEqual([]);
  });
});
