jest.mock('../channels/channel.repository');
jest.mock('../conversations/inbound-message.service');
jest.mock('../realtime/socket-server');
const request = require('supertest');
const express = require('express');
const crypto = require('crypto');
const { findChannelByMetaPhoneNumberId } = require('../channels/channel.repository');
const { ingestInboundMessage } = require('../conversations/inbound-message.service');
const { emitToAgent, broadcast } = require('../realtime/socket-server');
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
      content: 'Ola',
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

  test('broadcasts queue:new when the conversation has no assigned agent', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1', content: 'Ola' },
    });

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

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(broadcast).toHaveBeenCalledWith('queue:new', {
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: { id: 'msg-1', content: 'Ola' },
    });
    expect(emitToAgent).not.toHaveBeenCalled();
  });

  test('emits message:new to the assigned agent when the conversation is already assigned', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', assignedAgentId: 'agent-1' },
      message: { id: 'msg-1', content: 'Ola' },
    });

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

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(emitToAgent).toHaveBeenCalledWith('agent-1', 'message:new', {
      conversation: { id: 'conv-1', assignedAgentId: 'agent-1' },
      message: { id: 'msg-1', content: 'Ola' },
    });
    expect(broadcast).not.toHaveBeenCalled();
  });

  test('emits nothing when the message was a duplicate (idempotency short-circuit)', async () => {
    findChannelByMetaPhoneNumberId.mockResolvedValue({ id: 'channel-1' });
    ingestInboundMessage.mockResolvedValue({
      conversation: { id: 'conv-1', assignedAgentId: null },
      message: null,
    });

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

    await request(buildApp())
      .post('/webhooks/meta')
      .set('X-Hub-Signature-256', signature)
      .set('Content-Type', 'application/json')
      .send(bodyString);

    expect(broadcast).not.toHaveBeenCalled();
    expect(emitToAgent).not.toHaveBeenCalled();
  });
});
