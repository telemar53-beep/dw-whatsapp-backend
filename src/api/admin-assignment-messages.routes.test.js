jest.mock('../assignment-messages/assignment-message.repository');

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  getAssignmentMessageConfig,
  upsertAssignmentMessageConfig,
} = require('../assignment-messages/assignment-message.repository');
const adminAssignmentMessagesRoutes = require('./admin-assignment-messages.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/assignment-message', adminAssignmentMessagesRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/assignment-message', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the current config', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
    const res = await request(buildApp())
      .get('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      id: 'config-1',
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
  });

  test('returns id: null when nothing is configured yet', async () => {
    getAssignmentMessageConfig.mockResolvedValue({
      id: null,
      enabled: false,
      openingMessage: '',
      closingMessage: '',
      agentIds: [],
      channelIds: [],
    });
    const res = await request(buildApp())
      .get('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBeNull();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/admin/assignment-message', () => {
  beforeEach(() => jest.clearAllMocks());

  test('saves the config and returns it', async () => {
    upsertAssignmentMessageConfig.mockResolvedValue({
      id: 'config-1',
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'abertura', closingMessage: 'fechamento', agentIds: ['agent-1'], channelIds: ['channel-1'] });
    expect(res.status).toBe(200);
    expect(upsertAssignmentMessageConfig).toHaveBeenCalledWith({
      enabled: true,
      openingMessage: 'abertura',
      closingMessage: 'fechamento',
      agentIds: ['agent-1'],
      channelIds: ['channel-1'],
    });
    expect(res.body.openingMessage).toBe('abertura');
  });

  test('returns 400 when agentIds is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: 'y', agentIds: 'not-an-array', channelIds: [] });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when channelIds is not an array', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: 'y', agentIds: [], channelIds: 'not-an-array' });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when openingMessage is empty', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: '   ', closingMessage: 'y', agentIds: [], channelIds: [] });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 400 when closingMessage is empty', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: '', agentIds: [], channelIds: [] });
    expect(res.status).toBe(400);
    expect(upsertAssignmentMessageConfig).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/assignment-message')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ enabled: true, openingMessage: 'x', closingMessage: 'y', agentIds: [], channelIds: [] });
    expect(res.status).toBe(403);
  });
});
