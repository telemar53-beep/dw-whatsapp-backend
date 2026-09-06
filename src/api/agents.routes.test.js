jest.mock('../agents/agent.repository');
jest.mock('../realtime/presence');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listAgents } = require('../agents/agent.repository');
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

describe('GET /api/agents', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the agent list with name and live online status for any authenticated agent', async () => {
    listAgents.mockResolvedValue([
      { id: 'agent-1', name: 'Ana', email: 'a@dw.com', role: 'agent', createdAt: new Date() },
      { id: 'agent-2', name: 'Bruno', email: 'b@dw.com', role: 'admin', createdAt: new Date() },
    ]);
    isAgentOnline.mockImplementation((id) => id === 'agent-1');

    const res = await request(buildApp())
      .get('/api/agents')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'agent-1', name: 'Ana', email: 'a@dw.com', role: 'agent', online: true },
      { id: 'agent-2', name: 'Bruno', email: 'b@dw.com', role: 'admin', online: false },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/agents');
    expect(res.status).toBe(401);
    expect(listAgents).not.toHaveBeenCalled();
    expect(isAgentOnline).not.toHaveBeenCalled();
  });
});
