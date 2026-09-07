jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const {
  listSgpIntegrations,
  createSgpIntegration,
  updateSgpIntegration,
  rotateSgpApiKey,
} = require('../integrations/sgp-integration.repository');
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

const BAILEYS_CHANNEL = { id: 'channel-1', type: 'baileys' };
const META_CHANNEL = { id: 'channel-2', type: 'meta_cloud' };

describe('GET /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the list of integrations', async () => {
    listSgpIntegrations.mockResolvedValue([
      { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    ]);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    ]);
  });

  test('returns an empty array when there are none', async () => {
    listSgpIntegrations.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(listSgpIntegrations).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/integrations/sgp', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 400 when description is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(400);
    expect(findChannelById).not.toHaveBeenCalled();
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', enabled: true });
    expect(res.status).toBe(400);
  });

  test('returns 400 when enabled is not a boolean', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: 'yes' });
    expect(res.status).toBe(400);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(404);
  });

  test('returns 400 for an unsupported channel type', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-3', type: 'sms' });
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'x', channelId: 'channel-3', enabled: true });
    expect(res.status).toBe(400);
    expect(createSgpIntegration).not.toHaveBeenCalled();
  });

  test('derives mode "freetext" for a baileys channel', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    createSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });

    expect(createSgpIntegration).toHaveBeenCalledWith({ description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true });
    expect(res.status).toBe(201);
  });

  test('derives mode "template" for a meta_cloud channel and passes defaultTemplateId through', async () => {
    findChannelById.mockResolvedValue(META_CHANNEL);
    createSgpIntegration.mockResolvedValue({ id: 'int-2', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true, hasApiKey: false });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-1', enabled: true });

    expect(createSgpIntegration).toHaveBeenCalledWith({ description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-1', enabled: true });
    expect(res.status).toBe(201);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(createSgpIntegration).not.toHaveBeenCalled();
  });
});

describe('PUT /api/admin/integrations/sgp/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns 404 when the integration does not exist', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    updateSgpIntegration.mockResolvedValue(null);
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-missing')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(404);
  });

  test('updates the integration, re-deriving mode from the current channel', async () => {
    findChannelById.mockResolvedValue(META_CHANNEL);
    updateSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-2', enabled: false, hasApiKey: true });

    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Oficial', channelId: 'channel-2', defaultTemplateId: 'tpl-2', enabled: false });

    expect(updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Oficial', channelId: 'channel-2', mode: 'template', defaultTemplateId: 'tpl-2', enabled: false });
    expect(res.status).toBe(200);
  });

  test('clears defaultTemplateId when the channel is not meta_cloud', async () => {
    findChannelById.mockResolvedValue(BAILEYS_CHANNEL);
    updateSgpIntegration.mockResolvedValue({ id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true });

    await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ description: 'Baileys', channelId: 'channel-1', defaultTemplateId: 'tpl-stale', enabled: true });

    expect(updateSgpIntegration).toHaveBeenCalledWith('int-1', { description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true });
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .put('/api/admin/integrations/sgp/int-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ description: 'x', channelId: 'channel-1', enabled: true });
    expect(res.status).toBe(403);
    expect(updateSgpIntegration).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/integrations/sgp/:id/rotate-key', () => {
  beforeEach(() => jest.clearAllMocks());

  test('returns the new plain api key', async () => {
    rotateSgpApiKey.mockResolvedValue({
      apiKey: 'plain-key-value',
      integration: { id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true },
    });

    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-1/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);

    expect(rotateSgpApiKey).toHaveBeenCalledWith('int-1');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ apiKey: 'plain-key-value', id: 'int-1', description: 'Baileys', channelId: 'channel-1', mode: 'freetext', defaultTemplateId: null, enabled: true, hasApiKey: true });
  });

  test('returns 404 when the integration does not exist', async () => {
    rotateSgpApiKey.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-missing/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`);
    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/integrations/sgp/int-1/rotate-key')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(rotateSgpApiKey).not.toHaveBeenCalled();
  });
});
