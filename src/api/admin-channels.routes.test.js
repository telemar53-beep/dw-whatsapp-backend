jest.mock('../channels/channel.repository');
jest.mock('../channels/channel-connection');
jest.mock('../channels/meta-cloud-setup');
jest.mock('../ai/ai-config.repository');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../whatsapp-adapters/three-sixty-dialog.adapter');
jest.mock('qrcode');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const {
  listChannels,
  createChannel,
  findChannelById,
  updateChannelTriageEnabled,
  updateChannelWabaId,
  updateChannelHidden,
  updateChannelWelcomeMessage,
  updateChannelAiEnabled,
  updateChannelAiTriageEnabled,
  updateChannelAiNightModeEnabled,
  countChannelDependents,
  deleteChannel,
  convertChannelToMetaCloud,
  updateChannelName,
} = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const threeSixtyDialogAdapter = require('../whatsapp-adapters/three-sixty-dialog.adapter');
const { getAiConfig } = require('../ai/ai-config.repository');
const { getChannelConnection } = require('../channels/channel-connection');
const { checkMetaCloudSetup } = require('../channels/meta-cloud-setup');
const adminChannelsRoutes = require('./admin-channels.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/channels', adminChannelsRoutes);
  return app;
}

function tokenFor(agentId, role, canManageIntegrations = false) {
  return jwt.sign({ agentId, role, canManageIntegrations }, process.env.JWT_SECRET);
}

// Padrao para todos os testes da rota: nenhum canal reporta conexao, e a
// conferencia do cadastro com a Meta passa. Quem quer testar o selo da coluna
// Conexao ou a recusa de um cadastro sobrescreve no proprio teste.
beforeEach(() => {
  getChannelConnection.mockResolvedValue(null);
  checkMetaCloudSetup.mockResolvedValue({ ok: true });
});

