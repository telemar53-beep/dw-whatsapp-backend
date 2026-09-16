jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../templates/template.service');
jest.mock('../conversations/message-status.service');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
}));
jest.mock('./three-sixty-dialog.adapter', () => ({
  ...jest.requireActual('./three-sixty-dialog.adapter'),
  downloadMedia: jest.fn(),
}));
const request = require('supertest');
const express = require('express');
const { findChannelByWebhookToken } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { downloadMedia } = require('./three-sixty-dialog.adapter');
const threeSixtyDialogRoutes = require('./three-sixty-dialog.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/webhooks', threeSixtyDialogRoutes);
  return app;
}

describe('POST /webhooks/360dialog/:webhookToken', () => {
  beforeEach(() => jest.clearAllMocks());

  // Teste real 2026-09-16: mídia da 360dialog sumia e o log trazia o erro
  // cru do axios — com os cabeçalhos da requisição (D360-API-KEY) dentro.
  test('download de mídia falhando: responde 200, não ingere a mensagem e loga sem a chave da API', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: { apiKey: 'key-secreta-1' } });
    const err = new Error('Request failed with status code 401');
    err.response = { status: 401, data: { error: 'unauthorized' } };
    err.config = { headers: { 'D360-API-KEY': 'key-secreta-1' } };
    downloadMedia.mockRejectedValue(err);
    const erroSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const payload = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '1234567890' },
        contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
        messages: [{ from: '5511999998888', id: 'wamid.IMG', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }],
      } }] }],
    };

    const res = await request(buildApp()).post('/webhooks/360dialog/valid-token').send(payload);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
    const logado = erroSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logado).toContain('Failed to process inbound 360dialog message');
    expect(logado).toContain('status=401');
    expect(logado).not.toContain('key-secreta-1');
    erroSpy.mockRestore();
  });

  test('processes a valid webhook payload for a matching channel', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: { apiKey: 'key-1' } });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [{ from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } }],
              },
            },
          ],
        },
      ],
    };

    const res = await request(buildApp()).post('/webhooks/360dialog/valid-token').send(payload);

    expect(res.status).toBe(200);
    expect(findChannelByWebhookToken).toHaveBeenCalledWith('valid-token');
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.ABC',
      messageType: 'text',
      content: 'Ola',
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: undefined,
      locationLongitude: undefined,
      repliedToWhatsappMessageId: null,
    });
  });

  test('returns 404 when the token matches no channel', async () => {
    findChannelByWebhookToken.mockResolvedValue(null);

    const res = await request(buildApp()).post('/webhooks/360dialog/unknown-token').send({ entry: [] });

    expect(res.status).toBe(404);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('returns 404 when the matched channel is hidden', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: true, config: {} });

    const res = await request(buildApp()).post('/webhooks/360dialog/hidden-token').send({ entry: [] });

    expect(res.status).toBe(404);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('downloads media using the matched channel, not just an access token', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: { apiKey: 'key-1' } });
    downloadMedia.mockResolvedValue(Buffer.from('fake-bytes'));
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [{ changes: [{ value: {
        metadata: { phone_number_id: '1234567890' },
        messages: [{ from: '5511999998888', id: 'wamid.IMG1', type: 'image', image: { id: 'media-1', mime_type: 'image/jpeg' } }],
      } }] }],
    };

    await request(buildApp()).post('/webhooks/360dialog/valid-token').send(payload);

    expect(downloadMedia).toHaveBeenCalledWith('media-1', { id: 'channel-1', hidden: false, config: { apiKey: 'key-1' } });
  });

  test('still returns 200 even if applyTemplateStatusUpdates and applyMessageStatusUpdates both throw', async () => {
    findChannelByWebhookToken.mockResolvedValue({ id: 'channel-1', hidden: false, config: {} });
    applyTemplateStatusUpdates.mockRejectedValue(new Error('boom'));
    applyMessageStatusUpdates.mockRejectedValue(new Error('boom'));

    const res = await request(buildApp()).post('/webhooks/360dialog/valid-token').send({ entry: [] });

    expect(res.status).toBe(200);
  });
});
