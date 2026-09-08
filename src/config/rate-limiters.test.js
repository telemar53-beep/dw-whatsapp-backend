const express = require('express');
const request = require('supertest');
const { createRateLimiter, loginLimiter, sgpLimiter, globalLimiter } = require('./rate-limiters');

function appWith(middleware) {
  const app = express();
  app.use(middleware);
  app.get('/probe', (req, res) => res.json({ ok: true }));
  return app;
}

describe('createRateLimiter', () => {
  test('is a no-op (never 429s) when NODE_ENV is "test"', async () => {
    const limiter = createRateLimiter({ windowMs: 60000, max: 1, name: 'test-noop' });
    const app = appWith(limiter);

    const first = await request(app).get('/probe');
    const second = await request(app).get('/probe');
    const third = await request(app).get('/probe');

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(third.status).toBe(200);
  });

  test('enforces the configured limit and returns 429 with the standard error body outside test env', async () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const limiter = createRateLimiter({ windowMs: 60000, max: 2, name: 'test-enforced' });
      const app = appWith(limiter);

      const first = await request(app).get('/probe');
      const second = await request(app).get('/probe');
      const third = await request(app).get('/probe');

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(third.status).toBe(429);
      expect(third.body).toEqual({ error: 'Too many requests, please try again later' });
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  test('exports pre-configured limiters for login, the SGP webhook, and a global fallback', () => {
    expect(typeof loginLimiter).toBe('function');
    expect(typeof sgpLimiter).toBe('function');
    expect(typeof globalLimiter).toBe('function');
  });
});
