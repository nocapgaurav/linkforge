import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { urlRepository } from '../../src/modules/url/url.repository';

/**
 * Listing tests against the real stack. Fixture rows are backdated into a
 * private 2001 time window so pagination through them is deterministic even
 * while other test files create rows concurrently; assertions about live
 * data filter to fixture codes rather than assuming an otherwise-empty DB.
 */

const WINDOW_TOP = Date.UTC(2001, 5, 15); // fixture window: June 2001
const stamp = Date.now().toString(36);
const fixtureCode = (n: number) => `lst${n}${stamp}`;
const fixtureIds: bigint[] = [];
/** Cursor pointing just above the fixture window. */
const windowCursor = `${WINDOW_TOP + 60_000}_999999999`;

beforeAll(async () => {
  // Five links, one minute apart, oldest first — plus two sharing one
  // timestamp (codes 4 and 5) to exercise the id tiebreak.
  for (let n = 1; n <= 5; n++) {
    const createdAt = new Date(n === 5 ? WINDOW_TOP - 4 * 60_000 : WINDOW_TOP - n * 60_000);
    const row = await prisma.url.create({
      data: {
        shortCode: fixtureCode(n),
        originalUrl: `https://example.com/list-${n}`,
        urlHash: 'e'.repeat(64),
        createdAt,
      },
    });
    fixtureIds.push(row.id);
  }
});

afterAll(async () => {
  await prisma.url.deleteMany({ where: { id: { in: fixtureIds } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('UrlRepository.list', () => {
  it('orders by created_at DESC with id DESC breaking timestamp ties', async () => {
    const rows = await urlRepository.list({
      limit: 10,
      before: { createdAt: new Date(WINDOW_TOP + 60_000), id: 999_999_999n },
    });
    const mine = rows.filter((r) => r.shortCode.endsWith(stamp));

    // Codes 4 and 5 share created_at; 5 was inserted later (higher id), so
    // id DESC places it first: 1, 2, 3, then 5, 4.
    expect(mine.map((r) => r.shortCode)).toEqual([1, 2, 3, 5, 4].map(fixtureCode));
    expect(mine[3].createdAt.getTime()).toBe(mine[4].createdAt.getTime());
    expect(mine[3].id > mine[4].id).toBe(true);
  });

  it('applies the keyset predicate exclusively (row at the cursor is skipped)', async () => {
    const all = await urlRepository.list({
      limit: 10,
      before: { createdAt: new Date(WINDOW_TOP), id: 999_999_999n },
    });
    const mine = all.filter((r) => r.shortCode.endsWith(stamp));
    const second = mine[1];

    const after = await urlRepository.list({
      limit: 10,
      before: { createdAt: second.createdAt, id: second.id },
    });
    const mineAfter = after.filter((r) => r.shortCode.endsWith(stamp));

    expect(mineAfter.map((r) => r.shortCode)).toEqual(mine.slice(2).map((r) => r.shortCode));
  });

  it('respects the limit', async () => {
    const rows = await urlRepository.list({ limit: 2 });
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it('returns an empty page when the cursor is older than every row', async () => {
    const rows = await urlRepository.list({
      limit: 10,
      before: { createdAt: new Date(1000), id: 1n },
    });
    expect(rows).toEqual([]);
  });
});

describe('GET /api/v1/urls', () => {
  it('returns the documented envelope shape with URL resources', async () => {
    const response = await request(app).get('/api/v1/urls?limit=5');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toHaveProperty('items');
    expect(response.body.data.pagination).toHaveProperty('nextCursor');
    expect(response.body.data.pagination).toHaveProperty('hasMore');
    for (const item of response.body.data.items) {
      expect(item).toHaveProperty('shortCode');
      expect(item).toHaveProperty('shortUrl');
      expect(item).not.toHaveProperty('id');
      expect(item).not.toHaveProperty('urlHash');
    }
  });

  it('paginates through the fixture window with stable cursors until exhausted', async () => {
    const seen: string[] = [];
    let cursor: string | null = windowCursor;
    let pages = 0;

    while (cursor !== null && pages < 20) {
      const response = await request(app).get(
        `/api/v1/urls?limit=2&cursor=${encodeURIComponent(cursor)}`,
      );
      expect(response.status).toBe(200);
      const { items, pagination } = response.body.data;
      expect(items.length).toBeLessThanOrEqual(2);
      seen.push(...items.map((i: { shortCode: string }) => i.shortCode));
      if (!pagination.hasMore) expect(pagination.nextCursor).toBeNull();
      cursor = pagination.nextCursor;
      pages += 1;
    }

    const mine = seen.filter((code) => code.endsWith(stamp));
    expect(mine).toEqual([1, 2, 3, 5, 4].map(fixtureCode));
    expect(new Set(seen).size).toBe(seen.length); // no duplicates across pages
  });

  it('excludes soft-deleted links from listings', async () => {
    await request(app).delete(`/api/v1/urls/${fixtureCode(3)}`).expect(200);

    const response = await request(app).get(
      `/api/v1/urls?limit=100&cursor=${encodeURIComponent(windowCursor)}`,
    );
    const mine = response.body.data.items
      .map((i: { shortCode: string }) => i.shortCode)
      .filter((code: string) => code.endsWith(stamp));

    expect(mine).toEqual([1, 2, 5, 4].map(fixtureCode));
  });

  it('returns an empty page for a cursor older than every row', async () => {
    const response = await request(app).get('/api/v1/urls?cursor=1000_1');

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({
      items: [],
      pagination: { nextCursor: null, hasMore: false },
    });
  });

  it('rejects invalid limits and malformed cursors with 400', async () => {
    for (const query of ['limit=0', 'limit=101', 'limit=abc', 'cursor=garbage', 'cursor=12_x']) {
      const response = await request(app).get(`/api/v1/urls?${query}`);
      expect(response.status, query).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('serves CORS for the configured origin only', async () => {
    const preflight = await request(app)
      .options('/api/v1/urls')
      .set('Origin', 'http://localhost:3001')
      .set('Access-Control-Request-Method', 'GET');
    expect(preflight.status).toBe(204);
    expect(preflight.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(preflight.headers['access-control-allow-methods']).toContain('GET');

    const allowed = await request(app)
      .get('/api/v1/urls?limit=1')
      .set('Origin', 'http://localhost:3001');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3001');
    expect(allowed.headers['vary']).toContain('Origin');

    const denied = await request(app)
      .get('/api/v1/urls?limit=1')
      .set('Origin', 'https://evil.example');
    expect(denied.headers['access-control-allow-origin']).toBeUndefined();
  });
});
