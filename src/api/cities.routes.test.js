jest.mock('../cities/city.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listCities, listPlaces } = require('../cities/city.repository');
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

describe('GET /api/cities — localidades sob pedido', () => {
  beforeEach(() => jest.clearAllMocks());

  test('por padrao usa a consulta legada, que nao traz localidades', async () => {
    listCities.mockResolvedValue([{ id: 'm1', name: 'Municipio', kind: 'city' }]);

    const res = await request(buildApp()).get('/api/cities')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(listCities).toHaveBeenCalled();
    expect(listPlaces).not.toHaveBeenCalled();
  });

  test('includeLocalities=true usa a hierarquia completa', async () => {
    listPlaces.mockResolvedValue([
      { id: 'm1', name: 'Municipio', kind: 'city', parentId: null },
      { id: 'p1', name: 'Povoado', kind: 'locality', parentId: 'm1' },
    ]);

    const res = await request(buildApp()).get('/api/cities?includeLocalities=true')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.map((c) => c.name)).toEqual(['Municipio', 'Povoado']);
    expect(listPlaces).toHaveBeenCalled();
    expect(listCities).not.toHaveBeenCalled();
  });

  test('qualquer outro valor da flag cai no comportamento legado', async () => {
    listCities.mockResolvedValue([]);

    for (const query of ['?includeLocalities=1', '?includeLocalities=sim', '?includeLocalities=']) {
      await request(buildApp()).get(`/api/cities${query}`)
        .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    }

    expect(listPlaces).not.toHaveBeenCalled();
    expect(listCities).toHaveBeenCalledTimes(3);
  });
});
