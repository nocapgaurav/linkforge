/**
 * Local/demo data only — never wired into any production deploy path.
 *
 * `prisma migrate deploy` (the only command a real deployment should ever
 * run) never invokes this file; only `prisma db seed`, `prisma migrate dev`,
 * and `prisma migrate reset` do, and all three are developer-only commands.
 * The NODE_ENV guard below is a second, explicit line of defense in case
 * this script is ever invoked somewhere it shouldn't be.
 *
 * Run: `pnpm db:seed` (see package.json). Idempotent — safe to run more
 * than once; re-running just confirms the demo account still exists.
 */
import bcrypt from 'bcrypt';
import { env } from '../src/config/env.js';
import { disconnectPrisma, prisma } from '../src/config/prisma.js';

const DEMO_EMAIL = 'demo@linkforge.local';
const DEMO_PASSWORD = 'demo-password';
const DEMO_DISPLAY_NAME = 'Demo User';

async function main(): Promise<void> {
  if (env.nodeEnv === 'production') {
    throw new Error('Refusing to seed demo data: NODE_ENV=production.');
  }

  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, env.bcryptCost);
  const user = await prisma.user.upsert({
    where: { email: DEMO_EMAIL },
    update: {},
    create: { email: DEMO_EMAIL, displayName: DEMO_DISPLAY_NAME, passwordHash },
  });

  console.log(
    JSON.stringify({
      level: 'info',
      event: 'seed_complete',
      email: user.email,
      note: `Demo credentials: ${DEMO_EMAIL} / ${DEMO_PASSWORD}`,
    }),
  );
}

main()
  .then(() => disconnectPrisma())
  .catch(async (error) => {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'seed_failed',
        error: error instanceof Error ? error.message : String(error),
      }),
    );
    await disconnectPrisma();
    process.exit(1);
  });
