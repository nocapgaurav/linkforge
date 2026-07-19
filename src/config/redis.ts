import { Redis } from 'ioredis';
import { env } from './env.js';

/**
 * Redis client factory — the only file in the application that imports
 * ioredis, mirroring the Prisma quarantine in config/prisma.ts.
 *
 * The client is tuned for a fail-open cache on the redirect hot path
 * (docs/redis-cache-design.md §4):
 * - lazyConnect: creating the singleton has zero side effects; the
 *   connection is established on first command.
 * - enableOfflineQueue false + no per-command retries: a dead Redis costs
 *   at most one fast failure, never a queued backlog.
 * - commandTimeout caps worst-case added latency per command.
 * - reconnection happens in the background with capped backoff.
 *
 * `null` when REDIS_URL is not configured — callers must handle that
 * (the composition in url.cache.ts selects NullRedirectCache).
 */

const COMMAND_TIMEOUT_MS = 100;
const RECONNECT_BACKOFF_CAP_MS = 5_000;

function createClient(redisUrl: string): Redis {
  const client = new Redis(redisUrl, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 0,
    commandTimeout: COMMAND_TIMEOUT_MS,
    retryStrategy: (times) => Math.min(times * 200, RECONNECT_BACKOFF_CAP_MS),
  });

  // ioredis emits 'error' for connection failures; without a listener the
  // process crashes on an unhandled error event. Log state transitions
  // only — a down Redis must not produce one log line per request.
  let lastLoggedError = '';
  client.on('error', (error: Error) => {
    if (error.message !== lastLoggedError) {
      lastLoggedError = error.message;
      console.error(
        JSON.stringify({ level: 'error', event: 'redis_error', error: error.message }),
      );
    }
  });
  client.on('ready', () => {
    lastLoggedError = '';
    console.log(JSON.stringify({ level: 'info', event: 'redis_ready' }));
  });

  return client;
}

export const redisClient: Redis | null = env.redisUrl ? createClient(env.redisUrl) : null;

/** Close the connection on shutdown; safe when Redis was never configured. */
export async function disconnectRedis(): Promise<void> {
  if (!redisClient) return;
  try {
    await redisClient.quit();
  } catch {
    // quit() requires a live connection; force-close is fine for a cache.
    redisClient.disconnect();
  }
}
