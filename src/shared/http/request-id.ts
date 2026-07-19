import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

declare global {
  // Augments Express's Request via declaration merging — the standard way
  // to type custom request properties.
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Unique id assigned to this request; present on every request. */
      requestId: string;
    }
  }
}

/**
 * Assigns a UUID to every request and echoes it as the X-Request-Id
 * response header (api-v1-spec.md §1.4) so users can quote it in support
 * requests and logs can be correlated. Must be the first middleware so the
 * id exists for everything downstream, including the logger.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}
