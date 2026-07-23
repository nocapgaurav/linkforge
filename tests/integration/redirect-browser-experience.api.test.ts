import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { registerTestUser } from './helpers';

/**
 * End-to-end verification that a real browser (Accept: text/html) hitting a
 * dead or password-protected short link gets redirected to a frontend page
 * instead of a raw JSON body, while a plain API/test client (no Accept
 * header — exactly like every other test in this suite) keeps getting the
 * unchanged JSON envelope. FRONTEND_ORIGIN=http://localhost:3001 in .env is
 * what these redirect targets are built from.
 */

const HTML_ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
const FRONTEND = 'http://localhost:3001';

const createdCodes: string[] = [];
let auth: Awaited<ReturnType<typeof registerTestUser>>;

function asOwner() {
  return { Authorization: `Bearer ${auth.accessToken}` };
}

async function createLink(originalUrl: string): Promise<string> {
  const response = await request(app).post('/api/v1/urls').set(asOwner()).send({ originalUrl });
  expect(response.status).toBe(201);
  const shortCode = response.body.data.shortCode as string;
  createdCodes.push(shortCode);
  return shortCode;
}

beforeAll(async () => {
  auth = await registerTestUser(app);
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 250)); // let fire-and-forget writes settle
  await prisma.clickEvent.deleteMany({ where: { url: { shortCode: { in: createdCodes } } } });
  await prisma.url.deleteMany({ where: { shortCode: { in: createdCodes } } });
  await prisma.user.deleteMany({ where: { email: auth.email } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('browser-facing redirect experience', () => {
  it('a normal link redirects identically for browsers and API clients', async () => {
    const code = await createLink('https://example.com/browser-experience-normal');

    const browser = await request(app).get(`/${code}`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe('https://example.com/browser-experience-normal');

    const api = await request(app).get(`/${code}`);
    expect(api.status).toBe(302);
    expect(api.headers.location).toBe('https://example.com/browser-experience-normal');
  });

  it('an invalid short code: browser goes to the not-found page, API client still gets JSON 404', async () => {
    const browser = await request(app)
      .get('/this-code-never-existed')
      .set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(`${FRONTEND}/link/this-code-never-existed?reason=not-found`);

    const api = await request(app).get('/this-code-never-existed');
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
  });

  it('a deleted link sends a browser to the deleted page', async () => {
    const code = await createLink('https://example.com/browser-experience-deleted');
    await request(app).delete(`/api/v1/urls/${code}`).set(asOwner());

    const browser = await request(app).get(`/${code}`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(`${FRONTEND}/link/${code}?reason=deleted`);
  });

  it('an expired link sends a browser to the expired page', async () => {
    const code = await createLink('https://example.com/browser-experience-expired');
    await prisma.url.update({
      where: { shortCode: code },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const browser = await request(app).get(`/${code}`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(`${FRONTEND}/link/${code}?reason=expired`);
  });

  it('a click-exhausted link sends a browser to the limit-reached page', async () => {
    const code = await createLink('https://example.com/browser-experience-limit');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ maxClicks: 1 });
    await request(app).get(`/${code}`); // consume the one allowed click

    const browser = await request(app).get(`/${code}`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(`${FRONTEND}/link/${code}?reason=limit-reached`);
  });

  it('a password-protected link sends a browser to the unlock page with no error flag', async () => {
    const code = await createLink('https://example.com/browser-experience-password');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ password: 'sekrit123' });

    const browser = await request(app).get(`/${code}`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(`${FRONTEND}/unlock/${code}`);

    const api = await request(app).get(`/${code}`);
    expect(api.status).toBe(401);
    expect(api.body.error.code).toBe('PASSWORD_REQUIRED');
  });

  it('a wrong password sends a browser back to the unlock page with an error flag', async () => {
    const code = await createLink('https://example.com/browser-experience-wrong-password');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ password: 'sekrit123' });

    const browser = await request(app).get(`/${code}?password=nope`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(`${FRONTEND}/unlock/${code}?error=1`);
  });

  it('the correct password redirects a browser straight to the destination', async () => {
    const code = await createLink('https://example.com/browser-experience-correct-password');
    await request(app).patch(`/api/v1/urls/${code}`).set(asOwner()).send({ password: 'sekrit123' });

    const browser = await request(app).get(`/${code}?password=sekrit123`).set('Accept', HTML_ACCEPT);
    expect(browser.status).toBe(302);
    expect(browser.headers.location).toBe(
      'https://example.com/browser-experience-correct-password',
    );
  });
});
