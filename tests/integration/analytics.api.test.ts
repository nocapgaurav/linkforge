import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';

/**
 * End-to-end analytics endpoint tests: real HTTP stack, real Postgres.
 * Enriched events are seeded directly (enrichment isn't implemented yet);
 * redirect-produced events arrive through the live pipeline.
 */

const DAY_MS = 86_400_000;
const createdIds: bigint[] = [];

async function createLink(): Promise<{ shortCode: string; id: bigint }> {
  const response = await request(app)
    .post('/api/v1/urls')
    .send({ originalUrl: 'https://example.com/analytics-api' });
  expect(response.status).toBe(201);
  const shortCode = response.body.data.shortCode as string;
  const row = await prisma.url.findUniqueOrThrow({ where: { shortCode } });
  createdIds.push(row.id);
  return { shortCode, id: row.id };
}

async function seedEvent(
  urlId: bigint,
  daysAgo: number,
  dims: { browser?: string; device?: string; country?: string; referrerHost?: string } = {},
) {
  await prisma.clickEvent.create({
    data: {
      eventId: randomUUID(),
      urlId,
      occurredAt: new Date(Date.now() - daysAgo * DAY_MS - 1000),
      ...dims,
    },
  });
}

afterAll(async () => {
  await prisma.clickEvent.deleteMany({ where: { urlId: { in: createdIds } } });
  await prisma.url.deleteMany({ where: { id: { in: createdIds } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('GET /api/v1/urls/:shortCode/analytics', () => {
  it('returns empty analytics with a fully zero-filled default 30-day series', async () => {
    const { shortCode } = await createLink();

    const response = await request(app).get(`/api/v1/urls/${shortCode}/analytics`);

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data.summary).toEqual({ totalClicks: 0, today: 0, last7Days: 0, last30Days: 0 });
    expect(data.browsers).toEqual([]);
    expect(data.devices).toEqual([]);
    expect(data.countries).toEqual([]);
    expect(data.referrers).toEqual([]);
    // Default window: last 30 days, daily buckets, all zero-filled.
    expect(data.series.length).toBeGreaterThanOrEqual(30);
    expect(data.series.length).toBeLessThanOrEqual(31);
    expect(data.series.every((b: { count: number }) => b.count === 0)).toBe(true);
  });

  it('aggregates seeded and redirect-produced clicks across all sections', async () => {
    const { shortCode, id } = await createLink();
    await seedEvent(id, 2, { browser: 'chrome', device: 'mobile', country: 'US', referrerHost: 't.co' });
    await seedEvent(id, 2, { browser: 'chrome', device: 'desktop', country: 'US', referrerHost: 't.co' });
    await seedEvent(id, 5, { browser: 'firefox', device: 'mobile', country: 'DE' });

    // One live redirect adds a 4th (un-enriched) event through the real pipeline.
    await request(app).get(`/${shortCode}`);
    const deadline = Date.now() + 2000;
    while ((await prisma.clickEvent.count({ where: { urlId: id } })) < 4) {
      if (Date.now() > deadline) throw new Error('redirect event never landed');
      await new Promise((resolve) => setTimeout(resolve, 25));
    }

    const response = await request(app).get(`/api/v1/urls/${shortCode}/analytics`);

    expect(response.status).toBe(200);
    const { data } = response.body;
    expect(data.summary.totalClicks).toBe(4);
    expect(data.summary.last7Days).toBe(4);
    expect(data.browsers).toEqual([
      { browser: 'chrome', count: 2 },
      { browser: 'firefox', count: 1 },
    ]);
    expect(data.devices).toEqual([
      { device: 'mobile', count: 2 },
      { device: 'desktop', count: 1 },
    ]);
    expect(data.countries).toEqual([
      { country: 'US', count: 2 },
      { country: 'DE', count: 1 },
    ]);
    expect(data.referrers).toEqual([{ referrerHost: 't.co', count: 2 }]);
    expect(data.series.reduce((sum: number, b: { count: number }) => sum + b.count, 0)).toBe(4);
  });

  it('date filtering narrows the series and breakdowns but not the summary', async () => {
    const { shortCode, id } = await createLink();
    await seedEvent(id, 1, { browser: 'chrome' });
    await seedEvent(id, 20, { browser: 'firefox' });

    const from = new Date(Date.now() - 3 * DAY_MS).toISOString();
    const to = new Date().toISOString();
    const response = await request(app).get(
      `/api/v1/urls/${shortCode}/analytics?from=${from}&to=${to}`,
    );

    expect(response.status).toBe(200);
    const { data } = response.body;
    // Range-scoped sections see only the 1d-ago click…
    expect(data.browsers).toEqual([{ browser: 'chrome', count: 1 }]);
    expect(data.series.reduce((sum: number, b: { count: number }) => sum + b.count, 0)).toBe(1);
    // from=now-3d truncates to that day's bucket: from-day + 2 middle days + today.
    expect(data.series).toHaveLength(4);
    // …while the summary windows are fixed and see both.
    expect(data.summary.totalClicks).toBe(2);
    expect(data.summary.last30Days).toBe(2);
  });

  it('supports week and month intervals', async () => {
    const { shortCode } = await createLink();

    const week = await request(app).get(`/api/v1/urls/${shortCode}/analytics?interval=week`);
    expect(week.status).toBe(200);
    expect(week.body.data.series.length).toBeGreaterThanOrEqual(4);
    expect(week.body.data.series.length).toBeLessThanOrEqual(6);

    const month = await request(app).get(`/api/v1/urls/${shortCode}/analytics?interval=month`);
    expect(month.status).toBe(200);
    expect(month.body.data.series.length).toBeLessThanOrEqual(2);
  });

  it('rejects invalid ranges and intervals with 400 VALIDATION_ERROR', async () => {
    const { shortCode } = await createLink();
    const base = `/api/v1/urls/${shortCode}/analytics`;

    const inverted = await request(app).get(
      `${base}?from=2026-07-10T00:00:00Z&to=2026-07-01T00:00:00Z`,
    );
    expect(inverted.status).toBe(400);
    expect(inverted.body.error.code).toBe('VALIDATION_ERROR');
    expect(inverted.body.error.details[0].field).toBe('to');

    const tooWide = await request(app).get(
      `${base}?from=2025-01-01T00:00:00Z&to=2026-06-01T00:00:00Z`,
    );
    expect(tooWide.status).toBe(400);

    const badInterval = await request(app).get(`${base}?interval=hour`);
    expect(badInterval.status).toBe(400);

    const badDate = await request(app).get(`${base}?from=yesterday`);
    expect(badDate.status).toBe(400);
  });

  it('returns 404 for unknown and soft-deleted short codes', async () => {
    const unknown = await request(app).get('/api/v1/urls/doesnotexist/analytics');
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe('NOT_FOUND');

    const { shortCode } = await createLink();
    await request(app).delete(`/api/v1/urls/${shortCode}`);
    const deleted = await request(app).get(`/api/v1/urls/${shortCode}/analytics`);
    expect(deleted.status).toBe(404);
  });
});
