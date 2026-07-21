import type { NextFunction, Request, Response } from 'express';
import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../src/modules/auth/auth.errors';
import { authenticate, requireUser } from '../../../src/modules/auth/auth.middleware';
import { signAccessToken } from '../../../src/modules/auth/auth.tokens';

function runAuthenticate(headers: Record<string, string>) {
  return new Promise<{ req: Request; error?: unknown }>((resolve) => {
    const req = { headers } as unknown as Request;
    const next: NextFunction = (error?: unknown) => resolve({ req, error });
    authenticate(req, {} as Response, next);
  });
}

describe('authenticate', () => {
  it('attaches the user id for a valid Bearer token', async () => {
    const token = await signAccessToken(42n);

    const { req, error } = await runAuthenticate({ authorization: `Bearer ${token}` });

    expect(error).toBeUndefined();
    expect(req.user).toEqual({ id: 42n });
  });

  it('rejects a missing Authorization header', async () => {
    const { error } = await runAuthenticate({});

    expect(error).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects non-Bearer schemes', async () => {
    const { error } = await runAuthenticate({ authorization: 'Basic dXNlcjpwYXNz' });

    expect(error).toBeInstanceOf(UnauthorizedError);
  });

  it('rejects invalid and expired tokens', async () => {
    const { error } = await runAuthenticate({ authorization: 'Bearer garbage' });
    expect(error).toBeInstanceOf(UnauthorizedError);

    const expired = await signAccessToken(42n, -1);
    const { error: expiredError } = await runAuthenticate({
      authorization: `Bearer ${expired}`,
    });
    expect(expiredError).toBeInstanceOf(UnauthorizedError);
  });
});

describe('requireUser', () => {
  it('returns the attached user', () => {
    const req = { user: { id: 7n } } as unknown as Request;

    expect(requireUser(req)).toEqual({ id: 7n });
  });

  it('throws when the middleware never ran (mis-mounted route)', () => {
    expect(() => requireUser({} as Request)).toThrow(UnauthorizedError);
  });
});
