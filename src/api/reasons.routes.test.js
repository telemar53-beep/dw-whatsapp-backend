jest.mock('../reasons/reason.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listActiveReasons } = require('../reasons/reason.repository');
const reasonsRoutes = require('./reasons.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/reasons', reasonsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/reasons', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns active reasons for any authenticated agent', async () => {
    listActiveReasons.mockResolvedValue([{ id: 'r1', name: 'Troca de senha', active: true }]);

    const res = await request(buildApp())
      .get('/api/reasons')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'r1', name: 'Troca de senha', active: true }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/reasons');
    expect(res.status).toBe(401);
    expect(listActiveReasons).not.toHaveBeenCalled();
  });
});
