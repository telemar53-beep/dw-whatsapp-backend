jest.mock('../channels/channel.repository');
jest.mock('../templates/template.repository');
jest.mock('../campaigns/campaign.repository');
jest.mock('../queue/campaign-queue');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const { findChannelById } = require('../channels/channel.repository');
const { findTemplateById } = require('../templates/template.repository');
const {
  createCampaign,
  findCampaignById,
  listCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
} = require('../campaigns/campaign.repository');
const { enqueueCampaignRecipient } = require('../queue/campaign-queue');
const campaignsRoutes = require('./campaigns.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/campaigns', campaignsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

beforeEach(() => {
  jest.clearAllMocks();
  enqueueCampaignRecipient.mockResolvedValue(undefined);
});

describe('POST /api/campaigns', () => {
  test('creates a text campaign for a baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 2 });
    createCampaignRecipients.mockResolvedValue([
      { id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' },
      { id: 'r2', phoneNumber: '5511999990001', displayName: 'Maria', status: 'pending' },
    ]);

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Aviso importante', recipients: '5511999990000\n5511999990001,Maria' });

    expect(res.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      channelId: 'channel-1', messageType: 'text', content: 'Aviso importante', createdBy: 'agent-1', totalRecipients: 2,
    }));
    expect(createCampaignRecipients).toHaveBeenCalledWith('campaign-1', [
      { rawPhoneNumber: '5511999990000', phoneNumber: '5511999990000', displayName: null, status: 'pending' },
      { rawPhoneNumber: '5511999990001', phoneNumber: '5511999990001', displayName: 'Maria', status: 'pending' },
    ]);
    expect(enqueueCampaignRecipient).toHaveBeenCalledTimes(2);
  });

  test('creates a template campaign for an official channel, resolving the template once', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-2', type: 'meta_cloud', config: { wabaId: 'waba-1' } });
    findTemplateById.mockResolvedValue({ id: 'tpl-1', name: 'aviso', language: 'pt_BR', status: 'APPROVED', wabaId: 'waba-1', bodyText: 'Ola {{1}}', variableCount: 1 });
    createCampaign.mockResolvedValue({ id: 'campaign-2', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-2', templateId: 'tpl-1', templateVariables: ['Joao'], recipients: '5511999990000' });

    expect(res.status).toBe(201);
    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({
      messageType: 'template', content: 'Ola Joao', templateName: 'aviso', templateLanguage: 'pt_BR', templateVariables: ['Joao'],
    }));
  });

  test('rejects when recipients has no valid line', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: 'abc\n,SemNumero' });

    expect(res.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  test('deduplicates repeated phone numbers in the pasted list', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);

    await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000\n5511999990000' });

    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({ totalRecipients: 1 }));
  });

  test('records invalid lines as pre-failed recipients and bumps failedCount, without blocking valid ones', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 2 });
    createCampaignRecipients.mockResolvedValue([
      { id: 'r1', phoneNumber: '', displayName: null, status: 'failed' },
      { id: 'r2', phoneNumber: '5511999990000', displayName: null, status: 'pending' },
    ]);

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: 'abc\n5511999990000' });

    expect(res.status).toBe(201);
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed', 1);
    expect(enqueueCampaignRecipient).toHaveBeenCalledTimes(1);
  });

  test('marks a recipient failed instead of crashing when enqueueing rejects', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);
    enqueueCampaignRecipient.mockRejectedValue(new Error('redis unavailable'));

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000' });

    expect(res.status).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));
    expect(updateCampaignRecipientStatus).toHaveBeenCalledWith('r1', { status: 'failed', errorMessage: 'redis unavailable' });
    expect(incrementCampaignCounter).toHaveBeenCalledWith('campaign-1', 'failed');
  });

  test('does not crash even when recording the enqueue failure itself fails', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);
    enqueueCampaignRecipient.mockRejectedValue(new Error('redis unavailable'));
    updateCampaignRecipientStatus.mockRejectedValue(new Error('db unavailable'));

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000' });

    expect(res.status).toBe(201);
    await new Promise((resolve) => setImmediate(resolve));
    // No assertion needed beyond "the request above completed and this test itself
    // didn't crash/hang" — the point is that a second failure here must not produce
    // an unhandled rejection.
  });

  test('returns 400 when channelId is missing', async () => {
    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ content: 'Oi', recipients: '5511999990000' });

    expect(res.status).toBe(400);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).post('/api/campaigns').send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/campaigns', () => {
  test('lists campaigns', async () => {
    listCampaigns.mockResolvedValue([{ id: 'campaign-1' }]);
    const res = await request(buildApp()).get('/api/campaigns').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'campaign-1' }]);
  });
});

describe('GET /api/campaigns/:id', () => {
  test('returns the campaign with its recipients', async () => {
    findCampaignById.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    listCampaignRecipients.mockResolvedValue([{ id: 'r1', status: 'sent' }]);

    const res = await request(buildApp()).get('/api/campaigns/campaign-1').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('campaign-1');
    expect(res.body.recipients).toEqual([{ id: 'r1', status: 'sent' }]);
  });

  test('returns 404 when the campaign does not exist', async () => {
    findCampaignById.mockResolvedValue(null);
    const res = await request(buildApp()).get('/api/campaigns/does-not-exist').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });
});
