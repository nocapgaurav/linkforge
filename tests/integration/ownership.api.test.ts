import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { registerTestUser } from './helpers';

/**
 * Ownership end to end: two real users, one link, every management surface.
 * Cross-owner access must be indistinguishable from a missing code (404),
 * and the public redirect must ignore ownership entirely.
 */

let alice: Awaited<ReturnType<typeof registerTestUser>>;
let bob: Awaited<ReturnType<typeof registerTestUser>>;
let code: string;

const asUser = (token: string) => ({ Authorization: `Bearer ${token}` });

beforeAll(async () => {
  alice = await registerTestUser(app);
  bob = await registerTestUser(app);

  const created = await request(app)
    .post('/api/v1/urls')
    .set(asUser(alice.accessToken))
    .send({ originalUrl: 'https://example.com/owned-by-alice' });
  expect(created.status).toBe(201);
  code = created.body.data.shortCode;
});

afterAll(async () => {
  // The redirect test's fire-and-forget click insert can land after teardown
  // begins; let it settle before clearing children ahead of the FK parent.
  await new Promise((resolve) => setTimeout(resolve, 250));
  await prisma.clickEvent.deleteMany({ where: { url: { shortCode: code } } });
  await prisma.url.deleteMany({ where: { shortCode: code } });
  await prisma.user.deleteMany({ where: { email: { in: [alice.email, bob.email] } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('management plane requires authentication', () => {
  it('every management endpoint is 401 without a token', async () => {
    const responses = await Promise.all([
      request(app).post('/api/v1/urls').send({ originalUrl: 'https://example.com/x' }),
      request(app).get('/api/v1/urls'),
      request(app).get(`/api/v1/urls/${code}`),
      request(app).delete(`/api/v1/urls/${code}`),
      request(app).get(`/api/v1/urls/${code}/analytics`),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('cross-owner access is a plain 404', () => {
  it("bob cannot read alice's link metadata", async () => {
    const response = await request(app)
      .get(`/api/v1/urls/${code}`)
      .set(asUser(bob.accessToken));

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it("bob cannot read alice's analytics", async () => {
    const response = await request(app)
      .get(`/api/v1/urls/${code}/analytics`)
      .set(asUser(bob.accessToken));

    expect(response.status).toBe(404);
  });

  it("bob cannot delete alice's link — and it stays alive", async () => {
    const response = await request(app)
      .delete(`/api/v1/urls/${code}`)
      .set(asUser(bob.accessToken));

    expect(response.status).toBe(404);
    const row = await prisma.url.findUniqueOrThrow({ where: { shortCode: code } });
    expect(row.deletedAt).toBeNull();
  });

  it("bob's list never contains alice's link", async () => {
    const response = await request(app)
      .get('/api/v1/urls?limit=100')
      .set(asUser(bob.accessToken));

    expect(response.status).toBe(200);
    const codes = response.body.data.items.map((i: { shortCode: string }) => i.shortCode);
    expect(codes).not.toContain(code);
  });
});

describe('the owner keeps full access', () => {
  it('alice sees her link in list, metadata, and analytics', async () => {
    const list = await request(app)
      .get('/api/v1/urls?limit=100')
      .set(asUser(alice.accessToken));
    expect(
      list.body.data.items.map((i: { shortCode: string }) => i.shortCode),
    ).toContain(code);

    const metadata = await request(app)
      .get(`/api/v1/urls/${code}`)
      .set(asUser(alice.accessToken));
    expect(metadata.status).toBe(200);

    const analytics = await request(app)
      .get(`/api/v1/urls/${code}/analytics`)
      .set(asUser(alice.accessToken));
    expect(analytics.status).toBe(200);
  });
});

describe('redirects stay public', () => {
  it('resolves with no token at all', async () => {
    const response = await request(app).get(`/${code}`);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://example.com/owned-by-alice');
  });
});
