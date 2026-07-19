import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { NullClickSink } from '../../src/modules/analytics/click.sink';
import { NullRedirectCache } from '../../src/modules/url/url.cache';
import { urlRepository } from '../../src/modules/url/url.repository';
import { DefaultUrlService } from '../../src/modules/url/url.service';

/**
 * End-to-end click recording (real Postgres + Redis via the app wiring,
 * which has ANALYTICS_ENABLED=true → DatabaseClickSink). Recording is
 * fire-and-forget, so assertions poll.
 */

const createdIds: bigint[] = [];

async function createLink(originalUrl: string): Promise<{ shortCode: string; id: bigint }> {
  const response = await request(app).post('/api/v1/urls').send({ originalUrl });
  expect(response.status).toBe(201);
  const shortCode = response.body.data.shortCode as string;
  const row = await prisma.url.findUnique({ where: { shortCode } });
  if (!row) throw new Error('created link not found');
  createdIds.push(row.id);
  return { shortCode, id: row.id };
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await check()) return;
    if (Date.now() > deadline) throw new Error('condition never became true');
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

afterAll(async () => {
  if (createdIds.length > 0) {
    await prisma.clickEvent.deleteMany({ where: { urlId: { in: createdIds } } });
    await prisma.url.deleteMany({ where: { id: { in: createdIds } } });
  }
  await disconnectRedis();
  await disconnectPrisma();
});

describe('click recording on redirects', () => {
  it('a redirect creates a click_events row for the link', async () => {
    const { shortCode, id } = await createLink('https://example.com/click-one');

    const response = await request(app).get(`/${shortCode}`);
    expect(response.status).toBe(302);

    await waitFor(async () => (await prisma.clickEvent.count({ where: { urlId: id } })) === 1);
    const event = await prisma.clickEvent.findFirst({ where: { urlId: id } });
    expect(event?.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(event?.occurredAt).toBeInstanceOf(Date);
    // Phase 2 records identity only; enrichment fields stay null for now.
    expect(event?.country).toBeNull();
    expect(event?.browser).toBeNull();
  });

  it('multiple redirects create one event each (miss AND hit paths) and bump clickCount', async () => {
    const { shortCode, id } = await createLink('https://example.com/click-many');

    // First redirect = cache miss; the next two are served from Redis.
    for (let i = 0; i < 3; i++) {
      const response = await request(app).get(`/${shortCode}`);
      expect(response.status).toBe(302);
    }

    await waitFor(async () => (await prisma.clickEvent.count({ where: { urlId: id } })) === 3);
    const events = await prisma.clickEvent.findMany({ where: { urlId: id } });
    expect(new Set(events.map((e) => e.eventId)).size).toBe(3);

    // The approximate display counter catches up too (fire-and-forget).
    await waitFor(async () => {
      const meta = await request(app).get(`/api/v1/urls/${shortCode}`);
      return meta.body.data.clickCount === 3;
    });
  });

  it('with analytics disabled (NullClickSink) no events are written', async () => {
    const { shortCode, id } = await createLink('https://example.com/click-disabled');

    // The disabled composition: same real repository, no-op sink.
    const disabledService = new DefaultUrlService(
      urlRepository,
      new NullRedirectCache(),
      new NullClickSink(),
    );
    const target = await disabledService.getByShortCode(shortCode);
    expect(target.originalUrl).toBe('https://example.com/click-disabled');

    // Give any (erroneous) fire-and-forget write time to land, then assert none did.
    await new Promise((resolve) => setTimeout(resolve, 200));
    await expect(prisma.clickEvent.count({ where: { urlId: id } })).resolves.toBe(0);
  });
});
