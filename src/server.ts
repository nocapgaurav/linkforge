import app from './app.js';
import { env } from './config/env.js';
import { disconnectPrisma } from './config/prisma.js';
import { disconnectRedis } from './config/redis.js';

const SHUTDOWN_TIMEOUT_MS = 10_000;

const server = app.listen(env.port, () => {
  console.log(
    JSON.stringify({ level: 'info', event: 'server_started', port: env.port }),
  );
});

let shuttingDown = false;

/**
 * Graceful shutdown: stop accepting connections, let in-flight requests
 * finish, then release the database pool. A watchdog force-exits if
 * anything hangs past the timeout.
 */
function shutdown(signal: NodeJS.Signals): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(JSON.stringify({ level: 'info', event: 'shutdown_started', signal }));

  const watchdog = setTimeout(() => {
    console.error(
      JSON.stringify({ level: 'error', event: 'shutdown_forced', timeoutMs: SHUTDOWN_TIMEOUT_MS }),
    );
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  watchdog.unref();

  server.close((closeError) => {
    void (async () => {
      try {
        await disconnectPrisma();
        await disconnectRedis();
        if (closeError) throw closeError;
        console.log(JSON.stringify({ level: 'info', event: 'shutdown_complete' }));
        process.exit(0);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: 'error',
            event: 'shutdown_failed',
            error: error instanceof Error ? error.message : String(error),
          }),
        );
        process.exit(1);
      }
    })();
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