describe('GET /api/admin/channels', () => {
  beforeEach(() => jest.clearAllMocks());

  test('lists channels for an admin', async () => {
    listChannels.mockResolvedValue([
      {
        id: 'channel-1',
        type: 'meta_cloud',
        name: 'Suporte',
        phoneNumber: '+5511999990001',
        config: { phoneNumberId: '1', accessToken: 'tok' },
        status: 'connected',
        triageEnabled: false,
        aiTriageEnabled: false,
      },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      {
        id: 'channel-1',
        type: 'meta_cloud',
        name: 'Suporte',
        phoneNumber: '+5511999990001',
        status: 'connected',
        triageEnabled: false,
        aiTriageEnabled: false,
      },
    ]);
    expect(res.body[0]).toHaveProperty('aiTriageEnabled');
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
  });

  test('returns 200 for a manager without canManageIntegrations', async () => {
    listChannels.mockResolvedValue([]);
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(200);
  });

  test('returns 401 without a token', async () => {
    const res = await request(buildApp()).get('/api/admin/channels');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/channels', () => {
  beforeEach(() => jest.clearAllMocks());

  test('creates a meta_cloud channel', async () => {
    createChannel.mockResolvedValue({
      id: 'channel-2',
      type: 'meta_cloud',
      name: 'Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '999', accessToken: 'tok' },
      status: 'disconnected',
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({
        type: 'meta_cloud',
        name: 'Financeiro',
        phoneNumber: '+5511999990002',
        phoneNumberId: '999',
        accessToken: 'tok',
        wabaId: 'waba-1',
      });

    expect(res.status).toBe(201);
    expect(createChannel).toHaveBeenCalledWith({
      type: 'meta_cloud',
      name: 'Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '999', accessToken: 'tok', wabaId: 'waba-1' },
      status: 'connected',
    });
  });

  test('rejects a meta_cloud channel missing credentials', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'Financeiro', phoneNumber: '+5511999990002' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('creates a baileys channel and starts its connection', async () => {
    baileysManager.addBaileysChannel.mockResolvedValue({
      id: 'channel-3',
      type: 'baileys',
      name: 'WhatsApp Vendas',
      phoneNumber: '+5511988887777',
      config: {},
      status: 'disconnected',
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'baileys', name: 'WhatsApp Vendas', phoneNumber: '+5511988887777' });

    expect(res.status).toBe(201);
    expect(baileysManager.addBaileysChannel).toHaveBeenCalledWith({
      name: 'WhatsApp Vendas',
      phoneNumber: '+5511988887777',
    });
    expect(res.body.id).toBe('channel-3');
  });

  test('nao marca um canal baileys como conectado: quem diz isso e o handshake do QR', async () => {
    baileysManager.addBaileysChannel.mockResolvedValue({
      id: 'channel-3', type: 'baileys', name: 'WhatsApp Vendas', phoneNumber: '+5511988887777',
      config: {}, status: 'disconnected',
    });

    await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'baileys', name: 'WhatsApp Vendas', phoneNumber: '+5511988887777' });

    expect(baileysManager.addBaileysChannel).toHaveBeenCalledWith({
      name: 'WhatsApp Vendas',
      phoneNumber: '+5511988887777',
    });
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('returns 409 when the phone number is already in use', async () => {
    createChannel.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({
        type: 'meta_cloud',
        name: 'Financeiro',
        phoneNumber: '+5511999990002',
        phoneNumberId: '999',
        accessToken: 'tok',
        wabaId: 'waba-1',
      });

    expect(res.status).toBe(409);
  });

  test('rejects an unknown channel type', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'sms', name: 'X', phoneNumber: '+5511900000000' });

    expect(res.status).toBe(400);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });
    expect(res.status).toBe(403);
  });

  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });
    expect(res.status).toBe(403);
  });

  test('creates a channel for a manager with canManageIntegrations', async () => {
    createChannel.mockResolvedValue({
      id: 'channel-9', type: 'baileys', name: 'X', phoneNumber: '+5511900000000',
      config: {}, status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null,
    });
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager', true)}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });
    expect(res.status).toBe(201);
  });

  test('creates a 360dialog channel, registering the webhook after creating the row', async () => {
    threeSixtyDialogAdapter.registerWebhook.mockResolvedValue(undefined);
    createChannel.mockResolvedValue({
      id: 'channel-9', type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009',
      config: { apiKey: 'd360-key', wabaId: 'waba-9', webhookToken: expect.any(String) },
      status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null,
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'd360-key', wabaId: 'waba-9' });

    expect(res.status).toBe(201);
    expect(threeSixtyDialogAdapter.registerWebhook).toHaveBeenCalledTimes(1);
    const [registeredChannel, webhookUrl] = threeSixtyDialogAdapter.registerWebhook.mock.calls[0];
    expect(registeredChannel.config.apiKey).toBe('d360-key');
    expect(webhookUrl).toMatch(/^http:\/\/localhost:3000\/webhooks\/360dialog\/[a-f0-9]{48}$/);
    expect(createChannel).toHaveBeenCalledWith(expect.objectContaining({
      type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009',
      config: expect.objectContaining({ apiKey: 'd360-key', wabaId: 'waba-9' }),
      status: 'connected',
    }));
  });

  test('rejects a 360dialog channel missing apiKey', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', wabaId: 'waba-9' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('rejects a 360dialog channel missing wabaId', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'd360-key' });

    expect(res.status).toBe(400);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('rolls back the channel when webhook registration fails', async () => {
    createChannel.mockResolvedValue({
      id: 'channel-9', type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009',
      config: { apiKey: 'bad-key', wabaId: 'waba-9', webhookToken: expect.any(String) },
      status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null,
    });
    threeSixtyDialogAdapter.registerWebhook.mockRejectedValue(new Error('401 Unauthorized'));
    deleteChannel.mockResolvedValue(true);

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('admin-1', 'admin')}`)
      .send({ type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', apiKey: 'bad-key', wabaId: 'waba-9' });

    expect(res.status).toBe(400);
    expect(createChannel).toHaveBeenCalled();
    expect(deleteChannel).toHaveBeenCalledWith('channel-9');
  });
});

describe('GET /api/admin/channels/:id/qr', () => {
  beforeEach(() => jest.clearAllMocks());

  test('renders the QR code page when the channel is awaiting_qr', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-4', type: 'baileys', name: 'WhatsApp Vendas', status: 'awaiting_qr' });
    baileysManager.getQrForChannel.mockReturnValue('raw-qr-text');
    QRCode.toDataURL.mockResolvedValue('data:image/png;base64,FAKEDATA');

    const res = await request(buildApp())
      .get('/api/admin/channels/channel-4/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain('data:image/png;base64,FAKEDATA');
    expect(QRCode.toDataURL).toHaveBeenCalledWith('raw-qr-text');
  });

  test('accepts the token via query string for browser access', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-4', type: 'baileys', name: 'WhatsApp Vendas', status: 'awaiting_qr' });
    baileysManager.getQrForChannel.mockReturnValue('raw-qr-text');
    QRCode.toDataURL.mockResolvedValue('data:image/png;base64,FAKEDATA');

    const res = await request(buildApp()).get(
      `/api/admin/channels/channel-4/qr?token=${tokenFor('agent-1', 'admin')}`
    );

    expect(res.status).toBe(200);
  });

  test('returns 401 with no token in header or query string', async () => {
    const res = await request(buildApp()).get('/api/admin/channels/channel-4/qr');
    expect(res.status).toBe(401);
  });

  test('returns 403 via query string token for a non-admin agent', async () => {
    const res = await request(buildApp()).get(
      `/api/admin/channels/channel-4/qr?token=${tokenFor('agent-1', 'agent')}`
    );
    expect(res.status).toBe(403);
  });

  test('returns 403 via query string token for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp()).get(
      `/api/admin/channels/channel-4/qr?token=${tokenFor('manager-1', 'manager')}`
    );
    expect(res.status).toBe(403);
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .get('/api/admin/channels/does-not-exist/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the channel is not a baileys channel', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-5', type: 'meta_cloud', status: 'connected' });
    const res = await request(buildApp())
      .get('/api/admin/channels/channel-5/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when the channel is not awaiting a QR code', async () => {
    findChannelById.mockResolvedValue({ id: 'channel-6', type: 'baileys', status: 'connected' });
    const res = await request(buildApp())
      .get('/api/admin/channels/channel-6/qr')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/admin/channels/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('toggles triageEnabled on', async () => {
    updateChannelTriageEnabled.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: true,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ triageEnabled: true });

    expect(res.status).toBe(200);
    expect(updateChannelTriageEnabled).toHaveBeenCalledWith('channel-1', true);
    expect(res.body).toEqual({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: true,
    });
  });

  test('returns 400 when triageEnabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ triageEnabled: 'yes' });

    expect(res.status).toBe(400);
    expect(updateChannelTriageEnabled).not.toHaveBeenCalled();
  });

  test('returns 404 when the channel does not exist', async () => {
    updateChannelTriageEnabled.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/channels/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ triageEnabled: true });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ triageEnabled: true });
    expect(res.status).toBe(403);
  });

  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`)
      .send({ triageEnabled: true });
    expect(res.status).toBe(403);
  });

  test('sets welcomeMessage', async () => {
    updateChannelWelcomeMessage.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      welcomeMessage: 'Olá! Bem-vindo.',
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 'Olá! Bem-vindo.' });

    expect(res.status).toBe(200);
    expect(updateChannelWelcomeMessage).toHaveBeenCalledWith('channel-1', 'Olá! Bem-vindo.');
    expect(res.body.welcomeMessage).toBe('Olá! Bem-vindo.');
  });

  test('trims welcomeMessage and stores an empty/whitespace-only value as null', async () => {
    updateChannelWelcomeMessage.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      welcomeMessage: null,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: '   ' });

    expect(res.status).toBe(200);
    expect(updateChannelWelcomeMessage).toHaveBeenCalledWith('channel-1', null);
  });

  test('accepts a literal null for welcomeMessage and stores it as null', async () => {
    updateChannelWelcomeMessage.mockResolvedValue({
      id: 'channel-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      welcomeMessage: null,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: null });

    expect(res.status).toBe(200);
    expect(updateChannelWelcomeMessage).toHaveBeenCalledWith('channel-1', null);
  });

  test('returns 400 when welcomeMessage is not a string', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 123 });

    expect(res.status).toBe(400);
    expect(updateChannelWelcomeMessage).not.toHaveBeenCalled();
  });

  test('returns 400 when welcomeMessage is over 4096 characters', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 'a'.repeat(4097) });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('welcomeMessage must be 4096 characters or fewer');
    expect(updateChannelWelcomeMessage).not.toHaveBeenCalled();
  });

  test('returns 404 for welcomeMessage on a non-existent channel', async () => {
    updateChannelWelcomeMessage.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/channels/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ welcomeMessage: 'Oi' });

    expect(res.status).toBe(404);
  });

  test('returns 400 when none of triageEnabled, wabaId, hidden or welcomeMessage is provided', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/welcomeMessage/);
  });
});

