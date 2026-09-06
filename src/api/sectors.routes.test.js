jest.mock('../sectors/sector.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listSectors } = require('../sectors/sector.repository');
const sectorsRoutes = require('./sectors.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/sectors', sectorsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/sectors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the sector list for any authenticated agent', async () => {
    listSectors.mockResolvedValue([{ id: 'sector-1', name: 'Financeiro', createdAt: new Date() }]);

    const res = await request(buildApp())
      .get('/api/sectors')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'sector-1', name: 'Financeiro', createdAt: expect.any(String) }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/sectors');
    expect(res.status).toBe(401);
    expect(listSectors).not.toHaveBeenCalled();
  });
});
