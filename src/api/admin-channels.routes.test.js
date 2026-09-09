jest.mock('../channels/channel.repository');
jest.mock('../whatsapp-adapters/baileys.manager');
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
  countChannelDependents,
  deleteChannel,
} = require('../channels/channel.repository');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const adminChannelsRoutes = require('./admin-channels.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/admin/channels', adminChannelsRoutes);
  return app;
}

function tokenFor(agentId, role) {
  return jwt.sign({ agentId, role }, process.env.JWT_SECRET);
}

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
      },
    ]);
  });

  test('returns 403 for a non-admin agent', async () => {
    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'agent')}`);
    expect(res.status).toBe(403);
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
});
