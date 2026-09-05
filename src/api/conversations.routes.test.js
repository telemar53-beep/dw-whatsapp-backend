jest.mock('../conversations/conversation.repository');
jest.mock('../conversations/message.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../realtime/socket-server');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listWaitingConversations,
  listConversationsByAgent,
  getConversationWithContact,
  claimConversation,
  transferConversation,
  closeConversation,
} = require('../conversations/conversation.repository');
const { listMessagesByConversation } = require('../conversations/message.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
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

// :id must look like a UUID to pass the router.param('id', ...) guard, since the
// conversations.id column is a Postgres UUID. Use two distinct valid-looking UUIDs:
// one standing in for a real conversation reached by the route handler, and one
// standing in for a conversation the mocked repository reports as not found.
const CONVERSATION_ID = '11111111-1111-1111-1111-111111111111';
const NON_EXISTENT_ID = '22222222-2222-2222-2222-222222222222';

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
      .get(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'msg-1', content: 'Oi' }]);
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .get(`/api/conversations/${NON_EXISTENT_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 without querying the repository when :id is not a UUID', async () => {
    const res = await request(buildApp())
      .get('/api/conversations/not-a-uuid/messages')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
    expect(getConversationWithContact).not.toHaveBeenCalled();
  });
});

describe('POST /api/conversations/:id/claim', () => {
  beforeEach(() => jest.clearAllMocks());

  test('claims a waiting conversation for the requesting agent', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(claimConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1');
    expect(res.body.status).toBe('assigned');
  });

  test('returns 409 when the conversation is already assigned or closed', async () => {
    claimConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(409);
  });

  test('broadcasts queue:removed and notifies the claiming agent on success', async () => {
    claimConversation.mockResolvedValue({ id: 'conv-1', status: 'assigned', assignedAgentId: 'agent-1' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      status: 'assigned',
      assignedAgentId: 'agent-1',
      contactPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
    });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:assigned', {
      conversation: {
        id: 'conv-1',
        status: 'assigned',
        assignedAgentId: 'agent-1',
        contactPhoneNumber: '+5511999998888',
        contactDisplayName: 'Cliente',
      },
    });
  });

  test('does not emit anything when claim fails', async () => {
    claimConversation.mockResolvedValue(null);
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/claim`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcast).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });
});

describe('POST /api/conversations/:id/messages', () => {
  beforeEach(() => jest.clearAllMocks());

  test('enqueues a message when the requester is the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-1' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1', status: 'sent' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola cliente' });
    expect(res.status).toBe(201);
    expect(enqueueOutboundMessage).toHaveBeenCalledWith({
      conversationId: 'conv-1',
      channelId: 'channel-1',
      content: 'Ola cliente',
    });
    expect(res.body).toEqual({ id: 'msg-1', status: 'sent' });
  });

  test('returns 400 when content is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 404 when the conversation does not exist', async () => {
    getConversationWithContact.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${NON_EXISTENT_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(404);
  });

  test('returns 403 when the requester is not the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({ id: 'conv-1', channelId: 'channel-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(403);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });

  test('returns 409 when the conversation is closed, even for the assigned agent', async () => {
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      channelId: 'channel-1',
      status: 'closed',
      assignedAgentId: 'agent-1',
    });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/messages`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Ola' });
    expect(res.status).toBe(409);
    expect(enqueueOutboundMessage).not.toHaveBeenCalled();
  });
});

describe('POST /api/conversations/:id/transfer', () => {
  beforeEach(() => jest.clearAllMocks());

  test('transfers the conversation when the requester currently owns it', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(200);
    expect(transferConversation).toHaveBeenCalledWith(CONVERSATION_ID, 'agent-1', 'agent-2');
    expect(res.body.assignedAgentId).toBe('agent-2');
  });

  test('returns 400 when toAgentId is missing', async () => {
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({});
    expect(res.status).toBe(400);
    expect(transferConversation).not.toHaveBeenCalled();
  });

  test('returns 409 when the requester does not currently own the conversation', async () => {
    transferConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(res.status).toBe(409);
  });

  test('notifies both the previous and new agent on a successful transfer', async () => {
    transferConversation.mockResolvedValue({ id: 'conv-1', assignedAgentId: 'agent-2' });
    getConversationWithContact.mockResolvedValue({
      id: 'conv-1',
      assignedAgentId: 'agent-2',
      contactPhoneNumber: '+5511999998888',
      contactDisplayName: 'Cliente',
    });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/transfer`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ toAgentId: 'agent-2' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).toHaveBeenCalledWith('agent-2', 'conversation:assigned', {
      conversation: {
        id: 'conv-1',
        assignedAgentId: 'agent-2',
        contactPhoneNumber: '+5511999998888',
        contactDisplayName: 'Cliente',
      },
    });
  });
});

describe('POST /api/conversations/:id/close', () => {
  beforeEach(() => jest.clearAllMocks());

  test('closes an open conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed' });
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');
  });

  test('returns 404 when the conversation does not exist or is already closed', async () => {
    closeConversation.mockResolvedValue(null);
    const res = await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('notifies the assigned agent when closing an assigned conversation', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: 'agent-1' });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'conversation:closed', { conversationId: 'conv-1' });
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('broadcasts queue:removed when closing a conversation that was never assigned', async () => {
    closeConversation.mockResolvedValue({ id: 'conv-1', status: 'closed', assignedAgentId: null });
    await request(buildApp())
      .post(`/api/conversations/${CONVERSATION_ID}/close`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(broadcast).toHaveBeenCalledWith('queue:removed', { conversationId: 'conv-1' });
    expect(emitToAgent).not.toHaveBeenCalled();
  });
});
