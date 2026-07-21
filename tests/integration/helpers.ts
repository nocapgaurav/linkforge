import { randomBytes } from 'node:crypto';
import type { Express } from 'express';
import request from 'supertest';

let counter = 0;

/**
 * Register a fresh user through the real API and hand back its tokens.
 * Emails are unique per call so parallel suites never collide. Suites that
 * create users should delete them in afterAll (urls first — the FK is
 * RESTRICT — then the user; sessions cascade).
 */
export async function registerTestUser(app: Express) {
  const email = `t-${randomBytes(6).toString('hex')}-${counter++}@test.linkforge.local`;
  const response = await request(app)
    .post('/api/v1/auth/register')
    .send({ email, displayName: 'Test User', password: 'test-password-123' });
  if (response.status !== 201) {
    throw new Error(`test user registration failed: ${response.status}`);
  }
  return {
    email,
    accessToken: response.body.data.accessToken as string,
    refreshToken: response.body.data.refreshToken as string,
  };
}
