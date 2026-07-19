import request from 'supertest';
import { afterAll, describe, expect, it } from 'vitest';
import app from '../../src/app';
import { disconnectPrisma, prisma } from '../../src/config/prisma';
import { disconnectRedis } from '../../src/config/redis';

/**
 * Full-stack integration tests: real Express app, real validation,
 * controllers, service, repository, and Postgres (docker compose must be
 * running). Created rows are tracked and hard-deleted afterwards so the
 * dev database stays clean.
 */

const createdCodes: string[] = [];

async function createLink(body: Record<string, unknown>) {
  const response = await request(app).post('/api/v1/urls').send(body);
  if (response.status === 201) {
    createdCodes.push(response.body.data.shortCode);
  }
  return response;
}

afterAll(async () => {
  await prisma.url.deleteMany({ where: { shortCode: { in: createdCodes } } });
  await disconnectRedis();
  await disconnectPrisma();
});

describe('URL API end-to-end', () => {
  it('POST /api/v1/urls creates a link and persists the row', async () => {
    const response = await createLink({ originalUrl: 'https://example.com/e2e-create' });

    expect(response.status).toBe(201);
    expect(response.headers['content-type']).toMatch(/application\/json/);
    expect(response.headers['x-request-id']).toBeTruthy();
    const { data } = response.body;
    expect(response.headers['location']).toBe(`/api/v1/urls/${data.shortCode}`);
    expect(data.shortCode).toMatch(/^[0-9A-Za-z]{7}$/);
    expect(data.originalUrl).toBe('https://example.com/e2e-create');
    expect(data.shortUrl).toBe(`http://localhost:3000/${data.shortCode}`);

    const row = await prisma.url.findUnique({ where: { shortCode: data.shortCode } });
    expect(row).not.toBeNull();
    expect(row?.originalUrl).toBe('https://example.com/e2e-create');
    expect(row?.deletedAt).toBeNull();
  });

  it('GET /:shortCode redirects 302 to the original URL', async () => {
    const created = await createLink({ originalUrl: 'https://example.com/e2e-redirect' });
    const code = created.body.data.shortCode;

    const response = await request(app).get(`/${code}`);

    expect(response.status).toBe(302);
    expect(response.headers['location']).toBe('https://example.com/e2e-redirect');
    expect(response.headers['cache-control']).toBe('private, no-cache');
  });

  it('GET /api/v1/urls/:shortCode returns metadata', async () => {
    const created = await createLink({
      originalUrl: 'https://example.com/e2e-meta',
      customAlias: `e2e-meta-${Date.now().toString(36)}`,
      expiresAt: '2030-01-01T00:00:00Z',
    });
    const code = created.body.data.shortCode;

    const response = await request(app).get(`/api/v1/urls/${code}`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      success: true,
      data: {
        shortCode: code,
        shortUrl: `http://localhost:3000/${code}`,
        originalUrl: 'https://example.com/e2e-meta',
        isCustomAlias: true,
        isActive: true,
        clickCount: 0,
        expiresAt: '2030-01-01T00:00:00.000Z',
        createdAt: expect.any(String),
        updatedAt: expect.any(String),
      },
    });
  });

  it('DELETE /api/v1/urls/:shortCode soft-deletes and records the tombstone', async () => {
    const created = await createLink({ originalUrl: 'https://example.com/e2e-delete' });
    const code = created.body.data.shortCode;

    const response = await request(app).delete(`/api/v1/urls/${code}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.shortCode).toBe(code);
    expect(Date.parse(response.body.data.deletedAt)).not.toBeNaN();

    const row = await prisma.url.findUnique({ where: { shortCode: code } });
    expect(row?.deletedAt).not.toBeNull();
    expect(row?.deletedAt?.toISOString()).toBe(response.body.data.deletedAt);
  });

  it('redirect after deletion returns 404 with the standard envelope', async () => {
    const created = await createLink({ originalUrl: 'https://example.com/e2e-dead' });
    const code = created.body.data.shortCode;
    await request(app).delete(`/api/v1/urls/${code}`);

    const response = await request(app).get(`/${code}`);

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('NOT_FOUND');
  });

  it('validation failure returns 400 with field details', async () => {
    const response = await request(app)
      .post('/api/v1/urls')
      .send({ originalUrl: 'ftp://nope.example', customAlias: 'x' });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    const fields = response.body.error.details.map((d: { field: string }) => d.field);
    expect(fields).toContain('originalUrl');
    expect(fields).toContain('customAlias');
  });

  it('unknown routes return the 404 envelope', async () => {
    const response = await request(app).get('/api/v1/unknown/deep/path');

    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(response.body.error.message).toContain('GET /api/v1/unknown/deep/path');
  });

  it('malformed JSON returns 400 MALFORMED_JSON', async () => {
    const response = await request(app)
      .post('/api/v1/urls')
      .set('Content-Type', 'application/json')
      .send('{"originalUrl": ');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('MALFORMED_JSON');
  });

  it('duplicate custom alias returns 409 ALIAS_TAKEN', async () => {
    const alias = `e2e-dup-${Date.now().toString(36)}`;
    await createLink({ originalUrl: 'https://example.com/first', customAlias: alias });

    const response = await request(app)
      .post('/api/v1/urls')
      .send({ originalUrl: 'https://example.com/second', customAlias: alias });

    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ALIAS_TAKEN');
  });
});