describe('POST /api/admin/channels (meta_cloud, wabaId required)', () => {
  test('returns 400 when wabaId is missing for a meta_cloud channel', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', phoneNumberId: '123', accessToken: 'tok' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/wabaId/);
  });

  test('creates the channel with wabaId stored in config when all fields are given', async () => {
    createChannel.mockResolvedValue({
      id: 'ch-1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' }, status: 'disconnected', triageEnabled: false,
    });
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' });
    expect(res.status).toBe(201);
    expect(createChannel).toHaveBeenCalledWith({
      type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'waba-1' },
      status: 'connected',
    });
  });
});

describe('GET /api/admin/channels (wabaId in response)', () => {
  test('includes wabaId for a meta_cloud channel and omits it for a baileys channel', async () => {
    listChannels.mockResolvedValue([
      { id: 'ch-1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000', config: { wabaId: 'waba-1' }, status: 'disconnected', triageEnabled: false },
      { id: 'ch-2', type: 'baileys', name: 'Berg', phoneNumber: '+5511999991111', config: {}, status: 'connected', triageEnabled: false },
    ]);
    const res = await request(buildApp()).get('/api/admin/channels').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.body[0].wabaId).toBe('waba-1');
    expect(res.body[1].wabaId).toBeUndefined();
  });

  test('includes wabaId for a 360dialog channel', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-9', type: '360dialog', name: 'Via BSP', phoneNumber: '+5511999990009', config: { apiKey: 'k', wabaId: 'waba-9', webhookToken: 't' }, status: 'disconnected', triageEnabled: false, hidden: false, welcomeMessage: null },
    ]);
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.body[0].wabaId).toBe('waba-9');
  });
});

describe('PATCH /api/admin/channels/:id (wabaId)', () => {
  test('updates wabaId when given', async () => {
    updateChannelWabaId.mockResolvedValue({
      id: 'ch-1', type: 'meta_cloud', name: 'Oficial', phoneNumber: '+5511999990000',
      config: { phoneNumberId: '123', accessToken: 'tok', wabaId: 'new-waba' }, status: 'disconnected', triageEnabled: false,
    });
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'new-waba' });
    expect(res.status).toBe(200);
    expect(res.body.wabaId).toBe('new-waba');
    expect(updateChannelWabaId).toHaveBeenCalledWith('ch-1', 'new-waba');
  });

  test('returns 400 when neither triageEnabled nor wabaId is given', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({});
    expect(res.status).toBe(400);
  });

  test('returns 404 when updateChannelWabaId finds no matching meta_cloud channel', async () => {
    updateChannelWabaId.mockResolvedValue(null);
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ wabaId: 'new-waba' });
    expect(res.status).toBe(404);
  });

});

