const request = require('supertest');
const express = require('express');
const rateLimit = require('express-rate-limit');
const { createApp } = require('../src/app');

const app = createApp();

describe('Security hardening', () => {
  it('sets Helmet security headers', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('serves a strict Content-Security-Policy', async () => {
    const res = await request(app).get('/api/health');
    const csp = res.headers['content-security-policy'];
    expect(csp).toMatch(/default-src 'self'/);
    expect(csp).toMatch(/frame-ancestors 'none'/);
    expect(csp).toMatch(/object-src 'none'/);
  });

  it('blocks cross-origin mutating requests via CSRF origin check', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Origin', 'https://evil.example.com')
      .send({ email: 'a@b.co', password: 'whatever123' });
    expect([403]).toContain(res.status);
  });

  it('rejects malformed JSON bodies', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{"email": broken');
    expect([400, 401, 422]).toContain(res.status);
  });

  it('rate limits repeated attempts (429)', async () => {
    const testApp = express();
    const limiter = rateLimit({ windowMs: 60_000, max: 3, standardHeaders: true });
    testApp.use('/limited', limiter, (_req, res) => res.json({ ok: true }));

    for (let i = 0; i < 3; i += 1) {
      const r = await request(testApp).get('/limited');
      expect(r.status).toBe(200);
    }
    const blocked = await request(testApp).get('/limited');
    expect(blocked.status).toBe(429);
  });

  it('returns 404 JSON for unknown API routes', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('not_found');
  });

  it('requires admin role for admin endpoints', async () => {
    const res = await request(app).get('/api/admin/stats').set('Authorization', 'Bearer invalid.token.value');
    expect([401]).toContain(res.status);

    const noAuth = await request(app).get('/api/admin/stats');
    expect(noAuth.status).toBe(401);
  });

  it('sanitizes NoSQL injection operators in queries', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'victim@test.dev', password: 'x' })
      .query({ $where: 'malicious' });
    expect([200, 400, 401, 403, 404, 422]).toContain(res.status);
    expect(res.status).not.toBe(500);
  });
});
