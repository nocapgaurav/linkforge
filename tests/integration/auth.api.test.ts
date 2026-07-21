import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';
import { signAccessToken } from '../../src/modules/auth/auth.tokens';

/** Full-stack auth flows against real Postgres. */

const emails: string[] = [];

function uniqueEmail(): string {
  const email = `auth-${Date.now().toString(36)}-${emails.length}@test.linkforge.local`;
  emails.push(email);
  return email;
}

function register(email: string, password = 'a-strong-password') {
  return request(app)
    .post('/api/v1/auth/register')
    .send({ email, displayName: 'Flow Tester', password });
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { in: emails } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('POST /api/v1/auth/register', () => {
  it('creates the account and returns tokens plus a sanitized user resource', async () => {
    const email = uniqueEmail();
    const response = await register(email);

    expect(response.status).toBe(201);
    const { data } = response.body;
    expect(data.user).toEqual({
      email,
      displayName: 'Flow Tester',
      emailVerifiedAt: null,
      createdAt: expect.any(String),
    });
    expect(data.user).not.toHaveProperty('passwordHash');
    expect(data.user).not.toHaveProperty('id');
    expect(data.accessToken).toBeTruthy();
    expect(data.refreshToken).toBeTruthy();
    expect(data.expiresIn).toBe(900);

    // The hash — never the password — is what landed in the database.
    const row = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(row.passwordHash).toMatch(/^\$2b\$/);
    expect(row.passwordHash).not.toContain('a-strong-password');
  });

  it('rejects a duplicate email with 409 EMAIL_TAKEN', async () => {
    const email = uniqueEmail();
    await register(email);

    const response = await register(email);

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('EMAIL_TAKEN');
  });

  it('rejects invalid bodies with field details', async () => {
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'not-an-email', displayName: '', password: 'short' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const fields = response.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toEqual(expect.arrayContaining(['email', 'displayName', 'password']));
  });

  it('rejects passwords beyond the 72-byte bcrypt limit', async () => {
    const response = await register(uniqueEmail(), 'x'.repeat(73));

    expect(response.status).toBe(400);
    expect(response.body.error.details[0].field).toBe('password');
  });
});

describe('POST /api/v1/auth/login', () => {
  it('returns tokens for correct credentials (email case-insensitive)', async () => {
    const email = uniqueEmail();
    await register(email);

    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: email.toUpperCase(), password: 'a-strong-password' });

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(email);
    expect(response.body.data.accessToken).toBeTruthy();
  });

  it('rejects wrong passwords and unknown emails with the same 401', async () => {
    const email = uniqueEmail();
    await register(email);

    const wrongPassword = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'wrong-password' });
    const unknownEmail = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'ghost@test.linkforge.local', password: 'whatever!' });

    for (const response of [wrongPassword, unknownEmail]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('INVALID_CREDENTIALS');
      expect(response.body.error.message).toBe('Invalid email or password.');
    }
  });
});

describe('GET /api/v1/auth/me', () => {
  it('returns the authenticated user', async () => {
    const email = uniqueEmail();
    const { body } = await register(email);

    const response = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${body.data.accessToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(email);
  });

  it('rejects missing, malformed, expired, and orphaned tokens with 401', async () => {
    const missing = await request(app).get('/api/v1/auth/me');
    const garbage = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', 'Bearer garbage');
    const expired = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${await signAccessToken(1n, -1)}`);
    // Valid signature, but the subject user does not exist.
    const orphaned = await request(app)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${await signAccessToken(999_999_999n)}`);

    for (const response of [missing, garbage, expired, orphaned]) {
      expect(response.status).toBe(401);
      expect(response.body.error.code).toBe('UNAUTHORIZED');
    }
  });
});

describe('POST /api/v1/auth/refresh (rotation)', () => {
  it('rotates the session: new pair issued, old token dead', async () => {
    const { body } = await register(uniqueEmail());
    const first = body.data.refreshToken;

    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.refreshToken).not.toBe(first);
    expect(rotated.body.data.accessToken).toBeTruthy();

    const replay = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(replay.status).toBe(401);
  });

  it('treats replay of a rotated token as theft: ALL sessions die', async () => {
    const { body } = await register(uniqueEmail());
    const first = body.data.refreshToken;
    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    const second = rotated.body.data.refreshToken;

    // Replay the retired token — theft response revokes everything…
    await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first }).expect(401);

    // …including the otherwise-legitimate current session.
    const collateral = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second });
    expect(collateral.status).toBe(401);
  });

  it('rejects unknown refresh tokens', async () => {
    const response = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: 'never-issued' });

    expect(response.status).toBe(401);
  });
});

