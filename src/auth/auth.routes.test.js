jest.mock('./auth.service');
const request = require('supertest');
const express = require('express');
const { login } = require('./auth.service');
const authRoutes = require('./auth.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  return app;
}

describe('POST /api/auth/login', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 200 and a token on valid credentials', async () => {
    login.mockResolvedValue({ token: 'jwt-token', agent: { id: '1', email: 'a@dw.com', role: 'agent' } });
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'secret123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBe('jwt-token');
  });

  test('returns 400 when email is missing', async () => {
    const res = await request(buildApp()).post('/api/auth/login').send({ password: 'secret123' });
    expect(res.status).toBe(400);
  });

  test('returns 401 when login rejects', async () => {
    login.mockRejectedValue(new Error('Invalid credentials'));
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });
});
