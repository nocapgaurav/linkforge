import { prisma } from '../../config/prisma.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import type { NewClickEvent } from './click.types.js';

/**
 * Persistence contract for click events. Append-only: there is no update,
 * no delete — events are facts (docs/analytics-design.md §3).
 */
export interface ClickRepository {
  /**
   * Persist a click event. Idempotent on eventId: replaying the same event
   * is a silent no-op (ON CONFLICT DO NOTHING via skipDuplicates), which is
   * what makes at-least-once delivery safe upstream.
   */
  insert(event: NewClickEvent): Promise<void>;

  /** True if an event with this idempotency key has already been stored. */
  existsByEventId(eventId: string): Promise<boolean>;
}

/**
 * Prisma-backed implementation — with url.repository.ts, one of the only
 * module files allowed to import Prisma. Persistence only, no rules: it
 * does not guard against foreign-key violations or database outages;
 * fail-open behavior is the sink's job.
 */
export class PrismaClickRepository implements ClickRepository {
  constructor(private readonly db: PrismaClient) {}

  async insert(event: NewClickEvent): Promise<void> {
    await this.db.clickEvent.createMany({
      data: [
        {
          eventId: event.eventId,
          urlId: event.urlId,
          occurredAt: event.occurredAt,
          ipHash: event.ipHash ?? null,
          country: event.country ?? null,
          city: event.city ?? null,
          browser: event.browser ?? null,
          browserVersion: event.browserVersion ?? null,
          os: event.os ?? null,
          device: event.device ?? null,
          referrerHost: event.referrerHost ?? null,
          requestId: event.requestId ?? null,
        },
      ],
      skipDuplicates: true,
    });
  }

  async existsByEventId(eventId: string): Promise<boolean> {
    const found = await this.db.clickEvent.findUnique({
      where: { eventId },
      select: { id: true },
    });
    return found !== null;
  }
}

/** Application-wide repository instance wired to the shared Prisma client. */
export const clickRepository: ClickRepository = new PrismaClickRepository(prisma);
