import { execSync } from 'node:child_process';
import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { registerTestUser } from './helpers';

/**
 * Real Redis-backed rate limiting: the create-url limit (30/min per user —
 * see url.routes.ts) is low enough to exhaust with real HTTP requests in a
 * fast test, unlike the auth limits (20/hour, 30/15min), which exist to
 * bound abuse over a much longer window and aren't meant to be exhausted
 * in a unit of test time — their boundary logic is covered at the unit
 * level (tests/unit/shared/rate-limit.test.ts) instead.
 */

const createdCodes: string[] = [];
const createdEmails: string[] = [];
let limited: Awaited<ReturnType<typeof registerTestUser>>;
let other: Awaited<ReturnType<typeof registerTestUser>>;

async function registerTrackedUser() {
  const user = await registerTestUser(app);
  createdEmails.push(user.email);
  return user;
}

afterAll(async () => {
  // URLs before users: created_by is an onDelete: Restrict foreign key.
  await prisma.url.deleteMany({ where: { shortCode: { in: createdCodes } } });
  await prisma.user.deleteMany({ where: { email: { in: createdEmails } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('rate limiting: POST /api/v1/urls', () => {
  it('allows 30 requests/min per user, then 429s with RATE_LIMITED', async () => {
    limited = await registerTrackedUser();
    const auth = { Authorization: `Bearer ${limited.accessToken}` };

    const responses: number[] = [];
    for (let i = 0; i < 31; i++) {
      const response = await request(app)
        .post('/api/v1/urls')
        .set(auth)
        .send({ originalUrl: `https://example.com/rl-${i}` });
      responses.push(response.status);
      expect(response.headers['ratelimit-limit']).toBe('30');
      expect(response.headers['ratelimit-remaining']).toBe(String(Math.max(0, 30 - (i + 1))));
      if (response.status === 201) createdCodes.push(response.body.data.shortCode);
      else {
        expect(response.status).toBe(429);
        expect(response.body).toEqual({
          success: false,
          error: { code: 'RATE_LIMITED', message: expect.any(String) },
        });
      }
    }

    expect(responses.filter((s) => s === 201)).toHaveLength(30);
    expect(responses.filter((s) => s === 429)).toHaveLength(1);
  }, 20_000);

  it('limits are independent per user: a different user is unaffected', async () => {
    other = await registerTrackedUser();

    const response = await request(app)
      .post('/api/v1/urls')
      .set({ Authorization: `Bearer ${other.accessToken}` })
      .send({ originalUrl: 'https://example.com/rl-other-user' });

    expect(response.status).toBe(201);
    createdCodes.push(response.body.data.shortCode);
  });

  it('fails open (creation still succeeds) while Redis is down', { timeout: 30_000 }, async () => {
    const user = await registerTrackedUser();
    const auth = { Authorization: `Bearer ${user.accessToken}` };

    execSync('docker stop linkforge-redis', { stdio: 'ignore' });
    try {
      const response = await request(app)
        .post('/api/v1/urls')
        .set(auth)
        .send({ originalUrl: 'https://example.com/rl-redis-down' });

      expect(response.status).toBe(201);
      // Fail-open means no limit is actually being enforced — spec §1.4
      // says the headers are omitted in that case, not sent with stale values.
      expect(response.headers['ratelimit-limit']).toBeUndefined();
      expect(response.headers['ratelimit-remaining']).toBeUndefined();
      createdCodes.push(response.body.data.shortCode);
    } finally {
      execSync('docker start linkforge-redis', { stdio: 'ignore' });
    }
  });
});
