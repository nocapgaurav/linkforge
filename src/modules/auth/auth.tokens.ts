import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { env } from '../../config/env.js';
import { UnauthorizedError } from './auth.errors.js';

/**
 * Token primitives — the only file that knows the wire formats.
 *
 * Access tokens: short-lived HS256 JWTs (stateless; revocation happens at
 * the session level, so a stolen access token dies within minutes).
 * Session tokens: opaque 256-bit random strings. Only their SHA-256 ever
 * touches the database — a DB leak reveals no usable tokens.
 */

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const SESSION_TTL_DAYS = 30;

const secretKey = new TextEncoder().encode(env.jwtSecret);

export async function signAccessToken(
  userId: bigint,
  ttlSeconds: number = ACCESS_TOKEN_TTL_SECONDS,
): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId.toString())
    .setIssuedAt()
    .setExpirationTime(Math.floor(Date.now() / 1000) + ttlSeconds)
    .sign(secretKey);
}

/** Returns the authenticated user id, or throws UnauthorizedError. */
export async function verifyAccessToken(token: string): Promise<bigint> {
  try {
    const { payload } = await jwtVerify(token, secretKey, { algorithms: ['HS256'] });
    if (typeof payload.sub !== 'string' || !/^\d+$/.test(payload.sub)) {
      throw new Error('malformed subject');
    }
    return BigInt(payload.sub);
  } catch {
    // Expired, tampered, or malformed — the caller never learns which.
    throw new UnauthorizedError('Invalid or expired access token.');
  }
}

/** Mint an opaque session (refresh) token plus the hash we store for it. */
export function generateSessionToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, tokenHash: hashSessionToken(token) };
}

/** SHA-256 hex — deterministic lookup key; raw tokens are never stored. */
export function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function sessionExpiry(now = new Date()): Date {
  return new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);
}
