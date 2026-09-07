jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { getSgpIntegration, saveSgpIntegrationChannel, rotateSgpApiKey } = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const adminIntegrationsRoutes = require('./admin-integrations.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/integrations', adminIntegrationsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

describe('GET /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns configured: false when there is no integration yet', async () => {
    getSgpIntegration.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  test('returns the current configuration without the api key', async () => {
    getSgpIntegration.mockResolvedValue({ channelId: 'channel-1', enabled: true, hasApiKey: true });
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(getSgpIntegration).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ enabled: true });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 400 when enabled is not a boolean', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(404);
  });

  test('returns 400 when the channel is not a baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'meta_cloud' });
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(400);
    expect(saveSgpIntegrationChannel).not.toHaveBeenCalled();
  });

  test('saves the channel and enabled flag', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys' });
    saveSgpIntegrationChannel.mockResolvedValue({ channelId: 'channel-1', enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });

    expect(saveSgpIntegrationChannel).toHaveBeenCalledWith({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: true, channelId: 'channel-1', enabled: true, hasApiKey: false });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(saveSgpIntegrationChannel).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/integrations/sgp/rotate-key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the new plain api key', async () => {
    rotateSgpApiKey.mockResolvedValue({
      apiKey: 'plain-key-value',
      integration: { channelId: 'channel-1', enabled: true, hasApiKey: true },
    });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKey: 'plain-key-value', configured: true, channelId: 'channel-1', enabled: true, hasApiKey: true });
  });

  test('returns 400 when no channel has been chosen yet', async () => {
    rotateSgpApiKey.mockResolvedValue(null);

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(res.status).toBe(400);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(rotateSgpApiKey).not.toHaveBeenCalled();
  });
});
