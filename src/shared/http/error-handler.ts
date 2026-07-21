import type { NextFunction, Request, Response } from 'express';
import { InvalidCredentialsError, UnauthorizedError } from '../../modules/auth/auth.errors.js';
import {
  AliasAlreadyExistsError,
  LinkPasswordRequiredError,
  UrlNotFoundError,
} from '../../modules/url/url.errors.js';
import { EmailTakenError } from '../../modules/user/user.types.js';
import type { ValidationFailure } from '../../utils/validation.js';
import { errorEnvelope, fail } from './response.js';

/**
 * Throwable wrapper for a validation failure. Controllers do:
 *
 *   const result = validateCreateUrlBody(req.body);
 *   if (!result.success) throw new RequestValidationError(result);
 *
 * and the global error handler serializes the failure — which is already in
 * the public envelope shape — as the 400 response body.
 */
export class RequestValidationError extends Error {
  readonly failure: ValidationFailure;

  constructor(failure: ValidationFailure) {
    super(failure.error.message);
    this.name = 'RequestValidationError';
    this.failure = failure;
  }
}

/** Body-parser JSON syntax errors carry this type tag. */
function isJsonParseError(error: Error): boolean {
  return (
    error instanceof SyntaxError && 'type' in error && error.type === 'entity.parse.failed'
  );
}

/**
 * Global error handler — the single place errors become HTTP responses.
 * Domain errors map per api-v1-spec.md; anything unrecognized is logged with
 * the request id and answered with a generic 500 so internals never leak.
 *
 * (Express identifies error middleware by arity, so all four parameters
 * must be declared even though `next` is only used for the headers-sent
 * delegation case.)
 */
export function errorHandler(
  error: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    // The response already started streaming; let Express abort the socket.
    next(error);
    return;
  }

  if (error instanceof RequestValidationError) {
    res.status(400).json(error.failure);
    return;
  }
  if (error instanceof UrlNotFoundError) {
    fail(res, 404, 'NOT_FOUND', error.message);
    return;
  }
  if (error instanceof AliasAlreadyExistsError) {
    fail(res, 409, 'ALIAS_TAKEN', error.message);
    return;
  }
  if (error instanceof LinkPasswordRequiredError) {
    fail(res, 401, 'PASSWORD_REQUIRED', error.message);
    return;
  }
  if (error instanceof InvalidCredentialsError) {
    fail(res, 401, 'INVALID_CREDENTIALS', error.message);
    return;
  }
  if (error instanceof UnauthorizedError) {
    fail(res, 401, 'UNAUTHORIZED', error.message);
    return;
  }
  if (error instanceof EmailTakenError) {
    fail(res, 409, 'EMAIL_TAKEN', error.message);
    return;
  }
  if (error instanceof Error && isJsonParseError(error)) {
    fail(res, 400, 'MALFORMED_JSON', 'Request body is not valid JSON.');
    return;
  }

  // ShortCodeGenerationError and every unknown error: server fault. Log the
  // real cause for operators, return a generic message to the client.
  console.error(
    JSON.stringify({
      level: 'error',
      event: 'unhandled_error',
      requestId: req.requestId,
      method: req.method,
      path: req.originalUrl,
      error: error instanceof Error ? { name: error.name, message: error.message } : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    }),
  );
  res.status(500).json(errorEnvelope('INTERNAL_ERROR', 'An unexpected error occurred.'));
}
