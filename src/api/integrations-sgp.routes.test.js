jest.mock('../integrations/sgp-integration.repository');
jest.mock('../channels/channel.repository');
jest.mock('../conversations/contact.repository');
jest.mock('../conversations/conversation.repository');
jest.mock('../queue/outbound-queue');
jest.mock('../whatsapp-adapters/baileys.manager');
jest.mock('../realtime/socket-server');
const request = require('supertest');
const express = require('express');
const {
  verifySgpApiKey,
  findSgpDispatchByReferenceId,
  createSgpDispatch,
} = require('../integrations/sgp-integration.repository');
const { findChannelById } = require('../channels/channel.repository');
const { findOrCreateContactByPhoneNumber } = require('../conversations/contact.repository');
const { findOpenConversation, createConversation, getConversationWithContact } = require('../conversations/conversation.repository');
const { enqueueOutboundMessage } = require('../queue/outbound-queue');
const { emitToAgent } = require('../realtime/socket-server');
const baileysManager = require('../whatsapp-adapters/baileys.manager');
const integrationsSgpRoutes = require('./integrations-sgp.routes');

function buildApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/integrations/sgp', integrationsSgpRoutes);
  return app;
}

const CHANNEL = { id: 'channel-1', type: 'baileys', status: 'connected' };
const VALID_BODY = { phoneNumber: '5598999990000', content: 'Seu boleto vence em 10/09', referenceId: 'boleto-1' };

describe('POST /api/integrations/sgp/messages', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    findSgpDispatchByReferenceId.mockResolvedValue(null);
    findChannelById.mockResolvedValue(CHANNEL);
    findOrCreateContactByPhoneNumber.mockResolvedValue({ id: 'contact-1' });
    findOpenConversation.mockResolvedValue(null);
    createConversation.mockResolvedValue({ id: 'conv-1', status: 'silent' });
    enqueueOutboundMessage.mockResolvedValue({ id: 'msg-1' });
    createSgpDispatch.mockResolvedValue({ id: 'dispatch-1', referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });
    baileysManager.resolveWhatsAppJid.mockResolvedValue('5598999990000');
  });

  test('returns 401 when the Authorization header is missing', async () => {
    const res = await request(buildApp()).post('/api/integrations/sgp/messages').send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(verifySgpApiKey).not.toHaveBeenCalled();
  });

  test('returns 401 when the api key is invalid', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'invalid' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer wrong-key')
      .send(VALID_BODY);
    expect(res.status).toBe(401);
    expect(verifySgpApiKey).toHaveBeenCalledWith('wrong-key');
  });

  test('returns 400 when the integration is not configured', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'not_configured' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer any-key')
      .send(VALID_BODY);
    expect(res.status).toBe(400);
  });

  test('returns 400 when the integration is disabled', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'disabled' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer any-key')
      .send(VALID_BODY);
    expect(res.status).toBe(400);
  });

  test('returns 400 when no api key has been generated yet', async () => {
    verifySgpApiKey.mockResolvedValue({ status: 'no_key' });
    const res = await request(buildApp())
      .post('/api/integrations/sgp/messages')
      .set('Authorization', 'Bearer any-key')
      .send(VALID_BODY);
    expect(res.status).toBe(400);
  });

  describe('with a valid api key', () => {
    beforeEach(() => {
      verifySgpApiKey.mockResolvedValue({ status: 'ok', channelId: 'channel-1' });
    });

    test('returns 400 when phoneNumber is missing', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send({ content: 'Oi', referenceId: 'ref-1' });
      expect(res.status).toBe(400);
      expect(findChannelById).not.toHaveBeenCalled();
    });

    test('returns 400 when content is missing', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send({ phoneNumber: '5598999990000', referenceId: 'ref-1' });
      expect(res.status).toBe(400);
    });

    test('returns 400 when referenceId is missing', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send({ phoneNumber: '5598999990000', content: 'Oi' });
      expect(res.status).toBe(400);
    });

    test('returns 200 without resending when referenceId was already processed', async () => {
      findSgpDispatchByReferenceId.mockResolvedValue({
        id: 'dispatch-1',
        referenceId: 'boleto-1',
        conversationId: 'conv-existing',
        messageId: 'msg-existing',
      });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ conversationId: 'conv-existing', messageId: 'msg-existing', duplicate: true });
      expect(enqueueOutboundMessage).not.toHaveBeenCalled();
    });

    test('returns 400 when the configured channel is not connected', async () => {
      findChannelById.mockResolvedValue({ ...CHANNEL, status: 'awaiting_qr' });
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not connected/i);
    });

    test('returns 400 when the phone number is not registered on WhatsApp', async () => {
      baileysManager.resolveWhatsAppJid.mockResolvedValue(null);
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/not.*whatsapp/i);
      expect(findOrCreateContactByPhoneNumber).not.toHaveBeenCalled();
    });

    test('creates a new silent conversation when none is open and sends the message', async () => {
      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(baileysManager.resolveWhatsAppJid).toHaveBeenCalledWith(CHANNEL, '5598999990000');
      expect(findOrCreateContactByPhoneNumber).toHaveBeenCalledWith('5598999990000', null);
      expect(createConversation).toHaveBeenCalledWith('contact-1', 'channel-1', null, 'silent');
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-1',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(createSgpDispatch).toHaveBeenCalledWith({ referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });
      expect(res.status).toBe(202);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });

    test('reuses an existing open conversation instead of creating a new one', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-existing', status: 'waiting' });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(createConversation).not.toHaveBeenCalled();
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-existing',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(202);
    });

    test('falls back to the existing conversation when createConversation races on a unique violation', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      createConversation.mockRejectedValue(uniqueViolation);
      findOpenConversation.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'conv-race', status: 'silent' });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(findOpenConversation).toHaveBeenCalledTimes(2);
      expect(enqueueOutboundMessage).toHaveBeenCalledWith({
        conversationId: 'conv-race',
        channelId: 'channel-1',
        content: 'Seu boleto vence em 10/09',
      });
      expect(res.status).toBe(202);
    });

    test('falls back to the already-recorded dispatch when createSgpDispatch races on a unique violation', async () => {
      const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });
      createSgpDispatch.mockRejectedValue(uniqueViolation);
      findSgpDispatchByReferenceId
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ id: 'dispatch-race', referenceId: 'boleto-1', conversationId: 'conv-1', messageId: 'msg-1' });

      const res = await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(res.status).toBe(202);
      expect(res.body).toEqual({ conversationId: 'conv-1', messageId: 'msg-1' });
    });

    test('emits message:new to the assigned agent when reusing an already-assigned conversation', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-assigned', status: 'assigned', assignedAgentId: 'agent-9' });
      getConversationWithContact.mockResolvedValue({ id: 'conv-assigned', assignedAgentId: 'agent-9' });

      await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(emitToAgent).toHaveBeenCalledWith('agent-9', 'message:new', {
        conversation: { id: 'conv-assigned', assignedAgentId: 'agent-9' },
        message: { id: 'msg-1' },
      });
    });

    test('does not emit anything when the reused conversation has no assigned agent', async () => {
      findOpenConversation.mockResolvedValue({ id: 'conv-silent', status: 'silent', assignedAgentId: null });

      await request(buildApp())
        .post('/api/integrations/sgp/messages')
        .set('Authorization', 'Bearer key')
        .send(VALID_BODY);

      expect(emitToAgent).not.toHaveBeenCalled();
      expect(getConversationWithContact).not.toHaveBeenCalled();
    });
  });
});
