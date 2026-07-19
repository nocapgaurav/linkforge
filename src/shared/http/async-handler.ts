import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

/**
 * Wraps an async controller so rejections flow to the global error handler —
 * controllers never write try/catch. (Express 5 forwards rejected promises
 * natively; the wrapper keeps the contract explicit and survives a future
 * router/framework change without touching controllers.)
 */
export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
