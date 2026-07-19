import { env } from '../../config/env.js';
import { clickRepository, type ClickRepository } from './click.repository.js';
import type { NewClickEvent } from './click.types.js';

/**
 * Click ingestion port (docs/analytics-design.md §4).
 *
 * The sink is the seam the pipeline evolves through: Phase 1 persists
 * in-process (DatabaseClickSink), Phase 2 swaps in an enqueueing sink
 * (BullMQ) without touching callers. Implementations MUST be fail-open:
 * record() never throws — analytics may lose an event, the caller's
 * request may not fail. No business rules live here; the sink persists
 * exactly what it is given.
 */
export interface ClickSink {
  record(event: NewClickEvent): Promise<void>;
}

/**
 * No-op sink: analytics disabled. This is the wired default when
 * ANALYTICS_ENABLED is not "true" — current behavior, zero side effects —
 * mirroring NullRedirectCache.
 */
export class NullClickSink implements ClickSink {
  async record(): Promise<void> {}
}

/**
 * Phase 1 sink: writes straight to Postgres through the repository.
 * Failures are swallowed and logged on state transitions only (an outage
 * must not log per event) — dropped events are an accepted, *measured*
 * loss, never a thrown error.
 */
export class DatabaseClickSink implements ClickSink {
  private failing = false;

  constructor(private readonly clicks: ClickRepository) {}

  async record(event: NewClickEvent): Promise<void> {
    try {
      await this.clicks.insert(event);
      if (this.failing) {
        this.failing = false;
        console.log(JSON.stringify({ level: 'info', event: 'click_sink_recovered' }));
      }
    } catch (error) {
      if (!this.failing) {
        this.failing = true;
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'click_sink_error',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
      // Event dropped: analytics is best-effort by contract.
    }
  }
}

/**
 * Composition: database-backed when analytics is enabled, no-op otherwise.
 * Consumed by the redirect flow in the next phase.
 */
export const clickSink: ClickSink = env.analyticsEnabled
  ? new DatabaseClickSink(clickRepository)
  : new NullClickSink();
