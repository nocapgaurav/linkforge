import type { NextFunction, Request, Response } from 'express';
import { UnauthorizedError } from './auth.errors.js';
import { verifyAccessToken } from './auth.tokens.js';

declare global {
  // Augments Express's Request via declaration merging (same pattern as
  // requestId in shared/http/request-id.ts).
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Set by `authenticate`; absent on public routes. */
      user?: { id: bigint };
    }
  }
}

/**
 * Requires a valid Bearer access token and attaches the authenticated
 * user id to the request. Stateless — the JWT is the proof; no database
 * touch, so protected reads stay as fast as public ones. Failures flow to
 * the global error handler as UnauthorizedError (401).
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
  if (!token) {
    next(new UnauthorizedError());
    return;
  }
  verifyAccessToken(token)
    .then((userId) => {
      req.user = { id: userId };
      next();
    })
    .catch(next);
}

/**
 * Typed accessor for handlers behind `authenticate`. Throwing (rather than
 * returning undefined) turns a mis-mounted route into a loud 401 instead
 * of a silent unscoped query.
 */
export function requireUser(req: Request): { id: bigint } {
  if (!req.user) {
    throw new UnauthorizedError();
  }
  return req.user;
}
