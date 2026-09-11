jest.mock('../business-hours/business-hours.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getBusinessHoursConfig, upsertBusinessHoursConfig } = require('../business-hours/business-hours.repository');
const adminBusinessHoursRoutes = require('./admin-business-hours.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/business-hours', adminBusinessHoursRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/business-hours', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the current config', async () => {
    getBusinessHoursConfig.mockResolvedValue({ id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    const res = await request(buildApp())
      .get('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/business-hours', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves the config and returns it', async () => {
    upsertBusinessHoursConfig.mockResolvedValue({ id: 'config-1', enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    expect(res.status).toBe(200);
    expect(upsertBusinessHoursConfig).toHaveBeenCalledWith({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    expect(res.body.startTime).toBe('08:00');
  });

  test('returns 400 when startTime is not HH:MM', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '8:00', endTime: '18:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when endTime is not HH:MM', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '25:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when endTime is not after startTime', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '18:00', endTime: '08:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when endTime equals startTime', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '08:00', message: 'aviso' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when message is empty', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '18:00', message: '   ' });
    expect(res.status).toBe(400);
    expect(upsertBusinessHoursConfig).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/business-hours')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ enabled: true, startTime: '08:00', endTime: '18:00', message: 'aviso' });
    expect(res.status).toBe(403);
  });
});
