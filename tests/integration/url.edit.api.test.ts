import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { registerTestUser } from './helpers';

/**
 * PATCH /api/v1/urls/:shortCode and the redirect-time consequences of
 * editing a link: password protection, click-limit expiration, and
 * active/inactive status, all against the real stack.
 */

let owner: Awaited<ReturnType<typeof registerTestUser>>;
let stranger: Awaited<ReturnType<typeof registerTestUser>>;
const createdCodes: string[] = [];

const asOwner = () => ({ Authorization: `Bearer ${owner.accessToken}` });
const asStranger = () => ({ Authorization: `Bearer ${stranger.accessToken}` });

async function createLink(originalUrl: string): Promise<string> {
  const response = await request(app)
    .post('/api/v1/urls')
    .set(asOwner())
    .send({ originalUrl });
  expect(response.status).toBe(201);
  const shortCode = response.body.data.shortCode as string;
  createdCodes.push(shortCode);
  return shortCode;
}

/** click_events insertion is fire-and-forget; poll briefly for it to land. */
async function waitForClickCount(shortCode: string, expected: number, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const row = await prisma.url.findUnique({ where: { shortCode } });
    if (row && Number(row.clickCount) >= expected) return;
    if (Date.now() > deadline) throw new Error(`clickCount never reached ${expected}`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

beforeAll(async () => {
  owner = await registerTestUser(app);
  stranger = await registerTestUser(app);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250)); // let fire-and-forget writes settle
  await prisma.clickEvent.deleteMany({ where: { url: { shortCode: { in: createdCodes } } } });
  await prisma.url.deleteMany({ where: { shortCode: { in: createdCodes } } });
  await prisma.user.deleteMany({ where: { email: { in: [owner.email, stranger.email] } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('PATCH /api/v1/urls/:shortCode', () => {
  it('applies a partial update and returns the changed resource', async () => {
    const code = await createLink('https://example.com/edit-original');

    const response = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ originalUrl: 'https://example.com/edited', isActive: false });

    expect(response.status).toBe(200);
    expect(response.body.data.originalUrl).toBe('https://example.com/edited');
    expect(response.body.data.isActive).toBe(false);
    // Untouched fields survive the partial update unchanged.
    expect(response.body.data.shortCode).toBe(code);
  });

  it('sets and later clears an expiration date', async () => {
    const code = await createLink('https://example.com/edit-expiry');
    const future = new Date(Date.now() + 60_000).toISOString();

    const withExpiry = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ expiresAt: future });
    expect(withExpiry.status).toBe(200);
    expect(withExpiry.body.data.expiresAt).toBe(future);

    const cleared = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ expiresAt: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.expiresAt).toBeNull();
  });

  it('rejects a past expiresAt — scheduling is always in the future', async () => {
    const code = await createLink('https://example.com/edit-past-expiry');

    const response = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ expiresAt: '2020-01-01T00:00:00Z' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('sets a password: hasPassword becomes true, the hash is never returned', async () => {
    const code = await createLink('https://example.com/edit-password');

    const response = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ password: 'unlock-me' });

    expect(response.status).toBe(200);
    expect(response.body.data.hasPassword).toBe(true);
    expect(response.body.data).not.toHaveProperty('passwordHash');
    expect(response.body.data).not.toHaveProperty('password');
    const row = await prisma.url.findUniqueOrThrow({ where: { shortCode: code } });
    expect(row.passwordHash).toMatch(/^\$2b\$/);
  });

  it('removes password protection via explicit null', async () => {
    const code = await createLink('https://example.com/edit-password-remove');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ password: 'temp-pass' });

    const response = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ password: null });

    expect(response.status).toBe(200);
    expect(response.body.data.hasPassword).toBe(false);
  });

  it('rejects invalid update bodies: bad url, non-positive maxClicks, short password, unknown field', async () => {
    const code = await createLink('https://example.com/edit-invalid');

    for (const body of [
      { originalUrl: 'not a url' },
      { maxClicks: 0 },
      { maxClicks: -5 },
      { password: 'abc' },
      { somethingUnknown: true },
    ]) {
      const response = await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send(body);
      expect(response.status, JSON.stringify(body)).toBe(400);
      expect(response.body.error.code).toBe('VALIDATION_ERROR');
    }
  });

  it('returns 404 for an unknown short code', async () => {
    const response = await request(app)
      .patch('/api/v1/urls/doesnotexist')
      .set(asOwner())
      .send({ isActive: false });

    expect(response.status).toBe(404);
  });

  it("returns 404 for another owner's link, which remains unchanged", async () => {
    const code = await createLink('https://example.com/edit-not-yours');

    const response = await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asStranger())
      .send({ isActive: false });

    expect(response.status).toBe(404);
    const row = await prisma.url.findUniqueOrThrow({ where: { shortCode: code } });
    expect(row.isActive).toBe(true);
  });
});

