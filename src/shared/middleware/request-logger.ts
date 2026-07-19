import type { NextFunction, Request, Response } from 'express';

/**
 * Structured request logging: one JSON line per completed response.
 * Deliberately console-based for now — the shape (method, path, status,
 * durationMs, requestId) is what matters; swapping in pino later only
 * changes the transport.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    console.log(
      JSON.stringify({
        level: 'info',
        event: 'http_request',
        method: req.method,
        path: req.originalUrl,
        status: res.statusCode,
        durationMs: Math.round(durationMs * 10) / 10,
        requestId: req.requestId,
      }),
    );
  });

  next();
}