describe('PATCH /api/admin/channels/:id (hidden)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('hides a channel and stops its live WhatsApp session', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', name: 'Berg', phoneNumber: '+55', status: 'connected', config: {} });
    updateChannelHidden.mockResolvedValue({ id: 'ch-1', type: 'baileys', name: 'Berg', phoneNumber: '+55', status: 'disconnected', hidden: true, config: {} });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ hidden: true });

    expect(res.status).toBe(200);
    expect(updateChannelHidden).toHaveBeenCalledWith('ch-1', true);
    expect(baileysManager.stopBaileysChannel).toHaveBeenCalledWith('ch-1');
    expect(res.body.hidden).toBe(true);
  });

  test('un-hiding a channel does not touch its WhatsApp session', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', name: 'Berg', phoneNumber: '+55', status: 'disconnected', config: {} });
    updateChannelHidden.mockResolvedValue({ id: 'ch-1', type: 'baileys', name: 'Berg', phoneNumber: '+55', status: 'disconnected', hidden: false, config: {} });

    await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ hidden: false });

    expect(baileysManager.stopBaileysChannel).not.toHaveBeenCalled();
  });

  test('returns 400 when hidden is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ hidden: 'yes' });
    expect(res.status).toBe(400);
    expect(updateChannelHidden).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/channels/:id (aiEnabled)', () => {
  beforeEach(() => jest.clearAllMocks());

  test('turns AI on for the channel', async () => {
    updateChannelAiEnabled.mockResolvedValue({
      id: 'ch-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      aiEnabled: true,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ aiEnabled: true });

    expect(res.status).toBe(200);
    expect(updateChannelAiEnabled).toHaveBeenCalledWith('ch-1', true);
    expect(res.body.aiEnabled).toBe(true);
  });

  test('returns 400 when aiEnabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ aiEnabled: 'sim' });

    expect(res.status).toBe(400);
    expect(updateChannelAiEnabled).not.toHaveBeenCalled();
  });

  test('returns 404 when the channel does not exist', async () => {
    updateChannelAiEnabled.mockResolvedValue(null);

    const res = await request(buildApp())
      .patch('/api/admin/channels/does-not-exist')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ aiEnabled: true });

    expect(res.status).toBe(404);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ aiEnabled: true });
    expect(res.status).toBe(403);
    expect(updateChannelAiEnabled).not.toHaveBeenCalled();
  });

  // I3 (revisão final do branch inteiro): desligar aiEnabled precisa
  // cascatear para aiTriageEnabled, senão religar aiEnabled no futuro
  // reativaria a triagem por IA sozinha, sem ninguém ter escolhido isso.
  test('turning aiEnabled off also turns aiTriageEnabled off and returns the cascaded channel', async () => {
    updateChannelAiEnabled.mockResolvedValue({ id: 'ch-1', aiEnabled: false, aiTriageEnabled: true });
    updateChannelAiTriageEnabled.mockResolvedValue({
      id: 'ch-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      aiEnabled: false,
      aiTriageEnabled: false,
    });
    updateChannelAiNightModeEnabled.mockResolvedValue({
      id: 'ch-1',
      type: 'baileys',
      name: 'Suporte',
      phoneNumber: '+5511999990001',
      status: 'connected',
      triageEnabled: false,
      aiEnabled: false,
      aiTriageEnabled: false,
      aiNightModeEnabled: false,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ aiEnabled: false });

    expect(res.status).toBe(200);
    expect(updateChannelAiEnabled).toHaveBeenCalledWith('ch-1', false);
    expect(updateChannelAiTriageEnabled).toHaveBeenCalledWith('ch-1', false);
    expect(res.body.aiEnabled).toBe(false);
    expect(res.body.aiTriageEnabled).toBe(false);
  });

  // Desligar a IA precisa cascatear também para o modo noturno: ele depende
  // da triagem, e um interruptor órfão ligaria o noturno sozinho depois.
  test('turning aiEnabled off also turns aiNightModeEnabled off', async () => {
    updateChannelAiEnabled.mockResolvedValue({ id: 'ch-1', aiEnabled: false, aiTriageEnabled: true });
    updateChannelAiTriageEnabled.mockResolvedValue({ id: 'ch-1', aiEnabled: false, aiTriageEnabled: false });
    updateChannelAiNightModeEnabled.mockResolvedValue({
      id: 'ch-1',
      aiEnabled: false,
      aiTriageEnabled: false,
      aiNightModeEnabled: false,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ aiEnabled: false });

    expect(res.status).toBe(200);
    expect(updateChannelAiNightModeEnabled).toHaveBeenCalledWith('ch-1', false);
    expect(res.body.aiNightModeEnabled).toBe(false);
  });
});

