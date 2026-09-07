jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../templates/template.service');
jest.mock('../conversations/message-status.service');
jest.mock('../media/media-storage', () => ({
  ...jest.requireActual('../media/media-storage'),
  saveMediaFile: jest.fn(),
}));
jest.mock('./meta-cloud.adapter', () => ({
  ...jest.requireActual('./meta-cloud.adapter'),
  downloadMetaMedia: jest.fn(),
}));
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { applyTemplateStatusUpdates } = require('../templates/template.service');
const { applyMessageStatusUpdates } = require('../conversations/message-status.service');
const { saveMediaFile } = require('../media/media-storage');
const { downloadMetaMedia } = require('./meta-cloud.adapter');
const metaCloudRoutes = require('./meta-cloud.routes');

function buildApp() {
  const app = express();
  app.use(
    express.json({
      verify: (req, res, buf) => {
        req.rawBody = buf;
      },
    })
  );
  app.use('/webhooks', metaCloudRoutes);
  return app;
}

function sign(bodyString, secret) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(bodyString).digest('hex');
}

describe('GET /webhooks/meta', () => {
  beforeEach(() => {
    process.env.META_VERIFY_TOKEN = 'verify-me';
  });

  test('responds with the challenge when the token matches', async () => {
    const res = await request(buildApp())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'verify-me', 'hub.challenge': 'abc123' });
    expect(res.status).toBe(200);
    expect(res.text).toBe('abc123');
  });

  test('responds 403 when the token does not match', async () => {
    const res = await request(buildApp())
      .get('/webhooks/meta')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc123' });
    expect(res.status).toBe(403);
  });
});

describe('POST /webhooks/meta', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.META_APP_SECRET = 'app-secret';
  });

  test('processes a valid, signed webhook payload', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
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
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
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
    });
  });

  test('responds 200 and continues processing when ingestInboundMessage fails for one message in a batch', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockRejectedValueOnce(new Error('db unavailable')).mockResolvedValueOnce({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [
                  { profile: { name: 'Carlos' }, wa_id: '5511999998888' },
                  { profile: { name: 'Maria' }, wa_id: '5511999997777' },
                ],
                messages: [
                  { from: '5511999998888', id: 'wamid.ABC', type: 'text', text: { body: 'Ola' } },
                  { from: '5511999997777', id: 'wamid.DEF', type: 'text', text: { body: 'Oi' } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(ingestInboundMessage).toHaveBeenCalledTimes(2);
  });

  test('rejects a payload with an invalid signature', async () => {
    const bodyString = JSON.stringify({ entry: [] });
    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .set('Content-Type', 'application/json')
      .send(bodyString);
    expect(res.status).toBe(403);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('rejects a non-JSON content-type request even with a well-formed signature header', async () => {
    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', 'sha256=' + '0'.repeat(64))
      .set('Content-Type', 'text/plain')
      .send('not json');
    expect(res.status).toBe(403);
    expect(ingestInboundMessage).not.toHaveBeenCalled();
  });

  test('downloads and saves media before ingesting an image message', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', config: { accessToken: 'tok-meta' } });
    ingestInboundMessage.mockResolvedValue({});
    downloadMetaMedia.mockResolvedValue(Buffer.from('fake-image-bytes'));
    saveMediaFile.mockResolvedValue('generated-name.jpg');

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [{ profile: { name: 'Carlos' }, wa_id: '5511999998888' }],
                messages: [
                  {
                    from: '5511999998888',
                    id: 'wamid.IMG',
                    type: 'image',
                    image: { id: 'MEDIA123', mime_type: 'image/jpeg', caption: 'Comprovante' },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(downloadMetaMedia).toHaveBeenCalledWith('MEDIA123', 'tok-meta');
    expect(saveMediaFile).toHaveBeenCalledWith(Buffer.from('fake-image-bytes'), '.jpg');
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: 'Carlos',
      whatsappMessageId: 'wamid.IMG',
      messageType: 'image',
      content: 'Comprovante',
      mediaPath: 'generated-name.jpg',
      mediaMimeType: 'image/jpeg',
      mediaFilename: null,
      locationLatitude: undefined,
      locationLongitude: undefined,
    });
  });

  test('ingests a location message without touching media storage', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1', config: {} });
    ingestInboundMessage.mockResolvedValue({});

    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567890' },
                contacts: [],
                messages: [
                  { from: '5511999998888', id: 'wamid.LOC', type: 'location', location: { latitude: -3.1, longitude: -60.0 } },
                ],
              },
            },
          ],
        },
      ],
    };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(downloadMetaMedia).not.toHaveBeenCalled();
    expect(ingestInboundMessage).toHaveBeenCalledWith({
      channelId: 'channel-1',
      fromPhoneNumber: '5511999998888',
      contactDisplayName: null,
      whatsappMessageId: 'wamid.LOC',
      messageType: 'location',
      content: undefined,
      mediaPath: undefined,
      mediaMimeType: undefined,
      mediaFilename: undefined,
      locationLatitude: -3.1,
      locationLongitude: -60.0,
    });
  });
});

describe('POST /webhooks/meta (template status updates)', () => {
  test('forwards the webhook body to applyTemplateStatusUpdates', async () => {
    const payload = { entry: [{ id: 'waba-1', changes: [{ field: 'message_template_status_update', value: { message_template_id: '123', event: 'APPROVED' } }] }] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(applyTemplateStatusUpdates).toHaveBeenCalledWith(payload);
  });

  test('still returns 200 when applyTemplateStatusUpdates throws', async () => {
    applyTemplateStatusUpdates.mockRejectedValue(new Error('boom'));
    const payload = { entry: [] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
  });
});

describe('POST /webhooks/meta (message status updates)', () => {
  test('forwards the webhook body to applyMessageStatusUpdates', async () => {
    const payload = { entry: [{ changes: [{ value: { statuses: [{ id: 'wamid.ABC', status: 'delivered' }] } }] }] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
    expect(applyMessageStatusUpdates).toHaveBeenCalledWith(payload);
  });

  test('still returns 200 when applyMessageStatusUpdates throws', async () => {
    applyMessageStatusUpdates.mockRejectedValue(new Error('boom'));
    const payload = { entry: [] };
    const bodyString = JSON.stringify(payload);
    const signature = sign(bodyString, 'app-secret');

    const res = await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(res.status).toBe(200);
  });
});
