jest.mock('../agents/agent.repository');
jest.mock('../realtime/presence');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents, findAgentById, updateAgentProfile } = require('../agents/agent.repository');
const { isAgentOnline } = require('../realtime/presence');
const agentsRoutes = require('./agents.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/agents', agentsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

beforeEach(() => jest.clearAllMocks());

describe('GET /api/agents', () => {
  test('includes avatarPath for each agent', async () => {
    listAgents.mockResolvedValue([{ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', avatarPath: 'avatars/a1.jpg' }]);
    isAgentOnline.mockReturnValue(false);

    const res = await request(buildApp())
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body[0].avatarPath).toBe('avatars/a1.jpg');
  });
});

describe('GET /api/agents/me', () => {
  test('returns the authenticated agent\'s own profile', async () => {
    findAgentById.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', phone: '11999998888', avatarPath: null });

    const res = await request(buildApp())
      .get('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(findAgentById).toHaveBeenCalledWith('agent-1');
    expect(res.body).toEqual({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', phone: '11999998888', avatarPath: null, role: 'agent' });
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/agents/me');
    expect(res.status).toBe(401);
  });
});

describe('PATCH /api/agents/me', () => {
  test('updates name and phone', async () => {
    updateAgentProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana Paula', email: 'ana@dw.com', role: 'agent', phone: '11988887777', avatarPath: null });

    const res = await request(buildApp())
      .patch('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Ana Paula', phone: '11988887777' });

    expect(res.status).toBe(200);
    expect(updateAgentProfile).toHaveBeenCalledWith('agent-1', { name: 'Ana Paula', phone: '11988887777' });
    expect(res.body.name).toBe('Ana Paula');
  });

  test('treats a missing phone as null', async () => {
    updateAgentProfile.mockResolvedValue({ id: 'agent-1', name: 'Ana', email: 'ana@dw.com', role: 'agent', phone: null, avatarPath: null });

    await request(buildApp())
      .patch('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Ana' });

    expect(updateAgentProfile).toHaveBeenCalledWith('agent-1', { name: 'Ana', phone: null });
  });

  test('returns 400 when name is blank', async () => {
    const res = await request(buildApp())
      .patch('/api/agents/me')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: '   ', phone: '11999998888' });

    expect(res.status).toBe(400);
    expect(updateAgentProfile).not.toHaveBeenCalled();
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).patch('/api/agents/me').send({ name: 'Ana' });
    expect(res.status).toBe(401);
  });
});
