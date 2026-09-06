jest.mock('../sectors/sector.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { createSector, updateSector, deleteSector } = require('../sectors/sector.repository');
const adminSectorsRoutes = require('./admin-sectors.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/sectors', adminSectorsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('POST /api/admin/sectors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new sector', async () => {
    createSector.mockResolvedValue({ id: 'sector-1', name: 'Financeiro', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Financeiro' });

    expect(res.status).toBe(201);
    expect(createSector).toHaveBeenCalledWith({ name: 'Financeiro' });
    expect(res.body.id).toBe('sector-1');
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(createSector).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(createSector).not.toHaveBeenCalled();
  });

  test('trims leading and trailing whitespace before creating', async () => {
    createSector.mockResolvedValue({ id: 'sector-1', name: 'Financeiro', createdAt: new Date() });

    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '  Financeiro  ' });

    expect(res.status).toBe(201);
    expect(createSector).toHaveBeenCalledWith({ name: 'Financeiro' });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/sectors')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Financeiro' });

    expect(res.status).toBe(403);
    expect(createSector).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/sectors/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates an existing sector', async () => {
    updateSector.mockResolvedValue({ id: 'sector-1', name: 'Editado', createdAt: new Date() });

    const res = await request(buildApp())
      .patch('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(200);
    expect(updateSector).toHaveBeenCalledWith('sector-1', { name: 'Editado' });
    expect(res.body.name).toBe('Editado');
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });

    expect(res.status).toBe(400);
    expect(updateSector).not.toHaveBeenCalled();
  });

  test('returns 404 when the sector does not exist', async () => {
    updateSector.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/sectors/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(403);
    expect(updateSector).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/sectors/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes an existing sector', async () => {
    deleteSector.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(deleteSector).toHaveBeenCalledWith('sector-1');
  });

  test('returns 404 when the sector does not exist', async () => {
    deleteSector.mockResolvedValue(false);

    const res = await request(buildApp())
      .delete('/api/admin/sectors/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/sectors/sector-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(403);
    expect(deleteSector).not.toHaveBeenCalled();
  });
});
