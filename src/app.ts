import express from 'express';
import helmet from 'helmet';

import { env } from './config/env.js';
import { apiRouter, healthRouter } from './routes/index.js';
import { redirectRouter } from './modules/url/url.routes.js';
import { corsMiddleware } from './shared/http/cors.js';
import { errorHandler } from './shared/http/error-handler.js';
import { notFoundHandler } from './shared/http/not-found.js';
import { requestId } from './shared/http/request-id.js';
import { requestLogger } from './shared/middleware/request-logger.js';

const app = express();

app.disable('x-powered-by');
// Baseline security headers (CSP, X-Content-Type-Options, HSTS, etc.) for
// every response. crossOriginResourcePolicy is relaxed from helmet's
// same-origin default because the frontend legitimately calls this API
// from a different origin/port (see corsMiddleware below) — CORP is about
// which origins may fetch a response at all, a separate concern from CORS's
// origin allowlist, and helmet's stricter default would fight it.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));

// Middleware order is load-bearing:
// requestId first (everything downstream logs it), logger second (captures
// every response including 404s/errors), parser third, then routes from
// most-specific to least: health, versioned API, and only then the
// root-level redirect catch-all — so /api/... is never read as a short code.
app.use(requestId);
app.use(requestLogger);
// CORS before the parser so preflights short-circuit without body parsing.
app.use(corsMiddleware(env.frontendOrigin));
app.use(express.json());

app.use(healthRouter);
app.use('/api', apiRouter);
app.use(redirectRouter);

// Terminal handlers: unmatched routes, then the global error mapper.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
