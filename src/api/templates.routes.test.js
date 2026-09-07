jest.mock('../templates/template.service');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listApprovedTemplatesForChannel } = require('../templates/template.service');
const templatesRoutes = require('./templates.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/templates', templatesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/templates', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns approved templates for the given channelId', async () => {
    listApprovedTemplatesForChannel.mockResolvedValue([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    const res = await request(buildApp())
      .get('/api/templates?channelId=ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'tpl-1', name: 'fatura_vencida' }]);
    expect(listApprovedTemplatesForChannel).toHaveBeenCalledWith('ch-1');
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp()).get('/api/templates').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(400);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/templates?channelId=ch-1');
    expect(res.status).toBe(401);
  });

  test('works for a non-admin agent (open route)', async () => {
    listApprovedTemplatesForChannel.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/templates?channelId=ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
  });
});
