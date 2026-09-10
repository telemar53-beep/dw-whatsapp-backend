jest.mock('../reasons/reason.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAllReasons, createReason, updateReason } = require('../reasons/reason.repository');
const adminReasonsRoutes = require('./admin-reasons.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/reasons', adminReasonsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/reasons', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns all reasons for an admin, including inactive ones', async () => {
    listAllReasons.mockResolvedValue([
      { id: 'r1', name: 'Ativo', active: true },
      { id: 'r2', name: 'Inativo', active: false },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/reasons', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new reason', async () => {
    createReason.mockResolvedValue({ id: 'r1', name: 'Troca de senha', active: true });

    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Troca de senha' });

    expect(res.status).toBe(201);
    expect(createReason).toHaveBeenCalledWith({ name: 'Troca de senha' });
  });

  test('returns 400 when name is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(createReason).not.toHaveBeenCalled();
  });

  test('returns 400 when name is only whitespace', async () => {
    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(createReason).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/reasons')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Troca de senha' });
    expect(res.status).toBe(403);
    expect(createReason).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/reasons/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('updates the name only', async () => {
    updateReason.mockResolvedValue({ id: 'r1', name: 'Editado', active: true });

    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Editado' });

    expect(res.status).toBe(200);
    expect(updateReason).toHaveBeenCalledWith('r1', { name: 'Editado', active: undefined });
  });

  test('updates active only', async () => {
    updateReason.mockResolvedValue({ id: 'r1', name: 'Original', active: false });

    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(updateReason).toHaveBeenCalledWith('r1', { name: undefined, active: false });
  });

  test('returns 400 when neither name nor active is provided', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(updateReason).not.toHaveBeenCalled();
  });

  test('returns 400 when active is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: 'yes' });
    expect(res.status).toBe(400);
    expect(updateReason).not.toHaveBeenCalled();
  });

  test('returns 404 when the reason does not exist', async () => {
    updateReason.mockResolvedValue(null);
    const res = await request(buildApp())
      .patch('/api/admin/reasons/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'X' });
    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/reasons/r1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'X' });
    expect(res.status).toBe(403);
    expect(updateReason).not.toHaveBeenCalled();
  });
});
