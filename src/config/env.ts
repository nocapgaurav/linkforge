import 'dotenv/config';

const DEFAULT_PORT = 3000;

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const env = {
  port: Number(process.env.PORT ?? DEFAULT_PORT),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  databaseUrl: required('DATABASE_URL'),
  /** Optional: absent means "run without Redis" (NullRedirectCache). */
  redisUrl: process.env.REDIS_URL,
  /** Opt-in: anything but "true" means analytics is off (NullClickSink). */
  analyticsEnabled: process.env.ANALYTICS_ENABLED === 'true',
  /** Optional: browser origin allowed to call the API (CORS). Unset = no CORS headers. */
  frontendOrigin: process.env.FRONTEND_ORIGIN,
  /**
   * Public origin short links are served from; used to build shortUrl.
   * Named PUBLIC_BASE_URL because plain BASE_URL is a reserved Vite/Vitest
   * builtin (set to '/') that would shadow ours in tests.
   */
  baseUrl: (
    process.env.PUBLIC_BASE_URL ?? `http://localhost:${process.env.PORT ?? DEFAULT_PORT}`
  ).replace(/\/+$/, ''),
};
