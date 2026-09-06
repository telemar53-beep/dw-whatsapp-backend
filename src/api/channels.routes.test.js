jest.mock('../channels/channel.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { listChannels } = require('../channels/channel.repository');
const channelsRoutes = require('./channels.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/channels', channelsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/channels', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the channel list for any authenticated agent, without config', async () => {
    listChannels.mockResolvedValue([
      {
        id: 'channel-1',
        type: 'baileys',
        name: 'Berg',
        phoneNumber: '5598985004187',
        config: { sessionPath: '/secret/path' },
        status: 'connected',
      },
    ]);

    const res = await request(buildApp())
      .get('/api/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'channel-1', type: 'baileys', name: 'Berg', phoneNumber: '5598985004187', status: 'connected' },
    ]);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/channels');
    expect(res.status).toBe(401);
    expect(listChannels).not.toHaveBeenCalled();
  });
});
