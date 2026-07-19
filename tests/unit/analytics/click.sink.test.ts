import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClickRepository } from '../../../src/modules/analytics/click.repository';
import { DatabaseClickSink, NullClickSink } from '../../../src/modules/analytics/click.sink';
import type { NewClickEvent } from '../../../src/modules/analytics/click.types';

const event: NewClickEvent = {
  eventId: 'e7b8a1c2-0f1d-4e2a-9b3c-4d5e6f7a8b9c',
  urlId: 42n,
  occurredAt: new Date('2026-07-19T12:00:00Z'),
  referrerHost: 't.co',
};

function makeRepo() {
  return {
    insert: vi.fn().mockResolvedValue(undefined),
    existsByEventId: vi.fn().mockResolvedValue(false),
  } satisfies ClickRepository;
}

describe('NullClickSink', () => {
  it('is a no-op that never throws', async () => {
    const sink = new NullClickSink();

    await expect(sink.record()).resolves.toBeUndefined();
  });
});

describe('DatabaseClickSink', () => {
  let repo: ReturnType<typeof makeRepo>;
  let sink: DatabaseClickSink;

  beforeEach(() => {
    repo = makeRepo();
    sink = new DatabaseClickSink(repo);
  });

  it('persists the event through the repository verbatim', async () => {
    await sink.record(event);

    expect(repo.insert).toHaveBeenCalledTimes(1);
    expect(repo.insert).toHaveBeenCalledWith(event);
  });

  it('never throws when the repository fails — the event is dropped', async () => {
    repo.insert.mockRejectedValue(new Error('database is down'));

    await expect(sink.record(event)).resolves.toBeUndefined();
  });

  it('keeps working after a failure (recovery path)', async () => {
    repo.insert.mockRejectedValueOnce(new Error('blip')).mockResolvedValue(undefined);

    await expect(sink.record(event)).resolves.toBeUndefined();
    await expect(sink.record(event)).resolves.toBeUndefined();
    expect(repo.insert).toHaveBeenCalledTimes(2);
  });
});
