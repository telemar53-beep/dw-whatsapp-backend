jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');
const conversationsRoutes = require('./conversations.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/conversations', conversationsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/conversations/queue', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the waiting queue for an authenticated agent', async () => {
    listWaitingConversations.mockResolvedValue([{ id: 'conv-1', status: 'waiting' }]);
    const res = await request(buildApp())
      .get('/api/conversations/queue')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'conv-1', status: 'waiting' }]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/conversations/queue');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/conversations/mine', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns conversations assigned to the requesting agent', async () => {
    listConversationsByAgent.mockResolvedValue([{ id: 'conv-2', assignedAgentId: 'agent-1' }]);
    const res = await request(buildApp())
      .get('/api/conversations/mine')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(listConversationsByAgent).toHaveBeenCalledWith('agent-1');
    expect(res.body).toEqual([{ id: 'conv-2', assignedAgentId: 'agent-1' }]);
  });
});

describe('GET /api/conversations/:id/messages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the message history for an existing conversation', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1' });
    listMessagesByConversation.mockResolvedValue([{ id: 'msg-1', content: 'Oi' }]);
    const res = await request(buildApp())
      .get('/api/conversations/conv-1/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'msg-1', content: 'Oi' }]);
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/conversations/does-not-exist/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