describe('POST /api/v1/auth/logout', () => {
  it('revokes the session so it can no longer refresh', async () => {
    const { body } = await register(uniqueEmail());
    const refreshToken = body.data.refreshToken;

    const logout = await request(app).post('/api/v1/auth/logout').send({ refreshToken });
    expect(logout.status).toBe(200);
    expect(logout.body.data).toEqual({ loggedOut: true });

    await request(app).post('/api/v1/auth/refresh').send({ refreshToken }).expect(401);
  });

  it('is idempotent and silent for unknown tokens', async () => {
    const response = await request(app)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: 'never-issued' });

    expect(response.status).toBe(200);
  });
});

// The describe blocks below cover the new Settings-page endpoints.
// POST /auth/register is itself rate-limited (20/hour/IP, a single shared
// bucket across this entire test run — every file's register() calls draw
// from the same counter), so unlike the blocks above, every "requires
// authentication" check runs standalone (no account needed), and the real
// assertions for update-profile/change-password/logout-all/delete-account
// share exactly ONE registered account, exercised as a single deliberate
// sequence (profile update, then password change, then logout-all, then
// account deletion — each step's postconditions are what the next step
// depends on, same reasoning as the existing refresh-rotation tests above
// chaining multiple assertions in one `it`).

describe('Settings endpoints: auth requirement', () => {
  it.each([
    ['PATCH', '/api/v1/auth/me'],
    ['PATCH', '/api/v1/auth/password'],
    ['POST', '/api/v1/auth/logout-all'],
    ['DELETE', '/api/v1/auth/me'],
  ])('%s %s requires authentication', async (method, path) => {
    const response = await request(app)[method.toLowerCase() as 'patch' | 'post' | 'delete'](
      path,
    ).send({});
    expect(response.status).toBe(401);
  });
});

describe('Settings endpoints: profile, password, sessions, account (one account, in sequence)', () => {
  it('walks update-profile → change-password → logout-all → delete-account end to end', async () => {
    const email = uniqueEmail();
    const { body } = await register(email);
    const accessToken: string = body.data.accessToken;
    const refreshToken: string = body.data.refreshToken;

    // 1. Update profile: rejects empty, then applies a valid name.
    const rejectedName = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: '' });
    expect(rejectedName.status).toBe(400);
    expect(rejectedName.body.error.code).toBe('VALIDATION_ERROR');

    const updatedName = await request(app)
      .patch('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ displayName: 'New Name' });
    expect(updatedName.status).toBe(200);
    expect(updatedName.body.data.user.displayName).toBe('New Name');

    // 2. Change password: rejects a wrong currentPassword, then applies a
    // correct change. Old password stops logging in; new one works; the
    // current session is untouched (changing a password ≠ logging out).
    const wrongCurrent = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'totally-wrong', newPassword: 'a-new-strong-password' });
    expect(wrongCurrent.status).toBe(401);
    expect(wrongCurrent.body.error.code).toBe('INVALID_CREDENTIALS');

    const changed = await request(app)
      .patch('/api/v1/auth/password')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ currentPassword: 'a-strong-password', newPassword: 'a-new-strong-password' });
    expect(changed.status).toBe(200);
    expect(changed.body.data).toEqual({ changed: true });

    const oldPasswordLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'a-strong-password' });
    expect(oldPasswordLogin.status).toBe(401);

    const newPasswordLogin = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'a-new-strong-password' });
    expect(newPasswordLogin.status).toBe(200);

    const stillRefreshes = await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken });
    expect(stillRefreshes.status).toBe(200);
    const rotatedRefreshToken: string = stillRefreshes.body.data.refreshToken;

    // 3. Logout-all: revokes every session (including the one just used).
    const logoutAll = await request(app)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(logoutAll.status).toBe(200);
    expect(logoutAll.body.data).toEqual({ loggedOut: true });

    await request(app)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotatedRefreshToken })
      .expect(401);

    // 4. Delete account: the access token is stateless and still valid
    // (logout-all revoked the SESSION, not the token), so it can still
    // authorize this call — the same accepted trade-off noted on
    // AuthService.deleteAccount. Afterward: login dies, refresh dies, and
    // the email is retired forever (same doctrine as Url's tombstone —
    // the unique constraint doesn't care about deletedAt).
    const deleteAccount = await request(app)
      .delete('/api/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`);
    expect(deleteAccount.status).toBe(200);
    expect(deleteAccount.body.data).toEqual({ deleted: true });

    const loginAfterDelete = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'a-new-strong-password' });
    expect(loginAfterDelete.status).toBe(401);
    expect(loginAfterDelete.body.error.code).toBe('INVALID_CREDENTIALS');

    const reregister = await register(email);
    expect(reregister.status).toBe(409);
    expect(reregister.body.error.code).toBe('EMAIL_TAKEN');
  });
});
