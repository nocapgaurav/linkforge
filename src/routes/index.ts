import { Router } from 'express';
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
v1Router.use('/urls', urlRouter);

export const apiRouter = Router();
apiRouter.use('/v1', v1Router);
