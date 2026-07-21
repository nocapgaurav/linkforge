import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis, redisClient } from '../../src/config/redis';
import { registerTestUser } from './helpers';

/**
 * Cache-aside integration tests against the real docker-compose stack
 * (Postgres + Redis). Cache-hit behavior is asserted through observable
 * effects — e.g. mutating Postgres behind the cache's back and seeing the
 * redirect still serve the cached target — never through spies.
 */

if (!redisClient) {
  throw new Error('REDIS_URL must be configured to run the cache integration tests.');
}
const redis = redisClient;

const cacheKey = (shortCode: string) => `cache:url:v2:${shortCode}`;
const createdCodes: string[] = [];
let auth: Awaited<ReturnType<typeof registerTestUser>>;

async function createLink(originalUrl: string): Promise<string> {
  const response = await request(app).post('/api/v1/urls').set('Authorization', `Bearer ${auth.accessToken}`).send({ originalUrl });
  expect(response.status).toBe(201);
  const shortCode = response.body.data.shortCode as string;
  createdCodes.push(shortCode);
  return shortCode;
}

/** Cache population is fire-and-forget, so poll briefly for the key. */
async function waitForKey(key: string, timeoutMs = 1000): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await redis.get(key);
    if (value !== null) return value;
    if (Date.now() > deadline) throw new Error(`cache key ${key} never appeared`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  // The client is lazy; connect eagerly so the first test's fire-and-forget
  // SET doesn't race the initial connection handshake.
  if (redis.status === 'wait') await redis.connect();
  auth = await registerTestUser(app);
});

afterAll(async () => {
  if (createdCodes.length > 0) {
    await redis.del(...createdCodes.map(cacheKey)).catch(() => undefined);
    // Redirects record click events now; clear children before the FK parent.
    await prisma.clickEvent.deleteMany({ where: { url: { shortCode: { in: createdCodes } } } });
    await prisma.url.deleteMany({ where: { shortCode: { in: createdCodes } } });
  }
  if (auth) await prisma.user.deleteMany({ where: { email: auth.email } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('redirect cache-aside (real Redis + Postgres)', () => {
  it('first redirect reads Postgres and populates Redis with a TTL’d entry', async () => {
    const code = await createLink('https://example.com/cache-populate');

    const response = await request(app).get(`/${code}`);
    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://example.com/cache-populate');

    const raw = await waitForKey(cacheKey(code));
    expect(JSON.parse(raw)).toEqual({
      i: expect.stringMatching(/^\d+$/),
      u: 'https://example.com/cache-populate',
      a: 1,
      e: null,
    });
    const ttl = await redis.ttl(cacheKey(code));
    expect(ttl).toBeGreaterThanOrEqual(3240);
    expect(ttl).toBeLessThanOrEqual(3960);
  });

  it('second redirect is served from Redis: a direct DB change is not visible', async () => {
    const code = await createLink('https://example.com/cache-hit-original');
    await request(app).get(`/${code}`);
    await waitForKey(cacheKey(code));

    // Mutate Postgres behind the cache's back (no API call, no invalidation).
    // If the second redirect consulted the database, it would see this.
    await prisma.url.updateMany({
      where: { shortCode: code },
      data: { originalUrl: 'https://example.com/changed-in-db' },
    });

    const response = await request(app).get(`/${code}`);
    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://example.com/cache-hit-original');
  });

  it('DELETE invalidates the cache entry and the redirect dies immediately', async () => {
    const code = await createLink('https://example.com/cache-delete');
    await request(app).get(`/${code}`);
    await waitForKey(cacheKey(code));

    const deletion = await request(app).delete(`/api/v1/urls/${code}`).set('Authorization', `Bearer ${auth.accessToken}`);
    expect(deletion.status).toBe(200);

    await expect(redis.get(cacheKey(code))).resolves.toBeNull();
    const response = await request(app).get(`/${code}`);
    expect(response.status).toBe(404);
  });

  it('negative caching: a 404 lookup is remembered, and create purges it', async () => {
    const code = `M2neg${Date.now().toString(36)}`;

    const miss = await request(app).get(`/${code}`);
    expect(miss.status).toBe(404);
    await waitForKey(cacheKey(code));
    await expect(redis.get(cacheKey(code))).resolves.toBe('0');

    const created = await request(app)
      .post('/api/v1/urls').set('Authorization', `Bearer ${auth.accessToken}`)
      .send({ originalUrl: 'https://example.com/was-negative', customAlias: code });
    expect(created.status).toBe(201);
    createdCodes.push(code);
    await expect(redis.get(cacheKey(code))).resolves.toBeNull();

    const response = await request(app).get(`/${code}`);
    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://example.com/was-negative');
  });

  it('redirects still succeed through Postgres while Redis is down', { timeout: 30_000 }, async () => {
    const code = await createLink('https://example.com/redis-down');

    execSync('docker stop linkforge-redis', { stdio: 'ignore' });
    try {
      const response = await request(app).get(`/${code}`);
      expect(response.status).toBe(302);
      expect(response.headers['location']).toBe('https://example.com/redis-down');

      // Management plane and 404s are equally unaffected.
      const meta = await request(app).get(`/api/v1/urls/${code}`).set('Authorization', `Bearer ${auth.accessToken}`);
      expect(meta.status).toBe(200);
      const missing = await request(app).get('/definitely-not-here');
      expect(missing.status).toBe(404);
    } finally {
      execSync('docker start linkforge-redis', { stdio: 'ignore' });
    }
  });
});
