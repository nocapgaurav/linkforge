import type { Response } from 'express';

/**
 * Response helpers — the only place success/error envelopes are built, so
 * every endpoint matches the API contract (api-v1-spec.md §1.3) by
 * construction.
 */

/** `200 OK` (or a caller-supplied status) with the success envelope. */
export function success<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

/** `201 Created` with an optional Location header (spec §2). */
export function created<T>(res: Response, data: T, location?: string): void {
  if (location) {
    res.setHeader('Location', location);
  }
  success(res, data, 201);
}

/**
 * `200 OK` for deletions. The envelope-everywhere rule wins over
 * `204 No Content` (spec §5), and `data` carries the deletion receipt.
 */
export function deleted<T>(res: Response, data: T): void {
  success(res, data, 200);
}

/** Error envelope body, shared by the error handler and 404 middleware. */
export function errorEnvelope(code: string, message: string, details?: unknown) {
  return {
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  };
}

/** Send an error envelope with the given HTTP status. */
export function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json(errorEnvelope(code, message));
}
