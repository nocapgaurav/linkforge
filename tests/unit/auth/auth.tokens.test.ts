import { describe, expect, it } from 'vitest';
import { UnauthorizedError } from '../../../src/modules/auth/auth.errors';
import {
  generateSessionToken,
  hashSessionToken,
  sessionExpiry,
  signAccessToken,
  verifyAccessToken,
} from '../../../src/modules/auth/auth.tokens';

describe('access tokens', () => {
  it('round-trips the user id through sign/verify', async () => {
    const token = await signAccessToken(42n);

    await expect(verifyAccessToken(token)).resolves.toBe(42n);
  });

  it('rejects expired tokens', async () => {
    const token = await signAccessToken(42n, -1);

    await expect(verifyAccessToken(token)).rejects.toThrow(UnauthorizedError);
  });

  it('rejects garbage and tampered tokens', async () => {
    await expect(verifyAccessToken('not-a-jwt')).rejects.toThrow(UnauthorizedError);

    const token = await signAccessToken(42n);
    await expect(verifyAccessToken(`${token}x`)).rejects.toThrow(UnauthorizedError);
  });
});

describe('session tokens', () => {
  it('mints an opaque token and its storage hash', () => {
    const { token, tokenHash } = generateSessionToken();

    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashSessionToken(token)).toBe(tokenHash);
    // The raw token is never derivable from what we store.
    expect(tokenHash).not.toContain(token.slice(0, 8));
  });

  it('generates unique tokens', () => {
    expect(generateSessionToken().tokenHash).not.toBe(generateSessionToken().tokenHash);
  });

  it('computes a ~30-day expiry', () => {
    const now = new Date('2026-07-20T00:00:00Z');
    expect(sessionExpiry(now).toISOString()).toBe('2026-08-19T00:00:00.000Z');
  });
});
