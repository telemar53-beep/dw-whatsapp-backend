jest.mock('./auth.service', () => ({
  ...jest.requireActual('./auth.service'),
  login: jest.fn(),
  changePassword: jest.fn(),
}));
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { login, changePassword } = require('./auth.service');
const authRoutes = require('./auth.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    res.status(500).json({ error: 'Internal server error' });
  });
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
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

  test('returns 400 when request body is empty', async () => {
    const res = await request(buildApp()).post('/api/auth/login');
    expect(res.status).toBe(400);
  });

  test('returns 401 when login rejects', async () => {
    const err = new Error('Invalid credentials');
    err.code = 'INVALID_CREDENTIALS';
    login.mockRejectedValue(err);
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('propagates a non-credentials error instead of returning 401', async () => {
    login.mockRejectedValue(new Error('connection refused'));
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'x' });
    expect(res.status).toBe(500);
  });

  test('returns 403 when the account is disabled', async () => {
    const err = new Error('Account disabled');
    err.code = 'ACCOUNT_DISABLED';
    login.mockRejectedValue(err);
    const res = await request(buildApp()).post('/api/auth/login').send({ email: 'a@dw.com', password: 'secret123' });
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/auth/password', () => {
  beforeEach(() => jest.clearAllMocks());

  test('changes the password for the authenticated agent', async () => {
    changePassword.mockResolvedValue();
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });

    expect(res.status).toBe(200);
    expect(changePassword).toHaveBeenCalledWith({
      agentId: 'agent-1',
      currentPassword: 'oldpass123',
      newPassword: 'newpass456',
    });
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp())
      .put('/api/auth/password')
      .send({ currentPassword: 'oldpass123', newPassword: 'newpass456' });
    expect(res.status).toBe(401);
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('returns 400 when currentPassword or newPassword is missing', async () => {
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ currentPassword: 'oldpass123' });
    expect(res.status).toBe(400);
    expect(changePassword).not.toHaveBeenCalled();
  });

  test('returns 401 when the current password is wrong', async () => {
    const err = new Error('Current password is incorrect');
    err.code = 'INVALID_CURRENT_PASSWORD';
    changePassword.mockRejectedValue(err);
    const res = await request(buildApp())
      .put('/api/auth/password')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ currentPassword: 'wrongpass', newPassword: 'newpass456' });
    expect(res.status).toBe(401);
  });
});