describe('PATCH /api/admin/channels/:id (aiTriageEnabled)', () => {
  beforeEach(() => jest.clearAllMocks());

  const admin = { Authorization: `Bearer ${tokenFor('agent-1', 'admin')}` };

  test('PATCH aiTriageEnabled exige boolean e canal com IA ligada', async () => {
    const app = buildApp();
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: false });
    await request(app).patch('/api/admin/channels/ch-1').set(admin).send({ aiTriageEnabled: true }).expect(400);
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true });
    updateChannelAiTriageEnabled.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    const res = await request(app).patch('/api/admin/channels/ch-1').set(admin).send({ aiTriageEnabled: true }).expect(200);
    expect(res.body.aiTriageEnabled).toBe(true);
  });

  test('returns 400 when aiTriageEnabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiTriageEnabled: 'sim' });
    expect(res.status).toBe(400);
    expect(updateChannelAiTriageEnabled).not.toHaveBeenCalled();
  });

  // Desligar a triagem desliga o modo noturno junto: o noturno é uma forma
  // de triagem, não sobrevive sem ela.
  test('turning aiTriageEnabled off also turns aiNightModeEnabled off', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    updateChannelAiTriageEnabled.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: false });
    updateChannelAiNightModeEnabled.mockResolvedValue({
      id: 'ch-1',
      aiEnabled: true,
      aiTriageEnabled: false,
      aiNightModeEnabled: false,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiTriageEnabled: false });

    expect(res.status).toBe(200);
    expect(updateChannelAiNightModeEnabled).toHaveBeenCalledWith('ch-1', false);
    expect(res.body.aiNightModeEnabled).toBe(false);
  });
});

describe('PATCH /api/admin/channels/:id (aiNightModeEnabled)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Janela noturna configurada: o caso normal. Sem ela o interruptor não
    // liga (o modo noturno nunca ativaria, e o canal ficaria "ligado" mentindo).
    getAiConfig.mockResolvedValue({ nightStartTime: '20:00', nightEndTime: '08:00' });
  });

  const admin = { Authorization: `Bearer ${tokenFor('agent-1', 'admin')}` };

  test('liga o modo noturno num canal com triagem ligada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    updateChannelAiNightModeEnabled.mockResolvedValue({
      id: 'ch-1',
      aiEnabled: true,
      aiTriageEnabled: true,
      aiNightModeEnabled: true,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: true })
      .expect(200);

    expect(updateChannelAiNightModeEnabled).toHaveBeenCalledWith('ch-1', true);
    expect(res.body.aiNightModeEnabled).toBe(true);
  });

  // Revisão final do branch: sem janela (os dois campos vazios no cartão de
  // triagem) o modo noturno NUNCA ativa. O interruptor ligado no canal seria um
  // "está ligado" que não atende ninguém — e o admin só descobriria de manhã.
  test('recusa ligar o modo noturno sem a janela configurada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    getAiConfig.mockResolvedValue({ nightStartTime: null, nightEndTime: null });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('aiNightModeEnabled requires the night window (nightStartTime/nightEndTime) in the AI triage config');
    expect(updateChannelAiNightModeEnabled).not.toHaveBeenCalled();
  });

  test('recusa ligar com meia janela (só o início)', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    getAiConfig.mockResolvedValue({ nightStartTime: '20:00', nightEndTime: null });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: true });

    expect(res.status).toBe(400);
    expect(updateChannelAiNightModeEnabled).not.toHaveBeenCalled();
  });

  test('desligar não exige janela nenhuma', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true });
    getAiConfig.mockResolvedValue({ nightStartTime: null, nightEndTime: null });
    updateChannelAiNightModeEnabled.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: true, aiNightModeEnabled: false });

    await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: false })
      .expect(200);

    expect(updateChannelAiNightModeEnabled).toHaveBeenCalledWith('ch-1', false);
  });

  test('recusa ligar o modo noturno sem a triagem ligada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: false });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('aiNightModeEnabled requires aiTriageEnabled');
    expect(updateChannelAiNightModeEnabled).not.toHaveBeenCalled();
  });

  test('recusa ligar o modo noturno sem a IA ligada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: false, aiTriageEnabled: true });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: true });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('aiNightModeEnabled requires aiTriageEnabled');
  });

  test('desligar o modo noturno não exige a triagem ligada', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', aiEnabled: true, aiTriageEnabled: false });
    updateChannelAiNightModeEnabled.mockResolvedValue({
      id: 'ch-1',
      aiEnabled: true,
      aiTriageEnabled: false,
      aiNightModeEnabled: false,
    });

    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: false })
      .expect(200);

    expect(res.body.aiNightModeEnabled).toBe(false);
  });

  test('returns 400 when aiNightModeEnabled is not a boolean', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/ch-1')
      .set(admin)
      .send({ aiNightModeEnabled: 'sim' });
    expect(res.status).toBe(400);
    expect(updateChannelAiNightModeEnabled).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/channels/:id/reconnect', () => {
  beforeEach(() => jest.clearAllMocks());

  test('clears the old session and starts a fresh connection for a baileys channel', async () => {
    const channel = { id: 'ch-1', type: 'baileys', name: 'Berg', phoneNumber: '+55', status: 'disconnected', config: {} };
    findChannelById.mockResolvedValueOnce(channel).mockResolvedValueOnce({ ...channel, status: 'awaiting_qr' });

    const res = await request(buildApp())
      .post('/api/admin/channels/ch-1/reconnect')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(baileysManager.reconnectBaileysChannel).toHaveBeenCalledWith(channel);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('awaiting_qr');
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .post('/api/admin/channels/ch-missing/reconnect')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
    expect(baileysManager.reconnectBaileysChannel).not.toHaveBeenCalled();
  });

  test('returns 400 for a meta_cloud channel, which has no QR to scan', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-2', type: 'meta_cloud', config: {} });
    const res = await request(buildApp())
      .post('/api/admin/channels/ch-2/reconnect')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(400);
    expect(baileysManager.reconnectBaileysChannel).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels/ch-1/reconnect')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(baileysManager.reconnectBaileysChannel).not.toHaveBeenCalled();
  });

  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels/ch-1/reconnect')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(baileysManager.reconnectBaileysChannel).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/channels/:id', () => {
  beforeEach(() => jest.clearAllMocks());

  test('deletes a channel that has no conversations and no integrations', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    countChannelDependents.mockResolvedValue({ conversations: 0, integrations: 0 });
    deleteChannel.mockResolvedValue(true);

    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(204);
    expect(baileysManager.stopBaileysChannel).toHaveBeenCalledWith('ch-1');
    expect(deleteChannel).toHaveBeenCalledWith('ch-1');
  });

  test('refuses to delete a channel that already has conversations, telling the admin to hide it instead', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    countChannelDependents.mockResolvedValue({ conversations: 12, integrations: 0 });

    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toBe(
      'Este canal já tem conversas ou uma integração SGP e não pode ser excluído sem perder esse histórico. Use Ocultar.'
    );
    expect(deleteChannel).not.toHaveBeenCalled();
    expect(baileysManager.stopBaileysChannel).not.toHaveBeenCalled();
  });

  test('refuses to delete a channel that is still wired to an SGP integration', async () => {
    findChannelById.mockResolvedValue({ id: 'ch-1', type: 'baileys', config: {} });
    countChannelDependents.mockResolvedValue({ conversations: 0, integrations: 1 });

    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(409);
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  test('returns 404 when the channel does not exist', async () => {
    findChannelById.mockResolvedValue(null);
    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-missing')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);
    expect(res.status).toBe(404);
    expect(countChannelDependents).not.toHaveBeenCalled();
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
    expect(deleteChannel).not.toHaveBeenCalled();
  });

  test('returns 403 for a manager without canManageIntegrations', async () => {
    const res = await request(buildApp())
      .delete('/api/admin/channels/ch-1')
      .set('Authorization', `Bearer ${tokenFor('manager-1', 'manager')}`);
    expect(res.status).toBe(403);
    expect(deleteChannel).not.toHaveBeenCalled();
  });
});

