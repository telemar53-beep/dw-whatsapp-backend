jest.mock('../company/company-config.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getCompanyConfig, upsertCompanyConfig } = require('../company/company-config.repository');
const adminCompanyRoutes = require('./admin-company.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/company', adminCompanyRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

const NOME_LONGO = 'x'.repeat(81);

describe('GET /api/admin/company', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the current config', async () => {
    getCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });
    const res = await request(buildApp())
      .get('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda'] });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/company', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves the config and returns it', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano'] });
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano'] });
    expect(res.status).toBe(200);
    expect(upsertCompanyConfig).toHaveBeenCalledWith({ name: 'Provedor X', acceptedPayeeNames: ['Provedor X Ltda', 'Fulano'] });
    expect(res.body.acceptedPayeeNames).toEqual(['Provedor X Ltda', 'Fulano']);
  });

  test('accepts an empty name and an empty list', async () => {
    upsertCompanyConfig.mockResolvedValue({ id: 'cfg-1', name: '', acceptedPayeeNames: [] });
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '', acceptedPayeeNames: [] });
    expect(res.status).toBe(200);
    expect(upsertCompanyConfig).toHaveBeenCalledWith({ name: '', acceptedPayeeNames: [] });
  });

  test('returns 400 when name is not a string', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 42, acceptedPayeeNames: [] });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when name is longer than 80 chars', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: NOME_LONGO, acceptedPayeeNames: [] });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when acceptedPayeeNames is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: 'Provedor X Ltda' });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when the list has more than 20 names', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: Array.from({ length: 21 }, (_, i) => `Nome ${i}`) });
    expect(res.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when one of the names is not a string or is too long', async () => {
    const app = buildApp();
    const naoTexto = await request(app)
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: ['ok', 7] });
    expect(naoTexto.status).toBe(400);

    const longo = await request(app)
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: ['ok', NOME_LONGO] });
    expect(longo.status).toBe(400);
    expect(upsertCompanyConfig).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/company')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Provedor X', acceptedPayeeNames: [] });
    expect(res.status).toBe(403);
  });
});
