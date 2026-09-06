jest.mock('../agents/agent.repository');
jest.mock('../sectors/sector.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents, createAgent, setAgentActive, findAgentById } = require('../agents/agent.repository');
const { setAgentSectors } = require('../sectors/sector.repository');
const adminAgentsRoutes = require('./admin-agents.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/agents', adminAgentsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/agents', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists every agent for an admin, including inactive ones', async () => {
    listAgents.mockResolvedValue([
      {
        id: 'agent-1',
        name: 'Ana',
        email: 'ana@dw.com',
        role: 'agent',
        active: true,
        createdAt: new Date(),
        sectors: [{ id: 'sector-1', name: 'Financeiro' }],
      },
      { id: 'agent-2', name: 'Beto', email: 'beto@dw.com', role: 'agent', active: false, createdAt: new Date(), sectors: [] },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'agent-1',
        name: 'Ana',
        email: 'ana@dw.com',
        role: 'agent',
        active: true,
        sectors: [{ id: 'sector-1', name: 'Financeiro' }],
      },
      { id: 'agent-2', name: 'Beto', email: 'beto@dw.com', role: 'agent', active: false, sectors: [] },
    ]);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(listAgents).not.toHaveBeenCalled();
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/agents');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/agents', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a new agent', async () => {
    createAgent.mockResolvedValue({
      id: 'agent-3',
      name: 'Carla',
      email: 'carla@dw.com',
      role: 'agent',
      active: true,
      createdAt: new Date(),
    });

    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Carla', email: 'carla@dw.com', password: 'temporaria123', role: 'agent' });

    expect(res.status).toBe(201);
    expect(createAgent).toHaveBeenCalledWith({ name: 'Carla', email: 'carla@dw.com', password: 'temporaria123', role: 'agent' });
    expect(res.body).toEqual({ id: 'agent-3', name: 'Carla', email: 'carla@dw.com', role: 'agent', active: true, sectors: [] });
  });

  test('returns 400 when a required field is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Carla', email: 'carla@dw.com', role: 'agent' });

    expect(res.status).toBe(400);
    expect(createAgent).not.toHaveBeenCalled();
  });

  test('returns 400 for an invalid role', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Carla', email: 'carla@dw.com', password: 'temporaria123', role: 'superadmin' });

    expect(res.status).toBe(400);
    expect(createAgent).not.toHaveBeenCalled();
  });

  test('returns 409 when the email is already registered', async () => {
    const err = new Error('duplicate key value violates unique constraint');
    err.code = '23505';
    createAgent.mockRejectedValue(err);

    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ name: 'Carla', email: 'carla@dw.com', password: 'temporaria123', role: 'agent' });

    expect(res.status).toBe(409);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Carla', email: 'carla@dw.com', password: 'temporaria123', role: 'agent' });
    expect(res.status).toBe(403);
    expect(createAgent).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/agents/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deactivates an agent', async () => {
    setAgentActive.mockResolvedValue({
      id: 'agent-4',
      name: 'Duda',
      email: 'duda@dw.com',
      role: 'agent',
      active: false,
      createdAt: new Date(),
    });

    const res = await request(buildApp())
      .patch('/api/admin/agents/agent-4')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: false });

    expect(res.status).toBe(200);
    expect(setAgentActive).toHaveBeenCalledWith('agent-4', false);
    expect(res.body.active).toBe(false);
  });

  test('reactivates an agent', async () => {
    setAgentActive.mockResolvedValue({
      id: 'agent-4',
      name: 'Duda',
      email: 'duda@dw.com',
      role: 'agent',
      active: true,
      createdAt: new Date(),
    });

    const res = await request(buildApp())
      .patch('/api/admin/agents/agent-4')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: true });

    expect(res.status).toBe(200);
    expect(setAgentActive).toHaveBeenCalledWith('agent-4', true);
  });

  test('returns 400 when active is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/agents/agent-4')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: 'yes' });
    expect(res.status).toBe(400);
    expect(setAgentActive).not.toHaveBeenCalled();
  });

  test('returns 404 when the agent does not exist', async () => {
    setAgentActive.mockResolvedValue(null);
    const res = await request(buildApp())
      .patch('/api/admin/agents/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: false });
    expect(res.status).toBe(404);
  });

  test('returns 400 when an admin tries to deactivate their own account', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/agents/admin-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ active: false });
    expect(res.status).toBe(400);
    expect(setAgentActive).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/agents/agent-4')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ active: false });
    expect(res.status).toBe(403);
    expect(setAgentActive).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/agents/:id/sectors', () => {
  beforeEach(() => jest.clearAllMocks());

  test('assigns the given sectors to an agent', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-4', name: 'Duda', email: 'duda@dw.com', role: 'agent', active: true });
    setAgentSectors.mockResolvedValue(undefined);

    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ sectorIds: ['sector-1', 'sector-2'] });

    expect(res.status).toBe(200);
    expect(setAgentSectors).toHaveBeenCalledWith('agent-4', ['sector-1', 'sector-2']);
  });

  test('returns 400 when sectorIds is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ sectorIds: 'not-an-array' });

    expect(res.status).toBe(400);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });

  test('returns 404 when the agent does not exist', async () => {
    findAgentById.mockResolvedValue(null);

    const res = await request(buildApp())
      .put('/api/admin/agents/does-not-exist/sectors')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ sectorIds: [] });

    expect(res.status).toBe(404);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/agents/agent-4/sectors')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ sectorIds: [] });

    expect(res.status).toBe(403);
    expect(setAgentSectors).not.toHaveBeenCalled();
  });
});