// A coluna Conexao da tela de Canais so tem o que mostrar para o canal oficial
// se alguem perguntar para a Meta; quem pergunta (e quem guarda o cache) e o
// channel-connection, aqui mockado. A rota so decide a quem isso se aplica.
describe('GET /api/admin/channels — estado da conexao do canal oficial', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getChannelConnection.mockResolvedValue(null);
  });

  test('inclui o estado da conexao de um canal meta_cloud', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-1', type: 'meta_cloud', name: 'DW Telcom 1', phoneNumber: '+5598984454546', config: { phoneNumberId: '530351070168344', wabaId: '510099572194362' }, status: 'connected' },
    ]);
    getChannelConnection.mockResolvedValue({ state: 'connected', quality: 'GREEN' });

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body[0].connection).toEqual({ state: 'connected', quality: 'GREEN' });
  });

  test('repassa o motivo quando o token do canal caiu', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-1', type: 'meta_cloud', name: 'DW Telcom 1', phoneNumber: '+5598984454546', config: { phoneNumberId: '530351070168344', wabaId: 'w1' }, status: 'connected' },
    ]);
    getChannelConnection.mockResolvedValue({ state: 'error', motivo: '(190) Session has expired' });

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.body[0].connection).toEqual({ state: 'error', motivo: '(190) Session has expired' });
  });

  test('omite o campo quando o canal nao e meta_cloud', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-1', type: 'baileys', name: 'automação', phoneNumber: '+5598984129046', config: {}, status: 'connected' },
      { id: 'channel-2', type: '360dialog', name: 'DW Telcom 3', phoneNumber: '+5598970285660', config: { wabaId: 'w2' }, status: 'connected' },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.body[0]).not.toHaveProperty('connection');
    expect(res.body[1]).not.toHaveProperty('connection');
  });

  test('consulta cada canal oficial da lista', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-1', type: 'meta_cloud', name: 'Um', phoneNumber: '+5511999990001', config: { phoneNumberId: '1', wabaId: 'w1' }, status: 'connected' },
      { id: 'channel-2', type: 'meta_cloud', name: 'Dois', phoneNumber: '+5511999990002', config: { phoneNumberId: '2', wabaId: 'w2' }, status: 'connected' },
    ]);
    getChannelConnection.mockResolvedValue({ state: 'connected', quality: 'GREEN' });

    await request(buildApp()).get('/api/admin/channels').set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(getChannelConnection).toHaveBeenCalledTimes(2);
  });

  test('a lista carrega mesmo se a consulta de conexao falhar', async () => {
    listChannels.mockResolvedValue([
      { id: 'channel-1', type: 'meta_cloud', name: 'DW Telcom 1', phoneNumber: '+5598984454546', config: { phoneNumberId: '1', wabaId: 'w1' }, status: 'connected' },
    ]);
    getChannelConnection.mockRejectedValue(new Error('graph api fora do ar'));

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0]).not.toHaveProperty('connection');
  });
});

