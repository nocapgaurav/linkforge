import type { Request, Response } from 'express';
import { fail } from './response.js';

/**
 * Terminal middleware for unmatched routes: standard 404 envelope.
 * Mounted after all routers, before the error handler.
 */
export function notFoundHandler(req: Request, res: Response): void {
  fail(res, 404, 'NOT_FOUND', `Route not found: ${req.method} ${req.path}`);
}
