import type { RequestHandler } from 'express';

/**
 * Minimal, dependency-free CORS middleware for a single configured origin.
 *
 * When no origin is configured the middleware is a pure pass-through and
 * the API behaves exactly as before (no CORS headers, browsers blocked) —
 * CORS is opt-in per deployment via FRONTEND_ORIGIN, never hardcoded.
 *
 * `Vary: Origin` is set whenever CORS is active so shared caches never
 * serve a response with one origin's headers to another origin.
 */
export function corsMiddleware(allowedOrigin: string | undefined): RequestHandler {
  const origin = allowedOrigin?.replace(/\/+$/, '');

  return (req, res, next) => {
    if (!origin) {
      next();
      return;
    }

    res.setHeader('Vary', 'Origin');
    if (req.headers.origin === origin) {
      res.setHeader('Access-Control-Allow-Origin', origin);
      if (req.method === 'OPTIONS') {
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Access-Control-Max-Age', '86400');
        res.status(204).end();
        return;
      }
    }
    next();
  };
}
