import { Router } from 'express';
import { analyticsRouter } from '../modules/analytics/analytics.routes.js';
import { authenticate } from '../modules/auth/auth.middleware.js';
import { authRouter } from '../modules/auth/auth.routes.js';
import { urlRouter } from '../modules/url/url.routes.js';

/** Liveness probe, mounted at the domain root ahead of all other routes. */
export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

/**
 * Versioned API composition root. Each version is its own sub-router so a
 * future v2 (or an internal API) is one extra `apiRouter.use(...)` line
 * without touching existing routes.
 */
const v1Router = Router();
v1Router.use('/auth', authRouter);
// One gate for the whole management plane (link CRUD + analytics). The
// public redirect lives at the domain root and never passes through here.
v1Router.use('/urls', authenticate);
v1Router.use('/urls', urlRouter);
v1Router.use('/urls', analyticsRouter);

export const apiRouter = Router();
apiRouter.use('/v1', v1Router);
