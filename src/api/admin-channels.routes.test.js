jest.mock('../channels/channel.repository');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('qrcode');
const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');
const QRCode = require('qrcode');
const { listChannels, createChannel, findChannelById } = require('../channels/channel.repository');
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
      },
    ]);

    const res = await request(buildApp())
      .get('/api/admin/channels')
      .set('Authorization', `Bearer ${tokenFor('agent-1', 'admin')}`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual([
      { id: 'channel-1', type: 'meta_cloud', name: 'Suporte', phoneNumber: '+5511999990001', status: 'connected' },
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
      });

    expect(res.status).toBe(201);
    expect(createChannel).toHaveBeenCalledWith({
      type: 'meta_cloud',
      name: 'Financeiro',
      phoneNumber: '+5511999990002',
      config: { phoneNumberId: '999', accessToken: 'tok' },
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