describe('redirect behavior after editing: status', () => {
  it('an active link redirects; deactivating it kills the redirect; reactivating restores it', async () => {
    const code = await createLink('https://example.com/status-flow');

    await expect(request(app).get(`/${code}`)).resolves.toMatchObject({ status: 302 });

    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ isActive: false });
    const whileInactive = await request(app).get(`/${code}`);
    expect(whileInactive.status).toBe(404);

    // Analytics/metadata remain accessible for an inactive link.
    const metadata = await request(app).get(`/api/v1/urls/${code}`).set(asOwner());
    expect(metadata.status).toBe(200);
    expect(metadata.body.data.isActive).toBe(false);

    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ isActive: true });
    const reactivated = await request(app).get(`/${code}`);
    expect(reactivated.status).toBe(302);
  });
});

describe('redirect behavior after editing: expiration by date', () => {
  it('an expired link 404s on redirect but stays analytics-visible', async () => {
    const code = await createLink('https://example.com/date-expired');
    // PATCH only accepts future dates; backdate directly to simulate the
    // passage of time (same technique url.cache.api.test.ts already uses
    // to mutate rows behind the API's back).
    await prisma.url.update({
      where: { shortCode: code },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const response = await request(app).get(`/${code}`);
    expect(response.status).toBe(404);

    const metadata = await request(app).get(`/api/v1/urls/${code}`).set(asOwner());
    expect(metadata.status).toBe(200);
  });
});

describe('redirect behavior after editing: expiration by click count', () => {
  it('redirects while under the limit, then 404s once exhausted — analytics remain available', async () => {
    const code = await createLink('https://example.com/click-limited');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ maxClicks: 2 });

    const first = await request(app).get(`/${code}`);
    const second = await request(app).get(`/${code}`);
    const third = await request(app).get(`/${code}`);

    expect(first.status).toBe(302);
    expect(second.status).toBe(302);
    expect(third.status).toBe(404);

    await waitForClickCount(code, 2);
    const analytics = await request(app)
      .get(`/api/v1/urls/${code}/analytics`)
      .set(asOwner());
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.summary.totalClicks).toBe(2);
  });
});

describe('redirect behavior after editing: password protection', () => {
  it('requires the password, rejects wrong/missing identically, then redirects on success', async () => {
    const code = await createLink('https://example.com/password-flow');
    await request(app)
      .patch(`/api/v1/urls/${code}`)
      .set(asOwner())
      .send({ password: 'sesame-open' });

    const noPassword = await request(app).get(`/${code}`);
    const wrongPassword = await request(app).get(`/${code}`).query({ password: 'wrong' });
    expect(noPassword.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(noPassword.body.error.code).toBe('PASSWORD_REQUIRED');
    expect(wrongPassword.body.error.code).toBe('PASSWORD_REQUIRED');
    expect(noPassword.body.error.message).toBe(wrongPassword.body.error.message);

    const correct = await request(app).get(`/${code}`).query({ password: 'sesame-open' });
    expect(correct.status).toBe(302);
    expect(correct.headers['location']).toBe('https://example.com/password-flow');
  });

  it('a failed password attempt does not consume a click', async () => {
    const code = await createLink('https://example.com/password-no-consume');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ password: 'right-pass' });

    await request(app).get(`/${code}`).query({ password: 'wrong' });
    await request(app).get(`/${code}`).query({ password: 'wrong' });
    await request(app).get(`/${code}`).query({ password: 'right-pass' }); // the only real redirect

    await waitForClickCount(code, 1);
    const row = await prisma.url.findUniqueOrThrow({ where: { shortCode: code } });
    expect(Number(row.clickCount)).toBe(1);
  });
});
