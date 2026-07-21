import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { PrismaClickRepository } from '../../src/modules/analytics/click.repository';

const clickRepository = new PrismaClickRepository(prisma);

/**
 * Repository integration tests against the real Postgres from
 * docker-compose. A parent url row is created directly (the FK requires
 * one) and everything is cleaned up afterwards.
 */

let ownerId: bigint;
let urlId: bigint;
const eventIds: string[] = [];

function newEventId(): string {
  const id = randomUUID();
  eventIds.push(id);
  return id;
}

beforeAll(async () => {
  const owner = await prisma.user.create({
    data: {
      email: `clk-${randomUUID()}@test.linkforge.local`,
      displayName: 'Click Fixture',
      passwordHash: 'x'.repeat(60),
    },
  });
  ownerId = owner.id;
  const url = await prisma.url.create({
    data: {
      shortCode: `clk${Date.now().toString(36)}`,
      originalUrl: 'https://example.com/analytics-target',
      urlHash: 'c'.repeat(64),
      createdBy: ownerId,
    },
  });
  urlId = url.id;
});

afterAll(async () => {
  await prisma.clickEvent.deleteMany({ where: { eventId: { in: eventIds } } });
  await prisma.url.delete({ where: { id: urlId } });
  await prisma.user.deleteMany({ where: { id: ownerId } });
  await disconnectPrisma();
});

describe('PrismaClickRepository', () => {
  it('inserts a minimal (un-enriched) event with all dimensions null', async () => {
    const eventId = newEventId();
    const occurredAt = new Date('2026-07-19T10:00:00Z');

    await clickRepository.insert({ eventId, urlId, occurredAt });

    const row = await prisma.clickEvent.findUnique({ where: { eventId } });
    expect(row).not.toBeNull();
    expect(row?.urlId).toBe(urlId);
    expect(row?.occurredAt.toISOString()).toBe(occurredAt.toISOString());
    expect(row?.ipHash).toBeNull();
    expect(row?.country).toBeNull();
    expect(row?.referrerHost).toBeNull();
  });

  it('inserts a fully-populated event verbatim', async () => {
    const eventId = newEventId();
    const ipHash = new Uint8Array(16).fill(7);

    await clickRepository.insert({
      eventId,
      urlId,
      occurredAt: new Date(),
      ipHash,
      country: 'DE',
      city: 'Berlin',
      browser: 'firefox',
      browserVersion: '128',
      os: 'linux',
      device: 'desktop',
      referrerHost: 'news.ycombinator.com',
      requestId: randomUUID(),
    });

    const row = await prisma.clickEvent.findUnique({ where: { eventId } });
    expect(row?.country).toBe('DE');
    expect(row?.browser).toBe('firefox');
    expect(row?.device).toBe('desktop');
    expect(row?.referrerHost).toBe('news.ycombinator.com');
    expect(Array.from(row?.ipHash ?? [])).toEqual(Array.from(ipHash));
  });

  it('is idempotent on eventId: replaying an event neither throws nor duplicates', async () => {
    const eventId = newEventId();
    const event = { eventId, urlId, occurredAt: new Date(), country: 'US' };

    await clickRepository.insert(event);
    await expect(clickRepository.insert(event)).resolves.toBeUndefined();
    // Even a replay with different payload is ignored — first write wins.
    await expect(
      clickRepository.insert({ ...event, country: 'FR' }),
    ).resolves.toBeUndefined();

    const rows = await prisma.clickEvent.findMany({ where: { eventId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].country).toBe('US');
  });

  it('existsByEventId reflects stored vs unknown keys', async () => {
    const eventId = newEventId();
    await clickRepository.insert({ eventId, urlId, occurredAt: new Date() });

    await expect(clickRepository.existsByEventId(eventId)).resolves.toBe(true);
    await expect(clickRepository.existsByEventId(randomUUID())).resolves.toBe(false);
  });

  it('surfaces foreign-key violations (guarding is the sink’s job, not the repository’s)', async () => {
    await expect(
      clickRepository.insert({
        eventId: newEventId(),
        urlId: 999_999_999n,
        occurredAt: new Date(),
      }),
    ).rejects.toThrow();
  });
});