// O 360dialog sempre conferiu a credencial ao cadastrar (registra o webhook e
// apaga o canal se falhar). O meta_cloud nao conferia nada: nascia "conectado"
// com qualquer dado e o erro so aparecia quando o cliente mandava mensagem.
describe('POST /api/admin/channels — conferencia do cadastro com a Meta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getChannelConnection.mockResolvedValue(null);
    checkMetaCloudSetup.mockResolvedValue({ ok: true });
  });

  const cadastro = {
    type: 'meta_cloud',
    name: 'DW Telecom 0800',
    phoneNumber: '+558004454546',
    phoneNumberId: '613336748527998',
    accessToken: 'tok-meta',
    wabaId: '3530350190603464',
  };

  test('confere os dados com a Meta antes de gravar', async () => {
    createChannel.mockResolvedValue({ id: 'channel-9', ...cadastro, config: {} });

    await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send(cadastro);

    expect(checkMetaCloudSetup).toHaveBeenCalledWith({
      phoneNumberId: '613336748527998',
      accessToken: 'tok-meta',
      wabaId: '3530350190603464',
      phoneNumber: '+558004454546',
    });
  });

  test('recusa o cadastro e devolve o motivo quando a Meta desmente os dados', async () => {
    checkMetaCloudSetup.mockResolvedValue({
      ok: false,
      error: 'Nenhum app está inscrito no webhook dessa WABA, então as mensagens não chegariam.',
    });

    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send(cadastro);

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inscrito/i);
    expect(createChannel).not.toHaveBeenCalled();
  });

  test('nao chega a conferir quando falta credencial no formulario', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'meta_cloud', name: 'X', phoneNumber: '+5511900000000' });

    expect(res.status).toBe(400);
    expect(checkMetaCloudSetup).not.toHaveBeenCalled();
  });

  test('nao confere nada para um canal baileys', async () => {
    baileysManager.addBaileysChannel.mockResolvedValue({ id: 'c', type: 'baileys', name: 'X', phoneNumber: '+5511900000000', config: {}, status: 'disconnected' });

    await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: 'baileys', name: 'X', phoneNumber: '+5511900000000' });

    expect(checkMetaCloudSetup).not.toHaveBeenCalled();
  });

  test('nao confere nada para um canal 360dialog, que tem validacao propria', async () => {
    createChannel.mockResolvedValue({ id: 'c', type: '360dialog', name: 'X', phoneNumber: '+5511900000000', config: { webhookToken: 't' }, status: 'connected' });
    threeSixtyDialogAdapter.registerWebhook.mockResolvedValue({});

    await request(buildApp())
      .post('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`)
      .send({ type: '360dialog', name: 'X', phoneNumber: '+5511900000000', apiKey: 'k', wabaId: 'w' });

    expect(checkMetaCloudSetup).not.toHaveBeenCalled();
  });
});

