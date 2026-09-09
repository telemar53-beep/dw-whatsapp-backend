jest.mock('../cities/city.repository');
jest.mock('../city-notices/city-notice.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listCities, findCityById } = require('../cities/city.repository');
const { listCityNoticesByCityIds, upsertCityNotice, deleteCityNotice } = require('../city-notices/city-notice.repository');
const adminCityNoticesRoutes = require('./admin-city-notices.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/cities', adminCityNoticesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/cities/notices', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists every city with its notice, or null when it has none', async () => {
    listCities.mockResolvedValue([
      { id: 'city-1', name: 'Maracaçumé' },
      { id: 'city-2', name: 'Bahia' },
    ]);
    listCityNoticesByCityIds.mockResolvedValue([
      { id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/cities/notices')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(listCityNoticesByCityIds).toHaveBeenCalledWith(['city-1', 'city-2']);
    expect(res.body).toEqual([
      { id: 'city-1', name: 'Maracaçumé', notice: { message: 'Instabilidade', enabled: true } },
      { id: 'city-2', name: 'Bahia', notice: null },
    ]);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/cities/notices')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(listCities).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/cities/:id/notice', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates or updates the notice for the city, trimming the message', async () => {
    findCityById.mockResolvedValue({ id: 'city-1', name: 'Maracaçumé' });
    upsertCityNotice.mockResolvedValue({ id: 'notice-1', cityId: 'city-1', message: 'Instabilidade', enabled: true, activatedAt: new Date() });

    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: '  Instabilidade  ', enabled: true });

    expect(res.status).toBe(200);
    expect(upsertCityNotice).toHaveBeenCalledWith('city-1', { message: 'Instabilidade', enabled: true });
  });

  test('returns 400 when message is missing', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true });

    expect(res.status).toBe(400);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 400 when message is only whitespace', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: '   ', enabled: true });

    expect(res.status).toBe(400);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 400 when message is longer than 4096 characters', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: 'a'.repeat(4097), enabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('message must be 4096 characters or fewer');
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 400 when enabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: 'Instabilidade', enabled: 'yes' });

    expect(res.status).toBe(400);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 404 when the city does not exist', async () => {
    findCityById.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/cities/does-not-exist/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ message: 'Instabilidade', enabled: true });

    expect(res.status).toBe(404);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ message: 'Instabilidade', enabled: true });

    expect(res.status).toBe(403);
    expect(upsertCityNotice).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/cities/:id/notice', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes the notice for the city', async () => {
    deleteCityNotice.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteCityNotice).toHaveBeenCalledWith('city-1');
  });

  test('returns 404 when the city has no notice', async () => {
    deleteCityNotice.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/cities/city-1/notice')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteCityNotice).not.toHaveBeenCalled();
  });
});
