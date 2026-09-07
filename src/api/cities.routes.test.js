jest.mock('../cities/city.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listCities } = require('../cities/city.repository');
const citiesRoutes = require('./cities.routes');

function buildApp() {
  const app = express();
  app.use('/api/cities', citiesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/cities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the city list for any authenticated agent', async () => {
    listCities.mockResolvedValue([{ id: 'city-1', name: 'Bahia', createdAt: new Date() }]);

    const res = await request(buildApp())
      .get('/api/cities')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'city-1', name: 'Bahia', createdAt: expect.any(String) }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/cities');
    expect(res.status).toBe(401);
    expect(listCities).not.toHaveBeenCalled();
  });
});