// Levar um numero da 360dialog (ou do Baileys) para o Meta Cloud converte o
// canal no lugar. Recriar nao e opcao: o telefone e unico na tabela e excluir
// um canal com conversas e bloqueado — de proposito, para nao perder historico.
describe('POST /api/admin/channels/:id/meta-cloud-credentials', () => {
  const CREDENCIAIS = { phoneNumberId: '613336748527998', accessToken: 'tok-meta', wabaId: '3530350190603464' };
  const CANAL_360 = {
    id: 'channel-360',
    type: '360dialog',
    name: 'DW Telcom 3',
    phoneNumber: '+5598970285660',
    config: { apiKey: 'd360-key', wabaId: 'waba-antiga', webhookToken: 'tok-webhook' },
    status: 'connected',
  };

  beforeEach(() => {
    jest.clearAllMocks();
    getChannelConnection.mockResolvedValue(null);
    checkMetaCloudSetup.mockResolvedValue({ ok: true });
  });

  function migrar(body = CREDENCIAIS, role = 'admin') {
    return request(buildApp())
      .post('/api/admin/channels/channel-360/meta-cloud-credentials')
      .set('Authorization', `Bearer ${tokenFor('agent-1', role, true)}`)
      .send(body);
  }

  test('confere as credenciais contra o telefone do proprio canal', async () => {
    findChannelById.mockResolvedValue(CANAL_360);
    convertChannelToMetaCloud.mockResolvedValue({ ...CANAL_360, type: 'meta_cloud', config: CREDENCIAIS });

    await migrar();

    expect(checkMetaCloudSetup).toHaveBeenCalledWith({
      ...CREDENCIAIS,
      phoneNumber: '+5598970285660',
    });
  });

  test('converte o canal quando a Meta confirma os dados', async () => {
    findChannelById.mockResolvedValue(CANAL_360);
    convertChannelToMetaCloud.mockResolvedValue({ ...CANAL_360, type: 'meta_cloud', config: CREDENCIAIS });

    const res = await migrar();

    expect(res.status).toBe(200);
    expect(convertChannelToMetaCloud).toHaveBeenCalledWith('channel-360', CREDENCIAIS);
    expect(res.body.type).toBe('meta_cloud');
  });

  test('nao converte nada quando a Meta desmente os dados', async () => {
    findChannelById.mockResolvedValue(CANAL_360);
    checkMetaCloudSetup.mockResolvedValue({ ok: false, error: 'Nenhum app está inscrito no webhook dessa WABA' });

    const res = await migrar();

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/inscrito/i);
    expect(convertChannelToMetaCloud).not.toHaveBeenCalled();
  });

  test('para a sessao do Baileys antes de converter', async () => {
    findChannelById.mockResolvedValue({ ...CANAL_360, type: 'baileys', config: {} });
    convertChannelToMetaCloud.mockResolvedValue({ ...CANAL_360, type: 'meta_cloud', config: CREDENCIAIS });

    await migrar();

    expect(baileysManager.stopBaileysChannel).toHaveBeenCalledWith('channel-360');
  });

  test('nao mexe no Baileys quando o canal vem da 360dialog', async () => {
    findChannelById.mockResolvedValue(CANAL_360);
    convertChannelToMetaCloud.mockResolvedValue({ ...CANAL_360, type: 'meta_cloud', config: CREDENCIAIS });

    await migrar();

    expect(baileysManager.stopBaileysChannel).not.toHaveBeenCalled();
  });

  // Mesmo endpoint serve para trocar a credencial de um canal que ja e Meta
  // Cloud: sem isso, um Access Token revogado ou rotacionado so poderia ser
  // trocado mexendo no banco.
  test('atualiza as credenciais de um canal que ja e Meta Cloud', async () => {
    const atual = { ...CANAL_360, type: 'meta_cloud', config: { ...CREDENCIAIS, accessToken: 'tok-velho' } };
    findChannelById.mockResolvedValue(atual);
    convertChannelToMetaCloud.mockResolvedValue({ ...atual, config: CREDENCIAIS });

    const res = await migrar();

    expect(res.status).toBe(200);
    expect(convertChannelToMetaCloud).toHaveBeenCalledWith('channel-360', CREDENCIAIS);
    expect(baileysManager.stopBaileysChannel).not.toHaveBeenCalled();
  });

  // O indice unique do phoneNumberId recusa apontar dois canais para o mesmo
  // numero. Sem tratar, isso vazaria como 500 em vez de um recado util.
  test('409 quando o Phone Number ID ja pertence a outro canal', async () => {
    findChannelById.mockResolvedValue(CANAL_360);
    convertChannelToMetaCloud.mockRejectedValue(Object.assign(new Error('duplicate key'), { code: '23505' }));

    const res = await migrar();

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/outro canal/i);
  });

  test('404 quando o canal nao existe', async () => {
    findChannelById.mockResolvedValue(null);

    expect((await migrar()).status).toBe(404);
  });

  test('400 quando falta credencial no corpo', async () => {
    findChannelById.mockResolvedValue(CANAL_360);

    const res = await migrar({ phoneNumberId: '613336748527998' });

    expect(res.status).toBe(400);
    expect(checkMetaCloudSetup).not.toHaveBeenCalled();
  });

  test('403 para quem nao gerencia integracoes', async () => {
    const res = await request(buildApp())
      .post('/api/admin/channels/channel-360/meta-cloud-credentials')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send(CREDENCIAIS);

    expect(res.status).toBe(403);
    expect(convertChannelToMetaCloud).not.toHaveBeenCalled();
  });
});

describe('PATCH /api/admin/channels/:id — renomear o canal', () => {
  const CANAL = { id: 'channel-1', type: 'baileys', name: 'automação', phoneNumber: '+5598984129046', config: {}, status: 'connected' };

  beforeEach(() => {
    jest.clearAllMocks();
    getChannelConnection.mockResolvedValue(null);
    checkMetaCloudSetup.mockResolvedValue({ ok: true });
    findChannelById.mockResolvedValue(CANAL);
  });

  function renomear(body, role = 'admin') {
    return request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', role, true)}`)
      .send(body);
  }

  test('troca o nome do canal', async () => {
    updateChannelName.mockResolvedValue({ ...CANAL, name: 'Suporte Técnico' });

    const res = await renomear({ name: 'Suporte Técnico' });

    expect(res.status).toBe(200);
    expect(updateChannelName).toHaveBeenCalledWith('channel-1', 'Suporte Técnico');
    expect(res.body.name).toBe('Suporte Técnico');
  });

  test('apara espacos das pontas antes de gravar', async () => {
    updateChannelName.mockResolvedValue({ ...CANAL, name: 'Comercial' });

    await renomear({ name: '  Comercial  ' });

    expect(updateChannelName).toHaveBeenCalledWith('channel-1', 'Comercial');
  });

  test('recusa nome vazio', async () => {
    const res = await renomear({ name: '' });

    expect(res.status).toBe(400);
    expect(updateChannelName).not.toHaveBeenCalled();
  });

  test('recusa nome so com espacos', async () => {
    const res = await renomear({ name: '   ' });

    expect(res.status).toBe(400);
    expect(updateChannelName).not.toHaveBeenCalled();
  });

  test('renomear nao mexe nas outras configuracoes do canal', async () => {
    updateChannelName.mockResolvedValue({ ...CANAL, name: 'Comercial' });

    await renomear({ name: 'Comercial' });

    expect(updateChannelTriageEnabled).not.toHaveBeenCalled();
    expect(updateChannelWelcomeMessage).not.toHaveBeenCalled();
    expect(updateChannelHidden).not.toHaveBeenCalled();
  });

  test('403 para quem nao gerencia integracoes', async () => {
    const res = await request(buildApp())
      .patch('/api/admin/channels/channel-1')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`)
      .send({ name: 'Comercial' });

    expect(res.status).toBe(403);
    expect(updateChannelName).not.toHaveBeenCalled();
  });
});
