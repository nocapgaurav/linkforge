import express from 'express';

import { healthRouter } from './routes/health.routes.js';
import { errorHandler } from './shared/http/error-handler.js';
import { notFoundHandler } from './shared/http/not-found.js';
import { requestId } from './shared/http/request-id.js';
import { requestLogger } from './shared/middleware/request-logger.js';

const app = express();

app.disable('x-powered-by');

// Order matters: id first (everything downstream logs it), logger second
// (captures every response, including 404s and errors), parser third.
app.use(requestId);
app.use(requestLogger);
app.use(express.json());

app.use(healthRouter);

// Terminal handlers: unmatched routes, then the global error mapper.
app.use(notFoundHandler);
app.use(errorHandler);

export default app;
