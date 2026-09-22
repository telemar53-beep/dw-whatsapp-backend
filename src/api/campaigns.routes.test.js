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
  countCampaigns,
  createCampaignRecipients,
  listCampaignRecipients,
  listCampaignRecipientsPage,
  countCampaignRecipientsByStatus,
  updateCampaignRecipientStatus,
  incrementCampaignCounter,
  deleteCampaign,
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
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
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
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: 'abc\n,SemNumero' });

    expect(res.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  test('deduplicates repeated phone numbers in the pasted list', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    createCampaignRecipients.mockResolvedValue([{ id: 'r1', phoneNumber: '5511999990000', displayName: null, status: 'pending' }]);

    await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000\n5511999990000' });

    expect(createCampaign).toHaveBeenCalledWith(expect.objectContaining({ totalRecipients: 1 }));
  });

  test('records invalid lines as pre-failed recipients and bumps failedCount, without blocking valid ones', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
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
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
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
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
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

  test('rejects a disconnected baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'awaiting_qr', config: {} });

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000' });

    expect(res.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  test('rejects a whitespace-only content with 400 content is required', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: '   ', recipients: '5511999990000' });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'content is required' });
    expect(createCampaign).not.toHaveBeenCalled();
  });

  test('rejects a recipients list larger than 2000 entries', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
    const hugeList = Array.from({ length: 2001 }, (_, i) => `55119999${String(i).padStart(5, '0')}`).join('\n');

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: hugeList });

    expect(res.status).toBe(400);
    expect(createCampaign).not.toHaveBeenCalled();
  });

  test('deletes the orphaned campaign if creating recipients fails', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-1', type: 'baileys', status: 'connected', config: {} });
    createCampaign.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    createCampaignRecipients.mockRejectedValue(new Error('db error'));

    const res = await request(buildApp())
      .post('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ channelId: 'channel-1', content: 'Oi', recipients: '5511999990000' });

    expect(res.status).toBe(500);
    expect(deleteCampaign).toHaveBeenCalledWith('campaign-1');
  });
});

describe('GET /api/campaigns', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists campaigns', async () => {
    listCampaigns.mockResolvedValue([{ id: 'campaign-1' }]);
    const res = await request(buildApp()).get('/api/campaigns').set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'campaign-1' }]);
  });

  test('sem parametro nenhum a resposta continua sendo o array puro', async () => {
    listCampaigns.mockResolvedValue([{ id: 'campaign-1' }, { id: 'campaign-2' }]);

    const res = await request(buildApp())
      .get('/api/campaigns')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(Array.isArray(res.body)).toBe(true);
    expect(listCampaigns).toHaveBeenCalledWith();
    expect(countCampaigns).not.toHaveBeenCalled();
  });

  test('parametro desconhecido nao liga a paginacao', async () => {
    listCampaigns.mockResolvedValue([{ id: 'campaign-1' }]);

    const res = await request(buildApp())
      .get('/api/campaigns?ordem=nome&busca=aviso')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(Array.isArray(res.body)).toBe(true);
    expect(listCampaigns).toHaveBeenCalledWith();
  });

  test('com limit a resposta vira envelope com items, total e hasMore', async () => {
    listCampaigns.mockResolvedValue([{ id: 'campaign-1' }]);
    countCampaigns.mockResolvedValue(3);

    const res = await request(buildApp())
      .get('/api/campaigns?limit=1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ items: [{ id: 'campaign-1' }], total: 3, hasMore: true });
    expect(listCampaigns).toHaveBeenCalledWith({ limit: 1, offset: 0 });
  });

  test('so offset tambem liga a paginacao, com limit padrao', async () => {
    listCampaigns.mockResolvedValue([]);
    countCampaigns.mockResolvedValue(0);

    await request(buildApp())
      .get('/api/campaigns?offset=40')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(listCampaigns).toHaveBeenCalledWith({ limit: 20, offset: 40 });
  });

  test('hasMore sai de offset + items.length < total', async () => {
    listCampaigns.mockResolvedValue([{ id: 'c3' }, { id: 'c4' }]);
    countCampaigns.mockResolvedValue(4);

    const res = await request(buildApp())
      .get('/api/campaigns?limit=2&offset=2')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.body.hasMore).toBe(false);
    expect(res.body.total).toBe(4);
  });

  test('pagina vazia depois do fim se descreve honestamente', async () => {
    listCampaigns.mockResolvedValue([]);
    countCampaigns.mockResolvedValue(2);

    const res = await request(buildApp())
      .get('/api/campaigns?limit=20&offset=99')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.body).toEqual({ items: [], total: 2, hasMore: false });
  });

  test('valor invalido devolve 400 em vez de ajustar em silencio', async () => {
    for (const query of ['limit=abc', 'limit=0', 'limit=101', 'limit=-1', 'offset=-1', 'offset=abc', 'limit=1.5']) {
      jest.clearAllMocks();
      const res = await request(buildApp())
        .get(`/api/campaigns?${query}`)
        .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

      expect(res.status).toBe(400);
      expect(listCampaigns).not.toHaveBeenCalled();
      expect(countCampaigns).not.toHaveBeenCalled();
    }
  });

  test('o teto de 100 e aceito na borda', async () => {
    listCampaigns.mockResolvedValue([]);
    countCampaigns.mockResolvedValue(0);

    const res = await request(buildApp())
      .get('/api/campaigns?limit=100')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(listCampaigns).toHaveBeenCalledWith({ limit: 100, offset: 0 });
  });
});

