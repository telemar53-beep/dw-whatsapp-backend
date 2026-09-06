jest.mock('../quick-replies/quick-reply.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listQuickReplies } = require('../quick-replies/quick-reply.repository');
const quickRepliesRoutes = require('./quick-replies.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/quick-replies', quickRepliesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/quick-replies', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the quick reply list for any authenticated agent', async () => {
    listQuickReplies.mockResolvedValue([
      { id: 'qr-1', title: 'Boas-vindas', content: 'Olá!', createdAt: new Date(), updatedAt: new Date() },
    ]);

    const res = await request(buildApp())
      .get('/api/quick-replies')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'qr-1', title: 'Boas-vindas', content: 'Olá!', createdAt: expect.any(String), updatedAt: expect.any(String) },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/quick-replies');
    expect(res.status).toBe(401);
    expect(listQuickReplies).not.toHaveBeenCalled();
  });
});
