jest.mock('../cities/city.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createCity, deleteCity } = require('../cities/city.repository');
const adminCitiesRoutes = require('./admin-cities.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cities', adminCitiesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/cities', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new city', async () => {
    createCity.mockResolvedValue({ id: 'city-1', name: 'Bahia', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Bahia' });

    expect(res.status).toBe(201);
    expect(createCity).toHaveBeenCalledWith({ name: 'Bahia' });
    expect(res.body.id).toBe('city-1');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(createCity).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(createCity).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before creating', async () => {
    createCity.mockResolvedValue({ id: 'city-1', name: 'Bahia', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '  Bahia  ' });

    expect(res.status).toBe(201);
    expect(createCity).toHaveBeenCalledWith({ name: 'Bahia' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/cities')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Bahia' });

    expect(res.status).toBe(403);
    expect(createCity).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/cities/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an existing city', async () => {
    deleteCity.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteCity).toHaveBeenCalledWith('city-1');
  });

  test('returns 404 when the city does not exist', async () => {
    deleteCity.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/cities/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteCity).not.toHaveBeenCalled();
  });
});