describe('GET /api/campaigns/:id/recipients', () => {
  const CAMPAIGN_ID = '11111111-1111-1111-1111-111111111111';
  const TODOS_ZERADOS = { pending: 0, sent: 0, failed: 0, skipped: 0 };

  function pedir(query = '') {
    return request(buildApp())
      .get(`/api/campaigns/${CAMPAIGN_ID}/recipients${query}`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    findCampaignById.mockResolvedValue({ id: 'campaign-1' });
    listCampaignRecipientsPage.mockResolvedValue([]);
    countCampaignRecipientsByStatus.mockResolvedValue(TODOS_ZERADOS);
  });

  test('devolve a pagina com total, hasMore e as contagens por status', async () => {
    listCampaignRecipientsPage.mockResolvedValue([{ id: 'r1', status: 'sent' }]);
    countCampaignRecipientsByStatus.mockResolvedValue({ pending: 2, sent: 2, failed: 1, skipped: 0 });

    const res = await pedir('?limit=1');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      items: [{ id: 'r1', status: 'sent' }],
      total: 5,
      hasMore: true,
      counts: { pending: 2, sent: 2, failed: 1, skipped: 0 },
    });
    expect(listCampaignRecipientsPage).toHaveBeenCalledWith('campaign-1', { limit: 1, offset: 0, status: undefined });
  });

  test('sem filtro o total e a soma dos quatro status', async () => {
    listCampaignRecipientsPage.mockResolvedValue([{ id: 'r1' }]);
    countCampaignRecipientsByStatus.mockResolvedValue({ pending: 2, sent: 2, failed: 1, skipped: 3 });

    const res = await pedir();

    expect(res.body.total).toBe(8);
  });

  test('com filtro o total e so do recorte, e counts continua sendo a campanha inteira', async () => {
    listCampaignRecipientsPage.mockResolvedValue([{ id: 'r2', status: 'sent' }, { id: 'r4', status: 'sent' }]);
    countCampaignRecipientsByStatus.mockResolvedValue({ pending: 2, sent: 2, failed: 1, skipped: 0 });

    const res = await pedir('?status=sent');

    expect(res.body.total).toBe(2);
    expect(res.body.counts).toEqual({ pending: 2, sent: 2, failed: 1, skipped: 0 });
    expect(listCampaignRecipientsPage).toHaveBeenCalledWith('campaign-1', { limit: 200, offset: 0, status: 'sent' });
  });

  test('hasMore sai de offset + items.length < total', async () => {
    listCampaignRecipientsPage.mockResolvedValue([{ id: 'r3' }, { id: 'r4' }]);
    countCampaignRecipientsByStatus.mockResolvedValue({ pending: 0, sent: 4, failed: 0, skipped: 0 });

    const semSobra = await pedir('?limit=2&offset=2');
    expect(semSobra.body.hasMore).toBe(false);

    const comSobra = await pedir('?limit=2&offset=0');
    expect(comSobra.body.hasMore).toBe(true);
  });

  test('aceita os quatro status do banco', async () => {
    for (const status of ['pending', 'sent', 'failed', 'skipped']) {
      const res = await pedir(`?status=${status}`);
      expect(res.status).toBe(200);
    }
  });

  test('status fora dos quatro devolve 400 sem consultar', async () => {
    for (const query of ['?status=enviado', '?status=SENT', '?status=', '?status=constructor']) {
      jest.clearAllMocks();
      findCampaignById.mockResolvedValue({ id: 'campaign-1' });
      const res = await pedir(query);
      expect(res.status).toBe(400);
      expect(listCampaignRecipientsPage).not.toHaveBeenCalled();
    }
  });

  test('limit e offset invalidos sao ajustados, porque aqui o formato nao muda', async () => {
    await pedir('?limit=abc');
    expect(listCampaignRecipientsPage).toHaveBeenCalledWith('campaign-1', { limit: 200, offset: 0, status: undefined });

    jest.clearAllMocks();
    findCampaignById.mockResolvedValue({ id: 'campaign-1' });
    listCampaignRecipientsPage.mockResolvedValue([]);
    countCampaignRecipientsByStatus.mockResolvedValue(TODOS_ZERADOS);
    await pedir('?limit=9999&offset=-4');
    expect(listCampaignRecipientsPage).toHaveBeenCalledWith('campaign-1', { limit: 500, offset: 0, status: undefined });
  });

  test('pagina vazia se descreve honestamente', async () => {
    countCampaignRecipientsByStatus.mockResolvedValue({ pending: 0, sent: 0, failed: 0, skipped: 2 });

    const res = await pedir('?status=sent');

    expect(res.body).toEqual({ items: [], total: 0, hasMore: false, counts: { pending: 0, sent: 0, failed: 0, skipped: 2 } });
  });

  test('campanha inexistente devolve 404, igual a rota irma', async () => {
    findCampaignById.mockResolvedValue(null);

    const res = await pedir();

    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Campaign not found' });
    expect(listCampaignRecipientsPage).not.toHaveBeenCalled();
  });

  test('id que nao e uuid devolve 404 pelo guard do router', async () => {
    const res = await request(buildApp())
      .get('/api/campaigns/nao-e-uuid/recipients')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(404);
  });

  test('sem token devolve 401', async () => {
    const res = await request(buildApp()).get(`/api/campaigns/${CAMPAIGN_ID}/recipients`);
    expect(res.status).toBe(401);
  });

  test('a rota de detalhe continua devolvendo todos os destinatarios', async () => {
    findCampaignById.mockResolvedValue({ id: 'campaign-1', totalRecipients: 2 });
    listCampaignRecipients.mockResolvedValue([{ id: 'r1' }, { id: 'r2' }]);

    const res = await request(buildApp())
      .get(`/api/campaigns/${CAMPAIGN_ID}`)
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.body.recipients).toEqual([{ id: 'r1' }, { id: 'r2' }]);
    expect(listCampaignRecipientsPage).not.toHaveBeenCalled();
  });
});

describe('GET /api/campaigns/:id', () => {
  test('returns the campaign with its recipients', async () => {
    findCampaignById.mockResolvedValue({ id: 'campaign-1', totalRecipients: 1 });
    listCampaignRecipients.mockResolvedValue([{ id: 'r1', status: 'sent' }]);

    const res = await request(buildApp())
      .get('/api/campaigns/11111111-1111-1111-1111-111111111111')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe('campaign-1');
    expect(res.body.recipients).toEqual([{ id: 'r1', status: 'sent' }]);
  });

  test('returns 404 when the campaign does not exist', async () => {
    findCampaignById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/campaigns/22222222-2222-2222-2222-222222222222')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 for a malformed id', async () => {
    const res = await request(buildApp())
      .get('/api/campaigns/not-a-uuid')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);

    expect(res.status).toBe(404);
    expect(findCampaignById).not.toHaveBeenCalled();
  });
});
